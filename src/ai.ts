import {
  COLS,
  RANKS,
  RANK_VALUE,
  applyAction,
  getActivePiece,
  getLegalActions,
  type Action,
  type Camp,
  type GameState,
  type Piece,
} from "./game";

export const AI_DIFFICULTIES = ["gudiao", "zhuyan", "aoyin", "xiangliu", "qiongqi"] as const;
export type AiDifficulty = (typeof AI_DIFFICULTIES)[number];
export const AI_DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  gudiao: "蛊雕",
  zhuyan: "朱厌",
  aoyin: "獓狠",
  xiangliu: "相柳",
  qiongqi: "穷奇",
};

type Random = () => number;

const SEARCH_BRANCH_LIMIT = 8;
const SEARCH_WEIGHT = 24;

export function chooseAiAction(
  state: GameState,
  difficultyOrRandom: AiDifficulty | Random = "zhuyan",
  fallbackRandom: Random = Math.random,
  aiCamp: Camp = "black",
): Action | null {
  const actions = getLegalActions(state, aiCamp);
  if (actions.length === 0) return null;

  const difficulty = typeof difficultyOrRandom === "function" ? "zhuyan" : difficultyOrRandom;
  const random = typeof difficultyOrRandom === "function" ? difficultyOrRandom : fallbackRandom;

  if (difficulty === "gudiao") return randomAction(actions, random);

  const scorer = difficulty === "zhuyan"
    ? (action: Action) => scoreAction(state, action) + random() * 4
    : (action: Action) => scoreSearchAction(state, action, searchDepth(difficulty), aiCamp);

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestActions: Action[] = [];

  actions.forEach((action) => {
    const score = scorer(action);
    if (score > bestScore) {
      bestScore = score;
      bestActions = [action];
    } else if (score === bestScore) {
      bestActions.push(action);
    }
  });

  return bestActions[Math.floor(random() * bestActions.length)];
}

function randomAction(actions: Action[], random: Random): Action {
  return actions[Math.min(actions.length - 1, Math.floor(random() * actions.length))];
}

function scoreAction(state: GameState, action: Action): number {
  if (action.type === "flip") {
    // A hidden tile's identity never affects this score, so the AI cannot peek.
    return 24;
  }

  const mover = getActivePiece(state.board[action.from])!;
  const target = state.board[action.to];
  const defender = target.guest ?? (target.base?.revealed ? target.base : null);
  if (defender && defender.camp !== mover.camp) {
    const tradePenalty = defender.rank === mover.rank ? RANK_VALUE[mover.rank] * 2 : 0;
    return 120 + RANK_VALUE[defender.rank] * 8 - tradePenalty;
  }
  if (target.base && !target.base.revealed) {
    return 42;
  }

  const row = Math.floor(action.to / COLS);
  const col = action.to % COLS;
  const centerDistance = Math.abs(row - 2) + Math.abs(col - 1.5);
  return 12 - centerDistance;
}

function searchDepth(difficulty: Exclude<AiDifficulty, "gudiao" | "zhuyan">): number {
  if (difficulty === "aoyin") return 1;
  if (difficulty === "xiangliu") return 2;
  return 3;
}

function scoreSearchAction(state: GameState, action: Action, depth: number, aiCamp: Camp): number {
  if (action.type === "flip") {
    return scoreAction(state, action) + expectedHiddenBalance(state, aiCamp) * 3;
  }

  const futureScore = searchPublicState(applyAction(state, action), depth, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, aiCamp);

  return scoreAction(state, action) + futureScore * SEARCH_WEIGHT;
}

function searchPublicState(state: GameState, depth: number, alpha: number, beta: number, aiCamp: Camp): number {
  if (state.status === "won") return state.winner === aiCamp ? 1000 : -1000;
  if (state.status === "draw" || depth === 0) return evaluatePublicState(state, aiCamp);

  const moves = getPublicMoves(state);
  if (moves.length === 0) return evaluatePublicState(state, aiCamp);

  const candidates = orderPublicMoves(state, moves);
  if (state.turn === aiCamp) {
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const action of candidates) {
      bestScore = Math.max(bestScore, searchPublicState(applyAction(state, action), depth - 1, alpha, beta, aiCamp));
      alpha = Math.max(alpha, bestScore);
      if (alpha >= beta) break;
    }
    return bestScore;
  }

  let bestScore = Number.POSITIVE_INFINITY;
  for (const action of candidates) {
    bestScore = Math.min(bestScore, searchPublicState(applyAction(state, action), depth - 1, alpha, beta, aiCamp));
    beta = Math.min(beta, bestScore);
    if (alpha >= beta) break;
  }
  return bestScore;
}

function getPublicMoves(state: GameState): Action[] {
  return getLegalActions(state).filter((action) => action.type === "move");
}

function orderPublicMoves(state: GameState, actions: Action[]): Action[] {
  return [...actions]
    .sort((left, right) => scoreAction(state, right) - scoreAction(state, left))
    .slice(0, SEARCH_BRANCH_LIMIT);
}

function evaluatePublicState(state: GameState, aiCamp: Camp): number {
  let score = 0;
  state.board.forEach((cell) => {
    if (cell.base?.revealed) score += pieceScore(cell.base, aiCamp);
    if (cell.guest) score += pieceScore(cell.guest, aiCamp);
  });
  (["red", "black"] as const).forEach((camp) => {
    state.fallen[camp].forEach((piece) => {
      score += camp === aiCamp ? -RANK_VALUE[piece.rank] : RANK_VALUE[piece.rank];
    });
  });
  return score;
}

function expectedHiddenBalance(state: GameState, aiCamp: Camp): number {
  const observedIds = new Set<string>();
  state.board.forEach((cell) => {
    if (cell.base?.revealed) observedIds.add(cell.base.id);
    if (cell.guest) observedIds.add(cell.guest.id);
  });
  state.fallen.red.forEach((piece) => observedIds.add(piece.id));
  state.fallen.black.forEach((piece) => observedIds.add(piece.id));

  let total = 0;
  let count = 0;
  (["red", "black"] as const).forEach((camp) => {
    RANKS.forEach((rank) => {
      if (observedIds.has(`${camp}-${rank}`)) return;
      total += camp === aiCamp ? RANK_VALUE[rank] : -RANK_VALUE[rank];
      count += 1;
    });
  });
  return count === 0 ? 0 : total / count;
}

function pieceScore(piece: Piece, aiCamp: Camp): number {
  return piece.camp === aiCamp ? RANK_VALUE[piece.rank] : -RANK_VALUE[piece.rank];
}
