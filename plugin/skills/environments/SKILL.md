---
name: environments
description: "Use when the user wants to switch Cognigy environment, tenant, trial or app, asks which environment or tenant they are on, or wants to list their Cognigy environments."
---

# Switching Cognigy environments

Use `manage_environments` to see or change which Cognigy environment (tenant) **this engine**
talks to. In Claude Code the engine belongs to this session alone; see the shared-engine rule below. The user keeps their named environments in `~/.cognigy-plugin/environments.json`;
you only ever see names and base URLs.

## Switching

1. Call `manage_environments { operation: "list" }` first. Pick the environment whose **exact
   name** best matches the user's words ("trial", "app", a tenant or customer name). Names can
   contain spaces, parentheses and `@`; copy them exactly.
2. If more than one name fits, or none does, ask the user which one. Do not guess between
   candidates.
3. Call `manage_environments { operation: "use", name }`. The very next tool call uses the new
   environment; no restart is needed.
4. Tell the user what changed in one line: previous → new, plus the base URL.
5. **Resource IDs differ between environments.** Project, agent and flow IDs you saw before the
   switch do not exist in the new one. List projects again before reusing any ID.

## Checking where you are

- "Which environment am I on?" → `{ operation: "current" }`. The name is the environment this
  session is using. A `null` name means the session is on the plugin's own credentials, which do
  not match any named environment; report the base URL instead.
- Before a destructive change (deleting resources, restoring a snapshot), if you are unsure which
  environment is active, check with `current` and say which one you are about to change.

## Rules

- A switch affects **this engine process only**. In Claude Code each session has its own engine, so other sessions keep their own environment. In Claude Desktop, Codex and Antigravity several chats can share one engine, so a switch there moves them all: check `current` before destructive work and say which environment you are about to change.
- **Never** ask for, repeat, read or look for an API key, and do not open
  `~/.cognigy-plugin/environments.json` or `config.json`. Keys never need to pass through the chat.
- You cannot add, edit or remove environments. If the user wants a new one, tell them to run, in
  a terminal: `npx -y -p @cognigy/plugin-engine cognigy-env add <name> <base-url>` (it asks for
  the key without showing it). `cognigy-env use <name>` in a terminal sets the default for
  **new** sessions only; it never changes a session that is already running.
- If `list` or `use` reports a problem with the environments file, relay the message as is. Do not
  retry with other names to work around it.
