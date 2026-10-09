// Always-on baseline injected into every session (MCP `instructions`).
// The plugin expects its skills to be loaded, so this holds only what the
// plugin is, the skill list with a warning for when skills are missing, and the
// few hard rules where a miss is irreversible or misleads the user. Everything
// else lives in the tool descriptions (src/tools/definitions.ts), in
// plugin/skills/*/SKILL.md, or in tool-result _hints.
// src/__tests__/toolSurfaceBudget.test.ts caps the size and checks the skill
// list against plugin/skills.
export const SERVER_INSTRUCTIONS = `NiCE Cognigy Plugin — builds and iteratively improves LLM-powered AI Agents on the NiCE Cognigy platform.

The tools are designed to be used together with the plugin's skills, which load step-by-step workflow guidance when your intent matches. Plugin skills: agent-creation, tools-setup, a2a-setup, flow-nodes, knowledge-setup, llm-providers, package-management, settings, snapshot-backups, webchat-setup, voice-gateway-setup, voice-go-live-checklist, xapps, agent-red-team, docs-lookup, troubleshooting. If none of them are available to you, tell the user once, before making any change, that the Cognigy plugin is not fully installed because the skills are missing, so results may be incomplete or wrong, and suggest reinstalling the plugin.

Tool results carry _hints with warnings and the next step; follow them.

HARD RULES:
- NEVER guess or invent API keys, URLs or credentials. Ask the user (apiKey for most providers; accessKeyId + secretAccessKey or roleArn for awsBedrock).
- The FIRST change to an existing agent in a project is HELD: the tool changes nothing and returns error backup_not_offered. Follow its hint (offer a backup, then manage_snapshots create or decline), then retry the same call. Never claim the change happened.
- manage_snapshots restore is IRREVERSIBLE and project-wide. Call it without confirm first, show the user the preflight, and pass confirm: true only after explicit agreement.`;
