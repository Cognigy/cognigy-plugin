# MCP OAuth Isolation And Remote Hosting TDD

**Owner:** Arsalan Harouni

**Type:** Technical Design Document

**Repositories:**

- `cognigy-mcp`
- `cognigy` monorepo (`service-api`, `service-ui`)

## Revision History

| Document Version | Revision Date | Revision Description | Author |
|------------------|---------------|----------------------|--------|
| 1.0 | 2026-03-16 | Initial draft for MCP OAuth isolation and remote-hosted target architecture | Arsalan Harouni |

## Introduction

`cognigy-mcp` currently authenticates as a locally running public OAuth client using Authorization Code + PKCE, a localhost callback, and a per-user local token file. That works for local distributions, but it does not map cleanly to a hosted remote MCP deployment.

At the same time, the OAuth implementation in `service-api` is shared by multiple products and still includes legacy behavior such as password grant support for the UI client. Reworking the whole shared OAuth stack at once would create unnecessary regression risk for non-MCP consumers.

This design introduces an MCP-specific OAuth profile inside `service-api` so MCP behavior can evolve independently. The phased target is:

- preserve the current local MCP flow
- isolate MCP-specific OAuth policy from shared legacy consumers
- add a hosted remote MCP flow
- move MCP to a stricter OAuth 2.1-style profile without forcing the rest of `service-api` to do so immediately

## Use Cases

**UC1 — Local MCP login remains supported**

Users running `cognigy-mcp` locally through `npm`, `.mcpb`, or equivalent clients can continue signing in with browser-based Authorization Code + PKCE and reusing locally persisted sessions.

**UC2 — MCP OAuth behavior can evolve independently**

The MCP client can require stricter policy such as PKCE, exact redirect URI matching, and MCP-only scope validation without breaking Live Agent, Voice Gateway, Auto Dialer, UI login, or other OAuth consumers.

**UC3 — Hosted remote MCP can be introduced safely**

A remotely hosted MCP server can own its own callback, session store, login transaction state, and token persistence while still using Cognigy `service-api` as the authorization server.

**UC4 — MCP moves toward an OAuth 2.1-style profile**

MCP can adopt a stricter modern profile based on Authorization Code flow, PKCE, and explicit client policy while shared legacy OAuth behavior remains untouched until separately migrated.

## Functional Requirements

| ID | Requirement Description |
|----|------------------------|
| FR1 | `service-api` must support an MCP-specific OAuth policy layer that is separate from generic OAuth client handling. |
| FR2 | MCP-local and MCP-remote must be modeled as separate OAuth clients or client profiles with distinct redirect URIs and policy decisions. |
| FR3 | MCP-specific policy must enforce Authorization Code flow and PKCE for MCP clients. |
| FR4 | MCP-specific policy must validate requested MCP scopes against configured MCP-allowed scopes. |
| FR5 | The existing local MCP flow must continue to work with localhost callback handling and local token persistence. |
| FR6 | A remote MCP flow must support a hosted HTTPS callback owned by the remote MCP service instead of a localhost callback. |
| FR7 | A remote MCP flow must persist login transaction state and Cognigy token state in a server-side store owned by the hosted MCP service. |
| FR8 | Shared OAuth consumers outside MCP must keep their current behavior unless explicitly migrated. |
| FR9 | The design must allow MCP to adopt a stricter OAuth 2.1-style profile without requiring the whole shared OAuth implementation to become 2.1-only immediately. |
| FR10 | Documentation must clearly distinguish current local flow, transition architecture, and remote target architecture. |
| FR11 | If remote MCP is deployed through the existing platform, Helm values must support a dedicated service, service exposure, and Traefik ingress host/TLS configuration for the hosted MCP endpoint. |
| FR12 | Remote MCP deployment must separate non-secret environment configuration from secrets, following the existing Helm plus Fleet sealed-secret pattern. |
| FR13 | Remote MCP secret handling must cover at least OAuth client secret if used, token/session encryption material, cookie/session signing secret, and any server-side session store credentials. |

## Functional (End-to-End) Testing

### Core Tests

