import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createEmptyState, makePiece } from "../../src/game.js";
import { createAncientBeastServer, type AncientBeastServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import type { PublicSnapshot, ServerMessage } from "../src/protocol.js";
import { toPublicGameState } from "../src/room-manager.js";

type MessageOf<T extends ServerMessage["type"]> = Extract<ServerMessage, { type: T }>;

const silentLogger: Logger = { log() {} };

class TestClient {
  private readonly messages: ServerMessage[] = [];
  private readonly waiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (waiterIndex === -1) {
        this.messages.push(message);
        return;
      }
      const [waiter] = this.waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    });
  }

  static async connect(url: string, headers: Record<string, string> = {}): Promise<TestClient> {
    const socket = new WebSocket(url, { headers });
    const client = new TestClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    await client.next("welcome");
    return client;
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  next<T extends ServerMessage["type"]>(
    type: T,
    matches: (message: MessageOf<T>) => boolean = () => true,
  ): Promise<MessageOf<T>> {
    const predicate = (message: ServerMessage): boolean => {
      return message.type === type && matches(message as MessageOf<T>);
    };
    const queuedIndex = this.messages.findIndex(predicate);
    if (queuedIndex !== -1) {
      return Promise.resolve(this.messages.splice(queuedIndex, 1)[0] as MessageOf<T>);
    }
    return new Promise<MessageOf<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${type}`));
      }, 2_000);
      this.waiters.push({
        predicate,
        resolve: (message) => resolve(message as MessageOf<T>),
        reject,
        timer,
      });
    });
  }

  terminate(): void {
    if (this.socket.readyState !== WebSocket.CLOSED) this.socket.terminate();
  }
}

describe("Ancient Beast Chess server", () => {
  let server: AncientBeastServer;
  let httpUrl: string;
  let websocketUrl: string;
  let now: number;
  let clients: TestClient[];

  beforeEach(async () => {
    now = 1_800_000_000_000;
    clients = [];
    await startServer();
  });

  async function startServer(config: Partial<ServerConfig> = {}): Promise<void> {
    server = createAncientBeastServer({
      logger: silentLogger,
      now: () => now,
      config: {
        host: "127.0.0.1",
        port: 0,
        waitingTimeoutMs: 10_000,
        reconnectGraceMs: 5_000,
        endedRetentionMs: 2_000,
        cleanupIntervalMs: 60_000,
        heartbeatIntervalMs: 60_000,
        ...config,
      },
    });
    const address = await server.start();
    httpUrl = `http://127.0.0.1:${address.port}`;
    websocketUrl = `ws://127.0.0.1:${address.port}/ws`;
  }

  async function restartServer(config: Partial<ServerConfig>): Promise<void> {
    for (const client of clients) client.terminate();
    clients = [];
    await server.stop();
    await startServer(config);
  }

  afterEach(async () => {
    for (const client of clients) client.terminate();
    await server.stop();
  });

  async function connect(headers: Record<string, string> = {}): Promise<TestClient> {
    const client = await TestClient.connect(websocketUrl, headers);
    clients.push(client);
    return client;
  }

  async function rejectedConnectionStatus(headers: Record<string, string>): Promise<number> {
    const socket = new WebSocket(websocketUrl, { headers });
    return new Promise<number>((resolve, reject) => {
      socket.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      socket.once("open", () => {
        socket.terminate();
        reject(new Error("Expected the WebSocket handshake to be rejected"));
      });
      socket.once("error", () => {});
    });
  }

  async function startRoom(): Promise<{
    red: TestClient;
    black: TestClient;
    roomCode: string;
    redToken: string;
    blackToken: string;
    snapshot: PublicSnapshot;
  }> {
    const red = await connect();
    const black = await connect();
    red.send({ type: "create_room", requestId: "create" });
    const redJoined = await red.next("room_joined");
    black.send({ type: "join_room", roomCode: redJoined.roomCode, requestId: "join" });
    const blackJoined = await black.next("room_joined");
    await red.next("snapshot", (message) => message.snapshot.seats.black.occupied);

    red.send({ type: "ready", ready: true });
    await Promise.all([
      red.next("snapshot", (message) => message.snapshot.seats.red.ready),
      black.next("snapshot", (message) => message.snapshot.seats.red.ready),
    ]);
    black.send({ type: "ready", ready: true });
    const [redStarted, blackStarted] = await Promise.all([
      red.next("snapshot", (message) => message.snapshot.phase === "playing"),
      black.next("snapshot", (message) => message.snapshot.phase === "playing"),
    ]);
    expect(blackStarted.snapshot).toEqual(redStarted.snapshot);
    return {
      red,
      black,
      roomCode: redJoined.roomCode,
      redToken: redJoined.reconnectToken,
      blackToken: blackJoined.reconnectToken,
      snapshot: redStarted.snapshot,
    };
  }

  it("serves health, info, and the status page", async () => {
    const healthResponse = await fetch(`${httpUrl}/health`);
    const health = await healthResponse.json();
    expect(healthResponse.status).toBe(200);
    expect(health).toMatchObject({
      status: "ok",
      serverVersion: "0.0.3",
      protocolVersion: "abc-ws/1",
      online: 0,
      rooms: 0,
      storage: "memory",
    });

    const info = await (await fetch(`${httpUrl}/info`)).json() as {
      websocketPath: string;
      roomCapacity: number;
      limits: { maxMessageBytes: number };
    };
    expect(info).toMatchObject({ websocketPath: "/ws", roomCapacity: 2 });
    expect(info.limits.maxMessageBytes).toBe(16 * 1024);

    const statusPage = await (await fetch(httpUrl)).text();
    expect(statusPage).toContain("Ancient Beast Chess Server");
    expect(statusPage).toContain("Healthy");
  });

  it("ignores X-Forwarded-For by default when applying connection limits", async () => {
    await restartServer({ connectionRateLimit: 1, trustProxy: false });
    await connect({ "x-forwarded-for": "203.0.113.1" });

    expect(await rejectedConnectionStatus({ "x-forwarded-for": "203.0.113.2" })).toBe(429);
    expect(server.stats().connections).toBe(1);
  });

  it("limits distinct forwarded clients separately when trust proxy is enabled", async () => {
    await restartServer({ connectionRateLimit: 1, trustProxy: true });
    await connect({ "x-forwarded-for": "203.0.113.1" });
    await connect({ "x-forwarded-for": "203.0.113.2" });

    expect(server.stats().connections).toBe(2);
    expect(await rejectedConnectionStatus({ "x-forwarded-for": "203.0.113.1" })).toBe(429);
  });

  it("creates and joins a two-seat room and rejects a third player", async () => {
    const red = await connect();
    const black = await connect();
    const third = await connect();
    red.send({ type: "create_room" });
    const redJoined = await red.next("room_joined");
    expect(redJoined.seat).toBe("red");
    expect(redJoined.reconnectToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    black.send({ type: "join_room", roomCode: redJoined.roomCode });
    const blackJoined = await black.next("room_joined");
    expect(blackJoined.seat).toBe("black");
    expect(blackJoined.snapshot.seats).toMatchObject({
      red: { occupied: true, connected: true },
      black: { occupied: true, connected: true },
    });

    third.send({ type: "join_room", roomCode: redJoined.roomCode, requestId: "full" });
    const error = await third.next("error");
    expect(error).toMatchObject({ requestId: "full", code: "ROOM_FULL" });
  });

  it("releases a waiting seat when a player leaves explicitly", async () => {
    const red = await connect();
    const black = await connect();
    const replacement = await connect();
    red.send({ type: "create_room" });
    const created = await red.next("room_joined");
    black.send({ type: "join_room", roomCode: created.roomCode });
    await black.next("room_joined");
    await red.next("snapshot", (message) => message.snapshot.seats.black.occupied);

    black.send({ type: "leave_room" });
    await red.next("snapshot", (message) => !message.snapshot.seats.black.occupied);
    replacement.send({ type: "join_room", roomCode: created.roomCode });

    expect((await replacement.next("room_joined")).seat).toBe("black");
  });

  it("never exposes identities of face-down pieces in public snapshots", async () => {
    const { snapshot } = await startRoom();
    expect(snapshot.game?.board).toHaveLength(20);
    for (const cell of snapshot.game!.board) {
      expect(cell.base).toEqual({ revealed: false });
      expect(cell.guest).toBeNull();
    }
    expect(JSON.stringify(snapshot)).not.toContain("reconnectToken");
    expect(JSON.stringify(snapshot.game!.board)).not.toContain("\"camp\"");
    expect(JSON.stringify(snapshot.game!.board)).not.toContain("\"rank\"");
  });

  it("keeps a hidden base secret when a public piece is stacked on it", () => {
    const game = createEmptyState();
    game.board[0].base = makePiece("black", "tiger", false);
    game.board[0].guest = makePiece("red", "cat");
    game.board[0].guestMode = "above";

    const publicGame = toPublicGameState(game, null);
    expect(publicGame.board[0]).toEqual({
      base: { revealed: false },
      guest: { revealed: true, camp: "red", rank: "cat" },
      guestMode: "above",
    });
    expect(JSON.stringify(publicGame.board[0].base)).not.toContain("black");
    expect(JSON.stringify(publicGame.board[0].base)).not.toContain("tiger");
  });

  it("rejects unauthorized, illegal, and stale actions and synchronizes valid actions", async () => {
    const { red, black, snapshot } = await startRoom();

    black.send({ type: "action", version: snapshot.version, action: { type: "flip", at: 0 }, requestId: "turn" });
    expect(await black.next("error")).toMatchObject({ requestId: "turn", code: "OUT_OF_TURN" });

    red.send({ type: "action", version: snapshot.version, action: { type: "move", from: 0, to: 1 } });
    expect(await red.next("error")).toMatchObject({ code: "ILLEGAL_ACTION" });

    red.send({ type: "action", version: snapshot.version, action: { type: "flip", at: 0 } });
    const [redAfterFlip, blackAfterFlip] = await Promise.all([
      red.next("snapshot", (message) => message.snapshot.version > snapshot.version),
      black.next("snapshot", (message) => message.snapshot.version > snapshot.version),
    ]);
    expect(redAfterFlip.snapshot).toEqual(blackAfterFlip.snapshot);
    expect(redAfterFlip.snapshot.game!.board[0].base).toMatchObject({ revealed: true });

    red.send({ type: "action", version: snapshot.version, action: { type: "flip", at: 1 }, requestId: "stale" });
    expect(await red.next("error")).toMatchObject({ requestId: "stale", code: "STALE_VERSION" });

    black.send({
      type: "action",
      version: blackAfterFlip.snapshot.version,
      action: { type: "flip", at: 1 },
    });
    const [redSynced, blackSynced] = await Promise.all([
      red.next("snapshot", (message) => message.snapshot.version > redAfterFlip.snapshot.version),
      black.next("snapshot", (message) => message.snapshot.version > blackAfterFlip.snapshot.version),
    ]);
    expect(redSynced.snapshot.game).toEqual(blackSynced.snapshot.game);
    expect(redSynced.snapshot.game!.board[1].base).toMatchObject({ revealed: true });
  });

  it("validates message structure and room authorization", async () => {
    const client = await connect();
    client.send({ type: "ready", ready: true, unexpected: true });
    expect(await client.next("error")).toMatchObject({ code: "INVALID_MESSAGE" });

    client.send({ type: "ready", ready: true });
    expect(await client.next("error")).toMatchObject({ code: "NOT_IN_ROOM" });
  });

  it("restores a disconnected seat with the correct token and rejects a wrong token", async () => {
    const { red, black, roomCode, blackToken, snapshot } = await startRoom();
    black.terminate();
    const disconnected = await red.next("snapshot", (message) => !message.snapshot.seats.black.connected);
    expect(disconnected.snapshot.version).toBeGreaterThan(snapshot.version);
    expect(disconnected.snapshot.seats.black.reconnectDeadlineAt).toBe(now + 5_000);

    const attacker = await connect();
    attacker.send({ type: "resume", roomCode, reconnectToken: "x".repeat(43), requestId: "bad-token" });
    expect(await attacker.next("error")).toMatchObject({
      requestId: "bad-token",
      code: "INVALID_RECONNECT_TOKEN",
    });

    const resumed = await connect();
    resumed.send({ type: "resume", roomCode, reconnectToken: blackToken });
    const restored = await resumed.next("room_joined");
    expect(restored.seat).toBe("black");
    expect(restored.snapshot.seats.black.connected).toBe(true);
    expect(restored.snapshot.game).toEqual(disconnected.snapshot.game);
    const redRestored = await red.next("snapshot", (message) => message.snapshot.seats.black.connected);
    expect(redRestored.snapshot.version).toBe(restored.snapshot.version);
  });

  it("supports resignation and keeps the authoritative result", async () => {
    const { red, black } = await startRoom();
    red.send({ type: "resign" });
    const [redEnded, blackEnded] = await Promise.all([
      red.next("snapshot", (message) => message.snapshot.phase === "ended"),
      black.next("snapshot", (message) => message.snapshot.phase === "ended"),
    ]);
    expect(redEnded.snapshot).toEqual(blackEnded.snapshot);
    expect(redEnded.snapshot.outcome).toEqual({ winner: "black", reason: "resigned" });
    expect(redEnded.snapshot.game).toMatchObject({ status: "won", winner: "black" });
  });

  it("awards a disconnect timeout and removes the room after result retention", async () => {
    const { red, black } = await startRoom();
    black.terminate();
    await red.next("snapshot", (message) => !message.snapshot.seats.black.connected);

    now += 5_001;
    server.runMaintenance();
    const ended = await red.next("snapshot", (message) => message.snapshot.phase === "ended");
    expect(ended.snapshot.outcome).toEqual({ winner: "red", reason: "disconnect_timeout" });
    expect(server.stats().rooms).toBe(1);

    now += 2_001;
    server.runMaintenance();
    expect(await red.next("room_closed")).toMatchObject({ reason: "retention_expired" });
    expect(server.stats().rooms).toBe(0);
  });

  it("cleans up a room that waits too long for an opponent", async () => {
    const red = await connect();
    red.send({ type: "create_room" });
    await red.next("room_joined");
    now += 10_001;
    server.runMaintenance();
    expect(await red.next("room_closed")).toMatchObject({ reason: "waiting_timeout" });
    expect(server.stats()).toMatchObject({ online: 0, rooms: 0 });
  });
});
