/**
 * Install the Cognigy plugin into Google Antigravity — the IDE and the `agy`
 * CLI, which share one config tree at ~/.gemini/config.
 *
 * Antigravity has a first-class plugin format, and unlike Claude Desktop it can
 * consume ours almost verbatim, so we build a real plugin rather than scattering
 * files. Layout (verified against Antigravity's own bundled plugins and with
 * `agy plugin validate`):
 *
 *   <plugin>/plugin.json            name + version + description
 *   <plugin>/mcp_config.json        { mcpServers: … }, read IN PLACE — the
 *                                   global ~/.gemini/config/mcp_config.json is
 *                                   never touched, so the plugin is removable
 *                                   without editing the user's own servers
 *   <plugin>/skills/<id>/SKILL.md   our skills, unchanged
 *   <plugin>/agents/<id>/agent.md   our agents (Antigravity wants `agent.md`;
 *                                   the name/description frontmatter matches)
 *
 * Skills are NOT renamed or prefixed: they are scoped to the plugin, exactly as
 * Antigravity's own bundled plugins do it (chrome-devtools-plugin ships a bare
 * `troubleshooting` skill too).
 *
 * We stage the plugin under ~/.cognigy-plugin and register it with
 * `agy plugin install <dir>`, which copies it into ~/.gemini/config/plugins and
 * records it in import_manifest.json. When `agy` is not on PATH we do the copy
 * ourselves and mark the plugin enabled in config.json — the same shape
 * Antigravity's bundled plugins use.
 *
 * Credentials are NOT written into any mcp_config.json. That file is shared,
 * hand-edited and routinely pasted into bug reports, so the API key goes to
 * ~/.cognigy-plugin/config.json (0600), which `loadConfig()` already reads
 * whenever the environment variables are absent.
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { spawnSync, type SpawnSyncReturns } from "child_process";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { UserConfigFile } from "../userConfigFile.js";
import { writeUserConfigFile } from "../userConfigFile.js";
import { quoteWinArgs, runNpm } from "./npmRunner.js";
// The launcher is shared with Claude Desktop — it is a generic "auto-update the
// engine, then hand off" shim, not a Desktop-specific one. Antigravity needs the
// same treatment: it is a GUI app with a minimal PATH that cannot resolve `npx`.
import {
  DESKTOP_LAUNCHER_FILE,
  USER_HOME_DIR,
  writeDesktopLauncher,
} from "./desktopLauncher.js";

const PKG = "@cognigy/plugin-engine";
export const ENGINE_PREFIX = join(USER_HOME_DIR, "engine");

/** Plugin directory name — also the name `agy plugin uninstall` takes. */
export const PLUGIN_NAME = "cognigy-plugin";

/** Config tree shared by the Antigravity IDE, the `agy` CLI and the SDK. */
export const GEMINI_CONFIG_DIR = join(homedir(), ".gemini", "config");
export const PLUGINS_DIR = join(GEMINI_CONFIG_DIR, "plugins");
export const INSTALLED_PLUGIN_DIR = join(PLUGINS_DIR, PLUGIN_NAME);
/**
 * Every plugin root we know of, newest first. `agy plugin install` decides where
 * it stages, and that has moved between versions — current builds use
 * config/plugins, older CLI builds used antigravity-cli/plugins. We only ever
 * WRITE to PLUGINS_DIR (the fallback path), but we must LOOK in both, or status
 * and uninstall would miss a plugin `agy` placed in the other one.
 */
export const PLUGIN_ROOTS = [
  PLUGINS_DIR,
  join(homedir(), ".gemini", "antigravity-cli", "plugins"),
];

/** Where our plugin is actually installed, or null when it isn't. */
export function findInstalledPluginDir(): string | null {
  for (const root of PLUGIN_ROOTS) {
    const dir = join(root, PLUGIN_NAME);
    if (existsSync(join(dir, "plugin.json"))) return dir;
  }
  return null;
}
export const AGY_CONFIG_FILE = join(GEMINI_CONFIG_DIR, "config.json");
/** Only read/cleaned — we never add our servers here. See module docs. */
export const GLOBAL_MCP_CONFIG = join(GEMINI_CONFIG_DIR, "mcp_config.json");

/** Where we build the plugin before handing it to `agy plugin install`. */
export const STAGING_DIR = join(USER_HOME_DIR, "antigravity-plugin");

