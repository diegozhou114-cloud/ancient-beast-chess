import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { isIP } from "node:net";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { loadConfig, type ServerConfig } from "./config.js";
import { jsonLogger, type Logger } from "./logger.js";
import { clientMessageSchema, PROTOCOL_VERSION, SERVER_VERSION } from "./protocol.js";
import { ProtocolError, RoomManager, type ClientPeer } from "./room-manager.js";

interface ConnectionSession extends ClientPeer {
  socket: WebSocket;
  alive: boolean;
  messageLimiter: WindowLimiter;
  actionLimiter: WindowLimiter;
}

export interface ServerAddress {
  host: string;
  port: number;
}

export interface CreateServerOptions {
  config?: Partial<ServerConfig>;
  logger?: Logger;
  now?: () => number;
}

export class AncientBeastServer {
  readonly config: ServerConfig;
  readonly manager: RoomManager;

  private readonly logger: Logger;
  private readonly httpServer: HttpServer;
  private readonly websocketServer: WebSocketServer;
  private readonly sessions = new Set<ConnectionSession>();
  private readonly connectionLimiter: KeyedWindowLimiter;
  private readonly roomOperationLimiter: KeyedWindowLimiter;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private started = false;
  private stopping = false;
  private startedAt = Date.now();

  constructor(options: CreateServerOptions = {}) {
    this.config = { ...loadConfig(), ...options.config };
    this.logger = options.logger ?? jsonLogger;
    this.manager = new RoomManager(this.config, this.logger, options.now);
    this.connectionLimiter = new KeyedWindowLimiter(this.config.connectionRateLimit, 60_000);
    this.roomOperationLimiter = new KeyedWindowLimiter(this.config.roomOperationRateLimit, 60_000);
    this.httpServer = createServer((request, response) => this.handleHttp(request, response));
    this.websocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: this.config.maxMessageBytes,
      perMessageDeflate: false,
      clientTracking: false,
    });
    this.httpServer.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
    this.websocketServer.on("connection", (socket, request) => this.handleConnection(socket, request));
  }

  async start(): Promise<ServerAddress> {
    if (this.started) return this.address()!;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.httpServer.once("error", onError);
      this.httpServer.listen(this.config.port, this.config.host, () => {
        this.httpServer.off("error", onError);
        resolve();
      });
    });
    this.started = true;
    this.startedAt = Date.now();
    this.cleanupTimer = setInterval(() => this.manager.runMaintenance(), this.config.cleanupIntervalMs);
    this.cleanupTimer.unref();
    this.heartbeatTimer = setInterval(() => this.runHeartbeat(), this.config.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
    const address = this.address()!;
    this.logger.log("info", "server_started", {
      host: address.host,
      port: address.port,
      serverVersion: SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    });
    return address;
  }

  async stop(): Promise<void> {
    if (!this.started || this.stopping) return;
    this.stopping = true;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.cleanupTimer = null;
    this.heartbeatTimer = null;
    for (const session of this.sessions) session.socket.terminate();

    await Promise.all([
      new Promise<void>((resolve) => this.websocketServer.close(() => resolve())),
      new Promise<void>((resolve) => this.httpServer.close(() => resolve())),
    ]);
    this.httpServer.closeAllConnections();
    this.started = false;
    this.stopping = false;
    this.logger.log("info", "server_stopped");
  }

  address(): ServerAddress | null {
    const address = this.httpServer.address();
    if (!address || typeof address === "string") return null;
    return { host: address.address, port: address.port };
  }

  runMaintenance(): void {
    this.manager.runMaintenance();
  }

  stats() {
    return {
      serverVersion: SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      online: this.manager.connectedPlayerCount,
      connections: this.sessions.size,
      rooms: this.manager.roomCount,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1_000),
      storage: "memory" as const,
    };
  }

  private handleHttp(request: IncomingMessage, response: import("node:http").ServerResponse): void {
    if (request.method !== "GET") {
      this.sendJson(response, 405, { error: "method_not_allowed" }, { Allow: "GET" });
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/health") {
      this.sendJson(response, 200, { status: "ok", ...this.stats() });
      return;
    }
    if (pathname === "/info") {
      this.sendJson(response, 200, {
        name: "Ancient Beast Chess Server",
        ...this.stats(),
        websocketPath: "/ws",
        roomCapacity: 2,
        limits: {
          maxRooms: this.config.maxRooms,
          maxConnections: this.config.maxConnections,
          maxMessageBytes: this.config.maxMessageBytes,
        },
      });
      return;
    }
    if (pathname === "/") {
      const stats = this.stats();
      const html = statusPage(stats);
      response.writeHead(200, securityHeaders({
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html),
      }));
      response.end(html);
      return;
    }
    this.sendJson(response, 404, { error: "not_found" });
  }

  private sendJson(
    response: import("node:http").ServerResponse,
    status: number,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): void {
    const json = JSON.stringify(body);
    response.writeHead(status, securityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(json),
      "Cache-Control": "no-store",
      ...extraHeaders,
    }));
    response.end(json);
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/ws") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    const ip = clientIp(request, this.config.trustProxy);
    if (!this.connectionLimiter.allow(ip)) {
      rejectUpgrade(socket, 429, "Too Many Requests");
      this.logger.log("warn", "connection_rate_limited", { ip });
      return;
    }
    if (this.sessions.size >= this.config.maxConnections) {
      rejectUpgrade(socket, 503, "Server Full");
      this.logger.log("warn", "connection_rejected_full", { ip });
      return;
    }

    this.websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      this.websocketServer.emit("connection", websocket, request);
    });
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const session = this.newSession(socket, clientIp(request, this.config.trustProxy));
    this.sessions.add(session);
    session.send({
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      serverVersion: SERVER_VERSION,
      connectionId: session.id,
    });
    socket.on("pong", () => {
      session.alive = true;
    });
    socket.on("message", (data, isBinary) => this.handleMessage(session, data, isBinary));
    socket.on("close", (code) => {
      this.sessions.delete(session);
      this.manager.disconnect(session);
      this.logger.log("info", "connection_closed", { connectionId: session.id, code });
    });
    socket.on("error", (error) => {
      this.logger.log("warn", "websocket_error", { connectionId: session.id, message: error.message });
    });
    this.logger.log("info", "connection_opened", { connectionId: session.id, ip: session.ip });
  }

  private newSession(socket: WebSocket, ip: string): ConnectionSession {
    return {
      id: randomUUID(),
      ip,
      roomCode: null,
      seat: null,
      socket,
      alive: true,
      messageLimiter: new WindowLimiter(180, 60_000),
      actionLimiter: new WindowLimiter(this.config.actionRateLimit, 10_000),
      send(message) {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      },
      close(code, reason) {
        if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
      },
    };
  }

  private handleMessage(session: ConnectionSession, data: RawData, isBinary: boolean): void {
    if (!session.messageLimiter.allow()) {
      this.sendError(session, "RATE_LIMITED", "Message rate limit exceeded");
      return;
    }
    if (isBinary) {
      this.sendError(session, "INVALID_MESSAGE", "Binary messages are not supported");
      session.close(1003, "Text messages required");
      return;
    }
    if (rawDataLength(data) > this.config.maxMessageBytes) {
      session.close(1009, "Message too large");
      return;
    }

    let input: unknown;
    try {
      input = JSON.parse(rawDataText(data));
    } catch {
      this.sendError(session, "INVALID_MESSAGE", "Message must be valid JSON");
      return;
    }
    const result = clientMessageSchema.safeParse(input);
    if (!result.success) {
      this.sendError(session, "INVALID_MESSAGE", "Message does not match the protocol schema");
      return;
    }

    const message = result.data;
    try {
      switch (message.type) {
        case "create_room":
          this.assertRoomOperationAllowed(session);
          this.manager.createRoom(session, message.requestId);
          break;
        case "join_room":
          this.assertRoomOperationAllowed(session);
          this.manager.joinRoom(session, message.roomCode, message.requestId);
          break;
        case "resume":
          this.assertRoomOperationAllowed(session);
          this.manager.resume(session, message.roomCode, message.reconnectToken, message.requestId);
          break;
        case "ready":
          this.manager.setReady(session, message.ready);
          break;
        case "action":
          if (!session.actionLimiter.allow()) throw new ProtocolError("RATE_LIMITED", "Action rate limit exceeded");
          this.manager.applyPlayerAction(session, message.version, message.action);
          break;
        case "resign":
          this.manager.resign(session);
          break;
        case "leave_room":
          this.manager.leaveRoom(session);
          break;
      }
    } catch (error) {
      if (error instanceof ProtocolError) {
        this.sendError(session, error.code, error.message, message.requestId);
        return;
      }
      this.logger.log("error", "message_handler_failed", {
        connectionId: session.id,
        messageType: message.type,
        message: error instanceof Error ? error.message : String(error),
      });
      this.sendError(session, "INTERNAL_ERROR", "Internal server error", message.requestId);
    }
  }

  private assertRoomOperationAllowed(session: ConnectionSession): void {
    if (!this.roomOperationLimiter.allow(session.ip)) {
      throw new ProtocolError("RATE_LIMITED", "Room operation rate limit exceeded");
    }
  }

  private sendError(session: ConnectionSession, code: import("./protocol.js").ErrorCode, message: string, requestId?: string): void {
    session.send({ type: "error", code, message, requestId });
    this.logger.log(code === "INTERNAL_ERROR" ? "error" : "warn", "protocol_error", {
      connectionId: session.id,
      roomCode: session.roomCode,
      code,
    });
  }

  private runHeartbeat(): void {
    for (const session of this.sessions) {
      if (!session.alive) {
        session.socket.terminate();
        continue;
      }
      session.alive = false;
      session.socket.ping();
    }
  }
}

