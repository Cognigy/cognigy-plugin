// Engine launcher for the NiCE Cognigy Plugin.
//
// This file IS the MCP server command (see plugin.json `mcpServers.platform`).
// It guarantees the pinned engine is installed, then hands off to it — so the
// server can never start before its engine exists (no first-run race). The
// install is guarded: it only hits npm when the installed version differs from
// the pin, so repeat boots are an instant local check and work offline.
//
// stdout is reserved for the MCP stdio transport (JSON-RPC). Nothing here may
// write to stdout — all diagnostics go to stderr, and npm's stdout is dropped.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = "@cognigy/plugin-engine";

const here = dirname(fileURLToPath(import.meta.url)); // plugin/bin
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(here, "..");
const dataDir = process.env.CLAUDE_PLUGIN_DATA;

function note(msg) {
  process.stderr.write(`[cognigy] ${msg}\n`);
}
function fail(msg) {
  note(msg);
  process.exit(1);
}

if (!dataDir) {
  fail(
    "CLAUDE_PLUGIN_DATA is not set; cannot locate the engine install directory.",
  );
}

// The engine pin IS the plugin's own version: the plugin and the
// @cognigy/plugin-engine npm package always carry the same number (kept in
// lockstep by semantic-release). So there's one version to reason about.
let target;
try {
  target = JSON.parse(
    readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
  ).version;
} catch (err) {
  fail(`could not read the plugin version (${err.message}).`);
}

const engineDir = join(dataDir, "node_modules", ...PKG.split("/"));
const engineEntry = join(engineDir, "dist", "index.js");
const enginePkg = join(engineDir, "package.json");

function installedVersion() {
  try {
    return JSON.parse(readFileSync(enginePkg, "utf8")).version;
  } catch {
    return null;
  }
}

const current = installedVersion();
if (current !== target) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = spawnSync(
    npm,
    [
      "install",
      `${PKG}@${target}`,
      "--prefix",
      dataDir,
      "--no-fund",
      "--no-audit",
      "--loglevel=error",
    ],
    // stdout -> ignore (must stay clean for MCP); stderr -> inherit (show errors).
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  if (res.status !== 0) {
    if (existsSync(engineEntry)) {
      note(
        `engine ${target} install failed; starting existing ${current ?? "unknown"} instead. ` +
          `Check network/registry access, then reload the plugin to update.`,
      );
    } else {
      fail(
        `engine install failed and no engine is present. ` +
          `Check network/registry access, then reload the plugin or restart the session.`,
      );
    }
  }
}

if (!existsSync(engineEntry)) {
  fail(`engine entry not found at ${engineEntry}.`);
}

// Hand off: importing the entry runs the engine's main() and connects stdio.
await import(pathToFileURL(engineEntry).href);
