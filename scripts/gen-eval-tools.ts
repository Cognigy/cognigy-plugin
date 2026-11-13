/* Regenerate the eval suite's saved tools/list response, so mocked tools carry
 * the real descriptions and input schemas (tool choice depends on them). Run:
 *   npm run evals:tools
 * src/__tests__/evalMocks.test.ts fails when these files are stale.
 *
 * Cases in MULTI_ENVIRONMENT_CASES get their own copy with the `environment`
 * field a user with extra environments ("trial", "acme") sees; every other
 * case sees the tools of a user with one environment.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withEnvironmentField } from "../src/environments.js";
import { tools } from "../src/tools/definitions.js";

export const EVAL_TOOLS_FILE = "plugin/evals/mocks/platform/_tools.json";
export const MULTI_ENVIRONMENT_NAMES = ["trial", "acme"];
export const MULTI_ENVIRONMENT_CASES = [
  "plugin/evals/tool-choice/which-environment",
  "plugin/evals/tool-choice/compare-environments",
];

const write = (file: string, list: unknown[]) => {
  writeFileSync(file, JSON.stringify({ tools: list }, null, 2) + "\n");
  console.log(`Wrote ${list.length} tools to ${file}`);
};

write(EVAL_TOOLS_FILE, tools);
for (const caseDir of MULTI_ENVIRONMENT_CASES) {
  const dir = join(caseDir, "mocks", "platform");
  mkdirSync(dir, { recursive: true });
  write(
    join(dir, "_tools.json"),
    withEnvironmentField(tools, MULTI_ENVIRONMENT_NAMES),
  );
}
