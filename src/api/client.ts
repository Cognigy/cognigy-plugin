import { ReadStream } from "fs";
import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from "axios";
import FormData from "form-data";
import { logger } from "../utils/logger.js";
import {
  applyProxyToRedirect,
  getProxyAxiosOptions,
  redactProxyUrl,
} from "../utils/proxy.js";
import { getProxyForUrl } from "proxy-from-env";
import {
  ACTOR_CONTEXT_HEADER,
  getActorContextHeader,
} from "../utils/actorContext.js";

export interface CognigyApiClientConfig {
  baseUrl: string;
  apiKey: string;
  /**
   * Declare plugin-performed actions as `mcp-plugin` in Cognigy's audit events.
   * Defaults to true; the `COGNIGY_DISABLE_AUDIT_ATTRIBUTION` env var turns it
   * off for anyone who does not want the plugin named in their audit log.
   */
  auditAttribution?: boolean;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ERR_NETWORK",
]);

function isRetryable(error: AxiosError): boolean {
  if (error.response) {
    const status = error.response.status;
    return status === 429 || status >= 500;
  }
  return RETRYABLE_NETWORK_CODES.has(error.code ?? "");
}

const BODY_SNIPPET_LIMIT = 300;
/** How much of the raw body is read before whitespace collapsing. */
const RAW_BODY_READ_LIMIT = BODY_SNIPPET_LIMIT * 20;

/**
 * Build the message for a response whose body carries neither `detail` nor
 * `title`, i.e. is not a Cognigy error. This used to collapse to a bare
 * "API request failed", which threw away the only evidence of what actually
 * answered: in the corporate-proxy case the responder is the proxy, returning
 * an HTML error page, and the generic message made that indistinguishable from
 * a platform outage. Include a trimmed snippet, and name the proxy when one is
 * in play so the next report arrives already diagnosed.
 *
 * Exported for tests; not part of the client's public surface.
 */
export function describeUnexpectedBody(
  data: unknown,
  error: AxiosError,
): string {
  // Cap before decoding or collapsing whitespace: an error path must not
  // allocate a multi-megabyte string just to throw all but 300 characters of it
  // away. The raw cap is deliberately generous — whitespace collapsing shrinks
  // an HTML page a lot, so slicing at the final limit would leave the snippet
  // short of real text.
  let snippet: string;
  if (typeof data === "string") {
    snippet = data.slice(0, RAW_BODY_READ_LIMIT);
  } else if (Buffer.isBuffer(data)) {
    // Slicing bytes can cut a multi-byte character in half; the trailing
    // replacement char is acceptable in a truncated diagnostic snippet.
    snippet = data.subarray(0, RAW_BODY_READ_LIMIT).toString("utf8");
  } else {
    try {
      snippet = JSON.stringify(data)?.slice(0, RAW_BODY_READ_LIMIT) ?? "";
    } catch {
      snippet = String(data).slice(0, RAW_BODY_READ_LIMIT);
    }
  }
  // Collapse whitespace: HTML error pages are mostly newlines and indentation,
  // which would otherwise eat the snippet budget before the useful text.
  snippet = snippet.replace(/\s+/g, " ").trim();
  if (snippet.length > BODY_SNIPPET_LIMIT) {
    snippet = `${snippet.slice(0, BODY_SNIPPET_LIMIT)}…`;
  }

  const parts = ["API request failed"];
  const status = error.response?.status;
  if (status) parts.push(`(HTTP ${status})`);

  let message = parts.join(" ");
  if (snippet) {
    message += `: the response did not match the expected Cognigy error format — ${snippet}`;
  }

  const proxyUrl = safeGetProxyForUrl(resolveRequestUrl(error.config));
  if (proxyUrl) {
    message +=
      ` This request went through the proxy ${redactProxyUrl(proxyUrl)};` +
      ` the proxy, not Cognigy, may have produced this response.` +
      ` If the proxy inspects TLS, set NODE_EXTRA_CA_CERTS to your corporate` +
      ` root CA file.`;
  }

  return message;
}

/**
 * Best-effort absolute URL for a request. Request paths are usually relative to
 * the client's `baseURL`, and `getProxyForUrl` needs an absolute URL to apply
 * `NO_PROXY` — but neither field is guaranteed to be present or valid, and
 * neither proxy selection nor the error path may throw an error of its own.
 */
function resolveRequestUrl(
  config: Pick<AxiosRequestConfig, "url" | "baseURL"> | undefined,
): string {
  const { url, baseURL } = config ?? {};
  try {
    if (url) return new URL(url, baseURL).toString();
  } catch {
    // Fall through to the base URL below.
  }
  return baseURL ?? "";
}

