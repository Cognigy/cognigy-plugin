import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import { withEnvironmentField } from "../environments.js";
import { tools } from "../tools/definitions.js";

// The eval suite mocks the platform server; stale mocks would grade tool choice
// against descriptions users never see.
const mocksDir = join(process.cwd(), "plugin/evals/mocks/platform");

describe("plugin eval mocks", () => {
  it("_tools.json matches the tool definitions (run `npm run evals:tools`)", () => {
    const saved = JSON.parse(
      readFileSync(join(mocksDir, "_tools.json"), "utf8"),
    );
    expect(saved).toEqual(JSON.parse(JSON.stringify({ tools })));
  });

  it("_server.md answers every tool", () => {
    const server = readFileSync(join(mocksDir, "_server.md"), "utf8");
    const listed = server.match(/tools:\s*\[([^\]]*)\]/)![1].match(/[\w]+/g);
    expect(listed!.sort()).toEqual(tools.map((t) => t.name).sort());
  });
});

describe("multi-environment eval cases", () => {
  // Cases listed in MULTI_ENVIRONMENT_CASES (scripts/gen-eval-tools.ts) carry
  // the tools a user with extra environments "trial" and "acme" sees.
  const caseFiles = ["which-environment", "compare-environments"].map((c) =>
    join(
      process.cwd(),
      "plugin/evals/tool-choice",
      c,
      "mocks/platform/_tools.json",
    ),
  );

  it.each(caseFiles)(
    "%s matches the tool definitions (run `npm run evals:tools`)",
    (file) => {
      const saved = JSON.parse(readFileSync(file, "utf8"));
      expect(saved).toEqual(
        JSON.parse(
          JSON.stringify({
            tools: withEnvironmentField(tools, ["trial", "acme"]),
          }),
        ),
      );
    },
  );
});
