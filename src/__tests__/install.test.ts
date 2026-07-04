import { describe, it, expect, afterEach } from "@jest/globals";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

import {
  buildDesktopServerEntry,
  mergeDesktopConfig,
  resolveDesktopConfigPath,
} from "../install/claudeDesktop.js";
import {
  buildMarketplaceAddArgs,
  buildPluginInstallArgs,
  fallbackCommands,
} from "../install/claudeCode.js";
import { quoteWinArgs, resolveNpmCli } from "../install/npmRunner.js";
import {
  DESKTOP_LAUNCHER_SOURCE,
  writeDesktopLauncher,
} from "../install/desktopLauncher.js";
import { isMainModule, parseClientSelection, parseFlags } from "../setup.js";

const tmpDirs: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cognigy-install-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length)
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

const CREDS = {
  COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
  COGNIGY_API_KEY: "secret-key",
};

describe("resolveDesktopConfigPath", () => {
  it("resolves the macOS path", () => {
    expect(resolveDesktopConfigPath("darwin", {}, "/Users/x")).toBe(
      "/Users/x/Library/Application Support/Claude/claude_desktop_config.json",
    );
  });

  it("resolves the Windows path from APPDATA", () => {
    expect(
      resolveDesktopConfigPath(
        "win32",
        { APPDATA: "C:\\Users\\x\\AppData\\Roaming" },
        "C:\\Users\\x",
      ),
    ).toContain("claude_desktop_config.json");
  });

  it("falls back to the default Windows AppData path when APPDATA is unset", () => {
    const p = resolveDesktopConfigPath("win32", {}, "/home/x");
    expect(p).toContain("AppData");
    expect(p).toContain("Claude");
  });

  it("resolves the Linux path", () => {
    expect(resolveDesktopConfigPath("linux", {}, "/home/x")).toBe(
      "/home/x/.config/claude-desktop/claude_desktop_config.json",
    );
  });
});

describe("buildDesktopServerEntry", () => {
  it("uses absolute node + launcher and puts creds in env", () => {
    const entry = buildDesktopServerEntry(
      CREDS,
      "/abs/node",
      "/abs/launch.mjs",
    );
    expect(entry).toEqual({
      command: "/abs/node",
      args: ["/abs/launch.mjs"],
      env: {
        COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
        COGNIGY_API_KEY: "secret-key",
      },
    });
  });
});

describe("mergeDesktopConfig", () => {
  const entry = buildDesktopServerEntry(CREDS, "/node", "/launch.mjs");

  it("creates mcpServers when the file is absent", () => {
    const out = JSON.parse(mergeDesktopConfig(null, entry));
    expect(out.mcpServers.cognigy).toEqual(entry);
  });

  it("preserves other servers and top-level keys", () => {
    const existing = JSON.stringify({
      globalShortcut: "Cmd+Space",
      mcpServers: { other: { command: "x", args: [] } },
    });
    const out = JSON.parse(mergeDesktopConfig(existing, entry));
    expect(out.globalShortcut).toBe("Cmd+Space");
    expect(out.mcpServers.other).toEqual({ command: "x", args: [] });
    expect(out.mcpServers.cognigy).toEqual(entry);
  });

  it("overwrites a stale cognigy entry in place", () => {
    const existing = JSON.stringify({
      mcpServers: { cognigy: { command: "old", args: ["old"], env: {} } },
    });
    const out = JSON.parse(mergeDesktopConfig(existing, entry));
    expect(out.mcpServers.cognigy).toEqual(entry);
  });

  it("treats malformed JSON as empty (caller backs up first)", () => {
    const out = JSON.parse(mergeDesktopConfig("{ not json", entry));
    expect(out.mcpServers.cognigy).toEqual(entry);
  });

  it("ignores a non-object mcpServers", () => {
    const out = JSON.parse(
      mergeDesktopConfig(JSON.stringify({ mcpServers: ["x"] }), entry),
    );
    expect(out.mcpServers.cognigy).toEqual(entry);
  });
});

describe("claudeCode arg building", () => {
  it("builds the idempotent marketplace add args", () => {
    expect(buildMarketplaceAddArgs()).toEqual([
      "plugin",
      "marketplace",
      "add",
      "Cognigy/cognigy-plugin",
    ]);
  });

  it("maps creds onto --config plugin install args", () => {
    expect(buildPluginInstallArgs(CREDS)).toEqual([
      "plugin",
      "install",
      "cognigy@cognigy-plugin",
      "--scope",
      "user",
      "--config",
      "cognigy_api_base_url=https://api-trial.cognigy.ai",
      "--config",
      "cognigy_api_key=secret-key",
    ]);
  });

  it("offers the manual /plugin fallback commands", () => {
    expect(fallbackCommands()).toEqual([
      "/plugin marketplace add Cognigy/cognigy-plugin",
      "/plugin install cognigy@cognigy-plugin",
    ]);
  });
});

