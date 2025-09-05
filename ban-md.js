import express from "express";
import cors from "cors";
import qrcode from "qrcode";
import pino from "pino";
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } from "@whiskeysockets/baileys";

const app = express();
app.use(cors());
app.use(express.json());

const sessions = {};

async function createSession(sessionId = "session1") {
  if (sessions[sessionId]) return sessions[sessionId];

  const { state, saveCreds } = await useMultiFileAuthState(`sessions/${sessionId}`);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: Browsers.macOS("Google Chrome"),
  });

  sock.ev.on("creds.update", saveCreds);
  sessions[sessionId] = sock;
  return sock;
}

// --- QR endpoint ---
app.get("/api/qr/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const sock = await createSession(sessionId);

  if (sock.user) return res.json({ message: "Already logged in", user: sock.user });

  let responded = false;
  const handler = async (update) => {
    if (update.qr && !responded) {
      responded = true;
      const qrImage = await qrcode.toDataURL(update.qr);
      res.json({ qr: qrImage });
    }
    if (update.connection === "open" && !responded) {
      responded = true;
      res.json({ message: "Already logged in", user: sock.user });
    }
  };

  sock.ev.once("connection.update", handler);

  setTimeout(() => {
    if (!responded) {
      res.json({ error: "QR not available, refresh again." });
    }
  }, 10000);
});

// --- Pairing code endpoint ---
app.get("/api/pair/:sessionId/:phone", async (req, res) => {
  const { sessionId, phone } = req.params;
  if (!phone) return res.json({ error: "Phone required" });

  const sock = await createSession(sessionId);

  if (sock.user) return res.json({ message: "Already logged in", user: sock.user });

  try {
    const code = await sock.requestPairingCode(phone);
    return res.json({ code });
  } catch (e) {
    return res.json({ error: e.message });
  }
});

// --- Simple HTML ---
app.get("/", (_, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BAN-MD Pairing</title>
  <style>
    body { font-family: sans-serif; text-align: center; padding: 30px; background: #f4f4f4; }
    h1 { color: #333; }
    section { background: #fff; padding: 20px; margin: 20px auto; border-radius: 10px; max-width: 400px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
    input, button { margin: 10px; padding: 10px; font-size: 16px; border-radius: 5px; border: 1px solid #ccc; }
    button { background: #007bff; color: #fff; border: none; cursor: pointer; }
    button:hover { background: #0056b3; }
    img { margin-top: 10px; border: 1px solid #ccc; }
  </style>
</head>
<body>
  <h1>🤖 BAN-MD Pairing</h1>
  <section>
    <h2>📲 QR Login</h2>
    <img id="qrImage" width="250"><br>
    <button onclick="loadQr()">Refresh QR</button>
    <div id="qrMsg"></div>
  </section>

  <section>
    <h2>🔑 Pairing Code</h2>
    <input id="phone" placeholder="2567xxxxxxx">
    <button onclick="getPair()">Generate Pair Code</button>
    <div id="result"></div>
  </section>

  <script>
    async function loadQr(){
      document.getElementById('qrMsg').innerText="Loading...";
      const r = await fetch('/api/qr/session1'); const d = await r.json();
      if(d.qr){ document.getElementById('qrImage').src=d.qr; document.getElementById('qrMsg').innerText=""; }
      else { document.getElementById('qrImage').src=""; document.getElementById('qrMsg').innerText=d.error||d.message; }
    }

    async function getPair(){
      const phone=document.getElementById('phone').value.trim();
      if(!phone) return alert("Enter phone");
      const r=await fetch('/api/pair/session1/'+encodeURIComponent(phone)); const d=await r.json();
      document.getElementById('result').innerText=d.code?("Your Code: "+d.code):("Error: "+(d.error||d.message));
    }

    loadQr();
  </script>
</body>
</html>`);
});

app.get("/api/health", (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("BAN-MD Pairing running on :" + PORT));
