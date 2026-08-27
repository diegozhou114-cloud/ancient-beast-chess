import {
  COLS,
  RANK_VALUE,
  getActivePiece,
  getLegalActions,
  type Action,
  type GameState,
} from "./game";

export function chooseAiAction(state: GameState, random: () => number = Math.random): Action | null {
  const actions = getLegalActions(state, "black");
  if (actions.length === 0) return null;

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestActions: Action[] = [];

  actions.forEach((action) => {
    const score = scoreAction(state, action, random);
    if (score > bestScore) {
      bestScore = score;
      bestActions = [action];
    } else if (score === bestScore) {
      bestActions.push(action);
    }
  });

  return bestActions[Math.floor(random() * bestActions.length)];
}

function scoreAction(state: GameState, action: Action, random: () => number): number {
  const noise = random() * 5;
  if (action.type === "flip") {
    // A hidden tile's identity never affects this score, so the AI cannot peek.
    return 24 + noise;
  }

  const mover = getActivePiece(state.board[action.from])!;
  const target = state.board[action.to];
  if (target.base?.revealed && target.base.camp !== mover.camp) {
    const tradePenalty = target.base.rank === mover.rank ? RANK_VALUE[mover.rank] * 2 : 0;
    return 120 + RANK_VALUE[target.base.rank] * 8 - tradePenalty + noise;
  }
  if (target.base && !target.base.revealed) {
    return 42 + noise;
  }

  const row = Math.floor(action.to / COLS);
  const col = action.to % COLS;
  const centerDistance = Math.abs(row - 2) + Math.abs(col - 1.5);
  return 12 - centerDistance + noise;
}
