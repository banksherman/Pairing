
import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import qrcode from "qrcode";
import pino from "pino";
import crypto from "crypto";
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} from "@whiskeysockets/baileys";

// Ensure sessions dir exists
const SESS_DIR = "sessions";
fs.mkdirSync(SESS_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Per-session runtime store
 * id -> { sock, lastQR, lastQRAt, sentSessionMsg }
 */
const sessions = new Map();

function newSessionId() {
  return "ban-" + crypto.randomBytes(4).toString("hex");
}

async function createSession(id) {
  const sessionId = id || newSessionId();
  let S = sessions.get(sessionId);
  if (S?.sock) return { sessionId, ...S };

  const { state, saveCreds } = await useMultiFileAuthState(path.join(SESS_DIR, sessionId));
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: Browsers.macOS("Google Chrome"),
  });

  S = { sock, lastQR: null, lastQRAt: 0, sentSessionMsg: false };
  sessions.set(sessionId, S);

  // Persist creds
  sock.ev.on("creds.update", saveCreds);

  // Listen for QR + login open
  sock.ev.on("connection.update", async (u) => {
    if (u.qr) {
      S.lastQR = u.qr;
      S.lastQRAt = Date.now();
    }
    if (u.connection === "open" && !S.sentSessionMsg && sock?.user?.id) {
      // Auto-send sessionId to the logged-in account as a chat message
      try {
        await sock.sendMessage(sock.user.id, {
          text: `✅ BAN‑MD: Your session ID is:\n${sessionId}\n\nKeep it safe to reuse your login.`,
        });
      } catch (err) {
        console.error("Failed to send sessionId message:", err?.message || err);
      }
      S.sentSessionMsg = true;
    }
  });

  return { sessionId, ...S };
}

/** Get QR for a session (create if missing).
 * Returns cached QR immediately if it's still fresh; otherwise waits for next QR event (up to 25s).
 */
app.get("/api/qr/:sessionId?", async (req, res) => {
  const wanted = req.params.sessionId && req.params.sessionId !== "new" ? req.params.sessionId : null;
  const { sessionId, sock, lastQR, lastQRAt } = await createSession(wanted);

  if (sock.user) {
    return res.json({ message: "Logged in", user: sock.user, sessionId });
  }

  // Serve cached QR if it's recent (< 60s)
  if (lastQR && Date.now() - lastQRAt < 60_000) {
    const img = await qrcode.toDataURL(lastQR);
    return res.json({ qr: img, sessionId });
  }

  let responded = false;
  const handler = async (u) => {
    if (u.qr && !responded) {
      responded = true;
      const img = await qrcode.toDataURL(u.qr);
      res.json({ qr: img, sessionId });
    }
    if (u.connection === "open" && !responded) {
      responded = true;
      res.json({ message: "Logged in", user: sock.user, sessionId });
    }
  };

  // Wait for a QR or open event
  sock.ev.once("connection.update", handler);

  // Long-poll ~25s to reduce "network error" on cold start hosts
  const t = setTimeout(() => {
    if (!responded) res.json({ error: "QR not available yet. Tap again.", sessionId });
  }, 25_000);

  // Safety: clear listener after responding
  res.on("finish", () => {
    clearTimeout(t);
  });
});

/** Generate 8-digit pairing code for a phone for this session. */
app.get("/api/pair/:sessionId/:phone", async (req, res) => {
  let { sessionId, phone } = req.params;
  phone = String(phone || "").replace(/\D/g, "");
  if (!phone) return res.json({ error: "Valid phone required (include country code digits only)" });

  const { sock } = await createSession(sessionId);

  if (sock.user) {
    return res.json({ message: "Already logged in", user: sock.user, sessionId });
  }

  try {
    const code = await sock.requestPairingCode(phone);
    return res.json({ code, sessionId });
  } catch (e) {
    return res.json({ error: e?.message || "Failed to generate code", sessionId });
  }
});

/** Optional: Whoami */
app.get("/api/me/:sessionId", async (req, res) => {
  const s = sessions.get(req.params.sessionId);
  if (!s) return res.json({ error: "Unknown session" });
  res.json({ user: s.sock?.user || null });
});

