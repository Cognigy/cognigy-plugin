import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "@jest/globals";

import { SERVER_INSTRUCTIONS } from "../instructions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Guides are sourced from the plugin skills (one source of truth); the read_guide
// tool serves the same body with the frontmatter stripped at build time.
const skillsDir = join(__dirname, "..", "..", "plugin", "skills");

function readResource(name: string): string {
  const id = name.replace(/\.md$/, "");
  return readFileSync(join(skillsDir, id, "SKILL.md"), "utf-8");
}

describe("knowledge guidance", () => {
  // The detailed knowledge model-selection policy now lives in the knowledge-setup
  // guide (single source of truth), not inlined in SERVER_INSTRUCTIONS. The guide
  // feeds both the read_guide tool (all MCP clients) and the generated Claude Code
  // skill. SERVER_INSTRUCTIONS keeps only the pointer + hard rules.
  it("tells the assistant to try existing same-project models before setup_llm", () => {
    const knowledgeSetup = readResource("knowledge-setup.md");

    expect(knowledgeSetup).toContain(
      "ALWAYS list llm_model resources in the TARGET project and try/reuse imported same-project model IDs first",
    );
    expect(knowledgeSetup).toContain(
      'list_resources { resourceType: "llm_model", projectId, useCase: "knowledgeSearch" }',
    );
    expect(knowledgeSetup).toContain(
      "Do NOT attempt knowledgeSearchModelId with the agent chat model or any other generic default until the source project's exact Knowledge Search choice has been imported and tried",
    );
    expect(knowledgeSetup).toContain(
      'If manage_settings rejects one knowledgeSearchModelId with a message like "model type not allowed", try other existing llm_model IDs in the SAME project before creating a new model.',
    );
    expect(knowledgeSetup).toContain(
      "Do NOT substitute a freshly created or generic model for knowledgeSearchModelId just because the user asked for a new project.",
    );
    expect(knowledgeSetup).toContain(
      "do NOT call setup_llm to create another model as a workaround unless the user explicitly asks for a brand-new model",
    );
    expect(knowledgeSetup).toContain(
      "Do NOT speculatively probe arbitrary unfiltered models for knowledgeSearchModelId",
    );
    expect(knowledgeSetup).toContain(
      "Do NOT fall back to an arbitrary generic model first.",
    );
  });

  it("documents that knowledgeSearchModelId acceptance is instance-dependent", () => {
    const knowledgeSetup = readResource("knowledge-setup.md");
    const settingsGuide = readResource("settings.md");

    expect(knowledgeSetup).toContain("Settings UI dropdown");
    expect(knowledgeSetup).toContain(
      "Start with existing same-project candidates and rely on the API response.",
    );
    expect(knowledgeSetup).toContain(
      "Model names shown in examples are not a whitelist for either role.",
    );
    expect(settingsGuide).toContain('useCase: "knowledgeSearch"');
    expect(settingsGuide).toContain(
      "The accepted model type for `knowledgeSearchModelId` is instance-dependent",
    );
  });

  it("documents that Knowledge AI settings come before knowledge store creation", () => {
    const knowledgeSetup = readResource("knowledge-setup.md");
    const settingsGuide = readResource("settings.md");

    expect(knowledgeSetup).toContain(
      "Configure the project's **Knowledge AI Settings** before creating the store in normal AI-agent knowledge flows.",
    );
    expect(settingsGuide).toContain(
      'In normal AI-agent knowledge flows, set these settings before `manage_knowledge { operation: "create_store", ... }`',
    );
  });

  it("tells the assistant to import the full knowledge model set in one pass", () => {
    const knowledgeSetup = readResource("knowledge-setup.md");
    const settingsGuide = readResource("settings.md");
    const agentCreation = readResource("agent-creation.md");

    expect(knowledgeSetup).toContain(
      "For knowledge workflows, import the full required source-project model set up front before the first Knowledge AI settings attempt",
    );
    expect(knowledgeSetup).toContain(
      "When multiple required LLMs share the same source-project connection, export/import all of those llm_model resources together with that single connection resource in one package.",
    );
    expect(knowledgeSetup).toContain(
      'Import the full required source-project model set before the first `manage_settings { operation: "set_knowledge_ai", ... }` attempt',
    );
    expect(settingsGuide).toContain(
      "If multiple required imported models share one connection, transfer that connection once together with all of those models instead of importing it again later",
    );
    expect(agentCreation).toContain(
      "If this workflow will use knowledge, identify the source project's exact Knowledge Search model and embedding model before exporting anything",
    );
  });

  it("does not describe Knowledge Search as chat-only in setup_llm guidance", () => {
    const definitions = readFileSync(
      join(__dirname, "..", "tools", "definitions.ts"),
      "utf-8",
    );

    expect(definitions).not.toContain(
      "Chat/completion models are used for AI Agents, Knowledge Search, and Answer Extraction.",
    );
    expect(definitions).toContain(
      "Knowledge Search and Answer Extraction use same-project llm_model IDs accepted by the Cognigy API for that use case.",
    );
    expect(definitions).toContain(
      "Do not use setup_llm as an automatic workaround for knowledgeSearchModelId failures while existing same-project candidates still exist.",
    );
  });

  it("tells the assistant to report exact failures instead of claiming a platform bug", () => {
    const knowledgeSetup = readResource("knowledge-setup.md");

    expect(knowledgeSetup).toContain(
      "Do not describe a knowledgeSearchModelId rejection as a platform-side bug just because a similar model worked in another project.",
    );
    expect(knowledgeSetup).toContain(
      "If all same-project candidates fail for `knowledgeSearchModelId`, stop and report the exact rejected model IDs and messages.",
    );
  });

  it("does not let the assistant infer rejection for models it has not tried", () => {
    const knowledgeSetup = readResource("knowledge-setup.md");

    expect(knowledgeSetup).toContain(
      'Do not say an untried model is "likely" rejected or unsupported. Only report actual API validation results for models you tried.',
    );
    expect(knowledgeSetup).toContain(
      "Do not infer that an untried candidate is rejected or unsupported. Only report actual API results.",
    );
  });

  it("keeps the agent model choice separate from the Knowledge Search model choice", () => {
    const knowledgeSetup = readResource("knowledge-setup.md");
    const settingsGuide = readResource("settings.md");

    expect(knowledgeSetup).toContain(
      "The agent response model should not be reused for `knowledgeSearchModelId` just because it is already available.",
    );
    expect(settingsGuide).toContain(
      "The response model you want for the agent is not a reason to test that same model for Knowledge Search.",
    );
  });

  it("keeps the detailed knowledge policy in the guide and only a pointer in server instructions", () => {
    const knowledgeSetup = readResource("knowledge-setup.md");

    // New architecture: the guide is the single source of truth for the detailed
    // policy; SERVER_INSTRUCTIONS only points at it (so the always-on instruction
    // text stays lean and the same content feeds the generated skill + read_guide).
    expect(SERVER_INSTRUCTIONS).toContain(
      'read_guide { guideId: "knowledge-setup" }',
    );
    expect(SERVER_INSTRUCTIONS).not.toContain(
      "Do NOT speculatively probe arbitrary unfiltered models for knowledgeSearchModelId",
    );
    expect(knowledgeSetup).toContain(
      "Do NOT speculatively probe arbitrary unfiltered models for knowledgeSearchModelId",
    );
  });
});
