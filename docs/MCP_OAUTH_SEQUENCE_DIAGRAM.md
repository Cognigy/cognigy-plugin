# Cognigy MCP OAuth Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant M as cognigy-mcp
    participant B as Browser
    participant UI as service-ui
    participant API as service-api

    Note over M: First real API-backed usage triggers OAuth
    Note over API: MCP-local requests are handled through an MCP-specific OAuth policy/profile inside service-api
    M->>M: Load persisted session if available
    M->>M: Reuse valid token or decide interactive login is required
    M->>M: Generate PKCE values<br/>code_verifier, code_challenge, state
    M->>M: Start local callback server<br/>127.0.0.1:8789/oauth/callback
    M->>M: Wait for server listening before opening browser

    M->>B: Open /auth/oauth2/authorize<br/>client_id=cognigy-mcp-local<br/>redirect_uri=localhost callback<br/>code_challenge + state
    B->>API: GET /auth/oauth2/authorize
    API->>API: Resolve MCP-local client policy
    API->>API: Validate client_id + redirect_uri + PKCE policy
    API->>API: Store oauthBrowserAuthorization in session
    API-->>B: 302 to /login?oauth_authorize=true
    B->>UI: GET /login?oauth_authorize=true

    U->>UI: Enter username/password
    UI->>API: POST /auth/oauth2/authorize<br/>username + password + PKCE
    API->>API: Validate user credentials
    API->>API: Generate UI authorization code
    API-->>UI: Return code + redirect_uri

    UI->>API: POST /auth/oauth2/token<br/>UI client_id + client_secret + code_verifier
    API->>API: Exchange UI auth code for tokens
    API-->>UI: UI access_token + refresh_token

    UI->>API: POST /auth/oauth2/authorize/complete<br/>Bearer UI access token<br/>Session cookie
    API->>API: Resolve authenticated user from bearer token
    API->>API: Load stored oauthBrowserAuthorization from session
    API->>API: Generate MCP-local authorization code
    API->>API: Bind stored PKCE challenge to code
    API-->>UI: Return MCP code + redirect_uri + state

    UI-->>B: Redirect to localhost callback<br/>?code=...&state=...
    B->>M: GET /oauth/callback?code=...&state=...
    M->>M: Validate returned state

    M->>API: POST /auth/oauth2/token<br/>client_id=cognigy-mcp-local<br/>code + redirect_uri + code_verifier
    API->>API: Resolve MCP-local client policy
    API->>API: Validate auth code + PKCE
    API-->>M: MCP access_token + refresh_token

    M->>API: GET /auth/oauth2/userinfo<br/>Bearer MCP access token
    API-->>M: Authenticated user profile

    M->>M: Store token state in memory
    M->>M: Persist access/refresh token to local session file
    M->>M: Cache authenticated principal
    M->>API: Use Bearer token on later API calls
    API-->>M: Protected API responses
    M->>M: Refresh access token later with refresh token when needed