export function createAncientBeastServer(options: CreateServerOptions = {}): AncientBeastServer {
  return new AncientBeastServer(options);
}

class WindowLimiter {
  private windowStartedAt: number;
  private count = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    startedAt = Date.now(),
  ) {
    this.windowStartedAt = startedAt;
  }

  allow(now = Date.now()): boolean {
    if (now - this.windowStartedAt >= this.windowMs) {
      this.windowStartedAt = now;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= this.limit;
  }

  isExpired(now: number): boolean {
    return now - this.windowStartedAt >= this.windowMs;
  }
}

export class KeyedWindowLimiter {
  private readonly entries = new Map<string, WindowLimiter>();
  private nextPruneAt: number;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.nextPruneAt = this.now() + this.windowMs;
  }

  get entryCount(): number {
    return this.entries.size;
  }

  allow(key: string): boolean {
    const now = this.now();
    if (now >= this.nextPruneAt) {
      for (const [entryKey, limiter] of this.entries) {
        if (limiter.isExpired(now)) this.entries.delete(entryKey);
      }
      this.nextPruneAt = now + this.windowMs;
    }

    let limiter = this.entries.get(key);
    if (!limiter) {
      limiter = new WindowLimiter(this.limit, this.windowMs, now);
      this.entries.set(key, limiter);
    }
    return limiter.allow(now);
  }
}

