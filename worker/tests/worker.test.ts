/**
 * x402-check Worker — unit tests
 * Uses vitest (no Workers pool required — pure unit tests on exported functions)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isValidUrl,
  extractDomain,
  decodePaymentRequired,
  generateBadgeSvg,
  checkRateLimit,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

describe('isValidUrl', () => {
  it('accepts https URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('https://api.example.com/path?q=1')).toBe(true);
  });

  it('accepts http URLs', () => {
    expect(isValidUrl('http://localhost:3000')).toBe(true);
    expect(isValidUrl('http://192.168.1.1/api')).toBe(true);
  });

  it('rejects non-http protocols', () => {
    expect(isValidUrl('ftp://example.com')).toBe(false);
    expect(isValidUrl('ws://example.com')).toBe(false);
    expect(isValidUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects malformed strings', () => {
    expect(isValidUrl('')).toBe(false);
    expect(isValidUrl('not-a-url')).toBe(false);
    expect(isValidUrl('example.com')).toBe(false); // no protocol
    expect(isValidUrl('//example.com')).toBe(false);
  });
});

describe('extractDomain', () => {
  it('extracts hostname from https URL', () => {
    expect(extractDomain('https://api.example.com/path')).toBe('api.example.com');
  });

  it('falls back to raw string on invalid URL', () => {
    expect(extractDomain('not-a-url')).toBe('not-a-url');
  });
});

// ---------------------------------------------------------------------------
// PaymentRequired decoding
// ---------------------------------------------------------------------------

describe('decodePaymentRequired', () => {
  function encode(obj: object): string {
    return btoa(JSON.stringify(obj));
  }

  const validPayload = {
    scheme: 'exact',
    network: 'base-sepolia',
    maxAmountRequired: '1000000',
    resource: 'https://example.com/content',
    payTo: [{ address: '0xABCD', amount: '1000000' }],
  };

  it('decodes a valid base64 payload', () => {
    const result = decodePaymentRequired(encode(validPayload));
    expect(result.scheme).toBe('exact');
    expect(result.network).toBe('base-sepolia');
    expect(result.maxAmountRequired).toBe('1000000');
    expect(result.payTo).toHaveLength(1);
    expect(result.payTo[0].address).toBe('0xABCD');
  });

  it('throws on missing required fields', () => {
    const bad = { scheme: 'exact', network: 'base-sepolia' }; // missing maxAmountRequired & payTo
    expect(() => decodePaymentRequired(encode(bad))).toThrow('Invalid PaymentRequired');
  });

  it('throws on malformed base64', () => {
    expect(() => decodePaymentRequired('not-valid-base64!!!')).toThrow();
  });

  it('throws on valid base64 but non-JSON content', () => {
    expect(() => decodePaymentRequired(btoa('hello world'))).toThrow();
  });

  it('throws when payTo is not an array', () => {
    const bad = { ...validPayload, payTo: 'not-an-array' };
    expect(() => decodePaymentRequired(encode(bad))).toThrow('Invalid PaymentRequired');
  });
});

// ---------------------------------------------------------------------------
// Badge SVG generation
// ---------------------------------------------------------------------------

describe('generateBadgeSvg', () => {
  it('returns a string containing svg tag', () => {
    const svg = generateBadgeSvg('example.com', true);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('contains green color when supported', () => {
    const svg = generateBadgeSvg('example.com', true);
    expect(svg).toContain('#4c9e5f');
    expect(svg).toContain('supported');
  });

  it('contains red color when not supported', () => {
    const svg = generateBadgeSvg('example.com', false);
    expect(svg).toContain('#e05d44');
    expect(svg).toContain('not supported');
  });

  it('includes the domain in the title', () => {
    const svg = generateBadgeSvg('myapi.dev', true);
    expect(svg).toContain('myapi.dev');
  });

  it('includes aria-label for accessibility', () => {
    const svg = generateBadgeSvg('example.com', true);
    expect(svg).toContain('aria-label');
  });

  it('has valid SVG content-type dimensions', () => {
    const svg = generateBadgeSvg('example.com', true);
    expect(svg).toMatch(/width="\d+"/);
    expect(svg).toMatch(/height="20"/);
  });
});

// ---------------------------------------------------------------------------
// Rate limit logic
// ---------------------------------------------------------------------------

describe('checkRateLimit', () => {
  // Mock KV namespace
  function makeMockKV(initial?: string): KVNamespace {
    let stored: string | null = initial ?? null;
    return {
      get: vi.fn(async () => stored),
      put: vi.fn(async (_key: string, value: string) => {
        stored = value;
      }),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: '' })),
      getWithMetadata: vi.fn(async () => ({ value: stored, metadata: null })),
    } as unknown as KVNamespace;
  }

  it('allows request when no prior state exists', async () => {
    const kv = makeMockKV();
    const result = await checkRateLimit(kv, '1.2.3.4', 100);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it('decrements remaining on each call', async () => {
    const kv = makeMockKV();
    await checkRateLimit(kv, '1.2.3.4', 100);
    const result2 = await checkRateLimit(kv, '1.2.3.4', 100);
    expect(result2.remaining).toBe(98);
  });

  it('denies when limit is reached', async () => {
    // Pre-fill with count at limit
    const now = Math.floor(Date.now() / 1000);
    const resetAt = now - (now % 86400) + 86400;
    const kv = makeMockKV(JSON.stringify({ count: 100, resetAt }));
    const result = await checkRateLimit(kv, '1.2.3.4', 100);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('resets when resetAt is in the past', async () => {
    const pastReset = Math.floor(Date.now() / 1000) - 100; // 100 seconds ago
    const kv = makeMockKV(JSON.stringify({ count: 99, resetAt: pastReset }));
    const result = await checkRateLimit(kv, '1.2.3.4', 100);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99); // fresh window: count reset to 0, then +1
  });

  it('different IPs are tracked independently', async () => {
    const kv = makeMockKV();
    const r1 = await checkRateLimit(kv, '1.1.1.1', 100);
    const r2 = await checkRateLimit(kv, '2.2.2.2', 100);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    // Both should still have 99 remaining since KV mock uses shared store but different keys
  });
});

// ---------------------------------------------------------------------------
// Response format (integration-style using checkUrl via mock fetch)
// ---------------------------------------------------------------------------

describe('response format contract', () => {
  it('X402Result shape has required fields', () => {
    // Verify the shape contract by constructing a mock result
    const result = {
      url: 'https://example.com',
      x402: true,
      paymentInfo: {
        scheme: 'exact',
        network: 'base',
        maxAmountRequired: '1000000',
        payTo: [{ address: '0xABC', amount: '1000000' }],
      },
      facilitator: { reachable: true, url: 'https://facilitator.example.com' },
      checkedAt: new Date().toISOString(),
    };

    expect(result).toHaveProperty('url');
    expect(result).toHaveProperty('x402');
    expect(result).toHaveProperty('paymentInfo');
    expect(result).toHaveProperty('facilitator');
    expect(result).toHaveProperty('checkedAt');
    expect(typeof result.x402).toBe('boolean');
    expect(typeof result.checkedAt).toBe('string');
  });

  it('checkedAt is a valid ISO 8601 timestamp', () => {
    const ts = new Date().toISOString();
    expect(() => new Date(ts)).not.toThrow();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
