let folders = [], currentFolder = null, currentFeed = null, currentArticle = null;
let refreshTimer = null, snapshotTimer = null;
const $ = selector => document.querySelector(selector);
const status = text => { $('#status').textContent = text; };

async function api(url, options = {}) {
  const response = await fetch(url, { headers: {'Content-Type': 'application/json'}, ...options });
  if (!response.ok) throw Error((await response.json()).error || response.statusText);
  return response.status === 204 ? null : response.json();
}

async function loadFolders() {
  folders = await api('/api/folders');
  const box = $('#folders'); box.innerHTML = '';
  folders.forEach(folder => {
    const wrap = document.createElement('div'); wrap.className = 'folder';
    wrap.innerHTML = `<div class="folder-row"><label><input class="folder-check" data-id="${folder.id}" type="checkbox"> ▾ ${escapeHtml(folder.name)}</label><a class="pipe-link" href="/pipelines?folder=${folder.id}" title="New pipeline from this folder">＋</a><button class="rename" data-rename-folder="${folder.id}" title="Rename">✎</button><button class="delete" data-folder="${folder.id}" title="Delete">×</button></div>`;
    folder.feeds.forEach(feed => {
      const row = document.createElement('div'); row.className = 'feed-row'; row.dataset.id = feed.id;
      row.innerHTML = `<label><input class="feed-check" data-id="${feed.id}" type="checkbox"> ${escapeHtml(feed.title)}</label>`;
      row.onclick = event => { if (event.target.tagName !== 'INPUT' && event.target.tagName !== 'BUTTON') selectFeed(folder, feed, row); };
      wrap.append(row);
    });
    box.append(wrap);
  });
  box.querySelectorAll('[data-rename-folder]').forEach(button => button.onclick = async event => {
    event.stopPropagation();
    const name = prompt('Rename folder:');
    if (name) { try { await api('/api/folders/' + button.dataset.renameFolder, {method: 'PATCH', body: JSON.stringify({name})}); await loadFolders(); } catch (e) { alert(e.message); } }
  });
  box.querySelectorAll('[data-folder]').forEach(button => button.onclick = async event => {
    event.stopPropagation();
    if (confirm('Delete this folder, its feeds, and saved articles?')) {
      await api('/api/folders/' + button.dataset.folder, {method: 'DELETE'}); await loadFolders();
    }
  });
  box.querySelectorAll('.feed-row').forEach(row => {
    const rename = document.createElement('button'); rename.className = 'rename'; rename.textContent = '✎'; rename.title = 'Rename';
    rename.onclick = async event => { event.stopPropagation(); const name = prompt('Rename feed:'); if (name) { try { await api('/api/feeds/' + row.dataset.id, {method: 'PATCH', body: JSON.stringify({title: name})}); await loadFolders(); } catch (e) { alert(e.message); } } };
    const button = document.createElement('button'); button.className = 'delete'; button.textContent = '×';
    button.onclick = async event => { event.stopPropagation(); if (confirm('Delete this feed?')) { await api('/api/feeds/' + row.dataset.id, {method: 'DELETE'}); await loadFolders(); } };
    row.append(rename); row.append(button);
  });
}

async function selectFeed(folder, feed, row) {
  currentFolder = folder; currentFeed = feed;
  document.querySelectorAll('.feed-row').forEach(item => item.classList.remove('active')); row.classList.add('active');
  $('#feed-title').textContent = feed.title; await refresh(); scheduleRefresh(); scheduleSnapshot();
}

async function refresh() {
  if (!currentFeed) return;
  status('Fetching feed…');
  try {
    const data = await api('/api/feeds/' + currentFeed.id + '/items'); const box = $('#items'); box.innerHTML = '';
    data.items.forEach((item, index) => {
      const element = document.createElement('div'); element.className = 'item';
      element.innerHTML = `<label><input class="article-check" data-index="${index}" type="checkbox"> <b>${escapeHtml(item.title || 'Untitled')}</b></label><small>${escapeHtml(item.published || '')}</small>`;
      element.onclick = event => { if (event.target.tagName !== 'INPUT') selectItem(item, element); };
      element.dataset.item = JSON.stringify({...item, source: data.source}); box.append(element);
    });
    status(`Loaded ${data.items.length} items`);
  } catch (error) { status(error.message); }
}

async function selectItem(item, element) {
  document.querySelectorAll('.item').forEach(itemElement => itemElement.classList.remove('active')); element.classList.add('active');
  status('Extracting article text…');
  try { currentArticle = await api('/api/article', {method: 'POST', body: JSON.stringify({...item, source: currentFeed.title})}); showArticle(currentArticle); }
  catch (error) { status(error.message); }
}

