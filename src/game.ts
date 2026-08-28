export const ROWS = 5;
export const COLS = 4;

export const RANKS = [
  "human",
  "elephant",
  "lion",
  "tiger",
  "leopard",
  "jackal",
  "wolf",
  "dog",
  "cat",
  "rat",
] as const;

export type Rank = (typeof RANKS)[number];
export type Camp = "red" | "black";
export type LayerMode = "above" | "below";
export type GameStatus = "playing" | "won" | "draw";

export interface Piece {
  id: string;
  camp: Camp;
  rank: Rank;
  revealed: boolean;
}

export interface Cell {
  base: Piece | null;
  guest: Piece | null;
  guestMode: LayerMode | null;
}

export interface GameState {
  board: Cell[];
  turn: Camp;
  status: GameStatus;
  winner: Camp | null;
  moveNumber: number;
  halfmoveClock: number;
  fallen: Record<Camp, Piece[]>;
  log: string[];
  lastAction: Action | null;
}

export type Action =
  | { type: "flip"; at: number }
  | { type: "move"; from: number; to: number };

export const RANK_LABEL: Record<Rank, string> = {
  human: "人",
  elephant: "象",
  lion: "狮",
  tiger: "虎",
  leopard: "豹",
  jackal: "豺",
  wolf: "狼",
  dog: "狗",
  cat: "猫",
  rat: "鼠",
};

export const RANK_VALUE: Record<Rank, number> = Object.fromEntries(
  RANKS.map((rank, index) => [rank, RANKS.length - index]),
) as Record<Rank, number>;

const CAMP_LABEL: Record<Camp, string> = { red: "朱", black: "墨" };

export function createGame(random: () => number = Math.random): GameState {
  const pieces = (["red", "black"] as Camp[]).flatMap((camp) =>
    RANKS.map<Piece>((rank) => ({
      id: `${camp}-${rank}`,
      camp,
      rank,
      revealed: false,
    })),
  );

  for (let index = pieces.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [pieces[index], pieces[swapIndex]] = [pieces[swapIndex], pieces[index]];
  }

  return {
    board: pieces.map((piece) => ({ base: piece, guest: null, guestMode: null })),
    turn: "red",
    status: "playing",
    winner: null,
    moveNumber: 1,
    halfmoveClock: 0,
    fallen: { red: [], black: [] },
    log: ["棋局已布，朱方先行"],
    lastAction: null,
  };
}

export function createEmptyState(turn: Camp = "red"): GameState {
  return {
    board: Array.from({ length: ROWS * COLS }, () => ({
      base: null,
      guest: null,
      guestMode: null,
    })),
    turn,
    status: "playing",
    winner: null,
    moveNumber: 1,
    halfmoveClock: 0,
    fallen: { red: [], black: [] },
    log: [],
    lastAction: null,
  };
}

export function makePiece(camp: Camp, rank: Rank, revealed = true): Piece {
  return { id: `${camp}-${rank}`, camp, rank, revealed };
}

export function getActivePiece(cell: Cell): Piece | null {
  if (cell.guest) return cell.guest;
  return cell.base?.revealed ? cell.base : null;
}

export function canCapture(attacker: Rank, defender: Rank): boolean {
  if (attacker === defender) return true;
  if (attacker === "rat" && defender === "elephant") return true;
  if (attacker === "elephant" && defender === "rat") return false;
  return RANK_VALUE[attacker] > RANK_VALUE[defender];
}

export function getLegalActions(state: GameState, camp: Camp = state.turn): Action[] {
  if (state.status !== "playing" || camp !== state.turn) return [];

  const actions: Action[] = [];
  state.board.forEach((cell, index) => {
    if (cell.base && !cell.base.revealed && !cell.guest) {
      actions.push({ type: "flip", at: index });
    }

    const piece = getActivePiece(cell);
    if (!piece || piece.camp !== camp) return;

    state.board.forEach((_target, targetIndex) => {
      if (isLegalMove(state, index, targetIndex)) {
        actions.push({ type: "move", from: index, to: targetIndex });
      }
    });
  });

  return actions;
}

export function getLegalDestinations(state: GameState, from: number): number[] {
  return state.board
    .map((_cell, index) => index)
    .filter((to) => isLegalMove(state, from, to));
}

