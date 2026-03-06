/**
 * submit.ts — a2alist.ai submission client for x402-check
 *
 * Submits discovered x402 endpoints to the a2alist.ai directory.
 *
 * API endpoint (expected):
 *   POST https://a2alist.ai/api/submit
 *   Content-Type: application/json
 *   Body: A2AListSubmission (see below)
 *
 * Auth: No auth required for initial submission (community-contributed listings).
 * Rate limit: Expected to be enforced server-side by IP.
 */

import type { PaymentRequired } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Payload shape submitted to a2alist.ai */
export interface A2AListSubmission {
  /** The URL of the x402-enabled endpoint */
  url: string;

  /** ISO 8601 timestamp when the submission was created */
  submittedAt: string;

  /** Source identifier for tracking where submissions come from */
  source: 'x402-check-cli' | 'x402-extension' | 'x402-api';

  /** Version of x402-check that generated this submission */
  toolVersion: string;

  /** The full PaymentRequired payload decoded from the endpoint */
  paymentInfo: {
    network: string;
    scheme: string;
    maxAmountRequired: string;
    resource: string;
    description?: string | null;
    payTo: Array<{
      address: string;
      amount: string;
      token?: string;
      chain?: string | number;
    }>;
  };

  /**
   * Optional metadata for enriching the directory listing.
   * These fields are hints — a2alist.ai may ignore or override them.
   */
  meta?: {
    /** Human-readable site/service name, if detectable */
    name?: string;
    /** Short description of what this service provides */
    description?: string;
    /** Category hint: e.g. "api", "content", "ai-service", "data" */
    category?: string;
    /** Tags for discovery */
    tags?: string[];
  };
}

/** Response from a2alist.ai /api/submit */
export interface A2AListSubmissionResult {
  success: boolean;
  /** Assigned listing ID if created */
  id?: string;
  /** Human-readable message */
  message?: string;
  /** URL of the new/existing listing */
  listingUrl?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const A2A_API_BASE = 'https://a2alist.ai/api';
const SUBMIT_ENDPOINT = `${A2A_API_BASE}/submit`;
const TOOL_VERSION = '1.0.0';
const DEFAULT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Submit a discovered x402 endpoint to the a2alist.ai directory.
 *
 * @param url         - The full URL of the x402 endpoint (e.g. https://example.com/api/data)
 * @param paymentInfo - The decoded PaymentRequired payload from the endpoint
 * @param options     - Optional config overrides
 * @returns           - true if submission was accepted, false otherwise
 *
 * @example
 * ```ts
 * import { checkX402 } from 'x402-check';
 * import { submitToA2AList } from 'x402-check/submit';
 *
 * const result = await checkX402('https://example.com/api/data');
 * if (result.supported && result.paymentDetails) {
 *   const ok = await submitToA2AList(result.url, result.paymentDetails);
 *   console.log(ok ? 'Submitted!' : 'Submission failed');
 * }
 * ```
 */
export async function submitToA2AList(
  url: string,
  paymentInfo: PaymentRequired,
  options: {
    /** Override the submission endpoint (useful for testing) */
    endpoint?: string;
    /** Request timeout in milliseconds (default: 10000) */
    timeoutMs?: number;
    /** Additional metadata to include in the submission */
    meta?: A2AListSubmission['meta'];
    /** Submission source identifier */
    source?: A2AListSubmission['source'];
    /** If true, logs the payload without sending */
    dryRun?: boolean;
  } = {}
): Promise<boolean> {
  const {
    endpoint = SUBMIT_ENDPOINT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    meta,
    source = 'x402-check-cli',
    dryRun = false,
  } = options;

  const payload = buildSubmissionPayload(url, paymentInfo, { source, meta });

  if (dryRun) {
    console.log('[x402-check] Dry run — submission payload:');
    console.log(JSON.stringify(payload, null, 2));
    return true;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `x402-check/${TOOL_VERSION}`,
        'X-Submission-Source': source,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const result = await response.json().catch(() => ({
      success: response.ok,
    })) as A2AListSubmissionResult;

    return result.success === true;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Submission timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Payload builder (exported for testing and extension reuse)
// ---------------------------------------------------------------------------

/**
 * Build the submission payload without sending it.
 * Useful for previewing what will be sent or for extension use.
 */
export function buildSubmissionPayload(
  url: string,
  paymentInfo: PaymentRequired,
  options: {
    source?: A2AListSubmission['source'];
    meta?: A2AListSubmission['meta'];
  } = {}
): A2AListSubmission {
  const { source = 'x402-check-cli', meta } = options;

  // Support both v1 spec (accepts array) and legacy flat structure
  const legacyPayTo = Array.isArray(paymentInfo.payTo) ? paymentInfo.payTo : [];
  const firstAccept = paymentInfo.accepts?.[0];

  return {
    url,
    submittedAt: new Date().toISOString(),
    source,
    toolVersion: TOOL_VERSION,
    paymentInfo: {
      network: firstAccept?.network ?? paymentInfo.network ?? '',
      scheme: firstAccept?.scheme ?? paymentInfo.scheme ?? '',
      maxAmountRequired: firstAccept?.maxAmountRequired ?? paymentInfo.maxAmountRequired ?? '',
      resource: firstAccept?.resource ?? paymentInfo.resource ?? url,
      description: firstAccept?.description ?? paymentInfo.description ?? null,
      payTo: legacyPayTo.map((p) => ({
        address: p.address,
        amount: p.amount,
        ...(p.token ? { token: p.token } : {}),
        ...(p.chain !== undefined ? { chain: p.chain } : {}),
      })),
    },
    ...(meta ? { meta } : {}),
  };
}

// ---------------------------------------------------------------------------
// Batch submission helper
// ---------------------------------------------------------------------------

/**
 * Submit multiple discovered x402 endpoints in sequence.
 * Respects a small delay between requests to avoid hammering the API.
 *
 * @returns Object with success count and list of failed URLs
 */
export async function submitBatchToA2AList(
  entries: Array<{ url: string; paymentInfo: PaymentRequired }>,
  options: {
    endpoint?: string;
    timeoutMs?: number;
    delayMs?: number;
    dryRun?: boolean;
    onProgress?: (url: string, success: boolean, index: number, total: number) => void;
  } = {}
): Promise<{ successCount: number; failedUrls: string[] }> {
  const { delayMs = 500, onProgress, ...submitOptions } = options;
  let successCount = 0;
  const failedUrls: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const { url, paymentInfo } = entries[i];
    try {
      const ok = await submitToA2AList(url, paymentInfo, submitOptions);
      if (ok) {
        successCount++;
      } else {
        failedUrls.push(url);
      }
      onProgress?.(url, ok, i + 1, entries.length);
    } catch {
      failedUrls.push(url);
      onProgress?.(url, false, i + 1, entries.length);
    }

    // Delay between submissions (skip after last)
    if (i < entries.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { successCount, failedUrls };
}
