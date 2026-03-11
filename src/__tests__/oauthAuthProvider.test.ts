import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OAuthAuthProvider, type OAuthProviderConfig } from '../auth/oauthAuthProvider.js';
import { resolveOAuthSessionFilePath } from '../auth/oauthTokenStore.js';

const ORIGINAL_ENV = process.env;

function createConfig(overrides: Partial<OAuthProviderConfig> = {}): OAuthProviderConfig {
  return {
    issuerBaseUrl: 'https://api.example.ai',
    clientId: 'cognigy-mcp',
    redirectUri: 'http://127.0.0.1:8789/oauth/callback',
    scopes: ['mcp:access'],
    organizationId: 'org-1',
    ...overrides,
  };
}

describe('OAuthAuthProvider persistence', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cognigy-mcp-provider-'));
    process.env = {
      ...ORIGINAL_ENV,
      COGNIGY_OAUTH_SESSION_FILE: path.join(tempDir, 'oauth-sessions.json'),
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  it('refreshes a persisted session without triggering interactive login', async () => {
    const bootstrapProvider = new OAuthAuthProvider(
      createConfig({
        accessToken: 'expired-access-token',
        refreshToken: 'persisted-refresh-token',
      })
    );
    await (bootstrapProvider as any).tokenStore.save({
      accessToken: 'expired-access-token',
      refreshToken: 'persisted-refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() - 1_000,
    });

    const provider = new OAuthAuthProvider(createConfig());
    const refreshTokenSpy = jest
      .spyOn(provider as any, 'refreshToken')
      .mockResolvedValue({
        accessToken: 'fresh-access-token',
        refreshToken: 'persisted-refresh-token',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 60_000,
      });
    const interactiveSpy = jest
      .spyOn(provider as any, 'authorizeInteractive')
      .mockRejectedValue(new Error('interactive login should not run'));
    jest.spyOn(provider as any, 'fetchUserinfo').mockResolvedValue({
      sub: 'user-1',
      organisationId: 'org-1',
      scope: 'mcp:access',
      clientId: 'cognigy-mcp',
    });

    const principal = await provider.getPrincipal();

    expect(refreshTokenSpy).toHaveBeenCalledWith('persisted-refresh-token');
    expect(interactiveSpy).not.toHaveBeenCalled();
    expect(principal?.id).toBe('user-1');
  });

  it('clears a stale stored session and falls back to interactive login', async () => {
    const bootstrapProvider = new OAuthAuthProvider(
      createConfig({
        accessToken: 'expired-access-token',
        refreshToken: 'stale-refresh-token',
      })
    );
    await (bootstrapProvider as any).tokenStore.save({
      accessToken: 'expired-access-token',
      refreshToken: 'stale-refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() - 1_000,
    });

    const provider = new OAuthAuthProvider(createConfig());
    jest.spyOn(provider as any, 'refreshToken').mockRejectedValue(new Error('invalid_grant'));
    const interactiveSpy = jest
      .spyOn(provider as any, 'authorizeInteractive')
      .mockResolvedValue({
        accessToken: 'interactive-access-token',
        refreshToken: 'interactive-refresh-token',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 60_000,
      });
    jest.spyOn(provider as any, 'fetchUserinfo').mockResolvedValue({
      sub: 'user-1',
      organisationId: 'org-1',
      scope: 'mcp:access',
      clientId: 'cognigy-mcp',
    });

    const principal = await provider.getPrincipal();
    const sessionFile = JSON.parse(await readFile(resolveOAuthSessionFilePath(), 'utf8')) as {
      sessions: Record<string, { refreshToken: string }>;
    };
    const storedSessions = Object.values(sessionFile.sessions);

    expect(interactiveSpy).toHaveBeenCalled();
    expect(principal?.id).toBe('user-1');
    expect(storedSessions).toHaveLength(1);
    expect(storedSessions[0]?.refreshToken).toBe('interactive-refresh-token');
  });
});
