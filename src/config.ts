/**
 * Configuration for the Cognigy MCP Server
 */
import type { OAuthProviderConfig } from './auth/oauthAuthProvider.js';

export type AuthMode = 'api-key' | 'oauth' | 'both';

export interface Config {
  apiBaseUrl: string;
  endpointBaseUrl: string;
  authMode: AuthMode;
  oauth?: OAuthProviderConfig;
  webchatBaseUrl: string;
  apiKey: string;
  serverName: string;
  serverVersion: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  rateLimit: {
    maxRequests: number;
    windowMs: number;
  };
}

/**
 * Normalise the API base URL so it always points to the API host.
 * Users may supply the bare UI URL (e.g. https://dev.cognigy.ai) instead of the
 * API URL (https://api-dev.cognigy.ai).  We detect this and prepend "api-".
 */
function normalizeApiBaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!url.hostname.startsWith('api-') && url.hostname.endsWith('.cognigy.ai')) {
      url.hostname = `api-${url.hostname}`;
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    // fall through
  }
  return raw.replace(/\/+$/, '');
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


/*
 * Derive the webchat demo base URL from the API base URL.
 * Pattern: https://api-{env}.cognigy.ai -> https://webchat-{env}.cognigy.ai
 */
function deriveWebchatBaseUrl(apiBaseUrl: string): string {
  try {
    const url = new URL(apiBaseUrl);
    const match = url.hostname.match(/^api-(.+)$/);
    if (match) {
      return `${url.protocol}//webchat-${match[1]}`;
    }
  } catch {
    // fall through
  }
  return apiBaseUrl.replace(/\/api-/, '/webchat-');
}

const VALID_LOG_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error']);

function parseIntWithDefault(envVar: string | undefined, defaultValue: number): number {
  if (!envVar) return defaultValue;
  const parsed = parseInt(envVar, 10);
  if (Number.isNaN(parsed)) {
    console.error(`[config] Invalid integer "${envVar}", using default ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
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

  if (!apiKey) {
    throw new Error('COGNIGY_API_KEY environment variable is required');
  }

  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);

  const endpointBaseUrl =
    process.env.COGNIGY_ENDPOINT_BASE_URL || deriveEndpointBaseUrl(normalizedApiBaseUrl);

  const webchatBaseUrl =
    process.env.COGNIGY_WEBCHAT_BASE_URL || deriveWebchatBaseUrl(normalizedApiBaseUrl);

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
    apiBaseUrl: normalizedApiBaseUrl,
    endpointBaseUrl,
    authMode,
    webchatBaseUrl,
    apiKey,
    oauth,
    serverName: process.env.MCP_SERVER_NAME || 'cognigy-api-mcp',
    serverVersion: process.env.MCP_SERVER_VERSION || '2.0.0',
    logLevel: (() => {
      const raw = process.env.LOG_LEVEL || 'info';
      if (!VALID_LOG_LEVELS.has(raw)) {
        console.error(`[config] Invalid LOG_LEVEL "${raw}", falling back to "info"`);
        return 'info' as Config['logLevel'];
      }
      return raw as Config['logLevel'];
    })(),
    rateLimit: {
      maxRequests: parseIntWithDefault(process.env.RATE_LIMIT_MAX_REQUESTS, 100),
      windowMs: parseIntWithDefault(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    },
  };
}
