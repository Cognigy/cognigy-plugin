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
   - What testing steps a reviewer should follow

3. Output a PR description in this exact format (ready to copy-paste or use with `gh pr create`):

---

## Summary
- <bullet summarizing the main change — lead with the verb: Add, Fix, Update, Remove, Refactor>
- <additional bullet if there are secondary changes>
- <optional: note any breaking changes or migration required>

## Changes
- **`<file or component>`** — <what changed and why>
- **`<file or component>`** — <what changed and why>

## Test plan
- [ ] <specific thing a reviewer should verify — e.g., "Run `npm run build` and confirm no errors">
- [ ] <another verifiable step — e.g., "Check manifest.json tools list matches definitions.ts">
- [ ] <end-to-end or manual check if applicable>

---

## Guidelines

- Keep the PR title short (under 70 characters) — suggest one at the end
- Use present tense imperative verbs: "Add", "Fix", "Update", "Remove"
- The Summary section should answer "what and why", not "what files changed"
- The Changes section is the "what files" detail layer
- The Test plan should be actionable checkboxes a reviewer can actually run
- If the diff is large, group related changes in the Changes section
- Flag any changes that affect the marketplace submission requirements (LICENSE, manifest.json, README, tool annotations, privacy policy)
