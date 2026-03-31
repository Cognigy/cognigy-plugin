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

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Every commit message **must** follow this format:

```
<type>(<optional scope>): <description>
```

### Allowed types

| Type       | When to use                              | Shows in changelog? |
| ---------- | ---------------------------------------- | ------------------- |
| `feat`     | New feature or capability                | Yes                 |
| `fix`      | Bug fix                                  | Yes                 |
| `perf`     | Performance improvement                  | Yes                 |
| `revert`   | Reverts a previous commit                | Yes                 |
| `docs`     | Documentation only                       | No                  |
| `style`    | Formatting, whitespace (no logic change) | No                  |
| `refactor` | Code restructuring (no feature/fix)      | No                  |
| `test`     | Adding or updating tests                 | No                  |
| `build`    | Build system or dependency changes       | No                  |
| `ci`       | CI/CD pipeline changes                   | No                  |
| `chore`    | Maintenance tasks                        | No                  |

### Examples

```bash
git commit -m "feat(tools): add manage_packages tool"
git commit -m "fix(llm): handle timeout on connection test"
git commit -m "chore: update dev dependencies"
git commit -m "docs(readme): update install instructions"
```

### Breaking changes

Add `!` after the type/scope for breaking changes:

```bash
git commit -m "feat(tools)!: rename manage_webchat to configure_webchat"
```

Commit messages are validated by **commitlint** in CI — PRs with non-conforming messages will fail the check. See [`docs/COMMIT_AND_CHANGELOG_GUIDE.md`](./COMMIT_AND_CHANGELOG_GUIDE.md) for the full guide.

## Guidelines

Read [`.cursorrules`](../.cursorrules) for development guidelines.

Pull requests are validated with tests, a Prettier formatting check, and commitlint
on changed files. Prettier and commitlint are installed as project `devDependencies`,
so a separate global install is not required.

## Scripts

| Command                                | Description                                       |
| -------------------------------------- | ------------------------------------------------- |
| `npm run build`                        | Compile TypeScript                                |
| `npm test`                             | Run test suite                                    |
| `npm run lint`                         | Run ESLint                                        |
| `npm run prettier:check -- <files...>` | Check formatting with Prettier for specific files |
| `npm run cl:preview`                   | Preview unreleased changelog entries              |
| `npm run dev`                          | Watch mode (tsx)                                  |
| `npm run mcpb:pack`                    | Build `.mcpb` bundle                              |

## Submitting Changes

Open a pull request on [GitHub](https://github.com/Cognigy/cognigy-mcp). Issues and feature requests can be filed there too.
