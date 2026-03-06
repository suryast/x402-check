import { checkX402 } from './checker.js';
import type { CheckOptions, X402Result } from './types.js';

export interface WatchOptions extends CheckOptions {
  /** Re-check interval in seconds. Default: 60 */
  interval?: number;
  /** Called after each check cycle with results + timestamp */
  onResult?: (results: X402Result[], timestamp: Date) => void;
}

/**
 * Watch a list of URLs, re-checking every `interval` seconds.
 * Runs an immediate check on start, then repeats on the interval.
 *
 * @param urls - URLs to check
 * @param options - Watch options (interval, timeout, onResult callback)
 * @returns Cleanup function — call it to stop watching
 *
 * @example
 * const stop = await watchUrls(['https://api.example.com/resource'], {
 *   interval: 30,
 *   onResult: (results, ts) => {
 *     for (const r of results) {
 *       console.log(`[${ts.toISOString()}] ${r.url}: ${r.supported ? '✓ found' : '✗ not found'}`);
 *     }
 *   },
 * });
 *
 * // Stop after 5 minutes
 * setTimeout(stop, 5 * 60 * 1000);
 */
export async function watchUrls(
  urls: string[],
  options: WatchOptions = {}
): Promise<() => void> {
  const intervalMs = (options.interval ?? 60) * 1000;

  async function runCheck(): Promise<void> {
    const timestamp = new Date();
    const results = await Promise.all(
      urls.map((url) => checkX402(url, options))
    );
    if (options.onResult) {
      options.onResult(results, timestamp);
    }
  }

  // Run immediately
  await runCheck();

  // Schedule repeating checks
  const timer = setInterval(() => {
    void runCheck();
  }, intervalMs);

  // Return cleanup
  return () => clearInterval(timer);
}

/**
 * Default console reporter for watch mode.
 * Prints ISO timestamp + status for each URL.
 */
export function defaultWatchReporter(results: X402Result[], timestamp: Date): void {
  const ts = timestamp.toISOString();
  for (const r of results) {
    if (r.supported) {
      process.stdout.write(`[${ts}] ✓ ${r.url} — x402 found\n`);
    } else if (r.status === 0) {
      process.stdout.write(`[${ts}] ✗ ${r.url} — error: ${r.error}\n`);
    } else {
      process.stdout.write(`[${ts}] ✗ ${r.url} — HTTP ${r.status} (no x402)\n`);
    }
  }
}
