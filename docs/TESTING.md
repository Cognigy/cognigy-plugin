# Testing Distribution Paths

This guide covers the main ways to test how the MCP server is distributed to end users before publishing a release.

## Prerequisites

```bash
npm install
npm run build
```

You will need:

- A Cognigy API base URL
- A Cognigy API key
- Node.js 20+

## 1. Test the Local Build Directly

Use this when you want to verify the built MCP server itself without any client installer flow.

```bash
npm run start:local -- <base-api-url> <your-api-key>
```

Or:

```bash
bash scripts/run-local-mcp.sh <base-api-url> <your-api-key>
```

Or with environment variables:

```bash
COGNIGY_API_BASE_URL=<base-api-url> \
COGNIGY_API_KEY=<your-api-key> \
npm run start:local
```

Or:

```bash
COGNIGY_API_BASE_URL=<base-api-url> \
COGNIGY_API_KEY=<your-api-key> \
bash scripts/run-local-mcp.sh
```

What this does:

- Confirms `dist/index.js` exists
- Exports the required env vars
- Starts the local MCP server with `node dist/index.js`

## 2. Test the `init` Installer Locally

Use this when you want to verify the interactive installer flow for different MCP clients before the package is published to npm.

**IMPORTANT**: Make sure to build manually (`npm run build`) before running the script, in order to test the most recent changes in your local.

### Using the helper script

```bash
npm run test:init-local -- codex
npm run test:init-local -- cursor
npm run test:init-local -- vscode
npm run test:init-local -- <other-supported-client-names>
```

Or:

```bash
bash scripts/test-local-init.sh codex
bash scripts/test-local-init.sh cursor
bash scripts/test-local-init.sh vscode
bash scripts/test-local-init.sh <other-supported-client-names>
```

Currently we support following clients:

- `claude`
- `claude-code`
- `codex`
- `cursor`
- `vscode`

It runs:

```bash
node dist/index.js init --client <client>
```

but overrides the installed server command so the generated config points to the local launcher script instead of `npx @cognigy/mcp-server`.

Important:

- `test-local-init.sh` does not start the MCP server immediately
- It only installs client config that points to `scripts/run-local-mcp.sh`
- The MCP client will later run that launcher, and `run-local-mcp.sh` then starts your local `dist/index.js`
- You only need to run `npm run start:local` manually when testing the server directly outside a client

Without the override, the installed config points to the published package:

```json
{
  "mcpServers": {
    "cognigy": {
      "command": "npx",
      "args": ["-y", "@cognigy/mcp-server"],
      "env": {
        "COGNIGY_API_BASE_URL": "base-api-url",
        "COGNIGY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

With `scripts/test-local-init.sh`, the installed config points to the local launcher instead:

```json
{
  "mcpServers": {
    "cognigy": {
      "command": "bash",
      "args": ["/absolute/path/to/cognigy-mcp/scripts/run-local-mcp.sh"],
      "env": {
        "COGNIGY_API_BASE_URL": "base-api-url",
        "COGNIGY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Why this matters:

- The normal config tests the published distribution path through npm
- The local override config tests the same client installation flow without requiring the package to be published first
- `run-local-mcp.sh` then starts your local `dist/index.js`, so the client still launches the built MCP server through stdio

For Codex specifically, the generated config is TOML instead of JSON. Without the override it looks like this:

```toml
[mcp_servers.cognigy]
command = "npx"
args = ["-y", "@cognigy/mcp-server"]

[mcp_servers.cognigy.env]
COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai"
COGNIGY_API_KEY = "your-api-key-here"
```

With `scripts/test-local-init.sh codex`, it looks like this:

```toml
[mcp_servers.cognigy]
command = "bash"
args = ["/absolute/path/to/cognigy-mcp/scripts/run-local-mcp.sh"]

[mcp_servers.cognigy.env]
COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai"
COGNIGY_API_KEY = "your-api-key-here"
```

To avoid modifying your real Codex config while testing:

```bash
HOME="$(mktemp -d /tmp/codex-test-home.XXXXXX)" \
bash scripts/test-local-init.sh codex
```

Then inspect the generated file:

```bash
cat "$HOME/.codex/config.toml"
```

### Running the installer directly

```bash
node dist/index.js init --client claude
node dist/index.js init --client claude-code
node dist/index.js init --client cursor
node dist/index.js init --client vscode
```

If you want those clients to install a local launcher instead of `npx @cognigy/mcp-server`, set these overrides first:

```bash
export COGNIGY_MCP_INIT_COMMAND="bash"
export COGNIGY_MCP_INIT_ARGS='["/absolute/path/to/cognigy-mcp/scripts/run-local-mcp.sh"]'
```

Without those overrides, generated JSON client configs look like this:

```json
{
  "mcpServers": {
    "cognigy": {
      "command": "npx",
      "args": ["-y", "@cognigy/mcp-server"],
      "env": {
        "COGNIGY_API_BASE_URL": "base-api-url",
        "COGNIGY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

With the local override variables set, they look like this instead:

```json
{
  "mcpServers": {
    "cognigy": {
      "command": "bash",
      "args": ["/absolute/path/to/cognigy-mcp/scripts/run-local-mcp.sh"],
      "env": {
        "COGNIGY_API_BASE_URL": "base-api-url",
        "COGNIGY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

What this tests:

- Prompting for API URL and API key
- Client-specific config file generation
- Local distribution wiring without needing a published npm package

## 3. Test the `.mcpb` Bundle

Use this when you want to verify the Claude Desktop bundle that is produced for release distribution.

Build the bundle:

```bash
npm run mcpb:pack
```

This script:

- Runs `npm run build`
- Runs `npx @anthropic-ai/mcpb pack`
- Produces a `.mcpb` bundle in the repository root

Typical verification steps:

1. Run `npm run mcpb:pack`
2. Confirm the `.mcpb` file was created
3. Open the `.mcpb` file with Claude Desktop
4. Complete the install dialog with your API URL and API key
5. Restart Claude Desktop and verify the `NiCE Cognigy MCP` appears

## 4. Run Automated Checks

Before publishing, run the usual checks as well:

```bash
npm test
npm run lint
npx tsc --noEmit
```

## Recommended Workflow Before Release

1. Run `npm run build`
2. Run `npm test`
3. Test the local MCP server with `scripts/run-local-mcp.sh`
4. Test at least one `init --client ...` flow locally
5. Run `npm run mcpb:pack`
6. Verify the generated `.mcpb` bundle in Claude Desktop
