# x402 Detector — Chrome Extension

A Chrome Manifest V3 extension that detects [x402](https://github.com/coinbase/x402) payment-required
endpoints as you browse the web. When a site charges for API access via crypto, the toolbar icon lights up.

Companion directory: **[a2alist.ai](https://a2alist.ai)** — browse 61+ verified x402 agents.

---

## Installation (Load Unpacked)

1. Clone or download this repo
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle top-right)
4. Click **Load unpacked**
5. Select the `extension/` folder from this repo
6. The x402 Detector icon appears in your toolbar

---

## How It Works

```
Page load → background service worker probes the URL
         → if HTTP 402 + x402 header: badge lights up green "x402"
         → site saved to local discovery list
         → browser notification shown (once per URL)
```

1. **Background worker** (`background.js`) listens via `chrome.webRequest` for `402` responses on main-frame navigations, then probes the URL to decode the `PAYMENT-REQUIRED` header.

2. **Badge** turns green with the text `x402` on any tab where x402 is detected.

3. **Popup** (`popup.html` / `popup.js`) has three tabs:

   | Tab | What it shows |
   |-----|---------------|
   | **Current Page** | Detection status, decoded payment details (network, scheme, amount, recipient), Submit button |
   | **Found** | All x402 sites discovered during your browsing session |
   | **Directory ✦** | Curated list from [a2alist.ai](https://a2alist.ai) — fetched live or shown from a hardcoded top-10 |

4. **Notifications** — when a new x402 site is detected for the first time, a browser notification fires with a one-click link to a2alist.ai.

---

## Features

### Current Page tab
- Status badge: **x402 detected** (green) or **No x402 on this page** (grey)
- Payment details: network, scheme, max amount, recipient address, facilitator URL
- **Submit to a2alist.ai** — sends the discovery to the community directory
- **Re-probe** — manually re-check the current URL
- Empty state: when no x402 found, shows a direct link to browse the a2alist.ai directory

### Found tab
- Chronological list of every x402 site discovered while browsing
- Stored in `chrome.storage.local` (max 500 entries, most recent first)
- **Export JSON** button — downloads all discoveries as:
  ```json
  [
    {
      "url": "https://example.com/api",
      "discoveredAt": "2026-03-06T10:00:00Z",
      "paymentInfo": { ... },
      "network": "base",
      "scheme": "exact",
      "amount": "0.001"
    }
  ]
  ```

### Directory tab
- Fetches `https://a2alist.ai/api/agents.json` and shows the top 10 agents
- Falls back to a hardcoded curated list if the API is unreachable
- Click any agent card to open the site in a new tab
- **Browse 61+ agents on a2alist.ai →** CTA button

### Footer (always visible)
- **"61+ x402 agents on a2alist.ai →"** — persistent discovery prompt on every popup view

---

## Screenshots

> _TODO: Add screenshots after Chrome loads the extension._

| Current Page (x402 detected) | Directory tab | Found tab |
|---|---|---|
| _(screenshot)_ | _(screenshot)_ | _(screenshot)_ |

---

## Privacy

**No data is sent anywhere without your explicit action.**

| Action | Data sent externally? |
|--------|-----------------------|
| Browsing any page | No — probing is local fetch only |
| Badge lighting up | No |
| Viewing the popup | No |
| "Submit to a2alist.ai" button | Yes — only when you click it |
| Browser notification | No — rendered locally |
| Directory tab | Yes — fetches `a2alist.ai/api/agents.json` (public, unauthenticated) |
| Export JSON | No — downloads to your machine only |

All discovered sites are stored in `chrome.storage.local` on your device only.

---

## Development

```bash
# Check JS syntax
node --check extension/background.js
node --check extension/popup.js

# Validate manifest
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); console.log('valid')"
```

To rebuild icons:
```bash
cd extension/icons
convert -background none -resize 16x16  icon.svg icon16.png
convert -background none -resize 48x48  icon.svg icon48.png
convert -background none -resize 128x128 icon.svg icon128.png
```

---

## Permissions

### Why `<all_urls>` host permission is required (#4)

The extension uses `<all_urls>` in `host_permissions` because:

1. **`chrome.webRequest.onCompleted`** — to intercept HTTP 402 responses on *any* tab the user visits,
   the extension must be able to observe responses from any origin. There is no narrower permission
   that allows this for arbitrary sites the user browses.
2. **Probe fetch in background.js** — after detecting a 402, the extension sends a `GET` request to the
   same URL to decode the `x-payment-required` header. Because users can visit *any* website, the
   extension cannot predict which origins need to be allowed at install time.

The extension does **not** read page content, inject scripts into pages, or send browsing data to any
server without the user explicitly clicking "Submit to a2alist.ai".

If Chrome ever supports a "request host permission on first use" flow adequate for `webRequest`, we
will adopt that narrower model.

---

## Related

- [x402-check CLI](https://www.npmjs.com/package/x402-check) — command-line checker for x402 endpoints
- [a2alist.ai](https://a2alist.ai) — curated directory of x402-enabled AI agents
- [x402 Protocol](https://github.com/coinbase/x402) — Coinbase's HTTP 402 payment standard
