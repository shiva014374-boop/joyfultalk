# AGENTS.md: Joyful Talk

1:1 private video/voice calls with chat and tic-tac-toe. Vite + React SPA plus a Netlify Server for WebRTC signaling. Nothing is persisted: there is no database, and that is deliberate.

## Layout

```
index.html                 SPA shell (fonts, meta)
netlify.toml               build → dist; SPA rewrite ONLY for /room/*
netlify/server/index.mjs   Netlify Server: ws signaling (/ws), /api/ice, /api/health
src/
  main.tsx, App.tsx        entry + path router ("/" landing, "/room/:id" room)
  styles.css               the whole design system (CSS variables at top)
  lib/
    crypto.ts              room secret/ids, HKDF → AES-GCM seal/open, safety code
    signaling.ts           reconnecting WebSocket client (backoff, rejoin, outbox)
    call.ts                CallEngine: peer connection, data channel, chat, game, media; useCall()
    game.ts                pure tic-tac-toe rules
    rooms.ts               invite link helpers, saved display name
    router.ts              navigate() + usePathname()
    useAudioLevel.ts       speaking rings via AnalyserNode → CSS var --level
  components/              Lobby, ChatPanel, GamePanel, Media (video/audio/avatar), Logo, Marks
  pages/                   Landing.tsx, Room.tsx (call screen, safety dialog, ended/full/missing-key)
```

## Important decisions

- **Netlify Server, not a framework template.** WebSockets need it. Don't add a catch-all `/*` rewrite to `netlify.toml`, because it would shadow the server. The server claims only `/ws` and `/api/*` through `export const config`.
- **The room secret never reaches the server.** It is in `location.hash`. Signaling payloads are sealed (`aad = sig:<roomId>`), and so are data-channel messages (`aad = dc:<roomId>`). The server relays opaque strings and enforces 2 peers per room, payload limits and rate limits.
- **In-memory presence is intentional.** It is ephemeral, and clients rejoin automatically after reconnects or cold starts. The server never starts timers; stale peers are pruned when there is activity.
- **Negotiation protocol** (`call.ts`):
  - The peer that receives `joined` with an existing peer sends the offer. The peer that receives `peer-joined` waits for it.
  - Each `RTCPeerConnection` has a random `pc` id inside every sealed signal. A new id always means a fresh connection; the same id means an in-place ICE restart.
  - If both sides send offers at once, the peer with the lower peer id gives way.
  - The offerer creates fixed audio and video transceivers. Camera and mic toggles use `replaceTrack`, so no renegotiation is needed after the first connect.
  - The data channel is `negotiated: true, id: 0` on both sides.
- **Game sync** is deterministic. Both peers apply the same moves, the offerer is X in round 0, and the starter alternates each round. Moves carry the round number; `round` messages only move forward.
- **No React StrictMode.** The engine owns real devices and sockets.

## Conventions

- TypeScript strict and functional components. State lives in `CallEngine` (immutable snapshot plus `useSyncExternalStore`), not in scattered component state.
- Styling uses plain CSS classes in `styles.css` with tokens `--ink-*`, `--apricot*`, `--sage*` and `--ember*`. Keep the warm dark palette.
- Product copy is concrete and calm, with no emoji in the UI.
- Don't run build or type-check commands in agent sessions; the deploy pipeline validates them.
