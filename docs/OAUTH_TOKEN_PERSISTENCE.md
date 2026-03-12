# OAuth Token Persistence

## Summary

`cognigy-mcp` now persists OAuth token state for current local runtimes such as:

- `npx @cognigy/mcp-server`
- local `node dist/index.js`
- `.mcpb`-installed local MCP processes

The goal is to avoid forcing the user to authenticate again every time the local MCP process restarts.

This change is intentionally scoped to `cognigy-mcp` only. It does not change `service-api`, shared OAuth server behavior, token lifetimes, or any other Cognigy OAuth client.

## What Was Implemented

### 1. Local token store

A new file-backed token store was added in:

- [src/auth/oauthTokenStore.ts](/Users/<$HOME>/Desktop/work/cognigy-mcp/src/auth/oauthTokenStore.ts)

It stores:

- `accessToken`
- `refreshToken`
- `tokenType`
- `expiresAt`
- `createdAt`
- `updatedAt`
- session metadata used for isolation

The store is keyed by:

- `issuerBaseUrl`
- `clientId`
- `redirectUri`
- `organizationId`

This prevents collisions between different Cognigy environments or orgs on the same machine.

### 2. Provider integration

The OAuth provider was updated in:

- [src/auth/oauthAuthProvider.ts](/Users/<$HOME>/Desktop/work/cognigy-mcp/src/auth/oauthAuthProvider.ts)

Behavior now:

1. On startup, the provider attempts to load a persisted session.
2. If the stored access token is still valid, it is reused.
3. If the access token is expired but a refresh token exists, the provider refreshes silently.
4. If refresh succeeds, the updated token state is written back to disk.
5. If refresh fails, the stored session is cleared and interactive browser login starts again.

The localhost PKCE callback flow itself was not changed.

### 3. Config support

An optional session-file override was added in:

- [src/config.ts](/Users/<$HOME>/Desktop/work/cognigy-mcp/src/config.ts)
- [env.template](/Users/<$HOME>/Desktop/work/cognigy-mcp/env.template)

Optional env var:

- `COGNIGY_OAUTH_SESSION_FILE`

This is primarily for tests and local debugging. Normal usage should rely on the default platform path.

## Storage Location

Default session file path is platform-specific:

- macOS: `~/Library/Application Support/cognigy-mcp/oauth-sessions.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/cognigy-mcp/oauth-sessions.json`
- Windows: `%APPDATA%/cognigy-mcp/oauth-sessions.json`

On Unix-like systems, the file is written with restrictive permissions (`0600`).

## Runtime Flow

### First login

1. MCP starts.
2. No persisted session is found.
3. Browser-based Authorization Code + PKCE login runs.
4. Access token and refresh token are received.
5. Token state is persisted locally.

### Later restart

1. MCP starts again.
2. Persisted token state is loaded.
3. If access token is still valid, MCP uses it directly.
4. If access token is expired, MCP uses the refresh token to get a new access token.
5. New token state is persisted again.

### Failure path

If the refresh token is expired, revoked, invalid, or otherwise unusable:

1. The stored session entry is cleared.
2. MCP falls back to interactive browser login.
3. A fresh session is stored after successful login.

## Lifetime Behavior

Persistence does not extend token lifetime by itself. It only allows reuse across local restarts.

Actual lifetime still depends on `service-api`:

- access token default: 15 minutes
- refresh token default for current MCP flow: usually 7 days because `rememberMe=true` is sent

Reauthentication can still happen earlier if:

- the refresh token is revoked
- the refresh token expires
- the user is disabled or logged out
- token records are removed server-side
- token-limit policy evicts older refresh tokens

## Tests Added

Tests were added in:

- [src/__tests__/oauthTokenStore.test.ts](/Users/<$HOME>/Desktop/work/cognigy-mcp/src/__tests__/oauthTokenStore.test.ts)
- [src/__tests__/oauthAuthProvider.test.ts](/Users/<$HOME>/Desktop/work/cognigy-mcp/src/__tests__/oauthAuthProvider.test.ts)
- [src/__tests__/config.test.ts](/Users/<$HOME>/Desktop/work/cognigy-mcp/src/__tests__/config.test.ts)

They cover:

- persisting and reloading token state
- isolating sessions across multiple environments
- clearing only the affected session entry
- silent refresh from persisted refresh token
- fallback to browser auth when stored refresh fails
- config loading for the optional session-file override

## Non-Goals

This implementation does not handle:

- hosted/remote MCP deployments
- mobile-specific secure storage
- OS keychain integration
- `service-api` OAuth changes
- changes to token TTL policy

If MCP is hosted remotely in the future, the auth flow will need a different callback/session model and a server-side token store rather than the local file approach used here.
