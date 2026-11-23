import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Fingerprint, KeyRound, LockKeyhole, MessageSquare, Phone, ShieldCheck, Video } from 'lucide-react'
import { Logo } from './Logo'
import { OMark, XMark } from './Marks'
import { navigate } from './router'
import { newRoomPath, parseInvite, saveName, savedName, type CallMode } from './rooms'
import { generateRoomSecret, seal, deriveRoomKey } from './crypto'

export function Landing() {
  return (
    <div className="landing">
      <div className="grain" aria-hidden="true" />
      <header className="topbar">
        <Logo />
        <nav className="topnav">
          <a href="#rooms">What's inside</a>
          <a href="#seal">How the seal works</a>
          <a href="#start" className="topnav-cta">
            Start a call
          </a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <LockKeyhole size={14} /> Peer to peer · sealed end to end · no accounts
            </p>
            <h1 className="hero-title">
              Say it face to face.
              <br />
              <em>Keep it between</em> you two.
            </h1>
            <p className="hero-lede">
              Joyful Talk is a private room for two people. Video call, voice call, chat and a round of tic-tac-toe, all
              sealed with a key that only lives in your invite link.
            </p>
            <StartCard />
          </div>
          <CipherDemo />
        </section>

        <section className="rooms" id="rooms">
          <div className="section-head">
            <span className="section-num">01</span>
            <h2>
              One link, <em>four ways</em> to hang out.
            </h2>
          </div>
          <div className="bento">
            <article className="bento-card bento-video">
              <div className="bento-icon">
                <Video size={20} />
              </div>
              <h3>Video call</h3>
              <p>HD video straight between your browsers. Turn your camera off any time and the light goes off too.</p>
              <div className="mini-call" aria-hidden="true">
                <div className="mini-remote">
                  <span className="mini-face">TO</span>
                </div>
                <div className="mini-self" />
                <div className="mini-dock">
                  <i />
                  <i />
                  <i className="red" />
                </div>
              </div>
            </article>
            <article className="bento-card bento-audio">
              <div className="bento-icon">
                <Phone size={20} />
              </div>
              <h3>Voice call</h3>
              <p>Just voices, with rings that pulse when someone speaks. Good for walks and bad hair days.</p>
              <div className="wave" aria-hidden="true">
                {Array.from({ length: 22 }, (_, i) => (
                  <span key={i} style={{ animationDelay: `${(i * 83) % 900}ms` }} />
                ))}
              </div>
            </article>
            <article className="bento-card bento-chat">
              <div className="bento-icon">
                <MessageSquare size={20} />
              </div>
              <h3>Chat</h3>
              <p>Drop links and addresses mid-call. Messages vanish when you close the tab, because they were never stored.</p>
              <div className="mini-chat" aria-hidden="true">
                <span className="b them">did the soup survive?</span>
                <span className="b me">barely. ordering dumplings</span>
                <span className="b them">a wise call</span>
              </div>
            </article>
            <article className="bento-card bento-game">
              <div className="bento-icon">
                <span className="ttt-glyph">#</span>
              </div>
              <h3>Tic-tac-toe</h3>
              <p>Play live while you talk. Turns alternate each round and the score keeps itself.</p>
              <MiniBoard />
            </article>
          </div>
        </section>

        <section className="seal" id="seal">
          <div className="section-head">
            <span className="section-num">02</span>
            <h2>
              How the <em>seal</em> works.
            </h2>
          </div>
          <ol className="steps">
            <li className="step">
              <KeyRound className="step-icon" size={22} />
              <h3>Your browser makes the key</h3>
              <p>
                When you start a room, your device generates a fresh 256-bit secret. Our servers never create it, receive
                it or store it.
              </p>
            </li>
            <li className="step">
              <LockKeyhole className="step-icon" size={22} />
              <h3>It travels after the #</h3>
              <p>
                The key rides in the part of the link after <code>#</code>, which browsers never send to servers. The
                relay that introduces your two browsers only ever forwards ciphertext.
              </p>
            </li>
            <li className="step">
              <ShieldCheck className="step-icon" size={22} />
              <h3>Media flows directly</h3>
              <p>
                Audio and video travel peer to peer over WebRTC's DTLS-SRTP encryption. Chat and game moves get an extra
                AES-256-GCM layer with your room key.
              </p>
            </li>
            <li className="step">
              <Fingerprint className="step-icon" size={22} />
              <h3>Read the safety code aloud</h3>
              <p>
                Both screens show twenty digits derived from the two connection certificates. If they match, nobody is
                sitting in the middle.
              </p>
            </li>
          </ol>
          <p className="seal-note">
            Anyone holding the full link can join, so send it only to the person you want to talk to. A room fits two
            people; a third gets turned away.
          </p>
        </section>
      </main>

      <footer className="footer">
        <Logo size={24} />
        <p>No accounts. No history. Close the tab and the room is gone.</p>
      </footer>
    </div>
  )
}