function showArticle(article) {
  currentArticle = article; $('#article-title').textContent = article.title || 'Untitled';
  $('#article-meta').textContent = `${article.source || ''} · ${article.published || ''}`; $('#article-text').textContent = article.text;
  const links = $('#article-links'); links.innerHTML = article.links?.length ? '<h3>Links in article</h3>' : '';
  (article.links || []).forEach(link => { const anchor = document.createElement('a'); anchor.href = link.url; anchor.target = '_blank'; anchor.rel = 'noopener'; anchor.textContent = link.text; links.append(anchor); });
  status('Article ready');
}

function selectedArticles() { return [...document.querySelectorAll('.article-check:checked')].map(input => JSON.parse(input.closest('.item').dataset.item)); }
async function snapshotForLLM() {
  if (currentArticle) return currentArticle.text;
  const articles = selectedArticles();
  if (!articles.length) throw Error('Select an article or check articles for the snapshot.');
  const extracted = await api('/api/articles/bulk', {method:'POST', body:JSON.stringify({articles})});
  return extracted.map((article, index) => `ARTICLE ${index + 1}\n${article.text}`).join('\n\n');
}
async function extractSelected(save = false) {
  const articles = selectedArticles(); if (!articles.length) return alert('Select at least one article.');
  status(`Extracting ${articles.length} articles…`);
  try { const extracted = await api('/api/articles/bulk', {method: 'POST', body: JSON.stringify({articles})}); if (save) for (const article of extracted) await api('/api/folders/' + currentFolder.id + '/saved', {method: 'POST', body: JSON.stringify(article)}); showArticle(extracted[0]); status(save ? `Saved ${extracted.length} snapshots` : `Extracted ${extracted.length} articles`); }
  catch (error) { status(error.message); }
}

function scheduleRefresh() { clearTimeout(refreshTimer); const value = scheduleValue('refresh'); if (value) refreshTimer = setTimeout(async () => { await refresh(); scheduleRefresh(); }, value); }
function scheduleSnapshot() { clearTimeout(snapshotTimer); const value = scheduleValue('snapshot'); if (value) snapshotTimer = setTimeout(async () => { await snapshotFeeds(); scheduleSnapshot(); }, value); }
function scheduleValue(name) { const value = $('#' + name).value; if (value === 'custom') return Number($('#' + name + '-custom').value) * 60000 || 0; return Number(value); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[character])); }

async function snapshotFeeds() {
  const feedIds = [...document.querySelectorAll('.feed-check:checked')].map(input => Number(input.dataset.id));
  const folderIds = [...document.querySelectorAll('.folder-check:checked')].map(input => Number(input.dataset.id));
  const selected = folders.flatMap(folder => folder.feeds.filter(feed => feedIds.includes(feed.id) || folderIds.includes(folder.id)));
  if (!selected.length) return status('Check at least one feed or folder first.');
  const name = prompt('Name this snapshot:', 'Feed snapshot ' + new Date().toLocaleDateString());
  if (!name) return;
  status('Capturing snapshot…');
  try {
    const res = await api('/api/snapshots', {method: 'POST', body: JSON.stringify({name, feed_ids: feedIds, folder_ids: folderIds})});
    status(`Captured snapshot with ${res.articles} articles`); renderSnapshots();
  } catch (error) { status(error.message); }
}

async function renderSnapshots() {
  const box = $('#snapshots');
  let snaps;
  try { snaps = await api('/api/snapshots'); } catch (e) { box.innerHTML = ''; return; }
  if (!snaps.length) { box.innerHTML = '<p class="run-meta">No snapshots yet. Capture one above.</p>'; return; }
  box.innerHTML = '';
  snaps.forEach(s => {
    const row = document.createElement('div'); row.className = 'snap-row';
    row.innerHTML = `<div class="snap-info"><b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.kind)} · ${s.article_count} articles · ${s.created_at}</small></div>`;
    const view = document.createElement('button'); view.textContent = 'View'; view.className = 'button';
    view.onclick = () => viewSnapshot(s.id);
    const pipe = document.createElement('button'); pipe.textContent = 'Pipeline'; pipe.className = 'button';
    pipe.onclick = () => { location.href = '/pipelines?snapshot=' + s.id; };
    const del = document.createElement('button'); del.textContent = '×'; del.className = 'delete';
    del.onclick = async () => { if (confirm('Delete this snapshot?')) { await api('/api/snapshots/' + s.id, {method: 'DELETE'}); renderSnapshots(); } };
    row.append(view); row.append(pipe); row.append(del);
    box.append(row);
  });
}

