#!/usr/bin/env node
/**
 * `cognigy-setup` — one-command installer for the NiCE Cognigy Plugin.
 * Run: `npx @cognigy/plugin-engine@latest cognigy-setup`.
 *
 * Collects the Cognigy API base URL + key (key masked, never echoed or written
 * to shell history), asks which client(s) to set up, and performs the full
 * install + credential wiring for each:
 *   - Claude Code (terminal + desktop/GUI): via the `claude` plugin CLI when
 *     present (key → keychain), else a creds-file fallback + printed commands.
 *   - Claude Desktop (standalone app): merges an auto-updating MCP server entry
 *     into claude_desktop_config.json.
 *
 * Non-interactive (scripting/CI): pass --client, --api-base-url, --api-key.
 */
import { createInterface } from "readline";
import { pathToFileURL } from "url";
import type { UserConfigFile } from "./userConfigFile.js";
import { detectClaudePath, installClaudeCode } from "./install/claudeCode.js";
import {
  installClaudeDesktop,
  resolveDesktopConfigPath,
} from "./install/claudeDesktop.js";
import { existsSync, realpathSync } from "fs";
import { dirname } from "path";

const DEFAULT_BASE_URL = "https://api-trial.cognigy.ai";

// ANSI styling — auto-disabled when stdout is not a TTY or NO_COLOR is set, so
// piped/CI output stays plain text.
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const wrap =
  (open: string, close: string) =>
  (t: string): string =>
    useColor ? `\x1b[${open}m${t}\x1b[${close}m` : t;
const bold = wrap("1", "22");
const dim = wrap("2", "22");
const green = wrap("32", "39");
const cyan = wrap("36", "39");
const yellow = wrap("33", "39");
const RULE = "═".repeat(60);

// Control codes handled during masked input.
const CTRL_C = 3;
const CTRL_D = 4;
const BACKSPACE = 8;
const DELETE = 127;

type Client = "claude-code" | "claude-desktop";
const ALL_CLIENTS: Client[] = ["claude-code", "claude-desktop"];
const CLIENT_LABELS: Record<Client, string> = {
  "claude-code": "Claude Code (terminal + desktop app)",
  "claude-desktop": "Claude Desktop (standalone app)",
};

interface Flags {
  clients: Client[];
  apiBaseUrl?: string;
  apiKey?: string;
}

function isClient(v: string): v is Client {
  return (ALL_CLIENTS as string[]).includes(v);
}

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = { clients: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const take = () => argv[++i];
    const addClient = (v: string | undefined) => {
      if (v && isClient(v) && !flags.clients.includes(v)) flags.clients.push(v);
    };
    if (arg === "--api-base-url") flags.apiBaseUrl = take();
    else if (arg.startsWith("--api-base-url="))
      flags.apiBaseUrl = arg.slice("--api-base-url=".length);
    else if (arg === "--api-key") flags.apiKey = take();
    else if (arg.startsWith("--api-key="))
      flags.apiKey = arg.slice("--api-key=".length);
    else if (arg === "--client") addClient(take());
    else if (arg.startsWith("--client="))
      addClient(arg.slice("--client=".length));
  }
  return flags;
}

