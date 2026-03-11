import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  FileTokenStore,
  createOAuthSessionKey,
  resolveOAuthSessionFilePath,
  type OAuthSessionScope,
} from '../auth/oauthTokenStore.js';

const ORIGINAL_ENV = process.env;

function createScope(overrides: Partial<OAuthSessionScope> = {}): OAuthSessionScope {
  return {
    issuerBaseUrl: 'https://api.example.ai',
    clientId: 'cognigy-mcp',
    redirectUri: 'http://127.0.0.1:8789/oauth/callback',
    organizationId: 'org-1',
    ...overrides,
  };
}

describe('oauthTokenStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cognigy-mcp-oauth-'));
    process.env = {
      ...ORIGINAL_ENV,
      COGNIGY_OAUTH_SESSION_FILE: path.join(tempDir, 'oauth-sessions.json'),
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  it('persists and reloads a token session', async () => {
    const store = new FileTokenStore(createScope());
    const token = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 60_000,
    };

    await store.save(token);

    await expect(store.load()).resolves.toEqual(token);
  });

  it('isolates sessions by issuer, client, redirect uri, and organisation', async () => {
    const sessionFile = resolveOAuthSessionFilePath();
    const firstStore = new FileTokenStore(createScope());
    const secondStore = new FileTokenStore(
      createScope({
        issuerBaseUrl: 'https://api.second.example.ai',
        organizationId: 'org-2',
      })
    );

    await firstStore.save({
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
      tokenType: 'Bearer',
      expiresAt: 1,
    });
    await secondStore.save({
      accessToken: 'access-token-2',
      refreshToken: 'refresh-token-2',
      tokenType: 'Bearer',
      expiresAt: 2,
    });

    const content = JSON.parse(await readFile(sessionFile, 'utf8')) as {
      sessions: Record<string, { accessToken: string }>;
    };

    expect(Object.keys(content.sessions)).toHaveLength(2);
    expect(content.sessions[createOAuthSessionKey(createScope())]?.accessToken).toBe('access-token-1');
    expect(
      content.sessions[
        createOAuthSessionKey(
          createScope({
            issuerBaseUrl: 'https://api.second.example.ai',
            organizationId: 'org-2',
          })
        )
      ]?.accessToken
    ).toBe('access-token-2');
  });

  it('clears only the targeted session entry', async () => {
    const firstStore = new FileTokenStore(createScope());
    const secondStore = new FileTokenStore(
      createScope({
        organizationId: 'org-2',
      })
    );

    await firstStore.save({
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
      tokenType: 'Bearer',
      expiresAt: 1,
    });
    await secondStore.save({
      accessToken: 'access-token-2',
      refreshToken: 'refresh-token-2',
      tokenType: 'Bearer',
      expiresAt: 2,
    });

    await firstStore.clear();

    await expect(firstStore.load()).resolves.toBeUndefined();
    await expect(secondStore.load()).resolves.toEqual({
      accessToken: 'access-token-2',
      refreshToken: 'refresh-token-2',
      tokenType: 'Bearer',
      expiresAt: 2,
    });
  });

  it('writes the session file with restrictive unix permissions when supported', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const store = new FileTokenStore(createScope());
    await store.save({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: 1,
    });

    const sessionFile = resolveOAuthSessionFilePath();
    const fileStats = await stat(sessionFile);

    expect(fileStats.mode & 0o777).toBe(0o600);
  });
});
