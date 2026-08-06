---
name: a2a-setup
description: "Use when the user wants multi-agent / agent-to-agent communication — an orchestrator agent delegating to specialist agents over the A2A (Agent2Agent) protocol. Covers the manage_a2a_server endpoint and the create_tool { toolType: 'a2a' } tool type."
---

# A2A (Agent2Agent) Setup Guide

## Read this first

- **Gotcha (Cognigy targets only):** a `manage_a2a_server` endpoint lives at `/a2a/v1/<URLToken>`, not the plain endpoint URL. Always copy `agentBaseUrl` straight from that tool's response — don't build it yourself. External/third-party agents don't have this quirk; just use whatever base URL they publish.
- **Always check `liveCheck.reachable`** on the `manage_a2a_server` response before telling the user the agent is ready. Every create/update fetches the Agent Card live, so `created: true` alone doesn't mean it's callable yet.

## What is A2A here?

Two independent pieces — you rarely need both:

1. **`create_tool { toolType: 'a2a' }`** — adds a tool to ANY agent that calls a remote A2A agent. The remote agent can be **anything that speaks A2A**: a third-party service, another team's deployment, a public demo agent — you just need its base URL (and Agent Card path). This is the piece you almost always want, and it needs nothing Cognigy-specific on the remote side.
2. **`manage_a2a_server`** — ONLY needed when the agent you want to expose *as an A2A target for others* is itself a Cognigy agent you're building. It deploys a Flow as a remote-callable A2A agent with an Agent Card (name, description, skills).

Put differently: `create_tool { toolType: 'a2a' }` is the generic "call any A2A agent" client. `manage_a2a_server` is specifically "make one of my own Cognigy agents callable that way" — use it only when the remote endpoint doesn't already exist and happens to be another Cognigy agent in the same build.

## Quick Start — Delegate to an EXTERNAL A2A agent (the common case)

No Cognigy setup needed on the remote side — just its base URL:

```text
create_tool {
  aiAgentId: "<orchestrator aiAgentId>",
  toolType: "a2a",
  name: "Weather Agent",
  config: {
    agentBaseUrl: "https://some-external-a2a-agent.example.com",
    agentCardPath: ".well-known/agent.json",
    executionMode: "blocking",
    taskTimeout: 60
  }
}
```

`agentBaseUrl` here is whatever base URL the external agent's own documentation/Agent Card publishes — nothing to construct, nothing from this plugin. Only when the remote agent happens to be a Cognigy agent you're also standing up does the URL need the `/a2a/v1/` shape covered below.

## Quick Start — Deploy YOUR OWN Cognigy agent as an A2A server

Only do this when the target you want to delegate to is a Cognigy agent you're building (e.g. a specialist in a multi-agent demo), not an already-existing external agent:

```text
1. create_ai_agent { projectId, name: "Flights Agent", description: "Books and looks up flights" }
2. (configure persona/instructions, attach tools as normal)
3. manage_a2a_server {
     projectId: "...",
     flowId: "<flow referenceId>",
     name: "Flights Agent A2A Server",
     agentName: "Flights Agent",
     agentDescription: "Books flights and checks flight status",
     skills: [
       { id: "book-flight", name: "book-flight", description: "Book a flight between two cities" },
       { id: "check-flight-status", name: "check-flight-status", description: "Check the status of a booked flight" }
     ],
     enableStreaming: true
   }
   → returns agentBaseUrl, agentCardUrl, and liveCheck — CHECK liveCheck.reachable before telling the user it's ready
```

Then wire the caller to it exactly like the external case above, using the returned `agentBaseUrl` VERBATIM:

```text
create_tool {
  aiAgentId: "<orchestrator aiAgentId>",
  toolType: "a2a",
  name: "Flights Agent",
  config: {
    agentBaseUrl: "<agentBaseUrl from manage_a2a_server response, VERBATIM>",
    agentCardPath: ".well-known/agent.json",
    executionMode: "blocking",
    taskTimeout: 60
  }
}
```

The orchestrator's description/instructions should mention it can delegate to registered specialist agents — the LLM decides when to call the `a2a` tool the same way it decides when to call any other tool, based on the tool's `name` and the remote agent's `agentDescription`/skills.

