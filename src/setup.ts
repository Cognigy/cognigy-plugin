#!/usr/bin/env node
/**
 * `cognigy-setup` — interactive credential setup for clients whose plugin
 * installer does not prompt for `userConfig` (e.g. the Claude Code GUI today).
 * Exposed as the `cognigy-setup` bin: `npx @cognigy/plugin-engine cognigy-setup`.
 *
 * Collects the Cognigy API base URL and API key and writes them to
 * ~/.cognigy-plugin/config.json (owner-only, 0600). The engine's loadConfig()
 * reads that file only when the matching env var is unset, so terminal users
 * who already get a keychain prompt are unaffected.
 *
 * The API key prompt is masked and never echoed to the terminal or stored in a
 * shell history. Non-interactive callers can pass --api-base-url / --api-key.
 */
import { createInterface } from "readline";
import { writeUserConfigFile } from "./userConfigFile.js";

const DEFAULT_BASE_URL = "https://api-trial.cognigy.ai";

// Control codes handled during masked input.
const CTRL_C = 3;
const CTRL_D = 4;
const BACKSPACE = 8;
const DELETE = 127;

interface Flags {
  apiBaseUrl?: string;
  apiKey?: string;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const take = () => argv[++i];
    if (arg === "--api-base-url") flags.apiBaseUrl = take();
    else if (arg.startsWith("--api-base-url="))
      flags.apiBaseUrl = arg.slice("--api-base-url=".length);
    else if (arg === "--api-key") flags.apiKey = take();
    else if (arg.startsWith("--api-key="))
      flags.apiKey = arg.slice("--api-key=".length);
  }
  return flags;
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== "setup");
  const flags = parseFlags(argv);
  const interactive = process.stdin.isTTY && flags.apiKey === undefined;

  let apiBaseUrl = flags.apiBaseUrl;
  let apiKey = flags.apiKey;

  if (interactive) {
    process.stdout.write("Cognigy Plugin setup\n\n");
    const urlAnswer = await ask(`Cognigy API base URL [${DEFAULT_BASE_URL}]: `);
    apiBaseUrl = urlAnswer || DEFAULT_BASE_URL;
    apiKey = await askHidden("Cognigy API key: ");
  } else {
    // Non-interactive: values must come from flags.
    apiBaseUrl = apiBaseUrl || DEFAULT_BASE_URL;
  }

  if (!apiKey) {
    process.stderr.write(
      "No API key provided. Pass --api-key <key> or run interactively.\n",
    );
    process.exit(1);
  }

  const file = writeUserConfigFile({
    COGNIGY_API_BASE_URL: apiBaseUrl as string,
    COGNIGY_API_KEY: apiKey,
  });

  process.stdout.write(`\n✓ Wrote ${file} (chmod 600)\n`);
  process.stdout.write("Restart Claude Code to apply.\n");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "cancelled") {
    process.stderr.write("Cancelled.\n");
    process.exit(130);
  }
  process.stderr.write(`Setup failed: ${msg}\n`);
  process.exit(1);
});
