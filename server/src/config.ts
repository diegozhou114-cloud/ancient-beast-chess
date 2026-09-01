export interface ServerConfig {
  host: string;
  port: number;
  trustProxy: boolean;
  waitingTimeoutMs: number;
  reconnectGraceMs: number;
  endedRetentionMs: number;
  cleanupIntervalMs: number;
  heartbeatIntervalMs: number;
  maxMessageBytes: number;
  maxConnections: number;
  maxRooms: number;
  connectionRateLimit: number;
  roomOperationRateLimit: number;
  actionRateLimit: number;
}

function boolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw.toLowerCase() === "true") return true;
  if (raw.toLowerCase() === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.ABC_HOST || "0.0.0.0",
    port: integer(env, "ABC_PORT", 8787, 0, 65_535),
    trustProxy: boolean(env, "ABC_TRUST_PROXY", false),
    waitingTimeoutMs: integer(env, "ABC_WAITING_TIMEOUT_MS", 10 * 60_000, 1_000, 86_400_000),
    reconnectGraceMs: integer(env, "ABC_RECONNECT_GRACE_MS", 5 * 60_000, 1_000, 86_400_000),
    endedRetentionMs: integer(env, "ABC_ENDED_RETENTION_MS", 2 * 60_000, 1_000, 86_400_000),
    cleanupIntervalMs: integer(env, "ABC_CLEANUP_INTERVAL_MS", 1_000, 50, 60_000),
    heartbeatIntervalMs: integer(env, "ABC_HEARTBEAT_INTERVAL_MS", 30_000, 1_000, 300_000),
    maxMessageBytes: integer(env, "ABC_MAX_MESSAGE_BYTES", 16 * 1024, 1_024, 1_048_576),
    maxConnections: integer(env, "ABC_MAX_CONNECTIONS", 1_000, 2, 100_000),
    maxRooms: integer(env, "ABC_MAX_ROOMS", 500, 1, 50_000),
    connectionRateLimit: integer(env, "ABC_CONNECTIONS_PER_MINUTE", 30, 1, 10_000),
    roomOperationRateLimit: integer(env, "ABC_ROOM_OPS_PER_MINUTE", 20, 1, 10_000),
    actionRateLimit: integer(env, "ABC_ACTIONS_PER_10_SECONDS", 40, 1, 10_000),
  };
}
