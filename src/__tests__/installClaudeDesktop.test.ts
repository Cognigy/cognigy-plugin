import { describe, it, expect, afterAll, jest } from "@jest/globals";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

// A tmp dir stands in for ~/.cognigy-plugin so the install never touches the
// real home dir. Created here so the mock factory (hoisted) can close over it.
const FAKE_HOME = mkdtempSync(join(tmpdir(), "cognigy-deskhome-"));

const runNpm = jest.fn(() => ({ status: 0, error: undefined }));

jest.unstable_mockModule("../install/npmRunner.js", () => ({
  runNpm,
  resolveNpmCli: () => null,
  quoteWinArgs: (a: string[]) => a,
}));
jest.unstable_mockModule("../install/desktopLauncher.js", () => ({
  USER_HOME_DIR: FAKE_HOME,
  DESKTOP_LAUNCHER_FILE: join(FAKE_HOME, "desktop-launch.mjs"),
  writeDesktopLauncher: () => join(FAKE_HOME, "desktop-launch.mjs"),
}));

const { installClaudeDesktop, ENGINE_PREFIX } = await import(
  "../install/claudeDesktop.js"
);

const tmpDirs: string[] = [FAKE_HOME];
function freshConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "cognigy-deskcfg-"));
  tmpDirs.push(dir);
  return join(dir, "claude_desktop_config.json");
}
afterAll(() => {
  while (tmpDirs.length)
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

const CREDS = {
  COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
  COGNIGY_API_KEY: "secret-key",
};

describe("installClaudeDesktop", () => {
  it("installs the engine into the per-user prefix and writes a 0600 config", () => {
    const configPath = freshConfigPath();
    const result = installClaudeDesktop(CREDS, configPath);

    // Engine install ran against the per-user prefix.
    expect(runNpm).toHaveBeenCalled();
    const args = (runNpm.mock.calls[0] as unknown as [string[]])[0];
    expect(args).toContain("install");
    expect(args).toContain("@cognigy/plugin-engine@latest");
    expect(args).toContain(ENGINE_PREFIX);

    // Config written with our server entry, owner-only.
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    expect(cfg.mcpServers.cognigy.args).toEqual([
      join(FAKE_HOME, "desktop-launch.mjs"),
    ]);
    expect(cfg.mcpServers.cognigy.env.COGNIGY_API_KEY).toBe("secret-key");
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(result.backupPath).toBeUndefined();
  });

  it("backs up an existing config and preserves other servers", () => {
    const configPath = freshConfigPath();
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { other: { command: "x", args: [] } } }),
    );

    const result = installClaudeDesktop(CREDS, configPath);

    expect(result.backupPath).toBe(`${configPath}.bak`);
    expect(existsSync(result.backupPath as string)).toBe(true);
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    expect(cfg.mcpServers.other).toEqual({ command: "x", args: [] });
    expect(cfg.mcpServers.cognigy).toBeDefined();
  });

  it("keeps the first pristine backup across re-runs", () => {
    const configPath = freshConfigPath();
    const original = JSON.stringify({
      mcpServers: { other: { command: "x" } },
    });
    writeFileSync(configPath, original);

    installClaudeDesktop(CREDS, configPath); // backs up the pristine original
    installClaudeDesktop(CREDS, configPath); // must NOT clobber the .bak

    const backup = JSON.parse(readFileSync(`${configPath}.bak`, "utf8"));
    expect(backup.mcpServers.cognigy).toBeUndefined(); // still the pristine file
    expect(backup.mcpServers.other).toEqual({ command: "x" });
  });

  it("throws when the engine install fails", () => {
    runNpm.mockReturnValueOnce({ status: 1, error: undefined });
    expect(() => installClaudeDesktop(CREDS, freshConfigPath())).toThrow(
      /Failed to install/,
    );
  });
});