function safeGetProxyForUrl(targetUrl: string): string {
  if (!targetUrl) return "";
  try {
    return getProxyForUrl(targetUrl);
  } catch {
    return "";
  }
}

export class CognigyApiClient {
  private client: AxiosInstance;
  private apiKey: string;
  private auditAttribution: boolean;

  constructor(config: CognigyApiClientConfig) {
    this.apiKey = config.apiKey;
    this.auditAttribution = config.auditAttribution !== false;
    this.client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 30000,
      // Axios' own proxy handling never opens a CONNECT tunnel; the request
      // interceptor below attaches real tunnelling agents instead.
      proxy: false,
    });

    this.client.interceptors.request.use(
      (reqConfig) => {
        reqConfig.headers["X-API-Key"] = this.apiKey;
        // Resolve the proxy against THIS request's target rather than the
        // client's base URL. Not every request goes to the API host:
        // downloadPackageArchive passes an absolute download link with
        // `baseURL: undefined`, and that host has its own NO_PROXY standing —
        // a client-wide decision would proxy it when it should not, or send it
        // direct when the proxy is mandatory.
        Object.assign(
          reqConfig,
          getProxyAxiosOptions(resolveRequestUrl(reqConfig)),
        );
        // Redirects are followed inside the transport, below this interceptor,
        // so each hop re-resolves its own route from its own destination.
        reqConfig.beforeRedirect = applyProxyToRedirect;
        // Attribute this write to the plugin in Cognigy's audit events. Set
        // here rather than per call site so every platform request is covered,
        // including uploadFile's own headers object. Absent outside a tool
        // call, which leaves the request byte-identical to before.
        if (this.auditAttribution) {
          const actorContext = getActorContextHeader();
          if (actorContext) {
            reqConfig.headers[ACTOR_CONTEXT_HEADER] = actorContext;
          }
        }
        logger.debug(
          `API Request: ${reqConfig.method?.toUpperCase()} ${reqConfig.url}`,
        );
        return reqConfig;
      },
      (error) => {
        logger.error("API Request Error", { error: error.message });
        return Promise.reject(error);
      },
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      async (error: AxiosError) => {
        const config = error.config as AxiosRequestConfig & {
          _retryCount?: number;
        };
        const status = error.response?.status ?? 0;

        if (config && isRetryable(error)) {
          config._retryCount = (config._retryCount ?? 0) + 1;
          if (config._retryCount <= MAX_RETRIES) {
            const delay = RETRY_BASE_MS * Math.pow(2, config._retryCount - 1);
            logger.warn(
              `Retrying request (${config._retryCount}/${MAX_RETRIES}) after ${delay}ms`,
              {
                status,
                url: config.url,
              },
            );
            await new Promise((r) => setTimeout(r, delay));
            return this.client.request(config);
          }
        }

        const message = (error.response?.data as any)?.detail || error.message;
        const traceId = (error.response?.data as any)?.traceId;

        logger.error("API Response Error", {
          status: status || "N/A",
          message,
          traceId,
          url: config?.url,
        });

        return Promise.reject(this.formatError(error));
      },
    );
  }

  private formatError(error: AxiosError): Error {
    const data = error.response?.data as any;
    if (data) {
      const message =
        data.detail || data.title || describeUnexpectedBody(data, error);
      const enhancedError = new Error(message);
      (enhancedError as any).status = data.status || error.response?.status;
      (enhancedError as any).code = data.code;
      (enhancedError as any).traceId = data.traceId;
      (enhancedError as any).details = data.details;
      return enhancedError;
    }
    return error;
  }

  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.get(url, config);
    return response.data;
  }

  async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response: AxiosResponse<T> = await this.client.post(
      url,
      data,
      config,
    );
    return response.data;
  }

  async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response: AxiosResponse<T> = await this.client.put(url, data, config);
    return response.data;
  }

  async patch<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response: AxiosResponse<T> = await this.client.patch(
      url,
      data,
      config,
    );
    return response.data;
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.delete(url, config);
    return response.data;
  }

  async uploadFile<T = any>(
    url: string,
    fileData: Buffer | ReadStream,
    fileName: string,
    extraFields?: Record<string, string>,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    const form = new FormData();
    form.append("file", fileData, { filename: fileName });
    if (extraFields) {
      for (const [key, value] of Object.entries(extraFields)) {
        form.append(key, value);
      }
    }
    const response: AxiosResponse<T> = await this.client.post(url, form, {
      headers: {
        ...form.getHeaders(),
        "X-API-Key": this.apiKey,
      },
      timeout: options?.timeoutMs ?? 120000,
    });
    return response.data;
  }
}
