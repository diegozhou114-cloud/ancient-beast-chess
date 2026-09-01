import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KeyedWindowLimiter } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(serverRoot, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

describe("distribution and infrastructure", () => {
  it("keeps trusted proxy handling opt-in and validates the environment value", () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ ABC_TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(() => loadConfig({ ABC_TRUST_PROXY: "yes" })).toThrow("ABC_TRUST_PROXY must be true or false");
  });

  it("reclaims expired keyed rate-limit windows", () => {
    let now = 1_000;
    const limiter = new KeyedWindowLimiter(1, 1_000, () => now);
    for (let index = 0; index < 500; index += 1) limiter.allow(`198.51.100.${index}`);
    expect(limiter.entryCount).toBe(500);

    now += 1_001;
    expect(limiter.allow("203.0.113.1")).toBe(true);
    expect(limiter.entryCount).toBe(1);
  });

  it("verifies the root server package boundary and executable bin", () => {
    const projectManifest = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")) as { version: string };
    const serverManifest = JSON.parse(readFileSync(resolve(serverRoot, "package.json"), "utf8")) as { version: string; bin: Record<string, string> };
    const protocolSource = readFileSync(resolve(serverRoot, "src/protocol.ts"), "utf8");
    const installerSource = readFileSync(resolve(serverRoot, "install-server.sh"), "utf8");
    expect(projectManifest.version).toBe("1.0.0");
    expect(serverManifest.version).toBe(projectManifest.version);
    expect(serverManifest.bin["ancient-beast-chess-server-update"]).toBe("update-server.sh");
    expect(protocolSource).toContain(`SERVER_VERSION = "${projectManifest.version}"`);
    expect(installerSource).toContain(`ABC_SERVER_VERSION:-${projectManifest.version}`);

    const output = execFileSync(npm, ["run", "server:pack:check"], {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    expect(output).toContain('"packageName":"ancient-beast-chess-server"');
    expect(output).toContain(`"filename":"ancient-beast-chess-server-${projectManifest.version}.tgz"`);
    expect(output).toContain('"cliMode":"755"');
    expect(output).toContain('"updaterMode":"755"');
  }, 15_000);

  it("keeps the installer syntax valid and aligned with the architecture-neutral package", () => {
    const installer = resolve(serverRoot, "install-server.sh");
    execFileSync("bash", ["-n", installer]);
    const source = readFileSync(installer, "utf8");
    expect(source).toContain('ASSET="ancient-beast-chess-server-${VERSION}.tgz"');
    expect(source).not.toContain("-linux-${ARCH}.tgz");
  });

  it("keeps the updater syntax valid and requires an explicit target version", () => {
    const updater = resolve(serverRoot, "update-server.sh");
    execFileSync("bash", ["-n", updater]);
    const source = readFileSync(updater, "utf8");
    expect(source).toContain('TARGET_VERSION="${1:-${ABC_SERVER_VERSION:-}}"');
    expect(source).toContain('FORCE_REINSTALL=true');
    expect(source).toContain('body.protocolVersion !== process.argv[3]');
    expect(source).toContain('systemctl restart "$SERVICE_NAME"');
    expect(source).toContain('Rollback command: $0 ${CURRENT_VERSION}');
  });
});
