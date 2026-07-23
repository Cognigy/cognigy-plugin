import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  chartToAscii,
  chartToMermaid,
  chartToHtml,
  chartLegend,
  type Chart,
} from "../render/flowRender.js";

// start -> agent -> end (next chain); agent nests two tools + an if/else,
// the if/else nests two say nodes (children).
const chart: Chart = {
  nodes: [
    { _id: "start", type: "start" },
    { _id: "agent", type: "aiAgentJob", label: "Support Agent" },
    { _id: "tool_bal", type: "tool", preview: "check_balance" },
    { _id: "branch", type: "ifElse", label: "balance < 0 ?" },
    { _id: "say_over", type: "say", preview: "You are overdrawn" },
    { _id: "say_ok", type: "say", preview: "Balance is fine" },
    { _id: "end", type: "end" },
  ],
  relations: [
    { node: "start", next: ["agent"] },
    { node: "agent", next: ["end"], children: ["tool_bal", "branch"] },
    { node: "branch", children: ["say_over", "say_ok"] },
  ],
};

describe("chartToAscii", () => {
  it("walks the next chain and nests children", () => {
    const out = chartToAscii(chart);
    expect(out).toContain("● start");
    expect(out).toContain("◆ Support Agent");
    expect(out).toContain("■ end");
    // children are nested under the agent
    expect(out).toContain("├─ ▢ check_balance");
    expect(out).toContain("└─ ◇ balance < 0 ?");
    // grandchildren nested under the branch
    expect(out).toContain("▭ You are overdrawn");
    // next chain uses the ▼ connector
    expect(out).toContain("▼");
  });

  it("marks the focus node", () => {
    expect(chartToAscii(chart, "branch")).toContain("«here»");
    expect(chartToAscii(chart)).not.toContain("«here»");
  });

  it("falls back to preview then type when no label", () => {
    const c: Chart = {
      nodes: [
        { _id: "start", type: "start" },
        { _id: "a", type: "say", preview: "hi there" }, // preview fallback
        { _id: "b", type: "code" }, // type fallback
      ],
      relations: [
        { node: "start", next: ["a"] },
        { node: "a", next: ["b"] },
      ],
    };
    const out = chartToAscii(c);
    expect(out).toContain("hi there");
    expect(out).toContain("code");
  });

  it("handles an empty flow", () => {
    expect(chartToAscii({})).toBe("(empty flow)");
  });

  it("does not loop forever on a cyclic chain", () => {
    const c: Chart = {
      nodes: [
        { _id: "start", type: "start" },
        { _id: "a", type: "say", label: "A" },
      ],
      relations: [
        { node: "start", next: ["a"] },
        { node: "a", next: ["start"] }, // cycle back
      ],
    };
    const out = chartToAscii(c);
    expect(out).toContain("↺ (loops to");
  });
});

describe("real API chart (next is a string, not an array)", () => {
  const chart: Chart = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./fixtures/xAppTestChart.json", import.meta.url)),
      "utf8",
    ),
  );

  // Regression: the API sends `next` as a single id string. An earlier walk
  // assumed string[], so `next?.[0]` read the first CHARACTER and every edge
  // was dropped — nodes rendered as a disconnected horizontal row.
  it("draws the full next chain through the tool branch", () => {
    const mm = chartToMermaid(chart);
    // top-level chain
    expect(mm).toContain(
      "n_6a4f9a84bad16ab4ee5121ba --> n_6a588dec0d80aa36aabb18db",
    ); // Start -> Set Session Config
    expect(mm).toContain(
      "n_6a588dec0d80aa36aabb18db --> n_6a4f9a84d9543729fbbfc41f",
    ); // -> AI Agent
    // inside the book_a_trip tool branch (the part that was missing)
    expect(mm).toContain(
      "n_6a4f9fdffac4430baebe7200 --> n_6a4fa008d9543729fbc020ec",
    ); // book_a_trip -> Init Session
    expect(mm).toContain(
      "n_6a4fa17ed9543729fbc033fc --> n_6a4f9fdffac4430baebe7217",
    ); // Assemble -> Resolve
    // agent's parallel branches stay dotted "contains"
    expect(mm).toContain(
      "n_6a4f9a84d9543729fbbfc41f -.->|contains| n_6a4f9fdffac4430baebe7200",
    );
  });

  it("renders the tool-branch sequence in the ascii tree", () => {
    const out = chartToAscii(chart);
    // the branch children appear as a sequence, not floating nodes
    for (const label of [
      "xApp: Init Session",
      "Say",
      "xApp: Hotel Map",
      "xApp: Flight Selection",
      "xApp: Seat Selector",
      "Assemble booking",
      "book_a_trip - Resolve",
    ]) {
      expect(out).toContain(label);
    }
  });

  it("labels the AI Agent node with its agent name", () => {
    // preview.aiAgentName ("X app test") is preferred over the generic label
    expect(chartToMermaid(chart)).toContain('[["X app test"]]');
    expect(chartToAscii(chart)).toContain("X app test");
  });
});