function rawDataLength(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((total, part) => total + part.byteLength, 0);
  return data.byteLength;
}

function rawDataText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString("utf8");
  return data.toString("utf8");
}

function clientIp(request: IncomingMessage, trustProxy: boolean): string {
  const remoteAddress = request.socket.remoteAddress ?? "unknown";
  if (!trustProxy) return remoteAddress;

  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const candidate = value?.split(",", 1)[0].trim();
  return candidate && isIP(candidate) ? candidate : remoteAddress;
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function securityHeaders(headers: Record<string, string | number>): Record<string, string | number> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    ...headers,
  };
}

function statusPage(stats: ReturnType<AncientBeastServer["stats"]>): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ancient Beast Chess Server</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; color: #202124; background: #f4f5f2; font: 16px/1.5 system-ui, sans-serif; }
    header { padding: 28px max(24px, calc((100% - 880px) / 2)); color: #fff; background: #262626; border-bottom: 4px solid #a92d2d; }
    h1 { margin: 0; font-size: 28px; letter-spacing: 0; }
    header p { margin: 6px 0 0; color: #d7d7d7; }
    main { max-width: 880px; margin: 0 auto; padding: 32px 24px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d7d9d4; }
    th, td { padding: 14px 16px; text-align: left; border-bottom: 1px solid #e3e4e0; }
    th { width: 42%; font-weight: 600; color: #555; }
    .ok { color: #157347; font-weight: 700; }
    footer { margin-top: 20px; color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <header><h1>Ancient Beast Chess Server</h1><p>Authoritative multiplayer service</p></header>
  <main>
    <table>
      <tr><th>Status</th><td class="ok">Healthy</td></tr>
      <tr><th>Server version</th><td>${stats.serverVersion}</td></tr>
      <tr><th>Protocol</th><td>${stats.protocolVersion}</td></tr>
      <tr><th>Online players</th><td>${stats.online}</td></tr>
      <tr><th>Open connections</th><td>${stats.connections}</td></tr>
      <tr><th>Rooms</th><td>${stats.rooms}</td></tr>
      <tr><th>Storage</th><td>In memory</td></tr>
    </table>
    <footer>WebSocket endpoint: /ws</footer>
  </main>
</body>
</html>`;
}
