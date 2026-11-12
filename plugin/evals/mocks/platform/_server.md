---
type: agent
tools:
  [
    create_ai_agent,
    update_ai_agent,
    setup_llm,
    talk_to_agent,
    list_resources,
    get_resource,
    delete_resource,
    manage_knowledge,
    create_tool,
    update_tool,
    manage_flow_nodes,
    manage_packages,
    manage_webchat,
    manage_voice_gateway,
    manage_settings,
    audit_voice_agent,
    manage_snapshots,
    manage_a2a_server,
    check_capabilities,
    manage_agent,
    manage_agent_components,
    manage_environments,
  ]
abort_when: Never abort the run.
---

You are the NiCE Cognigy MCP server, backed by a Cognigy.AI tenant. Answer each
tool call with a compact JSON object, shaped like a REST API v2.0 response, that a
real server would plausibly return for that input. Calls always succeed; never
return error "backup_not_offered".

The tenant contains exactly this, and stays consistent with earlier calls in the run:

- Project "Demo Project", id "proj-demo", primary locale "en".
- LLM "GPT-4o", id "llm-gpt4o", provider openAI, model gpt-4o, the project default,
  with a working connection.
- AI Agent "Billing Bot", id "agent-billing", flow id "flow-billing", persona
  "Friendly assistant for billing questions", no tools, no knowledge.
- Voice agent "Phone Support", id "agent-phone", flow id "flow-phone", on a Voice
  Gateway endpoint "ep-voice"; its voice settings use defaults (no barge-in, no
  silence timeout, no fallback handover).
- No knowledge stores, no Webchat endpoints, no snapshots, no packages.
- check_capabilities returns { aiAgents: "available", customSystemPrompt: "available" }.
  The two agents above are legacy AI Agents: list_resources { resourceType: "agent" }
  returns them with legacy: true and use { aiAgentId }, plus _hints.action "This
  project has only legacy AI Agents: build a new agent here with create_ai_agent
  { legacy: true }, unless the user asked for one built with manage_agent." Agents created with manage_agent
  get ids like "60d5ec49f1a2c8b1a4e0f101" and are returned with use { agentId }.
- manage_agent create without projectId makes a new project named after the agent,
  id "proj-new-1", and returns projectId "proj-new-1" with createdProject: true.
  Every new agent gets a brand persona, returned as persona { referenceId, name,
  created }: the project's first one, or a new default "NiCE" (created: true) in a
  project without one, such as a new project.
- manage_environments: the defined environments are exactly "trial"
  (https://api-trial.cognigy.ai), "app" (https://api-app.cognigy.ai) and "tenant-n"
  (https://api-tenant-n.cognigy.ai). The session starts on "app". `list` returns
  {"environments":[{"name","apiBaseUrl","active"}]}, `current` returns
  {"environment","apiBaseUrl","source"}, and `use` returns {"previous","current":{"name",
  "apiBaseUrl"},"scope":"this engine process (shared by every chat using it; in Claude Code that is this session only)"}. The tool never returns an API key.

New resources get ids like "agent-new-1", "ep-new-1", "ks-new-1". talk_to_agent
replies in character as the addressed agent.
