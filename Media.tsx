import { useEffect, useRef } from 'react'
import { MicOff } from 'lucide-react'
import { useAudioLevel } from '../lib/useAudioLevel'

export function MediaVideo({ stream, mirrored, className }: { stream: MediaStream | null; mirrored?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream
  }, [stream])
  return <video ref={ref} className={`${className ?? ''} ${mirrored ? 'mirrored' : ''}`} autoPlay playsInline muted />
}

/** Plays the remote side's audio independently of whether their video is shown. */
export function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    if (stream) void el.play().catch(() => {})
  }, [stream])
  return <audio ref={ref} autoPlay />
}

const HUES = [24, 38, 12, 48, 4, 32]

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function Avatar({
  name,
  stream,
  micOn,
  size = 'lg',
}: {
  name: string
  stream: MediaStream | null
  micOn: boolean
  size?: 'lg' | 'sm'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useAudioLevel(stream, ref, micOn)
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const hue = HUES[h % HUES.length]
  return (
    <div ref={ref} className={`avatar avatar-${size}`} style={{ ['--hue' as string]: hue }}>
      <span className="avatar-ring" />
      <span className="avatar-ring ring-2" />
      <span className="avatar-face">{initials(name)}</span>
      {!micOn && (
        <span className="avatar-muted" aria-label="Muted">
          <MicOff size={size === 'lg' ? 16 : 12} />
        </span>
      )}
    </div>
  )
}
