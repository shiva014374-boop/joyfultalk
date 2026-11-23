import { generateRoomId, generateRoomSecret, isValidSecret } from './crypto'

export type CallMode = 'video' | 'audio'

const NAME_KEY = 'joyful-talk:name'

export function savedName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 40))
  } catch {
    /* private mode */
  }
}

/** Builds a fresh room path. The secret goes after `#`, which browsers never send to servers. */
export function newRoomPath(mode: CallMode) {
  return `/room/${generateRoomId()}${mode === 'audio' ? '?mode=audio' : ''}#${generateRoomSecret()}`
}

export function inviteUrl(roomId: string, secret: string, mode: CallMode) {
  return `${location.origin}/room/${roomId}${mode === 'audio' ? '?mode=audio' : ''}#${secret}`
}

/** Accepts a pasted invite link and returns the local path to open, or null. */
export function parseInvite(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  try {
    const url = new URL(text, location.origin)
    const m = url.pathname.match(/^\/room\/([a-z0-9-]{6,64})\/?$/)
    const secret = url.hash.slice(1)
    if (!m || !isValidSecret(secret)) return null
    return `/room/${m[1]}${url.search}#${secret}`
  } catch {
    return null
  }
}
