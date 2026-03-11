import { afterEach, describe, expect, it } from '@jest/globals';
import { loadConfig } from '../config.js';

const ORIGINAL_ENV = process.env;

describe('loadConfig', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
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
});
