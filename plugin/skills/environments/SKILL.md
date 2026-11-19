---
name: environments
description: "Use when Cognigy tools ask for an \"environment\", when the user works with several Cognigy environments or tenants (trial, a customer tenant), wants to compare or copy something between environments, wants you to also reach another Cognigy tenant, URL or API key, or asks how to add another Cognigy environment."
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
5. When you hand work to a Cognigy subagent (cognigy-agent-builder, cognigy-s2s-demo-builder,
   cognigy-voice-go-live), name the environment in its prompt. It cannot ask the user.

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

You cannot add, change or remove environments, and do not run the menu yourself: it needs the
user's keyboard, and the key is typed there, not in the chat. When the user wants another
environment, or asks for a tenant you have no environment for, give them these steps, each command
in its own code block so they can copy it:

1. Run in a terminal: `cognigy-envs`
2. If the terminal says the command is not found, add it by running
   `npm install -g @cognigy/plugin-engine@latest`, then run `cognigy-envs` again.
   On a permission error, or to install nothing, open the menu with this line instead (it adds no
   command, so they use the same line next time):
   `npx -y -p @cognigy/plugin-engine@latest cognigy-envs`
3. In the menu, pick "+ Add an environment" and enter a name, the API base URL and the API key.
4. Restart the AI client (in Claude Code, a new session is enough). Open conversations keep the
   environments they started with.
5. Test it in the new conversation: "Which Cognigy environments do you have access to?"

To replace the plugin's own login (`default`) instead, the user needs to run the installer again:
`npx -y -p @cognigy/plugin-engine@latest cognigy-setup`
In Cursor that changes nothing, because Cursor's Plugins → Configure values win over the
installer's file: the user needs to change `COGNIGY_API_BASE_URL` and `COGNIGY_API_KEY` there for
Cognigy, then reload Cursor.

Never ask for, repeat or read an API key, and never open `~/.cognigy-plugin/environments.json` or
`config.json`. Keys never pass through the chat.

## Errors

- "Several Cognigy environments are configured…": ask the user which one, then retry with it.
- "…changed after this conversation's tools were loaded…": nothing was sent. Tell the user to restart
  the AI client (in Claude Code, a new session), then continue there.
- A problem with `environments.json`: relay the message as is; the user fixes it in `cognigy-envs`.
