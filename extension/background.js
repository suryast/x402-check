// x402 Detector — Background Service Worker (MV3)
// Monitors network responses for 402 status + x402 protocol headers.
// Companion directory: https://a2alist.ai

'use strict';

const A2ALIST_URL = 'https://a2alist.ai';

// In-memory cache of x402 results keyed by tabId
const tabCache = {};

// Track URLs we've already notified about (persisted in storage to survive SW restarts)
let notifiedUrls = new Set();

// Load notified URL set on startup
chrome.storage.local.get('notifiedUrls').then((data) => {
  notifiedUrls = new Set(data.notifiedUrls || []);
});

// Set default red badge on all existing tabs at startup/install
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.action.setBadgeText({ text: 'OFF' });
  await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  // Probe all existing tabs
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
      await updateBadge(tab.id, false);
      try {
        const result = await probeForX402(tab.url);
        tabCache[tab.id] = result;
        if (result) {
          await updateBadge(tab.id, true);
          await storeDiscovery(result);
        }
      } catch (_) {}
    }
  }
});

// Also set default on service worker startup (survives SW restarts)
chrome.action.setBadgeText({ text: 'OFF' });
chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });

// ---------------------------------------------------------------------------
// webRequest listener — catches 402 on the wire before the page commits
// ---------------------------------------------------------------------------
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.type !== 'main_frame') return;
    if (details.statusCode !== 402) return;

    try {
      const result = await probeForX402(details.url);
      if (result) {
        tabCache[details.tabId] = result;
        await updateBadge(details.tabId, true);
        await storeDiscovery(result);
        await maybeNotify(result);
      }
    } catch (_) {}
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// ---------------------------------------------------------------------------
// Tab update listener — probe after page load completes
// ---------------------------------------------------------------------------
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url) return;
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

  // Set red immediately, flip to green if x402 found
  await updateBadge(tabId, false);
  try {
    const result = await probeForX402(tab.url);
    tabCache[tabId] = result;
    if (result) {
      await updateBadge(tabId, true);
      await storeDiscovery(result);
      await maybeNotify(result);
    }
  } catch (_) {
    tabCache[tabId] = null;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabCache[tabId];
});

// ---------------------------------------------------------------------------
// Notification — shown once per unique URL
// ---------------------------------------------------------------------------
async function maybeNotify(info) {
  const key = normalizeUrl(info.url);
  if (notifiedUrls.has(key)) return;

  notifiedUrls.add(key);
  // Persist (cap at 1000 entries)
  const arr = [...notifiedUrls].slice(-1000);
  await chrome.storage.local.set({ notifiedUrls: arr });

  const amount = info.amount && info.amount !== 'unknown'
    ? ` (${info.amount})`
    : '';
  const network = info.network && info.network !== 'unknown'
    ? ` on ${info.network}` : '';

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'x402 payment detected!',
    message: `${truncateForNotif(info.url)} charges${amount}${network}. Browse more x402 agents on a2alist.ai →`,
    contextMessage: 'x402 Detector',
    buttons: [{ title: 'Open a2alist.ai' }],
    requireInteraction: false,
  });
}

// Open a2alist.ai when notification button is clicked
chrome.notifications.onButtonClicked.addListener((notifId, btnIndex) => {
  if (btnIndex === 0) {
    chrome.tabs.create({ url: A2ALIST_URL });
  }
  chrome.notifications.clear(notifId);
});

