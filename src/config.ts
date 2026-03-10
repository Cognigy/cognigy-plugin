/**
 * Configuration for the Cognigy MCP Server
 */
export interface Config {
  apiBaseUrl: string;
  endpointBaseUrl: string;
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

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  const apiBaseUrl = process.env.COGNIGY_API_BASE_URL;
  const apiKey = process.env.COGNIGY_API_KEY;

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

  return {
    apiBaseUrl: normalizedApiBaseUrl,
    endpointBaseUrl,
    webchatBaseUrl,
    apiKey,
    serverName: process.env.MCP_SERVER_NAME || 'cognigy-api-mcp',
    serverVersion: process.env.MCP_SERVER_VERSION || '2.0.0',
    logLevel: (process.env.LOG_LEVEL as Config['logLevel']) || 'info',
    rateLimit: {
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    },
  };
}

