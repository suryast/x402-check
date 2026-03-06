# Security Review — x402-check

**Date:** 2026-03-06  
**Reviewer:** Bouncer (automated security sub-agent)  
**Scope:** Full codebase — CLI, npm library, GitHub Action, Chrome extension, CF Worker API  
**Gitleaks:** `no leaks found` (filesystem scan, no git history present)

---

## Findings

| # | Severity | File | Description | Recommendation |
|---|----------|------|-------------|----------------|
| 1 | **HIGH** | `worker/src/index.ts` | **SSRF — no private IP filtering.** `checkUrl()` fetches user-supplied URLs with `redirect: 'follow'` and no validation against private/internal IP ranges (`127.0.0.1`, `10.x.x.x`, `169.254.169.254` AWS metadata, etc.). Both `GET /check?url=` and `POST /check/batch` are affected. | Add a pre-fetch blocklist rejecting private IP ranges. Parse resolved hostname via DNS or use a URL-level check. Cloudflare Workers sandbox limits internal access, but don't rely on that implicitly — enforce it explicitly. Remove `redirect: 'follow'` or add redirect-target validation. |
| 2 | **MEDIUM** | `extension/popup.js` | **XSS via `javascript:` URL in facilitator href.** `showDetails()` renders `<a href="${esc(facilitator)}">`. The `esc()` helper escapes HTML entities but does NOT block `javascript:` protocol. A malicious x402 server returning `facilitatorUrl: "javascript:..."` in its payment header would inject executable code into the extension popup (chrome-extension:// origin). The extension auto-probes every tab navigation. | Validate facilitator URLs before rendering: check `url.startsWith('https://')`. Use `<a>` with an onclick handler calling `chrome.tabs.create` instead of a raw `href`. |
| 3 | **MEDIUM** | `worker/src/index.ts` | **Rate limit bypass via spoofed `X-Forwarded-For`.** IP extraction: `CF-Connecting-IP \|\| X-Forwarded-For`. In Cloudflare Workers production, `CF-Connecting-IP` is authoritative and client-spoofable headers are stripped. However, local dev (`wrangler dev`) or any non-CF proxy path allows arbitrary `X-Forwarded-For` values, bypassing or poisoning per-IP rate limits. | Use only `CF-Connecting-IP`. Remove the `X-Forwarded-For` fallback entirely, or gate it behind an explicit dev-only flag. |
| 4 | **MEDIUM** | `extension/manifest.json` | **Broad `<all_urls>` host permission.** `"host_permissions": ["<all_urls>"]` grants access to all sites. While required for `webRequest.onCompleted`, this is the maximum possible scope and will trigger Chrome's "can read and change all your data on all websites" warning. | Narrow to `"*://*/*"` (effectively the same) or document in the extension's store listing that this is needed for passive webRequest monitoring only. Explore whether `activeTab` + event-driven probing could replace broad `webRequest` monitoring. |
| 5 | **MEDIUM** | `extension/manifest.json` | **No `content_security_policy` for extension pages.** The popup HTML has no explicit CSP defined in `manifest.json`. MV3 enforces `script-src 'self'` by default for service workers, but extension pages (popup) benefit from an explicit CSP. | Add to manifest: `"content_security_policy": { "extension_pages": "script-src 'self'; object-src 'none';" }` |
| 6 | **MEDIUM** | `src/checker.ts`, `worker/src/index.ts` | **SSRF via facilitator URL (library + worker).** Both `checkFacilitator()` (checker.ts) and `probeFacilitator()` (worker) follow the `facilitatorUrl` extracted from the payment header — user-controlled server data. This can probe arbitrary URLs including internal services. | Validate facilitator URLs are `https://` and resolve to public IPs before fetching. |
| 7 | **LOW** | `.gitignore` | **Missing `.wrangler/` entry.** The root `.gitignore` does not exclude `.wrangler/` which can contain local build artifacts, secrets cache from `wrangler secret`, and local KV state. | Add `.wrangler/` to `.gitignore`. |
| 8 | **LOW** | `action/index.js` | **No `User-Agent` header on outgoing requests.** The GitHub Action's `checkUrl()` uses `http.request(url, { method: 'GET' }, ...)` without setting a `User-Agent`. This is inconsistent with the library (which correctly sets `x402-check/1.1.0`) and makes requests harder to identify in server logs. | Add `headers: { 'User-Agent': 'x402-check-action/1.0.0' }` to the request options object. |
| 9 | **LOW** | `extension/background.js` | **No `User-Agent` in `probeForX402()` fetch.** The extension probe makes bare `fetch()` calls without a `User-Agent` header. The browser's default Chrome UA is sent, making these requests indistinguishable from normal page loads. | Add `headers: { 'User-Agent': 'x402-detector-extension/1.0.0' }` to the fetch call. |
| 10 | **LOW** | *(repo root)* | **npm tarball `x402-check-1.1.0.tgz` committed to repo.** A packed npm tarball is checked in at the repo root. This is not a secret leak but is a maintenance hazard — it could become outdated, bloats the repo, and may confuse CI tooling. | Add `*.tgz` to `.gitignore` and delete the committed tarball. |
| 11 | **LOW** | `src/checker.ts`, `worker/src/index.ts` | **`redirect: 'follow'` on all HTTP clients.** Every HTTP client in the codebase follows redirects without validation of the redirect target. Combined with DNS rebinding or SSRF-via-redirect, this expands the attack surface on worker-side probing. | Use `redirect: 'manual'` or validate the final URL after resolution. For the public worker, consider disabling redirect following entirely. |
| 12 | **INFO** | `worker/src/index.ts` | **CORS fully open (`Access-Control-Allow-Origin: *`).** This is appropriate for a public API but is not documented in `README.md` or `wrangler.toml`. | Add a note in the README and/or `wrangler.toml` [vars] block stating CORS is intentionally open. |
| 13 | **INFO** | `package.json` vs `src/checker.ts`, `src/cli.ts` | **Version mismatch.** `package.json` declares version `1.0.0`, but `checker.ts` User-Agent strings say `x402-check/1.1.0` and the `--version` fallback in `cli.ts` hardcodes `1.1.0`. The packed tarball is also `1.1.0`. | Bump `package.json` to `1.1.0` or revert all hardcoded version strings back to `1.0.0`. |
| 14 | **INFO** | `worker/src/index.ts` | **Badge SVG uses domain from URL path without escaping in XML.** The badge endpoint validates the domain with a strict regex (`[a-zA-Z0-9.-]` only), which prevents XML injection. This is correctly mitigated, but the SVG template uses raw string interpolation (`${domain}`) without an XML-escaping step. If the regex is ever relaxed, SVG injection becomes possible. | Add an `escapeXml()` call around `domain` in `generateBadgeSvg()` as defence in depth. |
| 15 | **INFO** | `src/file-reader.ts` | **`readUrlsFromFile` does not validate resulting URL strings.** The function reads lines from a file and returns them without checking if they are valid URLs. Non-URL lines that don't start with `#` are silently passed to `checkX402()`. | Consider adding URL format validation (matching the CLI's `startsWith('http://')` filter) inside `readUrlsFromFile`, or document that callers are responsible for validation. |

