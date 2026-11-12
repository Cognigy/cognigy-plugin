#!/usr/bin/env node
/**
 * Dev-only engine launcher for the plugin `npm run plugin:dev` installs. Runs
 * src/index.ts of the checkout through tsx (no build). First it checks that
 * the installed copy of plugin/ (skills, agents) still matches the working
 * tree; after a branch switch or a skill edit it may not, and the engine then
 * says so at the top of its MCP instructions (COGNIGY_DEV_NOTICE), so the
 * session tells the user.
 *
 * The dev install runs a COPY of this file from .dev-plugin/, with the
 * checkout in COGNIGY_DEV_REPO: a branch whose scripts/ predates this file
 * must still start. So it may import nothing from scripts/ but its helper,
 * which is copied next to it, and it loads tsx from the checkout.
 */
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pluginFingerprint } from "./dev-plugin-snapshot.mjs";

const repo =
  process.env.COGNIGY_DEV_REPO ??
  resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installed = process.env.COGNIGY_DEV_FINGERPRINT;
if (installed && installed !== pluginFingerprint(join(repo, "plugin"))) {
  process.env.COGNIGY_DEV_NOTICE =
    'DEV PLUGIN IS STALE: the skills and agents in this session are an older copy of plugin/ than the plugin repo\'s working tree (branch switch or skill edit). Tell the user, before doing anything else, to run "npm run plugin:dev" in the plugin repo and then /reload-plugins.';
}

createRequire(join(repo, "package.json"))("tsx/esm/api").register();
await import(pathToFileURL(join(repo, "src", "index.ts")).href);
