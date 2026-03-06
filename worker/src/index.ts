/**
 * x402-check API — Cloudflare Worker
 *
 * Endpoints:
 *   GET  /check?url=<url>       Check single URL for x402 support
 *   POST /check/batch            Check multiple URLs (max 10)
 *   GET  /badge/<domain>.svg     Dynamic SVG badge (cached 1h)
 *   GET  /health                 Health check
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Env {
  RATE_LIMITS: KVNamespace;
  MAX_BATCH_SIZE?: string;
  RATE_LIMIT_PER_DAY?: string;
}

interface PayTo {
  address: string;
  amount: string;
  token?: string;
  chain?: string | number;
  network?: string;
}

interface PaymentRequired {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  estimatedProcessingTime?: number;
  extra?: Record<string, unknown>;
  payTo: PayTo[];
  requiredDeadlineSeconds?: number;
}

interface X402Result {
  url: string;
  x402: boolean;
  paymentInfo: PaymentRequired | null;
  facilitator: { reachable: boolean; url?: string } | null;
  checkedAt: string;
  error?: string;
}

interface RateLimitState {
  count: number;
  resetAt: number; // unix seconds
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_AGENT = 'x402-check-api/1.0.0 (https://github.com/a2alist/x402-check)';
const PAYMENT_HEADER = 'x-payment-required';
const PAYMENT_HEADER_ALT = 'payment-required';
const CHECK_TIMEOUT_MS = 10_000;
const BADGE_CACHE_SECONDS = 3600; // 1 hour

// ---------------------------------------------------------------------------
// URL Validation
// ---------------------------------------------------------------------------

export function isValidUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function extractDomain(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// SSRF Protection — private/loopback IP blocklist (#1, #6)
// ---------------------------------------------------------------------------

/**
 * Returns true if the hostname is a private/loopback/link-local address
 * that must not be fetched (SSRF protection).
 * Checks IPv4 private ranges, IPv6 loopback, ULA (fc00::/7), and localhost.
 */
export function isPrivateHostname(hostname: string): boolean {
  // Strip IPv6 brackets: [::1] → ::1
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Reject localhost and 0.0.0.0 by name
  if (h === 'localhost' || h === '0.0.0.0') return true;

  // IPv6 loopback and ULA (fc00::/7 covers fc** and fd**)
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd')) return true;

  // IPv4 private ranges
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 0 ||                              // 0.0.0.0/8
      a === 10 ||                             // 10.0.0.0/8
      a === 127 ||                            // 127.0.0.0/8 loopback
      (a === 169 && b === 254) ||             // 169.254.0.0/16 link-local
      (a === 172 && b >= 16 && b <= 31) ||    // 172.16.0.0/12
      (a === 192 && b === 168)                // 192.168.0.0/16
    );
  }

  return false;
}

/**
 * Returns an error message if the URL is blocked for SSRF reasons, or null if safe.
 * Validates https:// scheme and blocks private/loopback hostnames.
 */