function StartCard() {
  const [name, setName] = useState(savedName)
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState('')

  const start = (mode: CallMode) => {
    if (name.trim()) saveName(name)
    navigate(newRoomPath(mode))
  }

  const join = (e: FormEvent) => {
    e.preventDefault()
    const path = parseInvite(link)
    if (!path) {
      setLinkError('That link is missing its room or key. Copy the whole thing, including the part after #.')
      return
    }
    if (name.trim()) saveName(name)
    navigate(path)
  }

  return (
    <div className="start-card" id="start">
      <label className="field">
        <span className="field-label">Your name</span>
        <input
          className="input"
          value={name}
          maxLength={40}
          placeholder="What should your friend see?"
          onChange={(e) => setName(e.target.value)}
          autoComplete="nickname"
        />
      </label>
      <div className="start-actions">
        <button className="btn btn-primary" onClick={() => start('video')}>
          <Video size={18} /> Start video call
        </button>
        <button className="btn btn-ghost" onClick={() => start('audio')}>
          <Phone size={18} /> Start voice call
        </button>
      </div>
      <form className="join-row" onSubmit={join}>
        <input
          className="input input-sm"
          value={link}
          onChange={(e) => {
            setLink(e.target.value)
            setLinkError('')
          }}
          placeholder="Got an invite? Paste the link"
          aria-label="Invite link"
          aria-invalid={!!linkError}
        />
        <button className="btn btn-icon" type="submit" aria-label="Join with link">
          <ArrowRight size={18} />
        </button>
      </form>
      {linkError && <p className="field-error">{linkError}</p>}
    </div>
  )
}

/** Real AES-256-GCM, right in the page: shows what the relay would see. */
function CipherDemo() {
  const [text, setText] = useState('meet me at the blue door at 7?')
  const [cipher, setCipher] = useState('')
  const keyRef = useRef<Promise<CryptoKey> | null>(null)

  useEffect(() => {
    keyRef.current ??= deriveRoomKey(generateRoomSecret(), 'demo-room')
    let live = true
    keyRef.current
      .then((k) => seal(k, { t: 'chat', text }))
      .then((c) => live && setCipher(c))
      .catch(() => live && setCipher('This browser needs HTTPS to show live encryption.'))
    return () => {
      live = false
    }
  }, [text])

  return (
    <aside className="cipher" aria-label="Live encryption demo">
      <div className="cipher-head">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
        <span className="cipher-title">try it, this runs in your browser</span>
      </div>
      <div className="cipher-pane cipher-friend">
        <span className="cipher-label">You type</span>
        <textarea className="cipher-input" value={text} maxLength={160} rows={2} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="cipher-arrow" aria-hidden="true">
        <span>AES-256-GCM</span>
      </div>
      <div className="cipher-pane cipher-server">
        <span className="cipher-label">The relay sees</span>
        <p className="cipher-out">{cipher || ' '}</p>
      </div>
      <div className="cipher-pane cipher-them">
        <span className="cipher-label">Your friend sees</span>
        <p className="cipher-plain">{text || ' '}</p>
      </div>
    </aside>
  )
}

const DEMO_MOVES = [4, 0, 2, 6, 3, 5, 8, 1, 7]
function MiniBoard() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setN((v) => (v + 1) % (DEMO_MOVES.length + 3)), 900)
    return () => window.clearInterval(id)
  }, [])
  const board: (string | null)[] = Array(9).fill(null)
  DEMO_MOVES.slice(0, Math.min(n, DEMO_MOVES.length)).forEach((cell, i) => (board[cell] = i % 2 === 0 ? 'X' : 'O'))
  return (
    <div className="mini-board" aria-hidden="true">
      {board.map((c, i) => (
        <span key={i} className={`mini-cell ${c ? `mark-${c}` : ''}`}>
          {c === 'X' && <XMark />}
          {c === 'O' && <OMark />}
        </span>
      ))}
    </div>
  )
}
