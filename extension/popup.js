'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const A2ALIST_URL       = 'https://a2alist.ai';
const A2ALIST_AGENTS_API = 'https://a2alist.ai/api/agents.json';
const SUBMIT_ENDPOINT   = 'https://a2alist.ai/api/submit';

// Curated fallback list shown when the API is unreachable.
// Hand-picked from a2alist.ai to give users an immediate sense of the directory.
const FALLBACK_AGENTS = [];

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const loadingEl       = document.getElementById('loading');
const contentEl       = document.getElementById('content');
const statusBadge     = document.getElementById('status-badge');
const statusText      = document.getElementById('status-text');
const currentUrlEl    = document.getElementById('current-url');
const detailsSection  = document.getElementById('details-section');
const detailGrid      = document.getElementById('detail-grid');
const emptyPageState  = document.getElementById('empty-page-state');
const actionsSection  = document.getElementById('actions-section');
const btnBrowseDir    = document.getElementById('btn-browse-dir');
const btnSubmit       = document.getElementById('btn-submit');
const btnProbe        = document.getElementById('btn-probe');
const btnExport       = document.getElementById('btn-export');
const discCount       = document.getElementById('disc-count');
const discHeaderCount = document.getElementById('disc-header-count');
const discoveriesList = document.getElementById('discoveries-list');
const dirList         = document.getElementById('dir-list');
const dirLoading      = document.getElementById('dir-loading');
const btnDirOpen      = document.getElementById('btn-dir-open');
const dirViewAll      = document.getElementById('dir-view-all');
const footerA2alist   = document.getElementById('footer-a2alist');
const btnEmptyA2alist = document.getElementById('btn-empty-a2alist');
const toast           = document.getElementById('toast');

let currentTabId  = null;
let currentUrl    = null;
let currentX402   = null;
let dirLoaded     = false;

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');

    if (tab.dataset.tab === 'discovered') loadDiscoveries();
    if (tab.dataset.tab === 'directory' && !dirLoaded) loadDirectory();
  });
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return showContent(null, null);

    currentTabId = tab.id;
    currentUrl   = tab.url;

    const resp = await chrome.runtime.sendMessage({
      type: 'GET_TAB_STATUS',
      tabId: tab.id,
    });

    showContent(tab.url, resp?.x402Info || null);
    loadDiscoveries();   // pre-load count
  } catch {
    showContent(null, null);
  }
}

// ---------------------------------------------------------------------------
// Current-page tab rendering
// ---------------------------------------------------------------------------
function showContent(url, x402Info) {
  document.body.dataset.state = x402Info ? 'detected' : 'not-detected';
  document.querySelector('.logo img').src = x402Info ? 'icons/icon32-active.png' : 'icons/icon32.png';
  loadingEl.style.display  = 'none';
  contentEl.style.display  = 'block';
  currentX402 = x402Info;

  currentUrlEl.textContent = url ? truncateUrl(url) : '—';

  if (x402Info) {
    // x402 detected ✓
    statusBadge.className      = 'status-badge detected';
    statusText.textContent     = 'x402 detected';
    emptyPageState.style.display = 'none';
    detailsSection.style.display = 'block';
    btnBrowseDir.style.display   = 'block';
    btnSubmit.disabled           = false;
    showDetails(x402Info);
  } else {
    // No x402 on this page
    statusBadge.className      = 'status-badge not-detected';
    statusText.textContent     = 'No valid x402 observed';
    detailsSection.style.display = 'none';
    emptyPageState.style.display = 'block';
    btnBrowseDir.style.display   = 'none';
    btnSubmit.disabled           = true;
  }
}

function showDetails(info) {
 detailGrid.replaceChildren();
 for(const [label,value] of [['Protocol',`v${info.version}${info.version===1?' (legacy)':''}`],['Network',info.network],['Scheme',info.scheme],['Amount',`${info.amount} atomic units`],['Asset',info.asset],['Pay to',info.payTo],['Resource',info.resource],['Evidence','Unsigned requirements only; not verified settlement']]) {
 const l=document.createElement('span');l.className='detail-label';l.textContent=label;const v=document.createElement('span');v.className='detail-value';v.textContent=String(value||'—');detailGrid.append(l,v);
 }
}

