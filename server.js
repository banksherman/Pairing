import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import { customAlphabet } from 'nanoid';

const app = express();
app.use(cors());
app.use(express.json());

// Simple in-memory store for pair codes
const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);
const store = new Map(); // code -> { createdAt, expiresAt }

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function newCode() {
  const code = nanoid();
  const now = Date.now();
  store.set(code, { createdAt: now, expiresAt: now + CODE_TTL_MS });
  return { code, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + CODE_TTL_MS).toISOString() };
}

function isValid(code) {
  const rec = store.get(code);
  if (!rec) return false;
  if (Date.now() > new Date(rec.expiresAt).getTime()) {
    store.delete(code);
    return false;
  }
  return true;
}

// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Create a new pair code
app.post('/api/pair/new', (req, res) => {
  const data = newCode();
  res.json({ ok: true, ...data });
});

// Validate a pair code
app.get('/api/pair/validate', (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ ok: false, error: 'Missing code' });
  res.json({ ok: true, code, valid: isValid(code) });
});

// Return a QR code PNG for a given code
app.get('/api/qr/:code.png', async (req, res) => {
  const { code } = req.params;
  if (!isValid(code)) return res.status(404).send('Invalid or expired code');
  const payload = `PAIR:${code}`;
  try {
    res.type('png');
    await QRCode.toFileStream(res, payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 420
    });
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to generate QR');
  }
});

// Static site
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`EDITH-MD server running on :${PORT}`);
});
