# x402 Detector 1.1.0 (MV3)

Load this directory unpacked at chrome://extensions in Developer mode.

Passively observes HTTP(S) main-frame response headers. HTTP 402 alone is NOT a detection. PAYMENT-REQUIRED must decode to valid x402 v2 requirements (resource object, CAIP-2 network, amount integer atomic units, recipient, asset, timeout), or explicit legacy v1 requirements (maxAmountRequired). Legacy X-PAYMENT-REQUIRED is accepted only for v1. The popup shows protocol version and raw atomic units, not a guessed currency conversion.

No automatic replay of browsing URLs, startup probes, well-known fetches, signing, PAYMENT-SIGNATURE submission, verification or settlement calls. PAYMENT-RESPONSE is not interpreted as proof of successful settlement. Unsigned requirements are untrusted claims: detection is not identity, safety or payment certification.

Manual re-probe requires confirmation and sends one GET with credentials omitted, no referrer and redirects rejected; v1 JSON-only bodies are supported on this explicit path with a 64 KiB cap. Browsing observation cannot inspect JSON-only response bodies: use manual probe if appropriate. GET may have server side effects; do not probe sensitive URLs.

Discovery history (500 entries) stays local; tab state uses session storage to survive worker suspension. Query strings, fragments and URL credentials are stripped from stored/exported URLs; raw payloads, descriptions, extensions, cookies, signatures and authorization headers are not retained. Paths themselves may contain private identifiers: use Chrome site-access restrictions and clear extension storage if needed. Upgrading clears pre-1.1 unredacted history.

Permissions: activeTab for popup context, storage for local history/session state, webRequest for passive headers, notifications for first-discovery local notifications. HTTP(S) wildcard host access allows detection on arbitrary visited sites and means broad browsing visibility; file/FTP access is no longer requested. Restrict site access in Chrome if broad passive observation is undesirable. No tabs, scripting or blocking permission is requested.

Opening Directory explicitly fetches the public a2alist.ai catalog without credentials; failures show no invented listings. Opening links contacts their origins. Submit requires confirmation and opens a prefilled form using a redacted URL; it never auto-submits. Export downloads local JSON only.

Presentation: an original X with two signal LEDs uses font-free SVG masters and transparent 16/32/48/128 PNG toolbar assets. Idle lights red and dims green; valid unsigned x402 requirements light green and dim red. Red means no valid requirements observed, NOT unsafe or payment failure; text labels remain alongside the color. Popup and per-tab toolbar icons change with detection state; the toolbar is static between events. Popup entry/tab/content reveals last 160–200 ms; detected green LED acknowledgment lasts 320 ms. Loading turns at most four times (2.8 seconds), then remains static; no idle animation, background timer or network request was added. `prefers-reduced-motion: reduce` disables all popup animations/transitions and pressed-button scaling. This does not animate Chrome itself or certify a payment.

Tests: `node --test extension/tests/protocol.node.cjs extension/tests/presentation.node.cjs`.
Protocol references: Coinbase/x402 specs/x402-specification-v2.md and specs/transports-v2/http.md, retrieved October 8, 2026.
Chrome Web Store public version was 1.0.1 (updated March 13, 2026); proposed minor release 1.1.0 is not uploaded.