| Test Case ID | FR | Test Case Description |
|-------------|----|----------------------|
| TC1 | FR1, FR8 | Existing non-MCP OAuth consumers continue to authenticate successfully with no change in behavior after MCP policy isolation is introduced. |
| TC2 | FR2, FR3 | Local MCP client registered as `cognigy-mcp-local` completes Authorization Code + PKCE successfully with an allowed localhost redirect URI. |
| TC3 | FR3 | MCP token exchange fails when `code_verifier` is missing, invalid, or does not match the stored PKCE challenge. |
| TC4 | FR4 | MCP authorization fails when requesting scopes outside configured MCP allowed scopes. |
| TC5 | FR5 | Local MCP restarts and silently reuses a stored refresh token until refresh becomes invalid or expired. |
| TC6 | FR6, FR7 | Hosted remote MCP returns an auth-required response, browser login completes through Cognigy OAuth, and the remote callback resumes the waiting MCP session. |
| TC7 | FR7 | Hosted remote MCP refreshes tokens server-side and keeps session linkage intact across service restarts or instance changes. |
| TC8 | FR8 | UI password-grant compatibility paths continue working unchanged during the MCP migration period. |
| TC9 | FR9 | MCP-specific routes reject non-Authorization-Code flows even while the shared OAuth server still supports legacy flows for other consumers. |
| TC10 | FR10 | Diagrams and written docs accurately reflect the local and remote flows implemented in code. |
| TC11 | FR11 | Helm renders a dedicated remote MCP service and ingress with the expected host, TLS, and Traefik annotations. |
| TC12 | FR12, FR13 | Remote MCP secrets are supplied through existing secret management patterns and are not committed as clear-text values in Fleet manifests. |

### Unit / Component Tests

| Test Area | Description |
|-----------|-------------|
| MCP client policy resolution | Verifies client identity, redirect URI policy, PKCE requirement, and scope policy for MCP-local and MCP-remote. |
| MCP authorize wrappers | Verifies MCP-specific authorize start and completion paths call shared code correctly and reject invalid inputs. |
| Scope validation | Verifies MCP requested scopes are filtered or rejected according to configured allowed scopes. |
| Local MCP auth provider | Verifies localhost callback flow, state validation, token persistence, refresh fallback, and re-auth behavior. |
| Remote MCP session model | Verifies login transaction storage, callback correlation, session lookup, refresh, and logout cleanup. |

## UI/UX Impact

For local MCP, the user experience stays largely the same: the MCP client opens a browser, the user signs in, and future sessions reuse stored refresh tokens.

For remote MCP, the UX changes meaningfully. The MCP client no longer opens a localhost callback flow directly. Instead, the remote MCP service returns an auth-required response or login URL, the user completes browser login against a hosted flow, and the remote MCP session becomes linked to the authenticated Cognigy identity.

## Documentation

| Area | Description |
|------|-------------|
| Local vs remote sequence diagrams | Keep the current diagram updated to show separate MCP-local and MCP-remote client profiles and MCP-specific policy handling in `service-api`. |
| MCP configuration docs | Document distinct local and remote client IDs, redirect URIs, scopes, and deployment expectations. |
| Service-api auth docs | Document the MCP-specific OAuth profile boundary and state clearly that shared legacy OAuth behavior remains available for other consumers. |
| Migration notes | Describe phased rollout, compatibility expectations, and the point at which MCP is considered to be using a 2.1-style profile. |
| Helm and Fleet docs | Document the values, ingress host, TLS secret, sealed secrets, and environment wiring required to deploy hosted remote MCP. |

## Architecture

### Context

Today, MCP-specific behavior is mixed into the shared `service-api` OAuth implementation through generic helpers and client-ID checks. That is enough for the current local flow, but it is not a strong enough boundary for a remote-hosted MCP or for stricter OAuth policy.

The proposed architecture introduces an MCP-specific policy layer inside `service-api` while preserving the shared token engine. This keeps the migration incremental and limits blast radius.

### Where Changes Fit

