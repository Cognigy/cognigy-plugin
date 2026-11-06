import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
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
