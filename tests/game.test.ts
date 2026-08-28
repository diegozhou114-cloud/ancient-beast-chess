import { describe, expect, it } from "vitest";
import { AI_DIFFICULTIES, chooseAiAction } from "../src/ai";
import {
  RANKS,
  applyAction,
  canCapture,
  countPieces,
  createEmptyState,
  createGame,
  getLegalActions,
  getLegalDestinations,
  makePiece,
} from "../src/game";

describe("initial setup", () => {
  it("fills the 4x5 board with one of every rank per camp, all face down", () => {
    const state = createGame(() => 0.42);
    const pieces = state.board.flatMap((cell) => (cell.base ? [cell.base] : []));

    expect(pieces).toHaveLength(20);
    expect(pieces.every((piece) => !piece.revealed)).toBe(true);
    expect(new Set(pieces.map((piece) => piece.id)).size).toBe(20);
    for (const rank of RANKS) {
      expect(pieces.filter((piece) => piece.rank === rank)).toHaveLength(2);
    }
  });
});

describe("capture hierarchy", () => {
  it("allows stronger pieces to capture weaker pieces and equal pieces to trade", () => {
    expect(canCapture("lion", "tiger")).toBe(true);
    expect(canCapture("dog", "lion")).toBe(false);
    expect(canCapture("wolf", "wolf")).toBe(true);

    const state = createEmptyState();
    state.board[0].base = makePiece("red", "wolf");
    state.board[1].base = makePiece("black", "wolf");
    const next = applyAction(state, { type: "move", from: 0, to: 1 });

    expect(next.board[0].base).toBeNull();
    expect(next.board[1].base).toBeNull();
    expect(next.fallen.red[0].rank).toBe("wolf");
    expect(next.fallen.black[0].rank).toBe("wolf");
  });

  it("lets the rat defeat the elephant but not the reverse", () => {
    expect(canCapture("rat", "elephant")).toBe(true);
    expect(canCapture("elephant", "rat")).toBe(false);
  });
});

describe("special movement", () => {
  it("lets a lion step diagonally and leap two orthogonal cells", () => {
    const state = createEmptyState();
    state.board[5].base = makePiece("red", "lion");

    expect(getLegalDestinations(state, 5)).toEqual(expect.arrayContaining([0, 2, 8, 10, 13, 7]));
    expect(getLegalDestinations(state, 5)).not.toContain(15);
  });

  it("lets a cat climb onto a hidden piece and locks that piece until the cat leaves", () => {
    const state = createEmptyState();
    state.board[0].base = makePiece("red", "cat");
    state.board[1].base = makePiece("black", "tiger", false);

    const perched = applyAction(state, { type: "move", from: 0, to: 1 });
    expect(perched.board[1].base?.revealed).toBe(false);
    expect(perched.board[1].guest?.rank).toBe("cat");
    expect(perched.board[1].guestMode).toBe("above");
    expect(getLegalActions(perched).some((action) => action.type === "flip" && action.at === 1)).toBe(false);
    expect(perched.turn).toBe("red");

    const leftWall = applyAction(perched, { type: "move", from: 1, to: 0 });
    expect(leftWall.board[1].guest).toBeNull();
    expect(leftWall.board[1].base?.revealed).toBe(false);
    expect(leftWall.board[0].base?.rank).toBe("cat");
  });

  it("lets a dog use dog urgent wall-jump onto a hidden piece", () => {
    const state = createEmptyState();
    state.board[0].base = makePiece("red", "dog");
    state.board[1].base = makePiece("black", "tiger", false);

    const perched = applyAction(state, { type: "move", from: 0, to: 1 });
    expect(perched.board[1].guest?.rank).toBe("dog");
    expect(perched.board[1].guestMode).toBe("above");
    expect(perched.log).toContain("朱狗急跳墙");
    expect(getLegalActions(perched)).not.toContainEqual({ type: "flip", at: 1 });
  });

  it("lets a dog on a wall capture an enemy cat on an adjacent wall", () => {
    const state = createEmptyState();
    state.board[0].base = makePiece("red", "elephant", false);
    state.board[0].guest = makePiece("red", "dog");
    state.board[0].guestMode = "above";
    state.board[1].base = makePiece("black", "tiger", false);
    state.board[1].guest = makePiece("black", "cat");
    state.board[1].guestMode = "above";

    expect(getLegalDestinations(state, 0)).toContain(1);
    const captured = applyAction(state, { type: "move", from: 0, to: 1 });

    expect(captured.board[0].guest).toBeNull();
    expect(captured.board[1].base?.revealed).toBe(false);
    expect(captured.board[1].guest?.rank).toBe("dog");
    expect(captured.board[1].guestMode).toBe("above");
    expect(captured.fallen.black.map((piece) => piece.rank)).toContain("cat");
    expect(captured.log).toContain("朱狗吃墨猫");
  });

  it("puts a rat below a hidden piece", () => {
    const state = createEmptyState();
    state.board[4].base = makePiece("red", "rat");
    state.board[5].base = makePiece("black", "human", false);

    const burrowed = applyAction(state, { type: "move", from: 4, to: 5 });
    expect(burrowed.board[5].guest?.rank).toBe("rat");
    expect(burrowed.board[5].guestMode).toBe("below");
  });
});

