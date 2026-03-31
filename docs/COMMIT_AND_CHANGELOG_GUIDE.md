# Commit & Changelog Workflow Guide

This project uses **Conventional Commits** to auto-generate a semantic changelog on every release.

---

## Overview: How It Works

```
Developer writes code
    ↓
Commits using conventional format  ←  enforced by commitlint in PR checks
    ↓
Opens PR → PR checks run (tests, prettier, commitlint)
    ↓
PR merged to main
    ↓
Release workflow triggers automatically:
  1. Detects bump type from PR labels (major/minor/patch)
  2. Bumps version in package.json + manifest.json
  3. Auto-generates CHANGELOG.md from commits since last tag
  4. Publishes to npm
  5. Commits changelog + version bump
  6. Creates GitHub release (changelog included in release body)
```

---

## What Changes (Implementation Plan)

### 1. New dev dependencies

**`@commitlint/cli`**
The CLI that actually runs commit message validation. It reads each commit message and checks it against a ruleset. Without this, there is no enforcement — developers could write any commit message and the changelog generator would either skip it or produce garbage entries.

**`@commitlint/config-conventional`**
The ruleset that defines _what_ a valid conventional commit looks like (allowed types like `feat`, `fix`, `chore`, required format `type(scope): description`, etc.). commitlint is just the engine — this package is the rules it enforces. Without it, you'd have to write every rule by hand.

**`conventional-changelog-cli`**
The CLI that reads your git history (commits + tags) and generates a formatted `CHANGELOG.md`. It groups commits by type, links to commits/PRs, and organizes them under version headings. This is the tool that actually produces the changelog file in the release workflow.

**`conventional-changelog-conventionalcommits`**
The preset that tells the changelog generator _how_ to parse commits and _which_ types map to which changelog sections (e.g. `feat` → "Features", `fix` → "Bug Fixes", `chore` → hidden). Without this preset, the generator wouldn't know how to interpret conventional commit messages.

### 2. New file: `commitlint.config.js`

A one-liner config that extends `@commitlint/config-conventional`.

### 3. Updated workflow: `.github/workflows/pr.yml`

Add a **commitlint step** that validates all commit messages in the PR. This runs alongside the existing tests and prettier checks.

```yaml
- name: Validate commit messages
  run: npx commitlint --from ${{ github.event.pull_request.base.sha }} --to ${{ github.sha }} --verbose
```

### 4. Updated workflow: `.github/workflows/release.yml`

Add a **changelog generation step** between version bump and npm publish:

```yaml
- name: Generate changelog
  run: npx conventional-changelog -p conventionalcommits -i CHANGELOG.md -s -r 0

- name: Commit version bump and changelog
  run: |
    git add package.json manifest.json CHANGELOG.md
    git commit -m "release: v$NEW_VERSION"
    git tag "v$NEW_VERSION"
    git push origin main --tags
```

Also update the GitHub release step to include the changelog section for the new version in the release body (instead of just install instructions).

### 5. Existing `CHANGELOG.md` → replaced

The current manually-maintained CHANGELOG.md will be replaced by the auto-generated one on the first release after this change. Historical entries from before conventional-changelog adoption won't appear unless we seed them (optional).

---

## Commit Message Format

Every commit **must** follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | When to use                              | Appears in changelog? |
| ---------- | ---------------------------------------- | --------------------- |
| `feat`     | New feature or capability                | Yes — **Features**    |
| `fix`      | Bug fix                                  | Yes — **Bug Fixes**   |
| `perf`     | Performance improvement                  | Yes — **Performance** |
| `revert`   | Reverts a previous commit                | Yes — **Reverts**     |
| `docs`     | Documentation only                       | No                    |
| `style`    | Formatting, whitespace (no logic change) | No                    |
| `refactor` | Code restructuring (no feature/fix)      | No                    |
| `test`     | Adding or updating tests                 | No                    |
| `build`    | Build system or dependency changes       | No                    |
| `ci`       | CI/CD pipeline changes                   | No                    |
| `chore`    | Maintenance tasks                        | No                    |

> Types marked "No" are valid commits but excluded from the changelog to keep it user-facing.

### Scopes (optional)

Clarify what area is affected:

```
feat(tools): add manage_packages tool
fix(llm): handle timeout on connection test
docs(readme): update install instructions
```

### Breaking Changes

Add `!` after type/scope, or include a `BREAKING CHANGE:` footer:

```
feat(tools)!: rename manage_webchat to configure_webchat

BREAKING CHANGE: manage_webchat has been renamed to configure_webchat.
```

Breaking changes always appear prominently in the changelog regardless of type.

---

## PR Labels for Version Bumps

The release workflow determines the semver bump from PR labels (this already exists today):

| Label    | Version bump | When to use                         |
| -------- | ------------ | ----------------------------------- |
| `major`  | `X.0.0`      | Breaking changes                    |
| `minor`  | `0.X.0`      | New features (backwards-compatible) |
| _(none)_ | `0.0.X`      | Bug fixes, docs, chores (default)   |

---

## Examples

```bash
# Feature
git commit -m "feat: add knowledge store bulk import"

# Feature with scope
git commit -m "feat(tools): add manage_packages tool for package upload and import"

# Bug fix
git commit -m "fix(llm): prevent crash when provider metadata is missing"

# Chore (won't appear in changelog)
git commit -m "chore: update dev dependencies"

# Multi-line with body
git commit -m "fix(webchat): resolve style preset not applying on first load

The preset CSS was loaded asynchronously but the component rendered
before styles were ready. Added a loading gate to prevent FOUC."
```

---

## Generated Changelog Example

After a release, `CHANGELOG.md` will look like:

```markdown
## [0.3.0](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.12...v0.3.0) (2026-04-01)

### Features

- **tools:** add manage_packages tool for package upload and import (15a5593)
- add knowledge store bulk import (abc1234)

### Bug Fixes

- **llm:** prevent crash when provider metadata is missing (def5678)

## [0.2.12](https://github.com/Cognigy/cognigy-mcp/compare/v0.2.11...v0.2.12) ...
```

Each entry links to the commit and groups changes by type. The GitHub release body will contain the same content for the released version.

---

## Enforcement

- **CI (required):** commitlint runs on every PR and blocks merge if any commit message is non-conforming.
- **Local (optional):** Developers can check locally with `npx commitlint --last` or `echo "feat: my change" | npx commitlint`.

---

## FAQ

**Q: I have many small WIP commits. Do they all need to follow the format?**
A: Yes — commitlint checks all commits in the PR. Options: (a) squash WIP commits before review, (b) use squash-merge on GitHub so only the merge commit matters, or (c) use `--no-verify` locally for WIP and rewrite before pushing.

**Q: What happens to the old manually-written changelog entries?**
A: The first auto-generated run uses `-r 0` (regenerate all) which builds from git tags. Old manual entries not backed by conventional commits won't appear. We can optionally seed the historical section once.

**Q: Can I preview what will be in the next changelog?**
A: Run `npx conventional-changelog -p conventionalcommits -u` locally to see unreleased changes.

**Q: Can I manually edit the changelog?**
A: Edits will be overwritten on the next release. If an entry is wrong, fix it via a revert + re-commit with the correct message.
