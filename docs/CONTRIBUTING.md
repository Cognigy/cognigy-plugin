# Contributing

Contributions are welcome!

## Development Setup

```bash
git clone https://github.com/Cognigy/cognigy-plugin.git
cd cognigy-plugin
npm ci
npm run build
```

This repo is the source for the `@cognigy/plugin-engine` npm package, which the plugin
auto-installs at runtime, pinned to the plugin's own version (the two share one number, kept in
lockstep by semantic-release — see [Allowed types](#allowed-types)). To test a local
engine build, temporarily point the plugin's `mcpServers.platform.args` in
`plugin/.claude-plugin/plugin.json` at your local `dist/index.js`, run `/reload-plugins`, then
revert before committing. See [`TESTING.md`](./TESTING.md) for the full local-engine and
marketplace test paths.

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Every commit message **must** follow this format:

```
<type>(<optional scope>): <description>
```

### Allowed types

Releases are automated by [semantic-release](https://semantic-release.gitbook.io/) — the
version bump, `CHANGELOG.md`, git tag, npm publish, and GitHub release are all derived from the
commit types that land on `main`. There are no manual version bumps. The same release version is
written into **both** `package.json` (the `@cognigy/plugin-engine` engine) and
`plugin/.claude-plugin/plugin.json` (the plugin), so they always carry one identical number — do
not edit either `version` by hand.

| Type       | When to use                              | Version bump | Shows in changelog? |
| ---------- | ---------------------------------------- | ------------ | ------------------- |
| `feat`     | New feature or capability                | minor        | Yes                 |
| `fix`      | Bug fix                                  | patch        | Yes                 |
| `perf`     | Performance improvement                  | patch        | Yes                 |
| `revert`   | Reverts a previous commit                | patch        | Yes                 |
| `docs`     | Documentation only                       | patch        | Yes                 |
| `refactor` | Code restructuring (no feature/fix)      | patch        | Yes                 |
| `style`    | Formatting, whitespace (no logic change) | none         | No                  |
| `test`     | Adding or updating tests                 | none         | No                  |
| `build`    | Build system or dependency changes       | none         | No                  |
| `ci`       | CI/CD pipeline changes                   | none         | No                  |
| `chore`    | Maintenance tasks                        | none         | No                  |

A `!` (or a `BREAKING CHANGE:` footer) bumps a **major** version regardless of type.

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

Commit messages are validated by **commitlint** in CI — PRs with non-conforming messages will
fail the check.

## Pull Request titles

PRs are **squash-merged**, and the squash commit message is the **PR title**. That single commit
is what semantic-release reads on `main` to decide the next release. Therefore:

- **Your PR title must itself be a valid Conventional Commit** (same format and types as above).
- CI lints the PR title and re-runs the check whenever the title is edited. A non-conventional
  title fails the check and blocks the merge.
- The PR title's type drives the release: e.g. a `feat:` PR cuts a minor release on merge, while
  a `chore:`/`ci:` PR cuts none — see the table above.

## Guidelines

Pull requests are validated with tests, a Prettier formatting check, and commitlint
on changed files. Prettier and commitlint are installed as project `devDependencies`,
so a separate global install is not required.

## Scripts

| Command                                | Description                                       |
| -------------------------------------- | ------------------------------------------------- |
| `npm run build`                        | Clean `dist` and compile TypeScript               |
| `npm run dev`                          | Watch mode (tsx)                                  |
| `npm start`                            | Run the built server (`node dist/index.js`)       |
| `npm test`                             | Run test suite                                    |
| `npm run lint`                         | Run ESLint                                        |
| `npm run prettier:check -- <files...>` | Check formatting with Prettier for specific files |
| `npm run prettier:write -- <files...>` | Format specific files with Prettier               |

## Submitting Changes

Open a pull request on [GitHub](https://github.com/Cognigy/cognigy-plugin). Issues and feature requests can be filed there too.