describe("turns and AI", () => {
  it("uses one action per turn and AI always returns a legal action", () => {
    const state = createGame(() => 0.25);
    const afterFlip = applyAction(state, { type: "flip", at: 0 });
    expect(afterFlip.turn).toBe("black");
    expect(afterFlip.moveNumber).toBe(2);

    expect(AI_DIFFICULTIES).toEqual(["gudiao", "zhuyan", "aoyin", "xiangliu", "qiongqi"]);
    AI_DIFFICULTIES.forEach((difficulty) => {
      const action = chooseAiAction(afterFlip, difficulty, () => 0.1);
      expect(action).not.toBeNull();
      expect(getLegalActions(afterFlip)).toContainEqual(action);
    });

    expect(getLegalActions(afterFlip)).toContainEqual(chooseAiAction(afterFlip, () => 0.1));
  });

  it("lets the AI control the red camp and take the opening turn", () => {
    const state = createGame(() => 0.25);

    AI_DIFFICULTIES.forEach((difficulty) => {
      const action = chooseAiAction(state, difficulty, () => 0.1, "red");
      expect(action).not.toBeNull();
      expect(getLegalActions(state, "red")).toContainEqual(action);
    });
  });

  it("lets search-based AI avoid a capture that is immediately lost to a stronger reply", () => {
    const state = createEmptyState("black");
    state.board[0].base = makePiece("black", "dog");
    state.board[1].base = makePiece("red", "cat");
    state.board[2].base = makePiece("red", "human");
    state.board[4].base = makePiece("black", "wolf");
    state.board[5].base = makePiece("red", "rat");

    expect(chooseAiAction(state, "zhuyan", () => 0)).toEqual({ type: "move", from: 0, to: 1 });
    (["aoyin", "xiangliu", "qiongqi"] as const).forEach((difficulty) => {
      expect(chooseAiAction(state, difficulty, () => 0)).toEqual({ type: "move", from: 4, to: 5 });
    });
  });

  it("evaluates search from the red AI's point of view", () => {
    const state = createEmptyState("red");
    state.board[0].base = makePiece("red", "dog");
    state.board[1].base = makePiece("black", "cat");
    state.board[2].base = makePiece("black", "human");
    state.board[4].base = makePiece("red", "wolf");
    state.board[5].base = makePiece("black", "rat");

    expect(chooseAiAction(state, "zhuyan", () => 0, "red")).toEqual({ type: "move", from: 0, to: 1 });
    (["aoyin", "xiangliu", "qiongqi"] as const).forEach((difficulty) => {
      expect(chooseAiAction(state, difficulty, () => 0, "red")).toEqual({ type: "move", from: 4, to: 5 });
    });
  });

  it("ends the game when a camp loses its final piece", () => {
    const state = createEmptyState();
    state.board[0].base = makePiece("red", "human");
    state.board[1].base = makePiece("black", "dog");

    const next = applyAction(state, { type: "move", from: 0, to: 1 });
    expect(countPieces(next, "black")).toBe(0);
    expect(next.status).toBe("won");
    expect(next.winner).toBe("red");
  });
});
