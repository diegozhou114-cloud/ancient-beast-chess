const dgram = require("node:dgram");
const { randomUUID } = require("node:crypto");
const { networkInterfaces } = require("node:os");
const { pathToFileURL } = require("node:url");

const DISCOVERY_PORT = 41234;
const ANNOUNCEMENT_MAGIC = "ancient-beast-chess-lan";
const ANNOUNCEMENT_VERSION = 1;
const ANNOUNCEMENT_INTERVAL_MS = 1_000;
const ROOM_EXPIRY_MS = 4_500;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

class LanRoomStore {
  constructor(expiryMs = ROOM_EXPIRY_MS) {
    this.expiryMs = expiryMs;
    this.rooms = new Map();
  }

  update(announcement, address, now = Date.now()) {
    const parsed = parseAnnouncement(announcement, address, now);
    if (!parsed) return false;
    if (!parsed.open) {
      return this.rooms.delete(parsed.roomCode);
    }
    this.rooms.set(parsed.roomCode, parsed);
    return true;
  }

  expire(now = Date.now()) {
    let changed = false;
    for (const [roomCode, room] of this.rooms) {
      if (now - room.lastSeenAt > this.expiryMs) {
        this.rooms.delete(roomCode);
        changed = true;
      }
    }
    return changed;
  }

  list(now = Date.now()) {
    this.expire(now);
    return [...this.rooms.values()]
      .sort((left, right) => left.roomCode.localeCompare(right.roomCode))
      .map(({ lastSeenAt: _lastSeenAt, open: _open, ...room }) => room);
  }
}

function createLanService({ serverModulePath, onRoomsChanged = () => {} }) {
  const instanceId = randomUUID();
  const store = new LanRoomStore();
  let socket = null;
  let socketPromise = null;
  let discoveryActive = false;
  let server = null;
  let hostPort = null;
  let advertisedRoom = null;
  let announceTimer = null;
  let expiryTimer = null;

  async function ensureSocket() {
    if (socket) return socket;
    if (socketPromise) return socketPromise;
    socketPromise = new Promise((resolve, reject) => {
      const nextSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      const onError = (error) => {
        nextSocket.close();
        reject(error);
      };
      nextSocket.once("error", onError);
      nextSocket.on("message", (message, remote) => {
        let payload;
        try {
          payload = JSON.parse(message.toString("utf8"));
        } catch {
          return;
        }
        if (payload?.instanceId === instanceId) return;
        if (store.update(payload, remote.address) && discoveryActive) emitRooms();
      });
      nextSocket.bind(DISCOVERY_PORT, "0.0.0.0", () => {
        nextSocket.off("error", onError);
        nextSocket.on("error", () => {});
        nextSocket.setBroadcast(true);
        socket = nextSocket;
        resolve(nextSocket);
      });
    }).finally(() => {
      socketPromise = null;
    });
    return socketPromise;
  }

  function closeSocketIfIdle() {
    if (discoveryActive || server || !socket) return;
    socket.close();
    socket = null;
  }

  function emitRooms() {
    onRoomsChanged(store.list());
  }

  async function sendAnnouncement(open = true) {
    if (!advertisedRoom || !hostPort) return;
    const activeSocket = await ensureSocket();
    const payload = Buffer.from(JSON.stringify({
      magic: ANNOUNCEMENT_MAGIC,
      version: ANNOUNCEMENT_VERSION,
      instanceId,
      roomCode: advertisedRoom,
      port: hostPort,
      open,
      approvalRequired: true,
    }));
    for (const target of broadcastAddresses()) {
      activeSocket.send(payload, DISCOVERY_PORT, target, () => {});
    }
  }

  function beginAnnouncements() {
    if (announceTimer) clearInterval(announceTimer);
    if (!advertisedRoom) return;
    void sendAnnouncement(true);
    announceTimer = setInterval(() => void sendAnnouncement(true), ANNOUNCEMENT_INTERVAL_MS);
    announceTimer.unref();
  }

  async function startHost() {
    if (server && hostPort) return { endpoint: `ws://127.0.0.1:${hostPort}/ws`, port: hostPort };
    await ensureSocket();
    const module = await import(pathToFileURL(serverModulePath).href);
    const EmbeddedServer = module.AncientBeastServer;
    if (typeof EmbeddedServer !== "function") throw new Error("LAN_SERVER_MODULE_INVALID");
    const nextServer = new EmbeddedServer({
      config: { host: "0.0.0.0", port: 0, maxRooms: 1, maxConnections: 4 },
      logger: { log() {} },
    });
    try {
      const address = await nextServer.start();
      server = nextServer;
      hostPort = address.port;
      return { endpoint: `ws://127.0.0.1:${hostPort}/ws`, port: hostPort };
    } catch (error) {
      await nextServer.stop().catch(() => {});
      closeSocketIfIdle();
      throw error;
    }
  }

  async function stopHost() {
    if (advertisedRoom) await sendAnnouncement(false).catch(() => {});
    if (announceTimer) clearInterval(announceTimer);
    announceTimer = null;
    advertisedRoom = null;
    hostPort = null;
    const activeServer = server;
    server = null;
    if (activeServer) await activeServer.stop();
    closeSocketIfIdle();
  }

  async function setAdvertisedRoom(input) {
    const roomCode = typeof input?.roomCode === "string" ? input.roomCode.trim().toUpperCase() : "";
    const open = input?.open === true;
    if (!server || !hostPort) throw new Error("LAN_HOST_NOT_RUNNING");
    if (roomCode && !ROOM_CODE_PATTERN.test(roomCode)) throw new Error("LAN_ROOM_CODE_INVALID");
    if (advertisedRoom && (!open || advertisedRoom !== roomCode)) {
      await sendAnnouncement(false).catch(() => {});
    }
    advertisedRoom = open ? roomCode : null;
    beginAnnouncements();
  }

  async function startDiscovery() {
    discoveryActive = true;
    await ensureSocket();
    if (!expiryTimer) {
      expiryTimer = setInterval(() => {
        if (store.expire()) emitRooms();
      }, 1_000);
      expiryTimer.unref();
    }
    emitRooms();
    return store.list();
  }

  function stopDiscovery() {
    discoveryActive = false;
    if (expiryTimer) clearInterval(expiryTimer);
    expiryTimer = null;
    closeSocketIfIdle();
  }

  async function dispose() {
    stopDiscovery();
    await stopHost();
    if (socket) socket.close();
    socket = null;
  }

  return {
    getNetworks: () => localNetworks(),
    startHost,
    stopHost,
    setAdvertisedRoom,
    startDiscovery,
    stopDiscovery,
    dispose,
  };
}