async function viewSnapshot(id) {
  status('Loading snapshot…');
  try {
    const data = await api('/api/snapshots/' + id);
    $('#feed-title').textContent = data.snapshot.name;
    const box = $('#items'); box.innerHTML = '';
    data.articles.forEach((article, index) => {
      const element = document.createElement('div'); element.className = 'item';
      element.innerHTML = `<label><input class="article-check" data-index="${index}" type="checkbox"> <b>${escapeHtml(article.title || 'Untitled')}</b></label><small>${escapeHtml(article.published || '')}</small>`;
      const stored = article;
      element.onclick = event => { if (event.target.tagName !== 'INPUT') { document.querySelectorAll('.item').forEach(i => i.classList.remove('active')); element.classList.add('active'); currentArticle = {...stored, links: stored.links || []}; showArticle(currentArticle); } };
      box.append(element);
    });
    status(`Snapshot has ${data.articles.length} articles`);
  } catch (e) { status(e.message); }
}

$('#add-folder').onclick = async () => { const name = prompt('Folder name:'); if (name) { try { await api('/api/folders', {method:'POST', body:JSON.stringify({name})}); await loadFolders(); } catch (error) { alert(error.message); } } };
$('#add-feed').onclick = async () => { if (!folders.length) return alert('Create a folder first.'); const url = prompt('RSS or Atom feed URL:'); const folderName = prompt('Folder name:'); const folder = folders.find(item => item.name.toLowerCase() === String(folderName).toLowerCase()); if (url && folder) try { await api('/api/feeds', {method:'POST', body:JSON.stringify({url, folder_id:folder.id})}); await loadFolders(); } catch (error) { alert(error.message); } };
$('#select-all').onchange = event => document.querySelectorAll('.article-check').forEach(input => { input.checked = event.target.checked; });
$('#extract-selected').onclick = () => extractSelected(false); $('#snapshot-feeds').onclick = () => snapshotFeeds();
$('#refresh-snapshots').onclick = () => renderSnapshots();
$('#snapshot-article').onclick = async () => {
  if (!currentArticle || !currentArticle.text) return status('Open an article first.');
  const name = prompt('Name this article snapshot:', currentArticle.title || 'Article');
  if (!name) return;
  try { const res = await api('/api/snapshots/article', {method: 'POST', body: JSON.stringify({...currentArticle, name})}); status('Saved article snapshot'); renderSnapshots(); }
  catch (e) { status(e.message); }
};
$('#refresh').onchange = () => { $('#refresh-custom').hidden = $('#refresh').value !== 'custom'; scheduleRefresh(); };
$('#snapshot').onchange = () => { $('#snapshot-custom').hidden = $('#snapshot').value !== 'custom'; scheduleSnapshot(); };
$('#export').onclick = async () => { if (!currentArticle) return; const response = await fetch('/api/export', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(currentArticle)}); const link = document.createElement('a'); link.href = URL.createObjectURL(await response.blob()); link.download = 'article.txt'; link.click(); };
$('#open').onclick = () => currentArticle?.url && window.open(currentArticle.url, '_blank');
$('#llm-run').onclick = async () => {
  const result = $('#llm-result'); result.textContent = 'Sending snapshot to model…';
  try {
    const snapshot = await snapshotForLLM();
    const data = await api('/api/llm/extract', {method:'POST', body:JSON.stringify({
      endpoint: $('#llm-endpoint').value, model: $('#llm-model').value, api_key: $('#llm-key').value,
      prompt: $('#llm-prompt').value, snapshot
    })});
    result.textContent = JSON.stringify(data.result, null, 2); status('JSON extraction complete');
  } catch (error) { result.textContent = error.message; status('LLM extraction failed'); }
};
$('#llm-endpoint').value = localStorage.getItem('llm-endpoint') || $('#llm-endpoint').value;
$('#llm-model').value = localStorage.getItem('llm-model') || '';
$('#llm-prompt').value = localStorage.getItem('llm-prompt') || '';
['llm-endpoint', 'llm-model', 'llm-prompt'].forEach(id => $('#' + id).onchange = () => localStorage.setItem(id, $('#' + id).value));
loadFolders().catch(error => status(error.message));
renderSnapshots().catch(() => {});
