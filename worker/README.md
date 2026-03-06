# x402-check API — Cloudflare Worker

A free, hosted REST API to check whether any URL supports the [x402 HTTP payment protocol](https://github.com/coinbase/x402). Runs on Cloudflare Workers at the edge.

## Base URL

```
https://x402-check-api.<your-subdomain>.workers.dev
```

---

## Endpoints

### `GET /check?url=<url>`

Check a single URL for x402 support.

**Parameters:**

| Param | Type   | Required | Description                    |
|-------|--------|----------|--------------------------------|
| `url` | string | ✅       | Full HTTP/HTTPS URL to check   |

**Example:**

```bash
curl "https://api.x402check.dev/check?url=https://example.com/api/content"
```

**Response:**

```json
{
  "url": "https://example.com/api/content",
  "x402": true,
  "paymentInfo": {
    "scheme": "exact",
    "network": "base-sepolia",
    "maxAmountRequired": "1000000",
    "resource": "https://example.com/api/content",
    "payTo": [
      {
        "address": "0xABCDEF...",
        "amount": "1000000",
        "token": "0xUSDC..."
      }
    ]
  },
  "facilitator": {
    "reachable": true,
    "url": "https://facilitator.example.com"
  },
  "checkedAt": "2025-01-15T10:30:00.000Z"
}
```

**Not supported example:**

```json
{
  "url": "https://example.com",
  "x402": false,
  "paymentInfo": null,
  "facilitator": null,
  "checkedAt": "2025-01-15T10:30:00.000Z"
}
```

---

### `POST /check/batch`

Check multiple URLs at once (max 10).

**Request body:**

```json
{
  "urls": [
    "https://api.example.com/endpoint1",
    "https://api.example.com/endpoint2"
  ]
}
```

**Example:**

```bash
curl -X POST "https://api.x402check.dev/check/batch" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://example.com/api/v1", "https://another.com/pay"]}'
```

**Response:**

```json
{
  "results": [
    {
      "url": "https://example.com/api/v1",
      "x402": true,
      "paymentInfo": { ... },
      "facilitator": { "reachable": true },
      "checkedAt": "2025-01-15T10:30:00.000Z"
    },
    {
      "url": "https://another.com/pay",
      "x402": false,
      "paymentInfo": null,
      "facilitator": null,
      "checkedAt": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

---

### `GET /badge/<domain>.svg`

Get a dynamic SVG badge showing x402 status for a domain. Cached for 1 hour.

**Example:**

```bash
curl "https://api.x402check.dev/badge/example.com.svg" > badge.svg
```

**Usage in README.md:**

```markdown
![x402 supported](https://api.x402check.dev/badge/example.com.svg)
```

The badge will show:
- 🟢 **x402: supported** — if the domain's root returns HTTP 402 with a valid payment header
- 🔴 **x402: not supported** — otherwise

---

### `GET /health`

Health check endpoint (no rate limiting).

```bash
curl "https://api.x402check.dev/health"
# → {"status":"ok","version":"1.0.0"}
```

---

## Rate Limits

| Tier       | Price  | Requests/Day |
|------------|--------|--------------|
| Free       | $0     | 100          |
| Pro        | $10/mo | 10,000       |
| Enterprise | $99/mo | Unlimited    |

Rate limit headers are included in every response:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1705363200
```

`X-RateLimit-Reset` is a Unix timestamp (UTC midnight) when the counter resets.

**429 response:**

```json
{
  "error": "Rate limit exceeded. Free tier: 100 requests/day."
}
```

---

## Response Fields

| Field          | Type             | Description                                            |
|----------------|------------------|--------------------------------------------------------|
| `url`          | string           | The URL that was checked                               |
| `x402`         | boolean          | Whether valid x402 support was detected                |
| `paymentInfo`  | object \| null   | Decoded PaymentRequired payload (null if not x402)    |
| `facilitator`  | object \| null   | Facilitator reachability probe result                 |
| `checkedAt`    | ISO 8601 string  | When the check was performed                           |
| `error`        | string?          | Optional error message (e.g. timeout, decode failure) |

### `paymentInfo` fields

| Field                  | Type     | Description                              |
|------------------------|----------|------------------------------------------|
| `scheme`               | string   | Payment scheme (e.g. `"exact"`)          |
| `network`              | string   | Blockchain network (e.g. `"base"`)       |
| `maxAmountRequired`    | string   | Max amount in smallest denomination      |
| `resource`             | string?  | Resource URL                             |
| `description`          | string?  | Human-readable description               |
| `payTo`                | array    | Payment destinations                     |
| `payTo[].address`      | string   | Recipient wallet address                 |
| `payTo[].amount`       | string   | Amount in smallest denomination          |
| `payTo[].token`        | string?  | Token contract address                   |

---

## CORS Policy

The API uses **fully open CORS** (`Access-Control-Allow-Origin: *`). This is intentional:

- The x402-check API is a **public read-only utility** — anyone can check whether a URL supports x402.
- There is no authentication or user-specific data returned; every response is safe to expose cross-origin.
- Browser-side tooling (extensions, web apps, dashboards) needs to call this API directly without a server proxy.
- If you self-host and want to restrict origins, add your own `Access-Control-Allow-Origin` logic in the worker's `corsHeaders()` function.

## Constraints

- **Timeout:** 10 seconds per URL check
- **Max batch:** 10 URLs per POST /check/batch request
- **CORS:** Open (all origins allowed) — intentionally public; see CORS Policy section above
- **Rate limiting:** Per-IP, tracked via Cloudflare KV

---

## Self-Hosting

### Prerequisites

- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- Cloudflare account (free tier works)
- Node.js ≥ 18

### Setup

```bash
# 1. Clone and install
git clone https://github.com/a2alist/x402-check
cd x402-check/worker
npm install

# 2. Create a KV namespace
wrangler kv:namespace create RATE_LIMITS
# → Note the id and preview_id

# 3. Update wrangler.toml with your KV IDs
# Replace REPLACE_WITH_KV_NAMESPACE_ID and REPLACE_WITH_KV_PREVIEW_ID

# 4. Authenticate with Cloudflare
wrangler login

# 5. Run locally
npm run dev
# → http://localhost:8787

# 6. Deploy
npm run deploy
```

### Configuration

Edit `wrangler.toml` to change:

```toml
[vars]
RATE_LIMIT_PER_DAY = "100"   # requests per IP per day
MAX_BATCH_SIZE = "10"         # max URLs per batch request
```

### Creating the KV namespace

```bash
# Production
wrangler kv:namespace create RATE_LIMITS

# Preview (for local dev)
wrangler kv:namespace create RATE_LIMITS --preview
```

Then update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "RATE_LIMITS"
id = "<your-production-kv-id>"
preview_id = "<your-preview-kv-id>"
```

### Local development

```bash
npm run dev
# Worker runs at http://localhost:8787

# Test it:
curl "http://localhost:8787/check?url=https://example.com"
curl "http://localhost:8787/health"
```

---

## TypeScript

The worker is fully typed. Core types:

```typescript
interface X402Result {
  url: string;
  x402: boolean;
  paymentInfo: PaymentRequired | null;
  facilitator: { reachable: boolean; url?: string } | null;
  checkedAt: string;
  error?: string;
}
```

---

## License

MIT — see [LICENSE](../LICENSE)
