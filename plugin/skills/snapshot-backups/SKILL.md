---
name: snapshot-backups
description: "Use when backing up a Cognigy project before changing an existing AI Agent, rolling a project back to a previous state, undoing agent changes, or working with Cognigy Snapshots — create, restore, list, delete."
---

# Snapshot Backups and Rollback

Use `manage_snapshots` to take a restorable backup of a Cognigy project and to roll
it back. A Snapshot is an immutable copy of a **whole project**.

## Read this before offering a backup

- A snapshot covers the **entire project** — every AI Agent, Flow, Connection, LLM,
  Lexicon, Extension, Function, Playbook, Goal, Snippet and Locale in it. Restoring
  reverts **all** of them, not just the agent you are working on.
- A snapshot does **NOT** contain:
  - Endpoints (and their API keys)
  - Knowledge AI — stores, sources, chunks, connectors
  - Intent Trainer learning sentences
  - Analytics data, contact profiles, logs
  - Other snapshots and packages
- So for an agent that uses knowledge, a snapshot is **not a complete backup**. Say
  this in one line when you offer it, rather than letting the user believe otherwise.
- Restoring is **irreversible** and deletes resources before recreating them.
- Snapshots cannot be renamed or edited after creation.

## Supported workflow

### Back up before changing an existing agent

The server enforces this once per session, so you do not have to remember it. The
**first** attempt to change an existing agent — `update_ai_agent`, `create_tool`,
`update_tool`, a mutating `manage_flow_nodes`, or `delete_resource` — is **held**:
it changes nothing and returns `error: "backup_not_offered"`.

When you see that error:

1. Do **not** report the change as done. Nothing happened.
2. Ask the user, in one short line, whether they want a restorable backup first. If
   the agent uses knowledge, add that Knowledge AI is not covered.
3. If they accept:
   - `manage_snapshots { operation: "create", projectId: "<projectId>", label: "pre-persona-update" }`
   - Wait for `created: true`.
4. If they decline:
   - `manage_snapshots { operation: "decline", projectId: "<projectId>" }`
5. **Retry the held call.** It now goes through, and nothing is held for the rest of
   the session.

The gate does not fire for an agent created in this same session — there is no prior
state to roll back to — and never for read-only operations.

If you do not have the `projectId`, read it from
`get_resource { resourceType: "agent", id: "<aiAgentId>" }`, which returns it.
If `create` returns `error: "snapshot_limit_reached"`, follow *At the snapshot limit*
below. If it returns `pending: true`, the backup does **not** exist yet — poll
`read_task` until it is done before changing anything, and note that a pending
create does not satisfy the gate.

`label` is a short reason, not a name. The plugin builds the name itself as
`[AI Backup] <label> — <timestamp>` so the backup is always identifiable and always
uniquely named.

### Roll back to a backup

1. `manage_snapshots { operation: "list", projectId: "<projectId>" }`
2. Pick the snapshot. `isPluginBackup: true` marks the ones this plugin created.
3. Get a preflight — this changes **nothing**:
   - `manage_snapshots { operation: "restore", projectId: "<projectId>", snapshotId: "<snapshotId>" }`
4. Show the user the returned `warnings` and `notRestored` lists, and the snapshot's
   name and age. Ask for explicit agreement.
5. Only after they agree:
   - `manage_snapshots { operation: "restore", projectId: "<projectId>", snapshotId: "<snapshotId>", confirm: true }`
6. Afterwards:
   - Every resource id in the project has changed. Re-list agents and flows; do not
     reuse any id from earlier in the conversation.
   - Tell the user to check Endpoints assigned to non-primary Locales in the Cognigy
     UI — those are marked with a red dot and need manual repair.
   - Knowledge AI was not restored.

### At the snapshot limit

A project holds a limited number of snapshots (10 by default, configurable per
installation). `create` pre-checks this and creates nothing when the project is full.

1. `create` returns `error: "snapshot_limit_reached"` with `count`, `assumedMax`,
   `deletableBackups`, and `oldestDeletable`.
2. If `oldestDeletable` is present, ask the user whether to delete that backup to make
   room, naming it. Only if they agree:
   - `manage_snapshots { operation: "create", projectId: "<projectId>", label: "<why>", confirmDeleteOldest: true }`
   - This deletes the **oldest plugin-created backup** and then creates the new one.
     The response reports it as `deletedToFreeSlot`.
3. If `deletableBackups` is empty, **stop**. The plugin never deletes a human-created
   snapshot. Tell the user to delete one themselves in the Cognigy UI under
   **Deploy > Snapshots**, then retry.

### Delete a backup the plugin created

1. `manage_snapshots { operation: "delete", projectId: "<projectId>", snapshotId: "<snapshotId>" }`
2. If it returns `error: "not_a_plugin_backup"`, the snapshot was created by a human.
   Do not try to work around it — tell the user to delete it in the Cognigy UI.
3. If it returns `inUseByEndpoint: true`, an Endpoint is serving that snapshot. The
   user has to point the Endpoint at a different snapshot first.

## Operations

### `list`

Lists the project's snapshots with `isPluginBackup` on each, plus the current count.

Required:

- `projectId`

Optional:

- `limit`
- `skip`

Returns `count`, `assumedMax`, `atLimit`, `snapshots`, `oldestDeletableBackup`.

### `create`

Creates a backup snapshot of the project and waits for the task to finish.

Required:

- `projectId`

Optional:

- `label` — short reason, used inside the generated name. Do not pass a full name.
- `confirmDeleteOldest` — only after the user agreed to free a slot
- `waitForCompletion`
- `timeoutMs`

### `restore`

Rolls the project back. Returns a preflight report and changes nothing unless
`confirm: true`.

Required:

- `projectId`
- `snapshotId`

Optional:

- `confirm` — must be `true` to actually restore. Set it only after the user has seen
  the preflight and agreed.
- `waitForCompletion`
- `timeoutMs`

### `delete`

Deletes a snapshot. Accepts **only** snapshots this plugin created.

Required:

- `projectId`
- `snapshotId`

Optional:

- `waitForCompletion`
- `timeoutMs`

### `decline`

Records that the user was asked for a backup and said no, which releases the backup
gate for the rest of the session. Touches no API and creates nothing. Only call this
after actually asking the user.

Required:

- `projectId`

### `read_task`

Reads a create/restore/delete task and returns normalized status and progress.

Required:

- `projectId`
- `taskId`

## Notes

- Create, restore and delete are asynchronous platform tasks. By default this tool
  waits for completion; a long-running task can outlive the wait, in which case the
  response carries `pending: true` and a `taskId` to poll with `read_task`.
- Snapshot names must be unique within a project. The generated name includes a
  second-resolution timestamp, so back-to-back backups never collide.
- Identification: a plugin backup is named `[AI Backup] …` **and** carries a marker in
  its description. Both must match, which is why a human snapshot that happens to
  share the name prefix is still protected from deletion here.
- Downloading, packaging and uploading snapshots are deliberately not supported. Use
  the Cognigy UI for those.
- A snapshot deployed to an Endpoint cannot be deleted at all — the platform refuses.
