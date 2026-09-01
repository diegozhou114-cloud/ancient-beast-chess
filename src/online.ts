import { COLS, RANKS, canCapture, type Action, type Camp, type GameStatus, type LayerMode, type Rank } from "./game";

export const ONLINE_PROTOCOL_VERSION = "abc-ws/1";
export const ONLINE_SESSION_KEY = "ancient-beast-chess.online-session.v1";

export interface PublicPiece {
  revealed: true;
  camp: Camp;
  rank: Rank;
}

export interface PublicHiddenPiece {
  revealed: false;
}

export interface PublicCell {
  base: PublicPiece | PublicHiddenPiece | null;
  guest: PublicPiece | null;
  guestMode: LayerMode | null;
}

export interface PublicGameState {
  board: PublicCell[];
  turn: Camp;
  status: GameStatus;
  winner: Camp | null;
  moveNumber: number;
  halfmoveClock: number;
  fallen: Record<Camp, PublicPiece[]>;
  log: string[];
  lastAction: Action | null;
}

export interface PublicSeat {
  occupied: boolean;
  ready: boolean;
  connected: boolean;
  reconnectDeadlineAt: number | null;
}

export interface PublicSnapshot {
  roomCode: string;
  version: number;
  phase: "waiting" | "playing" | "ended";
  seats: Record<Camp, PublicSeat>;
  game: PublicGameState | null;
  outcome: { winner: Camp | null; reason: string } | null;
}

export type ClientMessage =
  | { type: "create_room"; joinApproval?: boolean; requestId?: string }
  | { type: "join_room"; roomCode: string; requestId?: string }
  | { type: "accept_join"; joinRequestId: string; requestId?: string }
  | { type: "reject_join"; joinRequestId: string; requestId?: string }
  | { type: "cancel_join"; requestId?: string }
  | { type: "resume"; roomCode: string; reconnectToken: string; requestId?: string }
  | { type: "ready"; ready: boolean; requestId?: string }
  | { type: "action"; version: number; action: Action; requestId?: string }
  | { type: "resign"; requestId?: string }
  | { type: "leave_room"; requestId?: string };

export type ServerMessage =
  | { type: "welcome"; protocolVersion: string; serverVersion: string; connectionId: string }
  | { type: "room_joined"; requestId?: string; roomCode: string; seat: Camp; reconnectToken: string; snapshot: PublicSnapshot }
  | { type: "join_pending"; roomCode: string }
  | { type: "join_requested"; roomCode: string; joinRequestId: string }
  | { type: "join_rejected"; roomCode: string; reason: "rejected" | "cancelled" | "timeout" | "disconnected" | "host_unavailable" }
  | { type: "snapshot"; snapshot: PublicSnapshot }
  | { type: "room_closed"; roomCode: string; reason: string }
  | { type: "error"; requestId?: string; code: string; message: string };

export type OnlineNetworkMode = "lan" | "remote";

export interface OnlineSession {
  endpoint: string;
  roomCode: string;
  reconnectToken: string;
  seat: Camp;
  networkMode: OnlineNetworkMode;
}

export type ConnectionState = "idle" | "connecting" | "connected" | "closed";

export interface OnlineConnectionHandlers {
  onMessage(message: ServerMessage): void;
  onState(state: ConnectionState, intentional: boolean): void;
}

export class OnlineConnection {
  private socket: WebSocket | null = null;
  private readonly intentionalClosures = new WeakSet<WebSocket>();

  constructor(private readonly handlers: OnlineConnectionHandlers) {}

  connect(endpoint: string): Promise<void> {
    this.close();
    this.handlers.onState("connecting", false);

    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(endpoint);
      this.socket = socket;
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close(1000, "Connection timeout");
        reject(new Error("CONNECTION_TIMEOUT"));
      }, 7_000);

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        reject(error);
      };

      socket.addEventListener("message", (event) => {
        const message = parseServerMessage(event.data);
        if (!message) {
          fail(new Error("INVALID_SERVER_MESSAGE"));
          socket.close(1002, "Invalid server message");
          return;
        }
        if (!settled) {
          if (message.type !== "welcome") {
            fail(new Error("WELCOME_REQUIRED"));
            socket.close(1002, "Welcome required");
            return;
          }
          if (message.protocolVersion !== ONLINE_PROTOCOL_VERSION) {
            fail(new Error("PROTOCOL_MISMATCH"));
            socket.close(1002, "Protocol mismatch");
            return;
          }
          settled = true;
          window.clearTimeout(timeout);
          this.handlers.onState("connected", false);
          resolve();
        }
        this.handlers.onMessage(message);
      });
      socket.addEventListener("error", () => fail(new Error("CONNECTION_FAILED")));
      socket.addEventListener("close", () => {
        window.clearTimeout(timeout);
        if (!settled) fail(new Error("CONNECTION_CLOSED"));
        if (this.socket !== socket) return;
        this.socket = null;
        this.handlers.onState("closed", this.intentionalClosures.has(socket));
      });
    });
  }

  send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    if (this.socket) {
      this.intentionalClosures.add(this.socket);
      this.socket.close(1000, "Client closed");
    }
    this.socket = null;
    this.handlers.onState("idle", true);
  }
}