/** Single-file UI (styled result box red bg + bold black text) */
app.get("/", (_, res) => {
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>🤖 BAN‑MD Pairing</title>
<style>
  :root{ --bg:#0b1020; --card:#121a3a; --ink:#eaf0ff; --muted:#9eb0ff; --accent:#5b79ff; }
  *{ box-sizing:border-box }
  body{ margin:0; background:linear-gradient(160deg,#0b1020,#1a2447); color:var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial }
  .wrap{ max-width:900px; margin:0 auto; padding:28px 16px }
  h1{ margin:0 0 6px; font-size:28px }
  .grid{ display:grid; gap:16px; grid-template-columns:1fr; margin-top:18px }
  @media(min-width:760px){ .grid{ grid-template-columns:1fr 1fr } }
  .card{ background:var(--card); border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:18px; box-shadow:0 8px 24px rgba(0,0,0,.25) }
  h2{ margin:0 0 10px; font-size:18px; color:var(--muted) }
  label{ font-size:12px; color:#c8d2ff; display:block; margin:8px 0 6px }
  input{ width:100%; padding:12px 14px; background:#0d1330; border:1px solid #2a377b; color:var(--ink); border-radius:10px; outline:none }
  input::placeholder{ color:#9db1ff }
  button{ padding:12px 16px; border:none; border-radius:10px; background:var(--accent); color:white; font-weight:700; cursor:pointer }
  button.secondary{ background:#2b3a7a }
  #qrImage{ width:100%; max-width:320px; background:#0d1330; border:1px solid #2a377b; border-radius:10px; display:block; margin:10px auto 0 }
  .muted{ color:#aab6ff; font-size:12px; margin-top:8px; text-align:center }
  .badge{ background:red; color:black; font-weight:900; padding:10px 12px; border-radius:8px; display:inline-block; min-width:200px }
  .row{ display:flex; gap:10px; align-items:center }
  #sessionLine{ margin-top:10px; font-size:13px; color:#cbd4ff }
</style>
</head>
<body>
  <div class="wrap">
    <h1>🤖 BAN‑MD Pairing</h1>

    <div class="card">
      <label>Session ID (leave empty to auto-create)</label>
      <div class="row">
        <input id="sessionId" placeholder="ban-xxxx">
        <button class="secondary" onclick="newSession()">New Session</button>
      </div>
      <div id="sessionLine"></div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>📲 QR Login</h2>
        <div class="row">
          <button id="btnQr" onclick="loadQr()">Refresh QR</button>
          <div id="qrMsg" class="muted"></div>
        </div>
        <img id="qrImage" alt="QR">
      </div>

      <div class="card">
        <h2>🔑 Pairing Code</h2>
        <label>Phone (digits only, include country code)</label>
        <div class="row">
          <input id="phone" placeholder="2567xxxxxxx">
          <button id="btnPair" onclick="getPair()">Generate Pair Code</button>
        </div>
        <div id="result" class="badge" style="display:none"></div>
        <div class="muted">We will also send your session ID to your WhatsApp after login.</div>
      </div>
    </div>
  </div>

<script>
  function rid(){ return 'ban-' + Math.random().toString(16).slice(2,10); }
  function ensureSid(){
    let v = document.getElementById('sessionId').value.trim();
    if (v) return v;
    v = localStorage.getItem('ban_sid') || rid();
    document.getElementById('sessionId').value = v;
    localStorage.setItem('ban_sid', v);
    return v;
  }
  function newSession(){
    const v = rid();
    document.getElementById('sessionId').value = v;
    localStorage.setItem('ban_sid', v);
    document.getElementById('sessionLine').textContent = 'Session ID: ' + v;
  }

  async function loadQr(){
    const sid = ensureSid();
    document.getElementById('sessionLine').textContent = 'Session ID: ' + sid;
    document.getElementById('qrMsg').textContent = 'Loading... (up to ~25s on first start)';
    try {
      const r = await fetch('/api/qr/' + encodeURIComponent(sid));
      const d = await r.json();
      if (d.qr){
        document.getElementById('qrImage').src = d.qr;
        document.getElementById('qrMsg').textContent = 'Scan in WhatsApp → Linked devices → Link a device';
      } else if (d.message){
        document.getElementById('qrImage').removeAttribute('src');
        document.getElementById('qrMsg').textContent = d.message;
      } else {
        document.getElementById('qrImage').removeAttribute('src');
        document.getElementById('qrMsg').textContent = d.error || 'QR not available yet';
      }
      if (d.sessionId){
        document.getElementById('sessionId').value = d.sessionId;
        localStorage.setItem('ban_sid', d.sessionId);
        document.getElementById('sessionLine').textContent = 'Session ID: ' + d.sessionId;
      }
    } catch (e) {
      document.getElementById('qrMsg').textContent = 'Network error.';
    }
  }

  async function getPair(){
    const sid = ensureSid();
    document.getElementById('sessionLine').textContent = 'Session ID: ' + sid;
    const phone = (document.getElementById('phone').value || '').replace(/\\D/g, '');
    if(!phone){ alert('Enter a valid phone with country code'); return; }
    try {
      const r = await fetch('/api/pair/' + encodeURIComponent(sid) + '/' + encodeURIComponent(phone));
      const d = await r.json();
      const box = document.getElementById('result');
      box.style.display = 'inline-block';
      if (d.code){
        box.textContent = 'Your Code: ' + d.code;
      } else if (d.message){
        box.textContent = d.message;
      } else {
        box.textContent = 'Error: ' + (d.error || 'Failed');
      }
      if (d.sessionId){
        document.getElementById('sessionId').value = d.sessionId;
        localStorage.setItem('ban_sid', d.sessionId);
        document.getElementById('sessionLine').textContent = 'Session ID: ' + d.sessionId;
      }
    } catch (e) {
      const box = document.getElementById('result');
      box.style.display = 'inline-block';
      box.textContent = 'Network error.';
    }
  }

  // Auto-load a QR on first visit
  loadQr();
</script>
</body>
</html>`);
});

app.get("/api/health", (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("BAN‑MD running on port " + PORT));
