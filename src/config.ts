/**
 * Configuration for the Cognigy MCP Server
 */
export interface Config {
  apiBaseUrl: string;
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

  return {
    apiBaseUrl,
    apiKey,
    serverName: process.env.MCP_SERVER_NAME || 'cognigy-api-mcp',
    serverVersion: process.env.MCP_SERVER_VERSION || '1.0.0',
    logLevel: (process.env.LOG_LEVEL as Config['logLevel']) || 'info',
    rateLimit: {
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    },
  };
}

