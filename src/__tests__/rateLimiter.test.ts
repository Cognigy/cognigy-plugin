/**
 * Tests for rate limiter
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RateLimiter } from '../utils/rateLimiter.js';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      maxRequests: 3,
      windowMs: 1000,
    });
  });

  afterEach(() => {
    rateLimiter.destroy();
  });

  it('should allow requests within limit', () => {
    expect(rateLimiter.check('test-key')).toBe(true);
    expect(rateLimiter.check('test-key')).toBe(true);
    expect(rateLimiter.check('test-key')).toBe(true);
  });

  it('should block requests exceeding limit', () => {
    rateLimiter.check('test-key');
    rateLimiter.check('test-key');
    rateLimiter.check('test-key');
    expect(rateLimiter.check('test-key')).toBe(false);
  });

  it('should track remaining requests', () => {
    expect(rateLimiter.getRemaining('test-key')).toBe(3);
    rateLimiter.check('test-key');
    expect(rateLimiter.getRemaining('test-key')).toBe(2);
    rateLimiter.check('test-key');
    expect(rateLimiter.getRemaining('test-key')).toBe(1);
  });

  it('should reset after window expires', async () => {
    rateLimiter.check('test-key');
    rateLimiter.check('test-key');
    rateLimiter.check('test-key');
    expect(rateLimiter.check('test-key')).toBe(false);

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 1100));

    expect(rateLimiter.check('test-key')).toBe(true);
  });

  it('should track different keys separately', () => {
    rateLimiter.check('key1');
    rateLimiter.check('key1');
    rateLimiter.check('key1');
    
    expect(rateLimiter.check('key1')).toBe(false);
    expect(rateLimiter.check('key2')).toBe(true);
  });
});

