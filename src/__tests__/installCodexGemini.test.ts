import { describe, it, expect, afterEach } from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildCodexMarketplaceAddArgs,
  buildCodexMarketplaceRemoveArgs,
  buildCodexMarketplaceUpgradeArgs,
  buildCodexPluginAddArgs,
  buildCodexPluginRemoveArgs,
  codexGuiSteps,
  codexHasCognigyPlugin,
  readCodexMarketplaceRef,
} from "../install/codex.js";
import {
  buildGeminiInstallArgs,
  buildGeminiUninstallArgs,
  buildGeminiUpdateArgs,
  installedGeminiExtensionVersion,
} from "../install/gemini.js";

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "cognigy-test-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length)
    rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("codex arg building", () => {
  it("marketplace add takes the owner/repo SOURCE, pinned to main", () => {
    // The --ref is load-bearing: without it Codex resolves the ref from the
    // git checkout the installer runs in, which pins the snapshot to a feature
    // branch that stops moving once merged.
    expect(buildCodexMarketplaceAddArgs()).toEqual([
      "plugin",
      "marketplace",
      "add",
      "Cognigy/cognigy-plugin",
      "--ref",
      "main",
    ]);
  });

  it("marketplace remove takes the registered NAME, not the source", () => {
    // `codex plugin marketplace remove <MARKETPLACE_NAME>` — the name is the
    // `name` field of marketplace.json, so passing owner/repo here is a no-op.
    expect(buildCodexMarketplaceRemoveArgs()).toEqual([
      "plugin",
      "marketplace",
      "remove",
      "cognigy-plugin",
    ]);
  });

  it("plugin add/remove use the PLUGIN@MARKETPLACE selector", () => {
    expect(buildCodexPluginAddArgs()).toEqual([
      "plugin",
      "add",
      "cognigy@cognigy-plugin",
    ]);
    expect(buildCodexPluginRemoveArgs()).toEqual([
      "plugin",
      "remove",
      "cognigy@cognigy-plugin",
    ]);
  });

  it("marketplace upgrade takes no target", () => {
    expect(buildCodexMarketplaceUpgradeArgs()).toEqual([
      "plugin",
      "marketplace",
      "upgrade",
    ]);
  });

  it("no arg builder wires a global mcp server", () => {
    // The plugin declares its own `platform` server; a global
    // [mcp_servers.cognigy] entry would be a duplicate engine.
    const all = [
      ...buildCodexMarketplaceAddArgs(),
      ...buildCodexMarketplaceRemoveArgs(),
      ...buildCodexMarketplaceUpgradeArgs(),
      ...buildCodexPluginAddArgs(),
      ...buildCodexPluginRemoveArgs(),
    ];
    expect(all).not.toContain("mcp");
  });

  it("marketplace add and remove use different argument kinds", () => {
    // Guards the recovery path: `marketplace add` fails outright when the name
    // is registered from a different source string (the HTTPS URL the GUI
    // writes, or a branch ref), so the installer must not treat that as fatal.
    // Encoding the asymmetry here keeps the two from being "unified" later.
    const add = buildCodexMarketplaceAddArgs()[3];
    const remove = buildCodexMarketplaceRemoveArgs().at(-1);
    expect(add).toContain("/");
    expect(remove).not.toContain("/");
  });

  it("the GUI fallback names the marketplace source", () => {
    expect(codexGuiSteps().join("\n")).toContain("Cognigy/cognigy-plugin");
  });
});

describe("codexHasCognigyPlugin", () => {
  it("finds the installed-plugin table", () => {
    const config = join(tmp(), "config.toml");
    writeFileSync(
      config,
      `model = "gpt-5"\n\n[plugins."cognigy@cognigy-plugin"]\nenabled = true\n`,
    );
    expect(codexHasCognigyPlugin(config)).toBe(true);
  });

  it("is false for other plugins, missing file, and a bare mcp server", () => {
    const dir = tmp();
    expect(codexHasCognigyPlugin(join(dir, "nope.toml"))).toBe(false);
    const config = join(dir, "config.toml");
    writeFileSync(
      config,
      `[plugins."github@openai-curated"]\nenabled = true\n\n[mcp_servers.cognigy]\ncommand = "npx"\n`,
    );
    expect(codexHasCognigyPlugin(config)).toBe(false);
  });
});

