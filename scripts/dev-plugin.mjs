#!/usr/bin/env node
/**
 * Local dev install for the plugin — test engine + skills + agents from the
 * working tree without ever editing the tracked plugin manifest.
 *
 *   npm run plugin:dev       — generate .dev-plugin/ (gitignored) and install it
 *   npm run plugin:dev:off   — remove the dev install and restore the GitHub plugin
 *
 * How it works:
 *  - Generates a dev marketplace under .dev-plugin/ whose plugin manifest is a
 *    copy of plugin/.claude-plugin/plugin.json with ONE change: the `platform`
 *    server runs the local TypeScript source directly via tsx (no build step).
 *    Skills and agents are symlinked to the working tree, so edits are live.
 *  - Installs it as cognigy@cognigy-dev and uninstalls the prod plugin to avoid
 *    duplicate tool names.
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
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const devRoot = join(repoRoot, ".dev-plugin");
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
Iterate: edit src/** or plugin/skills/** — then /reload-plugins. No build needed.
Done testing: npm run plugin:dev:off`);
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

const mode = process.argv[2];
if (mode === "on") on();
else if (mode === "off") off();
else {
  console.error("Usage: node scripts/dev-plugin.mjs <on|off>");
  process.exit(1);
}
