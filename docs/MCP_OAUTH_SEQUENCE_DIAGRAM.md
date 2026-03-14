# Cognigy MCP OAuth Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant M as cognigy-mcp
    participant B as Browser
    participant UI as service-ui
    participant API as service-api

    Note over M: Generate PKCE values<br/>code_verifier, code_challenge, state
    Note over M: Start local callback server<br/>127.0.0.1:8789/oauth/callback

    M->>B: Open /auth/oauth2/authorize<br/>client_id=cognigy-mcp<br/>redirect_uri=localhost callback<br/>code_challenge + state
    B->>API: GET /auth/oauth2/authorize
    API->>API: Validate client_id + redirect_uri
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
    API->>API: Generate MCP authorization code
    API->>API: Bind stored PKCE challenge to code
    API-->>UI: Return MCP code + redirect_uri + state

    UI-->>B: Redirect to localhost callback<br/>?code=...&state=...
    B->>M: GET /oauth/callback?code=...&state=...
    M->>M: Validate returned state

    M->>API: POST /auth/oauth2/token<br/>client_id=cognigy-mcp<br/>code + redirect_uri + code_verifier
    API->>API: Validate auth code + PKCE
    API-->>M: MCP access_token + refresh_token

    M->>API: GET /auth/oauth2/userinfo<br/>Bearer MCP access token
    API-->>M: Authenticated user profile

    Note over M: Store tokens in memory + local session file
    Note over M: Use Bearer token on later API calls
```

## Notes

- `service-api` is the OAuth authorization server and token issuer.
- `service-ui` is the browser login surface and OAuth flow helper.
- `cognigy-mcp` is a public PKCE client and does not use a client secret.
- The `authorize/complete` step requires both:
  - a bearer token to identify the authenticated user
  - a browser session cookie to recover the stored OAuth authorize request
