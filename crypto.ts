// Room cryptography.
//
// Every room has a 256-bit secret that lives only in the invite link's
// #fragment. From it we derive an AES-256-GCM key with HKDF. That key seals
// all signaling traffic (so the relay server only forwards ciphertext) and
// every chat / game message on the peer-to-peer data channel, on top of
// WebRTC's own DTLS-SRTP transport encryption.

const enc = new TextEncoder()
const dec = new TextDecoder()

export function toB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function generateRoomSecret(): string {
  return toB64url(randomBytes(32))
}

export function isValidSecret(s: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(s)) return false
  try {
    return fromB64url(s).length === 32
  } catch {
    return false
  }
}

const ADJECTIVES = ['amber', 'brisk', 'cosy', 'dapper', 'eager', 'fizzy', 'gentle', 'honey', 'jolly', 'lucky', 'mellow', 'nimble', 'plucky', 'quiet', 'rosy', 'sunny', 'toasty', 'velvet', 'witty', 'zesty']
const NOUNS = ['otter', 'kettle', 'maple', 'comet', 'fig', 'lantern', 'pebble', 'harbor', 'wren', 'tulip', 'biscuit', 'meadow', 'canyon', 'parrot', 'saffron', 'willow', 'ember', 'puffin', 'clover', 'garnet']

export function generateRoomId(): string {
  const r = randomBytes(4)
  const n = ((r[2] << 8) | r[3]) % 9000 + 1000
  return `${ADJECTIVES[r[0] % ADJECTIVES.length]}-${NOUNS[r[1] % NOUNS.length]}-${n}`
}

export function generatePeerId(): string {
  return toB64url(randomBytes(12))
}

export async function deriveRoomKey(secret: string, roomId: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', fromB64url(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(`joyful-talk/v1/${roomId}`), info: enc.encode('room-key') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Encrypts a JSON value. Output: base64url(iv[12] || ciphertext+tag). */
export async function seal(key: CryptoKey, value: unknown, aad = 'jt'): Promise<string> {
  const iv = randomBytes(12)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(value))),
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return toB64url(out)
}

/** Decrypts a sealed value. Throws if the key is wrong or data was tampered with. */
export async function open<T = unknown>(key: CryptoKey, sealed: string, aad = 'jt'): Promise<T> {
  const bytes = fromB64url(sealed)
  const iv = bytes.slice(0, 12)
  const ct = bytes.slice(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, ct)
  return JSON.parse(dec.decode(pt)) as T
}

export function extractFingerprint(sdp: string | undefined | null): string | null {
  if (!sdp) return null
  const m = sdp.match(/a=fingerprint:(\S+) ([0-9A-Fa-f:]+)/)
  return m ? `${m[1].toLowerCase()} ${m[2].toUpperCase()}` : null
}

/**
 * Safety code: both people see the same digits only if their browsers are
 * talking directly to each other. A machine in the middle would have to
 * present its own DTLS certificate, which changes the code.
 */
export async function safetyCode(fpA: string, fpB: string): Promise<string> {
  const [a, b] = [fpA, fpB].sort()
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`joyful-talk-safety|${a}|${b}`)))
  const groups: string[] = []
  for (let i = 0; i < 4; i++) {
    const v = ((digest[i * 4] << 24) | (digest[i * 4 + 1] << 16) | (digest[i * 4 + 2] << 8) | digest[i * 4 + 3]) >>> 0
    groups.push(String(v % 100000).padStart(5, '0'))
  }
  return groups.join(' ')
}
