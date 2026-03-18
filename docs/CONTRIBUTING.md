# Contributing

Contributions are welcome!

## Development Setup

```bash
git clone https://github.com/Cognigy/cognigy-mcp.git
cd cognigy-mcp
npm install
npm run build
```

Point your MCP client to the local build:

```json
{
  "mcpServers": {
    "cognigy": {
      "command": "node",
      "args": ["/absolute/path/to/cognigy-mcp/dist/index.js"],
      "env": {
        "COGNIGY_API_BASE_URL": "https://api-trial.cognigy.ai",
        "COGNIGY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Or use the interactive setup: `npm run setup`

## Guidelines

Read [`.cursorrules`](../.cursorrules) for development guidelines.

## Scripts

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript |
| `npm test` | Run test suite |
| `npm run lint` | Run ESLint |
| `npm run dev` | Watch mode (tsx) |
| `npm run mcpb:pack` | Build `.mcpb` bundle |

## Submitting Changes

Open a pull request on [GitHub](https://github.com/Cognigy/cognigy-mcp). Issues and feature requests can be filed there too.