/** mcpServers keys inside our plugin's own mcp_config.json. */
export const SERVER_KEY = "cognigy";
export const DOCS_SERVER_KEY = "cognigy-docs";
const DOCS_SERVER_URL = "https://docs.cognigy.com/mcp";

export interface AntigravityStdioServer {
  command: string;
  args: string[];
}
export interface AntigravityRemoteServer {
  /** Antigravity uses `serverUrl` for remote servers — not `url`/`httpUrl`. */
  serverUrl: string;
}
export type AntigravityServer =
  | AntigravityStdioServer
  | AntigravityRemoteServer;

/** Our own version, read from the package.json that ships beside dist/. */
export function engineVersion(
  moduleDir: string = dirname(fileURLToPath(import.meta.url)),
): string {
  for (const up of ["..", "../.."]) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(moduleDir, up, "package.json"), "utf-8"),
      ) as { name?: string; version?: string };
      if (pkg.name === PKG && pkg.version) return pkg.version;
    } catch {
      // Try the next candidate.
    }
  }
  return "0.0.0";
}

/**
 * Locate a shipped asset dir (`skills` / `agents`). Built installs read them
 * from dist/plugin-assets (copied at build time by scripts/copy-assets.mjs);
 * a source/tsx run reads plugin/ directly. Returns null when neither exists.
 */
