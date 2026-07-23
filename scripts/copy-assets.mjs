/**
 * Copy build-time assets into dist/ so they ship in the published package
 * (package.json `files` is ["dist", ...]).
 *
 * mermaid.min.js (the self-contained UMD build that sets globalThis.mermaid)
 * is inlined into the rich flow-viz HTML so it renders fully offline — no CDN.
 * mermaid is a devDependency; only this copied asset ships, not node_modules.
 */
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
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
