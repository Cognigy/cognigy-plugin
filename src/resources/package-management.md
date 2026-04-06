# Package Management Guide

Use `manage_packages` to import and export Cognigy package `.zip` files.

## Supported workflow

### Discover exportable resources

1. `manage_packages { operation: "list_exportable", projectId }`
2. Review the returned resources and choose the IDs you want to package
3. `manage_packages { operation: "export", projectId, resourceIds, name }`

### Import

1. `manage_packages { operation: "upload_and_inspect", projectId, filePath }`
2. Review the returned preview:
   - importable resources
   - conflicts
   - locale mapping defaults
3. `manage_packages { operation: "import", projectId, packageId, ... }`
4. If needed, poll task status with:
   - `manage_packages { operation: "read_task", projectId, taskId }`

### Export

1. `manage_packages { operation: "export", projectId, resourceIds, name }`
2. By default the archive is downloaded with MCP authentication and saved to a local temp file
3. The response includes the exact file path, the containing directory path, and `file://` URIs for both
4. Optionally control the destination by passing `outputPath`
5. If needed, poll task status with:
   - `manage_packages { operation: "read_task", projectId, taskId }`
6. Download an existing package later with:
   - `manage_packages { operation: "download", projectId, packageId, outputPath? }`

## Operations

### `list_exportable`

Returns the project resources that can be packaged for export, based on the same project graph the UI export flow uses.

Required:

- `projectId`

Notes:

- includes export candidates such as flows, endpoints, knowledge stores, AI agents, connections, and `largeLanguageModel` resources
- flags resources that are currently disabled for export, such as retired LLM models and function resources
- useful when the user asks what can be exported from a project before choosing `resourceIds`

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

### `export`

Creates a package from project resources.

Required:

- `projectId`
- `resourceIds`
- `name`

Optional:

- `dependencyResourceIds`
- `includeDependencies`
- `description`
- `outputPath`
- `waitForCompletion`
- `timeoutMs`

If `dependencyResourceIds` is omitted, all detected dependencies are included by default.

If `outputPath` is provided and the task completes, the `.zip` is written there immediately.

If `outputPath` is omitted, the `.zip` is still downloaded and saved to a local temp path because the raw download URL requires authentication.

The response includes:

- `savedTo`
- `savedToUri`
- `savedFileName`
- `savedDirectory`
- `savedDirectoryUri`
- `openArchiveUri`
- `openContainingFolderPath`
- `openContainingFolderUri`

### `download`

Downloads the package `.zip` with MCP authentication and saves it to disk.

Required:

- `projectId`
- `packageId`

Optional:

- `outputPath`

If `outputPath` is omitted, a temp file path is created automatically and returned.

The response includes the same saved file and directory fields as `export`.

## UI parity defaults

- `locale` resources are not imported directly; they are handled through `localeMapping`
- `knowledgeStore` resources default to strategy `replace`
- other resources default to strategy `re-identify`
- retired `largeLanguageModel` resources are disabled by default
- export includes detected dependencies by default
- export skips retired `largeLanguageModel` resources and function resources, matching current UI behavior
- imports always use `autoRename: true`
- exports append a timestamp suffix to the package name

## File handling

- Only local `.zip` files are supported
- `filePath` must be absolute
- `~` is expanded to the user home directory
- `outputPath` must be absolute when provided
- if `outputPath` points to a directory, the package name is used to create the final `.zip` path
- if `outputPath` is omitted for export or download, the package is saved under the system temp directory
- `savedToUri` is a `file://` URI for the package archive
- `savedDirectoryUri` is a `file://` URI for the containing folder, which clients can use to open Finder or Explorer directly
- `openContainingFolderUri` is the preferred folder-opening URI to present to users
- when showing saved locations to users, preserve the full absolute path or `file://` URI verbatim and do not shorten it with `...`

## Notes

- It uses the standard package upload endpoint, not resumable upload
- Long-running extraction, import, or export tasks may time out waiting; in that case use `read_task` to continue polling
