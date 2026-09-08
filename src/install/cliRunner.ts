/**
 * Shared helpers for driving client CLIs (`claude`, `codex`) from the
 * installer: PATH detection plus a Windows-safe spawn. (Antigravity is
 * deliberately not driven through its CLI — see src/install/antigravity.ts.)
 */
import { spawnSync } from "child_process";
import { quoteWinArgs } from "./npmRunner.js";

const isWin = process.platform === "win32";

/** Resolve a binary on PATH (`which`/`where`), or null. */
export function detectOnPath(bin: string): string | null {
  const finder = isWin ? "where" : "which";
  const res = spawnSync(finder, [bin], { encoding: "utf8" });
  if (res.status !== 0 || !res.stdout) return null;
  const first = res.stdout.split(/\r?\n/).find((l) => l.trim());
  return first ? first.trim() : null;
}

/**
 * Run a client CLI with inherited output. These CLIs are `.cmd` shims on
 * Windows → need shell:true + arg quoting (the CVE-2024-27980 lesson). Under
 * a shell the *command* isn't auto-quoted either, so an absolute path with
 * spaces (e.g. under "Program Files") would break — use the bare bin name on
 * Windows (PATH already resolved it, since `where` succeeded) and reserve the
 * absolute path for non-Windows. stdin ignored so a stray prompt can't hang
 * the run.
 */
export function runCliTool(bin: string, absPath: string, args: string[]) {
  const command = isWin ? bin : absPath;
  return spawnSync(command, isWin ? quoteWinArgs(args) : args, {
    stdio: ["ignore", "inherit", "inherit"],
    shell: isWin,
  });
}
