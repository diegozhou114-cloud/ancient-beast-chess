import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(resolve(root, "server/package.json"), "utf8"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const output = execFileSync(
  npm,
  ["pack", "./server", "--dry-run", "--json", "--ignore-scripts"],
  { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
);
const results = JSON.parse(output);

assert.equal(results.length, 1, "npm pack must produce exactly one package");
const result = results[0];
assert.equal(result.name, "ancient-beast-chess-server", "package name must be the server package");
assert.equal(result.name, manifest.name, "packed name must match server/package.json");
assert.equal(
  result.filename,
  `${manifest.name}-${manifest.version}.tgz`,
  "package filename must match the release asset name",
);

const allowedFiles = new Set(["LICENSE", "README.md", "package.json", "update-server.sh"]);
const paths = result.files.map((file) => file.path);
for (const path of paths) {
  assert.ok(
    allowedFiles.has(path) || path.startsWith("dist/") || path.startsWith("docs/"),
    `unexpected package content: ${path}`,
  );
}
assert.ok(paths.includes("dist/index.js"), "package must contain the server library entry");
const cli = result.files.find((file) => file.path === "dist/cli.js");
assert.ok(cli, "package must contain dist/cli.js");
assert.equal(cli.mode & 0o111, 0o111, "dist/cli.js must have mode 0755 execute bits");
const updater = result.files.find((file) => file.path === "update-server.sh");
assert.ok(updater, "package must contain update-server.sh");
assert.equal(updater.mode & 0o111, 0o111, "update-server.sh must have execute bits");

process.stdout.write(`${JSON.stringify({
  packageName: result.name,
  filename: result.filename,
  entryCount: result.entryCount,
  cliMode: cli.mode.toString(8),
  updaterMode: updater.mode.toString(8),
})}\n`);
