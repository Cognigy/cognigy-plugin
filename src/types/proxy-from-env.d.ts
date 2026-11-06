/**
 * `proxy-from-env` ships no types and has no `@types/` package. It is already
 * in the tree as axios' own dependency; declaring the one function we use here
 * keeps it that way instead of adding a dev dependency for four lines.
 */
declare module "proxy-from-env" {
  /**
   * Returns the proxy URL configured for `url` via the environment
   * (`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`, in either case — v2 dropped the
   * `NPM_CONFIG_*` variants; `resolveProxyForUrl` in utils/proxy.ts adds them),
   * or an empty string when none applies — including when `NO_PROXY` excludes
   * the target.
   */
  export function getProxyForUrl(url: string): string;
}
