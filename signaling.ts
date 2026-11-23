// WebSocket signaling client with automatic reconnection and rejoin.

export type ServerMessage =
  | { type: 'joined'; peerId: string; peers: string[] }
  | { type: 'peer-joined'; peerId: string }
  | { type: 'peer-left'; peerId: string }
  | { type: 'signal'; from: string; data: string }
  | { type: 'full' }
  | { type: 'error'; message: string }
  | { type: 'pong' }

export type SignalingStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

interface Handlers {
  onMessage: (msg: ServerMessage) => void
  onStatus: (status: SignalingStatus) => void
}

export class SignalingClient {
  private ws: WebSocket | null = null
  private attempt = 0
  private stopped = false
  private pingTimer: number | undefined
  private retryTimer: number | undefined
  private roomId: string
  private peerId: string
  private handlers: Handlers
  private outbox: { to: string; data: string }[] = []

  constructor(roomId: string, peerId: string, handlers: Handlers) {
    this.roomId = roomId
    this.peerId = peerId
    this.handlers = handlers
  }

  connect() {
    this.stopped = false
    this.open()
  }

  private url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}/ws`
  }

  private open() {
    if (this.stopped) return
    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    const ws = new WebSocket(this.url())
    this.ws = ws

    ws.onopen = () => {
      this.attempt = 0
      this.handlers.onStatus('open')
      ws.send(JSON.stringify({ type: 'join', room: this.roomId, peerId: this.peerId }))
      for (const m of this.outbox.splice(0)) ws.send(JSON.stringify({ type: 'signal', ...m }))
      window.clearInterval(this.pingTimer)
      this.pingTimer = window.setInterval(() => this.raw({ type: 'ping' }), 20_000)
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage
        if (msg.type !== 'pong') this.handlers.onMessage(msg)
      } catch {
        /* ignore malformed frames */
      }
    }

    ws.onclose = () => {
      window.clearInterval(this.pingTimer)
      if (this.ws !== ws) return
      this.ws = null
      if (this.stopped) {
        this.handlers.onStatus('closed')
        return
      }
      this.scheduleReconnect()
    }

    ws.onerror = () => ws.close()
  }

  private scheduleReconnect() {
    this.attempt++
    const base = Math.min(10_000, 500 * 2 ** Math.min(this.attempt, 5))
    const delay = base / 2 + Math.random() * (base / 2)
    this.handlers.onStatus('reconnecting')
    window.clearTimeout(this.retryTimer)
    this.retryTimer = window.setTimeout(() => this.open(), delay)
  }

  private raw(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
      return true
    }
    return false
  }

  /** Sends a sealed signal; queues briefly while reconnecting. */
  sendSignal(to: string, data: string) {
    if (this.raw({ type: 'signal', to, data })) return
    this.outbox.push({ to, data })
    if (this.outbox.length > 64) this.outbox.shift()
  }

  close() {
    this.stopped = true
    window.clearInterval(this.pingTimer)
    window.clearTimeout(this.retryTimer)
    this.raw({ type: 'leave' })
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.handlers.onStatus('closed')
  }
}
