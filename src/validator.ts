import type { PaymentRequired, AcceptsEntry, ValidationResult } from './types.js';

const REQUIRED_ACCEPTS_FIELDS: Array<keyof AcceptsEntry> = [
  'scheme',
  'network',
  'maxAmountRequired',
  'resource',
  'description',
  'mimeType',
  'payTo',
];

function isValidUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate a decoded PaymentRequired payload against the x402 spec.
 *
 * Supports two document types:
 *
 * 1. **Payment response** (402 body or header):
 *    - x402Version (number)
 *    - accepts (array with scheme/network/maxAmountRequired/payTo etc.)
 *    - facilitatorUrl (string, valid http(s) URL)
 *
 * 2. **Discovery document** (.well-known/x402.json):
 *    - x402Version (number)
 *    - endpoints (array with path/method/description)
 *
 * Returns { valid, errors, warnings }.
 */
export function validateSchema(payload: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (payload === null || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a non-null object'], warnings };
  }

  const p = payload as Record<string, unknown>;

  // ── x402Version ──────────────────────────────────────────────────────────
  if (!('x402Version' in p)) {
    errors.push('Missing required field: x402Version');
  } else if (typeof p.x402Version !== 'number') {
    errors.push(`x402Version must be a number, got ${typeof p.x402Version}`);
  } else if (!Number.isInteger(p.x402Version) || p.x402Version < 1) {
    warnings.push(`x402Version should be a positive integer (got ${p.x402Version})`);
  }

  // ── Detect document type ─────────────────────────────────────────────────
  const isDiscoveryDoc = 'endpoints' in p && !('accepts' in p);

  if (isDiscoveryDoc) {
    // Discovery document validation
    if (!Array.isArray(p.endpoints)) {
      errors.push('endpoints must be an array');
    } else if (p.endpoints.length === 0) {
      errors.push('endpoints must contain at least one entry');
    } else {
      (p.endpoints as unknown[]).forEach((entry, idx) => {
        if (entry === null || typeof entry !== 'object') {
          errors.push(`endpoints[${idx}] must be an object`);
          return;
        }
        const e = entry as Record<string, unknown>;
        if (!('path' in e) || typeof e.path !== 'string') {
          errors.push(`endpoints[${idx}].path is required and must be a string`);
        }
      });
    }
  } else {
    // Payment response validation

    // ── accepts ──────────────────────────────────────────────────────────────
    if (!('accepts' in p)) {
      errors.push('Missing required field: accepts');
    } else if (!Array.isArray(p.accepts)) {
      errors.push('accepts must be an array');
    } else if (p.accepts.length === 0) {
      errors.push('accepts must contain at least one entry');
    } else {
      (p.accepts as unknown[]).forEach((entry, idx) => {
        if (entry === null || typeof entry !== 'object') {
          errors.push(`accepts[${idx}] must be an object`);
          return;
        }
        const e = entry as Record<string, unknown>;
        for (const field of REQUIRED_ACCEPTS_FIELDS) {
          if (!(field in e) || e[field] === undefined || e[field] === null || e[field] === '') {
            errors.push(`accepts[${idx}].${field} is required`);
          } else if (
            field !== 'maxTimeoutSeconds' &&
            typeof e[field] !== 'string'
          ) {
            errors.push(`accepts[${idx}].${field} must be a string`);
          }
        }
        if ('maxTimeoutSeconds' in e && e.maxTimeoutSeconds !== undefined) {
          if (typeof e.maxTimeoutSeconds !== 'number') {
            errors.push(`accepts[${idx}].maxTimeoutSeconds must be a number`);
          }
        }
        if ('resource' in e && typeof e.resource === 'string') {
          if (!isValidUrl(e.resource)) {
            warnings.push(`accepts[${idx}].resource doesn't look like a valid URL: ${e.resource}`);
          }
        }
      });
    }

    // ── facilitatorUrl ───────────────────────────────────────────────────────
    if (!('facilitatorUrl' in p)) {
      warnings.push('Missing facilitatorUrl (optional for body-based x402)');
    } else if (!isValidUrl(p.facilitatorUrl)) {
      errors.push(
        `facilitatorUrl must be a valid http(s) URL, got: ${JSON.stringify(p.facilitatorUrl)}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Convenience: validate a PaymentRequired object (typed variant).
 */
export function validatePaymentRequired(pr: PaymentRequired): ValidationResult {
  return validateSchema(pr as unknown);
}
