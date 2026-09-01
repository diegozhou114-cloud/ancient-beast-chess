import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const require = createRequire(import.meta.url);
const { createLanService, DISCOVERY_PORT } = require("../../electron/lan.cjs");
const serverModulePath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const rounds = Number.parseInt(process.argv[2] ?? "20", 10);

assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 100, "round count must be between 1 and 100");

class Client {
  constructor(socket) {
    this.socket = socket;
    this.messages = [];
    this.waiters = [];
    socket.on("message", (data) => this.receive(JSON.parse(data.toString())));
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    const client = new Client(socket);
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const welcome = await client.next("welcome");
    assert.equal(welcome.protocolVersion, "abc-ws/2");
    return client;
  }

  receive(message) {
    const index = this.waiters.findIndex((waiter) => waiter.matches(message));
    if (index === -1) {
      this.messages.push(message);
      return;
    }
    const [waiter] = this.waiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  }

  next(type, predicate = () => true, timeoutMs = 5_000) {
    const matches = (message) => message.type === type && predicate(message);
    const queued = this.messages.findIndex(matches);
    if (queued !== -1) return Promise.resolve(this.messages.splice(queued, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(new Error(`timed out waiting for ${type}`));
      }, timeoutMs);
      this.waiters.push({ matches, resolve, timer });
    });
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  close() {
    if (this.socket.readyState !== WebSocket.CLOSED) this.socket.terminate();
  }
}

function waitForDiscoveredRoom(getRooms, roomCode, timeoutMs = 6_000) {
  const existing = getRooms().find((room) => room.roomCode === roomCode);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const poll = setInterval(() => {
      const room = getRooms().find((candidate) => candidate.roomCode === roomCode);
      if (!room) return;
      clearTimeout(timer);
      clearInterval(poll);
      resolve(room);
    }, 25);
    const timer = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`LAN discovery timed out for ${roomCode}`));
    }, timeoutMs);
  });
}

async function playRound(index) {
  let discoveredRooms = [];
  const hostService = createLanService({ serverModulePath });
  const guestService = createLanService({
    serverModulePath,
    onRoomsChanged(rooms) {
      discoveredRooms = rooms;
    },
  });
  const clients = [];
  let hostPort = null;

  try {
    await guestService.startDiscovery();
    const hosted = await hostService.startHost();
    hostPort = hosted.port;
    const host = await Client.connect(hosted.endpoint);
    clients.push(host);
    host.send({ type: "create_room", joinApproval: true, requestId: `create-${index}` });
    const created = await host.next("room_joined");
    await hostService.setAdvertisedRoom({ roomCode: created.roomCode, open: true });

    const discovered = await waitForDiscoveredRoom(() => discoveredRooms, created.roomCode);
    assert.ok(!discovered.endpoint.includes("127.0.0.1"), "discovery must use a real interface address");
    const guest = await Client.connect(discovered.endpoint);
    clients.push(guest);
    guest.send({ type: "join_room", roomCode: created.roomCode, requestId: `join-${index}` });
    const [pending, requested] = await Promise.all([
      guest.next("join_pending"),
      host.next("join_requested"),
    ]);
    assert.equal(pending.roomCode, created.roomCode);
    host.send({ type: "accept_join", joinRequestId: requested.joinRequestId });
    const [joined, admitted] = await Promise.all([
      guest.next("room_joined"),
      host.next("snapshot", (message) => message.snapshot.seats.black.occupied),
    ]);
    assert.deepEqual(joined.snapshot, admitted.snapshot);

    host.send({ type: "ready", ready: true });
    await Promise.all([
      host.next("snapshot", (message) => message.snapshot.seats.red.ready),
      guest.next("snapshot", (message) => message.snapshot.seats.red.ready),
    ]);
    guest.send({ type: "ready", ready: true });
    let [hostState, guestState] = await Promise.all([
      host.next("snapshot", (message) => message.snapshot.phase === "playing"),
      guest.next("snapshot", (message) => message.snapshot.phase === "playing"),
    ]);
    assert.deepEqual(hostState.snapshot, guestState.snapshot);

    for (let at = 0; at < 6; at += 1) {
      const actor = hostState.snapshot.game.turn === "red" ? host : guest;
      const version = hostState.snapshot.version;
      actor.send({ type: "action", version, action: { type: "flip", at } });
      [hostState, guestState] = await Promise.all([
        host.next("snapshot", (message) => message.snapshot.version > version),
        guest.next("snapshot", (message) => message.snapshot.version > version),
      ]);
      assert.deepEqual(hostState.snapshot, guestState.snapshot);
    }

    const resigningSeat = index % 2 === 0 ? "red" : "black";
    const resigner = resigningSeat === "red" ? host : guest;
    resigner.send({ type: "resign" });
    const [hostEnded, guestEnded] = await Promise.all([
      host.next("snapshot", (message) => message.snapshot.phase === "ended"),
      guest.next("snapshot", (message) => message.snapshot.phase === "ended"),
    ]);
    assert.deepEqual(hostEnded.snapshot, guestEnded.snapshot);
    assert.deepEqual(hostEnded.snapshot.outcome, {
      winner: resigningSeat === "red" ? "black" : "red",
      reason: "resigned",
    });
    await hostService.setAdvertisedRoom({ roomCode: created.roomCode, open: false });
    return { roomCode: created.roomCode, endpoint: discovered.endpoint, winner: hostEnded.snapshot.outcome.winner };
  } finally {
    for (const client of clients) client.close();
    await Promise.all([hostService.dispose(), guestService.dispose()]);
    if (hostPort !== null) {
      await assert.rejects(Client.connect(`ws://127.0.0.1:${hostPort}/ws`));
    }
  }
}

const startedAt = Date.now();
const rssBefore = process.memoryUsage().rss;
const results = [];
for (let index = 1; index <= rounds; index += 1) {
  const result = await playRound(index);
  results.push(result);
  process.stdout.write(`LAN round ${index}/${rounds} passed (${result.roomCode}, ${result.winner})\n`);
}

await new Promise((resolve) => setTimeout(resolve, 100));
const rssAfter = process.memoryUsage().rss;
process.stdout.write(`${JSON.stringify({
  passed: results.length,
  rounds,
  udpDiscoveryPort: DISCOVERY_PORT,
  distinctEndpoints: [...new Set(results.map((result) => result.endpoint))],
  durationMs: Date.now() - startedAt,
  rssBefore,
  rssAfter,
  rssDelta: rssAfter - rssBefore,
})}\n`);
