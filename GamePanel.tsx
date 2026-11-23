import { RotateCcw } from 'lucide-react'
import type { CallEngine, CallSnapshot } from './call'
import { turnOf } from './game'
import { OMark, XMark } from './Marks'

export function GamePanel({ engine, state }: { engine: CallEngine; state: CallSnapshot }) {
  const { game, mySymbol } = state
  const ready = state.channelOpen
  const friend = state.remote?.name ?? 'Friend'
  const turn = turnOf(game.board)
  const myTurn = ready && !game.winner && turn === mySymbol

  let status: string
  if (!ready) status = 'The board unlocks when your friend joins'
  else if (game.winner === 'draw') status = 'A draw. Nobody blinks.'
  else if (game.winner === mySymbol) status = 'You won this round'
  else if (game.winner) status = `${friend} won this round`
  else if (myTurn) status = `Your move, you're ${mySymbol}`
  else status = `${friend} is thinking…`

  return (
    <div className="game">
      <div className="score">
        <div className="score-cell">
          <span className="score-label">You · {mySymbol}</span>
          <span className="score-num">{game.score.me}</span>
        </div>
        <div className="score-cell muted">
          <span className="score-label">Draws</span>
          <span className="score-num">{game.score.draws}</span>
        </div>
        <div className="score-cell">
          <span className="score-label">
            {friend} · {mySymbol === 'X' ? 'O' : 'X'}
          </span>
          <span className="score-num">{game.score.them}</span>
        </div>
      </div>

      <p className={`game-status ${myTurn ? 'is-turn' : ''} ${game.winner ? 'is-over' : ''}`} aria-live="polite">
        {status}
      </p>

      <div className={`board ${!ready ? 'locked' : ''}`} role="grid" aria-label="Tic-tac-toe board">
        {game.board.map((cell, i) => {
          const win = game.line?.includes(i)
          return (
            <button
              key={`${game.round}-${i}`}
              className={`cell ${cell ? `mark-${cell}` : ''} ${win ? 'win' : ''}`}
              disabled={!myTurn || !!cell}
              onClick={() => engine.playMove(i)}
              aria-label={cell ? `Cell ${i + 1}: ${cell}` : `Cell ${i + 1}: empty`}
            >
              {cell === 'X' && <XMark />}
              {cell === 'O' && <OMark />}
            </button>
          )
        })}
      </div>

      <button className="btn btn-ghost btn-round" onClick={() => engine.newRound()} disabled={!ready}>
        <RotateCcw size={16} /> {game.winner ? 'Play again' : 'Restart round'}
      </button>
      <p className="game-hint">X goes first, and you swap who starts every round.</p>
    </div>
  )
}
