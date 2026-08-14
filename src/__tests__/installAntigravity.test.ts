import { describe, it, expect, afterAll } from "@jest/globals";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  DOCS_SERVER_KEY,
  PLUGIN_NAME,
  SERVER_KEY,
  buildPluginManifest,
  buildPluginMcpConfig,
  disablePluginInConfig,
  enablePluginInConfig,
  engineVersion,
  installedPluginVersion,
  antigravityHasPlugin,
  removeLegacyGlobalServer,
  resolveAssetDir,
  stagePluginDir,
} from "../install/antigravity.js";

const tmpDirs: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cognigy-ag-"));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => {
  while (tmpDirs.length)
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

describe("buildPluginManifest", () => {
  it("carries the fields Antigravity's bundled plugins use", () => {
    const m = buildPluginManifest("1.2.3");
    expect(m.name).toBe(PLUGIN_NAME);
    expect(m.version).toBe("1.2.3");
    expect(typeof m.description).toBe("string");
  });

  it("defaults to this engine's real version", () => {
    expect(engineVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("buildPluginMcpConfig", () => {
  it("declares the stdio engine and the remote docs server", () => {
    const cfg = buildPluginMcpConfig("/usr/bin/node", "/home/u/launch.mjs");
    expect(cfg.mcpServers[SERVER_KEY]).toEqual({
      command: "/usr/bin/node",
      args: ["/home/u/launch.mjs"],
    });
    // Antigravity uses `serverUrl` for remote servers — `url` would be ignored.
    expect(cfg.mcpServers[DOCS_SERVER_KEY]).toEqual({
      serverUrl: "https://docs.cognigy.com/mcp",
    });
    // Credentials must never land in a config file.
    expect(JSON.stringify(cfg)).not.toContain("COGNIGY_API_KEY");
  });
});

describe("stagePluginDir", () => {
  it("builds the exact layout `agy plugin validate` accepts", () => {
    const dir = freshDir();
    const staged = stagePluginDir(dir);

    expect(existsSync(join(dir, "plugin.json"))).toBe(true);
    expect(existsSync(join(dir, "mcp_config.json"))).toBe(true);

    // Skills: folder-per-skill with SKILL.md, names left unprefixed because
    // they are scoped to the plugin.
    expect(staged.skills.length).toBeGreaterThan(0);
    for (const name of staged.skills) {
      expect(existsSync(join(dir, "skills", name, "SKILL.md"))).toBe(true);
      expect(name.startsWith("cognigy-")).toBe(false);
    }
    // Nested skill assets (the xapps templates/) must come along.
    expect(existsSync(join(dir, "skills", "xapps", "templates"))).toBe(true);

    // Agents: flat .md in our repo, <name>/agent.md for Antigravity.
    expect(staged.agents).toContain("cognigy-agent-builder");
    for (const name of staged.agents) {
      const file = join(dir, "agents", name, "agent.md");
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf-8")).toContain(`name: ${name}`);
    }

    expect(antigravityHasPlugin(dir)).toBe(true);
    expect(installedPluginVersion(dir)).toBe(engineVersion());
  });

  it("replaces a stale staging dir so removed files do not linger", () => {
    const dir = freshDir();
    stagePluginDir(dir);
    const stale = join(dir, "skills", "settings", "stale.md");
    writeFileSync(stale, "old");
    stagePluginDir(dir);
    expect(existsSync(stale)).toBe(false);
  });
});

describe("resolveAssetDir", () => {
  it("finds the shipped skills and agents", () => {
    expect(resolveAssetDir("skills")).not.toBeNull();
    expect(resolveAssetDir("agents")).not.toBeNull();
  });
});

describe("config.json plugin flag", () => {
  it("enables our plugin without disturbing others", () => {
    const path = join(freshDir(), "config.json");
    writeFileSync(
      path,
      JSON.stringify({
        plugins: { science: { enabled: true } },
        userSettings: { themeMode: "THEME_MODE_DARK" },
      }),
    );

    enablePluginInConfig(path);
    let root = JSON.parse(readFileSync(path, "utf-8"));
    expect(root.plugins[PLUGIN_NAME]).toEqual({ enabled: true });
    expect(root.plugins.science).toEqual({ enabled: true });
    expect(root.userSettings.themeMode).toBe("THEME_MODE_DARK");

    expect(disablePluginInConfig(path)).toBe(true);
    root = JSON.parse(readFileSync(path, "utf-8"));
    expect(root.plugins[PLUGIN_NAME]).toBeUndefined();
    expect(root.plugins.science).toEqual({ enabled: true });
    // Second removal is a no-op, not an error.
    expect(disablePluginInConfig(path)).toBe(false);
  });

  it("creates the file when absent", () => {
    const path = join(freshDir(), "nested", "config.json");
    enablePluginInConfig(path);
    expect(
      JSON.parse(readFileSync(path, "utf-8")).plugins[PLUGIN_NAME],
    ).toEqual({ enabled: true });
  });
});

describe("removeLegacyGlobalServer", () => {
  it("clears an older global cognigy entry but keeps foreign servers", () => {
    const path = join(freshDir(), "mcp_config.json");
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: {
          cognigy: { command: "node", args: ["/old/launch.mjs"] },
          other: { command: "x", args: [] },
        },
      }),
    );

    expect(removeLegacyGlobalServer(path)).toBe(true);
    const root = JSON.parse(readFileSync(path, "utf-8"));
    expect(root.mcpServers.cognigy).toBeUndefined();
    expect(root.mcpServers.other).toEqual({ command: "x", args: [] });
    // Idempotent.
    expect(removeLegacyGlobalServer(path)).toBe(false);
  });

  it("is a no-op when the file is missing or has no entry of ours", () => {
    expect(removeLegacyGlobalServer(join(freshDir(), "nope.json"))).toBe(false);
    const path = join(freshDir(), "mcp_config.json");
    writeFileSync(path, JSON.stringify({ mcpServers: { other: {} } }));
    expect(removeLegacyGlobalServer(path)).toBe(false);
  });
});

describe("antigravityHasPlugin", () => {
  it("is false for a directory without a manifest", () => {
    const dir = freshDir();
    mkdirSync(join(dir, "skills"), { recursive: true });
    expect(antigravityHasPlugin(dir)).toBe(false);
    expect(installedPluginVersion(dir)).toBeNull();
  });
});
