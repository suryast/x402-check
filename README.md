# x402-check

[![npm version](https://img.shields.io/npm/v/x402-check.svg)](https://www.npmjs.com/package/x402-check)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

CLI + library to check if URLs support the [x402 HTTP payment protocol](https://x402.org).

Detects x402-enabled endpoints, decodes the `PaymentRequired` payload, validates schema compliance, and checks facilitator reachability — with colored output and JSON mode for CI/CD.

---

## Install

```bash
# Global CLI
npm install -g x402-check

# Or run without installing
npx x402-check https://api.example.com/resource
```

---

## CLI Usage

```bash
x402-check [options] <url> [url...]
```

### Options

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable JSON output |
| `--timeout <ms>` | Request timeout in milliseconds (default: `10000`) |
| `--verbose` | Show full response headers, schema validation, facilitator check |
| `--help` | Show help |
| `--version` | Show version |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | x402 detected on at least one URL |
| `1` | No x402 detected |
| `2` | Error (network, timeout, invalid args) |

### Examples

```bash
# Check a single URL
x402-check https://api.example.com/resource

# Verbose: schema validation + facilitator reachability
x402-check --verbose https://api.example.com/resource

# JSON output (pipe-friendly, great for CI)
x402-check --json https://api.example.com/resource | jq .

# Check multiple URLs at once
x402-check https://api.a.com/paid https://api.b.com/endpoint

# Use in CI — exits 0 if x402 found, 1 if not
x402-check https://api.example.com/resource && echo "x402 detected!"

# Custom timeout
x402-check --timeout 5000 https://slow.example.com/api
```

### Output (colored)

```
✅ x402 DETECTED  https://api.example.com/resource
  Status:      402
  Network:     base-mainnet
  Scheme:      exact
  Amount:      1000000
  Resource:    https://api.example.com/resource
  Pay to:      0xDeadBeef...
  Schema:      ✅ Valid
  Facilitator: ✅ Reachable (HTTP 200)
```

---

## Library API

```typescript
import {
  checkX402,
  validateSchema,
  checkFacilitator,
  decodePaymentRequired,
} from 'x402-check';
```

### `checkX402(url, options?)`

Check if a URL supports x402. Returns an `X402Result`.

```typescript
const result = await checkX402('https://api.example.com/resource', {
  timeout: 10000,        // ms (default: 10000)
  verbose: true,         // include headers in result (default: false)
  checkFacilitator: true // probe facilitator URL (default: same as verbose)
});

if (result.supported) {
  console.log('x402 detected!', result.paymentDetails);
  console.log('Schema valid?', result.schemaValidation?.valid);
  console.log('Facilitator up?', result.facilitatorCheck?.reachable);
}
```

**Returns:** [`X402Result`](#x402result)

---

### `validateSchema(payload)`

Validate a decoded `PaymentRequired` payload against the x402 v1 spec.

```typescript
import { validateSchema } from 'x402-check';

const validation = validateSchema({
  x402Version: 1,
  accepts: [{
    scheme: 'exact',
    network: 'base-mainnet',
    maxAmountRequired: '1000000',
    resource: 'https://example.com/api',
    description: 'Access to AI API',
    mimeType: 'application/json',
    payTo: '0xDeadBeef',
    maxTimeoutSeconds: 300,
  }],
  facilitatorUrl: 'https://facilitator.example.com',
});

console.log(validation.valid);    // true
console.log(validation.errors);   // []
console.log(validation.warnings); // []
```

**Required fields:**
- `x402Version` — number (should be `1`)
- `accepts` — non-empty array of payment options
  - Each entry: `scheme`, `network`, `maxAmountRequired`, `resource`, `description`, `mimeType`, `payTo`
- `facilitatorUrl` — valid `http(s)://` URL

**Returns:** [`ValidationResult`](#validationresult)

---

### `checkFacilitator(url, timeout?)`

Probe a facilitator URL with a HEAD request.

```typescript
import { checkFacilitator } from 'x402-check';

const fc = await checkFacilitator('https://facilitator.example.com', 5000);
if (fc.reachable) {
  console.log(`Facilitator up! HTTP ${fc.status}`);
} else {
  console.warn('Facilitator unreachable:', fc.error ?? `HTTP ${fc.status}`);
}
```

HTTP 2xx/3xx = reachable. 4xx/5xx/timeout = not reachable (warn).

**Returns:** [`FacilitatorResult`](#facilitatorresult)

---

### `decodePaymentRequired(headerValue)`

Decode the raw base64 `x-payment-required` header value.

```typescript
import { decodePaymentRequired } from 'x402-check';

const raw = response.headers.get('x-payment-required');
if (raw) {
  const details = decodePaymentRequired(raw); // throws on invalid input
}
```

---

## Types

### `X402Result`

```typescript
interface X402Result {
  url: string;
  supported: boolean;         // true if HTTP 402 + valid payment header
  status: number;             // HTTP status code (0 = network error)
  paymentDetails?: PaymentRequired;
  rawHeader?: string;         // raw base64 header value
  headers?: Record<string, string>; // all response headers (verbose mode)
  error?: string;
  schemaValidation?: ValidationResult;
  facilitatorCheck?: FacilitatorResult;
}
```

### `ValidationResult`

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];    // spec violations (hard failures)
  warnings: string[];  // soft issues (e.g. resource not a URL)
}
```

### `FacilitatorResult`

```typescript
interface FacilitatorResult {
  url: string;
  reachable: boolean;
  status?: number;
  error?: string;
}
```

### `PaymentRequired`

```typescript
interface PaymentRequired {
  x402Version?: number;
  accepts?: AcceptsEntry[];
  facilitatorUrl?: string;
  // legacy flat fields also supported
  scheme?: string;
  network?: string;
  maxAmountRequired?: string;
  // ...
}
```

---

## CI/CD Integration

```yaml
# GitHub Actions example
- name: Check x402 endpoint
  run: npx x402-check https://api.example.com/resource
  # Exits 0 = detected, 1 = not found, 2 = error
```

---

## x402 Protocol

x402 is an open HTTP payment standard pioneered by Coinbase. When a server returns HTTP 402 with an `x-payment-required` header, clients can decode the payment requirements, send a payment, and retry with a receipt.

Learn more:
- [x402.org](https://x402.org)
- [coinbase/x402 on GitHub](https://github.com/coinbase/x402)
- [a2alist.ai — x402 site directory](https://a2alist.ai)

---

## License

MIT © [a2alist.ai](https://a2alist.ai)
