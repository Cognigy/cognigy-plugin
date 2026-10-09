/* Regenerate the eval suite's saved tools/list response, so mocked tools carry
 * the real descriptions and input schemas (tool choice depends on them). Run:
 *   npm run evals:tools
 * src/__tests__/evalMocks.test.ts fails when this file is stale.
 */
import { writeFileSync } from "node:fs";
import { tools } from "../src/tools/definitions.js";

const EVAL_TOOLS_FILE = "plugin/evals/mocks/platform/_tools.json";

writeFileSync(EVAL_TOOLS_FILE, JSON.stringify({ tools }, null, 2) + "\n");
console.log(`Wrote ${tools.length} tools to ${EVAL_TOOLS_FILE}`);
