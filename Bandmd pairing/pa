// pair.js - All-in-one BAN-MD Mini Pairing Website

const express = require("express");
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json());

// --- Baileys Setup ---
let sock;
async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState(path.resolve(__dirname, "auth_info"));

  sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    browser: ["BAN-MD Mini", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startSock();
    } else if (connection === "open") {
      console.log("✅ Connected to WhatsApp");
    }
  });
}
startSock();

// --- API Endpoint to get Pair Code ---
app.post("/api/get-code", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number required" });

    if (!sock) return res.status(500).json({ error: "Socket not ready. Try again." });

    const code = await sock.requestPairingCode(phone);
    console.log("📲 Pair code generated for", phone, ":", code);
    res.json({ code });
  } catch (err) {
    console.error("Error generating code:", err);
    res.status(500).json({ error: "Failed to generate code" });
  }
});

// --- Serve Green HTML Page ---
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BAN-MD Mini — Pair Code</title>
  <style>
    body{font-family:sans-serif;background:#e9f5ea;display:grid;place-items:center;height:100vh;margin:0}
    .card{background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.1);padding:24px;width:100%;max-width:420px}
    h1{margin-top:0;color:#0b2b12}
    label{display:block;margin:12px 0 6px;font-weight:600}
    input{width:100%;padding:12px;border:1px solid #cce3d1;border-radius:10px}
    .row{display:flex;align-items:center;gap:8px;margin:12px 0}
    .btn{width:100%;padding:14px;border:0;border-radius:10px;background:#16a34a;color:#fff;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6;cursor:not-allowed}
    .status{margin-top:12px;font-size:14px;display:none;padding:10px;border-radius:8px}
    .status.show{display:block}
    .status.error{background:#fee2e2;color:#b91c1c}
    .status.ok{background:#dcfce7;color:#065f46}
    .countdown{margin-top:8px;font-size:14px;color:#065f46;font-weight:600;display:none}
  </style>
</head>
<body>
  <div class="card">
    <h1>Pair Your WhatsApp</h1>
    <form id="pairForm">
      <label for="phone">Phone number</label>
      <input id="phone" type="tel" placeholder="+256712345678" required>
      <div class="row">
        <input id="agree" type="checkbox" required>
        <label for="agree" style="font-weight:400;margin:0">I agree to Terms</label>
      </div>
      <button id="submitBtn" class="btn" type="submit">Get Code</button>
    </form>

    <div id="status" class="status"></div>
    <div id="countdown" class="countdown"></div>
  </div>

  <script>
    const pairForm = document.getElementById("pairForm");
    const statusBox = document.getElementById("status");
    const countdownBox = document.getElementById("countdown");
    let expiryTime = null;
    let timerInterval = null;

    function showStatus(msg, ok=true){
      statusBox.textContent = msg;
      statusBox.className = "status show " + (ok ? "ok":"error");
    }

    function startCountdown(){
      clearInterval(timerInterval);
      countdownBox.style.display = "block";
      expiryTime = Date.now() + 10*60*1000; // 10 min
      timerInterval = setInterval(()=>{
        const remaining = expiryTime - Date.now();
        if(remaining <= 0){
          clearInterval(timerInterval);
          countdownBox.textContent = "⏰ Code expired, request again.";
          return;
        }
        const mins = Math.floor(remaining/60000);
        const secs = Math.floor((remaining%60000)/1000);
        countdownBox.textContent = \`Expires in \${mins}:\${secs.toString().padStart(2,"0")}\`;
      },1000);
    }

    pairForm.addEventListener("submit", async e=>{
      e.preventDefault();
      const phone = document.getElementById("phone").value.trim();
      const agree = document.getElementById("agree").checked;
      if(!/^\\+[1-9]\\d{7,14}$/.test(phone)){
        showStatus("Invalid phone format (use +256...)", false);
        return;
      }
      if(!agree){
        showStatus("You must agree to Terms", false);
        return;
      }

      try {
        const res = await fetch("/api/get-code", {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ phone })
        });
        const data = await res.json();
        if(res.ok){
          showStatus(\`📲 Your official BAN-MD code is: \${data.code}\`, true);
          startCountdown();
        } else {
          showStatus(data.error || "Error requesting code", false);
        }
      } catch(err){
        showStatus("❌ Backend not reachable. Try again.", false);
      }
    });
  </script>
</body>
</html>
  `);
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 BAN-MD Mini Pairing running on port ${PORT}`));
