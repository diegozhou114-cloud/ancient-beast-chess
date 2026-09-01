import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  applyAction,
  createGame,
  type Action,
  type Camp,
  type GameState,
  type Piece,
} from "../../src/game.js";
import type { ServerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type {
  ErrorCode,
  OutcomeReason,
  PublicGameState,
  PublicPiece,
  PublicSnapshot,
  RoomPhase,
  ServerMessage,
} from "./protocol.js";

const CAMPS: readonly Camp[] = ["red", "black"];
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const JOIN_APPROVAL_TIMEOUT_MS = 30_000;

export interface ClientPeer {
  id: string;
  ip: string;
  roomCode: string | null;
  seat: Camp | null;
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

interface SeatState {
  token: string;
  peer: ClientPeer | null;
  ready: boolean;
  disconnectedAt: number | null;
  reconnectDeadlineAt: number | null;
}

interface RoomOutcome {
  winner: Camp | null;
  reason: OutcomeReason;
}

interface PendingJoin {
  id: string;
  peer: ClientPeer;
  requestId?: string;
  expiresAt: number;
}

interface Room {
  code: string;
  version: number;
  phase: RoomPhase;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  seats: Record<Camp, SeatState | null>;
  game: GameState | null;
  outcome: RoomOutcome | null;
  joinApproval: boolean;
  pendingJoin: PendingJoin | null;
}

export class ProtocolError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly pendingRoomByPeerId = new Map<string, string>();

  constructor(
    private readonly config: ServerConfig,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  get connectedPlayerCount(): number {
    let count = 0;
    for (const room of this.rooms.values()) {
      for (const camp of CAMPS) count += Number(Boolean(room.seats[camp]?.peer));
    }
    return count;
  }

  createRoom(peer: ClientPeer, joinApproval = false, requestId?: string): void {
    this.assertUnbound(peer);
    if (this.rooms.size >= this.config.maxRooms) {
      throw new ProtocolError("ROOM_LIMIT_REACHED", "The server room limit has been reached");
    }

    const code = this.newRoomCode();
    const createdAt = this.now();
    const room: Room = {
      code,
      version: 1,
      phase: "waiting",
      createdAt,
      startedAt: null,
      endedAt: null,
      seats: { red: this.newSeat(peer), black: null },
      game: null,
      outcome: null,
      joinApproval,
      pendingJoin: null,
    };
    this.rooms.set(code, room);
    this.bind(peer, room, "red");
    this.sendJoined(peer, room, "red", requestId);
    this.logger.log("info", "room_created", { roomCode: code, connectionId: peer.id, seat: "red" });
  }

  joinRoom(peer: ClientPeer, roomCode: string, requestId?: string): void {
    this.assertUnbound(peer);
    const room = this.rooms.get(roomCode);
    if (!room) throw new ProtocolError("ROOM_NOT_FOUND", "Room not found");
    if (room.phase !== "waiting") throw new ProtocolError("ROOM_NOT_JOINABLE", "Room is not accepting players");

    const camp = CAMPS.find((candidate) => room.seats[candidate] === null);
    if (!camp) throw new ProtocolError("ROOM_FULL", "Room already has two players");

    if (room.joinApproval) {
      const host = room.seats.red?.peer;
      if (!host) throw new ProtocolError("ROOM_NOT_JOINABLE", "The room host is unavailable");
      if (room.pendingJoin) throw new ProtocolError("JOIN_REQUEST_PENDING", "Another join request is already pending");
      const pendingJoin: PendingJoin = {
        id: randomBytes(16).toString("base64url"),
        peer,
        requestId,
        expiresAt: this.now() + JOIN_APPROVAL_TIMEOUT_MS,
      };
      room.pendingJoin = pendingJoin;
      this.pendingRoomByPeerId.set(peer.id, room.code);
      peer.send({ type: "join_pending", roomCode: room.code });
      host.send({ type: "join_requested", roomCode: room.code, joinRequestId: pendingJoin.id });
      this.logger.log("info", "join_requested", { roomCode, connectionId: peer.id });
      return;
    }

    this.admitPeer(room, peer, camp, requestId);
  }

  acceptJoin(peer: ClientPeer, joinRequestId: string): void {
    const room = this.requireHost(peer);
    const pending = room.pendingJoin;
    if (!pending || pending.id !== joinRequestId) {
      throw new ProtocolError("JOIN_REQUEST_NOT_FOUND", "Join request not found");
    }
    if (this.now() >= pending.expiresAt) {
      this.closePendingJoin(room, "timeout");
      throw new ProtocolError("JOIN_REQUEST_NOT_FOUND", "Join request has expired");
    }
    if (room.phase !== "waiting" || room.seats.black) {
      this.closePendingJoin(room, "host_unavailable");
      throw new ProtocolError("ROOM_NOT_JOINABLE", "Room is not accepting players");
    }
    room.pendingJoin = null;
    this.pendingRoomByPeerId.delete(pending.peer.id);
    this.admitPeer(room, pending.peer, "black", pending.requestId);
  }

  rejectJoin(peer: ClientPeer, joinRequestId: string): void {
    const room = this.requireHost(peer);
    if (!room.pendingJoin || room.pendingJoin.id !== joinRequestId) {
      throw new ProtocolError("JOIN_REQUEST_NOT_FOUND", "Join request not found");
    }
    this.closePendingJoin(room, "rejected");
  }

  cancelJoin(peer: ClientPeer): void {
    const roomCode = this.pendingRoomByPeerId.get(peer.id);
    const room = roomCode ? this.rooms.get(roomCode) : null;
    if (!room || room.pendingJoin?.peer !== peer) {
      throw new ProtocolError("JOIN_REQUEST_NOT_FOUND", "Join request not found");
    }
    this.closePendingJoin(room, "cancelled");
  }

  resume(peer: ClientPeer, roomCode: string, token: string, requestId?: string): void {
    this.assertUnbound(peer);
    const room = this.rooms.get(roomCode);
    const match = room ? CAMPS.find((camp) => tokenMatches(room.seats[camp]?.token, token)) : undefined;
    const seat = room && match ? room.seats[match] : null;
    const now = this.now();
    if (!room || !match || !seat || (seat.reconnectDeadlineAt !== null && now > seat.reconnectDeadlineAt)) {
      throw new ProtocolError("INVALID_RECONNECT_TOKEN", "Reconnect token is invalid or expired");
    }

    if (seat.peer && seat.peer !== peer) {
      const replaced = seat.peer;
      this.unbind(replaced);
      replaced.close(4001, "Session resumed elsewhere");
    }

    seat.peer = peer;
    seat.disconnectedAt = null;
    seat.reconnectDeadlineAt = null;
    this.bind(peer, room, match);
    room.version += 1;
    this.sendJoined(peer, room, match, requestId);
    this.broadcast(room, peer.id);
    this.logger.log("info", "room_resumed", { roomCode, connectionId: peer.id, seat: match });
  }

  setReady(peer: ClientPeer, ready: boolean): void {
    const { room, seat } = this.requireSeat(peer);
    if (room.phase !== "waiting") throw new ProtocolError("NOT_READYABLE", "Ready state can only change before a game");
    if (seat.ready === ready) {
      peer.send({ type: "snapshot", snapshot: this.toSnapshot(room) });
      return;
    }

    seat.ready = ready;
    room.version += 1;
    if (CAMPS.every((camp) => room.seats[camp]?.ready)) {
      room.phase = "playing";
      room.startedAt = this.now();
      room.game = createGame(secureRandom);
      this.logger.log("info", "room_started", { roomCode: room.code });
    }
    this.broadcast(room);
  }

  applyPlayerAction(peer: ClientPeer, expectedVersion: number, action: Action): void {
    const { room } = this.requireSeat(peer);
    if (room.phase !== "playing" || !room.game) throw new ProtocolError("NOT_PLAYING", "Room is not in a game");
    if (expectedVersion !== room.version) {
      throw new ProtocolError("STALE_VERSION", `Expected room version ${room.version}`);
    }
    if (room.game.turn !== peer.seat) throw new ProtocolError("OUT_OF_TURN", "It is not your turn");

    const next = applyAction(room.game, action);
    if (next === room.game) throw new ProtocolError("ILLEGAL_ACTION", "Action is not legal in the current position");

    room.game = next;
    this.logger.log("info", "action_applied", {
      roomCode: room.code,
      connectionId: peer.id,
      seat: peer.seat,
      actionType: action.type,
      moveNumber: next.moveNumber,
    });
    if (next.status === "won") {
      this.finish(room, next.winner, "game");
    } else if (next.status === "draw") {
      this.finish(room, null, "draw");
    } else {
      room.version += 1;
      this.broadcast(room);
    }
  }

  resign(peer: ClientPeer): void {
    const { room } = this.requireSeat(peer);
    if (room.phase !== "playing") throw new ProtocolError("NOT_PLAYING", "Room is not in a game");
    this.finish(room, opposite(peer.seat!), "resigned");
  }

  leaveRoom(peer: ClientPeer): void {
    const { room } = this.requireSeat(peer);
    if (room.phase !== "waiting") {
      throw new ProtocolError("NOT_READYABLE", "A room can only be left before the game starts");
    }

    if (peer.seat === "red" && room.pendingJoin) this.closePendingJoin(room, "host_unavailable");
    room.seats[peer.seat!] = null;
    this.unbind(peer);
    room.version += 1;
    if (CAMPS.every((camp) => room.seats[camp] === null)) {
      this.deleteRoom(room, "empty");
    } else {
      this.broadcast(room);
    }
  }

  disconnect(peer: ClientPeer): void {
    const pendingRoomCode = this.pendingRoomByPeerId.get(peer.id);
    const pendingRoom = pendingRoomCode ? this.rooms.get(pendingRoomCode) : null;
    if (pendingRoom?.pendingJoin?.peer === peer) {
      this.closePendingJoin(pendingRoom, "disconnected", true, false);
      return;
    }
    if (!peer.roomCode || !peer.seat) return;
    const room = this.rooms.get(peer.roomCode);
    const seat = room?.seats[peer.seat];
    if (!room || !seat || seat.peer !== peer) {
      this.unbind(peer);
      return;
    }

    const disconnectedAt = this.now();
    seat.peer = null;
    seat.disconnectedAt = disconnectedAt;
    seat.reconnectDeadlineAt = disconnectedAt + this.config.reconnectGraceMs;
    const roomCode = room.code;
    const camp = peer.seat;
    if (camp === "red" && room.pendingJoin) this.closePendingJoin(room, "host_unavailable");
    this.unbind(peer);
    room.version += 1;
    this.broadcast(room);
    this.logger.log("info", "player_disconnected", {
      roomCode,
      connectionId: peer.id,
      seat: camp,
      reconnectDeadlineAt: seat.reconnectDeadlineAt,
    });
  }

  runMaintenance(): void {
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      if (room.pendingJoin && now >= room.pendingJoin.expiresAt) {
        this.closePendingJoin(room, "timeout");
      }
      if (room.phase === "ended") {
        if (room.endedAt !== null && now - room.endedAt >= this.config.endedRetentionMs) {
          this.deleteRoom(room, "retention_expired");
        }
        continue;
      }

      if (room.phase === "waiting" && now - room.createdAt >= this.config.waitingTimeoutMs) {
        this.deleteRoom(room, "waiting_timeout");
        continue;
      }

      const expired = CAMPS.filter((camp) => {
        const deadline = room.seats[camp]?.reconnectDeadlineAt;
        return deadline !== null && deadline !== undefined && now >= deadline;
      });
      if (expired.length === 0) continue;

      if (room.phase === "waiting") {
        for (const camp of expired) room.seats[camp] = null;
        room.version += 1;
        if (CAMPS.every((camp) => room.seats[camp] === null)) {
          this.deleteRoom(room, "empty");
        } else {
          this.broadcast(room);
        }
        continue;
      }

      const connectedCamp = CAMPS.find((camp) => room.seats[camp]?.peer);
      if (connectedCamp && expired.includes(opposite(connectedCamp))) {
        this.finish(room, connectedCamp, "disconnect_timeout");
      } else {
        const allDisconnectedExpired = CAMPS.every((camp) => {
          const seat = room.seats[camp];
          return !seat?.peer && seat?.reconnectDeadlineAt !== null && seat?.reconnectDeadlineAt !== undefined
            && now >= seat.reconnectDeadlineAt;
        });
        if (allDisconnectedExpired) this.finish(room, null, "abandoned");
      }
    }
  }

  private newRoomCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = "";
      for (let index = 0; index < 6; index += 1) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new ProtocolError("SERVER_FULL", "Unable to allocate a room code");
  }

  private newSeat(peer: ClientPeer): SeatState {
    return {
      token: randomBytes(32).toString("base64url"),
      peer,
      ready: false,
      disconnectedAt: null,
      reconnectDeadlineAt: null,
    };
  }

  private admitPeer(room: Room, peer: ClientPeer, camp: Camp, requestId?: string): void {
    room.seats[camp] = this.newSeat(peer);
    this.bind(peer, room, camp);
    room.version += 1;
    this.sendJoined(peer, room, camp, requestId);
    this.broadcast(room, peer.id);
    this.logger.log("info", "room_joined", { roomCode: room.code, connectionId: peer.id, seat: camp });
  }

  private bind(peer: ClientPeer, room: Room, camp: Camp): void {
    peer.roomCode = room.code;
    peer.seat = camp;
  }

  private unbind(peer: ClientPeer): void {
    peer.roomCode = null;
    peer.seat = null;
  }

  private assertUnbound(peer: ClientPeer): void {
    if (peer.roomCode) throw new ProtocolError("ALREADY_IN_ROOM", "Connection is already bound to a room");
    if (this.pendingRoomByPeerId.has(peer.id)) {
      throw new ProtocolError("JOIN_REQUEST_PENDING", "Connection already has a pending join request");
    }
  }

  private requireHost(peer: ClientPeer): Room {
    if (!peer.roomCode || peer.seat !== "red") {
      throw new ProtocolError("NOT_ROOM_HOST", "Only the room host can manage join requests");
    }
    const room = this.rooms.get(peer.roomCode);
    if (!room || room.seats.red?.peer !== peer) {
      throw new ProtocolError("NOT_ROOM_HOST", "Only the room host can manage join requests");
    }
    return room;
  }

  private closePendingJoin(
    room: Room,
    reason: Extract<ServerMessage, { type: "join_rejected" }>["reason"],
    notifyHost = true,
    notifyJoiner = true,
  ): void {
    const pending = room.pendingJoin;
    if (!pending) return;
    room.pendingJoin = null;
    this.pendingRoomByPeerId.delete(pending.peer.id);
    const message: ServerMessage = { type: "join_rejected", roomCode: room.code, reason };
    if (notifyJoiner) pending.peer.send(message);
    const host = room.seats.red?.peer;
    if (notifyHost && host && host !== pending.peer) host.send(message);
  }

  private requireSeat(peer: ClientPeer): { room: Room; seat: SeatState } {
    if (!peer.roomCode || !peer.seat) throw new ProtocolError("NOT_IN_ROOM", "Connection is not in a room");
    const room = this.rooms.get(peer.roomCode);
    const seat = room?.seats[peer.seat];
    if (!room || !seat || seat.peer !== peer) throw new ProtocolError("NOT_IN_ROOM", "Connection is not in a room");
    return { room, seat };
  }

  private sendJoined(peer: ClientPeer, room: Room, camp: Camp, requestId?: string): void {
    const token = room.seats[camp]!.token;
    peer.send({
      type: "room_joined",
      requestId,
      roomCode: room.code,
      seat: camp,
      reconnectToken: token,
      snapshot: this.toSnapshot(room),
    });
  }

  private broadcast(room: Room, exceptConnectionId?: string): void {
    const message: ServerMessage = { type: "snapshot", snapshot: this.toSnapshot(room) };
    for (const camp of CAMPS) {
      const peer = room.seats[camp]?.peer;
      if (peer && peer.id !== exceptConnectionId) peer.send(message);
    }
  }

  private finish(room: Room, winner: Camp | null, reason: OutcomeReason): void {
    if (room.phase === "ended") return;
    room.phase = "ended";
    room.endedAt = this.now();
    room.outcome = { winner, reason };
    room.version += 1;
    this.broadcast(room);
    this.logger.log("info", "room_ended", { roomCode: room.code, winner, reason });
  }

  private deleteRoom(room: Room, reason: "waiting_timeout" | "retention_expired" | "empty"): void {
    if (!this.rooms.delete(room.code)) return;
    if (room.pendingJoin) this.closePendingJoin(room, "host_unavailable", false);
    for (const camp of CAMPS) {
      const peer = room.seats[camp]?.peer;
      if (!peer) continue;
      peer.send({ type: "room_closed", roomCode: room.code, reason });
      this.unbind(peer);
    }
    this.logger.log("info", "room_deleted", { roomCode: room.code, reason });
  }

  private toSnapshot(room: Room): PublicSnapshot {
    return {
      roomCode: room.code,
      version: room.version,
      phase: room.phase,
      createdAt: room.createdAt,
      startedAt: room.startedAt,
      endedAt: room.endedAt,
      seats: {
        red: publicSeat(room.seats.red),
        black: publicSeat(room.seats.black),
      },
      game: room.game ? toPublicGameState(room.game, room.outcome) : null,
      outcome: room.outcome ? { ...room.outcome } : null,
    };
  }
}

