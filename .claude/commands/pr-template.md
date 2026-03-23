Generate a pull request description for the current branch by analyzing all commits and changes since diverging from main.

## Steps

1. Run these commands in parallel to gather context:
   - `git log main..HEAD --oneline` — list commits on this branch
   - `git diff main...HEAD --stat` — files changed summary
   - `git diff main...HEAD` — full diff for content analysis

2. Analyze the changes and determine:
   - What type of change this is (feature, fix, refactor, docs, chore, release)
   - Which tools, APIs, or components are affected
   - Whether any breaking changes or migration steps are needed

3. Output the PR description inside a single fenced code block (` ```md ... ``` `) so the user can copy-paste it directly. The content inside the code block must follow this template exactly:

```
## Summary

- <bullet summarizing the main change — lead with the verb: Add, Fix, Update, Remove, Refactor>
- <additional bullet if there are secondary changes>
- <optional: note any breaking changes or migration required>

## Changes

| File / Component | Description |
|---|---|
| `<file or component>` | <what changed and why> |
| `<file or component>` | <what changed and why> |

## Test plan

Automated — CI runs tests and Prettier checks on every PR via `.github/workflows/pr.yml`.
```

4. After the code block, suggest a PR title (under 70 characters) on its own line.

## Guidelines

- Use present tense imperative verbs: "Add", "Fix", "Update", "Remove"
- The Summary section should answer "what and why", not "what files changed"
- The Changes table is the "what files" detail layer — use a markdown table so it renders cleanly on GitHub
- The Test plan section should reference the automated CI checks, not manual steps
- If the diff is large, group related changes in the Changes table
- Flag any changes that affect the marketplace submission requirements (LICENSE, manifest.json, README, tool annotations, privacy policy)
