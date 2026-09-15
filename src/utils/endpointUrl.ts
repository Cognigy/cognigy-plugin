/**
 * Cognigy REST endpoint URLs and their test-mode variant.
 *
 * Cognigy's Endpoint Test Mode (docs.cognigy.com → Deploy → Endpoints → Test
 * Mode) processes a message exactly like a real user message but keeps it out
 * of the billable conversation count. For REST endpoints it is selected purely
 * by URL: `https://<ENDPOINT_BASE>/test/<URL_TOKEN>` instead of
 * `https://<ENDPOINT_BASE>/<URL_TOKEN>`. Cognigy documents a fair-use limit of
 * 600 test messages per hour, above which traffic may be treated as misuse; it
 * does not state the limit's scope or how exceeding it is signalled.
 *
 * Two ways to get at the URLs:
 *
 * - `endpointUrlFor(base, token, testMode)` when the endpoint base URL and the
 *   URL token are known separately (the handler resolved the endpoint itself).
 *   This is exact: the base may carry any path prefix, even one ending in
 *   `/test`, because the token is appended rather than searched for.
 * - `toTestModeEndpointUrl` / `toProductionEndpointUrl` for a complete URL the
 *   caller supplied, where the base is unknown. These treat the last path
 *   segment as the token and the segment before it as an optional `test`
 *   marker, which is right for every URL this plugin hands out.
 */

const TEST_SEGMENT = "test";

function splitPath(url: URL): string[] {
  return url.pathname.split("/").filter((s) => s.length > 0);
}

function withSegments(url: URL, segments: string[]): string {
  url.pathname = "/" + segments.join("/");
  return url.toString();
}

/**
 * Builds the endpoint URL from its parts. The base may carry a path prefix
 * (on-prem installs); the token is appended after it, behind a `test` segment
 * when `testMode` is set.
 */
export function endpointUrlFor(
  endpointBaseUrl: string,
  urlToken: string,
  testMode: boolean,
): string {
  const url = new URL(endpointBaseUrl);
  const prefix = splitPath(url);
  return withSegments(
    url,
    testMode ? [...prefix, TEST_SEGMENT, urlToken] : [...prefix, urlToken],
  );
}

/** True when the URL has at least one path segment to serve as the URL token. */
export function hasEndpointToken(endpointUrl: string): boolean {
  return splitPath(new URL(endpointUrl)).length > 0;
}

/** True when the URL already addresses the test-mode variant of an endpoint. */
export function isTestModeEndpointUrl(endpointUrl: string): boolean {
  const segments = splitPath(new URL(endpointUrl));
  return segments.length >= 2 && segments[segments.length - 2] === TEST_SEGMENT;
}

/**
 * Returns the test-mode URL for a complete REST endpoint URL. Idempotent: a URL
 * that is already in test mode is returned unchanged (normalised).
 */
export function toTestModeEndpointUrl(endpointUrl: string): string {
  const url = new URL(endpointUrl);
  const segments = splitPath(url);
  if (segments.length === 0) return url.toString();
  if (isTestModeEndpointUrl(endpointUrl)) return withSegments(url, segments);
  const token = segments[segments.length - 1];
  return withSegments(url, [...segments.slice(0, -1), TEST_SEGMENT, token]);
}

/**
 * Returns the regular (billable) URL for a complete REST endpoint URL,
 * stripping the test-mode segment if present. Idempotent.
 */
export function toProductionEndpointUrl(endpointUrl: string): string {
  const url = new URL(endpointUrl);
  const segments = splitPath(url);
  if (!isTestModeEndpointUrl(endpointUrl)) return withSegments(url, segments);
  return withSegments(url, [
    ...segments.slice(0, -2),
    segments[segments.length - 1],
  ]);
}
