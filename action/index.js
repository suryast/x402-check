/**
 * x402-check GitHub Action
 * Self-contained: uses only Node.js built-ins. No npm install needed.
 * Compatible with node20 runner.
 */

'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');

// ─── GitHub Actions helpers ──────────────────────────────────────────────────

/**
 * Read an action input from environment variables.
 * GitHub Actions maps `inputs.<name>` → INPUT_<NAME> env var.
 */
function getInput(name, required) {
  const envKey = `INPUT_${name.toUpperCase().replace(/-/g, '_')}`;
  const val = (process.env[envKey] || '').trim();
  if (required && !val) {
    setFailed(`Input required and not supplied: ${name}`);
  }
  return val;
}

/**
 * Write an output value to GITHUB_OUTPUT file (new format).
 * Falls back to ::set-output:: for older runners.
 */
function setOutput(name, value) {
  const outputPath = process.env['GITHUB_OUTPUT'];
  if (outputPath) {
    fs.appendFileSync(outputPath, `${name}=${value}\n`, 'utf-8');
  } else {
    // Legacy fallback
    process.stdout.write(`::set-output name=${name}::${value}\n`);
  }
}

function info(msg) {
  process.stdout.write(msg + '\n');
}

function setFailed(msg) {
  process.stdout.write(`::error::${msg}\n`);
  process.exit(1);
}

// ─── x402 checker (inline, zero external deps) ───────────────────────────────

/**
 * Check a single URL for x402 support.
 * Returns a result object with { url, supported, status, payment?, error? }.
 */
function checkUrl(url, timeout) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https:') ? https : http;
    const reqTimeout = Math.max(1000, Math.min(timeout, 60000));

    let settled = false;

    function done(result) {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    }

    let req;
    try {
      req = mod.request(url, { method: 'GET', headers: { 'User-Agent': 'x402-check-action/1.0.0' } }, (res) => { // #8
        const status = res.statusCode || 0;
        const paymentHeader = res.headers['x-payment-required'];

        if (status === 402 && paymentHeader) {
          try {
            const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
            const payment = JSON.parse(decoded);
            done({ url, supported: true, status, payment });
          } catch (e) {
            done({ url, supported: false, status, error: 'Failed to decode payment header: ' + e.message });
          }
        } else {
          done({ url, supported: false, status });
        }

        // Drain to free socket
        res.resume();
      });

      req.setTimeout(reqTimeout, () => {
        req.destroy();
        done({ url, supported: false, status: 0, error: 'Request timed out after ' + reqTimeout + 'ms' });
      });

      req.on('error', (err) => {
        done({ url, supported: false, status: 0, error: err.message });
      });

      req.end();
    } catch (err) {
      done({ url, supported: false, status: 0, error: String(err) });
    }
  });
}

/**
 * Parse and validate the urls input.
 * Splits by newline, trims, filters empty + non-URL lines.
 */
function parseUrls(input) {
  return input
    .split('\n')
    .map((u) => u.trim())
    .filter((u) => u && (u.startsWith('http://') || u.startsWith('https://')));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const urlsInput = getInput('urls', true);
  const failOnMissingStr = getInput('fail-on-missing');
  const timeoutStr = getInput('timeout');

  const failOnMissing = failOnMissingStr.toLowerCase() !== 'false';
  const timeout = parseInt(timeoutStr || '10000', 10);

  if (isNaN(timeout) || timeout <= 0) {
    setFailed('timeout must be a positive integer (milliseconds)');
    return;
  }

  const urls = parseUrls(urlsInput);

  if (urls.length === 0) {
    setFailed('No valid URLs provided. Each URL must start with http:// or https://');
    return;
  }

  info(`\nChecking ${urls.length} URL(s) for x402 support (timeout: ${timeout}ms)...\n`);

  const results = await Promise.all(urls.map((url) => checkUrl(url, timeout)));

  const foundCount = results.filter((r) => r.supported).length;
  const totalCount = results.length;

  // Print per-URL results
  for (const r of results) {
    if (r.supported) {
      const net = (r.payment && r.payment.network) ? ` (network: ${r.payment.network})` : '';
      info(`  ✓  ${r.url}${net}`);
    } else if (r.status === 0) {
      info(`  ✗  ${r.url} — error: ${r.error || 'unknown'}`);
    } else {
      info(`  ✗  ${r.url} — HTTP ${r.status} (no x402)`);
    }
  }

  info(`\nSummary: ${foundCount}/${totalCount} URL(s) support x402\n`);

  // Set action outputs
  setOutput('results', JSON.stringify(results));
  setOutput('found-count', String(foundCount));
  setOutput('total-count', String(totalCount));

  if (failOnMissing && foundCount === 0) {
    setFailed(`x402 support not found on any of the ${totalCount} checked URL(s)`);
  }
}

main().catch((err) => {
  setFailed(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
});

// Export helpers for testing
if (typeof module !== 'undefined') {
  module.exports = { parseUrls, checkUrl };
}
