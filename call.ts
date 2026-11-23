// CallEngine: one 1:1 room. Owns the signaling socket, the RTCPeerConnection,
// the sealed data channel (chat, game, presence) and local media. React reads
// it through useCall() as an immutable snapshot.

import { useSyncExternalStore } from 'react'
import { deriveRoomKey, extractFingerprint, generatePeerId, open, safetyCode, seal } from './crypto'
import { SignalingClient, type ServerMessage, type SignalingStatus } from './signaling'
import { mySymbol, newGame, nextRound, placeMark, type GameState, type Mark } from './game'

export type Phase = 'idle' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'full'

export interface ChatMessage {
  id: string
  from: 'me' | 'them' | 'system'
  text: string
  ts: number
}

export interface RemoteInfo {
  name: string
  micOn: boolean
  camOn: boolean
}

export interface CallSnapshot {
  phase: Phase
  signaling: SignalingStatus
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  micOn: boolean
  camOn: boolean
  name: string
  remote: RemoteInfo | null
  channelOpen: boolean
  safetyCode: string | null
  messages: ChatMessage[]
  unread: number
  remoteTyping: boolean
  game: GameState
  mySymbol: Mark
  connectedAt: number | null
  keyMismatch: boolean
  mediaError: string | null
  endedAfterMs: number | null
}

type DataMessage =
  | { t: 'hello'; name: string; mic: boolean; cam: boolean }
  | { t: 'media'; mic: boolean; cam: boolean }
  | { t: 'chat'; id: string; text: string; ts: number }
  | { t: 'typing' }
  | { t: 'move'; i: number; round: number }
  | { t: 'round'; round: number }
  | { t: 'bye' }

// `pc` identifies the sender's RTCPeerConnection. A new id means a brand new
// connection (after a reload or a lost network), never a renegotiation.
type SignalPayload =
  | { kind: 'offer'; sdp: string; pc: string }
  | { kind: 'answer'; sdp: string; pc: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit; pc: string }

export interface StartOptions {
  name: string
  stream: MediaStream | null
  micOn: boolean
  camOn: boolean
}

const DEFAULT_ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]
const MAX_CHAT_LENGTH = 2000
const RECONNECT_GIVE_UP_MS = 30_000

export const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  facingMode: 'user',
}

export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

