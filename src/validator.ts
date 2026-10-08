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

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['Payload must be a non-null object'], warnings };
  }

  const p = payload as Record<string, unknown>;

  if (p.x402Version === 2 && !('endpoints' in p && !('accepts' in p))) {
    return validateV2(p);
  }

  // ── x402Version ──────────────────────────────────────────────────────────
  if (!('x402Version' in p)) {
    errors.push('Missing required field: x402Version');
  } else if (typeof p.x402Version !== 'number') {
    errors.push(`x402Version must be a number, got ${typeof p.x402Version}`);
  } else if (p.x402Version !== 1 && p.x402Version !== 2) {
    errors.push(`Unsupported x402Version: ${p.x402Version} (supported: 1, 2)`);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Structural challenge validation only; no authorization or settlement proof. */
function validateV2(p: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const text = (value: unknown, path: string) => {
    if (typeof value !== 'string' || value.trim() === '') errors.push(`${path} must be a non-empty string`);
  };
  if (!isRecord(p.resource)) errors.push('resource must be a ResourceInfo object');
  else {
    if (!isValidUrl(p.resource.url)) errors.push('resource.url must be a valid http(s) URL');
    for (const field of ['description', 'mimeType']) {
      if (field in p.resource && typeof p.resource[field] !== 'string') errors.push(`resource.${field} must be a string`);
    }
  }
  if ('error' in p && typeof p.error !== 'string') errors.push('error must be a string');
  if ('extensions' in p) {
    if (!isRecord(p.extensions)) errors.push('extensions must be an object');
    else for (const [key, value] of Object.entries(p.extensions)) {
      if (!isRecord(value) || !isRecord(value.info) || !isRecord(value.schema)) {
        errors.push(`extensions.${key} must contain info and schema objects`);
      }
    }
  }
  if (!Array.isArray(p.accepts) || p.accepts.length === 0) errors.push('accepts must contain at least one entry');
  else p.accepts.forEach((entry: unknown, i: number) => {
    const path = `accepts[${i}]`;
    if (!isRecord(entry)) { errors.push(`${path} must be an object`); return; }
    for (const field of ['scheme', 'network', 'amount', 'asset', 'payTo']) text(entry[field], `${path}.${field}`);
    if (typeof entry.network !== 'string' || !/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/.test(entry.network)) {
      errors.push(`${path}.network must use CAIP-2 format`);
    }
    if (typeof entry.amount !== 'string' || !/^\d+$/.test(entry.amount)) errors.push(`${path}.amount must be an unsigned atomic-unit integer string`);
    if (typeof entry.maxTimeoutSeconds !== 'number' || !Number.isSafeInteger(entry.maxTimeoutSeconds) || entry.maxTimeoutSeconds <= 0) {
      errors.push(`${path}.maxTimeoutSeconds must be a positive safe integer`);
    }
    if ('extra' in entry && !isRecord(entry.extra)) errors.push(`${path}.extra must be an object`);
  });
  if ('facilitatorUrl' in p && !isValidUrl(p.facilitatorUrl)) errors.push('facilitatorUrl must be a valid http(s) URL');
  return { valid: errors.length === 0, errors, warnings: [] };
}
