// Tic-tac-toe rules shared by both peers. Both sides apply the same moves in
// the same order, so their boards stay identical without a referee.

export type Mark = 'X' | 'O'
export type Cell = Mark | null

export interface GameState {
  board: Cell[]
  round: number
  winner: Mark | 'draw' | null
  line: number[] | null
  score: { me: number; them: number; draws: number }
}

export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

export function newGame(): GameState {
  return { board: Array(9).fill(null), round: 0, winner: null, line: null, score: { me: 0, them: 0, draws: 0 } }
}

/** X always opens; who plays X alternates each round. */
export function mySymbol(round: number, isOfferer: boolean): Mark {
  const iStart = round % 2 === 0 ? isOfferer : !isOfferer
  return iStart ? 'X' : 'O'
}

export function turnOf(board: Cell[]): Mark {
  const x = board.filter((c) => c === 'X').length
  const o = board.filter((c) => c === 'O').length
  return x > o ? 'O' : 'X'
}

function evaluate(board: Cell[]): { winner: GameState['winner']; line: number[] | null } {
  for (const line of LINES) {
    const [a, b, c] = line
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line }
  }
  if (board.every(Boolean)) return { winner: 'draw', line: null }
  return { winner: null, line: null }
}

/** Returns the new state, or null when the move is not legal. */
export function placeMark(state: GameState, index: number, mark: Mark, me: Mark): GameState | null {
  if (!Number.isInteger(index) || index < 0 || index > 8) return null
  if (state.winner || state.board[index] || turnOf(state.board) !== mark) return null
  const board = state.board.slice()
  board[index] = mark
  const { winner, line } = evaluate(board)
  const score = { ...state.score }
  if (winner === 'draw') score.draws++
  else if (winner === me) score.me++
  else if (winner) score.them++
  return { ...state, board, winner, line, score }
}

export function nextRound(state: GameState, round: number): GameState {
  return { ...state, board: Array(9).fill(null), round, winner: null, line: null }
}
