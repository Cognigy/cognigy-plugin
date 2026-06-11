# Commit & Release Workflow Guide

This project releases automatically with [**semantic-release**](https://semantic-release.gitbook.io/).
The version bump, `CHANGELOG.md`, git tag, npm publish, and GitHub release are all derived from
[Conventional Commit](https://www.conventionalcommits.org/) messages that land on `main`. There
are **no manual version bumps and no hand-edited changelog**.

For the short contributor-facing rules, see [`CONTRIBUTING.md`](./CONTRIBUTING.md). This guide is
the deeper "how it actually works" reference.

---

## Overview: how it works

```
Developer writes code
    ↓
Commits using conventional format   ← commitlint enforces this in PR checks
    ↓
Opens PR → PR checks run (tests, prettier, commitlint on commits + PR title)
    ↓
PR is squash-merged to main → the PR title becomes the single commit subject
    ↓
release.yml runs semantic-release on the push to main:
  1. Analyzes commits since the last tag → decides major / minor / patch (or no release)
  2. Generates release notes + updates CHANGELOG.md
  3. Bumps version in package.json, syncs manifest.json, builds the .mcpb bundle
  4. Commits "chore(release): x.y.z [skip ci]" and the tag, pushing to main
     (as the "Cognigy bypass branch protection" App, which bypasses branch protection)
  5. Publishes to npm
  6. Creates the GitHub release (notes + .mcpb asset + link to the README install section)
```

Because PRs are **squash-merged**, the **PR title is the commit subject** semantic-release reads.
A PR title must therefore be a valid Conventional Commit — CI lints it and blocks merge otherwise.

`[skip ci]` on the release commit stops it from re-triggering the workflow.

---

## Commit message format

```
<type>(<optional scope>): <description>

[optional body — wrap lines at 200 chars]

[optional footer(s)]
```

### Types, version bump, and changelog section

| Type       | When to use                              | Version bump | Changelog section        |
| ---------- | ---------------------------------------- | ------------ | ------------------------ |
| `feat`     | New feature or capability                | minor        | Features                 |
| `fix`      | Bug fix                                  | patch        | Bug Fixes                |
| `perf`     | Performance improvement                  | patch        | Performance Improvements |
| `revert`   | Reverts a previous commit                | patch        | Reverts                  |
| `docs`     | Documentation only                       | patch        | Documentation            |
| `refactor` | Code restructuring (no feature/fix)      | patch        | Code Refactoring         |
| `style`    | Formatting, whitespace (no logic change) | none         | hidden                   |
| `test`     | Adding or updating tests                 | none         | hidden                   |
| `build`    | Build system or dependency changes       | none         | hidden                   |
| `ci`       | CI/CD pipeline changes                   | none         | hidden                   |
| `chore`    | Maintenance tasks                        | none         | hidden                   |

The version bump and section mapping are configured in [`.releaserc.json`](../.releaserc.json)
(`@semantic-release/commit-analyzer` `releaseRules` and `@semantic-release/release-notes-generator`
`presetConfig`). A PR whose type resolves to "none" merges without cutting a release.

### Scopes (optional)

```
feat(tools): add manage_packages tool
fix(llm): handle timeout on connection test
docs(readme): update install instructions
```

### Breaking changes

Add `!` after the type/scope, or include a `BREAKING CHANGE:` footer. Either bumps a **major**
version regardless of type:

```
feat(tools)!: rename manage_webchat to configure_webchat

BREAKING CHANGE: manage_webchat has been renamed to configure_webchat.
```

---

## Examples

```bash
# Feature → minor
git commit -m "feat: add knowledge store bulk import"

# Feature with scope
git commit -m "feat(tools): add manage_packages tool for package upload and import"

# Bug fix → patch
git commit -m "fix(llm): prevent crash when provider metadata is missing"

# Chore → no release, hidden from changelog
git commit -m "chore: update dev dependencies"

# Multi-line with body
git commit -m "fix(webchat): resolve style preset not applying on first load

The preset CSS was loaded asynchronously but the component rendered
before styles were ready. Added a loading gate to prevent FOUC."
```

---

## Generated changelog example

```markdown
## [1.1.0](https://github.com/Cognigy/cognigy-mcp/compare/v1.0.3...v1.1.0) (2026-06-09)

### Features

- **tools:** add manage_packages tool for package upload and import (15a5593)

### Bug Fixes

- **llm:** prevent crash when provider metadata is missing (def5678)
```

Each entry links to the commit. The GitHub release body carries the same notes plus a link to
the README install section.

---

## Enforcement

- **Commits (CI):** commitlint runs on every PR and fails if any commit message is non-conforming.
- **PR title (CI):** commitlint also lints the PR title (re-running when the title is edited),
  because the squash subject is what drives the release.
- **Local preview:** `npx semantic-release --dry-run` (with `GITHUB_TOKEN` set) shows the next
  computed version and notes without publishing.

---

## FAQ

**Q: I have many small WIP commits. Do they all need to follow the format?**
A: commitlint checks every commit in the PR, but since merges are squashed, the **PR title** is
what ends up on `main` and drives the release. Keep commits tidy, but the title is what matters.

**Q: Can I manually edit `CHANGELOG.md` or the version in `package.json`?**
A: No — both are managed by semantic-release and would be overwritten. To correct a released
entry, land a follow-up commit (e.g. a `revert` or a `docs` fix); the history is derived from
commit messages.

**Q: How do I make a release not happen for a docs/tooling PR?**
A: Use a `chore`, `ci`, `build`, `test`, or `style` type — these produce no release.

**Q: Why does pushing the release commit to `main` work when direct pushes are blocked?**
A: `release.yml` mints a token for the `Cognigy bypass branch protection` GitHub App, which is on
the `Main branch protection` ruleset's bypass list. The default `GITHUB_TOKEN` cannot bypass it.
