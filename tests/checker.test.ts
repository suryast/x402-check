import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkX402, decodePaymentRequired, checkFacilitator } from '../src/checker.js';
import { validateSchema } from '../src/validator.js';
import type { PaymentRequired, AcceptsEntry } from '../src/types.js';

// ---- helpers ----

function makeLegacyPaymentRequired(overrides: Partial<PaymentRequired> = {}): PaymentRequired {
  return {
    scheme: 'exact',
    network: 'base-sepolia',
    maxAmountRequired: '1000000',
    resource: 'https://example.com/api',
    payTo: [{ address: '0xABCD', amount: '1000000', token: 'USDC' }],
    ...overrides,
  };
}

function makeAcceptsEntry(overrides: Partial<AcceptsEntry> = {}): AcceptsEntry {
  return {
    scheme: 'exact',
    network: 'base-mainnet',
    maxAmountRequired: '1000000',
    resource: 'https://example.com/api',
    description: 'Access to AI API',
    mimeType: 'application/json',
    payTo: '0xDeadBeef',
    maxTimeoutSeconds: 300,
    ...overrides,
  };
}

function makeSpecPayload(overrides: Record<string, unknown> = {}) {
  return {
    x402Version: 1,
    accepts: [makeAcceptsEntry()],
    facilitatorUrl: 'https://facilitator.example.com',
    ...overrides,
  };
}

function encodeHeader(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

function mockFetch(status: number, headers: Record<string, string> = {}, body: string | object = '') {
  const bodyStr = typeof body === 'object' ? JSON.stringify(body) : body;
  return vi.fn().mockResolvedValue({
    status,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
      forEach: (cb: (v: string, k: string) => void) => {
        for (const [k, v] of Object.entries(headers)) cb(v, k);
      },
    },
    text: async () => bodyStr,
    json: async () => typeof body === 'object' ? body : JSON.parse(bodyStr),
  });
}

// ============================================================
// decodePaymentRequired
// ============================================================

describe('decodePaymentRequired', () => {
  it('decodes a valid base64 JSON header (legacy flat)', () => {
    const pr = makeLegacyPaymentRequired();
    const header = encodeHeader(pr);
    const decoded = decodePaymentRequired(header);
    expect(decoded.network).toBe('base-sepolia');
    expect(Array.isArray(decoded.payTo)).toBe(true);
  });

  it('decodes a valid x402 v1 spec payload (accepts array)', () => {
    const payload = makeSpecPayload();
    const decoded = decodePaymentRequired(encodeHeader(payload));
    expect(decoded.x402Version).toBe(1);
    expect(Array.isArray(decoded.accepts)).toBe(true);
    expect(decoded.facilitatorUrl).toBe('https://facilitator.example.com');
  });

  it('throws on invalid base64', () => {
    expect(() => decodePaymentRequired('!!!not-base64!!!')).toThrow();
  });

  it('throws on non-JSON payload', () => {
    const header = Buffer.from('not json').toString('base64');
    expect(() => decodePaymentRequired(header)).toThrow();
  });

  it('throws on completely invalid structure', () => {
    const header = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64');
    expect(() => decodePaymentRequired(header)).toThrow(/Invalid PaymentRequired/);
  });
});

// ============================================================
// validateSchema
// ============================================================