// ---------------------------------------------------------------------------
// x402 probe
// ---------------------------------------------------------------------------
async function probeForX402(url) {
  // First: try direct page probe (catches pages that return 402 on GET)
  const directResult = await directProbe(url);
  if (directResult) return directResult;

  // Second: try /.well-known/x402.json discovery
  try {
    const origin = new URL(url).origin;
    const wellKnown = await fetch(`${origin}/.well-known/x402.json`, {
      signal: AbortSignal.timeout(3000),
      headers: { 'X-Client': 'x402-detector-extension/1.0.0' },
    });
    if (wellKnown.ok) {
      const discovery = await wellKnown.json();
      if (discovery.x402Version && discovery.endpoints?.length > 0) {
        const ep = discovery.endpoints[0];
        return {
          url: origin + ep.path,
          detectedAt: new Date().toISOString(),
          network: ep.network || 'unknown',
          scheme: 'exact',
          amount: ep.price || 'unknown',
          resource: origin + ep.path,
          description: ep.description || null,
          payTo: [],
          raw: discovery,
          facilitator: null,
          discoveredVia: 'well-known',
        };
      }
    }
  } catch (_) { /* well-known not available */ }

  return null;
}

async function directProbe(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'X-Client': 'x402-detector-extension/1.0.0' },
    });

    clearTimeout(timeout);

    if (response.status !== 402) return null;

    const paymentHeader =
      response.headers.get('x-payment-required') ||
      response.headers.get('payment-required');

    let paymentInfo = null;
    if (paymentHeader) {
      try {
        paymentInfo = JSON.parse(atob(paymentHeader));
      } catch {
        try {
          paymentInfo = JSON.parse(paymentHeader);
        } catch {
          paymentInfo = { raw: paymentHeader };
        }
      }
    }

    return {
      url,
      detectedAt: new Date().toISOString(),
      network:  paymentInfo?.network  || paymentInfo?.accepts?.[0]?.network  || 'unknown',
      scheme:   paymentInfo?.scheme   || paymentInfo?.accepts?.[0]?.scheme   || 'exact',
      amount:   paymentInfo?.maxAmountRequired || paymentInfo?.accepts?.[0]?.maxAmountRequired || 'unknown',
      resource: paymentInfo?.resource || url,
      description: paymentInfo?.description || null,
      payTo:    paymentInfo?.payTo    || paymentInfo?.accepts?.[0]?.payTo    || [],
      raw:      paymentInfo,
    };
  } catch (err) {
    if (err.name === 'AbortError') return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
async function updateBadge(tabId, detected) {
  if (detected) {
    await chrome.action.setBadgeText({ tabId, text: 'x402' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#22c55e' });
    await chrome.action.setTitle({ tabId, title: 'x402 detected — click for details' });
  } else {
    await chrome.action.setBadgeText({ tabId, text: 'OFF' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#ef4444' });
    await chrome.action.setTitle({ tabId, title: 'x402 Detector — no x402 on this page' });
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
async function storeDiscovery(info) {
  const data = await chrome.storage.local.get('discoveries');
  const discoveries = data.discoveries || [];
  const filtered = discoveries.filter((d) => d.url !== info.url);
  filtered.unshift({
    url: info.url,
    discoveredAt: info.detectedAt,
    paymentInfo: info.raw,
    network: info.network,
    scheme: info.scheme,
    amount: info.amount,
  });
  await chrome.storage.local.set({ discoveries: filtered.slice(0, 500) });
}

// ---------------------------------------------------------------------------
// Message handler (popup ↔ background)
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'GET_TAB_STATUS':
      sendResponse({ x402Info: tabCache[message.tabId] || null });
      return true;

    case 'GET_DISCOVERIES':
      chrome.storage.local.get('discoveries').then((data) => {
        sendResponse({ discoveries: data.discoveries || [] });
      });
      return true;

    case 'PROBE_URL':
      probeForX402(message.url)
        .then((result) => sendResponse({ result }))
        .catch(() => sendResponse({ result: null }));
      return true;

    case 'OPEN_A2ALIST':
      chrome.tabs.create({ url: message.path ? `${A2ALIST_URL}${message.path}` : A2ALIST_URL });
      sendResponse({ ok: true });
      return true;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeUrl(url) {
  try { return new URL(url).origin + new URL(url).pathname; }
  catch { return url; }
}

function truncateForNotif(url) {
  try {
    const u = new URL(url);
    const s = u.hostname + (u.pathname !== '/' ? u.pathname : '');
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  } catch {
    return url.length > 40 ? url.slice(0, 40) + '…' : url;
  }
}
