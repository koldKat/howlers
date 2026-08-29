import { t } from '../i18n.js';
import { apiFetch } from './api.js';
import { categoryClass, categoryLabel, entryMetaLine, renderInlineContent } from './entry-presentation.js';
import { escapeHtml } from './format.js';

const POST_PATH_RE = /^\/posts\/(\d+)$/;
const SHARED_PATH_RE = /^\/shared\/([A-Za-z0-9_-]{32})$/;
const BASE_DESCRIPTION = 'Семейни бисери е публична лента и личен семеен архив за смешни детски реплики, истории и малки семейни легенди.';
const BASE_OG_DESCRIPTION = 'Публична лента и личен семеен архив за смешни детски реплики, истории и малки семейни легенди.';

function plainTitle(value) {
  return String(value || '')
    .replace(/:(happy|laugh|love|surprised|silly|proud|angry|sad|crying|worried|sleepy|cool):/g, '')
    .replace(/\[(\/?)(b|i|u|s)\]/g, '').trim();
}

function renderEntry(entry) {
  return `<article class="list-item post-detail-entry">
    <div class="list-item-head"><div>
      <h1 class="list-item-title">${renderInlineContent(entry.title)}</h1>
      <div class="meta-line">${entryMetaLine(entry)}</div>
    </div>${entry.category ? `<span class="badge ${escapeHtml(categoryClass(entry.category))}">${escapeHtml(categoryLabel(entry.category))}</span>` : ''}</div>
    ${entry.content ? `<div class="entry-content">${renderInlineContent(entry.content)}</div>` : ''}
    ${entry.photo ? `<img class="entry-photo" src="${escapeHtml(entry.photo)}" alt="${escapeHtml(t('entry_photo_alt', { title: entry.title }))}">` : ''}
  </article>`;
}

function initialServerEntry() {
  const script = document.getElementById('initial-post-detail');
  if (!script?.textContent) return null;
  try { return JSON.parse(script.textContent); } catch { return null; }
}

function detailRoute(pathname = window.location.pathname) {
  const publicMatch = pathname.match(POST_PATH_RE);
  if (publicMatch) return { kind: 'public', key: Number(publicMatch[1]), path: pathname };
  const sharedMatch = pathname.match(SHARED_PATH_RE);
  if (sharedMatch) return { kind: 'shared', key: sharedMatch[1], path: pathname };
  return null;
}

