import type {
  X402Result,
  PaymentRequired,
  CheckOptions,
  FacilitatorResult,
} from './types.js';
import { validateSchema } from './validator.js';

const PAYMENT_HEADER = 'x-payment-required';
const PAYMENT_HEADER_ALT = 'payment-required';

export function decodePaymentRequired(header: string): PaymentRequired {
  const decoded = Buffer.from(header, 'base64').toString('utf-8');
  const parsed: unknown = JSON.parse(decoded);

  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Invalid PaymentRequired structure: payload must be an object');
  }

  const p = parsed as Record<string, unknown>;

  // Accept both the v1 spec structure (x402Version + accepts) and older flat structures.
  const hasNewStructure = 'x402Version' in p || 'accepts' in p || 'facilitatorUrl' in p;
  const hasLegacyStructure =
    'payTo' in p &&
    'scheme' in p &&
    'network' in p &&
    'maxAmountRequired' in p;

  if (!hasNewStructure && !hasLegacyStructure) {
    throw new Error(
      'Invalid PaymentRequired structure: missing or malformed required fields'
    );
  }

  return parsed as PaymentRequired;
}

/**
 * Check if the facilitator URL is reachable by sending a HEAD request.
 * HTTP 2xx/3xx = reachable, 4xx/5xx/timeout = not reachable (warning).
 *
 * #6: Only https:// facilitator URLs are accepted to prevent SSRF via HTTP downgrade.
 */
export async function checkFacilitator(
  facilitatorUrl: string,
  timeout = 5000
): Promise<FacilitatorResult> {
  // #6: Require https:// — reject plain http and other schemes
  if (!facilitatorUrl.startsWith('https://')) {
    return {
      url: facilitatorUrl,
      reachable: false,
      error: 'Facilitator URL must use https://',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    // #11: redirect: 'follow' is intentional here for the CLI library — the facilitator
    // may legitimately redirect (e.g. http→https). The CLI does not expose user-controlled
    // redirect targets, so the SSRF risk is lower than in the worker context.
    const response = await fetch(facilitatorUrl, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'x402-validate/1.1.0 (https://github.com/a2alist/x402-validate)',
      },
    });
    clearTimeout(timer);
    const reachable = response.status >= 200 && response.status < 400;
    return { url: facilitatorUrl, reachable, status: response.status };
  } catch (err: unknown) {
    clearTimeout(timer);
    const isTimeout =
      err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
    return {
      url: facilitatorUrl,
      reachable: false,
      error: isTimeout ? `Facilitator timed out after ${timeout}ms` : String(err),
    };
  }
}

/**
 * Probe /.well-known/x402.json on the origin of the given URL.
 * Returns the parsed payload or null if not found / invalid.
 */
async function probeWellKnown(
  url: string,
  timeout: number
): Promise<PaymentRequired | null> {
  try {
    const origin = new URL(url).origin;
    const wellKnownUrl = `${origin}/.well-known/x402.json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(wellKnownUrl, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'x402-validate/1.1.1 (https://github.com/suryast/x402-check)',
      },
    });
    clearTimeout(timer);

    if (response.status !== 200) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) return null;

    const body = (await response.json()) as Record<string, unknown>;

    // Must have x402Version or endpoints to be valid
    if (!body.x402Version && !body.endpoints) return null;

    return body as unknown as PaymentRequired;
  } catch {
    return null;
  }
}

export async function checkX402(url: string, options: CheckOptions = {}): Promise<X402Result> {
  const { timeout = 10000, verbose = false, checkFacilitator: doFacilitator } = options;
  // Run facilitator check when explicitly requested or when verbose
  const shouldCheckFacilitator = doFacilitator !== undefined ? doFacilitator : verbose;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    // #11: redirect: 'follow' is kept for the CLI library. x402 endpoints may sit behind
    // a load balancer that issues a redirect before serving the 402. The CLI operates on
    // user-supplied URLs (not worker-proxied ones), so following redirects is acceptable.
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'x402-validate/1.1.0 (https://github.com/a2alist/x402-validate)',
      },
    });

    clearTimeout(timer);

    const headersObj: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersObj[key] = value;
    });

    // x402 detection: HTTP 402 + payment header
    if (response.status === 402) {
      const rawHeader =
        response.headers.get(PAYMENT_HEADER) ||
        response.headers.get(PAYMENT_HEADER_ALT) ||
        null;

      if (rawHeader) {
        try {
          const paymentDetails = decodePaymentRequired(rawHeader);

          // Run schema validation
          const schemaValidation = validateSchema(paymentDetails as unknown);

          // Run facilitator check if requested
          let facilitatorCheck: FacilitatorResult | undefined;
          if (shouldCheckFacilitator && paymentDetails.facilitatorUrl) {
            facilitatorCheck = await checkFacilitator(
              paymentDetails.facilitatorUrl,
              Math.min(timeout, 5000)
            );
          }

          return {
            url,
            supported: true,
            status: 402,
            paymentDetails,
            rawHeader,
            schemaValidation,
            ...(facilitatorCheck ? { facilitatorCheck } : {}),
            ...(verbose ? { headers: headersObj } : {}),
          };
        } catch {
          return {
            url,
            supported: false,
            status: 402,
            rawHeader,
            error: 'Found 402 with payment header but failed to decode payload',
            ...(verbose ? { headers: headersObj } : {}),
          };
        }
      }

      // 402 but no recognised payment header
      return {
        url,
        supported: false,
        status: 402,
        error: 'HTTP 402 but no x402 payment header found',
        ...(verbose ? { headers: headersObj } : {}),
      };
    }

    // No 402 — try /.well-known/x402.json discovery
    const wellKnown = await probeWellKnown(url, Math.min(timeout, 5000));
    if (wellKnown) {
      const schemaValidation = validateSchema(wellKnown as unknown);

      let facilitatorCheck: FacilitatorResult | undefined;
      if (shouldCheckFacilitator && wellKnown.facilitatorUrl) {
        facilitatorCheck = await checkFacilitator(
          wellKnown.facilitatorUrl,
          Math.min(timeout, 5000)
        );
      }

      return {
        url,
        supported: true,
        status: response.status,
        paymentDetails: wellKnown,
        schemaValidation,
        ...(facilitatorCheck ? { facilitatorCheck } : {}),
        ...(verbose ? { headers: headersObj } : {}),
      };
    }

    return {
      url,
      supported: false,
      status: response.status,
      ...(verbose ? { headers: headersObj } : {}),
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    const isTimeout =
      err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
    return {
      url,
      supported: false,
      status: 0,
      error: isTimeout ? `Request timed out after ${timeout}ms` : String(err),
    };
  }
}