describe('validateSchema', () => {
  it('passes a valid spec-compliant payload', () => {
    const result = validateSchema(makeSpecPayload());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when x402Version is missing', () => {
    const payload = makeSpecPayload();
    delete (payload as Record<string, unknown>).x402Version;
    const result = validateSchema(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('x402Version'))).toBe(true);
  });

  it('fails when x402Version is not a number', () => {
    const payload = makeSpecPayload({ x402Version: 'one' });
    const result = validateSchema(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('x402Version'))).toBe(true);
  });

  it('fails when accepts is missing', () => {
    const payload = makeSpecPayload();
    delete (payload as Record<string, unknown>).accepts;
    const result = validateSchema(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('accepts'))).toBe(true);
  });

  it('fails when accepts is empty', () => {
    const payload = makeSpecPayload({ accepts: [] });
    const result = validateSchema(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('accepts'))).toBe(true);
  });

  it('fails when accepts entry is missing required fields', () => {
    const entry = makeAcceptsEntry();
    delete (entry as Record<string, unknown>).scheme;
    const payload = makeSpecPayload({ accepts: [entry] });
    const result = validateSchema(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('scheme'))).toBe(true);
  });

  it('fails when accepts entry payTo is missing', () => {
    const entry = makeAcceptsEntry();
    delete (entry as Record<string, unknown>).payTo;
    const payload = makeSpecPayload({ accepts: [entry] });
    const result = validateSchema(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('payTo'))).toBe(true);
  });

  it('warns when facilitatorUrl is missing', () => {
    const payload = makeSpecPayload();
    delete (payload as Record<string, unknown>).facilitatorUrl;
    const result = validateSchema(payload);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('facilitatorUrl'))).toBe(true);
  });

  it('fails when facilitatorUrl is not a valid URL', () => {
    const payload = makeSpecPayload({ facilitatorUrl: 'not-a-url' });
    const result = validateSchema(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('facilitatorUrl'))).toBe(true);
  });

  it('fails when payload is not an object', () => {
    expect(validateSchema(null).valid).toBe(false);
    expect(validateSchema('string').valid).toBe(false);
    expect(validateSchema(42).valid).toBe(false);
  });

  it('validates discovery documents with endpoints array', () => {
    const payload = {
      x402Version: 1,
      endpoints: [
        { path: '/api/submit', method: 'POST', description: 'Paid endpoint' },
      ],
    };
    const result = validateSchema(payload);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails discovery document with empty endpoints', () => {
    const payload = { x402Version: 1, endpoints: [] };
    const result = validateSchema(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('endpoints'))).toBe(true);
  });

  it('warns when accepts[].resource is not a URL', () => {
    const entry = makeAcceptsEntry({ resource: 'not-a-url' });
    const payload = makeSpecPayload({ accepts: [entry] });
    const result = validateSchema(payload);
    // resource isn't empty so no error, but we warn
    expect(result.warnings.some((w) => w.includes('resource'))).toBe(true);
  });

  it('validates multiple accepts entries, collecting all errors', () => {
    const entry1 = makeAcceptsEntry();
    const entry2 = { ...makeAcceptsEntry() };
    delete (entry2 as Record<string, unknown>).network;
    delete (entry2 as Record<string, unknown>).mimeType;
    const payload = makeSpecPayload({ accepts: [entry1, entry2] });
    const result = validateSchema(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('[1]'))).toBe(true);
  });
});

// ============================================================
// checkFacilitator
// ============================================================

describe('checkFacilitator', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns reachable=true on 200', async () => {
    globalThis.fetch = mockFetch(200) as unknown as typeof fetch;
    const result = await checkFacilitator('https://facilitator.example.com');
    expect(result.reachable).toBe(true);
    expect(result.status).toBe(200);
  });

  it('returns reachable=true on 301 redirect', async () => {
    globalThis.fetch = mockFetch(301) as unknown as typeof fetch;
    const result = await checkFacilitator('https://facilitator.example.com');
    expect(result.reachable).toBe(true);
    expect(result.status).toBe(301);
  });

  it('returns reachable=false on 500', async () => {
    globalThis.fetch = mockFetch(500) as unknown as typeof fetch;
    const result = await checkFacilitator('https://facilitator.example.com');
    expect(result.reachable).toBe(false);
    expect(result.status).toBe(500);
  });

  it('returns reachable=false on 404', async () => {
    globalThis.fetch = mockFetch(404) as unknown as typeof fetch;
    const result = await checkFacilitator('https://facilitator.example.com');
    expect(result.reachable).toBe(false);
    expect(result.status).toBe(404);
  });

  it('returns reachable=false on timeout', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    ) as unknown as typeof fetch;
    const result = await checkFacilitator('https://facilitator.example.com', 100);
    expect(result.reachable).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  });

  it('returns reachable=false on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new TypeError('fetch failed')
    ) as unknown as typeof fetch;
    const result = await checkFacilitator('https://facilitator.example.com');
    expect(result.reachable).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('includes the url in the result', async () => {
    globalThis.fetch = mockFetch(200) as unknown as typeof fetch;
    const result = await checkFacilitator('https://facilitator.example.com');
    expect(result.url).toBe('https://facilitator.example.com');
  });
});

// ============================================================
// checkX402 (integration)
// ============================================================

