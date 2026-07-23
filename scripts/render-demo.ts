/* Prototype demo: feed a sample chart, print ASCII + mermaid. Run:
 *   npx tsx scripts/render-demo.ts
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  chartToAscii,
  chartToMermaid,
  chartToHtml,
  type Chart,
} from "../src/render/flowRender.js";

// Sample: a Support AI Agent flow.
// start -> aiAgentJob -> end   (the `next` chain)
// aiAgentJob nests tools + an if/else branch (the `children`)
const chart: Chart = {
  nodes: [
    { _id: "start", type: "start" },
    { _id: "agent", type: "aiAgentJob", label: "Support Agent" },
    { _id: "tool_bal", type: "tool", preview: "check_balance" },
    { _id: "tool_unlock", type: "tool", preview: "unlock_account" },
    { _id: "branch", type: "ifElse", label: "balance < 0 ?" },
    { _id: "say_over", type: "say", preview: "You are overdrawn" },
    { _id: "say_ok", type: "say", preview: "Balance is fine" },
    { _id: "end", type: "end" },
  ],
  relations: [
    { node: "start", next: ["agent"] },
    {
      node: "agent",
      next: ["end"],
      children: ["tool_bal", "tool_unlock", "branch"],
    },
    { node: "branch", children: ["say_over", "say_ok"] },
  ],
};

const bar = (t: string) => `\n${"=".repeat(60)}\n${t}\n${"=".repeat(60)}`;

console.log(bar("ASCII TREE  (terminal-native, all clients)"));
console.log(chartToAscii(chart));

console.log(bar("ASCII TREE  (partial render, focus = branch)"));
console.log(chartToAscii(chart, "branch"));

console.log(bar("MERMAID  (rich render in artifacts / claude.ai)"));
console.log(chartToMermaid(chart, "branch"));

console.log(bar("RICH HTML  (tmp file — open in browser, offline)"));
// Inline mermaid from node_modules so the file renders with no network.
const mermaidPath = "node_modules/mermaid/dist/mermaid.min.js";
const mermaidJs = existsSync(mermaidPath)
  ? readFileSync(mermaidPath, "utf8")
  : undefined;
const file = join(tmpdir(), "cognigy-flow-demo.html");
writeFileSync(
  file,
  chartToHtml(chart, { title: "Support Agent", focusId: "branch", mermaidJs }),
  "utf8",
);
console.log(pathToFileURL(file).href);
console.log(mermaidJs ? "(mermaid inlined — offline)" : "(mermaid via CDN)");
