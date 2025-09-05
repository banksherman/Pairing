import fs from "fs";
import express from "express";
import cors from "cors";
import qrcode from "qrcode";
import pino from "pino";
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} from "@whiskeysockets/baileys";

// Ensure sessions folder exists (important on hosts)
fs.mkdirSync("sessions", { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Session store: sessionId -> { sock, lastQR, lastQRAt, user, connection }
 */
const sessions = new Map();

function randomId() {
  return "ban-" + Math.random().toString(16).slice(2, 10);
}

async function createSession(sessionId) {
  const id = sessionId || randomId();
  let s = sessions.get(id);

  if (s && s.sock) return { id, ...s };

  const { state, saveCreds } = await useMultiFileAuthState(`sessions/${id}`);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: Browsers.macOS("Google Chrome"),
  });

  s = { sock, lastQR: null, lastQRAt: 0, user: null, connection: "init" };
  sessions.set(id, s);

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (update) => {
    if (update.qr) {
      s.lastQR = update.qr;
      s.lastQRAt = Date.now();
    }
    if (update.connection) {
      s.connection = update.connection;
    }
    if (sock.user) {
      s.user = sock.user;
    }
  });

  return { id, ...s };
}

/** ---------- API: QR ----------
 * Returns a fresh QR (if available), or the last seen QR,
 * or a message if already logged in.
 */
app.get("/api/qr/:sessionId?", async (req, res) => {
  const wantedId = req.params.sessionId && req.params.sessionId !== "new" ? req.params.sessionId : null;
  const { id, sock, lastQR, lastQRAt } = await createSession(wantedId);

  if (sock.user) return res.json({ message: "Already logged in", user: sock.user, sessionId: id });

  // If we already have a QR from last second, re-use it
  if (lastQR && Date.now() - lastQRAt < 60_000) {
    const qrImage = await qrcode.toDataURL(lastQR);
    return res.json({ qr: qrImage, sessionId: id });
  }

  // Otherwise wait for the next QR event briefly
  let responded = false;
  const handler = async (update) => {
    if (update.qr && !responded) {
      responded = true;
      const qrImage = await qrcode.toDataURL(update.qr);
      res.json({ qr: qrImage, sessionId: id });
    }
    if (update.connection === "open" && !responded) {
      responded = true;
      res.json({ message: "Already logged in", user: sock.user, sessionId: id });
    }
  };
  sock.ev.once("connection.update", handler);

  setTimeout(() => {
    if (!responded) res.json({ error: "QR not available yet. Tap again.", sessionId: id });
  }, 10_000);
});

/** ---------- API: Pair Code ----------
 * Generates the 8-digit pairing code for the given phone.
 */
app.get("/api/pair/:sessionId/:phone", async (req, res) => {
  const { sessionId } = req.params;
  let { phone } = req.params;

  const clean = (phone + "").replace(/\D/g, "");
  if (!clean) return res.json({ error: "Valid phone required (include country code, digits only)" });

  const { id, sock } = await createSession(sessionId);

  if (sock.user) return res.json({ message: "Already logged in", user: sock.user, sessionId: id });

  try {
    const code = await sock.requestPairingCode(clean);
    return res.json({ code, sessionId: id });
  } catch (e) {
    return res.json({ error: e.message || "Failed to generate code", sessionId: id });
  }
});

/** ---------- API: Whoami ---------- */
app.get("/api/me/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const s = sessions.get(sessionId);
  if (!s) return res.json({ error: "Unknown session" });
  res.json({ user: s.user || null, connection: s.connection });
});

