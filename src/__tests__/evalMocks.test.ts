import { describe, it, expect } from "@jest/globals";
import { existsSync, readdirSync, readFileSync } from "fs";
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

  it("every tool is answered by _server.md or its own <tool>.md", () => {
    const server = readFileSync(join(mocksDir, "_server.md"), "utf8");
    const listed = server.match(/tools:\s*\[([^\]]*)\]/)![1].match(/[\w]+/g)!;
    const fixed = readdirSync(mocksDir)
      .filter((f) => f.endsWith(".md") && f !== "_server.md")
      .map((f) => f.slice(0, -3));
    // A <tool>.md overrides _server.md, so listing it in both hides a dead entry.
    expect(listed.filter((t) => fixed.includes(t))).toEqual([]);
    expect([...listed, ...fixed].sort()).toEqual(
      tools.map((t) => t.name).sort(),
    );
  });
});

describe("fixture-backed eval mocks", () => {
  // A {{file:fixtures/list_resources/{input.resourceType}.json}} mock turns a
  // valid resourceType without its file into a tool error.
  const evalsDir = join(process.cwd(), "plugin/evals");
  const fixtureDirs = readdirSync(evalsDir, { withFileTypes: true })
    .filter((suite) => suite.isDirectory())
    .flatMap((suite) =>
      readdirSync(join(evalsDir, suite.name)).map((c) =>
        join(evalsDir, suite.name, c, "mocks/platform/fixtures/list_resources"),
      ),
    )
    .filter((dir) => existsSync(dir));
  const resourceTypes = (
    tools.find((t) => t.name === "list_resources")!.inputSchema.properties as {
      resourceType: { enum: string[] };
    }
  ).resourceType.enum;

  it.each(fixtureDirs)("%s has a file for every resourceType", (dir) => {
    const files = readdirSync(dir).map((f) => f.replace(/\.json$/, ""));
    expect(resourceTypes.filter((t) => !files.includes(t))).toEqual([]);
  });
});

describe("multi-environment eval cases", () => {
  // Every case with its own tool list (MULTI_ENVIRONMENT_CASES in
  // scripts/gen-eval-tools.ts) carries the tools a user with extra environments
  // "trial" and "acme" sees. Found on disk, not listed: importing the script
  // would run it.
  const evalsDir = join(process.cwd(), "plugin/evals");
  const caseFiles = readdirSync(evalsDir, { withFileTypes: true })
    .filter((suite) => suite.isDirectory())
    .flatMap((suite) =>
      readdirSync(join(evalsDir, suite.name)).map((c) =>
        join(evalsDir, suite.name, c, "mocks/platform/_tools.json"),
      ),
    )
    .filter((file) => existsSync(file));

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
