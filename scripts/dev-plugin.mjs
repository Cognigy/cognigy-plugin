#!/usr/bin/env node
/**
 * Local dev install for the plugin — test engine + skills + agents from the
 * working tree without ever editing the tracked plugin manifest.
 *
 *   npm run plugin:dev       — generate .dev-plugin/ (gitignored) and install it
 *   npm run plugin:dev:off   — disable the dev install and re-enable the GitHub plugin
 *
 * How it works:
 *  - Generates a dev marketplace under .dev-plugin/ whose plugin manifest is a
 *    copy of plugin/.claude-plugin/plugin.json with ONE change: the `platform`
 *    server runs the local TypeScript source directly via tsx (no build step).
 *    Skills and agents are symlinked to the working tree, so edits are live.
 *  - Installs it as cognigy@cognigy-dev and DISABLES the prod plugin to avoid
 *    duplicate tool names. Switching is disable/enable only — never uninstall
 *    or `marketplace remove`: both delete the plugin's saved userConfig (the
 *    API key lives in the keychain) and the CLI can't read a sensitive value
 *    back to restore it. Each install keeps its own config across switches.
 *  - After source/skill edits: run /reload-plugins in Claude Code. That's it.
 *
 * The tracked plugin.json is never touched; scripts/check-plugin-manifest.mjs
 * additionally guards its published form in CI and pre-commit.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const devRoot = join(repoRoot, ".dev-plugin");
const DEV_MARKETPLACE = "cognigy-dev";
const PROD_MARKETPLACE = "cognigy-plugin";
const PROD_MARKETPLACE_SOURCE = "Cognigy/cognigy-plugin";
const DEV_PLUGIN = `cognigy@${DEV_MARKETPLACE}`;
const PROD_PLUGIN = `cognigy@${PROD_MARKETPLACE}`;

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

function generateDevPlugin() {
  const manifest = JSON.parse(
    readFileSync(
      join(repoRoot, "plugin", ".claude-plugin", "plugin.json"),
      "utf-8",
    ),
  );

  manifest.version = `${manifest.version}-dev`;
  manifest.description = `${manifest.description} (LOCAL DEV — serves the working tree)`;
  manifest.mcpServers.platform = {
    command: "node",
    args: [
      join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
      join(repoRoot, "src", "index.ts"),
    ],
    env: manifest.mcpServers.platform.env,
  };

  rmSync(devRoot, { recursive: true, force: true });
  mkdirSync(join(devRoot, ".claude-plugin"), { recursive: true });
  mkdirSync(join(devRoot, "plugin", ".claude-plugin"), { recursive: true });

  writeFileSync(
    join(devRoot, ".claude-plugin", "marketplace.json"),
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
    join(devRoot, "plugin", ".claude-plugin", "plugin.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  // Symlink everything else in plugin/ (skills, agents, ...) so working-tree
  // edits are served live; fall back to copying if symlinks are unavailable
  // (e.g. Windows without Developer Mode / elevation).
  const copied = [];
  for (const entry of readdirSync(join(repoRoot, "plugin"))) {
    if (entry === ".claude-plugin") continue;
    // Codex manifests carry the prod-pinned npx engine — never serve them
    // from the dev marketplace (the dev loop is Claude-Code-only anyway).
    if (entry === ".codex-plugin") continue;
    const target = join(repoRoot, "plugin", entry);
    const link = join(devRoot, "plugin", entry);
    try {
      symlinkSync(target, link, "dir");
    } catch {
      cpSync(target, link, { recursive: true });
      copied.push(entry);
    }
  }

  console.log(`  ✓ generated ${devRoot}`);
  return { copied };
}

/**
 * Make `plugin` the active install and disable `other`, keeping both installs'
 * saved userConfig. Every step is idempotent: `marketplace add` repoints an
 * existing marketplace in place (e.g. .dev-plugin/ of another worktree) and
 * `install` is a no-op when already installed. Returns the userConfig keys
 * still unset on `plugin` (null if the CLI couldn't tell).
 */
export function activate({ plugin, marketplaceSource, other }, run = claude) {
  run(["plugin", "disable", other], { allowFailure: true });
  run(["plugin", "marketplace", "add", marketplaceSource]);
  run(["plugin", "install", plugin]);
  run(["plugin", "enable", plugin], { allowFailure: true }); // fails if already enabled
  const out = run(["plugin", "configure", plugin, "--json"], {
    allowFailure: true,
  });
  return out ? JSON.parse(out).unconfigured : null;
}

function configureHint(plugin, unconfigured) {
  if (unconfigured && unconfigured.length === 0) return "";
  const keys = unconfigured ? ` (unset: ${unconfigured.join(", ")})` : "";
  return `  ⚠ ${plugin} is not fully configured${keys} — its platform MCP server won't start.
    In Claude Code run: /plugin configure ${plugin}
    (once per install — later dev/off switches keep it)
`;
}

function on() {
  console.log("Enabling local dev plugin…");
  const { copied } = generateDevPlugin();
  if (copied.length > 0) {
    console.warn(
      `  ⚠ symlinks unavailable — copied instead: ${copied.join(", ")}. ` +
        `Edits under plugin/{${copied.join(",")}} are NOT live; ` +
        `re-run "npm run plugin:dev" after changing them.`,
    );
  }
  const unconfigured = activate({
    plugin: DEV_PLUGIN,
    marketplaceSource: devRoot,
    other: PROD_PLUGIN,
  });
  console.log(`
Dev plugin active (${DEV_PLUGIN}); ${PROD_PLUGIN} disabled, its config kept.
${configureHint(DEV_PLUGIN, unconfigured)}Next: /reload-plugins in Claude Code (or restart the session).
Iterate: edit src/** or plugin/skills/** — then /reload-plugins. No build needed.
Done testing: npm run plugin:dev:off`);
}

function off() {
  console.log("Disabling local dev plugin and re-enabling the GitHub install…");
  // `marketplace add` also repoints a cognigy-plugin marketplace that was
  // aimed at a local path during earlier testing back to GitHub.
  const unconfigured = activate({
    plugin: PROD_PLUGIN,
    marketplaceSource: PROD_MARKETPLACE_SOURCE,
    other: DEV_PLUGIN,
  });
  console.log(`
Prod plugin active (${PROD_PLUGIN}); ${DEV_PLUGIN} disabled, its config kept.
${configureHint(PROD_PLUGIN, unconfigured)}Next: /reload-plugins in Claude Code (or restart the session).
Full dev teardown (also deletes the dev install's saved config):
  claude plugin marketplace remove ${DEV_MARKETPLACE}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (mode === "on") on();
  else if (mode === "off") off();
  else {
    console.error("Usage: node scripts/dev-plugin.mjs <on|off>");
    process.exit(1);
  }
}
