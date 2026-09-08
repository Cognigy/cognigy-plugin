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

/** Raised when a proxy is configured but cannot be used as written. */
export class ProxyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyConfigurationError";
  }
}

const DEFAULT_PROXY_CONNECT_TIMEOUT_MS = 30000;

/**
 * Deadline for reaching the proxy and completing the `CONNECT` handshake.
 *
 * Axios' own `timeout` cannot cover this: it is armed with
 * `ClientRequest.setTimeout`, which only starts once the request has a socket,
 * and a proxy agent hands the socket over only after the tunnel is negotiated.
 * A proxy that accepts the TCP connection and then never answers `CONNECT`
 * therefore leaves the tool call pending indefinitely — well past the 30s
 * axios timeout. Overridable for environments where a slow proxy is normal.
 */
function connectTimeoutMs(): number {
  const raw = process.env.COGNIGY_PROXY_CONNECT_TIMEOUT_MS;
  if (!raw) return DEFAULT_PROXY_CONNECT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn(
      "Ignoring invalid COGNIGY_PROXY_CONNECT_TIMEOUT_MS; using the default",
      { value: raw, default: DEFAULT_PROXY_CONNECT_TIMEOUT_MS },
    );
    return DEFAULT_PROXY_CONNECT_TIMEOUT_MS;
  }
  return parsed;
}

interface ConnectableAgent {
  connect: (...args: never[]) => Promise<unknown>;
  /** Options both proxy agents hand to `net.connect`/`tls.connect`. */
  connectOpts?: Record<string, unknown>;
}

/**
 * Wrap an agent's `connect()` so proxy connection plus tunnel negotiation is
 * bounded. On expiry the request fails with `ETIMEDOUT`; a socket that arrives
 * late is destroyed rather than left holding a file descriptor for a tunnel
 * nobody is waiting on any more.
 */
function withConnectDeadline<A extends ConnectableAgent>(
  agent: A,
  timeoutMs: number,
  proxyLabel: string,
): A {
  const original = agent.connect.bind(agent) as (
    ...args: never[]
  ) => Promise<unknown>;

  agent.connect = ((...args: never[]) => {
    // Abort the socket the agent is about to open, so an expired attempt does
    // not leave a file descriptor held open against a proxy that never
    // answers. Both pinned agents build their socket with
    // `net.connect(this.connectOpts)` synchronously, before their first
    // `await`, so injecting the signal immediately before the call and
    // removing it immediately after cannot interleave with another connect —
    // there is no suspension point in between. Verified against
    // http(s)-proxy-agent 9.1.0, which the manifest pins exactly.
    const controller = new AbortController();
    const connectOpts = agent.connectOpts;
    const canSignal = Boolean(connectOpts) && !("signal" in connectOpts!);
    if (canSignal) connectOpts!.signal = controller.signal;
    let connecting: Promise<unknown>;
    try {
      connecting = original(...args);
    } finally {
      if (canSignal) delete connectOpts!.signal;
    }

    let timer: NodeJS.Timeout | undefined;
    let expired = false;

    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        controller.abort();
        const error: NodeJS.ErrnoException = new Error(
          `Timed out after ${timeoutMs}ms connecting through the proxy ${proxyLabel}. ` +
            `The proxy accepted the connection but did not complete the tunnel. ` +
            `Check the proxy address, and raise COGNIGY_PROXY_CONNECT_TIMEOUT_MS if it is simply slow.`,
        );
        error.code = "ETIMEDOUT";
        reject(error);
      }, timeoutMs);
      // Never keep the process alive for this timer alone; the pending socket
      // already holds the event loop for as long as the attempt is live.
      timer.unref?.();
    });

    connecting.then(
      (socket) => {
        if (expired) (socket as { destroy?: () => void })?.destroy?.();
      },
      () => {
        // The underlying failure is already the rejection of `connecting`,
        // which the race below propagates; swallow it here so a late rejection
        // after the deadline fired is not an unhandled rejection.
      },
    );

    return Promise.race([connecting, deadline]).finally(() =>
      clearTimeout(timer),
    );
  }) as A["connect"];

  return agent;
}

/**
 * Agents are pooled per proxy URL. Each one owns a socket pool, so building a
 * fresh agent per request would leak sockets and re-do the `CONNECT` handshake
 * every time. The deadline is part of the key so changing it takes effect
 * rather than being masked by a cached agent.
 */
const agentCache = new Map<string, { http: Agent; https: Agent }>();

function getAgents(proxyUrl: string): { http: Agent; https: Agent } {
  const timeoutMs = connectTimeoutMs();
  const cacheKey = `${proxyUrl}|${timeoutMs}`;
  let agents = agentCache.get(cacheKey);
  if (!agents) {
    const label = redactProxyUrl(proxyUrl);
    agents = {
      http: withConnectDeadline(
        new HttpProxyAgent(proxyUrl) as unknown as HttpProxyAgent<string> &
          ConnectableAgent,
        timeoutMs,
        label,
      ) as unknown as Agent,
      https: withConnectDeadline(
        new HttpsProxyAgent(proxyUrl) as unknown as HttpsProxyAgent<string> &
          ConnectableAgent,
        timeoutMs,
        label,
      ) as unknown as Agent,
    };
    agentCache.set(cacheKey, agents);
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
 * `NO_PROXY`) this returns `proxy: false` and no agents, which is what axios
 * does anyway when no proxy env var is set — so the no-proxy path is unchanged.
 *
 * Resolve per request, not per client: `NO_PROXY` and the proxy variables are
 * matched against the individual target, and requests do not all share a host
 * (a package download link points at wherever the platform staged the archive).
 *
 * Throws `ProxyConfigurationError` when a proxy IS configured for the target
 * but cannot be used as written. Connecting directly instead would send the API
 * key and the request body outside the sanctioned proxy path, and on a network
 * that forbids direct egress it would replace an actionable configuration error
 * with a puzzling connection failure.
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
    throw new ProxyConfigurationError(
      `Cannot use the configured proxy ${redactProxyUrl(proxyUrl)}: ${rejection}. ` +
        `Fix the proxy setting, or exclude ${targetOrigin(targetUrl)} with NO_PROXY to connect directly.`,
    );
  }

  try {
    const agents = getAgents(proxyUrl);
    logger.debug("Routing request through proxy", {
      target: targetOrigin(targetUrl),
      proxy: redactProxyUrl(proxyUrl),
    });
    return { proxy: false, httpAgent: agents.http, httpsAgent: agents.https };
  } catch (error: any) {
    throw new ProxyConfigurationError(
      `Cannot use the configured proxy ${redactProxyUrl(proxyUrl)}: ${error?.message ?? "unusable proxy configuration"}. ` +
        `Fix the proxy setting, or exclude ${targetOrigin(targetUrl)} with NO_PROXY to connect directly.`,
    );
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
    const rejection = describeUnsupportedProxy(proxyUrl);
    if (rejection) {
      // Requests will fail with the same complaint, but say it once at boot so
      // the problem is visible in the client's log before the first tool call.
      logger.error("The configured proxy cannot be used", {
        proxy: redactProxyUrl(proxyUrl),
        reason: rejection,
      });
      return;
    }
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
