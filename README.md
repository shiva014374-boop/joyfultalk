# Joyful Talk

A private room for two people: video call, voice call, chat and a live game of tic-tac-toe, in a warm dark interface. No accounts and no history.

## How privacy works

- **The key lives in the link.** Starting a room generates a 256-bit secret in the browser. It sits in the invite link after `#`, and browsers never send that part to servers.
- **The relay only sees ciphertext.** Browsers find each other through a small WebSocket signaling server. Every offer, answer and ICE candidate is sealed with AES-256-GCM (key derived with HKDF from the room secret) before it leaves the device.
- **Media is peer to peer.** Audio and video flow directly between browsers over WebRTC (DTLS-SRTP). Chat messages and game moves use a WebRTC data channel and get an extra AES-256-GCM layer with the room key.
- **Safety code.** Each call shows twenty digits derived from both sides' DTLS certificate fingerprints. If both people see the same digits, nobody is in the middle.
- **Nothing is stored.** The server keeps room membership in memory only while people are connected. Chat history exists only in the open tabs.

Anyone with the full link can join, and a room holds two people.

## Tech

- **Frontend:** React 19 + TypeScript, built with Vite, with plain CSS (`src/styles.css`). Fonts are Fraunces, Schibsted Grotesk and JetBrains Mono. Icons come from lucide-react.
- **Realtime:** WebRTC (`RTCPeerConnection`, negotiated data channel) and Web Crypto (HKDF, AES-GCM, SHA-256).
- **Backend:** a Netlify Server (`netlify/server/index.mjs`) using Node's `http` and `ws` for signaling on `/ws`, plus `/api/ice` and `/api/health`.

## Run locally

```bash
npm install
npm run dev        # netlify dev on http://localhost:8889
```

Open `http://localhost:8889`, start a call, and open the invite link in a second browser window or on another device. Camera, microphone and Web Crypto only work on `https://` or `localhost`.

## Configuration (optional)

Calls use public STUN servers by default. Very strict networks, such as some corporate and mobile carriers, need a TURN relay. Set these environment variables to add one; it still can't read the encrypted media:

| Variable | Example |
| --- | --- |
| `TURN_URLS` | `turn:turn.example.com:3478,turns:turn.example.com:5349` |
| `TURN_USERNAME` | relay username |
| `TURN_CREDENTIAL` | relay password |

## Ideas for later

- Screen sharing (one more transceiver plus a dock button)
- Group rooms (mesh for 3–4 people, or an SFU beyond that)
- More games over the same sealed channel