function parseAnnouncement(value, address, now = Date.now()) {
  if (!value || typeof value !== "object") return null;
  if (value.magic !== ANNOUNCEMENT_MAGIC || value.version !== ANNOUNCEMENT_VERSION) return null;
  if (typeof value.instanceId !== "string" || value.instanceId.length < 8 || value.instanceId.length > 64) return null;
  if (typeof value.roomCode !== "string" || !ROOM_CODE_PATTERN.test(value.roomCode)) return null;
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65_535) return null;
  if (typeof value.open !== "boolean" || value.approvalRequired !== true) return null;
  const host = normalizeIpv4(address);
  if (!host) return null;
  return {
    roomCode: value.roomCode,
    endpoint: `ws://${host}:${value.port}/ws`,
    host,
    port: value.port,
    approvalRequired: true,
    open: value.open,
    lastSeenAt: now,
  };
}

function normalizeIpv4(address) {
  const value = typeof address === "string" ? address.replace(/^::ffff:/, "") : "";
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return value;
}

function broadcastAddresses() {
  const addresses = new Set(["255.255.255.255"]);
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const broadcast = ipv4Broadcast(entry.address, entry.netmask);
      if (broadcast) addresses.add(broadcast);
    }
  }
  return addresses;
}

function localNetworks(interfaces = networkInterfaces()) {
  const networks = [];
  const seen = new Set();
  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const address = normalizeIpv4(entry.address);
      const subnet = ipv4Subnet(entry.address, entry.netmask);
      if (!address || !subnet || seen.has(`${address}/${subnet}`)) continue;
      seen.add(`${address}/${subnet}`);
      networks.push({ interfaceName, address, subnet });
    }
  }
  return networks;
}

function ipv4Subnet(address, netmask) {
  const ip = normalizeIpv4(address)?.split(".").map(Number);
  const mask = normalizeIpv4(netmask)?.split(".").map(Number);
  if (!ip || !mask) return null;
  const maskBits = mask.map((part) => part.toString(2).padStart(8, "0")).join("");
  if (!/^1*0*$/.test(maskBits)) return null;
  const firstZero = maskBits.indexOf("0");
  const prefixLength = firstZero === -1 ? 32 : firstZero;
  const network = ip.map((part, index) => part & mask[index]).join(".");
  return `${network}/${prefixLength}`;
}

function ipv4Broadcast(address, netmask) {
  const ip = address.split(".").map(Number);
  const mask = netmask.split(".").map(Number);
  if (ip.length !== 4 || mask.length !== 4 || [...ip, ...mask].some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ip.map((part, index) => (part | (~mask[index] & 255)) >>> 0).join(".");
}

module.exports = {
  ANNOUNCEMENT_MAGIC,
  ANNOUNCEMENT_VERSION,
  DISCOVERY_PORT,
  LanRoomStore,
  createLanService,
  ipv4Broadcast,
  ipv4Subnet,
  localNetworks,
  parseAnnouncement,
};