```

## Notes

- `service-api` is the OAuth authorization server and token issuer.
- `service-ui` is the browser login surface and OAuth flow helper.
- `cognigy-mcp-local` is the local MCP public PKCE client and does not use a client secret.
- In the target architecture, MCP requests are routed through an MCP-specific OAuth profile/policy layer inside `service-api`, while the shared token engine remains reusable for other consumers.
- The `authorize/complete` step requires both:
  - a bearer token to identify the authenticated user
  - a browser session cookie to recover the stored OAuth authorize request

## Hosted Remote MCP Variant

If `cognigy-mcp` is hosted remotely, the OAuth owner changes from "the MCP process on the user's machine" to "the hosted MCP service".

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as MCP Client
    participant RM as Hosted cognigy-mcp
    participant B as Browser
    participant UI as service-ui
    participant API as service-api
    participant S as Remote Session Store

    C->>RM: Connect to remote MCP server
    RM->>S: Load linked Cognigy session for this user/client
    RM->>RM: Detect missing or expired Cognigy tokens
    RM->>RM: Generate login transaction + state
    RM->>S: Persist transaction state + PKCE/session metadata
    RM-->>C: Return auth-required response + hosted login URL

    U->>B: Open hosted login URL
    B->>RM: GET /oauth/start?transaction=...
    RM->>RM: Resolve stored login transaction
    RM->>B: Redirect to /auth/oauth2/authorize<br/>client_id=cognigy-mcp-remote<br/>redirect_uri=https callback<br/>state + PKCE

    B->>API: GET /auth/oauth2/authorize
    API->>API: Resolve MCP-remote client policy
    API->>API: Validate client_id + redirect_uri + PKCE/policy
    API->>API: Store oauthBrowserAuthorization in session
    API-->>B: 302 to /login?oauth_authorize=true
    B->>UI: GET /login?oauth_authorize=true

    U->>UI: Enter username/password
    UI->>API: POST /auth/oauth2/authorize<br/>username + password + PKCE
    API->>API: Validate user credentials
    API->>API: Generate UI authorization code
    API-->>UI: Return code + redirect_uri

    UI->>API: POST /auth/oauth2/token<br/>UI client_id + client_secret + code_verifier
    API->>API: Exchange UI auth code for tokens
    API-->>UI: UI access_token + refresh_token

    UI->>API: POST /auth/oauth2/authorize/complete<br/>Bearer UI access token<br/>Session cookie
    API->>API: Resolve authenticated user from bearer token
    API->>API: Load stored oauthBrowserAuthorization from session
    API->>API: Generate MCP-remote authorization code
    API-->>UI: Return remote-MCP code + redirect_uri + state

    UI-->>B: Redirect to hosted MCP callback<br/>?code=...&state=...
    B->>RM: GET /oauth/callback?code=...&state=...
    RM->>S: Load transaction state
    RM->>RM: Validate returned state

    RM->>API: POST /auth/oauth2/token<br/>client_id=cognigy-mcp-remote<br/>code + redirect_uri + code_verifier
    API->>API: Resolve MCP-remote client policy
    API->>API: Validate auth code + PKCE
    API-->>RM: MCP access_token + refresh_token

    RM->>API: GET /auth/oauth2/userinfo<br/>Bearer MCP access token
    API-->>RM: Authenticated user profile
    RM->>S: Persist tokens + principal + session linkage
    RM-->>B: Show login complete page
    B-->>U: Browser flow finished

    C->>RM: Retry or continue MCP request
    RM->>S: Load stored tokens
    RM->>API: Use Bearer token on later API calls
    API-->>RM: Protected API responses
    RM->>API: Refresh later with refresh token when needed
    RM->>S: Update stored token state
```

## Key Differences For Hosted Remote MCP

1. Callback ownership
   - Local today: browser redirects to `127.0.0.1:8789/oauth/callback`.
   - Remote: browser redirects to a hosted HTTPS endpoint owned by the remote MCP service.

2. Browser launch
   - Local today: `cognigy-mcp` opens the browser itself.
   - Remote: the MCP client receives an auth-required response and the user opens the hosted login URL.

3. Token storage
   - Local today: access and refresh tokens are stored in a local per-user session file.
   - Remote: tokens must be stored server-side in an encrypted shared store.

4. Session correlation
   - Local today: the same local process owns PKCE values, callback handling, and token exchange.
   - Remote: the hosted MCP service must persist transaction state so the browser login can be linked back to the right remote MCP session.

5. Runtime model
   - Local today: mostly single-user process state plus local disk persistence.
   - Remote: multi-user, multi-instance service with shared session/token storage and refresh coordination.

6. Client identity and policy
   - Local today: one local MCP public client profile is used for localhost callbacks.
   - Remote: hosted MCP should use a distinct remote client profile so redirect URI, scope, and future confidential-client policy can evolve independently.

## MCP Responsibilities

`cognigy-mcp` is active in multiple phases of the flow:

1. Before browser login
   - decides whether a persisted session can be reused
   - generates `state`, `code_verifier`, and `code_challenge`
   - starts the localhost callback server

2. During browser login
   - waits for the browser callback on the configured redirect URI
   - validates that the returned `state` matches the original request

3. After browser login
   - exchanges the authorization code for access and refresh tokens
   - fetches `userinfo`
   - stores tokens locally for reuse

4. On later prompts
   - sends bearer tokens on protected requests
   - refreshes the access token silently when possible
   - falls back to interactive login only when refresh or reuse is no longer possible

## Responsibility Shift In A Remote Deployment

When `cognigy-mcp` is hosted remotely, these responsibilities move:

- Local callback server -> hosted HTTPS callback endpoint on the remote MCP service
- local token file -> server-side token/session store
- local in-process PKCE state -> persisted login transaction owned by the remote MCP service
- "open the browser now" behavior -> auth challenge or login URL returned to the MCP client
- single local user session -> multi-tenant session linkage between MCP client, browser login, and Cognigy identity
- shared generic client checks -> MCP-specific client policy for `cognigy-mcp-local` and `cognigy-mcp-remote`
