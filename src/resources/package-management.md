# Package Management Guide

Use `manage_packages` to import Cognigy package `.zip` files into a project.

## Supported workflow

1. `manage_packages { operation: "upload_and_inspect", projectId, filePath }`
2. Review the returned preview:
   - importable resources
   - conflicts
   - locale mapping defaults
3. `manage_packages { operation: "import", projectId, packageId, ... }`
4. If needed, poll task status with:
   - `manage_packages { operation: "read_task", projectId, taskId }`

## Operations

### `upload_and_inspect`

- Reads a local `.zip` file from disk
- Uploads it to Cognigy
- Waits for extraction to finish
- Returns an import preview

Required:
- `projectId`
- `filePath`

Optional:
- `timeoutMs`

### `inspect`

Returns the import preview for an already uploaded package.

Required:
- `projectId`
- `packageId`

### `import`

Imports resources from the package into the target project.

Required:
- `projectId`
- `packageId`

Optional:
- `resources`
- `localeMapping`
- `waitForCompletion`
- `timeoutMs`

If `resources` is omitted, the preview defaults are used.

If `localeMapping` is omitted, the preview default mapping is used.

### `read_task`

Reads a task and returns normalized status/progress.

Required:
- `projectId`
- `taskId`

## UI parity defaults

- `locale` resources are not imported directly; they are handled through `localeMapping`
- `knowledgeStore` resources default to strategy `replace`
- other resources default to strategy `re-identify`
- retired `largeLanguageModel` resources are disabled by default
- imports always use `autoRename: true`

## File handling

- Only local `.zip` files are supported
- `filePath` must be absolute
- `~` is expanded to the user home directory

## Notes

- This tool is import-only in v1
- It uses the standard package upload endpoint, not resumable upload
- Long-running extraction or import tasks may time out waiting; in that case use `read_task` to continue polling