// ---------------------------------------------------------------------------
// Directory tab
// ---------------------------------------------------------------------------
async function loadDirectory() {
  dirLoaded = true;
  let agents = null;

  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 4000);
    const resp = await fetch(A2ALIST_AGENTS_API, { signal: ctrl.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (resp.ok) agents = await resp.json();
  } catch {
    // fall through to hardcoded list
  }

  // Normalise: API might return {agents:[…]} or a plain array
  if (agents && !Array.isArray(agents)) agents = agents.agents || agents.data || null;

  const list = Array.isArray(agents) ? agents.filter(a => a && typeof a.name === 'string' && X402Protocol.safeUrl(a.url || a.website)).slice(0, 10) : FALLBACK_AGENTS;

  dirLoading.style.display = 'none';

  dirList.innerHTML = list.map((a) => `
    <div class="dir-item" data-url="${esc(a.url || a.website || '#')}">
      <div class="dir-item-name">${esc(a.name)}</div>
      <div class="dir-item-desc">${esc(a.description || a.desc || '')}</div>
      <div class="dir-item-meta">
        ${a.network ? `<span class="dir-pill net">${esc(a.network)}</span>` : ''}
        ${a.category ? `<span class="dir-pill cat">${esc(a.category)}</span>` : ''}
        <span class="dir-item-url">${esc(shortHost(a.url || a.website || ''))}</span>
      </div>
    </div>
  `).join('');

  // Click → open agent URL in new tab
  dirList.querySelectorAll('.dir-item').forEach((el) => {
    el.addEventListener('click', () => {
      const url = el.dataset.url;

      // For real agent URLs (not hardcoded placeholders), open directly
      if (X402Protocol.safeUrl(url)) {
        chrome.tabs.create({ url });
      } else {
        chrome.runtime.sendMessage({ type: 'OPEN_A2ALIST', path: '' });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Discoveries tab
// ---------------------------------------------------------------------------
async function loadDiscoveries() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_DISCOVERIES' });
  const discoveries = resp?.discoveries || [];
  const n = discoveries.length;

  discCount.textContent      = n;
  discHeaderCount.textContent = `${n} site${n === 1 ? '' : 's'} discovered`;

  if (!n) {
    discoveriesList.innerHTML = `<div class="empty-list">
      No x402 sites discovered yet.<br>
      Browse the web and they'll appear here.<br><br>
      <small style="color:#444">Find known x402 sites on</small><br>
      <a href="#" id="disc-empty-link" style="color:#22c55e;font-size:11px;text-decoration:none">a2alist.ai →</a>
    </div>`;
    document.getElementById('disc-empty-link')?.addEventListener('click', () =>
      chrome.runtime.sendMessage({ type: 'OPEN_A2ALIST', path: '' })
    );
    return;
  }

  discoveriesList.innerHTML = discoveries.map((d) => `
    <div class="disc-item">
      <div class="disc-url">${esc(d.url)}</div>
      <div class="disc-meta">
        ${d.network ? `<span class="net">${esc(d.network)}</span> · ` : ''}
        ${d.amount && d.amount !== 'unknown' ? `${esc(d.amount)} · ` : ''}
        ${relTime(d.discoveredAt)}
      </div>
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
btnProbe.addEventListener('click', async () => {
  if (!currentUrl || !confirm('Send one unauthenticated GET to this URL? Cookies are omitted and redirects refused.')) return;
  btnProbe.disabled   = true;
  btnProbe.textContent = 'Probing…';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'PROBE_URL', url: currentUrl, tabId: currentTabId });
    showContent(currentUrl, resp?.result || null);
    showToast(resp?.result ? '✓ x402 confirmed' : 'No x402 found');
  } catch { showToast('Probe failed'); }
  finally {
    btnProbe.disabled   = false;
    btnProbe.textContent = 'Re-probe this URL';
  }
});

btnSubmit.addEventListener('click', async () => {
  if (!currentX402 || !currentUrl) return;
  if (!confirm('Open a directory submission form with the redacted URL and network? Nothing is submitted automatically.')) return;
  const info = currentX402;
  const params = new URLSearchParams({
    url: info.url,
    name: new URL(currentUrl).hostname,
    description: info.description || `x402-enabled service on ${new URL(currentUrl).hostname}`,
    protocol: 'x402',
    category: 'ai',
    network: info.network || 'unknown',
    source: 'x402-extension',
  });
  chrome.tabs.create({ url: `${A2ALIST_URL}/submit?${params.toString()}` });
});

btnExport.addEventListener('click', async () => {
  const resp        = await chrome.runtime.sendMessage({ type: 'GET_DISCOVERIES' });
  const discoveries = resp?.discoveries || [];
  if (!discoveries.length) { showToast('Nothing to export yet'); return; }

  const blob = new Blob([JSON.stringify(discoveries, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `x402-discoveries-${new Date().toISOString().split('T')[0]}.json`,
  });
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${discoveries.length} sites`);
});

// a2alist.ai CTA buttons
[footerA2alist, btnDirOpen, btnEmptyA2alist, btnBrowseDir, dirViewAll].forEach((el) => {
  el?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'OPEN_A2ALIST', path: '' });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function truncateUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const s = u.hostname + (u.pathname !== '/' ? u.pathname : '');
    return s.length > 48 ? s.slice(0, 48) + '…' : s;
  } catch { return url.length > 48 ? url.slice(0, 48) + '…' : url; }
}

function shortHost(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function truncMid(s, max) {
  if (!s || s.length <= max) return s;
  const h = Math.floor((max - 3) / 2);
  return s.slice(0, h) + '…' + s.slice(-h);
}

function relTime(iso) {
  if (!iso) return '—';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)    return 'just now';
    if (m < 60)   return `${m}m ago`;
    if (m < 1440) return `${Math.floor(m / 60)}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch { return iso; }
}

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// Boot
init();
