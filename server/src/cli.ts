#!/usr/bin/env node
import { createAncientBeastServer } from "./app.js";

const server = createAncientBeastServer();

try {
  await server.start();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    event: "shutdown_requested",
    signal,
  })}\n`);
  await server.stop();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