function ssrfGuard(raw: string, requireHttps = false): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'Invalid URL';
  }
  if (requireHttps && u.protocol !== 'https:') {
    return 'URL must use https://';
  }
  if (isPrivateHostname(u.hostname)) {
    return `Blocked: private/loopback hostname (${u.hostname})`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rate Limiting (KV-backed, per-IP, 100 req/day free)
// ---------------------------------------------------------------------------

export async function checkRateLimit(
  kv: KVNamespace,
  ip: string,
  limitPerDay: number,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const key = `rl:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  // reset time = midnight UTC tomorrow
  const midnight = now - (now % 86400) + 86400;

  const raw = await kv.get(key);
  let state: RateLimitState;

  if (!raw) {
    state = { count: 0, resetAt: midnight };
  } else {
    state = JSON.parse(raw) as RateLimitState;
    // if we're past the reset time, start fresh
    if (now >= state.resetAt) {
      state = { count: 0, resetAt: midnight };
    }
  }

  const allowed = state.count < limitPerDay;
  if (allowed) {
    state.count += 1;
    const ttl = state.resetAt - now;
    await kv.put(key, JSON.stringify(state), { expirationTtl: Math.max(ttl, 1) });
  }

  return {
    allowed,
    remaining: Math.max(0, limitPerDay - state.count),
    resetAt: state.resetAt,
  };
}

// ---------------------------------------------------------------------------
// x402 Core Checker
// ---------------------------------------------------------------------------

export function decodePaymentRequired(header: string): PaymentRequired {
  const decoded = atob(header);
  const parsed: unknown = JSON.parse(decoded);

  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('payTo' in parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).payTo) ||
    !('scheme' in parsed) ||
    typeof (parsed as Record<string, unknown>).scheme !== 'string' ||
    !('network' in parsed) ||
    typeof (parsed as Record<string, unknown>).network !== 'string' ||
    !('maxAmountRequired' in parsed) ||
    typeof (parsed as Record<string, unknown>).maxAmountRequired !== 'string'
  ) {
    throw new Error('Invalid PaymentRequired: missing required fields');
  }

  return parsed as PaymentRequired;
}

async function probeFacilitator(
  paymentInfo: PaymentRequired,
): Promise<{ reachable: boolean; url?: string }> {
  // Extract facilitator URL from payTo or extra fields
  const facilitatorUrl =
    (paymentInfo.extra?.['facilitatorUrl'] as string | undefined) ||
    (paymentInfo.extra?.['facilitator'] as string | undefined);

  if (!facilitatorUrl) {
    return { reachable: false };
  }

  // #6: Validate facilitator URL is https:// and not a private IP (SSRF)
  const blocked = ssrfGuard(facilitatorUrl, /* requireHttps */ true);
  if (blocked) {
    return { reachable: false, url: facilitatorUrl };
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(facilitatorUrl, {
      method: 'HEAD',
      signal: ctrl.signal,
      redirect: 'manual', // #11: do not follow redirects
      headers: { 'User-Agent': USER_AGENT },
    });
    clearTimeout(timer);
    return { reachable: res.ok || res.status < 500, url: facilitatorUrl };
  } catch {
    return { reachable: false, url: facilitatorUrl };
  }
}

export async function checkUrl(url: string): Promise<X402Result> {
  const checkedAt = new Date().toISOString();

  // #1: Block SSRF — reject private/loopback hostnames before fetching
  const blocked = ssrfGuard(url);
  if (blocked) {
    return {
      url,
      x402: false,
      paymentInfo: null,
      facilitator: null,
      checkedAt,
      error: `Blocked: ${blocked}`,
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      redirect: 'manual', // #11: do not follow redirects to avoid redirect-based SSRF
      headers: { 'User-Agent': USER_AGENT },
    });
    clearTimeout(timer);

    if (response.status !== 402) {
      return { url, x402: false, paymentInfo: null, facilitator: null, checkedAt };
    }

    const rawHeader =
      response.headers.get(PAYMENT_HEADER) || response.headers.get(PAYMENT_HEADER_ALT);

    if (!rawHeader) {
      // Try parsing JSON body — many x402 implementations (e.g. x402-hono)
      // put payment details in the response body instead of headers
      try {
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('json')) {
          const body = (await response.json()) as Record<string, unknown>;
          if (body.x402Version || body.accepts) {
            // Body-based x402 detected — extract payment info
            const accepts = body.accepts as Record<string, unknown>[] | undefined;
            const firstAccept = accepts?.[0];
            const paymentInfo = firstAccept
              ? (firstAccept as unknown as PaymentRequired)
              : (body as unknown as PaymentRequired);
            const facilitator = await probeFacilitator(paymentInfo);
            return { url, x402: true, paymentInfo, facilitator, checkedAt };
          }
        }
      } catch {
        // Body parsing failed — fall through
      }

      return {
        url,
        x402: false,
        paymentInfo: null,
        facilitator: null,
        checkedAt,
        error: 'HTTP 402 but no x402 payment header or body found',
      };
    }

    let paymentInfo: PaymentRequired;
    try {
      paymentInfo = decodePaymentRequired(rawHeader);
    } catch (e) {
      return {
        url,
        x402: false,
        paymentInfo: null,
        facilitator: null,
        checkedAt,
        error: `Failed to decode payment header: ${String(e)}`,
      };
    }

    const facilitator = await probeFacilitator(paymentInfo);

    return { url, x402: true, paymentInfo, facilitator, checkedAt };
  } catch (err: unknown) {
    clearTimeout(timer);
    const isTimeout =
      err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
    return {
      url,
      x402: false,
      paymentInfo: null,
      facilitator: null,
      checkedAt,
      error: isTimeout ? `Timed out after ${CHECK_TIMEOUT_MS}ms` : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Badge SVG Generation
// ---------------------------------------------------------------------------

/** Escape special XML/HTML characters to prevent injection in SVG output. (#14) */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateBadgeSvg(domain: string, supported: boolean): string {
  const safeDomain = escapeXml(domain); // #14: escape domain before embedding in SVG
  const label = 'x402';
  const message = supported ? 'supported' : 'not supported';
  const color = supported ? '#4c9e5f' : '#e05d44';
  const labelWidth = 42;
  const messageWidth = supported ? 84 : 100;
  const totalWidth = labelWidth + messageWidth;
  const labelX = Math.floor(labelWidth / 2) + 1;
  const messageX = labelWidth + Math.floor(messageWidth / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${message}">
  <title>${label}: ${message}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="110">
    <text aria-hidden="true" x="${labelX * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - 10) * 10}" lengthAdjust="spacing">${label}</text>
    <text x="${labelX * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(labelWidth - 10) * 10}" lengthAdjust="spacing">${label}</text>
    <text aria-hidden="true" x="${messageX * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(messageWidth - 10) * 10}" lengthAdjust="spacing">${safeDomain}: ${message}</text>
    <text x="${messageX * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(messageWidth - 10) * 10}" lengthAdjust="spacing">${message}</text>
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
      ...extra,
    },
  });
}

function errorResponse(message: string, status: number, extra: Record<string, string> = {}): Response {
  return jsonResponse({ error: message }, status, extra);
}

// ---------------------------------------------------------------------------
// Main Worker Handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ------------------------------------------------------------------
    // Rate limiting (skip for health check)
    // ------------------------------------------------------------------
    const limitPerDay = parseInt(env.RATE_LIMIT_PER_DAY ?? '100', 10);
    const maxBatch = parseInt(env.MAX_BATCH_SIZE ?? '10', 10);

    let rateLimitHeaders: Record<string, string> = {};

    if (path !== '/health') {
      // #3: Use ONLY CF-Connecting-IP — do NOT trust X-Forwarded-For (rate limit bypass)
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

      const rl = await checkRateLimit(env.RATE_LIMITS, ip, limitPerDay);
      rateLimitHeaders = {
        'X-RateLimit-Limit': String(limitPerDay),
        'X-RateLimit-Remaining': String(rl.remaining),
        'X-RateLimit-Reset': String(rl.resetAt),
      };

      if (!rl.allowed) {
        return errorResponse('Rate limit exceeded. Free tier: 100 requests/day.', 429, rateLimitHeaders);
      }
    }

    // ------------------------------------------------------------------
    // GET /health
    // ------------------------------------------------------------------
    if (request.method === 'GET' && path === '/health') {
      return jsonResponse({ status: 'ok', version: '1.0.0' });
    }

    // ------------------------------------------------------------------
    // GET /check?url=<url>
    // ------------------------------------------------------------------
    if (request.method === 'GET' && path === '/check') {
      const targetUrl = url.searchParams.get('url');

      if (!targetUrl) {
        return errorResponse('Missing required query param: url', 400, rateLimitHeaders);
      }

      if (!isValidUrl(targetUrl)) {
        return errorResponse('Invalid URL. Must be a valid http:// or https:// URL.', 400, rateLimitHeaders);
      }

      const result = await checkUrl(targetUrl);
      return jsonResponse(result, 200, rateLimitHeaders);
    }

    // ------------------------------------------------------------------
    // POST /check/batch
    // ------------------------------------------------------------------
    if (request.method === 'POST' && path === '/check/batch') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return errorResponse('Invalid JSON body', 400, rateLimitHeaders);
      }

      if (
        typeof body !== 'object' ||
        body === null ||
        !('urls' in body) ||
        !Array.isArray((body as { urls: unknown }).urls)
      ) {
        return errorResponse('Body must be { urls: string[] }', 400, rateLimitHeaders);
      }

      const urls = (body as { urls: unknown[] }).urls;

      if (urls.length === 0) {
        return errorResponse('urls array must not be empty', 400, rateLimitHeaders);
      }

      if (urls.length > maxBatch) {
        return errorResponse(`Max batch size is ${maxBatch} URLs`, 400, rateLimitHeaders);
      }

      // Validate all URLs first
      const invalid = urls.filter((u) => typeof u !== 'string' || !isValidUrl(u));
      if (invalid.length > 0) {
        return errorResponse(
          `Invalid URLs found: ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '...' : ''}`,
          400,
          rateLimitHeaders,
        );
      }

      // Check all URLs concurrently
      const results = await Promise.all((urls as string[]).map((u) => checkUrl(u)));
      return jsonResponse({ results }, 200, rateLimitHeaders);
    }

    // ------------------------------------------------------------------
    // GET /badge/<domain>.svg
    // ------------------------------------------------------------------
    const badgeMatch = path.match(/^\/badge\/([^/]+)\.svg$/);
    if (request.method === 'GET' && badgeMatch) {
      const domain = decodeURIComponent(badgeMatch[1]);

      // Validate domain looks reasonable (no full URLs here, just domain)
      if (!/^[a-zA-Z0-9]([a-zA-Z0-9\-\.]{0,251}[a-zA-Z0-9])?$/.test(domain)) {
        return errorResponse('Invalid domain in badge URL', 400, rateLimitHeaders);
      }

      const targetUrl = `https://${domain}`;
      const result = await checkUrl(targetUrl);
      const svg = generateBadgeSvg(domain, result.x402);

      return new Response(svg, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': `public, max-age=${BADGE_CACHE_SECONDS}`,
          'CDN-Cache-Control': `public, max-age=${BADGE_CACHE_SECONDS}`,
          ...corsHeaders(),
          ...rateLimitHeaders,
        },
      });
    }

    // ------------------------------------------------------------------
    // 404
    // ------------------------------------------------------------------
    return errorResponse(
      'Not found. Available endpoints: GET /check?url=, POST /check/batch, GET /badge/<domain>.svg',
      404,
      rateLimitHeaders,
    );
  },
} satisfies ExportedHandler<Env>;