---

## Category Summary

### 1. Secrets & PII ✅
- No hardcoded API keys, tokens, or credentials found anywhere in the codebase
- Test fixtures use generic addresses (`0xABCD`, `example.com`, testnet `base-sepolia`)
- `.gitignore` covers `node_modules/`, `dist/`, `.env`, `*.tsbuildinfo`, `SHAPING.md`
- ⚠️ `.wrangler/` is **not** in `.gitignore` (Finding #7)
- Gitleaks: **no secrets detected**

### 2. Input Validation ✅ / ⚠️
- CLI: URL validated via `startsWith('http://')` / `startsWith('https://')` — prevents `file://`, `data://`, etc. ✅
- Worker: `isValidUrl()` uses `new URL()` + protocol check ✅
- Worker: Batch size enforced (default 10) ✅
- Worker/CLI: No SSRF protection against private IP ranges ❌ (Findings #1, #6)
- Chrome extension: No `eval()` usage ✅

### 3. Network Safety ⚠️
- All components set timeouts ✅
- CLI + library set `User-Agent` ✅
- Worker sets `User-Agent` ✅
- GitHub Action missing `User-Agent` ❌ (Finding #8)
- Extension `probeForX402()` missing `User-Agent` ❌ (Finding #9)
- `redirect: 'follow'` used everywhere without redirect-target validation ❌ (Finding #11)
- HTTPS enforced in worker URL validation; CLI/library allow `http://` by design ✅

### 4. Chrome Extension ⚠️
- No `eval()` usage ✅
- All `innerHTML` usage uses `esc()` HTML-entity escaping ✅
- Storage is local only (`chrome.storage.local`); submission is explicit user action ✅
- No remote code loading ✅
- `<all_urls>` host permission is broad (Finding #4) ❌
- No explicit `content_security_policy` in manifest (Finding #5) ❌
- `javascript:` URL not blocked in facilitator href (Finding #2) ❌

### 5. CF Worker ✅ / ⚠️
- KV-backed IP-based rate limiting ✅
- `X-Forwarded-For` fallback bypassable in non-CF environments (Finding #3) ❌
- No secrets in `wrangler.toml` ✅ (only non-sensitive env vars + placeholder KV IDs)
- CORS open by design but undocumented (Finding #12) ℹ️

### 6. npm Package ✅
- `"files": ["dist", "README.md", "LICENSE"]` — correctly excludes `src/`, `tests/`, `extension/`, `.env` ✅
- No `postinstall` or lifecycle scripts that run arbitrary code ✅
- `prepublishOnly` only runs build + tests ✅
- Dependencies minimal: only `chalk` in production deps ✅
- Tarball `x402-check-1.1.0.tgz` committed (should be gitignored) — Finding #10 ⚠️

---

## Overall Assessment

> **PASS WITH NOTES**

The codebase is well-structured, uses no hardcoded secrets, has proper timeout handling throughout, and validates inputs at API boundaries. The npm package publish configuration is clean.

**Primary concerns requiring attention before public launch:**

1. **SSRF on the CF Worker** (Finding #1) — the public API fetches arbitrary user-supplied URLs server-side. Add a private IP blocklist.
2. **XSS in extension popup** (Finding #2) — a malicious x402 server can inject a `javascript:` URL into the facilitator link rendered in the popup.
3. **Rate limit spoofing** (Finding #3) — the `X-Forwarded-For` fallback should be removed from the worker.

The remaining findings are low/informational and represent defence-in-depth improvements rather than active vulnerabilities in normal usage.