export function applyAction(state: GameState, action: Action): GameState {
  if (!getLegalActions(state).some((candidate) => sameAction(candidate, action))) {
    return state;
  }

  const next = cloneState(state);
  let logEntry = "";
  let madeProgress = action.type === "flip";

  if (action.type === "flip") {
    const piece = next.board[action.at].base!;
    piece.revealed = true;
    logEntry = `${CAMP_LABEL[piece.camp]}方翻出${RANK_LABEL[piece.rank]}`;
  } else {
    const source = next.board[action.from];
    const target = next.board[action.to];
    const mover = getActivePiece(source)!;
    removeActivePiece(source);

    if (target.guest) {
      const defender = target.guest;
      madeProgress = true;
      next.fallen[defender.camp].push(defender);
      target.guest = mover;
      target.guestMode = "above";
      logEntry = `${CAMP_LABEL[mover.camp]}${RANK_LABEL[mover.rank]}吃${CAMP_LABEL[defender.camp]}${RANK_LABEL[defender.rank]}`;
    } else if (target.base && !target.base.revealed) {
      target.guest = mover;
      target.guestMode = mover.rank === "rat" ? "below" : "above";
      logEntry = `${CAMP_LABEL[mover.camp]}${RANK_LABEL[mover.rank]}${mover.rank === "dog" ? "急跳墙" : mover.rank === "cat" ? "上墙" : "钻洞"}`;
    } else if (target.base) {
      const defender = target.base;
      madeProgress = true;
      if (mover.rank === defender.rank) {
        next.fallen[mover.camp].push(mover);
        next.fallen[defender.camp].push(defender);
        target.base = null;
        logEntry = `${RANK_LABEL[mover.rank]}与${RANK_LABEL[defender.rank]}同归`;
      } else {
        next.fallen[defender.camp].push(defender);
        target.base = mover;
        logEntry = `${CAMP_LABEL[mover.camp]}${RANK_LABEL[mover.rank]}吃${CAMP_LABEL[defender.camp]}${RANK_LABEL[defender.rank]}`;
      }
    } else {
      target.base = mover;
      logEntry = `${CAMP_LABEL[mover.camp]}${RANK_LABEL[mover.rank]}移位`;
    }
  }

  next.log.unshift(logEntry);
  next.log = next.log.slice(0, 12);
  next.lastAction = action;
  next.halfmoveClock = madeProgress ? 0 : next.halfmoveClock + 1;
  next.moveNumber += 1;

  const redRemaining = countPieces(next, "red");
  const blackRemaining = countPieces(next, "black");
  if (redRemaining === 0 && blackRemaining === 0) {
    next.status = "draw";
    return next;
  }
  if (redRemaining === 0 || blackRemaining === 0) {
    next.status = "won";
    next.winner = redRemaining > 0 ? "red" : "black";
    return next;
  }
  if (next.halfmoveClock >= 80) {
    next.status = "draw";
    return next;
  }

  next.turn = opposite(state.turn);
  if (getLegalActions(next).length === 0) {
    const skippedCamp = next.turn;
    next.turn = state.turn;
    if (getLegalActions(next).length === 0) {
      next.status = "draw";
    } else {
      next.log.unshift(`${CAMP_LABEL[skippedCamp]}方无子可动，交回${CAMP_LABEL[next.turn]}方`);
      next.log = next.log.slice(0, 12);
    }
  }

  return next;
}

export function countPieces(state: GameState, camp: Camp): number {
  return state.board.reduce((count, cell) => {
    return count + Number(cell.base?.camp === camp) + Number(cell.guest?.camp === camp);
  }, 0);
}

export function isLegalMove(state: GameState, from: number, to: number): boolean {
  if (from === to || from < 0 || to < 0 || from >= state.board.length || to >= state.board.length) {
    return false;
  }

  const source = state.board[from];
  const target = state.board[to];
  const mover = getActivePiece(source);
  if (!mover || mover.camp !== state.turn) return false;

  const fromRow = Math.floor(from / COLS);
  const fromCol = from % COLS;
  const toRow = Math.floor(to / COLS);
  const toCol = to % COLS;
  const rowDistance = Math.abs(toRow - fromRow);
  const colDistance = Math.abs(toCol - fromCol);
  const orthogonalStep = rowDistance + colDistance === 1;
  const lionDiagonal = mover.rank === "lion" && rowDistance === 1 && colDistance === 1;
  const lionLeap =
    mover.rank === "lion" &&
    ((rowDistance === 2 && colDistance === 0) || (rowDistance === 0 && colDistance === 2));

  if (!orthogonalStep && !lionDiagonal && !lionLeap) return false;

  if (target.guest) {
    return mover.rank === "dog" && target.guest.rank === "cat" && target.guest.camp !== mover.camp;
  }
  if (target.base && !target.base.revealed) {
    return orthogonalStep && (mover.rank === "cat" || mover.rank === "dog" || mover.rank === "rat");
  }
  if (!target.base) return true;
  if (target.base.camp === mover.camp) return false;
  return canCapture(mover.rank, target.base.rank);
}

function removeActivePiece(cell: Cell): void {
  if (cell.guest) {
    cell.guest = null;
    cell.guestMode = null;
  } else {
    cell.base = null;
  }
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    board: state.board.map((cell) => ({
      base: cell.base ? { ...cell.base } : null,
      guest: cell.guest ? { ...cell.guest } : null,
      guestMode: cell.guestMode,
    })),
    fallen: {
      red: state.fallen.red.map((piece) => ({ ...piece })),
      black: state.fallen.black.map((piece) => ({ ...piece })),
    },
    log: [...state.log],
    lastAction: state.lastAction ? { ...state.lastAction } : null,
  };
}

function sameAction(left: Action, right: Action): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "flip" && right.type === "flip") return left.at === right.at;
  if (left.type === "move" && right.type === "move") {
    return left.from === right.from && left.to === right.to;
  }
  return false;
}

function opposite(camp: Camp): Camp {
  return camp === "red" ? "black" : "red";
}
