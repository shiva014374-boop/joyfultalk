import { useEffect, useRef, useState } from 'react'
import { ArrowRight, LoaderCircle, LockKeyhole, Mic, MicOff, Phone, TriangleAlert, Video, VideoOff } from 'lucide-react'
import { AUDIO_CONSTRAINTS, VIDEO_CONSTRAINTS, type StartOptions } from '../lib/call'
import { saveName, savedName, type CallMode } from '../lib/rooms'
import { Avatar, MediaVideo } from './Media'

type DeviceStatus = 'asking' | 'ready' | 'partial' | 'denied' | 'unsupported'

export function Lobby({
  roomId,
  mode,
  keyCheck,
  onJoin,
}: {
  roomId: string
  mode: CallMode
  keyCheck: string
  onJoin: (opts: StartOptions) => void
}) {
  const [name, setName] = useState(savedName)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(mode === 'video')
  const [status, setStatus] = useState<DeviceStatus>('asking')
  const [busy, setBusy] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const handedOff = useRef(false)

  const update = (s: MediaStream | null) => {
    streamRef.current = s
    setStream(s)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unsupported')
        setMicOn(false)
        setCamOn(false)
        return
      }
      const wantVideo = mode === 'video'
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: wantVideo ? VIDEO_CONSTRAINTS : false })
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        update(s)
        setStatus('ready')
      } catch {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS })
          if (cancelled) return s.getTracks().forEach((t) => t.stop())
          update(s)
          setCamOn(false)
          setStatus(wantVideo ? 'partial' : 'ready')
        } catch {
          if (cancelled) return
          setMicOn(false)
          setCamOn(false)
          setStatus('denied')
        }
      }
    })()
    return () => {
      cancelled = true
      if (!handedOff.current) streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [mode])

  const toggleMic = async () => {
    const track = stream?.getAudioTracks()[0]
    if (track) {
      track.enabled = !micOn
      setMicOn(!micOn)
      return
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS })
      update(new MediaStream([...(stream?.getTracks() ?? []), ...s.getAudioTracks()]))
      setMicOn(true)
      setStatus((st) => (st === 'denied' ? 'partial' : st))
    } catch {
      setStatus((st) => (st === 'ready' ? 'partial' : st))
    }
  }

  const toggleCam = async () => {
    if (camOn) {
      stream?.getVideoTracks().forEach((t) => t.stop())
      update(new MediaStream(stream?.getAudioTracks() ?? []))
      setCamOn(false)
      return
    }
    setBusy(true)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS })
      update(new MediaStream([...(stream?.getAudioTracks() ?? []), ...s.getVideoTracks()]))
      setCamOn(true)
      if (status === 'partial' && stream?.getAudioTracks().length) setStatus('ready')
    } catch {
      setStatus((st) => (st === 'ready' ? 'partial' : st))
    } finally {
      setBusy(false)
    }
  }

  const join = () => {
    const finalName = name.trim() || 'Guest'
    saveName(finalName)
    handedOff.current = true
    onJoin({ name: finalName, stream, micOn: micOn && !!stream?.getAudioTracks().length, camOn })
  }

  const displayName = name.trim() || 'You'

  return (
    <div className="lobby">
      <div className="lobby-preview">
        <div className="preview-tile">
          {camOn && stream?.getVideoTracks().length ? (
            <MediaVideo stream={stream} mirrored className="preview-video" />
          ) : (
            <div className="preview-empty">
              {status === 'asking' ? (
                <div className="preview-asking">
                  <LoaderCircle className="spin" size={28} />
                  <span>Asking your browser for the {mode === 'video' ? 'camera and microphone' : 'microphone'}…</span>
                </div>
              ) : (
                <Avatar name={displayName} stream={stream} micOn={micOn} />
              )}
            </div>
          )}
          <span className="tile-tag">{displayName}</span>
        </div>
        <div className="preview-controls">
          <button className={`round-btn ${micOn ? '' : 'off'}`} onClick={toggleMic} aria-pressed={!micOn} aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}>
            {micOn ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <button
            className={`round-btn ${camOn ? '' : 'off'}`}
            onClick={toggleCam}
            disabled={busy}
            aria-pressed={!camOn}
            aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
          >
            {busy ? <LoaderCircle className="spin" size={20} /> : camOn ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
        </div>
        {(status === 'denied' || status === 'partial' || status === 'unsupported') && (
          <p className="device-note">
            <TriangleAlert size={15} />
            {status === 'unsupported'
              ? 'This browser can’t share a camera or microphone here. You can still chat and play.'
              : status === 'denied'
                ? 'No camera or microphone access. Allow it in your browser’s site settings, or join to chat and play.'
                : 'Part of your setup is blocked or busy. You can turn it on later from the call.'}
          </p>
        )}
      </div>

      <div className="lobby-side">
        <p className="eyebrow">
          {mode === 'video' ? <Video size={14} /> : <Phone size={14} />} {mode === 'video' ? 'Video call' : 'Voice call'}
        </p>
        <h1 className="lobby-title">
          Ready to <em>talk?</em>
        </h1>
        <dl className="room-facts">
          <div>
            <dt>Room</dt>
            <dd className="mono">{roomId}</dd>
          </div>
          <div>
            <dt>Key check</dt>
            <dd className="mono">{keyCheck || '····'}</dd>
          </div>
        </dl>
        <p className="lobby-hint">
          <LockKeyhole size={14} /> Anyone opening the same link sees the same key check. The key itself never leaves this
          device.
        </p>
        <label className="field">
          <span className="field-label">Your name</span>
          <input
            className="input"
            value={name}
            maxLength={40}
            placeholder="Shown only to your friend"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && status !== 'asking' && join()}
            autoFocus
          />
        </label>
        <button className="btn btn-primary btn-wide" onClick={join} disabled={status === 'asking'}>
          Join the room <ArrowRight size={18} />
        </button>
      </div>
    </div>
  )
}
