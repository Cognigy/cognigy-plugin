import { describe, it, expect, afterEach } from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildCodexMarketplaceAddArgs,
  buildCodexMarketplaceRemoveArgs,
  buildCodexPluginAddArgs,
  buildCodexPluginRemoveArgs,
  codexGuiSteps,
  codexHasCognigyPlugin,
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
  it("marketplace add takes the owner/repo SOURCE", () => {
    expect(buildCodexMarketplaceAddArgs()).toEqual([
      "plugin",
      "marketplace",
      "add",
      "Cognigy/cognigy-plugin",
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

  it("no arg builder wires a global mcp server", () => {
    // The plugin declares its own `platform` server; a global
    // [mcp_servers.cognigy] entry would be a duplicate engine.
    const all = [
      ...buildCodexMarketplaceAddArgs(),
      ...buildCodexMarketplaceRemoveArgs(),
      ...buildCodexPluginAddArgs(),
      ...buildCodexPluginRemoveArgs(),
    ];
    expect(all).not.toContain("mcp");
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
