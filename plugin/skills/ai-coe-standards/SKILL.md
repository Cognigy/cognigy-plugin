---
name: ai-coe-standards
description: "AI COE standards this fork enforces at write time (blocking) or warns about (advisory) - generated from src/policy/registry.ts. Read when a manage_flow_nodes / create_tool / update_tool call is refused with error: policy_violation, or before writing Code Node / tool code, to know what will be checked before you write it."
---

# AI COE Standards

This file is **generated in full by `src/policy/generate-docs.ts`** from the
rule registry at `src/policy/registry.ts`. Never hand-edit it - the next
generation overwrites it, and `docs-fresh.test.ts` fails the build if this
file drifts from the registry.

These standards are enforced by the AI COE policy layer, not by upstream. A
call that violates a `block`-severity rule returns
`{ error: "policy_violation", changed: false, findings: [...] }` and nothing
is written.

## Overriding a false positive

If a finding is wrong for your specific case, retry the exact same call with
the offending rule id(s) listed in `_policyOverride`, for example:

```
manage_flow_nodes { flowId, operation: "create", nodeType: "code",
                    config: {...}, _policyOverride: ["<ruleId>"] }
```

State in one short line which rule you are overriding and why. The override
then applies for that rule, for that project, for the rest of the session -
you do not need to repeat it on every retry.

## Enforced rules

## `codenode.runtime-apis`

- **Severity:** block
- **Kind:** Platform fact - states something the Cognigy platform cannot do. A candidate for an upstream PR.
- **Docs:** https://docs.cognigy.com/ai/for-developers/code/api-functions
- **Retires when:** upstream makes these blocking, or the team accepts advisory severity for them
