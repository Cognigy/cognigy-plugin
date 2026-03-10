/** Normalized authenticated user data used across MCP auth modes. */
export interface AuthenticatedPrincipal {
  id: string;
  organizationId: string;
  email?: string;
  name?: string;
  scopes: string[];
  clientId?: string;
}

/** Common contract for API key and OAuth-based authentication. */
export interface AuthProvider {
  getAuthHeaders(): Promise<Record<string, string>>;
  getRateLimitKey(): Promise<string>;
  getPrincipal(): Promise<AuthenticatedPrincipal | undefined>;
}
