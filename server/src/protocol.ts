import { z } from "zod";
import type { Action, Camp, GameStatus, LayerMode, Rank } from "../../src/game.js";

export const PROTOCOL_VERSION = "abc-ws/1";
export const SERVER_VERSION = "0.0.3";

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("flip"), at: z.number().int().min(0).max(19) }).strict(),
  z.object({
    type: z.literal("move"),
    from: z.number().int().min(0).max(19),
    to: z.number().int().min(0).max(19),
  }).strict(),
]);

const requestIdSchema = z.string().min(1).max(64).optional();
const roomCodeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/);

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_room"), requestId: requestIdSchema }).strict(),
  z.object({ type: z.literal("join_room"), roomCode: roomCodeSchema, requestId: requestIdSchema }).strict(),
  z.object({
    type: z.literal("resume"),
    roomCode: roomCodeSchema,
    reconnectToken: z.string().min(1).max(128),
    requestId: requestIdSchema,
  }).strict(),
  z.object({ type: z.literal("ready"), ready: z.boolean(), requestId: requestIdSchema }).strict(),
  z.object({
    type: z.literal("action"),
    version: z.number().int().nonnegative(),
    action: actionSchema,
    requestId: requestIdSchema,
  }).strict(),
  z.object({ type: z.literal("resign"), requestId: requestIdSchema }).strict(),
  z.object({ type: z.literal("leave_room"), requestId: requestIdSchema }).strict(),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

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

export type RoomPhase = "waiting" | "playing" | "ended";
export type OutcomeReason = "game" | "draw" | "resigned" | "disconnect_timeout" | "abandoned";

export interface PublicSeat {
  occupied: boolean;
  ready: boolean;
  connected: boolean;
  reconnectDeadlineAt: number | null;
}

export interface PublicSnapshot {
  roomCode: string;
  version: number;
  phase: RoomPhase;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  seats: Record<Camp, PublicSeat>;
  game: PublicGameState | null;
  outcome: { winner: Camp | null; reason: OutcomeReason } | null;
}

export type ErrorCode =
  | "INVALID_MESSAGE"
  | "RATE_LIMITED"
  | "SERVER_FULL"
  | "ROOM_LIMIT_REACHED"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_NOT_JOINABLE"
  | "ALREADY_IN_ROOM"
  | "NOT_IN_ROOM"
  | "NOT_READYABLE"
  | "NOT_PLAYING"
  | "OUT_OF_TURN"
  | "STALE_VERSION"
  | "ILLEGAL_ACTION"
  | "INVALID_RECONNECT_TOKEN"
  | "ROOM_EXPIRED"
  | "INTERNAL_ERROR";

export type ServerMessage =
  | {
      type: "welcome";
      protocolVersion: typeof PROTOCOL_VERSION;
      serverVersion: typeof SERVER_VERSION;
      connectionId: string;
    }
  | {
      type: "room_joined";
      requestId?: string;
      roomCode: string;
      seat: Camp;
      reconnectToken: string;
      snapshot: PublicSnapshot;
    }
  | { type: "snapshot"; snapshot: PublicSnapshot }
  | { type: "room_closed"; roomCode: string; reason: "waiting_timeout" | "retention_expired" | "empty" }
  | { type: "error"; requestId?: string; code: ErrorCode; message: string };
