import type { Config } from '../config.js';
import { ApiKeyAuthProvider } from './apiKeyAuthProvider.js';
import { OAuthAuthProvider } from './oauthAuthProvider.js';
import type { AuthProvider } from './types.js';

/** Checks whether the runtime includes usable OAuth settings. */
function hasOAuthRuntimeConfig(config: Config): boolean {
  return !!config.oauth;
}

/** Returns OAuth settings after the calling branch has validated them. */
function getOAuthConfig(config: Config) {
  if (!config.oauth) {
    throw new Error('OAuth configuration is required');
  }

  return config.oauth;
}

/** Chooses the active auth provider for the current MCP process. */
export function createAuthProvider(config: Config): AuthProvider {
  switch (config.authMode) {
    case 'api-key':
      if (!config.apiKey) {
        throw new Error('COGNIGY_API_KEY is required when COGNIGY_AUTH_MODE=api-key');
      }
      return new ApiKeyAuthProvider(config.apiKey);
    case 'oauth':
      if (!hasOAuthRuntimeConfig(config)) {
        throw new Error('OAuth configuration is required when COGNIGY_AUTH_MODE=oauth');
      }
      return new OAuthAuthProvider(getOAuthConfig(config));
    case 'both':
      if (hasOAuthRuntimeConfig(config)) {
        return new OAuthAuthProvider(getOAuthConfig(config));
      }
      if (config.apiKey) {
        return new ApiKeyAuthProvider(config.apiKey);
      }
      throw new Error('Either API key or OAuth configuration is required when COGNIGY_AUTH_MODE=both');
  }
}