/** ---------- UI ---------- */
app.get("/", (_, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BAN-MD Pairing</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { --bg:#0b1020; --card:#101735; --text:#e9eeff; --muted:#8fa1ff; --accent:#5c7cff; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial; background:linear-gradient(160deg, #0b1020, #1a2245); color:var(--text); }
    .wrap { max-width:960px; margin:0 auto; padding:32px 16px; }
    .title { text-align:center; font-weight:800; font-size:28px; letter-spacing:.5px; }
    .grid { display:grid; grid-template-columns:1fr; gap:16px; margin-top:24px; }
    @media(min-width: 760px){ .grid{ grid-template-columns: 1fr 1fr; } }
    .card { background:var(--card); border:1px solid rgba(255,255,255,.06); border-radius:16px; padding:20px; box-shadow:0 10px 30px rgba(0,0,0,.25); }
    h2 { margin:0 0 10px; font-size:18px; color:var(--muted); }
    label { display:block; font-size:13px; margin-bottom:6px; color:#c9d2ff; }
    input { width:100%; padding:12px 14px; background:#0d1330; border:1px solid #2a377b; color:var(--text); border-radius:10px; outline:none; }
    input::placeholder{ color:#95a0d6; }
    .row { display:flex; gap:10px; align-items:center; }
    button { padding:12px 16px; border:none; border-radius:10px; background:var(--accent); color:white; font-weight:700; cursor:pointer; }
    button.secondary { background:#26336f; }
    button:disabled{ opacity:.6; cursor:not-allowed; }
    #qrImage { width:100%; max-width:320px; background:#0d1330; border:1px solid #2a377b; border-radius:10px; display:block; margin:10px auto 0; }
    .muted { color:#aab6ff; font-size:12px; margin-top:8px; text-align:center; }
    .ok { color:#7dffa7; font-weight:700; }
    .err { color:#ff8aa1; font-weight:700; }
    .badge { background:#0d1330; border:1px dashed #3b4ba3; color:#b9c6ff; padding:8px 10px; border-radius:8px; word-break:break-all; }
    footer { text-align:center; margin-top:24px; color:#9aa7ff; font-size:12px; opacity:.85; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="title">🤖 BAN‑MD Pairing</div>

    <div class="card" style="margin-top:16px">
      <label>Session ID</label>
      <div class="row">
        <input id="sessionId" placeholder="Leave empty for new session">
        <button class="secondary" onclick="newSession()">New Session</button>
        <button onclick="saveSid()">Save</button>
      </div>
      <div class="muted">Tip: Share this ID with your user to reuse the login.</div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>📲 QR Login</h2>
        <div class="row">
          <button id="btnQr" onclick="loadQr()">Get QR</button>
          <div id="qrMsg" class="muted"></div>
        </div>
        <img id="qrImage" alt="QR will appear here">
      </div>

      <div class="card">
        <h2>🔑 Pairing Code</h2>
        <label>Phone (digits only, include country code)</label>
        <div class="row">
          <input id="phone" placeholder="2567xxxxxxx">
          <button id="btnPair" onclick="getPair()">Generate Pair Code</button>
        </div>
        <div id="result" class="muted"></div>
      </div>
    </div>

    <div class="card">
      <h2>ℹ️ Current Session</h2>
      <div>Session ID: <span class="badge" id="sidShow">—</span></div>
      <div style="margin-top:6px">Status: <span id="status" class="muted">idle</span></div>
      <div style="margin-top:6px">User: <span id="user" class="muted">—</span></div>
    </div>

    <footer>When logged in, keep your session ID safe.</footer>
  </div>

  <script>
    function rid(){ return 'ban-' + Math.random().toString(16).slice(2,10); }
    function getSid(){ return localStorage.getItem('ban_sid') || ''; }
    function setSid(v){ localStorage.setItem('ban_sid', v); document.getElementById('sidShow').textContent = v || '—'; }

    function newSession(){
      const id = rid();
      document.getElementById('sessionId').value = id;
      setSid(id);
      toast('New session created: ' + id);
    }

    function saveSid(){
      const v = document.getElementById('sessionId').value.trim();
      setSid(v);
      toast('Session saved.');
    }

    function sidOrNew(){
      const v = document.getElementById('sessionId').value.trim();
      if (v) return v;
      const saved = getSid();
      if (saved) return saved;
      const id = rid(); setSid(id); return id;
    }

    function toast(msg){ document.getElementById('status').textContent = msg; }

    async function loadQr(){
      const sid = sidOrNew();
      document.getElementById('qrMsg').textContent = "Loading...";
      document.getElementById('sidShow').textContent = sid;
      try{
        const r = await fetch('/api/qr/' + encodeURIComponent(sid));
        const d = await r.json();
        if(d.qr){
          document.getElementById('qrImage').src = d.qr;
          document.getElementById('qrMsg').textContent = "Scan with WhatsApp → Linked devices → Link a device";
        } else if (d.message){
          document.getElementById('qrImage').removeAttribute('src');
          document.getElementById('qrMsg').innerHTML = '<span class="ok">' + d.message + '</span>';
          document.getElementById('user').textContent = (d.user && d.user.id) ? d.user.id : '—';
        } else {
          document.getElementById('qrImage').removeAttribute('src');
          document.getElementById('qrMsg').innerHTML = '<span class="err">' + (d.error || 'QR not available') + '</span>';
        }
        if (d.sessionId){ setSid(d.sessionId); }
      }catch(e){
        document.getElementById('qrMsg').innerHTML = '<span class="err">Network error.</span>';
      }
    }

    async function getPair(){
      const sid = sidOrNew();
      document.getElementById('sidShow').textContent = sid;
      const phone = (document.getElementById('phone').value || '').replace(/\\D/g,'');
      if(!phone){ document.getElementById('result').innerHTML = '<span class="err">Enter a valid phone.</span>'; return; }
      document.getElementById('result').textContent = 'Working...';
      try{
        const r = await fetch('/api/pair/' + encodeURIComponent(sid) + '/' + encodeURIComponent(phone));
        const d = await r.json();
        if(d.code){
          document.getElementById('result').innerHTML = 'Your Code: <span class="badge">' + d.code + '</span>';
        }else if(d.message){
          document.getElementById('result').innerHTML = '<span class="ok">' + d.message + '</span>';
          document.getElementById('user').textContent = (d.user && d.user.id) ? d.user.id : '—';
        }else{
          document.getElementById('result').innerHTML = '<span class="err">' + (d.error || 'Failed') + '</span>';
        }
        if(d.sessionId){ setSid(d.sessionId); }
      }catch(e){
        document.getElementById('result').innerHTML = '<span class="err">Network error.</span>';
      }
    }

    // bootstrap UI with stored session if any
    (function init(){
      const s = getSid();
      if(s){ document.getElementById('sessionId').value = s; document.getElementById('sidShow').textContent = s; }
      else { newSession(); }
    })();
  </script>
</body>
</html>`);
});

app.get("/api/health", (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("BAN-MD Pairing running on :" + PORT));
