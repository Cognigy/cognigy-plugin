/**
 * Cognigy REST endpoint URLs and their test-mode variant.
 *
 * Cognigy's Endpoint Test Mode (docs.cognigy.com → Deploy → Endpoints → Test
 * Mode) processes a message exactly like a real user message but keeps it out
 * of the billable conversation count. For REST endpoints it is selected purely
 * by URL: `https://<ENDPOINT_BASE>/test/<URL_TOKEN>` instead of
 * `https://<ENDPOINT_BASE>/<URL_TOKEN>`. The `test` segment sits directly in
 * front of the token, so it survives an endpoint base that carries its own path
 * prefix (on-prem installs). Cognigy caps test traffic at 600 messages per hour
 * per organisation; above that it may be treated as misuse.
 */

const TEST_SEGMENT = "test";

function splitPath(url: URL): string[] {
  return url.pathname.split("/").filter((s) => s.length > 0);
}

function withSegments(url: URL, segments: string[]): string {
  const out = new URL(url.toString());
  out.pathname = "/" + segments.join("/");
  return out.toString();
}

/** True when the URL already addresses the test-mode variant of an endpoint. */
export function isTestModeEndpointUrl(endpointUrl: string): boolean {
  const segments = splitPath(new URL(endpointUrl));
  return segments.length >= 2 && segments[segments.length - 2] === TEST_SEGMENT;
}

/**
 * Returns the test-mode URL for a REST endpoint URL. Idempotent: a URL that is
 * already in test mode is returned unchanged (normalised).
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
 * Returns the regular (billable) URL for a REST endpoint URL, stripping the
 * test-mode segment if present. Idempotent.
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
