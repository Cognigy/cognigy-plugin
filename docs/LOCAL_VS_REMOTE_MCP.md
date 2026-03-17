# Local Vs Remote MCP

## Summary

For Cognigy, local MCP is the better supported model right now.

The main reason is that many Cognigy customers use their own dedicated SaaS environment. A local MCP client can connect directly to that customer's own Cognigy backend, while a remote MCP would need extra tenant-to-environment routing, hosted auth state, and stronger isolation.

## Comparison

| Topic | Local MCP | Remote MCP |
|---|---|---|
| Customer environment fit | Connects directly to each customer's own Cognigy environment | Needs extra routing logic to know which customer backend to use |
| SaaS fit | Strong | Weaker for now |
| Auth model | API key or OAuth directly against the customer's backend | Hosted login, hosted callback, hosted session/token handling |
| Operational complexity | Lower | Higher |
| Deployment model | Runs on the user's machine or MCP client | Requires hosted infra, ingress, secrets, rollout, monitoring |
| Token boundary | Tokens stay local to the user | Tokens and login state live on the hosted service |
| Time to support | Shorter, because it already exists | Longer, because it adds a hosted platform layer |

## Why Local Works Better For Us

1. Cognigy is frequently consumed through dedicated customer environments.
2. Local MCP can point directly at the correct `api-<env>` URL for that customer.
3. It avoids building a multi-tenant hosted MCP service before we really need one.
4. It keeps authentication tied to the customer's own Cognigy backend.
5. We already have the product and auth shape for local MCP.

## Recommended Direction

- Support local MCP as the main and only supported distribution model for now.
- Prefer API key for the easiest local setup.
- Keep OAuth available for local MCP users who do not have or do not want to use an API key.
- Keep remote MCP as future or exploratory work, not the current product path.
