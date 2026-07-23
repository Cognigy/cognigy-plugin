import { describe, it, expect } from "@jest/globals";
import {
  chartToAscii,
  chartToMermaid,
  chartToHtml,
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

  it("produces identical output for identical input (deterministic)", () => {
    expect(chartToMermaid(chart, "branch")).toBe(
      chartToMermaid(chart, "branch"),
    );
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