```text
cognigy-mcp
  src/auth/
    oauthAuthProvider.ts               # local MCP public-client flow
  docs/
    MCP_OAUTH_SEQUENCE_DIAGRAM.md
    MCP_REMOTE_OAUTH_TDD.md

cognigy/services/service-api
  src/auth/oauth2/
    oauth2ApiRouter.ts                 # shared OAuth router remains
    authorizationCodeFlow.ts           # shared authorization code generation
    browserAuthorization.ts           # shared browser/login bridge
    userinfo.ts                        # shared userinfo endpoint
    mcp/
      mcpOAuthPolicy.ts                # MCP-local and MCP-remote policy
      mcpAuthorizeRouter.ts            # MCP-specific wrappers/endpoints
      validateMcpScope.ts              # MCP scope validation
      resolveMcpClientProfile.ts       # local vs remote client profile
  src/auth/utils/
    createClients.ts                   # add separate MCP-local and MCP-remote clients
    config.ts                          # add MCP-local and MCP-remote config

deployment repos
  cognigy-ai-app
    templates/                        # new remote MCP deployment/service/ingress or separate chart
    values.yaml                       # remote MCP values block
  flux-fleet-non-prod
    <cluster>/cognigy-ai/
      cognigy-ai-values.yaml          # remote MCP host and non-secret config
      secrets/*.sealed.yaml           # remote MCP secrets

hosted remote MCP service
  auth/
    loginTransactionStore              # state, PKCE, MCP session linkage
    tokenStore                         # encrypted server-side session/token store
    callback handlers                  # hosted HTTPS callback endpoints
```

### Deployment And Configuration Fit

If hosted remote MCP is served through the same platform and Traefik setup, the deployment repos are part of the architecture, not a later detail.

The current deployment pattern already provides the right primitives:

- Helm chart templates define Traefik-backed `Ingress` resources from per-service values.
- Per-environment Fleet manifests generate a `cognigy-ai-values` `ConfigMap` consumed by the Helm release.
- Environment-specific secrets are added as sealed secrets alongside the Fleet manifests.
- Service templates commonly support explicit `env`, `envFrom`, and `extraEnvVars` wiring.

That means remote MCP should be designed with a deployment model like this from the start:

- non-secret config in Helm values and Fleet-managed values files
- secret material in sealed secrets or existing-secret references
- dedicated ingress host and TLS secret for the hosted MCP endpoint
- explicit env var contract for callback URL, OAuth client metadata, session store settings, and encryption/signing keys

This also means the Helm repo likely will need changes if remote MCP is deployed in the same cluster. The only case where Helm would not change is if hosted MCP is deployed by a completely separate chart or separate platform outside this repository.

### Proposed Architecture

The migration is intentionally phased.

**Phase 1 — Isolate MCP within `service-api`**

- Introduce MCP-local and MCP-remote as distinct client identities or profiles.
- Add an MCP-specific policy resolver rather than relying on generic `isValidCognigyClient()` checks.
- Keep using the shared OAuth token/code engine underneath.
- Enforce MCP-only requirements in the MCP path:
  - Authorization Code flow only
  - PKCE required
  - exact redirect URI checks
  - MCP scope validation

**Phase 2 — Preserve and harden local MCP**

- Keep the localhost callback design for local distributions.
- Keep local token persistence in `cognigy-mcp`.
- Move documentation and policy naming from generic `cognigy-mcp` toward explicit `cognigy-mcp-local`.
- Ensure the local flow remains a public client flow.

**Phase 3 — Add hosted remote MCP**

- Introduce a hosted HTTPS callback owned by the remote MCP service.
- Add remote login transaction state owned by the remote MCP service.
- Add a server-side encrypted token/session store.
- Return auth challenge or login URL to the MCP client instead of trying to open a browser from the server.
- Add deployment values, ingress host/TLS, and sealed-secret wiring for the hosted MCP service.

**Phase 4 — MCP adopts a 2.1-style profile**

- Treat MCP-local and MCP-remote as modern Authorization Code clients.
- Keep PKCE mandatory for public clients.
- Disallow password-grant usage for MCP.
- Keep legacy password-grant support only for non-MCP consumers until they are migrated separately.
- Optionally make MCP-remote a confidential server-side client if the hosted deployment model warrants it.

### Planned Improvements

- Add dedicated MCP-specific OAuth endpoints in `service-api` so MCP policy no longer depends on shared generic routes.
- Move from client-ID branching to a formal per-client-profile policy model.
- Add remote MCP logout and revocation flows that clean up hosted server-side state.
- Add observability around MCP login transaction creation, callback completion, token refresh, and session correlation.
- Evaluate when MCP-remote should move from public PKCE client semantics to confidential-client semantics.
- Decide whether hosted MCP should live inside the existing Helm chart, as a subchart, or as a separate deployment repository with its own release lifecycle.
