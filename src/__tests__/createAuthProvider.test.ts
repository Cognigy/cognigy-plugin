import { describe, expect, it } from '@jest/globals';
import { createAuthProvider } from '../auth/createAuthProvider.js';
import type { Config } from '../config.js';
import { ApiKeyAuthProvider } from '../auth/apiKeyAuthProvider.js';
import { OAuthAuthProvider } from '../auth/oauthAuthProvider.js';

function baseConfig(): Config {
  return {
    apiBaseUrl: 'https://api.example.ai',
    endpointBaseUrl: 'https://endpoint.example.ai',
    authMode: 'api-key',
    apiKey: 'secret-key',
    serverName: 'cognigy-mcp',
    serverVersion: '1.0.0',
    logLevel: 'info',
    rateLimit: {
      maxRequests: 100,
      windowMs: 60_000,
    },
  };
}

describe('createAuthProvider', () => {
  it('creates an API key provider', () => {
    const provider = createAuthProvider(baseConfig());
    expect(provider).toBeInstanceOf(ApiKeyAuthProvider);
  });

  it('creates an OAuth provider when oauth mode is selected', () => {
    const provider = createAuthProvider({
      ...baseConfig(),
      authMode: 'oauth',
      apiKey: undefined,
      oauth: {
        issuerBaseUrl: 'https://api.example.ai',
        clientId: 'cognigy-mcp',
        redirectUri: 'http://127.0.0.1:8789/oauth/callback',
        scopes: ['mcp:access'],
      },
    });

    expect(provider).toBeInstanceOf(OAuthAuthProvider);
  });

  it('prefers OAuth in compatibility mode when oauth config exists', () => {
    const provider = createAuthProvider({
      ...baseConfig(),
      authMode: 'both',
      oauth: {
        issuerBaseUrl: 'https://api.example.ai',
        clientId: 'cognigy-mcp',
        redirectUri: 'http://127.0.0.1:8789/oauth/callback',
        scopes: ['mcp:access'],
      },
    });

    expect(provider).toBeInstanceOf(OAuthAuthProvider);
  });
});