/** Which clients look installed — used to pre-select the interactive menu. */
export function detectClients(): Record<Client, boolean> {
  return {
    "claude-code": detectClaudePath() !== null,
    "claude-desktop": existsSync(dirname(resolveDesktopConfigPath())),
  };
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Read a line without echoing it (masked with asterisks). */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = "";
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const finish = (cleanup: () => void) => {
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      cleanup();
    };

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (ch === "\n" || ch === "\r" || code === CTRL_D) {
          finish(() => resolve(value));
          return;
        }
        if (code === CTRL_C) {
          finish(() => reject(new Error("cancelled")));
          return;
        }
        if (code === BACKSPACE || code === DELETE) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        value += ch;
        process.stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

/** Parse a comma/space-separated menu answer like "1,2" into client keys. */
export function parseClientSelection(answer: string, menu: Client[]): Client[] {
  const picked: Client[] = [];
  for (const tok of answer.split(/[\s,]+/).filter(Boolean)) {
    const n = Number(tok);
    const client = Number.isInteger(n) ? menu[n - 1] : undefined;
    if (client && !picked.includes(client)) picked.push(client);
  }
  return picked;
}

/**
 * Interactive checkbox list: ↑/↓ (or j/k) move, Space toggles, Enter confirms
 * (requires at least one selection), Ctrl-C cancels. Redraws in place via ANSI
 * cursor moves. Requires a raw-mode TTY — callers fall back otherwise.
 */
function checkboxSelect(
  items: { label: string; checked: boolean }[],
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const state = items.map((it) => it.checked);
    let cursor = 0;
    // Lines we own and redraw: one per item + one help line.
    const rows = items.length + 1;

    const render = (first: boolean) => {
      if (!first) process.stdout.write(`\x1b[${rows}A`);
      items.forEach((it, i) => {
        const pointer = i === cursor ? cyan("❯") : " ";
        const box = state[i] ? green("[x]") : "[ ]";
        process.stdout.write(`\x1b[2K\r ${pointer} ${box} ${it.label}\n`);
      });
      process.stdout.write(
        `\x1b[2K\r${dim("   ↑/↓ move · Space check/uncheck · Enter confirm")}\n`,
      );
    };

    const cleanup = () => {
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };

    const onData = (chunk: string) => {
      if (chunk === "\x03") {
        cleanup();
        reject(new Error("cancelled"));
        return;
      }
      if (chunk === "\r" || chunk === "\n") {
        const picked = state
          .map((on, i) => (on ? i : -1))
          .filter((i) => i >= 0);
        if (picked.length === 0) return; // require at least one
        cleanup();
        process.stdout.write("\n");
        resolve(picked);
        return;
      }
      if (chunk === " ") {
        state[cursor] = !state[cursor];
        render(false);
        return;
      }
      if (chunk === "\x1b[A" || chunk === "\x1bOA" || chunk === "k") {
        cursor = (cursor - 1 + items.length) % items.length;
        render(false);
        return;
      }
      if (chunk === "\x1b[B" || chunk === "\x1bOB" || chunk === "j") {
        cursor = (cursor + 1) % items.length;
        render(false);
        return;
      }
    };

    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    render(true);
    stdin.on("data", onData);
  });
}

async function chooseClients(): Promise<Client[]> {
  const detected = detectClients();
  const menu = ALL_CLIENTS;
  process.stdout.write(
    bold("Where should the NiCE Cognigy plugin be installed?\n"),
  );

  // Non-TTY (rare in interactive mode): fall back to a numbered text prompt.
  if (!process.stdin.isTTY) {
    menu.forEach((c, i) => {
      const mark = detected[c] ? green(" (detected)") : "";
      process.stdout.write(
        `  ${cyan(String(i + 1))}) ${CLIENT_LABELS[c]}${mark}\n`,
      );
    });
    const defaults = menu.filter((c) => detected[c]);
    const defaultLabel = defaults.length
      ? defaults.map((c) => menu.indexOf(c) + 1).join(",")
      : "1";
    const answer = await ask(
      `Select (comma-separated numbers) [${defaultLabel}]: `,
    );
    const chosen = answer
      ? parseClientSelection(answer, menu)
      : defaults.length
        ? defaults
        : [menu[0]];
    return chosen.length ? chosen : [menu[0]];
  }

  const items = menu.map((c) => ({
    label: `${CLIENT_LABELS[c]}${detected[c] ? green(" (detected)") : ""}`,
    checked: detected[c],
  }));
  const picked = await checkboxSelect(items);
  return picked.map((i) => menu[i]);
}

