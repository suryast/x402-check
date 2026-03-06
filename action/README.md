# x402-check Action

A GitHub Action to check if your URLs support the [x402 HTTP payment protocol](https://x402.org).
Use it in CI/CD to verify that your x402-enabled endpoints are working correctly before deploying.

## Usage

```yaml
- name: Check x402 support
  uses: a2alist/x402-check-action@v1
  with:
    urls: |
      https://api.example.com/resource
      https://api.example.com/premium
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `urls` | ✅ | — | Newline-separated list of URLs to check |
| `fail-on-missing` | | `true` | Fail the step if no URL supports x402 |
| `timeout` | | `10000` | Request timeout in milliseconds |

## Outputs

| Output | Description |
|--------|-------------|
| `results` | JSON array of check results |
| `found-count` | Number of URLs with x402 support detected |
| `total-count` | Total number of URLs checked |

## Example Workflows

### Basic check — fail if x402 missing

```yaml
name: Verify x402 endpoints

on:
  push:
    branches: [main]
  pull_request:

jobs:
  x402-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check x402 support
        uses: a2alist/x402-check-action@v1
        with:
          urls: |
            https://api.example.com/resource
            https://api.example.com/premium
```

### Non-blocking check — use outputs

```yaml
name: x402 status report

on:
  schedule:
    - cron: '0 */6 * * *'  # every 6 hours

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Check x402 support
        id: x402
        uses: a2alist/x402-check-action@v1
        with:
          urls: |
            https://api.example.com/resource
          fail-on-missing: 'false'
          timeout: '5000'

      - name: Report results
        run: |
          echo "Found: ${{ steps.x402.outputs.found-count }}/${{ steps.x402.outputs.total-count }}"
          echo "Results: ${{ steps.x402.outputs.results }}"
```

### Matrix strategy — check multiple environments

```yaml
name: x402 multi-env check

on:
  push:

jobs:
  check:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        env:
          - name: staging
            url: https://staging-api.example.com/resource
          - name: production
            url: https://api.example.com/resource

    steps:
      - name: Check x402 (${{ matrix.env.name }})
        uses: a2alist/x402-check-action@v1
        with:
          urls: ${{ matrix.env.url }}
```

### Use results JSON in a follow-up step

```yaml
- name: Check x402
  id: x402
  uses: a2alist/x402-check-action@v1
  with:
    urls: |
      https://api.example.com/resource
    fail-on-missing: 'false'

- name: Parse results
  run: |
    echo '${{ steps.x402.outputs.results }}' | jq '.[0].payment.network'
```

## Result JSON format

Each item in the `results` output array has:

```json
{
  "url": "https://api.example.com/resource",
  "supported": true,
  "status": 402,
  "payment": {
    "scheme": "exact",
    "network": "base-sepolia",
    "maxAmountRequired": "1000000",
    "resource": "https://api.example.com/resource",
    "payTo": [
      {
        "address": "0xABCD...",
        "amount": "1000000",
        "token": "USDC"
      }
    ]
  }
}
```

On failure (network error / no x402):

```json
{
  "url": "https://api.example.com/resource",
  "supported": false,
  "status": 200,
  "error": null
}
```

## Exit codes

- **0** — At least one URL supports x402 (or `fail-on-missing: false`)
- **1** — `fail-on-missing: true` and no URL supports x402

## No external dependencies

This action is self-contained. It uses only Node.js 20 built-ins (`https`, `http`, `fs`).
No `npm install` step required.
