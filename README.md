# BAN-MD API

This is a WhatsApp Multi-Device bot backend using Baileys.

## Features
- QR login
- 8-digit numeric pairing codes
- Multi-session support

## Deploy
- Heroku: push & deploy (Procfile included)
- Render: set start command `npm start`

API Endpoints:
- `/` → API status
- `/status?session=ban-session1`
- `/qr?session=ban-session1`
- `/pair?session=ban-session1&phone=+256700000000`
