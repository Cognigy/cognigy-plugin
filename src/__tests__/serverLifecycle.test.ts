/**
 * Server lifecycle regression tests.
 *
 * The MCP stdio transport only listens for 'data'/'error' on stdin — it never
 * detects that the client hung up. Combined with any timer that refs the event
 * loop, a parent that disappears WITHOUT sending SIGINT/SIGTERM (crash, force
 * quit, pipes simply closed) used to leave the server running forever as an
 * orphan process holding its whole heap.
 *
 * These tests spawn the real server and assert it terminates on every
 * disconnect path. They run the TypeScript entry through tsx because CI runs
 * `npm test` before `npm run build`, so `dist/` may not exist yet.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTRY = join(REPO_ROOT, "src", "index.ts");

// Generous so a cold tsx start on slow CI can't cause a false failure.
const BOOT_TIMEOUT_MS = 30000;
const EXIT_TIMEOUT_MS = 15000;
const TEST_TIMEOUT_MS = 60000;

const children: ChildProcessWithoutNullStreams[] = [];

/** Spawn the server and resolve once it reports a successful start. */
async function startServer(): Promise<ChildProcessWithoutNullStreams> {
  // `--import tsx` rather than tsx's CLI: the CLI spawns a grandchild, which a
  // kill on the direct child would not reap — leaking the very orphan
  // processes these tests exist to prevent.
  const child = spawn(process.execPath, ["--import", "tsx", ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      // No request is ever made; these only have to satisfy loadConfig().
      COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
      COGNIGY_API_KEY: "lifecycle-test-key",
      LOG_LEVEL: "info",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("server did not start in time")),
      BOOT_TIMEOUT_MS,
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.includes("started successfully")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited during startup (code ${code} )`));
    });
  });

  // Drop the startup 'exit' rejection listener so it can't fire later.
  child.removeAllListeners("exit");
  return child;
}

/** Resolve with the exit code, or reject if the process outlives the timeout. */
function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `server was still running ${EXIT_TIMEOUT_MS}ms after the client went away — it would leak as an orphan process`,
          ),
        ),
      EXIT_TIMEOUT_MS,
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
  });
}

// Reap survivors and wait for them to actually die, so a failing test can
// neither leak a process nor leave Jest hanging on an open handle.
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const dead = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill("SIGKILL");
      await dead;
    }),
  );
});

describe("server lifecycle", () => {
  it(
    "exits when the client closes stdin (EOF, no signal)",
    async () => {
      const child = await startServer();
      const exited = waitForExit(child);
      child.stdin.end();
      expect(await exited).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "exits when the stdin pipe is destroyed abruptly",
    async () => {
      const child = await startServer();
      const exited = waitForExit(child);
      child.stdin.destroy();
      expect(await exited).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "still exits on SIGTERM",
    async () => {
      const child = await startServer();
      const exited = waitForExit(child);
      child.kill("SIGTERM");
      expect(await exited).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});
