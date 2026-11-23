import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Check,
  Copy,
  Fingerprint,
  Grid3x3,
  LoaderCircle,
  LockKeyhole,
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  Share2,
  ShieldCheck,
  TriangleAlert,
  Users,
  Video,
  VideoOff,
  WifiOff,
  X,
} from 'lucide-react'
import { CallEngine, useCall, type CallSnapshot } from '../lib/call'
import { isValidSecret, toB64url } from '../lib/crypto'
import { turnOf } from '../lib/game'
import { navigate } from '../lib/router'
import { inviteUrl, newRoomPath, type CallMode } from '../lib/rooms'
import { Logo } from '../components/Logo'
import { Lobby } from '../components/Lobby'
import { Avatar, MediaVideo, RemoteAudio } from '../components/Media'
import { ChatPanel } from '../components/ChatPanel'
import { GamePanel } from '../components/GamePanel'

export function RoomPage({ roomId }: { roomId: string }) {
  const secret = location.hash.slice(1)
  const mode: CallMode = new URLSearchParams(location.search).get('mode') === 'audio' ? 'audio' : 'video'
  if (!isValidSecret(secret)) return <MissingKey />
  return <Room roomId={roomId} secret={secret} mode={mode} />
}

function useKeyCheck(secret: string) {
  const [check, setCheck] = useState('')
  useEffect(() => {
    crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(`joyful-talk-check|${secret}`))
      .then((d) => {
        const hex = [...new Uint8Array(d).slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
        setCheck(`${hex.slice(0, 4)} ${hex.slice(4)}`)
      })
      .catch(() => setCheck(toB64url(new TextEncoder().encode(secret)).slice(0, 8)))
  }, [secret])
  return check
}

function Room({ roomId, secret, mode }: { roomId: string; secret: string; mode: CallMode }) {
  const engine = useMemo(() => new CallEngine(roomId, secret), [roomId, secret])
  const state = useCall(engine)
  const [joined, setJoined] = useState(false)
  const keyCheck = useKeyCheck(secret)

  useEffect(() => () => engine.destroy(), [engine])

  useEffect(() => {
    const who = state.remote?.name
    document.title = state.phase === 'connected' && who ? `With ${who} · Joyful Talk` : `Room ${roomId} · Joyful Talk`
  }, [state.phase, state.remote?.name, roomId])

  if (state.phase === 'full') return <RoomFull />
  if (state.phase === 'ended') return <Ended state={state} />

  return (
    <div className="room-shell">
      <div className="grain" aria-hidden="true" />
      {!joined ? (
        <>
          <header className="topbar">
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault()
                navigate('/')
              }}
            >
              <Logo />
            </a>
            <span className="seal-badge pending">
              <LockKeyhole size={13} /> Key held on this device
            </span>
          </header>
          <Lobby
            roomId={roomId}
            mode={mode}
            keyCheck={keyCheck}
            onJoin={(opts) => {
              setJoined(true)
              void engine.start(opts)
            }}
          />
        </>
      ) : (
        <CallScreen engine={engine} state={state} roomId={roomId} link={inviteUrl(roomId, secret, mode)} />
      )}
    </div>
  )
}

function useElapsed(since: number | null) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!since) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [since])
  return since ? formatDuration(now - since) : null
}

function formatDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

function useCopy() {
  const [copied, setCopied] = useState(false)
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  return { copied, copy }
}

type Panel = 'chat' | 'game' | null

