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

async function chooseClients(): Promise<Client[]> {
  const detected = detectClients();
  const menu = ALL_CLIENTS;
  process.stdout.write("Where should the Cognigy plugin be installed?\n");
  menu.forEach((c, i) => {
    const mark = detected[c] ? " (detected)" : "";
    process.stdout.write(`  ${i + 1}) ${CLIENT_LABELS[c]}${mark}\n`);
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

function runInstall(client: Client, creds: UserConfigFile): void {
  if (client === "claude-code") {
    const res = installClaudeCode(creds);
    if (res.method === "cli") {
      process.stdout.write(
        "\n✓ Claude Code: plugin installed via the claude CLI (key stored in keychain).\n" +
          "  Restart Claude Code (or /reload-plugins) to apply.\n",
      );
    } else {
      process.stdout.write(
        `\n✓ Claude Code: 'claude' CLI not found — wrote creds to ${res.configFile}.\n` +
          "  Paste these in Claude Code to finish:\n" +
          (res.commands ?? []).map((c) => `    ${c}`).join("\n") +
          "\n",
      );
    }
    return;
  }
  // claude-desktop
  const res = installClaudeDesktop(creds);
  process.stdout.write(
    `\n✓ Claude Desktop: 'cognigy' connector added to ${res.configPath}\n` +
      (res.backupPath
        ? `  (backed up existing config to ${res.backupPath})\n`
        : "") +
      "  Restart Claude Desktop — the 'cognigy' connector gives you the tools.\n" +
      "\n" +
      "  To also get skills + agents, install the plugin in the app:\n" +
      "    1. Click 'Customize' in the left sidebar.\n" +
      "    2. Next to 'Personal plugins' click '+', hover 'Add', click 'Add marketplace'.\n" +
      "    3. In the URL field enter 'Cognigy/cognigy-plugin', select the result, click 'Sync'.\n" +
      "    4. The 'cognigy-plugin' marketplace is now added.\n" +
      "    5. Install the 'Cognigy' plugin by clicking '+'.\n" +
      "    6. On the local-MCP warning, click 'Continue'.\n" +
      "  Leave the plugin's own 'platform' connector unconnected — the 'cognigy'\n" +
      "  connector already serves the tools.\n",
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
    process.stdout.write("Cognigy Plugin setup\n\n");
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

  process.stdout.write("\nDone.\n");
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
