import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyState, makePiece } from "../src/game";
import {
  CLIENT_VERSION,
  ONLINE_PROTOCOL_VERSION,
  ONLINE_SESSION_KEY,
  OnlineConnection,
  OnlineCompatibilityError,
  getOnlineLegalDestinations,
  getOnlineCompatibilityError,
  isValidRoomCode,
  loadOnlineSession,
  normalizeRoomCode,
  normalizeServerAddress,
  parseServerMessage,
  saveOnlineSession,
  type ConnectionState,
  type PublicGameState,
} from "../src/online";

class TestWebSocket {
  static instances: TestWebSocket[] = [];

  readyState = 0;
  closeCode: number | null = null;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>();

  constructor(readonly url: string) {
    TestWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999)) {
      throw new Error(`Invalid WebSocket close code: ${code}`);
    }
    this.closeCode = code ?? null;
    this.readyState = 3;
    this.emit("close", {});
  }

  emitWelcome(serverVersion: string): void {
    this.readyState = 1;
    this.emit("message", {
      data: JSON.stringify({
        type: "welcome",
        protocolVersion: ONLINE_PROTOCOL_VERSION,
        serverVersion,
        connectionId: "connection-1",
      }),
    });
  }

  private emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

afterEach(() => {
  TestWebSocket.instances = [];
  vi.unstubAllGlobals();
});

describe("online connection input", () => {
  it("accepts only a server with the same protocol and game version", () => {
    const welcome = {
      type: "welcome" as const,
      protocolVersion: ONLINE_PROTOCOL_VERSION,
      serverVersion: CLIENT_VERSION,
      connectionId: "connection-1",
    };

    expect(getOnlineCompatibilityError(welcome)).toBeNull();
    const protocolError = getOnlineCompatibilityError({ ...welcome, protocolVersion: "abc-ws/1" });
    expect(protocolError).toBeInstanceOf(OnlineCompatibilityError);
    expect(protocolError).toMatchObject({
      code: "PROTOCOL_MISMATCH",
      expected: ONLINE_PROTOCOL_VERSION,
      actual: "abc-ws/1",
    });
    const versionError = getOnlineCompatibilityError({ ...welcome, serverVersion: "0.0.3" });
    expect(versionError).toBeInstanceOf(OnlineCompatibilityError);
    expect(versionError).toMatchObject({
      code: "SERVER_VERSION_MISMATCH",
      expected: CLIENT_VERSION,
      actual: "0.0.3",
    });
  });

  it("closes a mismatched connection before a room operation can be sent", async () => {
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("WebSocket", TestWebSocket);
    const states: ConnectionState[] = [];
    const connection = new OnlineConnection({
      onMessage: vi.fn(),
      onState: (state) => states.push(state),
    });

    const connecting = connection.connect("ws://127.0.0.1:8791/ws");
    const socket = TestWebSocket.instances[0];
    socket.emitWelcome("0.0.3");

    await expect(connecting).rejects.toMatchObject({ code: "SERVER_VERSION_MISMATCH" });
    expect(socket.closeCode).toBe(4002);
    expect(states).toEqual(["idle", "connecting", "closed"]);
    expect(connection.send({ type: "create_room" })).toBe(false);
    expect(socket.sent).toEqual([]);
  });

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
