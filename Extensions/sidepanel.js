const PAGE_SIZE = 10;
let currentPage = 0;
let historyOpenedTracked = false;

function spTrack(event, props) {
  try {
    if (globalThis.VIBEY_ANALYTICS && globalThis.VIBEY_ANALYTICS.track) {
      globalThis.VIBEY_ANALYTICS.track(event, props || {});
    }
  } catch (e) { /* never break UI */ }
}

function spIcon(name) {
  try {
    if (globalThis.vibeyIcon) return globalThis.vibeyIcon(name);
  } catch (e) { /* icons are decorative */ }
  return '';
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function siteUrl() {
  return (globalThis.VIBEY_CONFIG && globalThis.VIBEY_CONFIG.SITE_URL) || 'https://vibey-cursor-landing-page.vercel.app';
}

function renderLocked() {
  const list = document.getElementById('history-list');
  document.getElementById('clear-all').style.display = 'none';
  document.getElementById('pager').style.display = 'none';
  list.innerHTML = `
    <div class="locked-wrap">
      <div class="locked-preview">
        <div class="card blurred">${spIcon('box')}<span>Section · &lt;div&gt; · example.com</span></div>
        <div class="card blurred">${spIcon('frame')}<span>Element · &lt;button&gt; · example.com</span></div>
        <div class="card blurred">${spIcon('frame')}<span>Element · &lt;h1&gt; · example.com</span></div>
      </div>
      <div class="locked-overlay">
        <div class="locked-title">${spIcon('lock')}<span>History is a Pro feature</span></div>
        <div class="locked-sub">Every capture you take is saved here with its screenshot — upgrade to unlock it.</div>
        <button id="locked-upgrade">Upgrade to Pro</button>
      </div>
    </div>
  `;
  document.getElementById('locked-upgrade').addEventListener('click', () => {
    spTrack('upsell_clicked', { source: 'history-locked' });
    chrome.tabs.create({ url: `${siteUrl()}/pricing.html` });
  });
}

function renderCard(item) {
  const card = document.createElement('div');
  card.className = 'card';
  const isSection = item.mode === 'section';
  const kindIcon = isSection ? spIcon('box') : spIcon('frame');
  const kindLabel = isSection ? 'Section' : 'Element';
  let host = '';
  try {
    host = new URL(item.url).hostname;
  } catch (e) { host = ''; }
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `${kindIcon}<span></span>`;
  meta.querySelector('span').textContent = `${kindLabel} · <${item.tag}> · ${host}`;
  const img = item.screenshot ? document.createElement('img') : null;
  if (img) img.src = item.screenshot;
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `
      <button class="copy-prompt" aria-label="Copy prompt">${spIcon('copy')}<span>Copy Prompt</span></button>
      <button class="copy-json" aria-label="Copy JSON">${spIcon('code')}<span>Copy JSON</span></button>
      <button class="del" aria-label="Delete capture">${spIcon('trash')}<span>Delete</span></button>
  `;
  if (img) card.appendChild(img);
  card.appendChild(meta);
  card.appendChild(actions);
  card.querySelector('.copy-prompt').addEventListener('click', () => {
    navigator.clipboard.writeText(item.prompt);
    spTrack('history_item_copied', { tag: item.tag, mode: item.mode, source: 'prompt' });
  });
  card.querySelector('.copy-json').addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(item.json, null, 2));
    spTrack('history_item_copied', { tag: item.tag, mode: item.mode, source: 'json' });
  });
  card.querySelector('.del').addEventListener('click', async () => {
    spTrack('history_item_deleted', { tag: item.tag, mode: item.mode });
    const { vcHistory = [] } = await chrome.storage.local.get('vcHistory');
    await chrome.storage.local.set({ vcHistory: vcHistory.filter(h => h.id !== item.id) });
    render();
  });
  return card;
}

async function render() {
  const { vcHistory = [], licensePlan = 'free' } = await chrome.storage.local.get(['vcHistory', 'licensePlan']);
  if (!historyOpenedTracked) {
    historyOpenedTracked = true;
    spTrack('history_opened', { source: 'sidepanel' });
    if (licensePlan !== 'pro') spTrack('upsell_shown', { source: 'history-locked' });
  }
  const list = document.getElementById('history-list');
  const pager = document.getElementById('pager');
  list.innerHTML = '';

  if (licensePlan !== 'pro') {
    renderLocked();
    return;
  }
  document.getElementById('clear-all').style.display = '';

  if (vcHistory.length === 0) {
    pager.style.display = 'none';
    list.innerHTML = `<p style="color:#666; text-align:center; margin-top:40px;">No captures yet. Click any element on a page to start.</p>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(vcHistory.length / PAGE_SIZE));
  if (currentPage >= totalPages) currentPage = totalPages - 1;
  if (currentPage < 0) currentPage = 0;

  vcHistory
    .slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE)
    .forEach(item => list.appendChild(renderCard(item)));

  if (totalPages > 1) {
    pager.style.display = 'flex';
    document.getElementById('page-info').textContent = `Page ${currentPage + 1} of ${totalPages} · ${vcHistory.length}/50 kept`;
    document.getElementById('page-prev').disabled = currentPage === 0;
    document.getElementById('page-next').disabled = currentPage === totalPages - 1;
  } else {
    pager.style.display = 'none';
  }
}

try {
  document.getElementById('page-prev').innerHTML = `${spIcon('chevL')}<span>Prev</span>`;
  document.getElementById('page-next').innerHTML = `<span>Next</span>${spIcon('chevR')}`;
} catch (e) { /* keep text labels */ }
document.getElementById('page-prev').addEventListener('click', () => {
  if (currentPage > 0) { currentPage -= 1; render(); }
});

document.getElementById('page-next').addEventListener('click', () => {
  currentPage += 1;
  render();
});

document.getElementById('clear-all').addEventListener('click', async () => {
  await chrome.storage.local.set({ vcHistory: [] });
  currentPage = 0;
  render();
});

chrome.storage.onChanged.addListener(() => {
  currentPage = 0;
  render();
});
render();
