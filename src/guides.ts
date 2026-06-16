import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resourceDir = join(__dirname, "resources");

export const GUIDE_IDS = [
  "agent-creation",
  "llm-providers",
  "troubleshooting",
  "knowledge-setup",
  "tools-setup",
  "webchat-setup",
  "flow-nodes",
  "package-management",
  "voice-gateway-setup",
  "voice-go-live-checklist",
  "settings",
] as const;

export type GuideId = (typeof GUIDE_IDS)[number];

export interface GuideDefinition {
  guideId: GuideId;
  uri: string;
  name: string;
  /** Short blurb used for MCP resource listing and the read_guide tool. */
  description: string;
  /**
   * Trigger-shaped sentence ("Use when the user wants to …") used as the
   * `description` frontmatter of the generated Claude Code plugin skill. This
   * is what Claude matches against to auto-load the skill, so it must read as a
   * trigger, not as a passive blurb. Falls back to `description` if absent.
   */
  skillTrigger: string;
  file: string;
}

export const GUIDE_DEFINITIONS: readonly GuideDefinition[] = [
  {
    guideId: "agent-creation",
    uri: "cognigy://guide/agent-creation",
    name: "Agent Creation Guide",
    description: "Full workflow for building a Cognigy AI Agent",
    skillTrigger:
      "Use when the user wants to build, create, or set up a new Cognigy AI Agent from scratch — covers listing projects, ensuring an LLM exists, creating the agent, testing it, and refining persona/job fields.",
    file: "agent-creation.md",
  },
  {
    guideId: "llm-providers",
    uri: "cognigy://guide/llm-providers",
    name: "LLM Provider Reference",
    description: "Valid provider names, model strings, and credential info",
    skillTrigger:
      "Use when configuring or choosing an LLM for a Cognigy agent — valid provider names (openAI, anthropic, azureOpenAI, google, mistral), model strings, connection types, and credential resolution.",
    file: "llm-providers.md",
  },
  {
    guideId: "troubleshooting",
    uri: "cognigy://guide/troubleshooting",
    name: "Troubleshooting Guide",
    description: "Common issues, diagnostic steps, and fixes",
    skillTrigger:
      "Use when a Cognigy agent returns empty responses, a tool call or create_ai_agent fails, a resource is not found, setup_llm fails, or you need to diagnose a Cognigy MCP problem.",
    file: "troubleshooting.md",
  },
  {
    guideId: "knowledge-setup",
    uri: "cognigy://guide/knowledge-setup",
    name: "Knowledge Setup Guide",
    description: "How to add knowledge stores and sources for RAG",
    skillTrigger:
      "Use when the user wants to add knowledge, RAG, or a knowledge store/source to a Cognigy agent — covers embedding vs Knowledge Search models, Knowledge AI settings, ingesting sources, and attaching knowledge as a tool.",
    file: "knowledge-setup.md",
  },
  {
    guideId: "tools-setup",
    uri: "cognigy://guide/tools-setup",
    name: "Tools Setup Guide",
    description: "Available tool types, configuration, and prerequisites",
    skillTrigger:
      "Use when creating or configuring Cognigy agent tools — choosing the tool type (tool, http, mcp, knowledge, send_email) and their configuration schemas.",
    file: "tools-setup.md",
  },
  {
    guideId: "webchat-setup",
    uri: "cognigy://guide/webchat-setup",
    name: "Webchat v3 Setup Guide",
    description:
      "Full settings reference, style presets, common recipes, and embedding for Webchat v3 endpoints",
    skillTrigger:
      "Use when the user wants to deploy a Cognigy agent to Webchat v3 — creating or updating the endpoint, style presets, layout/behavior settings, and the embed snippet.",
    file: "webchat-setup.md",
  },
  {
    guideId: "flow-nodes",
    uri: "cognigy://guide/flow-nodes",
    name: "Flow Node Reference",
    description:
      "Supported flow node types, config schemas, placement rules, and examples for manage_flow_nodes",
    skillTrigger:
      "Use when adding custom logic inside a Cognigy tool branch with manage_flow_nodes — supported node types, config schemas, placement rules, and the tool-first workflow.",
    file: "flow-nodes.md",
  },
  {
    guideId: "package-management",
    uri: "cognigy://guide/package-management",
    name: "Package Management Guide",
    description:
      "How to upload, inspect, import, export, and download Cognigy package zip files",
    skillTrigger:
      "Use when exporting, importing, uploading, inspecting, or downloading Cognigy package zip files — including reusing an LLM plus its connection across projects.",
    file: "package-management.md",
  },
  {
    guideId: "voice-gateway-setup",
    uri: "cognigy://guide/voice-gateway-setup",
    name: "Voice Gateway Setup Guide",
    description:
      "How to create a Voice Gateway endpoint with WebRTC for browser-based voice interaction",
    skillTrigger:
      "Use when the user wants to set up a voice agent or a Voice Gateway endpoint with WebRTC for browser-based voice interaction.",
    file: "voice-gateway-setup.md",
  },
  {
    guideId: "voice-go-live-checklist",
    uri: "cognigy://guide/voice-go-live-checklist",
    name: "Voice Go-Live Checklist Guide",
    description:
      "How audit_voice_agent checks and fixes a voice AI agent against the Go-Live Checklist, which items are auto-fixable, and which are manual",
    skillTrigger:
      "Use when the user wants to audit, validate, or make a Cognigy voice agent production-ready against the Voice Go-Live Checklist, or asks what audit_voice_agent checks and which items are auto-fixable vs manual.",
    file: "voice-go-live-checklist.md",
  },
  {
    guideId: "settings",
    uri: "cognigy://guide/settings",
    name: "Settings Guide",
    description:
      "How to configure project-level settings including voice preview and Knowledge AI settings",
    skillTrigger:
      "Use when configuring project-level Cognigy settings — voice preview / speech provider configuration and Knowledge AI settings.",
    file: "settings.md",
  },
] as const;

