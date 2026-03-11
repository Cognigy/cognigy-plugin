/**
 * Configuration for the Cognigy MCP Server
 */
import type { OAuthProviderConfig } from './auth/oauthAuthProvider.js';

export type AuthMode = 'api-key' | 'oauth' | 'both';

export interface Config {
  apiBaseUrl: string;
  endpointBaseUrl: string;
  authMode: AuthMode;
  apiKey?: string;
  oauth?: OAuthProviderConfig;
  serverName: string;
  serverVersion: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  rateLimit: {
    maxRequests: number;
    windowMs: number;
  };
}

/**
 * Derive the endpoint base URL from the API base URL.
 * Pattern: https://api-{env}.cognigy.ai -> https://endpoint-{env}.cognigy.ai
 */
function deriveEndpointBaseUrl(apiBaseUrl: string): string {
  try {
    const url = new URL(apiBaseUrl);
    const match = url.hostname.match(/^api-(.+)$/);
    if (match) {
      return `${url.protocol}//endpoint-${match[1]}`;
    }
  } catch {
    // fall through
  }
  return apiBaseUrl.replace(/\/api-/, '/endpoint-');
}

/**
 * Normalize optional values and ignore unresolved manifest placeholders.
 */
function normalizeOptionalEnv(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized || /^\$\{.+\}$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  const apiBaseUrl = process.env.COGNIGY_API_BASE_URL;
  const apiKey = process.env.COGNIGY_API_KEY;
  const authMode = (process.env.COGNIGY_AUTH_MODE as AuthMode | undefined) || (apiKey ? 'api-key' : 'oauth');

  if (!apiBaseUrl) {
    throw new Error('COGNIGY_API_BASE_URL environment variable is required');
  }

  const endpointBaseUrl =
    process.env.COGNIGY_ENDPOINT_BASE_URL || deriveEndpointBaseUrl(apiBaseUrl);

  const oauthIssuerBaseUrl =
    process.env.COGNIGY_OAUTH_ISSUER_BASE_URL || apiBaseUrl;
  const oauthClientId = normalizeOptionalEnv(process.env.COGNIGY_OAUTH_CLIENT_ID);
  const oauthRedirectUri = normalizeOptionalEnv(process.env.COGNIGY_OAUTH_REDIRECT_URI);
  const oauthScopes = (process.env.COGNIGY_OAUTH_SCOPES || 'mcp:access')
    .split(' ')
    .map((scope) => scope.trim())
    .filter(Boolean);

  const oauth =
    oauthClientId && oauthRedirectUri
      ? {
          issuerBaseUrl: oauthIssuerBaseUrl,
          clientId: oauthClientId,
          redirectUri: oauthRedirectUri,
          scopes: oauthScopes,
          organizationId: normalizeOptionalEnv(process.env.COGNIGY_ORGANISATION_ID),
          accessToken: normalizeOptionalEnv(process.env.COGNIGY_OAUTH_ACCESS_TOKEN),
          refreshToken: normalizeOptionalEnv(process.env.COGNIGY_OAUTH_REFRESH_TOKEN),
          sessionFilePath: normalizeOptionalEnv(process.env.COGNIGY_OAUTH_SESSION_FILE),
        }
      : undefined;

  if ((authMode === 'api-key' || authMode === 'both') && !apiKey && !oauth) {
    throw new Error('COGNIGY_API_KEY environment variable is required unless OAuth is configured');
  }

  if (authMode === 'oauth' && !oauth) {
    throw new Error(
      'COGNIGY_OAUTH_CLIENT_ID and COGNIGY_OAUTH_REDIRECT_URI are required when COGNIGY_AUTH_MODE=oauth'
    );
  }

  return {
    apiBaseUrl,
    endpointBaseUrl,
    authMode,
    apiKey,
    oauth,
    serverName: process.env.MCP_SERVER_NAME || 'cognigy-api-mcp',
    serverVersion: process.env.MCP_SERVER_VERSION || '1.0.0',
    logLevel: (process.env.LOG_LEVEL as Config['logLevel']) || 'info',
    rateLimit: {
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    },
  };
}
