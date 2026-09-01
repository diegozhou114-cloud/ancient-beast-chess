const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ANNOUNCEMENT_MAGIC,
  ANNOUNCEMENT_VERSION,
  LanRoomStore,
  ipv4Broadcast,
  localNetworks,
  parseAnnouncement,
} = require("../electron/lan.cjs");

function announcement(overrides = {}) {
  return {
    magic: ANNOUNCEMENT_MAGIC,
    version: ANNOUNCEMENT_VERSION,
    instanceId: "host-instance-123",
    roomCode: "ABC234",
    port: 49152,
    open: true,
    approvalRequired: true,
    ...overrides,
  };
}

test("uses the UDP source address for a discovered room endpoint", () => {
  const room = parseAnnouncement(announcement(), "192.168.8.23", 100);
  assert.equal(room.endpoint, "ws://192.168.8.23:49152/ws");
  assert.equal(room.roomCode, "ABC234");
});

test("rejects malformed, closed-compatible, and unapproved announcements", () => {
  assert.equal(parseAnnouncement(announcement({ roomCode: "BAD-01" }), "192.168.8.23"), null);
  assert.equal(parseAnnouncement(announcement({ port: 70000 }), "192.168.8.23"), null);
  assert.equal(parseAnnouncement(announcement({ approvalRequired: false }), "192.168.8.23"), null);
  assert.equal(parseAnnouncement(announcement(), "not-an-ip"), null);
});

test("expires stale rooms and removes rooms announced as closed", () => {
  const store = new LanRoomStore(4_500);
  assert.equal(store.update(announcement(), "10.0.0.5", 1_000), true);
  assert.equal(store.list(5_499).length, 1);
  assert.equal(store.list(5_501).length, 0);
  store.update(announcement(), "10.0.0.5", 10_000);
  assert.equal(store.update(announcement({ open: false }), "10.0.0.5", 10_100), true);
  assert.equal(store.list(10_100).length, 0);
});

test("calculates subnet broadcast addresses", () => {
  assert.equal(ipv4Broadcast("192.168.10.22", "255.255.255.0"), "192.168.10.255");
  assert.equal(ipv4Broadcast("10.4.2.9", "255.255.0.0"), "10.4.255.255");
});

test("reports the local IPv4 addresses and their subnets", () => {
  const networks = localNetworks({
    lo0: [{ family: "IPv4", internal: true, address: "127.0.0.1", netmask: "255.0.0.0" }],
    en0: [{ family: "IPv4", internal: false, address: "192.168.10.22", netmask: "255.255.255.0" }],
    bridge0: [{ family: "IPv4", internal: false, address: "10.4.2.9", netmask: "255.255.0.0" }],
  });

  assert.deepEqual(networks, [
    { interfaceName: "en0", address: "192.168.10.22", subnet: "192.168.10.0/24" },
    { interfaceName: "bridge0", address: "10.4.2.9", subnet: "10.4.0.0/16" },
  ]);
});
