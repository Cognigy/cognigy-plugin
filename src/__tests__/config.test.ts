import { afterEach, describe, expect,beforeEach, it } from '@jest/globals';
import { loadConfig } from '../config.js';

const ORIGINAL_ENV = process.env;

describe('loadConfig', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it('loads API key auth by default when an API key is provided', () => {
    process.env = {
      ...ORIGINAL_ENV,
      COGNIGY_API_BASE_URL: 'https://api.example.ai',
      COGNIGY_API_KEY: 'secret-key',
    };

    const config = loadConfig();

    expect(config.authMode).toBe('api-key');
    expect(config.apiKey).toBe('secret-key');
    expect(config.oauth).toBeUndefined();
  });

  it('loads OAuth configuration when auth mode is oauth', () => {
    process.env = {
      ...ORIGINAL_ENV,
      COGNIGY_API_BASE_URL: 'https://api.example.ai',
      COGNIGY_AUTH_MODE: 'oauth',
      COGNIGY_OAUTH_CLIENT_ID: 'cognigy-mcp',
      COGNIGY_OAUTH_REDIRECT_URI: 'http://127.0.0.1:8789/oauth/callback',
      COGNIGY_OAUTH_SCOPES: 'mcp:access profile',
    };

    const config = loadConfig();

    expect(config.authMode).toBe('oauth');
    expect(config.oauth).toEqual({
      issuerBaseUrl: 'https://api.example.ai',
      clientId: 'cognigy-mcp',
      redirectUri: 'http://127.0.0.1:8789/oauth/callback',
      scopes: ['mcp:access', 'profile'],
      organizationId: undefined,
      accessToken: undefined,
      refreshToken: undefined,
      sessionFilePath: undefined,
    });
  });

  it('ignores unresolved manifest placeholders for optional oauth fields', () => {
    process.env = {
      ...ORIGINAL_ENV,
      COGNIGY_API_BASE_URL: 'https://api.example.ai',
      COGNIGY_AUTH_MODE: 'oauth',
      COGNIGY_OAUTH_CLIENT_ID: 'cognigy-mcp',
      COGNIGY_OAUTH_REDIRECT_URI: 'http://127.0.0.1:8789/oauth/callback',
      COGNIGY_ORGANISATION_ID: '${user_config.cognigy_organisation_id}',
    };

    const config = loadConfig();

    expect(config.oauth?.organizationId).toBeUndefined();
  });

  it('loads an optional oauth session file override', () => {
    process.env = {
      ...ORIGINAL_ENV,
      COGNIGY_API_BASE_URL: 'https://api.example.ai',
      COGNIGY_AUTH_MODE: 'oauth',
      COGNIGY_OAUTH_CLIENT_ID: 'cognigy-mcp',
      COGNIGY_OAUTH_REDIRECT_URI: 'http://127.0.0.1:8789/oauth/callback',
      COGNIGY_OAUTH_SESSION_FILE: '/tmp/cognigy-oauth-sessions.json',
    };

    const config = loadConfig();

    expect(config.oauth?.sessionFilePath).toBe('/tmp/cognigy-oauth-sessions.json');
  });

  it('throws when oauth mode is missing required redirect config', () => {
    process.env = {
      ...ORIGINAL_ENV,
      COGNIGY_API_BASE_URL: 'https://api.example.ai',
      COGNIGY_AUTH_MODE: 'oauth',
      COGNIGY_OAUTH_CLIENT_ID: 'cognigy-mcp',
    };

    expect(() => loadConfig()).toThrow(
      'COGNIGY_OAUTH_CLIENT_ID and COGNIGY_OAUTH_REDIRECT_URI are required when COGNIGY_AUTH_MODE=oauth'
    );
  });
  it('throws when COGNIGY_API_BASE_URL is missing', () => {
    delete process.env.COGNIGY_API_BASE_URL;
    process.env.COGNIGY_API_KEY = 'test-key';
    expect(() => loadConfig()).toThrow('COGNIGY_API_BASE_URL environment variable is required');
  });

  it('throws when COGNIGY_API_KEY is missing', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai';
    delete process.env.COGNIGY_API_KEY;
    expect(() => loadConfig()).toThrow('COGNIGY_API_KEY environment variable is required');
  });

  it('normalizes bare UI URL to API URL', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://dev.cognigy.ai';
    process.env.COGNIGY_API_KEY = 'test-key';
    const config = loadConfig();
    expect(config.apiBaseUrl).toBe('https://api-dev.cognigy.ai');
  });

  it('keeps already-correct API URL unchanged', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai';
    process.env.COGNIGY_API_KEY = 'test-key';
    const config = loadConfig();
    expect(config.apiBaseUrl).toBe('https://api-trial.cognigy.ai');
  });

  it('strips trailing slashes from API URL', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai///';
    process.env.COGNIGY_API_KEY = 'test-key';
    const config = loadConfig();
    expect(config.apiBaseUrl).toBe('https://api-trial.cognigy.ai');
  });

  it('derives endpoint URL from API URL', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai';
    process.env.COGNIGY_API_KEY = 'test-key';
    const config = loadConfig();
    expect(config.endpointBaseUrl).toBe('https://endpoint-trial.cognigy.ai');
  });

  it('derives webchat URL from API URL', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai';
    process.env.COGNIGY_API_KEY = 'test-key';
    const config = loadConfig();
    expect(config.webchatBaseUrl).toBe('https://webchat-trial.cognigy.ai');
  });

  it('uses explicit COGNIGY_ENDPOINT_BASE_URL if provided', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai';
    process.env.COGNIGY_API_KEY = 'test-key';
    process.env.COGNIGY_ENDPOINT_BASE_URL = 'https://custom-endpoint.example.com';
    const config = loadConfig();
    expect(config.endpointBaseUrl).toBe('https://custom-endpoint.example.com');
  });

  it('uses explicit COGNIGY_WEBCHAT_BASE_URL if provided', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai';
    process.env.COGNIGY_API_KEY = 'test-key';
    process.env.COGNIGY_WEBCHAT_BASE_URL = 'https://custom-webchat.example.com';
    const config = loadConfig();
    expect(config.webchatBaseUrl).toBe('https://custom-webchat.example.com');
  });

  it('defaults serverName to cognigy-api-mcp', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai';
    process.env.COGNIGY_API_KEY = 'test-key';
    delete process.env.MCP_SERVER_NAME;
    const config = loadConfig();
    expect(config.serverName).toBe('cognigy-api-mcp');
  });

  it('uses custom MCP_SERVER_NAME if provided', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai';
    process.env.COGNIGY_API_KEY = 'test-key';
    process.env.MCP_SERVER_NAME = 'my-custom-server';
    const config = loadConfig();
    expect(config.serverName).toBe('my-custom-server');
  });

  it('defaults logLevel to info', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai';
    process.env.COGNIGY_API_KEY = 'test-key';
    delete process.env.LOG_LEVEL;
    const config = loadConfig();
    expect(config.logLevel).toBe('info');
  });

  it.each(['debug', 'warn', 'error'] as const)('accepts valid log level: %s', (level) => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai';
    process.env.COGNIGY_API_KEY = 'test-key';
    process.env.LOG_LEVEL = level;
    const config = loadConfig();
    expect(config.logLevel).toBe(level);
  });

  it('falls back to info for invalid LOG_LEVEL', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai';
    process.env.COGNIGY_API_KEY = 'test-key';
    process.env.LOG_LEVEL = 'verbose';
    const config = loadConfig();
    expect(config.logLevel).toBe('info');
  });

  it('parses RATE_LIMIT_MAX_REQUESTS correctly', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai';
    process.env.COGNIGY_API_KEY = 'test-key';
    process.env.RATE_LIMIT_MAX_REQUESTS = '50';
    const config = loadConfig();
    expect(config.rateLimit.maxRequests).toBe(50);
  });

  it('defaults rate limit values when env vars not set', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai';
    process.env.COGNIGY_API_KEY = 'test-key';
    delete process.env.RATE_LIMIT_MAX_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_MS;
    const config = loadConfig();
    expect(config.rateLimit.maxRequests).toBe(100);
    expect(config.rateLimit.windowMs).toBe(60000);
  });

  it('falls back to defaults for non-numeric rate limit values', () => {
    process.env.COGNIGY_API_BASE_URL = 'https://api-trial.cognigy.ai';
    process.env.COGNIGY_API_KEY = 'test-key';
    process.env.RATE_LIMIT_MAX_REQUESTS = 'not-a-number';
    process.env.RATE_LIMIT_WINDOW_MS = 'abc';
    const config = loadConfig();
    expect(config.rateLimit.maxRequests).toBe(100);
    expect(config.rateLimit.windowMs).toBe(60000);
  });
});
