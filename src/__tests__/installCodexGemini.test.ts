import { describe, it, expect, afterEach } from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildCodexMarketplaceAddArgs,
  buildCodexMcpAddArgs,
  buildCodexMcpRemoveArgs,
  codexConfigSnippet,
  codexHasCognigyEntry,
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
  it("mcp add uses the aliased engine spec after the -- separator", () => {
    // The alias form (cognigy-engine@npm:...) is load-bearing: a plain spec
    // resolves to this repo's own package in sessions rooted here (-32000).
    expect(buildCodexMcpAddArgs()).toEqual([
      "mcp",
      "add",
      "cognigy",
      "--",
      "npx",
      "-y",
      "-p",
      "cognigy-engine@npm:@cognigy/plugin-engine@latest",
      "cognigy-mcp",
    ]);
  });

  it("mcp remove targets the same server key", () => {
    expect(buildCodexMcpRemoveArgs()).toEqual(["mcp", "remove", "cognigy"]);
  });

  it("marketplace add points at the GitHub repo", () => {
    expect(buildCodexMarketplaceAddArgs()).toEqual([
      "plugin",
      "marketplace",
      "add",
      "Cognigy/cognigy-plugin",
    ]);
  });

  it("config snippet is a [mcp_servers.cognigy] table with the alias pin", () => {
    const snippet = codexConfigSnippet();
    expect(snippet).toMatch(/^\[mcp_servers\.cognigy\]$/m);
    expect(snippet).toContain(
      "cognigy-engine@npm:@cognigy/plugin-engine@latest",
    );
  });
});

describe("codexHasCognigyEntry", () => {
  it("finds an existing [mcp_servers.cognigy] table", () => {
    const config = join(tmp(), "config.toml");
    writeFileSync(
      config,
      `model = "gpt-5"\n\n[mcp_servers.cognigy]\ncommand = "npx"\n`,
    );
    expect(codexHasCognigyEntry(config)).toBe(true);
  });

  it("is false for other servers, missing file, and lookalike keys", () => {
    const dir = tmp();
    expect(codexHasCognigyEntry(join(dir, "nope.toml"))).toBe(false);
    const config = join(dir, "config.toml");
    writeFileSync(
      config,
      `[mcp_servers.context7]\ncommand = "npx"\n\n[plugins."cognigy@cognigy-plugin"]\nenabled = true\n`,
    );
    expect(codexHasCognigyEntry(config)).toBe(false);
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