export function createPostDetailController(elements) {
  const baseTitle = 'Семейни бисери';
  let currentEntry = initialServerEntry();
  let requestSequence = 0;

  function restoreBaseMetadata() {
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', '/');
    document.querySelector('meta[name="description"]')?.setAttribute('content', BASE_DESCRIPTION);
    document.querySelector('meta[property="og:type"]')?.setAttribute('content', 'website');
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', baseTitle);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', BASE_OG_DESCRIPTION);
    document.querySelector('meta[property="og:url"]')?.remove();
    document.querySelector('meta[name="robots"]')?.remove();
    document.querySelector('meta[name="referrer"]')?.remove();
    document.querySelector('script[type="application/ld+json"]')?.remove();
  }

  function prepareDialog(canShare = true) {
    elements.postDetailShare.hidden = !canShare;
    elements.postDetailShareStatus.textContent = '';
    if (!elements.postDetailDialog.open) elements.postDetailDialog.showModal();
    else if (elements.postDetailDialog.dataset.serverRendered) {
      elements.postDetailDialog.close();
      delete elements.postDetailDialog.dataset.serverRendered;
      elements.postDetailDialog.showModal();
    }
    document.body.classList.add('post-detail-open');
  }

  function show(entry) {
    currentEntry = entry;
    elements.postDetailBody.innerHTML = renderEntry(entry);
    const isPrivateLink = SHARED_PATH_RE.test(entry.sharePath || window.location.pathname);
    prepareDialog(entry.isPublic && !isPrivateLink);
    document.title = `${plainTitle(entry.title) || t('post_detail_title')} - ${baseTitle}`;
  }

  function hide() {
    requestSequence += 1;
    if (elements.postDetailDialog.open) elements.postDetailDialog.close();
    document.body.classList.remove('post-detail-open');
    elements.postDetailShareStatus.textContent = '';
    document.title = baseTitle;
    restoreBaseMetadata();
    currentEntry = null;
  }

  async function loadRoute(route) {
    const sequence = ++requestSequence;
    const endpoint = route.kind === 'public' ? `/api/public/howlers/${route.key}` : `/api/shared/${route.key}`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(t('post_detail_unavailable'));
    const entry = await response.json();
    return sequence === requestSequence ? { ...entry, sharePath: route.path } : null;
  }

  async function openRoute(route, { entry = null, push = true } = {}) {
    if (!route) return;
    elements.postDetailBody.innerHTML = `<div class="empty-state">${escapeHtml(t('post_detail_loading'))}</div>`;
    prepareDialog(route.kind === 'public');
    try {
      const initialMatches = entry?.sharePath === route.path;
      const loaded = initialMatches ? entry : await loadRoute(route);
      if (!loaded) return;
      show({ ...loaded, sharePath: route.path });
      if (push && window.location.pathname !== route.path) {
        window.history.pushState({ postDetail: true }, '', route.path);
      }
    } catch (error) {
      elements.postDetailBody.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
      elements.postDetailShare.hidden = true;
    }
  }

  function openPublic(id, options = {}) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1) return Promise.resolve();
    return openRoute({ kind: 'public', key: numericId, path: `/posts/${numericId}` }, options);
  }

  function close() {
    if (detailRoute() && window.history.state?.postDetail) return window.history.back();
    if (detailRoute()) window.history.replaceState({}, '', '/');
    hide();
  }

  async function copyUrl(url) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        return;
      } catch {
        // Fall through for browsers that expose Clipboard API but deny this call.
      }
    }
    const input = document.createElement('textarea');
    input.value = url;
    input.style.cssText = 'position:fixed;opacity:0';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('copy failed');
  }

  async function share(entry = currentEntry, sourceButton = null) {
    if (!entry?.id) return;
    const originalButtonText = sourceButton?.textContent || '';
    const wasDisabled = Boolean(sourceButton?.disabled);
    if (sourceButton) sourceButton.disabled = true;
    const showSourceMessage = message => {
      elements.postDetailShareStatus.textContent = message;
      if (!sourceButton) return;
      sourceButton.textContent = message;
      window.setTimeout(() => { sourceButton.textContent = t('post_share_btn') || originalButtonText; }, 1800);
    };
    try {
      let path = entry.sharePath || (entry.isPublic ? `/posts/${entry.id}` : '');
      if (!path || (!entry.isPublic && !SHARED_PATH_RE.test(path))) {
        path = (await apiFetch(`/api/howlers/${entry.id}/share`, { method: 'POST' })).path;
        entry.sharePath = path;
      }
      const url = new URL(path, window.location.origin).href;
      if (navigator.share) {
        try {
          await navigator.share({ title: plainTitle(entry.title), text: plainTitle(entry.title), url });
          return;
        } catch (error) {
          if (error.name === 'AbortError') return;
        }
      }
      await copyUrl(url);
      showSourceMessage(t('post_share_copied'));
    } catch (error) {
      if (error.name !== 'AbortError') showSourceMessage(t('post_share_failed'));
    } finally {
      if (sourceButton) sourceButton.disabled = wasDisabled;
    }
  }

  function bindEvents() {
    elements.postDetailClose.addEventListener('click', close);
    elements.postDetailShare.addEventListener('click', () => share());
    elements.postDetailDialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    let backdropPress = false;
    elements.postDetailDialog.addEventListener('pointerdown', event => { backdropPress = event.target === elements.postDetailDialog; });
    elements.postDetailDialog.addEventListener('pointerup', event => {
      if (backdropPress && event.target === elements.postDetailDialog) close();
      backdropPress = false;
    });
    window.addEventListener('popstate', () => {
      const route = detailRoute();
      if (route) openRoute(route, { push: false });
      else hide();
    });
  }

  async function openInitialRoute() {
    const route = detailRoute();
    if (route) await openRoute(route, { entry: currentEntry, push: false });
  }

  return { bindEvents, close, openInitialRoute, openPublic, share };
}
