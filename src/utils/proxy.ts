/**
 * Corporate-proxy support for every outbound Cognigy request.
 *
 * Axios reads `HTTP_PROXY`/`HTTPS_PROXY` itself, but its Node adapter does NOT
 * open a `CONNECT` tunnel: `setProxy()` rewrites the request to target the
 * proxy host with an absolute-form path and takes the protocol from the proxy,
 * so an `https://` Cognigy call leaves the process as a *plaintext* HTTP
 * request asking the proxy to go fetch an HTTPS URL. Squid, Zscaler, BlueCoat
 * and friends reject that form and answer with an HTML error page, which the
 * client then surfaces as a bare `API request failed / 500` — the platform is
 * never reached. Hence `proxy: false` on every axios instance plus a real
 * tunnelling agent from here.
 *
 * `getProxyForUrl` (axios' own transitive dependency) resolves the proxy for a
 * given target: it honours upper- and lower-case `HTTP_PROXY`/`HTTPS_PROXY`,
 * `NO_PROXY` exclusions, `ALL_PROXY`, and `NPM_CONFIG_*` variants, so the
 * variables users already set for npm and every other CLI keep working.
 *
 * TLS-inspecting proxies need one more thing that no library can do for us:
 * the corporate root CA. Node only reads it from `NODE_EXTRA_CA_CERTS` at
 * startup, so the user must set that env var next to their proxy vars — we
 * never disable certificate verification to paper over it.
 */
import type { Agent } from "http";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { getProxyForUrl } from "proxy-from-env";
import { logger } from "./logger.js";

export interface ProxyAxiosOptions {
  /** Always false: axios' own proxy handling is what we are working around. */
  proxy: false;
  httpAgent?: Agent;
  httpsAgent?: Agent;
}

/**
 * Agents are pooled per proxy URL. Each one owns a socket pool, so building a
 * fresh agent per request would leak sockets and re-do the `CONNECT` handshake
 * every time.
 */
const agentCache = new Map<string, { http: Agent; https: Agent }>();

function getAgents(proxyUrl: string): { http: Agent; https: Agent } {
  let agents = agentCache.get(proxyUrl);
  if (!agents) {
    agents = {
      http: new HttpProxyAgent(proxyUrl),
      https: new HttpsProxyAgent(proxyUrl),
    };
    agentCache.set(proxyUrl, agents);
  }
  return agents;
}

/**
 * Origin only — never the path. `talk_to_agent` resolves through here with an
 * endpoint URL whose path is the `URLToken`, which anyone holding it can use to
 * talk to the agent. Logs get pasted into bug reports, so the host is all a
 * proxy diagnosis needs and all it may have.
 */
function targetOrigin(targetUrl: string): string {
  try {
    return new URL(targetUrl).origin;
  } catch {
    return "(unparseable target url)";
  }
}

/**
 * Strip credentials before a proxy URL reaches a log line — proxy passwords are
 * as sensitive as the API key and logs get pasted into bug reports.
 */
export function redactProxyUrl(proxyUrl: string): string {
  try {
    const url = new URL(proxyUrl);
    if (url.username || url.password) {
      url.username = "***";
      url.password = "";
    }
    return url.toString();
  } catch {
    return "(unparseable proxy url)";
  }
}

/**
 * Returns a reason string when `proxyUrl` is something we cannot tunnel
 * through, or `undefined` when it is usable. SOCKS proxies would need
 * `socks-proxy-agent`; naming that explicitly beats a mystery timeout.
 */
function describeUnsupportedProxy(proxyUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    return "not a valid URL — expected something like http://proxy.example:8080";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `unsupported proxy protocol "${parsed.protocol}" — only http and https proxies are supported`;
  }
  if (!parsed.hostname) {
    return "no proxy host in the URL";
  }
  return undefined;
}

/**
 * Resolve the proxy configured for `targetUrl` and return the axios options
 * that route through it. With no proxy configured (or the target excluded by
 * `NO_PROXY`) this still returns `proxy: false`, which is what axios does
 * anyway when no proxy env var is set — so the no-proxy path is unchanged.
 */
export function getProxyAxiosOptions(targetUrl: string): ProxyAxiosOptions {
  let proxyUrl = "";
  try {
    proxyUrl = getProxyForUrl(targetUrl);
  } catch {
    // A malformed target URL is the caller's problem, not ours; let the
    // request itself fail with a useful message instead of throwing here.
    proxyUrl = "";
  }

  if (!proxyUrl) {
    return { proxy: false };
  }

  const rejection = describeUnsupportedProxy(proxyUrl);
  if (rejection) {
    // Warn and connect directly rather than tunnelling through something that
    // cannot work: the agents accept almost any string and would silently
    // build a tunnel to a nonsense host, turning a typo into a connection
    // timeout with no clue as to why.
    logger.warn(
      `Ignoring proxy configuration (${rejection}); connecting directly instead`,
      { proxy: redactProxyUrl(proxyUrl) },
    );
    return { proxy: false };
  }

  try {
    const agents = getAgents(proxyUrl);
    logger.debug("Routing request through proxy", {
      target: targetOrigin(targetUrl),
      proxy: redactProxyUrl(proxyUrl),
    });
    return { proxy: false, httpAgent: agents.http, httpsAgent: agents.https };
  } catch (error: any) {
    // An unusable proxy URL must not take the whole server down at construction
    // time. Warn loudly and fall back to a direct connection, which fails with
    // a network error the user can act on.
    logger.warn(
      "Ignoring unusable proxy configuration; connecting directly instead",
      { proxy: redactProxyUrl(proxyUrl), error: error?.message },
    );
    return { proxy: false };
  }
}

/** Test seam: proxy env vars are read per call, but agents are cached. */
export function clearProxyAgentCache(): void {
  agentCache.clear();
}

/**
 * Announce the effective proxy once at boot. Support cases behind a corporate
 * proxy hinge on whether the server actually picked the variables up — a GUI
 * client (Claude Desktop, Antigravity) starts the server with a minimal
 * environment that often lacks the shell's proxy vars entirely — and this line
 * answers that from the client's own MCP log without asking for a repro.
 */
export function logProxyConfiguration(apiBaseUrl: string): void {
  let proxyUrl = "";
  try {
    proxyUrl = getProxyForUrl(apiBaseUrl);
  } catch {
    proxyUrl = "";
  }

  if (proxyUrl) {
    logger.info("Cognigy API requests route through a proxy", {
      proxy: redactProxyUrl(proxyUrl),
      extraCaCerts: process.env.NODE_EXTRA_CA_CERTS ?? "(not set)",
    });
  } else {
    logger.debug("No proxy configured for the Cognigy API", {
      apiBaseUrl,
    });
  }
}