function CallScreen({ engine, state, roomId, link }: { engine: CallEngine; state: CallSnapshot; roomId: string; link: string }) {
  const [panel, setPanel] = useState<Panel>(() => (window.innerWidth > 1080 ? 'chat' : null))
  const [safetyOpen, setSafetyOpen] = useState(false)
  const elapsed = useElapsed(state.connectedAt)
  const { copied, copy } = useCopy()

  const remote = state.remote
  const connected = state.phase === 'connected'
  const waiting = state.phase === 'waiting' || state.phase === 'idle'
  const remoteHasVideo = !!remote?.camOn && !!state.remoteStream?.getVideoTracks().length
  const myTurn = state.channelOpen && !state.game.winner && turnOf(state.game.board) === state.mySymbol

  const togglePanel = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSafetyOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`call ${panel ? 'with-panel' : ''}`}>
      <header className="call-top">
        <Logo size={26} />
        <span className="room-chip mono">{roomId}</span>
        <span className={`seal-badge ${connected && state.channelOpen ? 'sealed' : 'pending'}`}>
          {connected && state.channelOpen ? <ShieldCheck size={14} /> : <LockKeyhole size={13} />}
          {connected && state.channelOpen ? 'Sealed end to end' : 'Sealing on your device'}
        </span>
        <div className="call-top-right">
          {elapsed && <span className="timer mono">{elapsed}</span>}
          <button className="chip-btn" onClick={() => setSafetyOpen(true)} disabled={!state.safetyCode}>
            <Fingerprint size={15} /> <span className="hide-sm">Safety code</span>
          </button>
          <button className="chip-btn" onClick={() => copy(link)}>
            {copied ? <Check size={15} /> : <Copy size={15} />} <span className="hide-sm">{copied ? 'Copied' : 'Invite link'}</span>
          </button>
        </div>
      </header>

      <div className="banners">
        {state.keyMismatch && (
          <p className="banner danger">
            <TriangleAlert size={15} /> Someone joined with a different key, so their messages can’t be unsealed. Ask them
            to open the full link, including everything after #.
          </p>
        )}
        {state.mediaError && (
          <p className="banner">
            <TriangleAlert size={15} /> {state.mediaError}
            <button className="banner-x" onClick={() => engine.dismissMediaError()} aria-label="Dismiss">
              <X size={14} />
            </button>
          </p>
        )}
        {state.signaling === 'reconnecting' && !connected && (
          <p className="banner">
            <WifiOff size={15} /> Reconnecting to the relay…
          </p>
        )}
      </div>

      <main className="call-body">
        <section className="stage">
          <RemoteAudio stream={state.remoteStream} />
          {waiting ? (
            <WaitingCard link={link} copied={copied} onCopy={() => copy(link)} />
          ) : (
            <div className={`remote-tile ${remoteHasVideo ? 'has-video' : ''}`}>
              {remoteHasVideo ? (
                <MediaVideo stream={state.remoteStream} className="remote-video" />
              ) : (
                <div className="remote-avatar">
                  <Avatar name={remote?.name ?? '…'} stream={state.remoteStream} micOn={remote?.micOn ?? true} />
                  {remote && !remote.camOn && <span className="remote-caption">Camera off</span>}
                </div>
              )}
              {(state.phase === 'connecting' || state.phase === 'reconnecting' || !remote) && (
                <div className="stage-overlay">
                  <LoaderCircle className="spin" size={22} />
                  <span>{state.phase === 'reconnecting' ? 'Connection dipped, reconnecting…' : 'Opening a direct, sealed line…'}</span>
                </div>
              )}
              {remote && (
                <span className="tile-tag">
                  {remote.micOn ? <Mic size={13} /> : <MicOff size={13} className="red" />} {remote.name}
                </span>
              )}
            </div>
          )}

          <div className="self-tile">
            {state.camOn && state.localStream?.getVideoTracks().length ? (
              <MediaVideo stream={state.localStream} mirrored className="self-video" />
            ) : (
              <Avatar name={state.name} stream={state.localStream} micOn={state.micOn} size="sm" />
            )}
            <span className="tile-tag small">You</span>
          </div>
        </section>

        {panel && (
          <aside className="side" aria-label={panel === 'chat' ? 'Chat' : 'Tic-tac-toe'}>
            <div className="side-head">
              <div className="tabs" role="tablist">
                <button role="tab" aria-selected={panel === 'chat'} className={`tab ${panel === 'chat' ? 'active' : ''}`} onClick={() => setPanel('chat')}>
                  <MessageSquare size={15} /> Chat
                </button>
                <button role="tab" aria-selected={panel === 'game'} className={`tab ${panel === 'game' ? 'active' : ''}`} onClick={() => setPanel('game')}>
                  <Grid3x3 size={15} /> Tic-tac-toe
                  {panel !== 'game' && myTurn && <span className="dot-badge" />}
                </button>
              </div>
              <button className="icon-btn" onClick={() => setPanel(null)} aria-label="Close panel">
                <X size={18} />
              </button>
            </div>
            <div className="side-body">
              {panel === 'chat' ? <ChatPanel engine={engine} state={state} /> : <GamePanel engine={engine} state={state} />}
            </div>
          </aside>
        )}
      </main>

      <footer className="dock">
        <button className={`round-btn ${state.micOn ? '' : 'off'}`} onClick={() => engine.toggleMic()} aria-pressed={!state.micOn} aria-label={state.micOn ? 'Mute' : 'Unmute'}>
          {state.micOn ? <Mic size={20} /> : <MicOff size={20} />}
          <span className="dock-label">{state.micOn ? 'Mute' : 'Unmute'}</span>
        </button>
        <button className={`round-btn ${state.camOn ? '' : 'off'}`} onClick={() => engine.toggleCam()} aria-pressed={!state.camOn} aria-label={state.camOn ? 'Stop video' : 'Start video'}>
          {state.camOn ? <Video size={20} /> : <VideoOff size={20} />}
          <span className="dock-label">{state.camOn ? 'Stop video' : 'Start video'}</span>
        </button>
        <span className="dock-sep" />
        <button className={`round-btn ${panel === 'chat' ? 'active' : ''}`} onClick={() => togglePanel('chat')} aria-label="Chat">
          <MessageSquare size={20} />
          {panel !== 'chat' && state.unread > 0 && <span className="count-badge">{state.unread > 9 ? '9+' : state.unread}</span>}
          <span className="dock-label">Chat</span>
        </button>
        <button className={`round-btn ${panel === 'game' ? 'active' : ''}`} onClick={() => togglePanel('game')} aria-label="Tic-tac-toe">
          <Grid3x3 size={20} />
          {panel !== 'game' && myTurn && <span className="dot-badge" />}
          <span className="dock-label">Play</span>
        </button>
        <span className="dock-sep" />
        <button className="round-btn hangup" onClick={() => engine.hangup()} aria-label="Leave call">
          <PhoneOff size={20} />
          <span className="dock-label">Leave</span>
        </button>
      </footer>

      {safetyOpen && state.safetyCode && (
        <SafetyDialog code={state.safetyCode} friend={remote?.name ?? 'your friend'} onClose={() => setSafetyOpen(false)} />
      )}
    </div>
  )
}

