/**
 * Rate limiter to prevent API abuse
 */

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RequestRecord {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private requests: Map<string, RequestRecord> = new Map();
  private config: RateLimitConfig;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: RateLimitConfig) {
    this.config = config;
    // Clean up expired entries every minute. `unref()` so this housekeeping
    // timer can never by itself keep the Node event loop alive — without it, a
    // server whose client disconnected would linger forever as an orphan
    // process holding its whole heap. Safe to unref: `check()` already expires
    // records lazily, so the sweep is a pure memory-hygiene optimisation and
    // skipping it while the process is otherwise idle costs nothing.
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    this.cleanupInterval.unref();
  }

  /**
   * Stop the cleanup interval (important for tests and graceful shutdown)
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /**
   * Check if a request should be allowed
   * @param key - Identifier for the rate limit bucket (e.g., API key, IP address)
   * @returns true if request is allowed, false if rate limit exceeded
   */
  check(key: string): boolean {
    const now = Date.now();
    const record = this.requests.get(key);

    if (!record || now > record.resetTime) {
      // New window, allow request
      this.requests.set(key, {
        count: 1,
        resetTime: now + this.config.windowMs,
      });
      return true;
    }

    if (record.count < this.config.maxRequests) {
      // Within limit, allow request
      record.count++;
      return true;
    }

    // Rate limit exceeded
    return false;
  }

  /**
   * Get remaining requests for a key
   */
  getRemaining(key: string): number {
    const record = this.requests.get(key);
    if (!record || Date.now() > record.resetTime) {
      return this.config.maxRequests;
    }
    return Math.max(0, this.config.maxRequests - record.count);
  }

  /**
   * Clean up expired entries
   */
  private cleanup() {
    const now = Date.now();
    for (const [key, record] of this.requests.entries()) {
      if (now > record.resetTime) {
        this.requests.delete(key);
      }
    }
  }
}