export function resolveAssetDir(
  kind: "skills" | "agents",
  moduleDir: string = dirname(fileURLToPath(import.meta.url)),
): string | null {
  const candidates = [
    // dist/install/antigravity.js -> dist/plugin-assets/<kind>
    join(moduleDir, "..", "plugin-assets", kind),
    // src/install/antigravity.ts -> plugin/<kind>
    join(moduleDir, "..", "..", "plugin", kind),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** The plugin.json manifest, in the shape Antigravity's bundled plugins use. */
export function buildPluginManifest(
  version: string = engineVersion(),
): Record<string, unknown> {
  return {
    name: PLUGIN_NAME,
    version,
    description:
      "NiCE Cognigy Plugin — create, test, and manage AI Agents on the NiCE Cognigy platform",
    author: { name: "Cognigy", url: "https://www.cognigy.com" },
    repository: "https://github.com/Cognigy/cognigy-plugin",
    license: "MIT",
    keywords: ["cognigy", "ai-agents", "conversational-ai", "mcp", "llm"],
  };
}

/**
 * The plugin's own mcp_config.json. The stdio server runs the shared
 * auto-updating launcher via an absolute node path (GUI apps can't resolve
 * `npx`); the docs server is remote and needs no local process.
 */
export function buildPluginMcpConfig(
  nodePath: string = process.execPath,
  launcherPath: string = DESKTOP_LAUNCHER_FILE,
): { mcpServers: Record<string, AntigravityServer> } {
  return {
    mcpServers: {
      [SERVER_KEY]: { command: nodePath, args: [launcherPath] },
      [DOCS_SERVER_KEY]: { serverUrl: DOCS_SERVER_URL },
    },
  };
}

/**
 * Build the complete plugin directory at `destDir`, replacing anything already
 * there so files dropped in a later version don't linger. Returns what it wrote.
 */
export function stagePluginDir(
  destDir: string = STAGING_DIR,
  skillsSrc: string | null = resolveAssetDir("skills"),
  agentsSrc: string | null = resolveAssetDir("agents"),
): {
  dir: string;
  skills: string[];
  agents: string[];
} {
  // Refuse to stage a plugin with no content. Without this an engine build that
  // is missing dist/plugin-assets would stage an empty-but-valid plugin, and the
  // update path would then overwrite a working install with it and report
  // success. Fail loudly BEFORE anything is removed.
  if (!skillsSrc && !agentsSrc) {
    throw new Error(
      "No plugin assets found: expected skills/agents under dist/plugin-assets " +
        "(built by scripts/copy-assets.mjs) or plugin/. Refusing to stage an " +
        "empty plugin — reinstall the engine.",
    );
  }

  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });

  writeFileSync(
    join(destDir, "plugin.json"),
    `${JSON.stringify(buildPluginManifest(), null, 2)}\n`,
  );
  writeFileSync(
    join(destDir, "mcp_config.json"),
    `${JSON.stringify(buildPluginMcpConfig(), null, 2)}\n`,
  );

  // Skills copy across as-is: folder-per-skill with a SKILL.md inside.
  const skills: string[] = [];
  if (skillsSrc) {
    const skillsDest = join(destDir, "skills");
    mkdirSync(skillsDest, { recursive: true });
    for (const entry of readdirSync(skillsSrc, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      cpSync(join(skillsSrc, entry.name), join(skillsDest, entry.name), {
        recursive: true,
      });
      skills.push(entry.name);
    }
  }

  // Agents copy across as-is too. Antigravity accepts flat `agents/<name>.md`
  // (verified with `agy plugin validate`), which is also what other
  // multi-client plugins ship — so our Claude-format files need no conversion.
  const agents: string[] = [];
  if (agentsSrc) {
    const agentsDest = join(destDir, "agents");
    mkdirSync(agentsDest, { recursive: true });
    for (const entry of readdirSync(agentsSrc, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      cpSync(join(agentsSrc, entry.name), join(agentsDest, entry.name));
      agents.push(entry.name.replace(/\.md$/, ""));
    }
  }

  return { dir: destDir, skills, agents };
}

const AGY_TIMEOUT_MS = 120_000;

/**
 * Run `agy`. On Windows the binary is `agy.cmd`, which Node refuses to spawn
 * without a shell since the CVE-2024-27980 fix — so use the same shell+quoting
 * path npmRunner.ts uses. Bounded by a timeout so a hung CLI can't wedge setup.
 */
function runAgy(agyPath: string, args: string[]): SpawnSyncReturns<string> {
  const isWin = process.platform === "win32";
  return spawnSync(agyPath, isWin ? quoteWinArgs(args) : args, {
    encoding: "utf8",
    timeout: AGY_TIMEOUT_MS,
    shell: isWin,
  });
}

/** Delete any previously installed copy of our plugin, from every known root. */
export function clearInstalledPlugin(): string[] {
  const cleared: string[] = [];
  for (const root of PLUGIN_ROOTS) {
    const dir = join(root, PLUGIN_NAME);
    if (!existsSync(dir)) continue;
    rmSync(dir, { recursive: true, force: true });
    cleared.push(dir);
  }
  return cleared;
}

/** Copy a staged plugin into place ourselves and mark it enabled. */
function copyPluginIntoPlace(stagedDir: string): string {
  const dest = INSTALLED_PLUGIN_DIR;
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(stagedDir, dest, { recursive: true });
  enablePluginInConfig();
  return dest;
}

export interface RegisterResult {
  method: "agy" | "fallback";
  pluginDir: string;
  /** Why `agy` was not used: absent, or the failure it reported. */
  agyError?: string;
}

/**
 * Register a staged plugin with Antigravity. Prefers `agy plugin install` — it
 * decides the staging location and records the plugin itself — and falls back to
 * copying into place. A FAILING `agy` is reported distinctly from a MISSING one,
 * so the installer never claims "agy not found" when it actually errored.
 */
export function registerPlugin(stagedDir: string): RegisterResult {
  // `agy plugin install` COPIES INTO an existing plugin dir rather than
  // replacing it, so files an older version shipped survive an upgrade — we
  // observed a renamed agent counted twice. Clear any previous install first;
  // the staged copy is the source of truth.
  clearInstalledPlugin();

  const agy = detectAgyPath();
  if (!agy) {
    return { method: "fallback", pluginDir: copyPluginIntoPlace(stagedDir) };
  }
  const res = runAgy(agy, ["plugin", "install", stagedDir]);
  if (res.status === 0 && !res.error) {
    return {
      method: "agy",
      pluginDir: findInstalledPluginDir() ?? INSTALLED_PLUGIN_DIR,
    };
  }
  const reason = res.error ? res.error.message : `exit ${res.status}`;
  const stderr = (res.stderr ?? "").trim();
  return {
    method: "fallback",
    pluginDir: copyPluginIntoPlace(stagedDir),
    agyError: stderr ? `${reason} — ${stderr}` : reason,
  };
}

/** Absolute path to the `agy` CLI, or null when it isn't installed. */
export function detectAgyPath(): string | null {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [
    "agy",
  ]);
  const found = probe.stdout?.toString().trim().split(/\r?\n/)[0];
  if (probe.status === 0 && found) return found;
  // agy's installer drops it in ~/.local/bin, which GUI-launched shells and
  // non-login shells frequently leave off PATH.
  const fallback = join(homedir(), ".local", "bin", "agy");
  return existsSync(fallback) ? fallback : null;
}

/**
 * Read a JSON object for merging, distinguishing "absent" (nothing to preserve)
 * from "present but unreadable/malformed". The difference matters: silently
 * treating an unparseable config as empty and writing over it would discard the
 * user's other plugins and settings, so callers back it up first.
 */
export function readJsonForMerge(path: string): {
  root: Record<string, unknown>;
  malformed: boolean;
} {
  if (!existsSync(path)) return { root: {}, malformed: false };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { root: parsed as Record<string, unknown>, malformed: false };
    }
  } catch {
    // Fall through — unreadable or not JSON.
  }
  return { root: {}, malformed: true };
}