let msgCounter = 0
const uid = () => `${Date.now().toString(36)}-${(msgCounter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export class CallEngine {
  readonly roomId: string
  readonly peerId = generatePeerId()
  private readonly secret: string

  private key: CryptoKey | null = null
  private signaling: SignalingClient | null = null
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private remotePeerId: string | null = null
  private remotePresent = false
  private isOfferer = false
  private tracksAttached = false
  private audioSender: RTCRtpSender | null = null
  private videoSender: RTCRtpSender | null = null
  private localPcId: string | null = null
  private remotePcId: string | null = null
  private pendingIce: { pc: string; candidate: RTCIceCandidateInit }[] = []
  private iceServers: RTCIceServer[] = DEFAULT_ICE
  private sealedBye: string | null = null
  private disconnectTimer: number | undefined
  private giveUpTimer: number | undefined
  private typingTimer: number | undefined
  private lastTypingSent = 0
  private callStartedAt: number | null = null
  private inQueue: Promise<void> = Promise.resolve()
  private outQueue: Promise<void> = Promise.resolve()
  private dcInQueue: Promise<void> = Promise.resolve()
  private dcOutQueue: Promise<void> = Promise.resolve()
  private destroyed = false
  private listeners = new Set<() => void>()

  state: CallSnapshot = {
    phase: 'idle',
    signaling: 'closed',
    localStream: null,
    remoteStream: null,
    micOn: true,
    camOn: true,
    name: '',
    remote: null,
    channelOpen: false,
    safetyCode: null,
    messages: [],
    unread: 0,
    remoteTyping: false,
    game: newGame(),
    mySymbol: 'X',
    connectedAt: null,
    keyMismatch: false,
    mediaError: null,
    endedAfterMs: null,
  }

  constructor(roomId: string, secret: string) {
    this.roomId = roomId
    this.secret = secret
  }

  // ---------------------------------------------------------------- store

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = () => this.state

  private set(patch: Partial<CallSnapshot>) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  private system(text: string) {
    this.set({ messages: [...this.state.messages, { id: uid(), from: 'system', text, ts: Date.now() }] })
  }

  // ---------------------------------------------------------------- lifecycle

  async start(opts: StartOptions) {
    const stream = opts.stream ?? new MediaStream()
    for (const t of stream.getAudioTracks()) t.enabled = opts.micOn
    if (!opts.camOn) {
      for (const t of stream.getVideoTracks()) {
        t.stop()
        stream.removeTrack(t)
      }
    }
    this.set({
      phase: 'waiting',
      name: opts.name,
      localStream: stream,
      micOn: opts.micOn && stream.getAudioTracks().length > 0,
      camOn: opts.camOn && stream.getVideoTracks().length > 0,
    })

    this.key = await deriveRoomKey(this.secret, this.roomId)
    await Promise.race([
      fetch('/api/ice')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (Array.isArray(j?.iceServers) && j.iceServers.length) this.iceServers = j.iceServers
        })
        .catch(() => {}),
      new Promise((r) => setTimeout(r, 2500)),
    ])
    if (this.destroyed) return

    this.signaling = new SignalingClient(this.roomId, this.peerId, {
      onMessage: (m) => this.onServer(m),
      onStatus: (s) => this.set({ signaling: s }),
    })
    this.signaling.connect()
    window.addEventListener('beforeunload', this.onUnload)
  }

  private onUnload = () => {
    if (this.dc?.readyState === 'open' && this.sealedBye) {
      try {
        this.dc.send(this.sealedBye)
      } catch {
        /* closing anyway */
      }
    }
  }

  async hangup() {
    const startedAt = this.callStartedAt
    if (this.dc?.readyState === 'open' && this.sealedBye) {
      try {
        this.dc.send(this.sealedBye)
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    this.teardown()
    this.set({ phase: 'ended', endedAfterMs: startedAt ? Date.now() - startedAt : null })
  }

  destroy() {
    this.teardown()
  }

  private teardown() {
    this.destroyed = true
    window.removeEventListener('beforeunload', this.onUnload)
    this.resetPeer()
    this.signaling?.close()
    this.signaling = null
    for (const t of this.state.localStream?.getTracks() ?? []) t.stop()
    window.clearTimeout(this.typingTimer)
    this.set({ localStream: null })
  }

  // ---------------------------------------------------------------- signaling

  private pcAlive() {
    return !!this.pc && this.pc.connectionState !== 'failed' && this.pc.connectionState !== 'closed'
  }

  private onServer(msg: ServerMessage) {
    switch (msg.type) {
      case 'joined': {
        const other = msg.peers[0]
        if (!other) {
          this.remotePresent = false
          if (!this.pcAlive()) this.set({ phase: 'waiting' })
          return
        }
        this.remotePresent = true
        if (other === this.remotePeerId && this.pc?.connectionState === 'connected') return
        // We arrived (or came back) second, so we open a fresh connection.
        this.resetPeer()
        this.remotePeerId = other
        this.set({ phase: 'connecting' })
        this.createPeer(true)
        void this.makeOffer()
        return
      }
      case 'peer-joined': {
        this.remotePresent = true
        if (msg.peerId === this.remotePeerId && this.pc?.connectionState === 'connected') return
        // The newcomer sends the offer; get ready to answer it.
        this.resetPeer()
        this.remotePeerId = msg.peerId
        this.set({ phase: 'connecting' })
        return
      }
      case 'peer-left': {
        if (msg.peerId !== this.remotePeerId) return
        this.remotePresent = false
        // A live peer connection outlives a blip in the relay; only fall back
        // to waiting if media isn't flowing.
        if (this.pc?.connectionState !== 'connected') {
          const name = this.state.remote?.name
          this.resetPeer()
          this.remotePeerId = null
          this.set({ phase: 'waiting' })
          if (name) this.system(`${name} left the room`)
        }
        return
      }
      case 'signal': {
        this.inQueue = this.inQueue.then(() => this.onSignal(msg.from, msg.data)).catch((e) => console.warn('signal', e))
        return
      }
      case 'full': {
        this.teardown()
        this.set({ phase: 'full' })
        return
      }
      case 'error':
        console.warn('relay:', msg.message)
    }
  }

  private sendSignal(body: Omit<SignalPayload, 'pc'>) {
    const to = this.remotePeerId
    const key = this.key
    if (!to || !key || !this.localPcId) return
    const payload = { ...body, pc: this.localPcId }
    this.outQueue = this.outQueue
      .then(async () => {
        const data = await seal(key, payload, `sig:${this.roomId}`)
        this.signaling?.sendSignal(to, data)
      })
      .catch((e) => console.warn('send signal', e))
  }

  private async onSignal(from: string, data: string) {
    if (!this.key) return
    let payload: SignalPayload
    try {
      payload = await open<SignalPayload>(this.key, data, `sig:${this.roomId}`)
    } catch {
      this.set({ keyMismatch: true })
      return
    }
    if (this.state.keyMismatch) this.set({ keyMismatch: false })
    this.remotePresent = true

    if (from !== this.remotePeerId) {
      this.resetPeer()
      this.remotePeerId = from
    }

    if (payload.kind === 'offer') {
      const pcLive = this.pcAlive()
      if (this.pc && pcLive && this.remotePcId === payload.pc) {
        // ICE restart from the same connection: renegotiate in place.
      } else if (this.pc && pcLive && this.pc.signalingState === 'have-local-offer' && this.remotePcId === null) {
        // Glare (both offered at once): the peer with the lower id yields.
        if (this.peerId > from) return
        this.resetPeer(payload.pc)
      } else {
        this.resetPeer(payload.pc)
      }
      if (!this.pc) {
        this.createPeer(false)
        this.set({ phase: 'connecting' })
      }
      const pc = this.pc!
      this.remotePcId = payload.pc
      await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
      if (!this.tracksAttached) this.attachAnswererTransceivers(pc)
      const answer = await pc.createAnswer()
      if (this.pc !== pc) return
      await pc.setLocalDescription(answer)
      this.sendSignal({ kind: 'answer', sdp: pc.localDescription!.sdp })
      await this.flushIce()
      return
    }

    if (payload.kind === 'answer') {
      if (this.pc?.signalingState === 'have-local-offer' && (this.remotePcId === null || this.remotePcId === payload.pc)) {
        this.remotePcId = payload.pc
        await this.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
        await this.flushIce()
      }
      return
    }

    if (payload.kind === 'ice') {
      if (this.pc?.remoteDescription && this.remotePcId === payload.pc) {
        await this.pc.addIceCandidate(payload.candidate).catch(() => {})
      } else {
        this.pendingIce.push({ pc: payload.pc, candidate: payload.candidate })
        if (this.pendingIce.length > 100) this.pendingIce.shift()
      }
    }
  }

  private async flushIce() {
    const pc = this.pc
    if (!pc) return
    const ready = this.pendingIce.filter((c) => c.pc === this.remotePcId)
    this.pendingIce = []
    for (const c of ready) await pc.addIceCandidate(c.candidate).catch(() => {})
  }

  // ---------------------------------------------------------------- peer connection

  private createPeer(offerer: boolean) {
    this.isOfferer = offerer
    this.localPcId = generatePeerId()
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    this.pc = pc
    this.set({ remoteStream: new MediaStream(), mySymbol: mySymbol(0, offerer), game: newGame() })

    if (offerer) {
      // Fixed audio + video slots, so turning the camera on later is a
      // replaceTrack() instead of a renegotiation.
      this.audioSender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender
      this.videoSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender
      this.tracksAttached = true
      this.attachLocalTracks()
    }

    this.setupDataChannel(pc.createDataChannel('joyful', { negotiated: true, id: 0, ordered: true }))

    pc.onicecandidate = (e) => {
      if (this.pc === pc && e.candidate) this.sendSignal({ kind: 'ice', candidate: e.candidate.toJSON() })
    }

    pc.ontrack = (e) => {
      if (this.pc !== pc) return
      const tracks = (this.state.remoteStream?.getTracks() ?? []).filter((t) => t.kind !== e.track.kind)
      this.set({ remoteStream: new MediaStream([...tracks, e.track]) })
    }

    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return
      const s = pc.connectionState
      if (s === 'connected') {
        window.clearTimeout(this.disconnectTimer)
        window.clearTimeout(this.giveUpTimer)
        this.giveUpTimer = undefined
        this.callStartedAt ??= Date.now()
        this.set({ phase: 'connected', connectedAt: this.state.connectedAt ?? Date.now() })
        void this.computeSafetyCode(pc)
      } else if (s === 'disconnected' || s === 'failed') {
        this.set({ phase: 'reconnecting' })
        if (this.giveUpTimer === undefined) {
          this.giveUpTimer = window.setTimeout(() => this.giveUp(pc), RECONNECT_GIVE_UP_MS)
        }
        if (!this.remotePresent && this.state.signaling === 'open') {
          this.giveUp(pc)
          return
        }
        window.clearTimeout(this.disconnectTimer)
        this.disconnectTimer = window.setTimeout(() => this.restartIce(pc), s === 'failed' ? 0 : 4000)
      }
    }
  }

  private giveUp(pc: RTCPeerConnection) {
    if (this.pc !== pc || pc.connectionState === 'connected') return
    const name = this.state.remote?.name
    this.resetPeer()
    this.set({ phase: 'waiting' })
    this.system(name ? `Lost the connection to ${name}. They can rejoin with the same link.` : 'Connection lost.')
  }

  private restartIce(pc: RTCPeerConnection) {
    if (this.pc !== pc || pc.connectionState === 'connected') return
    if (this.isOfferer && pc.signalingState === 'stable') void this.makeOffer(true)
  }

  private async makeOffer(iceRestart = false) {
    const pc = this.pc
    if (!pc) return
    const offer = await pc.createOffer({ iceRestart })
    if (this.pc !== pc) return
    await pc.setLocalDescription(offer)
    this.sendSignal({ kind: 'offer', sdp: pc.localDescription!.sdp })
  }

  private attachAnswererTransceivers(pc: RTCPeerConnection) {
    for (const t of pc.getTransceivers()) {
      const kind = t.receiver.track.kind
      if (kind === 'audio' && !this.audioSender) {
        t.direction = 'sendrecv'
        this.audioSender = t.sender
      } else if (kind === 'video' && !this.videoSender) {
        t.direction = 'sendrecv'
        this.videoSender = t.sender
      }
    }
    this.tracksAttached = true
    this.attachLocalTracks()
  }

  private attachLocalTracks() {
    const s = this.state.localStream
    void this.audioSender?.replaceTrack(s?.getAudioTracks()[0] ?? null).catch(() => {})
    void this.videoSender?.replaceTrack(s?.getVideoTracks()[0] ?? null).catch(() => {})
  }

  private async computeSafetyCode(pc: RTCPeerConnection) {
    const a = extractFingerprint(pc.localDescription?.sdp)
    const b = extractFingerprint(pc.remoteDescription?.sdp)
    if (!a || !b) return
    const code = await safetyCode(a, b)
    if (this.pc === pc) this.set({ safetyCode: code })
  }

  /** Closes the current peer connection. `keepIceFor` preserves early ICE candidates of an incoming connection. */
  private resetPeer(keepIceFor?: string) {
    window.clearTimeout(this.disconnectTimer)
    window.clearTimeout(this.giveUpTimer)
    this.giveUpTimer = undefined
    this.dc?.close()
    this.pc?.close()
    this.dc = null
    this.pc = null
    this.audioSender = null
    this.videoSender = null
    this.tracksAttached = false
    this.pendingIce = keepIceFor ? this.pendingIce.filter((c) => c.pc === keepIceFor) : []
    this.localPcId = null
    this.remotePcId = null
    this.sealedBye = null
    this.set({
      remoteStream: null,
      remote: null,
      channelOpen: false,
      safetyCode: null,
      remoteTyping: false,
      connectedAt: null,
      game: newGame(),
    })
  }

  // ---------------------------------------------------------------- data channel

  private setupDataChannel(dc: RTCDataChannel) {
    this.dc = dc
    dc.onopen = async () => {
      if (this.dc !== dc || !this.key) return
      this.sealedBye = await seal(this.key, { t: 'bye' } satisfies DataMessage, `dc:${this.roomId}`)
      this.set({ channelOpen: true })
      this.sendData({ t: 'hello', name: this.state.name, mic: this.state.micOn, cam: this.state.camOn })
    }
    dc.onclose = () => {
      if (this.dc === dc) this.set({ channelOpen: false })
    }
    dc.onmessage = (e) => {
      if (this.dc !== dc) return
      this.dcInQueue = this.dcInQueue.then(() => this.onData(dc, String(e.data))).catch(() => {})
    }
  }

  private sendData(msg: DataMessage) {
    const dc = this.dc
    const key = this.key
    if (!dc || !key) return
    this.dcOutQueue = this.dcOutQueue
      .then(async () => {
        const sealed = await seal(key, msg, `dc:${this.roomId}`)
        if (dc.readyState === 'open') dc.send(sealed)
      })
      .catch(() => {})
  }

  private async onData(dc: RTCDataChannel, raw: string) {
    if (!this.key || this.dc !== dc) return
    let msg: DataMessage
    try {
      msg = await open<DataMessage>(this.key, raw, `dc:${this.roomId}`)
    } catch {
      return
    }

    switch (msg.t) {
      case 'hello': {
        const name = String(msg.name || 'Your friend').slice(0, 40)
        const first = !this.state.remote
        this.set({ remote: { name, micOn: !!msg.mic, camOn: !!msg.cam } })
        if (first) this.system(`${name} joined. Everything you send is sealed on your device.`)
        return
      }
      case 'media': {
        if (this.state.remote) this.set({ remote: { ...this.state.remote, micOn: !!msg.mic, camOn: !!msg.cam } })
        return
      }
      case 'chat': {
        const text = String(msg.text ?? '').slice(0, MAX_CHAT_LENGTH)
        if (!text.trim()) return
        window.clearTimeout(this.typingTimer)
        this.set({
          messages: [...this.state.messages, { id: String(msg.id), from: 'them', text, ts: Date.now() }],
          unread: this.state.unread + 1,
          remoteTyping: false,
        })
        return
      }
      case 'typing': {
        this.set({ remoteTyping: true })
        window.clearTimeout(this.typingTimer)
        this.typingTimer = window.setTimeout(() => this.set({ remoteTyping: false }), 3500)
        return
      }
      case 'move': {
        const g = this.state.game
        if (msg.round !== g.round) return
        const me = this.state.mySymbol
        const them: Mark = me === 'X' ? 'O' : 'X'
        const next = placeMark(g, msg.i, them, me)
        if (next) this.set({ game: next })
        return
      }
      case 'round': {
        if (typeof msg.round === 'number' && msg.round > this.state.game.round) {
          this.set({ game: nextRound(this.state.game, msg.round), mySymbol: mySymbol(msg.round, this.isOfferer) })
        }
        return
      }
      case 'bye': {
        const name = this.state.remote?.name ?? 'Your friend'
        this.resetPeer()
        this.remotePeerId = null
        this.set({ phase: 'waiting' })
        this.system(`${name} hung up`)
        return
      }
    }
  }

  // ---------------------------------------------------------------- user actions

  sendChat(text: string) {
    const clean = text.trim().slice(0, MAX_CHAT_LENGTH)
    if (!clean || !this.state.channelOpen) return false
    const msg: ChatMessage = { id: uid(), from: 'me', text: clean, ts: Date.now() }
    this.set({ messages: [...this.state.messages, msg] })
    this.sendData({ t: 'chat', id: msg.id, text: clean, ts: msg.ts })
    this.lastTypingSent = 0
    return true
  }

  notifyTyping() {
    const now = Date.now()
    if (!this.state.channelOpen || now - this.lastTypingSent < 2000) return
    this.lastTypingSent = now
    this.sendData({ t: 'typing' })
  }

  markChatRead() {
    if (this.state.unread) this.set({ unread: 0 })
  }

  playMove(index: number) {
    if (!this.state.channelOpen) return
    const g = this.state.game
    const me = this.state.mySymbol
    const next = placeMark(g, index, me, me)
    if (!next) return
    this.set({ game: next })
    this.sendData({ t: 'move', i: index, round: g.round })
  }

  newRound() {
    if (!this.state.channelOpen) return
    const round = this.state.game.round + 1
    this.set({ game: nextRound(this.state.game, round), mySymbol: mySymbol(round, this.isOfferer) })
    this.sendData({ t: 'round', round })
  }

  private announceMedia() {
    this.sendData({ t: 'media', mic: this.state.micOn, cam: this.state.camOn })
  }

  async toggleMic() {
    const stream = this.state.localStream
    if (!stream) return
    const track = stream.getAudioTracks()[0]
    if (track) {
      track.enabled = !track.enabled
      this.set({ micOn: track.enabled })
    } else {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS })
        const t = s.getAudioTracks()[0]
        const next = new MediaStream([...stream.getTracks(), t])
        this.set({ localStream: next, micOn: true, mediaError: null })
        await this.audioSender?.replaceTrack(t)
      } catch {
        this.set({ mediaError: 'Microphone is blocked. Allow it in your browser’s site settings.' })
        return
      }
    }
    this.announceMedia()
  }

  async toggleCam() {
    const stream = this.state.localStream
    if (!stream) return
    if (this.state.camOn) {
      const kept = stream.getTracks().filter((t) => t.kind !== 'video')
      for (const t of stream.getVideoTracks()) t.stop()
      await this.videoSender?.replaceTrack(null).catch(() => {})
      this.set({ localStream: new MediaStream(kept), camOn: false })
    } else {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS })
        const t = s.getVideoTracks()[0]
        if (this.destroyed) {
          t.stop()
          return
        }
        this.set({ localStream: new MediaStream([...stream.getTracks(), t]), camOn: true, mediaError: null })
        await this.videoSender?.replaceTrack(t).catch(() => {})
      } catch {
        this.set({ mediaError: 'Camera is blocked or in use by another app.' })
        return
      }
    }
    this.announceMedia()
  }

  dismissMediaError() {
    this.set({ mediaError: null })
  }
}

export function useCall(engine: CallEngine) {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot)
}
