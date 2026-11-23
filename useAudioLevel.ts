import { useEffect, type RefObject } from 'react'

let sharedCtx: AudioContext | null = null
function ctx() {
  sharedCtx ??= new AudioContext()
  if (sharedCtx.state === 'suspended') void sharedCtx.resume()
  return sharedCtx
}

/**
 * Writes the stream's loudness (0..1) into the element's `--level` CSS
 * variable every frame. Bypasses React state so speaking rings stay smooth.
 */
export function useAudioLevel(stream: MediaStream | null, ref: RefObject<HTMLElement | null>, active = true) {
  const track = stream?.getAudioTracks()[0]
  useEffect(() => {
    const el = ref.current
    if (!el || !track || !active || typeof AudioContext === 'undefined') {
      el?.style.setProperty('--level', '0')
      return
    }
    const ac = ctx()
    const src = ac.createMediaStreamSource(new MediaStream([track]))
    const analyser = ac.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.6
    src.connect(analyser)
    const buf = new Uint8Array(analyser.fftSize)
    let raf = 0
    let smooth = 0
    const tick = () => {
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (const v of buf) {
        const d = (v - 128) / 128
        sum += d * d
      }
      const rms = Math.sqrt(sum / buf.length)
      const level = Math.min(1, rms * 5)
      smooth = smooth * 0.75 + level * 0.25
      el.style.setProperty('--level', smooth.toFixed(3))
      el.dataset.speaking = smooth > 0.12 ? 'true' : 'false'
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(raf)
      src.disconnect()
      el.style.setProperty('--level', '0')
      el.dataset.speaking = 'false'
    }
  }, [track, ref, active])
}
