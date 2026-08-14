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
  agyTimestamp,
  antigravityHasPlugin,
  readJsonForMerge,
  removeImportManifestEntry,
  upsertImportManifestEntry,
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

    // Agents ship flat, as `agents/<name>.md` — verified against
    // `agy plugin validate`, so no conversion of our Claude files is needed.
    expect(staged.agents).toContain("cognigy-agent-builder");
    for (const name of staged.agents) {
      const file = join(dir, "agents", `${name}.md`);
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

describe("stagePluginDir guards", () => {
  it("throws rather than staging an empty plugin when assets are missing", () => {
    // A build without dist/plugin-assets must fail loudly: the update path
    // replaces the installed plugin with whatever was staged, so an
    // empty-but-valid plugin would silently wipe a working install.
    const dir = freshDir();
    expect(() => stagePluginDir(dir, null, null)).toThrow(
      /No plugin assets found/,
    );
    // Nothing was written, so an existing install is left alone.
    expect(existsSync(join(dir, "plugin.json"))).toBe(false);
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

  it("backs up an unparseable config instead of silently destroying it", () => {
    // A malformed config still holds the user's other plugins and settings.
    // Overwriting it from a blank slate would lose them with no recovery.
    const path = join(freshDir(), "config.json");
    const original = '{ "plugins": { "science": { "enabled": true } }, oops';
    writeFileSync(path, original);

    enablePluginInConfig(path);

    expect(readFileSync(`${path}.bak`, "utf-8")).toBe(original);
    expect(
      JSON.parse(readFileSync(path, "utf-8")).plugins[PLUGIN_NAME],
    ).toEqual({ enabled: true });
  });

  it("refuses to rewrite an unparseable config when removing", () => {
    const path = join(freshDir(), "config.json");
    const original = "{ not json";
    writeFileSync(path, original);
    expect(disablePluginInConfig(path)).toBe(false);
    expect(readFileSync(path, "utf-8")).toBe(original);
  });
});

describe("import_manifest.json", () => {
  const AT = new Date("2026-08-14T12:03:36.789Z");

  it("stamps agy's seconds-precision UTC format", () => {
    expect(agyTimestamp(AT)).toBe("2026-08-14T12:03:36Z");
  });

  it("writes the entry agy would, preserving other plugins'", () => {
    const path = join(freshDir(), "import_manifest.json");
    writeFileSync(
      path,
      JSON.stringify({
        imports: [
          {
            name: "other-plugin",
            source: "antigravity",
            components: ["skills"],
          },
        ],
      }),
    );

    upsertImportManifestEntry(["skills", "agents", "mcpServers"], path, AT);

    const imports = JSON.parse(readFileSync(path, "utf-8")).imports;
    expect(imports).toHaveLength(2);
    expect(
      imports.find((e: { name: string }) => e.name === "other-plugin"),
    ).toBeDefined();
    expect(
      imports.find((e: { name: string }) => e.name === PLUGIN_NAME),
    ).toEqual({
      name: PLUGIN_NAME,
      source: "antigravity",
      importedAt: "2026-08-14T12:03:36Z",
      components: ["skills", "agents", "mcpServers"],
    });
  });

  it("replaces our own entry instead of duplicating it", () => {
    const path = join(freshDir(), "import_manifest.json");
    upsertImportManifestEntry(["skills"], path, AT);
    upsertImportManifestEntry(["skills", "agents"], path, AT);
    const imports = JSON.parse(readFileSync(path, "utf-8")).imports;
    expect(imports).toHaveLength(1);
    expect(imports[0].components).toEqual(["skills", "agents"]);
  });

  it("handles agy's null `imports` and an absent file", () => {
    const path = join(freshDir(), "import_manifest.json");
    writeFileSync(path, JSON.stringify({ imports: null }));
    upsertImportManifestEntry(["skills"], path, AT);
    expect(JSON.parse(readFileSync(path, "utf-8")).imports).toHaveLength(1);

    const fresh = join(freshDir(), "nested", "import_manifest.json");
    upsertImportManifestEntry(["skills"], fresh, AT);
    expect(JSON.parse(readFileSync(fresh, "utf-8")).imports).toHaveLength(1);
  });

  it("removes our entry and restores agy's null when it was the last one", () => {
    const path = join(freshDir(), "import_manifest.json");
    upsertImportManifestEntry(["skills"], path, AT);
    expect(removeImportManifestEntry(path)).toBe(true);
    // agy represents "nothing installed" as null, not [].
    expect(JSON.parse(readFileSync(path, "utf-8")).imports).toBeNull();
    // Idempotent.
    expect(removeImportManifestEntry(path)).toBe(false);
  });

  it("keeps other plugins when removing ours", () => {
    const path = join(freshDir(), "import_manifest.json");
    writeFileSync(
      path,
      JSON.stringify({ imports: [{ name: "other-plugin", components: [] }] }),
    );
    upsertImportManifestEntry(["skills"], path, AT);
    expect(removeImportManifestEntry(path)).toBe(true);
    const imports = JSON.parse(readFileSync(path, "utf-8")).imports;
    expect(imports).toHaveLength(1);
    expect(imports[0].name).toBe("other-plugin");
  });
});

describe("readJsonForMerge", () => {
  it("separates absent from malformed", () => {
    const dir = freshDir();
    const missing = join(dir, "missing.json");
    expect(readJsonForMerge(missing)).toEqual({ root: {}, malformed: false });

    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ nope");
    expect(readJsonForMerge(bad).malformed).toBe(true);

    // A JSON array is not a config object either.
    const arr = join(dir, "arr.json");
    writeFileSync(arr, "[1,2]");
    expect(readJsonForMerge(arr).malformed).toBe(true);

    const good = join(dir, "good.json");
    writeFileSync(good, '{"a":1}');
    expect(readJsonForMerge(good)).toEqual({
      root: { a: 1 },
      malformed: false,
    });
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
