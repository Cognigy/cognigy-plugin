// Always-on baseline injected into every session (MCP `instructions`).
// The plugin expects its skills to be loaded, so this holds only what the
// plugin is and the few hard rules where a miss is irreversible or misleads the
// user. Everything else lives in the tool descriptions
// (src/tools/definitions.ts), in plugin/skills/*/SKILL.md, or in tool-result
// _hints. src/__tests__/toolSurfaceBudget.test.ts caps the size.
export const SERVER_INSTRUCTIONS = `NiCE Cognigy Plugin — builds and iteratively improves LLM-powered AI Agents on the NiCE Cognigy platform.

The tools are designed to be used together with the plugin's skills, which load step-by-step workflow guidance when your intent matches.

Tool results carry _hints with warnings and the next step; follow them.

Agents V2 preview (this build only): list_resources 'agent' lists V2 agents first (V1 as legacyAgents), talk_to_agent takes { agentV2Id, projectId }. Create one with create_agent_v2 only when the user asks for Agents V2 / the new Agents editor; when a project already has V2 agents, those are its agents for listing, reading and talking.

HARD RULES:
- NEVER guess or invent API keys, URLs or credentials. Ask the user (apiKey for most providers; accessKeyId + secretAccessKey or roleArn for awsBedrock).
- The FIRST change to an existing agent in a project is HELD: the tool changes nothing and returns error backup_not_offered. Follow its hint (offer a backup, then manage_snapshots create or decline), then retry the same call. Never claim the change happened.
- manage_snapshots restore is IRREVERSIBLE and project-wide. Call it without confirm first, show the user the preflight, and pass confirm: true only after explicit agreement.`;
