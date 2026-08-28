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
    wrap.innerHTML = `<div class="folder-row"><label><input class="folder-check" data-id="${folder.id}" type="checkbox"> ▾ ${escapeHtml(folder.name)}</label><button class="delete" data-folder="${folder.id}">×</button></div>`;
    folder.feeds.forEach(feed => {
      const row = document.createElement('div'); row.className = 'feed-row'; row.dataset.id = feed.id;
      row.innerHTML = `<label><input class="feed-check" data-id="${feed.id}" type="checkbox"> ${escapeHtml(feed.title)}</label>`;
      row.onclick = event => { if (event.target.tagName !== 'INPUT') selectFeed(folder, feed, row); };
      wrap.append(row);
    });
    box.append(wrap);
  });
  box.querySelectorAll('[data-folder]').forEach(button => button.onclick = async () => {
    if (confirm('Delete this folder, its feeds, and saved articles?')) {
      await api('/api/folders/' + button.dataset.folder, {method: 'DELETE'}); await loadFolders();
    }
  });
  box.querySelectorAll('.feed-row').forEach(row => {
    const button = document.createElement('button'); button.className = 'delete'; button.textContent = '×';
    button.onclick = async event => { event.stopPropagation(); if (confirm('Delete this feed?')) { await api('/api/feeds/' + row.dataset.id, {method: 'DELETE'}); await loadFolders(); } };
    row.append(button);
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
  const selected = folders.flatMap(folder => folder.feeds.filter(feed => feedIds.includes(feed.id) || folderIds.includes(folder.id)).map(feed => ({folder, feed})));
  if (!selected.length) return;
  let saved = 0;
  for (const {folder, feed} of selected) {
    try { const data = await api('/api/feeds/' + feed.id + '/items'); const articles = await api('/api/articles/bulk', {method:'POST', body:JSON.stringify({articles:data.items.map(item => ({...item, source:feed.title}))})}); for (const article of articles) { await api('/api/folders/' + folder.id + '/saved', {method:'POST', body:JSON.stringify(article)}); saved++; } }
    catch (error) { status(error.message); }
  }
  status(`Saved ${saved} snapshot articles`); await loadFolders();
}

$('#add-folder').onclick = async () => { const name = prompt('Folder name:'); if (name) { try { await api('/api/folders', {method:'POST', body:JSON.stringify({name})}); await loadFolders(); } catch (error) { alert(error.message); } } };
$('#add-feed').onclick = async () => { if (!folders.length) return alert('Create a folder first.'); const url = prompt('RSS or Atom feed URL:'); const folderName = prompt('Folder name:'); const folder = folders.find(item => item.name.toLowerCase() === String(folderName).toLowerCase()); if (url && folder) try { await api('/api/feeds', {method:'POST', body:JSON.stringify({url, folder_id:folder.id})}); await loadFolders(); } catch (error) { alert(error.message); } };
$('#select-all').onchange = event => document.querySelectorAll('.article-check').forEach(input => { input.checked = event.target.checked; });
$('#extract-selected').onclick = () => extractSelected(false); $('#snapshot-feeds').onclick = () => snapshotFeeds();
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
