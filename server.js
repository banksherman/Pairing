import express from "express";
import cors from "cors";
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const sessions = {};

async function createSession(sessionId = "ban-session1") {
  if (sessions[sessionId]) return sessions[sessionId];

  const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionId}`);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on("creds.update", saveCreds);

  sessions[sessionId] = { sock };
  return sessions[sessionId];
}

app.get("/", (req, res) => {
  res.json({ ok: true, message: "BAN-MD API is running ✅" });
});

app.get("/status", async (req, res) => {
  const sessionId = req.query.session || "ban-session1";
  const s = sessions[sessionId];
  if (!s) return res.json({ ok: false, session: sessionId, status: "none" });

  const state = s.sock.ws.readyState;
  let status = "connecting";
  if (state === 1) status = "open";
  if (state === 3) status = "close";

  res.json({ ok: true, session: sessionId, status });
});

app.get("/qr", async (req, res) => {
  const sessionId = req.query.session || "ban-session1";
  const s = await createSession(sessionId);

  let qrData;
  s.sock.ev.on("connection.update", (update) => {
    if (update.qr) {
      qrData = update.qr;
    }
  });

  setTimeout(() => {
    if (qrData) {
      res.json({ ok: true, qr: `data:image/png;base64,${qrData}`, session: sessionId });
    } else {
      res.json({ ok: false, message: "QR not available yet." });
    }
  }, 2000);
});

app.get("/pair", async (req, res) => {
  const sessionId = req.query.session || "ban-session1";
  const phone = req.query.phone;
  if (!phone) return res.json({ ok: false, message: "Phone number required" });

  const s = await createSession(sessionId);

  if (typeof s.sock.requestPairingCode === "function") {
    try {
      let raw = await s.sock.requestPairingCode(phone);
      const code8 = raw.replace(/\D/g, "").padEnd(8, "0").slice(0, 8);

      return res.json({
        ok: true,
        code: code8,
        message: "Enter this 8-digit code on your phone (Linked devices)"
      });
    } catch (e) {
      return res.json({ ok: false, message: e.message });
    }
  } else {
    return res.json({ ok: false, message: "Pairing code not supported by this Baileys version. Use QR login." });
  }
});

app.listen(PORT, () => console.log(`🚀 BAN-MD API running on port ${PORT}`));
