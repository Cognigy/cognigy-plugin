---
name: environments
description: "Use when Cognigy tools ask for an \"environment\", when the user works with several Cognigy environments or tenants (trial, a customer tenant), wants to compare or copy something between environments, or asks how to add another Cognigy environment."
---

# Working with several Cognigy environments

Tools have an `environment` field only when the user has configured extra environments. Without the
field there is one environment and nothing here applies, except "Adding environments" below.

## Pick the environment once per conversation

1. If the user has not named an environment in this conversation, ask once before the first
   Cognigy call, listing the field's choices: "Which environment should I use: default, trial or
   acme?" `default` is the plugin's own login. Do not guess, not even for read-only calls.
2. Pass that `environment` on every later call in the conversation. Do not ask again.
3. A request that names another environment for one step ("copy it to acme", "compare with
   trial") uses that environment for that step only. "Switch to acme" or "from now on use acme"
   changes the conversation's environment.
4. Every result names the environment it ran on (`_environment`). When you report a change, say
   which environment it was made in.

## IDs belong to one environment

Project, agent, flow and endpoint IDs from one environment do not exist in another. Never reuse an
ID across environments: look the resource up by name in the target environment.

## Comparing and copying

- **Compare**: run the same reads in both environments (for example `list_resources` or
  `manage_agent` get) and report the differences.
- **Copy a whole agent or project**: `manage_packages` export in the source environment, then
  `upload_and_inspect` and `import` the saved zip in the target environment (see the
  package-management skill).
- **Copy single settings**: read them in the source environment, write them in the target.
- The backup hold applies per environment: the first change to an existing agent in the target
  environment is held until a backup is offered there.

## Adding environments

You cannot add, change or remove environments. Tell the user to run `cognigy-envs` in a terminal
(or `npx -y -p @cognigy/plugin-engine cognigy-envs`), an arrow-key menu that asks for a name, the
API base URL and the key. A new environment works by name right away; it shows up in the field's
choices after the session restarts.

Never ask for, repeat or read an API key, and never open `~/.cognigy-plugin/environments.json` or
`config.json`. Keys never pass through the chat.

## Errors

- "Several Cognigy environments are configured…": ask the user which one, then retry with it.
- A problem with `environments.json`: relay the message as is; the user fixes it in `cognigy-envs`.
