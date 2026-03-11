import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../utils/logger.js';

export interface TokenState {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: number;
}

export interface OAuthSessionScope {
  issuerBaseUrl: string;
  clientId: string;
  redirectUri: string;
  organizationId?: string;
}

export interface TokenStore<T> {
  load(): Promise<T | undefined>;
  save(token: T): Promise<void>;
  clear(): Promise<void>;
}

interface StoredTokenSession extends TokenState {
  issuerBaseUrl: string;
  clientId: string;
  redirectUri: string;
  organizationId?: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredSessionFile {
  version: 1;
  sessions: Record<string, StoredTokenSession>;
}

function normalizeUrl(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    return value.trim();
  }
}

export function createOAuthSessionKey(scope: OAuthSessionScope): string {
  return JSON.stringify({
    issuerBaseUrl: normalizeUrl(scope.issuerBaseUrl),
    clientId: scope.clientId.trim(),
    redirectUri: normalizeUrl(scope.redirectUri),
    organizationId: scope.organizationId?.trim() || '',
  });
}

export function resolveOAuthSessionFilePath(overridePath?: string): string {
  if (overridePath?.trim()) {
    return overridePath.trim();
  }

  const envOverride = process.env.COGNIGY_OAUTH_SESSION_FILE?.trim();
  if (envOverride) {
    return envOverride;
  }

  switch (process.platform) {
    case 'darwin':
      return path.join(
        os.homedir(),
        'Library',
        'Application Support',
        'cognigy-mcp',
        'oauth-sessions.json'
      );
    case 'win32':
      return path.join(
        process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        'cognigy-mcp',
        'oauth-sessions.json'
      );
    default:
      return path.join(
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
        'cognigy-mcp',
        'oauth-sessions.json'
      );
  }
}

function emptySessionFile(): StoredSessionFile {
  return {
    version: 1,
    sessions: {},
  };
}

async function enforceFilePermissions(filePath: string): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }

  try {
    await chmod(filePath, 0o600);
  } catch (error) {
    logger.warn('Unable to tighten OAuth session file permissions', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export class FileTokenStore implements TokenStore<TokenState> {
  private readonly sessionKey: string;
  private readonly sessionFilePath: string;

  constructor(
    private readonly scope: OAuthSessionScope,
    sessionFilePath?: string
  ) {
    this.sessionKey = createOAuthSessionKey(scope);
    this.sessionFilePath = resolveOAuthSessionFilePath(sessionFilePath);
  }

  async load(): Promise<TokenState | undefined> {
    const fileData = await this.readSessionFile();
    const session = fileData.sessions[this.sessionKey];
    if (!session) {
      return undefined;
    }

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      tokenType: session.tokenType,
      expiresAt: session.expiresAt,
    };
  }

  async save(token: TokenState): Promise<void> {
    const fileData = await this.readSessionFile();
    const existingSession = fileData.sessions[this.sessionKey];
    const now = new Date().toISOString();

    fileData.sessions[this.sessionKey] = {
      ...token,
      issuerBaseUrl: normalizeUrl(this.scope.issuerBaseUrl),
      clientId: this.scope.clientId.trim(),
      redirectUri: normalizeUrl(this.scope.redirectUri),
      organizationId: this.scope.organizationId?.trim() || undefined,
      createdAt: existingSession?.createdAt || now,
      updatedAt: now,
    };

    await this.writeSessionFile(fileData);
  }

  async clear(): Promise<void> {
    const fileData = await this.readSessionFile();
    if (!fileData.sessions[this.sessionKey]) {
      return;
    }

    delete fileData.sessions[this.sessionKey];
    await this.writeSessionFile(fileData);
  }

  private async readSessionFile(): Promise<StoredSessionFile> {
    try {
      const content = await readFile(this.sessionFilePath, 'utf8');
      const parsed = JSON.parse(content) as Partial<StoredSessionFile>;

      if (parsed.version !== 1 || !parsed.sessions || typeof parsed.sessions !== 'object') {
        logger.warn('Ignoring malformed OAuth session file', {
          sessionFilePath: this.sessionFilePath,
        });
        return emptySessionFile();
      }

      return {
        version: 1,
        sessions: parsed.sessions,
      };
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return emptySessionFile();
      }

      if (error instanceof SyntaxError) {
        logger.warn('Ignoring unreadable OAuth session file', {
          sessionFilePath: this.sessionFilePath,
        });
        return emptySessionFile();
      }

      throw error;
    }
  }

  private async writeSessionFile(fileData: StoredSessionFile): Promise<void> {
    await mkdir(path.dirname(this.sessionFilePath), {
      recursive: true,
      mode: 0o700,
    });

    await writeFile(this.sessionFilePath, JSON.stringify(fileData, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });

    await enforceFilePermissions(this.sessionFilePath);
  }
}
