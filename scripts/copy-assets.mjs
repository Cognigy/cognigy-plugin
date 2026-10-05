/**
 * Copy build-time assets into dist/ so they ship in the published package
 * (package.json `files` is ["dist", ...]).
 *
 * mermaid.min.js (the self-contained UMD build that sets globalThis.mermaid)
 * is inlined into the rich flow-viz HTML so it renders fully offline — no CDN.
 * mermaid is a devDependency; only this copied asset ships, not node_modules.
 *
 * plugin/skills + plugin/agents are copied to dist/plugin-assets/ because the
 * installer has to write them onto disk for clients with no plugin marketplace
 * to fetch them from (Antigravity). Claude Code gets these same files from the
 * GitHub marketplace instead, so this copy exists purely so `npx …
 * cognigy-setup` carries them — without it the installer would have nothing to
 * install (package.json `files` publishes dist only).
 */
import { mkdirSync, copyFileSync, cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "mermaid", "dist", "mermaid.min.js");
const destDir = join(root, "dist", "assets");
const dest = join(destDir, "mermaid.min.js");

if (!existsSync(src)) {
  console.error(
    `[copy-assets] mermaid.min.js not found at ${src}. Run \`npm install\` first.`,
  );
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-assets] mermaid.min.js -> ${dest}`);

for (const kind of ["skills", "agents"]) {
  const from = join(root, "plugin", kind);
  if (!existsSync(from)) {
    console.error(`[copy-assets] plugin/${kind} not found at ${from}.`);
    process.exit(1);
  }
  const to = join(root, "dist", "plugin-assets", kind);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`[copy-assets] plugin/${kind} -> ${to}`);
}
