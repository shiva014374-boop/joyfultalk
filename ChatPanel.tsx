import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { LockKeyhole, Send } from 'lucide-react'
import type { CallEngine, CallSnapshot } from '../lib/call'

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function ChatPanel({ engine, state }: { engine: CallEngine; state: CallSnapshot }) {
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const ready = state.channelOpen
  const friend = state.remote?.name ?? 'your friend'

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [state.messages.length, state.remoteTyping])

  useEffect(() => {
    engine.markChatRead()
  }, [engine, state.unread])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (engine.sendChat(draft)) setDraft('')
    inputRef.current?.focus()
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef} aria-live="polite">
        {state.messages.length === 0 && (
          <div className="chat-empty">
            <LockKeyhole size={22} />
            <p>{ready ? `Say hi to ${friend}.` : 'Chat opens as soon as your friend joins.'}</p>
            <span>Messages are sealed on your device and are never stored anywhere.</span>
          </div>
        )}
        {state.messages.map((m) =>
          m.from === 'system' ? (
            <p key={m.id} className="chat-system">
              <LockKeyhole size={11} /> {m.text}
            </p>
          ) : (
            <div key={m.id} className={`bubble-row ${m.from}`}>
              <div className="bubble">
                <p>{m.text}</p>
                <span className="bubble-meta">{time(m.ts)}</span>
              </div>
            </div>
          ),
        )}
        {state.remoteTyping && (
          <div className="bubble-row them">
            <div className="bubble typing" aria-label={`${friend} is typing`}>
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
      </div>
      <form className="chat-compose" onSubmit={submit}>
        <textarea
          ref={inputRef}
          className="chat-input"
          rows={1}
          value={draft}
          maxLength={2000}
          disabled={!ready}
          placeholder={ready ? `Message ${friend}` : 'Waiting for your friend…'}
          onChange={(e) => {
            setDraft(e.target.value)
            engine.notifyTyping()
          }}
          onKeyDown={onKey}
        />
        <button className="btn btn-icon btn-send" type="submit" disabled={!ready || !draft.trim()} aria-label="Send message">
          <Send size={17} />
        </button>
      </form>
    </div>
  )
}
