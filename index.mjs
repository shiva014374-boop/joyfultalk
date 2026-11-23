// Joyful Talk signaling server.
//
// This process never sees call content. Browsers exchange WebRTC offers,
// answers and ICE candidates through it, but every payload is sealed with
// AES-256-GCM using a room key that only lives in the invite link's #fragment
// (fragments are never sent to servers). The server only knows that two
// anonymous peer IDs share a room ID, and it forgets that when they leave.
//
// Room membership is kept in memory on purpose: it is ephemeral presence, not
// stored data. Clients rejoin automatically after any reconnect or cold start.

import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const MAX_PEERS = 2
const STALE_AFTER_MS = 45_000
const ROOM_RE = /^[a-z0-9-]{6,64}$/
const PEER_RE = /^[A-Za-z0-9_-]{8,40}$/
const MAX_SIGNAL_LENGTH = 48 * 1024
const RATE_WINDOW_MS = 10_000
const RATE_MAX_MESSAGES = 300

/** @type {Map<string, Map<string, { ws: import('ws').WebSocket, lastSeen: number }>>} */
const rooms = new Map()

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function broadcast(roomId, exceptPeerId, msg) {
  const room = rooms.get(roomId)
  if (!room) return
  for (const [peerId, entry] of room) {
    if (peerId !== exceptPeerId) send(entry.ws, msg)
  }
}

function removePeer(roomId, peerId, ws) {
  const room = rooms.get(roomId)
  if (!room) return
  const entry = room.get(peerId)
  // A reconnect may already have replaced this socket; only remove our own.
  if (!entry || (ws && entry.ws !== ws)) return
  room.delete(peerId)
  if (room.size === 0) rooms.delete(roomId)
  else broadcast(roomId, peerId, { type: 'peer-left', peerId })
}

// Drop peers whose sockets went silent (client pings every 20s). Runs on
// activity rather than a timer so the server can scale to zero when idle.
function pruneStale(roomId) {
  const room = rooms.get(roomId)
  if (!room) return
  const now = Date.now()
  for (const [peerId, entry] of room) {
    if (now - entry.lastSeen > STALE_AFTER_MS) {
      entry.ws.terminate()
      removePeer(roomId, peerId, entry.ws)
    }
  }
}

function iceServers() {
  const servers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ]
  // Optional relay for strict NATs / corporate networks. Configure with
  // TURN_URLS (comma separated), TURN_USERNAME and TURN_CREDENTIAL.
  if (process.env.TURN_URLS) {
    servers.push({
      urls: process.env.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    })
  }
  return servers
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')

  if (pathname === '/api/ice') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ iceServers: iceServers() }))
    return
  }

  if (pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 })

wss.on('connection', (ws) => {
  /** @type {{ roomId: string, peerId: string } | null} */
  let membership = null
  let windowStart = Date.now()
  let windowCount = 0

  ws.on('message', (raw) => {
    const now = Date.now()
    if (now - windowStart > RATE_WINDOW_MS) {
      windowStart = now
      windowCount = 0
    }
    if (++windowCount > RATE_MAX_MESSAGES) {
      send(ws, { type: 'error', message: 'Slow down' })
      return
    }

    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return

    if (membership) {
      const entry = rooms.get(membership.roomId)?.get(membership.peerId)
      if (entry && entry.ws === ws) entry.lastSeen = now
    }

    switch (msg.type) {
      case 'ping': {
        send(ws, { type: 'pong' })
        return
      }

      case 'join': {
        const { room: roomId, peerId } = msg
        if (typeof roomId !== 'string' || !ROOM_RE.test(roomId)) return send(ws, { type: 'error', message: 'Invalid room' })
        if (typeof peerId !== 'string' || !PEER_RE.test(peerId)) return send(ws, { type: 'error', message: 'Invalid peer' })
        if (membership) removePeer(membership.roomId, membership.peerId, ws)

        pruneStale(roomId)
        let room = rooms.get(roomId)
        if (!room) {
          room = new Map()
          rooms.set(roomId, room)
        }

        const existing = room.get(peerId)
        if (!existing && room.size >= MAX_PEERS) {
          if (room.size === 0) rooms.delete(roomId)
          return send(ws, { type: 'full' })
        }
        // Same peer reconnecting: retire the old socket quietly.
        if (existing && existing.ws !== ws) existing.ws.terminate()

        room.set(peerId, { ws, lastSeen: now })
        membership = { roomId, peerId }
        const peers = [...room.keys()].filter((id) => id !== peerId)
        send(ws, { type: 'joined', peerId, peers })
        broadcast(roomId, peerId, { type: 'peer-joined', peerId })
        return
      }

      case 'signal': {
        if (!membership) return
        const { to, data } = msg
        if (typeof to !== 'string' || typeof data !== 'string' || data.length > MAX_SIGNAL_LENGTH) return
        const target = rooms.get(membership.roomId)?.get(to)
        if (target) send(target.ws, { type: 'signal', from: membership.peerId, data })
        return
      }

      case 'leave': {
        if (membership) removePeer(membership.roomId, membership.peerId, ws)
        membership = null
        return
      }
    }
  })

  ws.on('close', () => {
    if (membership) removePeer(membership.roomId, membership.peerId, ws)
    membership = null
  })

  ws.on('error', () => {})
})

export const config = {
  path: ['/ws', '/api/*'],
}

export default server