describe('checkX402', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('detects x402 on 402 + valid legacy header', async () => {
    const pr = makeLegacyPaymentRequired();
    globalThis.fetch = mockFetch(402, {
      'x-payment-required': encodeHeader(pr),
    }) as unknown as typeof fetch;

    const result = await checkX402('https://example.com/api');
    expect(result.supported).toBe(true);
    expect(result.status).toBe(402);
    expect(result.paymentDetails?.network).toBe('base-sepolia');
  });

  it('detects x402 on 402 + spec-compliant header, includes schemaValidation', async () => {
    const payload = makeSpecPayload();
    globalThis.fetch = mockFetch(402, {
      'x-payment-required': encodeHeader(payload),
    }) as unknown as typeof fetch;

    const result = await checkX402('https://example.com/api');
    expect(result.supported).toBe(true);
    expect(result.schemaValidation).toBeDefined();
    expect(result.schemaValidation?.valid).toBe(true);
  });

  it('includes schemaValidation errors when payload is invalid', async () => {
    const payload = { x402Version: 1, facilitatorUrl: 'https://f.example.com' }; // missing accepts
    globalThis.fetch = mockFetch(402, {
      'x-payment-required': encodeHeader(payload),
    }) as unknown as typeof fetch;

    // This won't throw in decodePaymentRequired since it has x402Version
    const result = await checkX402('https://example.com/api');
    expect(result.supported).toBe(true);
    expect(result.schemaValidation?.valid).toBe(false);
    expect(result.schemaValidation?.errors.some((e) => e.includes('accepts'))).toBe(true);
  });

  it('runs facilitator check when verbose=true and facilitatorUrl present', async () => {
    const payload = makeSpecPayload();
    // First fetch: the main URL check (returns 402)
    // Second fetch: the facilitator HEAD request (returns 200)
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          status: 402,
          headers: {
            get: (key: string) =>
              key === 'x-payment-required' ? encodeHeader(payload) : null,
            forEach: () => {},
          },
        });
      }
      // facilitator HEAD
      return Promise.resolve({
        status: 200,
        headers: { get: () => null, forEach: () => {} },
      });
    }) as unknown as typeof fetch;

    const result = await checkX402('https://example.com/api', { verbose: true });
    expect(result.facilitatorCheck).toBeDefined();
    expect(result.facilitatorCheck?.reachable).toBe(true);
  });

  it('returns supported=false on 200 (no paywall)', async () => {
    globalThis.fetch = mockFetch(200) as unknown as typeof fetch;
    const result = await checkX402('https://example.com/free');
    expect(result.supported).toBe(false);
    expect(result.status).toBe(200);
    expect(result.paymentDetails).toBeUndefined();
  });

  it('returns supported=false on 500 (server error)', async () => {
    globalThis.fetch = mockFetch(500) as unknown as typeof fetch;
    const result = await checkX402('https://example.com/broken');
    expect(result.supported).toBe(false);
    expect(result.status).toBe(500);
  });

  it('returns error on timeout', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    ) as unknown as typeof fetch;

    const result = await checkX402('https://example.com/slow', { timeout: 100 });
    expect(result.supported).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toMatch(/timed out/i);
  });

  it('returns error on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new TypeError('fetch failed')
    ) as unknown as typeof fetch;

    const result = await checkX402('https://nonexistent.invalid/');
    expect(result.supported).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toBeTruthy();
  });

  it('handles 402 with no payment header and no body gracefully', async () => {
    globalThis.fetch = mockFetch(402) as unknown as typeof fetch;
    const result = await checkX402('https://example.com/legacy-402');
    expect(result.supported).toBe(false);
    expect(result.status).toBe(402);
    expect(result.error).toMatch(/no x402 payment header or body/i);
  });

  it('detects x402 from JSON response body when no header present', async () => {
    const bodyPayload = {
      error: 'X-PAYMENT header is required',
      accepts: [
        {
          scheme: 'exact',
          network: 'base',
          maxAmountRequired: '990000',
          resource: 'https://pay.example.com/api/skill',
          payTo: '0xb92AAb592cBeD6a12a6e17DdF65e96050c268BC8',
          maxTimeoutSeconds: 300,
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        },
      ],
      x402Version: 1,
    };
    globalThis.fetch = mockFetch(
      402,
      { 'content-type': 'application/json' },
      bodyPayload
    ) as unknown as typeof fetch;
    const result = await checkX402('https://pay.example.com/api/skill');
    expect(result.supported).toBe(true);
    expect(result.status).toBe(402);
    expect(result.paymentDetails).toBeDefined();
    expect(result.paymentDetails?.x402Version).toBe(1);
    expect(result.paymentDetails?.accepts).toHaveLength(1);
  });

  it('handles malformed payment header gracefully', async () => {
    globalThis.fetch = mockFetch(402, {
      'x-payment-required': 'not-valid-base64-json!!!',
    }) as unknown as typeof fetch;

    const result = await checkX402('https://example.com/malformed');
    expect(result.supported).toBe(false);
    expect(result.status).toBe(402);
    expect(result.error).toMatch(/failed to decode/i);
  });

  it('includes headers in verbose mode', async () => {
    globalThis.fetch = mockFetch(200, { 'content-type': 'application/json' }) as unknown as typeof fetch;
    const result = await checkX402('https://example.com/free', { verbose: true });
    expect(result.headers).toBeDefined();
    expect(result.headers?.['content-type']).toBe('application/json');
  });

  it('accepts alternate payment-required header name', async () => {
    const pr = makeLegacyPaymentRequired();
    globalThis.fetch = mockFetch(402, {
      'payment-required': encodeHeader(pr),
    }) as unknown as typeof fetch;

    const result = await checkX402('https://example.com/alt-header');
    expect(result.supported).toBe(true);
  });
});