export function normalizeServerAddress(input: string): string {
  let value = input.trim();
  if (!value) throw new Error("EMPTY_SERVER_ADDRESS");
  if (value.startsWith("http://")) value = `ws://${value.slice(7)}`;
  else if (value.startsWith("https://")) value = `wss://${value.slice(8)}`;
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^wss?:\/\//i.test(value)) {
    throw new Error("INVALID_SERVER_ADDRESS");
  }
  else if (!/^wss?:\/\//i.test(value)) value = `ws://${value}`;

  const url = new URL(value);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("INVALID_SERVER_ADDRESS");
  if (!url.hostname || url.username || url.password) throw new Error("INVALID_SERVER_ADDRESS");
  if (url.pathname === "/") url.pathname = "/ws";
  url.hash = "";
  return url.toString();
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidRoomCode(roomCode: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(roomCode);
}

export function saveOnlineSession(storage: Storage, session: OnlineSession): void {
  try {
    storage.setItem(ONLINE_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Reconnection remains available until this page is closed.
  }
}

export function loadOnlineSession(storage: Storage): OnlineSession | null {
  try {
    const raw = storage.getItem(ONLINE_SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<OnlineSession>;
    if (typeof value.endpoint !== "string" || typeof value.reconnectToken !== "string") return null;
    if (typeof value.roomCode !== "string" || !isValidRoomCode(value.roomCode)) return null;
    if (value.seat !== "red" && value.seat !== "black") return null;
    if (!value.reconnectToken) return null;
    return {
      endpoint: value.endpoint,
      roomCode: value.roomCode,
      reconnectToken: value.reconnectToken,
      seat: value.seat,
      networkMode: value.networkMode === "lan" ? "lan" : "remote",
    };
  } catch {
    return null;
  }
}

export function clearOnlineSession(storage: Storage): void {
  try {
    storage.removeItem(ONLINE_SESSION_KEY);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function getOnlineLegalDestinations(state: PublicGameState, from: number): number[] {
  return state.board.map((_cell, index) => index).filter((to) => isOnlineLegalMove(state, from, to));
}

export function onlineErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    RATE_LIMITED: "操作太频繁，请稍后再试",
    SERVER_FULL: "服务器人数已满",
    ROOM_LIMIT_REACHED: "服务器房间已满",
    ROOM_NOT_FOUND: "没有找到这个房间",
    ROOM_FULL: "房间已经坐满",
    ROOM_NOT_JOINABLE: "房间已经开始或结束",
    INVALID_RECONNECT_TOKEN: "上次席位已经失效",
    STALE_VERSION: "棋局已更新，请按最新局面操作",
    ILLEGAL_ACTION: "这一步不符合棋规",
    OUT_OF_TURN: "还没有轮到你",
    NOT_PLAYING: "当前房间尚未开始",
    NOT_READYABLE: "当前不能更改准备状态",
    JOIN_APPROVAL_REQUIRED: "这个房间需要房主同意",
    JOIN_REQUEST_PENDING: "房间已有一位玩家等待房主处理",
    JOIN_REQUEST_NOT_FOUND: "加入申请已失效",
    NOT_ROOM_HOST: "只有房主可以处理加入申请",
  };
  return messages[code] ?? "服务器未能完成操作";
}

function isOnlineLegalMove(state: PublicGameState, from: number, to: number): boolean {
  if (from === to || from < 0 || to < 0 || from >= state.board.length || to >= state.board.length) return false;
  const source = state.board[from];
  const target = state.board[to];
  const mover = source.guest ?? (source.base?.revealed ? source.base : null);
  if (!mover || mover.camp !== state.turn) return false;

  const rowDistance = Math.abs(Math.floor(to / COLS) - Math.floor(from / COLS));
  const colDistance = Math.abs((to % COLS) - (from % COLS));
  const orthogonalStep = rowDistance + colDistance === 1;
  const lionDiagonal = mover.rank === "lion" && rowDistance === 1 && colDistance === 1;
  const lionLeap = mover.rank === "lion"
    && ((rowDistance === 2 && colDistance === 0) || (rowDistance === 0 && colDistance === 2));
  if (!orthogonalStep && !lionDiagonal && !lionLeap) return false;

  if (target.guest) return mover.rank === "dog" && target.guest.rank === "cat" && target.guest.camp !== mover.camp;
  if (target.base && !target.base.revealed) {
    return orthogonalStep && (mover.rank === "cat" || mover.rank === "dog" || mover.rank === "rat");
  }
  if (!target.base) return true;
  if (target.base.camp === mover.camp) return false;
  return canCapture(mover.rank, target.base.rank);
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || typeof value.type !== "string") return null;
    if (value.type === "welcome") {
      if (typeof value.protocolVersion !== "string" || typeof value.serverVersion !== "string" || typeof value.connectionId !== "string") return null;
      return value as ServerMessage;
    }
    if (value.type === "snapshot") return isPublicSnapshot(value.snapshot) ? value as ServerMessage : null;
    if (value.type === "room_joined") {
      if (typeof value.roomCode !== "string" || typeof value.reconnectToken !== "string") return null;
      if (value.seat !== "red" && value.seat !== "black") return null;
      return isPublicSnapshot(value.snapshot) ? value as ServerMessage : null;
    }
    if (value.type === "join_pending") {
      return typeof value.roomCode === "string" && isValidRoomCode(value.roomCode) ? value as ServerMessage : null;
    }
    if (value.type === "join_requested") {
      if (typeof value.roomCode !== "string" || !isValidRoomCode(value.roomCode)) return null;
      return typeof value.joinRequestId === "string" && value.joinRequestId.length > 0 && value.joinRequestId.length <= 64 ? value as ServerMessage : null;
    }
    if (value.type === "join_rejected") {
      const reasons = ["rejected", "cancelled", "timeout", "disconnected", "host_unavailable"];
      if (typeof value.roomCode !== "string" || !isValidRoomCode(value.roomCode)) return null;
      return typeof value.reason === "string" && reasons.includes(value.reason) ? value as ServerMessage : null;
    }
    if (value.type === "error") {
      return typeof value.code === "string" && typeof value.message === "string" ? value as ServerMessage : null;
    }
    if (value.type === "room_closed") {
      return typeof value.roomCode === "string" && typeof value.reason === "string" ? value as ServerMessage : null;
    }
    return null;
  } catch {
    return null;
  }
}

function isPublicSnapshot(value: unknown): value is PublicSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<PublicSnapshot>;
  if (typeof snapshot.roomCode !== "string" || typeof snapshot.version !== "number") return false;
  if (snapshot.phase !== "waiting" && snapshot.phase !== "playing" && snapshot.phase !== "ended") return false;
  if (!snapshot.seats || typeof snapshot.seats !== "object") return false;
  if (!isPublicSeat(snapshot.seats.red) || !isPublicSeat(snapshot.seats.black)) return false;
  return snapshot.game === null || isPublicGameState(snapshot.game);
}