/**
 * Preserve a file we are about to rewrite from a blank slate. Keeps the FIRST
 * backup pristine, so a second run can't overwrite the original with our own
 * output.
 */
function backupOnce(path: string): void {
  const backup = `${path}.bak`;
  if (!existsSync(backup)) copyFileSync(path, backup);
}

/**
 * Mark the plugin enabled in config.json, the shape Antigravity's own bundled
 * plugins use. Only needed on the fallback path; `agy plugin install` records
 * the plugin in import_manifest.json itself.
 */
export function enablePluginInConfig(
  configPath: string = AGY_CONFIG_FILE,
): void {
  const { root, malformed } = readJsonForMerge(configPath);
  // An unparseable config still holds the user's other plugins and settings.
  // Never overwrite it blind — keep a copy before starting from a blank slate.
  if (malformed) backupOnce(configPath);
  const plugins =
    root.plugins &&
    typeof root.plugins === "object" &&
    !Array.isArray(root.plugins)
      ? (root.plugins as Record<string, unknown>)
      : {};
  plugins[PLUGIN_NAME] = { enabled: true };
  root.plugins = plugins;
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(root, null, 2)}\n`);
}

/** Drop our plugin's entry from config.json, leaving other plugins intact. */
export function disablePluginInConfig(
  configPath: string = AGY_CONFIG_FILE,
): boolean {
  const { root, malformed } = readJsonForMerge(configPath);
  // Removal is best-effort: never rewrite a config we could not parse.
  if (malformed) return false;
  const plugins = root.plugins;
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins))
    return false;
  if (!(PLUGIN_NAME in (plugins as Record<string, unknown>))) return false;
  delete (plugins as Record<string, unknown>)[PLUGIN_NAME];
  writeFileSync(configPath, `${JSON.stringify(root, null, 2)}\n`);
  return true;
}

/**
 * Remove a `cognigy` server from the GLOBAL mcp_config.json. Earlier setups
 * (and hand-rolled ones) put the server there; now it lives in the plugin, and
 * leaving both would boot two copies of the engine. Other servers are untouched.
 */
export function removeLegacyGlobalServer(
  configPath: string = GLOBAL_MCP_CONFIG,
): boolean {
  const { root, malformed } = readJsonForMerge(configPath);
  // Same rule as disablePluginInConfig: don't rewrite what we can't parse.
  if (malformed) return false;
  const servers = root.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers))
    return false;
  const map = servers as Record<string, unknown>;
  const present = [SERVER_KEY, DOCS_SERVER_KEY].filter((k) => k in map);
  if (present.length === 0) return false;
  for (const key of present) delete map[key];
  writeFileSync(configPath, `${JSON.stringify(root, null, 2)}\n`);
  return true;
}

export interface AntigravityInstallResult {
  pluginDir: string;
  method: "agy" | "fallback";
  /** Set when `agy` was present but failed, so the caller can surface why. */
  agyError?: string;
  launcherPath: string;
  credsFile: string;
  skills: string[];
  agents: string[];
  removedLegacyServer: boolean;
}

/**
 * Full Antigravity install: engine into the per-user prefix, the auto-updating
 * launcher, credentials into ~/.cognigy-plugin/config.json, then the staged
 * plugin registered via `agy` (or copied into place when `agy` is absent).
 * Throws only when the engine install fails outright.
 */
export function installAntigravity(
  creds: UserConfigFile,
): AntigravityInstallResult {
  // 1. Engine into the per-user prefix (avoids global install perms).
  mkdirSync(ENGINE_PREFIX, { recursive: true, mode: 0o700 });
  const res = runNpm([
    "install",
    `${PKG}@latest`,
    "--prefix",
    ENGINE_PREFIX,
    "--no-fund",
    "--no-audit",
    "--loglevel=error",
  ]);
  if (res.status !== 0 || res.error) {
    const reason = res.error ? res.error.message : `exit ${res.status}`;
    throw new Error(
      `Failed to install ${PKG} into ${ENGINE_PREFIX} (${reason}). ` +
        `Check network/registry access and retry.`,
    );
  }

  // 2. Launcher + credentials. Antigravity has no credential prompt of its own,
  //    and we keep the key out of any shared config (see module docs).
  const launcherPath = writeDesktopLauncher();
  const credsFile = writeUserConfigFile(creds);

  // 3. Build the plugin, then register it (throws before touching anything if
  //    this engine build carries no assets).
  const staged = stagePluginDir();
  const registered = registerPlugin(staged.dir);

  // 4. Retire any older global entry so only one engine boots.
  const removedLegacyServer = removeLegacyGlobalServer();

  return {
    pluginDir: registered.pluginDir,
    method: registered.method,
    agyError: registered.agyError,
    launcherPath,
    credsFile,
    skills: staged.skills,
    agents: staged.agents,
    removedLegacyServer,
  };
}

/**
 * Re-stage and re-register the plugin from this engine's shipped assets. Used by
 * `cognigy-setup update`: the engine itself auto-updates via the launcher, but
 * skills and agents are plain files that only change when we rewrite them.
 * Credentials are left untouched.
 */
export function updateAntigravity(): RegisterResult & {
  skills: string[];
  agents: string[];
} {
  // stagePluginDir throws when this build has no assets, BEFORE the existing
  // install is touched — otherwise an assetless engine would quietly replace a
  // working plugin with an empty one.
  const staged = stagePluginDir();
  return {
    ...registerPlugin(staged.dir),
    skills: staged.skills,
    agents: staged.agents,
  };
}

/**
 * True when Antigravity looks present — either the CLI or the config tree the
 * IDE creates on first launch.
 */
export function detectAntigravity(): boolean {
  return existsSync(join(homedir(), ".gemini")) || detectAgyPath() !== null;
}

/** True when our plugin is currently installed, in either plugin root. */
export function antigravityHasPlugin(pluginDir?: string): boolean {
  if (pluginDir) return existsSync(join(pluginDir, "plugin.json"));
  return findInstalledPluginDir() !== null;
}

/** Version recorded in the installed plugin's manifest, or null. */
export function installedPluginVersion(
  pluginDir: string | null = findInstalledPluginDir(),
): string | null {
  if (!pluginDir) return null;
  try {
    return (
      (
        JSON.parse(readFileSync(join(pluginDir, "plugin.json"), "utf-8")) as {
          version?: string;
        }
      ).version ?? null
    );
  } catch {
    return null;
  }
}

export interface AntigravityUninstallResult {
  method: "agy" | "fallback";
  removedPlugin: boolean;
  removedLegacyServer: boolean;
}

/** Remove the plugin via `agy` when available, else by hand. */
export function uninstallAntigravity(): AntigravityUninstallResult {
  // Snapshot first: "removed" must mean we removed something that was there,
  // not merely that nothing is there now.
  const before = findInstalledPluginDir();
  const agy = detectAgyPath();
  let method: AntigravityUninstallResult["method"] = "fallback";
  if (agy && before) {
    const res = runAgy(agy, ["plugin", "uninstall", PLUGIN_NAME]);
    if (res.status === 0 && !res.error) method = "agy";
  }
  // Sweep both roots — `agy` may have staged it somewhere we don't write to,
  // and an older run may have left a copy in the other one.
  for (const root of PLUGIN_ROOTS) {
    const dir = join(root, PLUGIN_NAME);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  // `agy plugin uninstall` clears its own manifest entry but not the
  // config.json flag we may have written on the fallback path.
  disablePluginInConfig();
  rmSync(STAGING_DIR, { recursive: true, force: true });

  return {
    method,
    removedPlugin: before !== null,
    removedLegacyServer: removeLegacyGlobalServer(),
  };
}
