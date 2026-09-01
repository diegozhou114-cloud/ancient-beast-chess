import { describe, expect, it } from "vitest";
import { createEmptyState, makePiece } from "../src/game";
import {
  ONLINE_SESSION_KEY,
  getOnlineLegalDestinations,
  isValidRoomCode,
  loadOnlineSession,
  normalizeRoomCode,
  normalizeServerAddress,
  saveOnlineSession,
  type PublicGameState,
} from "../src/online";

describe("online connection input", () => {
  it("normalizes server addresses without embedding a deployment endpoint", () => {
    expect(normalizeServerAddress("127.0.0.1:8787")).toBe("ws://127.0.0.1:8787/ws");
    expect(normalizeServerAddress("https://game.example.test/socket")).toBe("wss://game.example.test/socket");
    expect(() => normalizeServerAddress("ftp://example.test")).toThrow();
    expect(() => normalizeServerAddress("ws://user:pass@example.test")).toThrow();
  });

  it("normalizes and validates room codes", () => {
    expect(normalizeRoomCode(" ab c234 ")).toBe("ABC234");
    expect(isValidRoomCode("ABC234")).toBe(true);
    expect(isValidRoomCode("ABC01I")).toBe(false);
  });

  it("stores reconnect credentials only in the supplied session storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } as unknown as Storage;
    const session = { endpoint: "ws://127.0.0.1:8787/ws", roomCode: "ABC234", reconnectToken: "secret", seat: "red" as const };

    saveOnlineSession(storage, session);

    expect(values.has(ONLINE_SESSION_KEY)).toBe(true);
    expect(loadOnlineSession(storage)).toEqual(session);
  });

  it("continues without persistence when browser storage is unavailable", () => {
    const storage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    } as unknown as Storage;

    expect(loadOnlineSession(storage)).toBeNull();
    expect(() => saveOnlineSession(storage, { endpoint: "ws://127.0.0.1:8787/ws", roomCode: "ABC234", reconnectToken: "token", seat: "red" })).not.toThrow();
  });
});

describe("public online move hints", () => {
  it("calculates visible movement without knowing a hidden base identity", () => {
    const local = createEmptyState();
    local.board[0].base = makePiece("red", "dog");
    local.board[1].base = makePiece("black", "elephant", false);
    local.board[4].base = makePiece("black", "cat");
    const state = local as unknown as PublicGameState;
    state.board[1].base = { revealed: false };

    expect(getOnlineLegalDestinations(state, 0)).toEqual(expect.arrayContaining([1, 4]));
  });
});
