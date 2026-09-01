import { describe, expect, it } from "vitest";
import { createEmptyState, makePiece } from "../src/game";
import {
  ONLINE_SESSION_KEY,
  getOnlineLegalDestinations,
  isValidRoomCode,
  loadOnlineSession,
  normalizeRoomCode,
  normalizeServerAddress,
  parseServerMessage,
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

  it("accepts valid join approval events and rejects malformed ones", () => {
    expect(parseServerMessage(JSON.stringify({ type: "join_pending", roomCode: "ABC234" }))).toEqual({
      type: "join_pending",
      roomCode: "ABC234",
    });
    expect(parseServerMessage(JSON.stringify({ type: "join_requested", roomCode: "ABC234", joinRequestId: "request-1" }))).toMatchObject({
      type: "join_requested",
      joinRequestId: "request-1",
    });
    expect(parseServerMessage(JSON.stringify({ type: "join_rejected", roomCode: "ABC234", reason: "timeout" }))).toMatchObject({
      type: "join_rejected",
      reason: "timeout",
    });
    expect(parseServerMessage(JSON.stringify({ type: "join_rejected", roomCode: "ABC234", reason: "unknown" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "join_requested", roomCode: "ABC234", joinRequestId: "x".repeat(65) }))).toBeNull();
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
    const session = { endpoint: "ws://127.0.0.1:8787/ws", roomCode: "ABC234", reconnectToken: "secret", seat: "red" as const, networkMode: "lan" as const };

    saveOnlineSession(storage, session);

    expect(values.has(ONLINE_SESSION_KEY)).toBe(true);
    expect(loadOnlineSession(storage)).toEqual(session);
  });

  it("loads sessions from older clients as public-server sessions", () => {
    const legacy = { endpoint: "wss://game.example.test/ws", roomCode: "ABC234", reconnectToken: "secret", seat: "black" };
    const storage = {
      getItem: () => JSON.stringify(legacy),
    } as unknown as Storage;

    expect(loadOnlineSession(storage)).toEqual({ ...legacy, networkMode: "remote" });
  });

  it("continues without persistence when browser storage is unavailable", () => {
    const storage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    } as unknown as Storage;

    expect(loadOnlineSession(storage)).toBeNull();
    expect(() => saveOnlineSession(storage, { endpoint: "ws://127.0.0.1:8787/ws", roomCode: "ABC234", reconnectToken: "token", seat: "red", networkMode: "remote" })).not.toThrow();
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
