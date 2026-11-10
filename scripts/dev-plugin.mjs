#!/usr/bin/env node
/**
 * Local dev install for the plugin — test engine + skills + agents from the
 * working tree without ever editing the tracked plugin manifest.
 *
 *   npm run plugin:dev       — generate .dev-plugin/ (gitignored) and install it,
 *                              or update the existing dev install in place
 *   npm run plugin:dev:off   — remove the dev install and restore the GitHub plugin
 *   node scripts/dev-plugin.mjs sync — git hooks: re-sync after a branch switch
 *
 * How it works:
 *  - Generates a dev marketplace under .dev-plugin/ whose plugin manifest is a
 *    copy of plugin/.claude-plugin/plugin.json with ONE change: the `platform`
 *    server runs the local TypeScript source directly via tsx (no build step),
 *    so engine edits are live. Skills, agents and the rest of plugin/ are
 *    COPIED: Claude Code refuses plugin paths that resolve outside the plugin
 *    or marketplace directory, so symlinks into the working tree are skipped.
 *  - Installs it as cognigy@cognigy-dev and uninstalls the prod plugin to avoid
 *    duplicate tool names. Once installed, it is UPDATED in place (marketplace
 *    update + plugin update), never reinstalled: an uninstall drops the
 *    plugin's settings (API base URL and key).
 *  - The version carries a fingerprint of the copied plugin/ files
 *    (dev-plugin-snapshot.mjs). The husky post-checkout / post-merge hooks call
 *    `sync`, which updates the install when plugin/ changed; the dev engine
 *    (dev-engine.mjs) warns in its instructions when the copy is stale.
 *  - After src/ edits: /reload-plugins. After plugin/ edits (skills, agents):
 *    re-run `npm run plugin:dev`, then /reload-plugins.
 *
 * The tracked plugin.json is never touched; scripts/check-plugin-manifest.mjs
 * additionally guards its published form in CI and pre-commit.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginFingerprint, SKIPPED_ENTRIES } from "./dev-plugin-snapshot.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const devRoot = join(repoRoot, ".dev-plugin");
const pluginDir = join(repoRoot, "plugin");
const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
const DEV_MARKETPLACE = "cognigy-dev";
const PROD_MARKETPLACE = "cognigy-plugin";
const PROD_MARKETPLACE_SOURCE = "Cognigy/cognigy-plugin";

function claude(args, { allowFailure = false } = {}) {
  try {
    const out = execFileSync("claude", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(`  ✓ claude ${args.join(" ")}`);
    return out;
  } catch (err) {
    if (allowFailure) {
      console.log(`  - claude ${args.join(" ")} (skipped: ${firstLine(err)})`);
      return null;
    }
    console.error(`✗ claude ${args.join(" ")} failed:\n${firstLine(err)}`);
    process.exit(1);
  }
}

function firstLine(err) {
  const text = `${err.stderr || err.stdout || err.message}`.trim();
  return text.split("\n")[0];
}

function readClaudeJson(file) {
  try {
    return JSON.parse(readFileSync(join(claudeDir, "plugins", file), "utf-8"));
  } catch {
    return null;
  }
}

/** The installed dev plugin's version, or null when dev mode is off. */
function installedDevVersion() {
  const data = readClaudeJson("installed_plugins.json");
  const entry = (data?.plugins ?? data ?? {})[`cognigy@${DEV_MARKETPLACE}`];
  return (Array.isArray(entry) ? entry[0] : entry)?.version ?? null;
}

/** Whether the dev marketplace is this checkout's .dev-plugin, not another worktree's. */
function devMarketplaceIsHere() {
  const data = readClaudeJson("known_marketplaces.json");
  return data?.[DEV_MARKETPLACE]?.source?.path === devRoot;
}

/** Refresh the installed dev plugin from .dev-plugin/, keeping its settings. */
function updateInPlace({ allowFailure = false } = {}) {
  const ok =
    claude(["plugin", "marketplace", "update", DEV_MARKETPLACE], {
      allowFailure,
    }) !== null &&
    claude(["plugin", "update", `cognigy@${DEV_MARKETPLACE}`], {
      allowFailure,
    }) !== null;
  return ok;
}

/** The dev tooling that shapes the generated manifest and launcher. */
const DEV_TOOL_FILES = [
  "dev-plugin.mjs",
  "dev-engine.mjs",
  "dev-plugin-snapshot.mjs",
];

/**
 * Version suffix: the copied plugin/ files plus the dev tooling and target
 * folder, so a launcher or manifest change is a new version too (`claude
 * plugin update` copies nothing when the version is unchanged).
 */
function devVersionSuffix(fingerprint, out = devRoot) {
  const tooling = createHash("sha256").update(out);
  for (const file of DEV_TOOL_FILES)
    tooling.update(readFileSync(join(repoRoot, "scripts", file)));
  return `${fingerprint}.${tooling.digest("hex").slice(0, 8)}`;
}

/**
 * Write the dev marketplace to `out`. The engine launcher and its helper are
 * copied there too: `out` is gitignored, so they survive a switch to a branch
 * whose scripts/ predates them (the installed manifest points at them).
 */