describe("quoteWinArgs", () => {
  it("quotes every arg so cmd metacharacters stay literal", () => {
    expect(quoteWinArgs(["install", "C:\\Program Files\\x", "plain"])).toEqual([
      '"install"',
      '"C:\\Program Files\\x"',
      '"plain"',
    ]);
  });

  it("quotes cmd metacharacters that would otherwise break/inject", () => {
    // A stray & | < > ^ ( ) in an API key must not reach cmd unquoted.
    expect(quoteWinArgs(["cognigy_api_key=a&b|c<d>e^f"])).toEqual([
      '"cognigy_api_key=a&b|c<d>e^f"',
    ]);
  });

  it("escapes embedded double quotes", () => {
    expect(quoteWinArgs(['a"b'])).toEqual(['"a\\"b"']);
  });
});

describe("resolveNpmCli", () => {
  it("finds npm-cli.js next to node (Windows-style layout)", () => {
    const dir = freshDir();
    const nodeDir = join(dir, "nodedir");
    mkdirSync(join(nodeDir, "node_modules", "npm", "bin"), { recursive: true });
    writeFileSync(
      join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
      "",
    );
    expect(resolveNpmCli(join(nodeDir, "node"))).toBe(
      join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    );
  });

  it("returns null when npm-cli.js is absent", () => {
    const dir = freshDir();
    expect(resolveNpmCli(join(dir, "node"))).toBeNull();
  });
});

describe("writeDesktopLauncher", () => {
  it("writes the launcher source owner-only (0600)", () => {
    const dir = freshDir();
    const file = writeDesktopLauncher(dir);
    expect(readFileSync(file, "utf8")).toBe(DESKTOP_LAUNCHER_SOURCE);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("emits a launcher that reserves stdout and imports the engine entry", () => {
    // Guard the invariants that keep MCP stdio clean + updates landing.
    expect(DESKTOP_LAUNCHER_SOURCE).toContain('"dist", "index.js"'); // engine entry path
    expect(DESKTOP_LAUNCHER_SOURCE).toContain("pathToFileURL"); // hand off via import
    expect(DESKTOP_LAUNCHER_SOURCE).toContain("@cognigy/plugin-engine");
    // stdout must never be written to — diagnostics go to stderr only.
    expect(DESKTOP_LAUNCHER_SOURCE).not.toContain("process.stdout.write");
  });
});

describe("isMainModule", () => {
  it("matches when argv[1] is a symlink to the module (the npm-bin case)", () => {
    const dir = freshDir();
    const real = join(dir, "setup.js");
    writeFileSync(real, "");
    const link = join(dir, "cognigy-setup");
    symlinkSync(real, link);
    const moduleUrl = pathToFileURL(realpathSync(real)).href;
    // argv[1] is the symlink, import.meta.url is the realpath'd module.
    expect(isMainModule(moduleUrl, link)).toBe(true);
  });

  it("returns false for a different entrypoint or missing argv", () => {
    const dir = freshDir();
    const real = join(dir, "setup.js");
    writeFileSync(real, "");
    const moduleUrl = pathToFileURL(real).href;
    expect(isMainModule(moduleUrl, join(dir, "nonexistent"))).toBe(false);
    expect(isMainModule(moduleUrl, undefined)).toBe(false);
  });
});

describe("parseFlags", () => {
  it("parses repeatable --client (space and = forms) and dedupes", () => {
    const f = parseFlags([
      "--client",
      "claude-code",
      "--client=claude-desktop",
      "--client",
      "claude-code",
      "--api-base-url=https://x",
      "--api-key",
      "k",
    ]);
    expect(f.clients).toEqual(["claude-code", "claude-desktop"]);
    expect(f.apiBaseUrl).toBe("https://x");
    expect(f.apiKey).toBe("k");
  });

  it("ignores unknown --client values", () => {
    expect(parseFlags(["--client", "codex"]).clients).toEqual([]);
  });
});

describe("parseClientSelection", () => {
  const menu = ["claude-code", "claude-desktop"] as const;

  it("maps 1-based numbers, comma or space separated", () => {
    expect(parseClientSelection("1, 2", [...menu])).toEqual([
      "claude-code",
      "claude-desktop",
    ]);
    expect(parseClientSelection("2 1", [...menu])).toEqual([
      "claude-desktop",
      "claude-code",
    ]);
  });

  it("dedupes and drops out-of-range/garbage", () => {
    expect(parseClientSelection("1 1 9 x", [...menu])).toEqual(["claude-code"]);
  });
});