const GUIDE_MAP_BY_ID = Object.fromEntries(
  GUIDE_DEFINITIONS.map((guide) => [guide.guideId, guide]),
) as Record<GuideId, GuideDefinition>;

const GUIDE_MAP_BY_URI = Object.fromEntries(
  GUIDE_DEFINITIONS.map((guide) => [guide.uri, guide]),
) as Record<string, GuideDefinition>;

export function listGuideMetadata(): Array<{
  guideId: GuideId;
  uri: string;
  name: string;
  description: string;
  mimeType: "text/markdown";
}> {
  return GUIDE_DEFINITIONS.map(({ guideId, uri, name, description }) => ({
    guideId,
    uri,
    name,
    description,
    mimeType: "text/markdown",
  }));
}

export function getGuideById(guideId: string): GuideDefinition | undefined {
  return GUIDE_MAP_BY_ID[guideId as GuideId];
}

export function getGuideByUri(uri: string): GuideDefinition | undefined {
  return GUIDE_MAP_BY_URI[uri];
}

export function resolveGuide(input: {
  guideId?: string;
  uri?: string;
}): GuideDefinition | undefined {
  if (input.guideId) return getGuideById(input.guideId);
  if (input.uri) return getGuideByUri(input.uri);
  return undefined;
}

export function readGuideContent(guide: GuideDefinition): string {
  return readFileSync(join(resourceDir, guide.file), "utf-8");
}

export function buildGuideToolHint(uri: string):
  | {
      guideId: GuideId;
      guideToolCall: {
        name: "read_guide";
        arguments: { uri: string };
      };
    }
  | undefined {
  const guide = getGuideByUri(uri);
  if (!guide) return undefined;

  return {
    guideId: guide.guideId,
    guideToolCall: {
      name: "read_guide",
      arguments: { uri: guide.uri },
    },
  };
}
