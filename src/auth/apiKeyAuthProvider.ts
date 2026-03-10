import type { AuthProvider, AuthenticatedPrincipal } from './types.js';

/** Sends the existing Cognigy API key on every outgoing request. */
export class ApiKeyAuthProvider implements AuthProvider {
  constructor(private readonly apiKey: string) {}

  /** Builds headers for Cognigy API key authentication. */
  async getAuthHeaders(): Promise<Record<string, string>> {
    return {
      'X-API-Key': this.apiKey,
    };
  }

  /** Reuses the API key prefix for local rate limiting. */
  async getRateLimitKey(): Promise<string> {
    return this.apiKey.substring(0, 10);
  }

  /** API key mode does not resolve a Cognigy user principal. */
  async getPrincipal(): Promise<AuthenticatedPrincipal | undefined> {
    return undefined;
  }
}