describe("readCodexMarketplaceRef", () => {
  it("reads the ref of our git marketplace", () => {
    const config = join(tmp(), "config.toml");
    writeFileSync(
      config,
      `model = "gpt-5"\n\n[marketplaces.cognigy-plugin]\nsource_type = "git"\n` +
        `source = "https://github.com/Cognigy/cognigy-plugin.git"\nref = "main"\n`,
    );
    expect(readCodexMarketplaceRef(config)).toBe("main");
  });

  it("reports a stale branch ref so the installer can re-pin it", () => {
    // The 1.8.3-forever bug: installed from a checkout on a feature branch,
    // which then merged and stopped moving.
    const config = join(tmp(), "config.toml");
    writeFileSync(
      config,
      `[marketplaces.cognigy-plugin]\nsource_type = "git"\n` +
        `ref = "feat/plugin-platforms-codex-gemini"\n\n[marketplaces.openai-bundled]\n` +
        `source_type = "local"\nref = "not-ours"\n`,
    );
    expect(readCodexMarketplaceRef(config)).toBe(
      "feat/plugin-platforms-codex-gemini",
    );
  });

  it("is null for a local source, another marketplace, or no file", () => {
    const dir = tmp();
    expect(readCodexMarketplaceRef(join(dir, "nope.toml"))).toBe(null);

    // A local source is a developer's own wiring — never re-pin it.
    const local = join(dir, "local.toml");
    writeFileSync(
      local,
      `[marketplaces.cognigy-plugin]\nsource_type = "local"\nsource = "/tmp/x"\n`,
    );
    expect(readCodexMarketplaceRef(local)).toBe(null);

    const other = join(dir, "other.toml");
    writeFileSync(
      other,
      `[marketplaces.openai-bundled]\nsource_type = "git"\nref = "main"\n`,
    );
    expect(readCodexMarketplaceRef(other)).toBe(null);
  });
});

describe("gemini arg building", () => {
  it("install carries --skip-settings (creds come from the creds file, never extension settings)", () => {
    expect(buildGeminiInstallArgs()).toEqual([
      "extensions",
      "install",
      "https://github.com/Cognigy/cognigy-plugin",
      "--auto-update",
      "--consent",
      "--skip-settings",
    ]);
  });

  it("update/uninstall target the extension by name", () => {
    expect(buildGeminiUpdateArgs()).toEqual([
      "extensions",
      "update",
      "cognigy",
    ]);
    expect(buildGeminiUninstallArgs()).toEqual([
      "extensions",
      "uninstall",
      "cognigy",
    ]);
  });
});

describe("installedGeminiExtensionVersion", () => {
  it("reads the version from the installed manifest", () => {
    const extDir = join(tmp(), "cognigy");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(
      join(extDir, "gemini-extension.json"),
      JSON.stringify({ name: "cognigy", version: "1.8.1" }),
    );
    expect(installedGeminiExtensionVersion(extDir)).toBe("1.8.1");
  });

  it("returns null for missing dir, malformed JSON, or non-string version", () => {
    const dir = tmp();
    expect(installedGeminiExtensionVersion(join(dir, "missing"))).toBeNull();
    const extDir = join(dir, "cognigy");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "gemini-extension.json"), "{not json");
    expect(installedGeminiExtensionVersion(extDir)).toBeNull();
    writeFileSync(
      join(extDir, "gemini-extension.json"),
      JSON.stringify({ version: 42 }),
    );
    expect(installedGeminiExtensionVersion(extDir)).toBeNull();
  });
});