function publicSeat(seat: SeatState | null) {
  return {
    occupied: seat !== null,
    ready: seat?.ready ?? false,
    connected: Boolean(seat?.peer),
    reconnectDeadlineAt: seat?.reconnectDeadlineAt ?? null,
  };
}

function publicPiece(piece: Piece): PublicPiece {
  return { revealed: true, camp: piece.camp, rank: piece.rank };
}

export function toPublicGameState(game: GameState, outcome: RoomOutcome | null): PublicGameState {
  const forcedWinner = outcome?.winner ?? null;
  const forcedStatus = outcome
    ? forcedWinner ? "won" : "draw"
    : game.status;
  return {
    board: game.board.map((cell) => ({
      base: cell.base ? cell.base.revealed ? publicPiece(cell.base) : { revealed: false } : null,
      guest: cell.guest ? publicPiece(cell.guest) : null,
      guestMode: cell.guestMode,
    })),
    turn: game.turn,
    status: forcedStatus,
    winner: outcome ? forcedWinner : game.winner,
    moveNumber: game.moveNumber,
    halfmoveClock: game.halfmoveClock,
    fallen: {
      red: game.fallen.red.map(publicPiece),
      black: game.fallen.black.map(publicPiece),
    },
    log: [...game.log],
    lastAction: game.lastAction ? { ...game.lastAction } : null,
  };
}

function secureRandom(): number {
  return randomInt(0, 0x1_0000_0000) / 0x1_0000_0000;
}

function tokenMatches(expected: string | undefined, actual: string): boolean {
  if (!expected) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function opposite(camp: Camp): Camp {
  return camp === "red" ? "black" : "red";
}