function isPublicSeat(value: unknown): value is PublicSeat {
  if (!value || typeof value !== "object") return false;
  const seat = value as Partial<PublicSeat>;
  return typeof seat.occupied === "boolean" && typeof seat.ready === "boolean" && typeof seat.connected === "boolean";
}

function isPublicGameState(value: unknown): value is PublicGameState {
  if (!value || typeof value !== "object") return false;
  const game = value as Partial<PublicGameState>;
  if (game.turn !== "red" && game.turn !== "black") return false;
  if (game.status !== "playing" && game.status !== "won" && game.status !== "draw") return false;
  if (game.winner !== null && game.winner !== "red" && game.winner !== "black") return false;
  if (!Number.isInteger(game.moveNumber) || !Number.isInteger(game.halfmoveClock)) return false;
  if (!Array.isArray(game.board) || game.board.length !== 20 || !game.board.every(isPublicCell)) return false;
  if (!game.fallen || !Array.isArray(game.fallen.red) || !Array.isArray(game.fallen.black)) return false;
  if (!game.fallen.red.every(isPublicPiece) || !game.fallen.black.every(isPublicPiece)) return false;
  if (!Array.isArray(game.log) || !game.log.every((entry) => typeof entry === "string")) return false;
  return game.lastAction === null || isAction(game.lastAction);
}

function isPublicCell(value: unknown): value is PublicCell {
  if (!value || typeof value !== "object") return false;
  const cell = value as Partial<PublicCell>;
  const validBase = cell.base === null || isPublicPiece(cell.base) || isPublicHiddenPiece(cell.base);
  const validGuest = cell.guest === null || isPublicPiece(cell.guest);
  return validBase && validGuest && (cell.guestMode === null || cell.guestMode === "above" || cell.guestMode === "below");
}

function isPublicPiece(value: unknown): value is PublicPiece {
  if (!value || typeof value !== "object") return false;
  const piece = value as Partial<PublicPiece>;
  return piece.revealed === true && (piece.camp === "red" || piece.camp === "black")
    && typeof piece.rank === "string" && RANKS.includes(piece.rank as Rank);
}

function isPublicHiddenPiece(value: unknown): value is PublicHiddenPiece {
  if (!value || typeof value !== "object") return false;
  const piece = value as Record<string, unknown>;
  return piece.revealed === false && Object.keys(piece).length === 1;
}

function isAction(value: unknown): value is Action {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<Action>;
  if (action.type === "flip") return Number.isInteger(action.at);
  return action.type === "move" && Number.isInteger(action.from) && Number.isInteger(action.to);
}