export function generateDevPlugin(fingerprint, out = devRoot) {
  const manifest = JSON.parse(
    readFileSync(
      join(repoRoot, "plugin", ".claude-plugin", "plugin.json"),
      "utf-8",
    ),
  );

  // Every change is a new version, which `claude plugin update` needs to copy it.
  manifest.version = `${manifest.version}-dev.${devVersionSuffix(fingerprint, out)}`;
  manifest.description = `${manifest.description} (LOCAL DEV — serves the working tree)`;
  manifest.mcpServers.platform = {
    command: "node",
    args: [join(out, "dev-engine.mjs")],
    env: {
      ...manifest.mcpServers.platform.env,
      COGNIGY_DEV_FINGERPRINT: fingerprint,
      COGNIGY_DEV_REPO: repoRoot,
    },
  };

  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, ".claude-plugin"), { recursive: true });
  mkdirSync(join(out, "plugin", ".claude-plugin"), { recursive: true });

  writeFileSync(
    join(out, ".claude-plugin", "marketplace.json"),
    JSON.stringify(
      {
        name: DEV_MARKETPLACE,
        owner: { name: "Cognigy (local dev)" },
        plugins: [
          {
            name: manifest.name,
            source: "./plugin",
            description: manifest.description,
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );

  writeFileSync(
    join(out, "plugin", ".claude-plugin", "plugin.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  // Copy everything else in plugin/ (skills, agents, ...). Not symlinks:
  // Claude Code skips a plugin path that resolves outside the plugin and
  // marketplace directories ("agents path escapes plugin directory").
  for (const entry of readdirSync(pluginDir)) {
    if (entry === ".claude-plugin") continue;
    // Codex manifests carry the prod-pinned npx engine and evals are not
    // runtime files (see SKIPPED_ENTRIES).
    if (SKIPPED_ENTRIES.has(entry)) continue;
    cpSync(join(pluginDir, entry), join(out, "plugin", entry), {
      recursive: true,
      dereference: true,
      filter: (src) => !src.endsWith(".DS_Store"),
    });
  }

  for (const file of ["dev-engine.mjs", "dev-plugin-snapshot.mjs"]) {
    cpSync(join(repoRoot, "scripts", file), join(out, file));
  }

  console.log(`  ✓ generated ${out}`);
}

function on() {
  const fingerprint = pluginFingerprint(pluginDir);
  if (installedDevVersion() && devMarketplaceIsHere()) {
    console.log("Updating the local dev plugin in place…");
    generateDevPlugin(fingerprint);
    updateInPlace();
    console.log(`
Dev plugin updated (cognigy@${DEV_MARKETPLACE}); its settings were kept.
Run /reload-plugins in open Claude Code sessions.`);
    return;
  }
  console.log("Enabling local dev plugin…");
  generateDevPlugin(fingerprint);
  claude(["plugin", "uninstall", `cognigy@${PROD_MARKETPLACE}`], {
    allowFailure: true,
  });
  claude(["plugin", "marketplace", "remove", DEV_MARKETPLACE], {
    allowFailure: true,
  });
  claude(["plugin", "marketplace", "add", devRoot]);
  claude(["plugin", "install", `cognigy@${DEV_MARKETPLACE}`]);
  console.log(`
Dev plugin installed (cognigy@${DEV_MARKETPLACE}).
Next steps in Claude Code:
  1. /plugin configure cognigy@${DEV_MARKETPLACE}   (enter API base URL + key, once)
  2. /reload-plugins                                (or restart the session)
Iterate: edit src/** — then /reload-plugins. No build needed.
         edit plugin/** (skills, agents) — re-run "npm run plugin:dev", then /reload-plugins.
         switching branches re-syncs plugin/ automatically (git hooks).
Done testing: npm run plugin:dev:off`);
}

/**
 * git hooks (post-checkout, post-merge): re-sync the dev install when plugin/
 * changed. A no-op unless this checkout's dev plugin is installed, and never
 * fails the git command.
 */
function sync() {
  const installed = installedDevVersion();
  if (!installed || !devMarketplaceIsHere()) return;
  const fingerprint = pluginFingerprint(pluginDir);
  if (installed.endsWith(`-dev.${devVersionSuffix(fingerprint)}`)) return;
  console.log("Dev plugin: plugin/ changed, re-syncing the installed copy…");
  generateDevPlugin(fingerprint);
  if (updateInPlace({ allowFailure: true }))
    console.log(
      "Dev plugin re-synced (settings kept). Run /reload-plugins in open Claude Code sessions.",
    );
  else
    console.log(
      'Dev plugin re-sync failed; run "npm run plugin:dev" yourself.',
    );
}

function off() {
  console.log("Removing local dev plugin and restoring the GitHub install…");
  claude(["plugin", "uninstall", `cognigy@${DEV_MARKETPLACE}`], {
    allowFailure: true,
  });
  claude(["plugin", "marketplace", "remove", DEV_MARKETPLACE], {
    allowFailure: true,
  });
  rmSync(devRoot, { recursive: true, force: true });
  // Re-add the prod marketplace from GitHub even if a marketplace of the same
  // name exists (it may point at a local path from earlier testing).
  claude(["plugin", "marketplace", "remove", PROD_MARKETPLACE], {
    allowFailure: true,
  });
  claude(["plugin", "marketplace", "add", PROD_MARKETPLACE_SOURCE]);
  claude(["plugin", "install", `cognigy@${PROD_MARKETPLACE}`]);
  console.log(`
Prod plugin restored (cognigy@${PROD_MARKETPLACE}).
Next steps in Claude Code:
  1. /plugin configure cognigy@${PROD_MARKETPLACE}   (re-enter credentials if prompted)
  2. /reload-plugins                                 (or restart the session)`);
}

// Run only as a script; tests import generateDevPlugin. realpath, because the
// loader resolves symlinks in import.meta.url but not in argv[1].
const invoked =
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const mode = process.argv[2];
  if (mode === "on") on();
  else if (mode === "off") off();
  else if (mode === "sync") sync();
  else {
    console.error("Usage: node scripts/dev-plugin.mjs <on|off|sync>");
    process.exit(1);
  }
}
