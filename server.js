import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // serve frontend

// simple session registry
const sessions = new Map(); // sessionId -> sock

async function createSession(sessionId = "session1") {
  if (sessions.get(sessionId)) return sessions.get(sessionId);

  const authDir = path.join(__dirname, "sessions", sessionId);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    browser: ["BAN-MD", "Chrome", "20.0"]
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === "close") {
      console.log("❌ connection closed", lastDisconnect?.error?.message);
      sessions.delete(sessionId);
    }
    if (connection === "open") {
      console.log("✅ connected:", sessionId);
    }
  });

  sessions.set(sessionId, sock);
  return sock;
}

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Get QR image (Data URL) for a session
app.get("/api/qr/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const sock = await createSession(sessionId);

  let responded = false;
  const handler = async (u) => {
    if (u.qr && !responded) {
      responded = true;
      try {
        const png = await QRCode.toDataURL(u.qr);
        res.json({ ok: true, qr: png });
      } catch (e) {
        res.status(500).json({ ok: false, error: "Failed to encode QR" });
      } finally {
        sock.ev.off("connection.update", handler);
      }
    }
    if (u.connection === "open" && !responded) {
      responded = true;
      res.json({ ok: true, connected: true });
      sock.ev.off("connection.update", handler);
    }
  };
  sock.ev.on("connection.update", handler);

  setTimeout(() => {
    if (!responded) {
      responded = true;
      res.status(504).json({ ok: false, error: "QR timeout" });
      sock.ev.off("connection.update", handler);
    }
  }, 10000);
});

// Get Pairing Code for a phone number (E.164, e.g., 2567xxxxxxx)
app.get("/api/pair/:sessionId/:phone", async (req, res) => {
  const { sessionId, phone } = req.params;
  try {
    const sock = await createSession(sessionId);
    const code = await sock.requestPairingCode(phone);
    res.json({ ok: true, code });
  } catch (e) {
    console.error("pair error", e?.message);
    res.status(500).json({ ok: false, error: "Failed to get pairing code" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 BAN-MD server running on http://localhost:${PORT}`));