function runInstall(client: Client, creds: UserConfigFile): void {
  if (client === "claude-code") {
    const res = installClaudeCode(creds);
    if (res.method === "cli") {
      process.stdout.write(
        green("\n✓ Claude Code") +
          ": plugin installed via the claude CLI " +
          dim("(key stored in keychain)") +
          ".\n  Restart Claude Code (or /reload-plugins) to apply. " +
          green("You get tools, skills, and agents.") +
          "\n",
      );
    } else {
      process.stdout.write(
        green("\n✓ Claude Code") +
          `: 'claude' CLI not found — wrote creds to ${res.configFile}.\n` +
          "  Paste these in Claude Code to finish:\n" +
          (res.commands ?? []).map((c) => cyan(`    ${c}`)).join("\n") +
          "\n",
      );
    }
    return;
  }
  // claude-desktop
  const res = installClaudeDesktop(creds);
  process.stdout.write(
    green("\n✓ Claude Desktop") +
      `: 'Cognigy' connector added to ${res.configPath}\n` +
      (res.backupPath
        ? dim(`  (backed up existing config to ${res.backupPath})\n`)
        : "") +
      "  Restart Claude Desktop — the 'Cognigy' connector gives you the " +
      bold("tools") +
      ".\n",
  );
  // Windows Desktop needs a firmer restart + a tool-refresh nudge, else the
  // connector either doesn't appear or appears with no tools loaded.
  if (process.platform === "win32") {
    process.stdout.write(
      "\n" +
        cyan(bold("  Windows — make the connector appear:\n")) +
        `    ${cyan("•")} If this run hit a permissions error, re-run it in a terminal opened ${bold("as Administrator")}.\n` +
        `    ${cyan("•")} ${bold("Fully quit")} Claude Desktop from the system tray (closing the window leaves it running), then reopen it.\n` +
        `    ${cyan("•")} Confirm the ${bold("cognigy")} connector shows under Settings → Connectors.\n` +
        `    ${cyan("•")} Then ${bold("disable it and re-enable it once")} to force a tool refresh.\n`,
    );
  }
  // A loud, unmissable block: on Desktop chat, skills + agents come ONLY from
  // these manual in-app steps. Without them the user has tools and nothing else.
  process.stdout.write(
    "\n" +
      yellow(RULE) +
      "\n" +
      yellow(bold("  ⚠️  ONE MORE STEP — CLAUDE DESKTOP CHAT ONLY  ⚠️")) +
      "\n" +
      yellow(RULE) +
      "\n" +
      bold("  You are NOT done yet.") +
      " The connector gives you tools only.\n" +
      "  " +
      bold(yellow("SKILLS & AGENTS install ONLY via these in-app steps")) +
      " —\n  do them now, in Claude Desktop:\n\n" +
      `    ${cyan("1.")} Click ${bold("Customize")} in the left sidebar.\n` +
      `    ${cyan("2.")} Next to ${bold("Personal plugins")} click ${bold("+")}, hover ${bold("Add")}, click ${bold("Add marketplace")}.\n` +
      `    ${cyan("3.")} In the URL field enter ${bold("Cognigy/cognigy-plugin")}, select the result, click ${bold("Sync")}.\n` +
      `    ${cyan("4.")} The ${bold("cognigy-plugin")} marketplace is now added.\n` +
      `    ${cyan("5.")} Install the ${bold("Cognigy")} plugin by clicking ${bold("+")}.\n` +
      `    ${cyan("6.")} On the local-MCP warning, click ${bold("Continue")}.\n\n` +
      dim(
        "  Leave the plugin's own 'platform' connector unconnected — the\n" +
          "  'Cognigy' connector already serves the tools.\n",
      ) +
      yellow(RULE) +
      "\n",
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== "setup");
  const flags = parseFlags(argv);
  const interactive = process.stdin.isTTY && flags.apiKey === undefined;

  let apiBaseUrl = flags.apiBaseUrl;
  let apiKey = flags.apiKey;
  let clients = flags.clients;

  if (interactive) {
    process.stdout.write(bold(cyan("\n🚀 NiCE Cognigy Plugin Setup\n\n")));
    clients = await chooseClients();
    process.stdout.write("\n");
    const urlAnswer = await ask(`Cognigy API base URL [${DEFAULT_BASE_URL}]: `);
    apiBaseUrl = urlAnswer || DEFAULT_BASE_URL;
    apiKey = await askHidden("Cognigy API key: ");
  } else {
    apiBaseUrl = apiBaseUrl || DEFAULT_BASE_URL;
    if (clients.length === 0) {
      process.stderr.write(
        "No client selected. Pass --client claude-code and/or --client claude-desktop.\n",
      );
      process.exit(1);
    }
  }

  if (!apiKey) {
    process.stderr.write(
      "No API key provided. Pass --api-key <key> or run interactively.\n",
    );
    process.exit(1);
  }

  const creds: UserConfigFile = {
    COGNIGY_API_BASE_URL: apiBaseUrl as string,
    COGNIGY_API_KEY: apiKey,
  };

  for (const client of clients) {
    runInstall(client, creds);
  }

  process.stdout.write(green(bold("\n✓ Done.\n")));
}

function runCli(): void {
  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "cancelled") {
      process.stderr.write("Cancelled.\n");
      process.exit(130);
    }
    process.stderr.write(`Setup failed: ${msg}\n`);
    process.exit(1);
  });
}

/**
 * True when this module is the process entrypoint. npm installs the
 * `cognigy-setup` bin as a symlink, and Node resolves ESM entry points through
 * realpath — so `import.meta.url` is the real file while `argv[1]` is the
 * symlink. Compare against the realpath of `argv[1]` or the guard never fires
 * under `npx …` and the whole installer silently no-ops.
 */
export function isMainModule(
  moduleUrl: string,
  argv1: string | undefined,
): boolean {
  if (!argv1) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

// Run only when invoked as the bin, not when imported (e.g. by tests).
if (isMainModule(import.meta.url, process.argv[1])) {
  runCli();
}
