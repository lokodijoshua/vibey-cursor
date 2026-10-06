const PAGE_SIZE = 10;
let currentPage = 0;

function siteUrl() {
  return (globalThis.VIBEY_CONFIG && globalThis.VIBEY_CONFIG.SITE_URL) || 'https://landing-page-navy-six-58.vercel.app';
}

function renderLocked() {
  const list = document.getElementById('history-list');
  document.getElementById('clear-all').style.display = 'none';
  document.getElementById('pager').style.display = 'none';
  list.innerHTML = `
    <div class="locked-wrap">
      <div class="locked-preview">
        <div class="card blurred">📦 Section · &lt;div&gt; · example.com</div>
        <div class="card blurred">🔹 Element · &lt;button&gt; · example.com</div>
        <div class="card blurred">🔹 Element · &lt;h1&gt; · example.com</div>
      </div>
      <div class="locked-overlay">
        <div class="locked-title">🔒 History is a Pro feature</div>
        <div class="locked-sub">Every capture you take is saved here with its screenshot — upgrade to unlock it.</div>
        <button id="locked-upgrade">Upgrade to Pro</button>
      </div>
    </div>
  `;
  document.getElementById('locked-upgrade').addEventListener('click', () => {
    chrome.tabs.create({ url: `${siteUrl()}/pricing.html` });
  });
}

function renderCard(item) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    ${item.screenshot ? `<img src="${item.screenshot}">` : ''}
    <div class="meta">${item.mode === 'section' ? '📦 Section' : '🔹 Element'} · &lt;${item.tag}&gt; · ${new URL(item.url).hostname}</div>
    <div class="actions">
      <button class="copy-prompt">Copy Prompt</button>
      <button class="copy-json">Copy JSON</button>
      <button class="del">Delete</button>
    </div>
  `;
  card.querySelector('.copy-prompt').addEventListener('click', () => navigator.clipboard.writeText(item.prompt));
  card.querySelector('.copy-json').addEventListener('click', () => navigator.clipboard.writeText(JSON.stringify(item.json, null, 2)));
  card.querySelector('.del').addEventListener('click', async () => {
    const { vcHistory = [] } = await chrome.storage.local.get('vcHistory');
    await chrome.storage.local.set({ vcHistory: vcHistory.filter(h => h.id !== item.id) });
    render();
  });
  return card;
}

async function render() {
  const { vcHistory = [], licensePlan = 'free' } = await chrome.storage.local.get(['vcHistory', 'licensePlan']);
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
