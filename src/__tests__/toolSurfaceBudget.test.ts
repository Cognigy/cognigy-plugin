// Guards the size of the always-on LLM context this server injects: every
// tool description and input schema is sent on ListTools, and the server
// instructions on every session start. Workflow guidance belongs in
// plugin/skills (loaded on intent) and in tool-result _hints (delivered when
// relevant), not here. If a change trips one of these limits, move the prose
// rather than raising the cap.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tools } from "../tools/definitions.js";
import { SERVER_INSTRUCTIONS } from "../instructions.js";

const MAX_DESCRIPTION_CHARS = 1000;
const MAX_TOTAL_DESCRIPTION_CHARS = 12_000;
const MAX_TOTAL_DEFINITION_CHARS = 60_000;
const MAX_FIELD_DESCRIPTION_CHARS = 450;
const MAX_INSTRUCTIONS_CHARS = 4_500;

const SKILLS_DIR = join(process.cwd(), "plugin", "skills");

function fieldDescriptions(
  node: any,
  path: string,
  out: Array<{ path: string; text: string }>,
): void {
  if (!node || typeof node !== "object") return;
  if (typeof node.description === "string" && path) {
    out.push({ path, text: node.description });
  }
  for (const [key, value] of Object.entries(node.properties ?? {})) {
    fieldDescriptions(value, path ? `${path}.${key}` : key, out);
  }
  if (node.items) fieldDescriptions(node.items, `${path}[]`, out);
}

describe("tool surface budget", () => {
  it("keeps every tool description a short contract, not a workflow", () => {
    for (const tool of tools) {
      expect(tool.description.length).toBeLessThanOrEqual(
        MAX_DESCRIPTION_CHARS,
      );
      // Numbered procedures and shouty section headers are the tell-tale
      // signs of workflow prose that belongs in a skill.
      expect(tool.description).not.toMatch(/\n\s*\d+\.\s/);
      expect(tool.description).not.toMatch(/\n[A-Z][A-Z /-]{6,}:/);
    }
  });

  it("keeps the whole definitions payload within budget", () => {
    const descriptionChars = tools.reduce(
      (sum, tool) => sum + tool.description.length,
      0,
    );
    const definitionChars = JSON.stringify(tools).length;
    expect(descriptionChars).toBeLessThanOrEqual(MAX_TOTAL_DESCRIPTION_CHARS);
    expect(definitionChars).toBeLessThanOrEqual(MAX_TOTAL_DEFINITION_CHARS);
  });

  it("keeps input-schema field descriptions to meaning, range and default", () => {
    for (const tool of tools) {
      const fields: Array<{ path: string; text: string }> = [];
      fieldDescriptions(tool.inputSchema, "", fields);
      const tooLong = fields
        .filter((field) => field.text.length > MAX_FIELD_DESCRIPTION_CHARS)
        .map((field) => `${tool.name}.${field.path} (${field.text.length})`);
      expect(tooLong).toEqual([]);
    }
  });

  it("keeps the always-on server instructions terse", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(
      MAX_INSTRUCTIONS_CHARS,
    );
  });

  it("only points at skills that exist", () => {
    const text = [
      SERVER_INSTRUCTIONS,
      ...tools.map((tool) => tool.description),
    ].join("\n");
    const referenced = new Set<string>();
    for (const match of text.matchAll(
      /\b([a-z][a-z0-9-]*[a-z0-9]) skills?\b/g,
    )) {
      referenced.add(match[1]);
    }
    // Words that happen to precede "skill(s)" without naming one.
    const notSkillNames = new Set(["plugin", "supporting", "the", "and"]);
    const missing = [...referenced].filter(
      (name) =>
        !notSkillNames.has(name) &&
        !existsSync(join(SKILLS_DIR, name, "SKILL.md")),
    );
    expect(missing).toEqual([]);
  });
});
