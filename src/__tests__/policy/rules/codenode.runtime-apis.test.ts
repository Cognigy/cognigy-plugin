import { describe, it, expect } from "@jest/globals";
import { upstreamCodeNodeRuntimeApis as rule } from "../../../policy/rules/upstream-code-node-hints.js";

describe("codenode.runtime-apis", () => {
  it("fires on a runtime API the Code Node runtime does not have", () => {
    const findings = rule.check("fetch('https://example.com')", {
      tool: "manage_flow_nodes",
      args: {},
    });

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].message).toMatch(/fetch/);
  });

  it("does not fire on compliant code", () => {
    const findings = rule.check("return input.text.toUpperCase();", {
      tool: "manage_flow_nodes",
      args: {},
    });

    expect(findings).toEqual([]);
  });

  it("ignores a runtime-API name inside a comment or string, per upstream's executableOnly()", () => {
    const findings = rule.check(
      "// fetch() looks like it would be flagged\nreturn 'fetch(\"x\")';",
      { tool: "manage_flow_nodes", args: {} },
    );

    expect(findings).toEqual([]);
  });

  it("targets config.code / preProcessCode / postProcessCode on create_tool, update_tool, and manage_flow_nodes", () => {
    expect(rule.targets.map((t) => t.tool)).toEqual([
      "create_tool",
      "update_tool",
      "manage_flow_nodes",
    ]);

    for (const target of rule.targets) {
      expect(target.select({ config: { code: "fetch('x')" } })).toEqual([
        { path: ["config", "code"], value: "fetch('x')" },
      ]);
      expect(
        target.select({ config: { preProcessCode: "require('fs')" } }),
      ).toEqual([
        { path: ["config", "preProcessCode"], value: "require('fs')" },
      ]);
      expect(target.select({ config: {} })).toEqual([]);
      expect(target.select({})).toEqual([]);
    }
  });
});