function WaitingCard({ link, copied, onCopy }: { link: string; copied: boolean; onCopy: () => void }) {
  const [base, key] = link.split('#')
  const canShare = typeof navigator.share === 'function'
  return (
    <div className="waiting">
      <div className="waiting-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
        <Users size={26} />
      </div>
      <h2>
        Your room is ready. <em>Invite one person.</em>
      </h2>
      <p>Send them this link. The highlighted part is the key; it stays in the link and never touches our server.</p>
      <div className="invite-link mono">
        <span className="invite-base">{base}#</span>
        <span className="invite-key">{key}</span>
      </div>
      <div className="waiting-actions">
        <button className="btn btn-primary" onClick={onCopy}>
          {copied ? <Check size={17} /> : <Copy size={17} />} {copied ? 'Copied to clipboard' : 'Copy invite link'}
        </button>
        {canShare && (
          <button className="btn btn-ghost" onClick={() => navigator.share({ title: 'Join me on Joyful Talk', url: link }).catch(() => {})}>
            <Share2 size={17} /> Share
          </button>
        )}
      </div>
    </div>
  )
}

function SafetyDialog({ code, friend, onClose }: { code: string; friend: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="safety-title" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn modal-x" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <Fingerprint size={28} className="modal-icon" />
        <h2 id="safety-title">Compare safety codes</h2>
        <p>Read these digits to {friend} out loud. If their screen shows the same twenty, your browsers are talking directly and nobody is in the middle.</p>
        <div className="safety-code mono">
          {code.split(' ').map((g, i) => (
            <span key={i}>{g}</span>
          ))}
        </div>
        <p className="modal-fine">The code comes from both connections’ DTLS certificate fingerprints. It changes every call.</p>
      </div>
    </div>
  )
}

function Notice({ icon, title, children }: { icon: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <div className="room-shell">
      <div className="grain" aria-hidden="true" />
      <header className="topbar">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault()
            navigate('/')
          }}
        >
          <Logo />
        </a>
      </header>
      <main className="notice">
        <div className="notice-icon">{icon}</div>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  )
}

function Ended({ state }: { state: CallSnapshot }) {
  return (
    <Notice icon={<PhoneOff size={26} />} title={<>Call ended.</>}>
      <p className="notice-lede">
        {state.endedAfterMs ? (
          <>
            You talked for <strong className="mono">{formatDuration(state.endedAfterMs)}</strong>.{' '}
          </>
        ) : null}
        Nothing from this room was saved: no messages, no recordings, no history.
      </p>
      <div className="notice-actions">
        <button className="btn btn-primary" onClick={() => location.reload()}>
          Rejoin this room
        </button>
        <button className="btn btn-ghost" onClick={() => navigate(newRoomPath('video'))}>
          Start a new call
        </button>
      </div>
    </Notice>
  )
}

function RoomFull() {
  return (
    <Notice icon={<Users size={26} />} title="This room already has two people.">
      <p className="notice-lede">Joyful Talk rooms are for two. If you were in this call and reloaded, wait a few seconds and try again.</p>
      <div className="notice-actions">
        <button className="btn btn-primary" onClick={() => location.reload()}>
          Try again
        </button>
        <button className="btn btn-ghost" onClick={() => navigate('/')}>
          Back home
        </button>
      </div>
    </Notice>
  )
}

function MissingKey() {
  return (
    <Notice icon={<LockKeyhole size={26} />} title="This link is missing its key.">
      <p className="notice-lede">
        Room links carry their key after the <code>#</code>. Some apps cut that part off. Ask your friend to send the full
        link again, or start a fresh room.
      </p>
      <div className="notice-actions">
        <button className="btn btn-primary" onClick={() => navigate(newRoomPath('video'))}>
          Start a new call
        </button>
        <button className="btn btn-ghost" onClick={() => navigate('/')}>
          Back home
        </button>
      </div>
    </Notice>
  )
}
