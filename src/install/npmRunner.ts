/**
 * Run npm from the currently-running node (process.execPath) rather than from
 * PATH. Two reasons: (1) GUI/desktop-spawned processes launch with a minimal
 * PATH where `npm` may not resolve, and (2) invoking `node npm-cli.js` sidesteps
 * the Windows npm.cmd + CVE-2024-27980 spawn issue entirely. Falls back to `npm`
 * / `npm.cmd` on PATH (with shell + quoting on Windows) only if npm-cli.js can't
 * be located next to node.
 *
 * The Desktop launcher (desktopLauncher.ts) inlines the same logic as a
 * standalone .mjs; this TS copy is for the installer itself.
 */
import { spawnSync, type SpawnSyncReturns } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";

const isWin = process.platform === "win32";

/** Locate npm-cli.js next to the running node, or null if not found. */
export function resolveNpmCli(
  execPath: string = process.execPath,
): string | null {
  const nodeDir = dirname(execPath);
  const candidates = [
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/**
 * Quote args for a Windows `shell: true` (cmd.exe) invocation. Node does not
 * auto-quote when a shell is used, and cmd interprets `& | < > ^ ( )` — so an
 * arg like a `--config cognigy_api_key=<key>` value containing those would break
 * the command or be injectable. Wrap EVERY arg in double quotes (inside quotes
 * cmd treats those metacharacters literally) and escape embedded quotes; the
 * target programs (node-based npm.cmd / claude.cmd) parse `\"` as an escaped
 * quote. Caveat: a literal `%VAR%` can still be expanded by cmd, so callers must
 * not pass untrusted values containing `%`.
 */
export function quoteWinArgs(args: string[]): string[] {
  return args.map((a) => `"${a.replace(/"/g, '\\"')}"`);
}

export function runNpm(
  args: string[],
  opts: { timeout?: number; capture?: boolean } = {},
): SpawnSyncReturns<string> {
  const stdio: ["ignore", "pipe" | "ignore", "pipe" | "inherit"] = opts.capture
    ? ["ignore", "pipe", "pipe"]
    : ["ignore", "ignore", "inherit"];
  const npmCli = resolveNpmCli();
  if (npmCli) {
    return spawnSync(process.execPath, [npmCli, ...args], {
      encoding: "utf8",
      timeout: opts.timeout,
      stdio,
    });
  }
  const bin = isWin ? "npm.cmd" : "npm";
  const finalArgs = isWin ? quoteWinArgs(args) : args;
  return spawnSync(bin, finalArgs, {
    encoding: "utf8",
    timeout: opts.timeout,
    shell: isWin,
    stdio,
  });
}