describe("chartToMermaid", () => {
  it("emits a flowchart with next (solid) and children (dotted) edges", () => {
    const out = chartToMermaid(chart);
    expect(out.startsWith("flowchart TD")).toBe(true);
    expect(out).toContain("n_start --> n_agent"); // next = solid
    expect(out).toContain("n_agent -.->|contains| n_tool_bal"); // children = dotted
    expect(out).toContain('n_branch{"balance < 0 ?"}'); // ifElse = diamond
    expect(out).toContain('n_agent[["Support Agent"]]'); // aiAgentJob = subroutine
  });

  it("adds a focus classDef only when a valid focus is given", () => {
    expect(chartToMermaid(chart, "branch")).toContain("class n_branch focus;");
    expect(chartToMermaid(chart, "nope")).not.toContain("focus;");
    expect(chartToMermaid(chart)).not.toContain("focus;");
  });

  it("sets an explicit text color so the highlight stays readable", () => {
    expect(chartToMermaid(chart, "branch")).toContain("color:#111827");
  });

  it("highlights multiple focus nodes in one class statement", () => {
    const mm = chartToMermaid(chart, ["branch", "say_over"]);
    expect(mm).toContain("class n_branch,n_say_over focus;");
    // ascii marks each of them
    const out = chartToAscii(chart, ["branch", "say_over"]);
    expect(out.match(/«here»/g)?.length).toBe(2);
  });

  it("produces identical output for identical input (deterministic)", () => {
    expect(chartToMermaid(chart, "branch")).toBe(
      chartToMermaid(chart, "branch"),
    );
  });
});

describe("chartLegend", () => {
  it("lists only the shapes/edges present in the flow", () => {
    // chart has start, end, aiAgentJob, ifElse (branch), and step nodes,
    // plus next + children edges — so every row should appear.
    const rows = chartLegend(chart);
    const means = rows.map((r) => r.meaning);
    expect(means).toContain("Start");
    expect(means).toContain("End");
    expect(means).toContain("AI Agent");
    expect(means).toContain("Branch (If/Else, Switch)");
    expect(means.some((m) => m.startsWith("Action step"))).toBe(true);
    expect(means).toContain("Flow sequence (next)");
    expect(means).toContain("Nested branch / tool body");
  });

  it("omits shapes not present (no branch, no children)", () => {
    const c: Chart = {
      nodes: [
        { _id: "s", type: "start" },
        { _id: "a", type: "say", label: "hi" },
      ],
      relations: [{ node: "s", next: "a" }],
    };
    const means = chartLegend(c).map((r) => r.meaning);
    expect(means).not.toContain("Branch (If/Else, Switch)");
    expect(means).not.toContain("End");
    expect(means).not.toContain("Nested branch / tool body");
    expect(means).toContain("Start");
    expect(means).toContain("Flow sequence (next)");
  });

  it("embeds a Legend subgraph in mermaid only when requested", () => {
    expect(chartToMermaid(chart, undefined, true)).toContain("subgraph Legend");
    expect(chartToMermaid(chart, undefined, false)).not.toContain(
      "subgraph Legend",
    );
    expect(chartToMermaid(chart)).not.toContain("subgraph Legend");
  });
});

describe("chartToHtml", () => {
  it("wraps the mermaid + ascii in a self-contained page", () => {
    const html = chartToHtml(chart, { title: "My Flow", focusId: "branch" });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>My Flow</title>");
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain('<pre class="ascii">');
    // mermaid < is escaped for HTML
    expect(html).toContain("balance &lt; 0 ?");
    // loads mermaid for rendering
    expect(html).toContain("mermaid.initialize");
  });

  it("uses the CDN loader when no mermaidJs is supplied", () => {
    const html = chartToHtml(chart);
    expect(html).toContain("cdn.jsdelivr.net");
  });

  it("inlines mermaidJs and drops the CDN when supplied (offline)", () => {
    const fakeLib =
      'globalThis.mermaid={initialize(){},run(){}}; "</script> guard";';
    const html = chartToHtml(chart, { mermaidJs: fakeLib });
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).toContain("globalThis.mermaid");
    // the </script guard neutralizes an early tag close
    expect(html).toContain("<\\/script");
    expect(html).toContain("mermaid.run()");
  });
});
