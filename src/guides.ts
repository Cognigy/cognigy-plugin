import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resourceDir = join(__dirname, "resources");
// Source-of-truth skills, used as a dev/test fallback (see readGuideContent).
const skillsDir = join(__dirname, "..", "plugin", "skills");

/** Strip a leading YAML frontmatter block (--- … ---); return the body. */
function stripFrontmatter(text: string): string {
  const lines = text.split("\n");
  if (lines[0] !== "---") return text.trim();
  const end = lines.indexOf("---", 1);
  if (end === -1) return text.trim();
  return lines
    .slice(end + 1)
    .join("\n")
    .trim();
}

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
   * Markdown body filename under `dist/resources/`, produced at build time from
   * `plugin/skills/<guideId>/SKILL.md` by `scripts/build-guides.mjs`. The skill
   * is the source of truth; the auto-load trigger lives in its `description`
   * frontmatter, not here.
   */
  file: string;
}

export const GUIDE_DEFINITIONS: readonly GuideDefinition[] = [
  {
    guideId: "agent-creation",
    uri: "cognigy://guide/agent-creation",
    name: "Agent Creation Guide",
    description: "Full workflow for building a Cognigy AI Agent",
    file: "agent-creation.md",
  },
  {
    guideId: "llm-providers",
    uri: "cognigy://guide/llm-providers",
    name: "LLM Provider Reference",
    description: "Valid provider names, model strings, and credential info",
    file: "llm-providers.md",
  },
  {
    guideId: "troubleshooting",
    uri: "cognigy://guide/troubleshooting",
    name: "Troubleshooting Guide",
    description: "Common issues, diagnostic steps, and fixes",
    file: "troubleshooting.md",
  },
  {
    guideId: "knowledge-setup",
    uri: "cognigy://guide/knowledge-setup",
    name: "Knowledge Setup Guide",
    description: "How to add knowledge stores and sources for RAG",
    file: "knowledge-setup.md",
  },
  {
    guideId: "tools-setup",
    uri: "cognigy://guide/tools-setup",
    name: "Tools Setup Guide",
    description: "Available tool types, configuration, and prerequisites",
    file: "tools-setup.md",
  },
  {
    guideId: "webchat-setup",
    uri: "cognigy://guide/webchat-setup",
    name: "Webchat v3 Setup Guide",
    description:
      "Full settings reference, style presets, common recipes, and embedding for Webchat v3 endpoints",
    file: "webchat-setup.md",
  },
  {
    guideId: "flow-nodes",
    uri: "cognigy://guide/flow-nodes",
    name: "Flow Node Reference",
    description:
      "Supported flow node types, config schemas, placement rules, and examples for manage_flow_nodes",
    file: "flow-nodes.md",
  },
  {
    guideId: "package-management",
    uri: "cognigy://guide/package-management",
    name: "Package Management Guide",
    description:
      "How to upload, inspect, import, export, and download Cognigy package zip files",
    file: "package-management.md",
  },
  {
    guideId: "voice-gateway-setup",
    uri: "cognigy://guide/voice-gateway-setup",
    name: "Voice Gateway Setup Guide",
    description:
      "How to create a Voice Gateway endpoint with WebRTC for browser-based voice interaction",
    file: "voice-gateway-setup.md",
  },
  {
    guideId: "voice-go-live-checklist",
    uri: "cognigy://guide/voice-go-live-checklist",
    name: "Voice Go-Live Checklist Guide",
    description:
      "How audit_voice_agent checks and fixes a voice AI agent against the Go-Live Checklist, which items are auto-fixable, and which are manual",
    file: "voice-go-live-checklist.md",
  },
  {
    guideId: "settings",
    uri: "cognigy://guide/settings",
    name: "Settings Guide",
    description:
      "How to configure project-level settings including voice preview and Knowledge AI settings",
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
  // Production (npm/.mcpb): the build extracted the guide body to dist/resources.
  const built = join(resourceDir, guide.file);
  if (existsSync(built)) return readFileSync(built, "utf-8");
  // Dev/test fallback: running from src (tsx/jest) has no built dist/resources,
  // so read straight from the canonical skill and strip its frontmatter.
  const skill = join(skillsDir, guide.guideId, "SKILL.md");
  return `${stripFrontmatter(readFileSync(skill, "utf-8"))}\n`;
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