CREATE vs UPDATE (manage_a2a_server): same pattern as manage_webchat/manage_voice_gateway — omit `endpointId` + provide `projectId`+`flowId` to create; provide `endpointId` to update (settings merge with existing).

## Agent Card (manage_a2a_server settings)

| Field | Type | Description |
|-------|------|-------------|
| agentName | string | Name shown to remote callers in this agent's Agent Card |
| agentDescription | string | What this agent does — the main signal a remote orchestrator's LLM uses to decide whether to delegate here |
| skills | array | `{ id, name, description }` — the specific capabilities this agent exposes. Give each a unique `id` |
| enableStreaming | boolean | Stream partial results back to the caller |
| authenticationType | "none" \| "apiKey" | How callers must authenticate to this endpoint |

Response fields:

| Field | Description |
|-------|-------------|
| agentBaseUrl | `https://endpoint-<env>.cognigy.ai/a2a/v1/<URLToken>` — use this verbatim as `agentBaseUrl` on the calling side |
| agentCardUrl | `agentBaseUrl + '/.well-known/agent.json'` — the discovery URL the Agent Card is actually served from |
| liveCheck | Result of fetching agentCardUrl right now: `{ reachable: true, agentName, skills }`, `{ reachable: false, error }`, or `{ skipped: true, reason }` when the endpoint requires authentication (an unauthenticated probe would misreport a healthy agent as down) |

## A2A Agent tool config (create_tool / update_tool)

| Field | Type | Description |
|-------|------|-------------|
| agentBaseUrl | string | Base URL of the remote agent — use a `manage_a2a_server` response's `agentBaseUrl` verbatim, or any third-party A2A agent's own base URL |
| agentCardPath | string | Path to the Agent Card, appended to agentBaseUrl. Default: `.well-known/agent.json` |
| timeout | number | Discovery (Agent Card fetch) timeout in seconds |
| executionMode | string | How the delegated task runs. Default: `blocking` (wait for the remote agent's final result) |
| taskTimeout | number | Max seconds to wait for the remote task to complete |
| maxAutonomousTurns | number | Max back-and-forth turns the remote agent may take autonomously |
| toolFilter | "none" \| "whitelist" \| "blacklist" | Restrict which of the remote agent's skills may be invoked |
| whitelist / blacklist | string[] | Skill names to allow/block, when toolFilter is set |
| authType | "none" \| "apiKey" \| "bearer" \| "basic" \| "oAuth2" | Auth method for calling the remote agent |
| apiKeyConnection / bearerConnection / basicConnection / oAuth2Connection | string | Cognigy Connection ID holding the credential for the matching authType |
| apiKeyHeader | string | Header name for apiKey auth. Default: `X-API-Key` |
| authForDiscovery | boolean | Also authenticate when fetching the Agent Card, not just when calling tasks |
| agentHeaders | string | Extra HTTP headers as a JSON string |
| cacheCard | boolean | Cache the discovered Agent Card instead of re-fetching every call. Default: true |

Node structure created: `aiAgentJobA2AAgent` (the tool node the LLM sees, config above) with a child `aiAgentJobCallA2AAgent` node (fixed config, handles the actual call — no need to touch it directly).

## Multi-agent orchestrator pattern

```text
1. Create + configure each specialist agent (create_ai_agent, tools, persona)
2. Deploy each specialist behind its own manage_a2a_server endpoint —
   check liveCheck.reachable on each before proceeding
3. Create the orchestrator agent (create_ai_agent) with a persona describing
   it delegates to registered specialist agents
4. For each specialist, add one create_tool { toolType: "a2a" } on the
   orchestrator, using that specialist's agentBaseUrl verbatim
5. Optionally deploy the orchestrator itself behind manage_a2a_server, so
   it becomes callable as a top-level "main" A2A entry point
6. Test each specialist directly with talk_to_agent first (isolate config
   issues from delegation issues), then test the orchestrator
```

## Prerequisites

- Each agent (specialist and orchestrator) must be created via `create_ai_agent` — `manage_a2a_server` and `create_tool` both require the auto-provisioned flow.
- An LLM must be configured for every agent involved, including specialists — the orchestrator's A2A call still lands on a real agent conversation on the other end.
- Before wiring the orchestrator, verify each specialist responds correctly via `talk_to_agent` on its own REST/webchat endpoint.
