#!/usr/bin/env node
/**
 * Assembles the Gemini CLI extension archive for a release.
 *
 * Gemini CLI installs extensions from a GitHub Release asset whose ARCHIVE
 * ROOT contains gemini-extension.json — but this repo keeps its plugin
 * content under plugin/, so nothing extension-shaped is committed at the
 * repo root. Instead this script stages a complete extension layout in
 * .gemini-extension/ (gitignored) and zips it to cognigy-gemini-extension.zip,
 * which semantic-release uploads as a release asset (.releaserc exec
 * prepareCmd + @semantic-release/github assets). Nothing is committed, so
 * there is no drift and no extra version-sync target.
 *
 * GEMINI.md (the extension's always-on context file) is generated from the
 * engine's SERVER_INSTRUCTIONS so guidance has a single source of truth.
 * That import needs dist/ — in the release flow `npm publish` has already
 * run `prepublishOnly: npm run build`; locally run `npm run build` first.
 *
 * The manifest declares COGNIGY_API_BASE_URL / COGNIGY_API_KEY as extension
 * settings: manual installs prompt for them (sensitive → OS keychain).
 * Installer-driven setups (cognigy-setup) skip the prompts — the engine
 * falls back to ~/.cognigy-plugin/config.json. Both work because Gemini
 * passes ONLY declared env vars to extension MCP servers.
 *
 * Usage: node scripts/build-gemini-extension.mjs <version>
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stagingDir = join(repoRoot, ".gemini-extension");
const archiveName = "cognigy-gemini-extension.zip";

// Gemini sub-agents use the same markdown format as plugin/agents/*.md; flip
// this off if client-side compat testing ever shows otherwise.
const INCLUDE_AGENTS = true;

const version = process.argv[2];
if (!version) {
  console.error("usage: build-gemini-extension.mjs <version>");
  process.exit(1);
}

let SERVER_INSTRUCTIONS;
try {
  ({ SERVER_INSTRUCTIONS } = await import("../dist/instructions.js"));
} catch (err) {
  console.error(
    `[gemini-ext] FAILED to load dist/instructions.js — run "npm run build" first (${err.message})`,
  );
  process.exit(1);
}

// The engine pin uses an npm alias (cognigy-engine@npm:...) so `npm exec`
// never resolves the spec to this repo's own package when a session is
// rooted here (name match would skip the install — MCP error -32000).
const manifest = {
  name: "cognigy",
  version,
  description:
    "NiCE Cognigy Plugin — create, test, and manage AI Agents on the NiCE Cognigy platform",
  contextFileName: "GEMINI.md",
  mcpServers: {
    platform: {
      command: "npx",
      args: [
        "-y",
        "-p",
        `cognigy-engine@npm:@cognigy/plugin-engine@${version}`,
        "cognigy-mcp",
      ],
    },
    docs: {
      httpUrl: "https://docs.cognigy.com/mcp",
    },
  },
  settings: [
    {
      name: "Cognigy API base URL",
      description:
        "Your Cognigy instance API URL. Use https://api-trial.cognigy.ai if you are on the trial.",
      envVar: "COGNIGY_API_BASE_URL",
      sensitive: false,
    },
    {
      name: "Cognigy API key",
      description: "Find it in Cognigy.AI → User Menu → My Profile → API Keys.",
      envVar: "COGNIGY_API_KEY",
      sensitive: true,
    },
  ],
};

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

writeFileSync(
  join(stagingDir, "gemini-extension.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
writeFileSync(
  join(stagingDir, "GEMINI.md"),
  `# NiCE Cognigy Plugin\n\n${SERVER_INSTRUCTIONS}\n`,
);
cpSync(join(repoRoot, "plugin", "skills"), join(stagingDir, "skills"), {
  recursive: true,
});
if (INCLUDE_AGENTS) {
  cpSync(join(repoRoot, "plugin", "agents"), join(stagingDir, "agents"), {
    recursive: true,
  });
}

const zipPath = join(repoRoot, archiveName);
rmSync(zipPath, { force: true });
const zip = spawnSync("zip", ["-r", zipPath, "."], {
  cwd: stagingDir,
  stdio: ["ignore", "ignore", "inherit"],
});
if (zip.status !== 0) {
  console.error(
    `[gemini-ext] FAILED to zip ${stagingDir} (zip exit ${zip.status ?? zip.error?.message})`,
  );
  process.exit(1);
}
console.error(`[gemini-ext] built ${zipPath} (version ${version})`);
