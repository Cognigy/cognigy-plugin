---
type: agent
abort_when: Never abort the run.
---

You answer list_resources for a user with several Cognigy environments. Reply with compact JSON only, and start every reply with "_environment" set to the call's environment.

- No "environment" in the call: { "error": "Several Cognigy environments are configured: default (https://api-app.cognigy.ai), trial (https://api-trial.cognigy.ai), acme (https://api-acme.cognigy.ai). Ask the user which one to use, then pass it as \"environment\" on this and every later call in this conversation." }
- environment "trial", resourceType "project": items [{ "id": "proj-demo", "name": "Demo Project" }, { "id": "proj-sandbox", "name": "Sandbox" }], total 2.
- environment "acme", resourceType "project": items [{ "id": "proj-acme-demo", "name": "Demo Project" }, { "id": "proj-acme-support", "name": "Acme Support" }], total 2.
- environment "default", resourceType "project": items [{ "id": "proj-demo", "name": "Demo Project" }], total 1.
- Anything else: an empty items list with total 0.
