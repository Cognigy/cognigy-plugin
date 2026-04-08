# Anthropic MCP Marketplace Submission

This document outlines everything needed to submit the MCP Server to the [Anthropic MCP connector marketplace](https://support.claude.com/en/articles/12922832-local-mcp-server-submission-guide).

## Status: Ready to submit once PR #17 is merged

---

## Prerequisites

### 1. Merge the distribution prep PR

- [ ] Review and merge [PR #17](https://github.com/Cognigy/cognigy-mcp/pull/17) into `main`
  - Adds LICENSE file, privacy policy, tool annotations, and updated README required by the submission guide

### 2. Create a Cognigy trial account for the reviewer

Anthropic's reviewer needs a working Cognigy account to test the MCP server. Set up a dedicated test account:

- [ ] Create a trial account at [https://trial.cognigy.ai](https://trial.cognigy.ai)
- [ ] Log in → **User Menu → My Profile → API Keys → Create New**
- [ ] Copy the generated API key (keep it ready for the submission form)
- [ ] Note the API base URL: `https://api-trial.cognigy.ai`
- [ ] Create at least one Project in the trial account so the reviewer has something to work with

---

## What was already done (distribution prep)

- [x] `.mcpb` bundle pipeline configured via GitHub Actions (auto-builds on release)
- [x] `manifest.json` — `manifest_version: "0.3"`, `user_config` with `sensitive: true` on API key, `privacy_policies` URL added
- [x] `LICENSE` — MIT license file added
- [x] Tool annotations — all 11 tools have correct `readOnlyHint` / `destructiveHint` values
- [x] README — Privacy Policy section, 5 usage examples, trimmed to submission requirements
- [x] `CHANGELOG.md` present
- [x] npm package published as `@cognigy/mcp-server`

---

## Submitting the form

Submit at: **https://forms.gle/tyiAZvch1kDADKoP9**

Use the following details when filling in the form:

| Field              | Value                                  |
| ------------------ | -------------------------------------- |
| Server name        | Cognigy AI Agent MCP Server            |
| Repository URL     | https://github.com/Cognigy/cognigy-mcp |
| npm package        | `@cognigy/mcp-server`                  |
| Version            | (latest version. e.g: 0.2.15)          |
| License            | MIT                                    |
| Privacy policy URL | https://www.cognigy.com/privacy-policy |
| Support contact    | support@cognigy.com                    |
| Test API base URL  | `https://api-trial.cognigy.ai`         |
| Test API key       | _(the key generated in step 2 above)_  |

---

## Common rejection reasons to double-check before submitting

- [ ] All tools have exactly one of `readOnlyHint: true` or `destructiveHint: true` ✓ (done in PR #17)
- [ ] Privacy policy present in both README and `manifest.json` ✓ (done in PR #17)
- [ ] At least 3 usage examples in README ✓ (5 added in PR #17)
- [ ] LICENSE file present ✓ (added in PR #17)
- [ ] Test credentials provided in the form (see step 2 above)
- [ ] Server tested in a clean environment (no local dev dependencies)
