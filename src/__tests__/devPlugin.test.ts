import { describe, it, expect } from "@jest/globals";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.cwd();
const load = (file: string): Promise<any> =>
  import(pathToFileURL(join(repo, "scripts", file)).href);

// The installed dev plugin must keep starting after a switch to a branch whose
// scripts/ has no dev-engine.mjs (Codex/Copilot review on #70).
describe("dev plugin engine launcher", () => {
  it("starts from .dev-plugin/ on a checkout without scripts/", async () => {
    const { generateDevPlugin } = await load("dev-plugin.mjs");
    const { pluginFingerprint } = await load("dev-plugin-snapshot.mjs");
    const tmp = mkdtempSync(join(tmpdir(), "dev-plugin-"));
    try {
      const out = join(tmp, ".dev-plugin");
      generateDevPlugin("installed-fp", out);
      const manifest = JSON.parse(
        readFileSync(
          join(out, "plugin", ".claude-plugin", "plugin.json"),
          "utf-8",
        ),
      );
      const { args, env } = manifest.mcpServers.platform;
      expect(args).toEqual([join(out, "dev-engine.mjs")]);
      expect(env.COGNIGY_DEV_REPO).toBe(repo);

      // An older checkout: package.json, node_modules, src/ and plugin/ only.
      const checkout = join(tmp, "checkout");
      mkdirSync(join(checkout, "src"), { recursive: true });
      mkdirSync(join(checkout, "plugin"));
      writeFileSync(join(checkout, "package.json"), "{}");
      symlinkSync(join(repo, "node_modules"), join(checkout, "node_modules"));
      writeFileSync(
        join(checkout, "src", "index.ts"),
        'const notice: string = process.env.COGNIGY_DEV_NOTICE ?? "fresh";\nconsole.log(notice.slice(0, 20));\n',
      );
      const start = (fingerprint: string) =>
        spawnSync(process.execPath, args, {
          env: {
            ...process.env,
            COGNIGY_DEV_REPO: checkout,
            COGNIGY_DEV_FINGERPRINT: fingerprint,
          },
          encoding: "utf-8",
        });

      const stale = start("installed-fp");
      expect(stale.stderr).toBe("");
      expect(stale.stdout.trim()).toBe("DEV PLUGIN IS STALE:");

      const fresh = start(pluginFingerprint(join(checkout, "plugin")));
      expect(fresh.stdout.trim()).toBe("fresh");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
