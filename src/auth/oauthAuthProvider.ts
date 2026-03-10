import axios, { AxiosInstance } from 'axios';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { logger } from '../utils/logger.js';
import type { AuthProvider, AuthenticatedPrincipal } from './types.js';

export interface OAuthProviderConfig {
  issuerBaseUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  organizationId?: string;
  accessToken?: string;
  refreshToken?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
}

interface TokenState {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: number;
}

interface AuthorizationCodeWaiter {
  codePromise: Promise<string>;
  listeningPromise: Promise<void>;
}

interface UserinfoResponse {
  sub: string;
  email?: string;
  name?: string;
  organisationId: string;
  scope?: string;
  clientId?: string;
}

/** Normalizes API base URLs before appending Cognigy auth paths. */
function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/** Builds absolute Cognigy auth endpoint URLs. */
function createBaseUrl(url: string, path: string): string {
  return new URL(path, ensureTrailingSlash(url)).toString();
}

/** Encodes PKCE material in URL-safe base64. */
function toBase64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/** Generates the PKCE verifier and challenge for Cognigy OAuth login. */
function createPkcePair() {
  const verifier = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Generates the state value used to verify the OAuth callback. */
function createState(): string {
  return toBase64Url(randomBytes(24));
}

/** Opens the Cognigy authorization URL in the user's local browser. */
async function openBrowser(url: string): Promise<void> {
  const commands =
    process.platform === 'darwin'
      ? [['open', url]]
      : process.platform === 'win32'
        ? [['cmd', '/c', 'start', '', url]]
        : [['xdg-open', url]];

  for (const [command, ...args] of commands) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
          detached: true,
          stdio: 'ignore',
        });
        let settled = false;
        child.on('error', (error) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
        child.unref();
        setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve();
          }
        }, 50);
      });
      return;
    } catch {
      // Try the next command.
    }
  }

  logger.warn('Unable to open browser automatically. Open this URL manually.', {
    url,
  });
}

/** Handles Cognigy OAuth login, token refresh, and userinfo lookup for MCP. */
export class OAuthAuthProvider implements AuthProvider {
  private readonly httpClient: AxiosInstance;
  private tokenState?: TokenState;
  private principal?: AuthenticatedPrincipal;

  constructor(private readonly config: OAuthProviderConfig) {
    this.httpClient = axios.create({
      baseURL: config.issuerBaseUrl,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 30000,
    });

    if (config.accessToken) {
      this.tokenState = {
        accessToken: config.accessToken,
        refreshToken: config.refreshToken,
        tokenType: 'Bearer',
      };
    }
  }

