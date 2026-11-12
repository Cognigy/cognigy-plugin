/**
 * Small helpers shared by the command-line tools (`cognigy-setup`,
 * `cognigy-envs`): prompts, masked input, single key presses, and the
 * "am I the entrypoint" check. Moved here unchanged from `setup.ts`.
 */
import { createInterface } from "readline";
import { realpathSync } from "fs";
import { pathToFileURL } from "url";

// Control codes handled during masked input.
const CTRL_C = 3;
const CTRL_D = 4;
const BACKSPACE = 8;
const DELETE = 127;

export function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Read a line without echoing it (masked with asterisks). */
export function askHidden(question: string): Promise<string> {
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

/**
 * Read one key press in raw mode. Arrow keys arrive as one chunk such as
 * "\x1b[A" (up) and "\x1b[B" (down); Ctrl-C arrives as "\x03".
 */
export function readKey(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.once("data", (chunk: string) => {
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      resolve(chunk);
    });
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