  /** Ensures outbound requests carry a valid Cognigy bearer token. */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.ensureAccessToken();
    return {
      Authorization: `${token.tokenType} ${token.accessToken}`,
    };
  }

  /** Uses the Cognigy user id as the local rate-limit bucket when available. */
  async getRateLimitKey(): Promise<string> {
    const principal = await this.getPrincipal();
    return principal?.id || 'oauth-user';
  }

  /** Resolves the current Cognigy user via the `/auth/oauth2/userinfo` endpoint. */
  async getPrincipal(): Promise<AuthenticatedPrincipal | undefined> {
    await this.ensureAccessToken();
    if (this.principal) {
      return this.principal;
    }

    const userinfo = await this.fetchUserinfo();
    this.principal = {
      id: userinfo.sub,
      organizationId: userinfo.organisationId,
      email: userinfo.email,
      name: userinfo.name,
      scopes: userinfo.scope ? userinfo.scope.split(' ').filter(Boolean) : [],
      clientId: userinfo.clientId,
    };
    return this.principal;
  }

  /** Checks whether the cached access token is close to expiring. */
  private isTokenExpired(): boolean {
    if (!this.tokenState?.expiresAt) {
      return false;
    }

    return Date.now() >= this.tokenState.expiresAt - 30_000;
  }

  /** Reuses, refreshes, or re-creates the Cognigy OAuth session as needed. */
  private async ensureAccessToken(): Promise<TokenState> {
    if (this.tokenState?.accessToken && !this.isTokenExpired()) {
      return this.tokenState;
    }

    if (this.tokenState?.refreshToken) {
      try {
        this.tokenState = await this.refreshToken(this.tokenState.refreshToken);
        this.principal = undefined;
        return this.tokenState;
      } catch (error: any) {
        logger.warn('OAuth refresh failed, restarting interactive login', {
          error: error.message,
        });
      }
    }

    this.tokenState = await this.authorizeInteractive();
    this.principal = undefined;
    return this.tokenState;
  }

  /** Calls Cognigy `/auth/oauth2/token` with a refresh token grant. */
  private async refreshToken(refreshToken: string): Promise<TokenState> {
    const response = await this.httpClient.post<TokenResponse>(
      createBaseUrl(this.config.issuerBaseUrl, 'auth/oauth2/token'),
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        refresh_token: refreshToken,
      }).toString()
    );

    return this.toTokenState(response.data, refreshToken);
  }

  /** Runs the interactive browser-based Authorization Code + PKCE flow. */
  private async authorizeInteractive(): Promise<TokenState> {
    const redirectUrl = new URL(this.config.redirectUri);
    if (redirectUrl.protocol !== 'http:') {
      throw new Error('COGNIGY_OAUTH_REDIRECT_URI must use http:// for local PKCE callback handling');
    }

    const state = createState();
    const { verifier, challenge } = createPkcePair();
    const { codePromise, listeningPromise } = this.waitForAuthorizationCode(
      redirectUrl,
      state
    );
    const authorizeUrl = new URL(
      createBaseUrl(this.config.issuerBaseUrl, 'auth/oauth2/authorize')
    );
    authorizeUrl.searchParams.set('client_id', this.config.clientId);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', this.config.redirectUri);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'sha256');
    authorizeUrl.searchParams.set('scope', this.config.scopes.join(' '));
    authorizeUrl.searchParams.set('state', state);
    if (this.config.organizationId) {
      authorizeUrl.searchParams.set('organisation_id', this.config.organizationId);
    }

    logger.info('Starting OAuth browser login', {
      authorizeUrl: authorizeUrl.toString(),
      redirectUri: this.config.redirectUri,
    });
    await listeningPromise;
    await openBrowser(authorizeUrl.toString());

    const code = await codePromise;
    logger.info('OAuth callback received, exchanging authorization code', {
      tokenUrl: createBaseUrl(this.config.issuerBaseUrl, 'auth/oauth2/token'),
      clientId: this.config.clientId,
    });
    let response;
    try {
      response = await this.httpClient.post<TokenResponse>(
        createBaseUrl(this.config.issuerBaseUrl, 'auth/oauth2/token'),
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.config.clientId,
          code,
          redirect_uri: this.config.redirectUri,
          code_verifier: verifier,
          rememberMe: 'true',
        }).toString()
      );
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        logger.error('OAuth token exchange failed', {
          status: error.response?.status,
          data: error.response?.data,
        });
      }
      throw error;
    }
    logger.info('OAuth token exchange succeeded', {
      tokenType: response.data.token_type || 'Bearer',
      hasRefreshToken: Boolean(response.data.refresh_token),
      expiresIn: response.data.expires_in,
    });

    return this.toTokenState(response.data);
  }

  /** Starts the local callback server that receives Cognigy's auth code redirect. */
  private waitForAuthorizationCode(
    redirectUrl: URL,
    expectedState: string
  ): AuthorizationCodeWaiter {
    const hostname = redirectUrl.hostname;
    const requestedPort = Number.parseInt(redirectUrl.port || '80', 10);
    const path = redirectUrl.pathname;

    let resolveListening!: () => void;
    let rejectListening!: (error: Error) => void;
    const listeningPromise = new Promise<void>((resolve, reject) => {
      resolveListening = resolve;
      rejectListening = reject;
    });

    const codePromise = new Promise<string>((resolve, reject) => {
      const server = createServer((request, response) => {
        try {
          const requestUrl = new URL(request.url || '/', this.config.redirectUri);
          if (requestUrl.pathname !== path) {
            response.statusCode = 404;
            response.end('Not found');
            return;
          }

          const error = requestUrl.searchParams.get('error');
          if (error) {
            clearTimeout(timeoutHandle);
            response.statusCode = 400;
            response.end(`OAuth error: ${error}`);
            reject(new Error(error));
            server.close();
            return;
          }

          const code = requestUrl.searchParams.get('code');
          const state = requestUrl.searchParams.get('state');
          if (!code || state !== expectedState) {
            clearTimeout(timeoutHandle);
            response.statusCode = 400;
            response.end('Invalid OAuth callback');
            reject(new Error('Invalid OAuth callback'));
            server.close();
            return;
          }

          clearTimeout(timeoutHandle);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end('<html><body><h1>Login complete</h1><p>You can close this tab.</p></body></html>');
          logger.info('OAuth callback validated', {
            path,
            hostname,
            requestedPort,
          });
          resolve(code);
          server.close();
        } catch (error) {
          clearTimeout(timeoutHandle);
          reject(error);
          server.close();
        }
      });

      let timeoutHandle: NodeJS.Timeout;

      server.on('error', (error) => {
        clearTimeout(timeoutHandle);
        logger.error('OAuth callback server failed', {
          error,
          hostname,
          requestedPort,
          redirectUri: this.config.redirectUri,
        });
        rejectListening(error as Error);
        reject(error);
      });
      server.listen(requestedPort, hostname, () => {
        const address = server.address() as AddressInfo | null;
        logger.info('OAuth callback server listening', {
          address,
        });
        resolveListening();
      });

      timeoutHandle = setTimeout(() => {
        reject(new Error('Timed out waiting for OAuth callback'));
        server.close();
      }, 120_000);
    });

    return {
      codePromise,
      listeningPromise,
    };
  }

  /** Fetches the authenticated Cognigy user for the current access token. */
  private async fetchUserinfo(): Promise<UserinfoResponse> {
    const token = this.tokenState;
    if (!token) {
      throw new Error('OAuth token is not available');
    }

    logger.info('Fetching OAuth userinfo', {
      userinfoUrl: createBaseUrl(this.config.issuerBaseUrl, 'auth/oauth2/userinfo'),
    });
    const response = await this.httpClient.get<UserinfoResponse>(
      createBaseUrl(this.config.issuerBaseUrl, 'auth/oauth2/userinfo'),
      {
        headers: {
          Authorization: `${token.tokenType} ${token.accessToken}`,
          Accept: 'application/json',
        },
      }
    );
    logger.info('OAuth userinfo succeeded', {
      sub: response.data.sub,
      organisationId: response.data.organisationId,
      clientId: response.data.clientId,
    });

    return response.data;
  }

  /** Normalizes Cognigy token responses into MCP runtime state. */
  private toTokenState(
    response: TokenResponse,
    refreshTokenFallback?: string
  ): TokenState {
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token || refreshTokenFallback,
      tokenType: response.token_type || 'Bearer',
      expiresAt: response.expires_in
        ? Date.now() + response.expires_in * 1000
        : undefined,
    };
  }
}
