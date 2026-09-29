import { t } from '../i18n.js';
import { apiFetch } from './api.js';
import {
  activateDeferredPhotos,
  categoryClass,
  categoryLabel,
  entryMetaLine,
  renderEntryPhotos,
  renderInlineContent,
} from './entry-presentation.js';
import { escapeHtml } from './format.js';

export function createFeedController(els, { feedLoader, onKids, onProfileState, onViewer }) {
  let latestState = null;
  let latestFeed = [];
  let publicFeedPage = null;
  let renderTimer = null;
  let requestSequence = 0;
  let loadingPage = false;
  let releaseFeedPhotos = () => {};

  function formatDateTimeFromUnix(value) {
    return value ? new Date(Number(value) * 1000).toLocaleString('bg-BG') : t('date_na');
  }

  function query() {
    return els.searchInput.value.trim();
  }

  function usesPublicFeed() {
    return !latestState?.viewer || (!query() && latestState.summary?.total === 0);
  }

  function pageUrl(path, offset) {
    const params = new URLSearchParams({ offset: String(offset || 0) });
    if (query()) params.set('q', query());
    return `${path}?${params}`;
  }

  function entryCard(entry, editable, eagerPhotos = false) {
    const title = entry.isPublic
      ? `<a class="list-item-title public-entry-link" data-open-post-id="${entry.id}" href="/posts/${entry.id}">${renderInlineContent(entry.title)}</a>`
      : `<div class="list-item-title">${renderInlineContent(entry.title)}</div>`;
    return `<article class="list-item">
      <div class="list-item-head">
        <div>${title}<div class="meta-line">${entryMetaLine(entry)}</div></div>
        ${entry.category ? `<span class="badge ${escapeHtml(categoryClass(entry.category))}">${escapeHtml(categoryLabel(entry.category))}</span>` : ''}
      </div>
      ${entry.content ? `<div class="entry-content">${renderInlineContent(entry.content)}</div>` : ''}
      ${renderEntryPhotos(entry, { eagerFirst: eagerPhotos })}
      ${editable ? `<div class="entry-meta">
        ${entry.isFavorite ? `<span class="tag-chip favorite-chip">${escapeHtml(t('tag_favorite'))}</span>` : ''}
        ${(entry.tags || []).map(tag => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join('')}
      </div>` : ''}
      <div class="entry-actions">
        ${entry.isPublic ? `<a class="secondary-link" data-open-post-id="${entry.id}" href="/posts/${entry.id}">${escapeHtml(t('entry_open_btn'))}</a>` : ''}
        <button class="secondary-link" data-share-post-id="${entry.id}">${escapeHtml(t('post_share_btn'))}</button>
        ${editable ? `<button class="secondary-link" data-edit-id="${entry.id}">${escapeHtml(t('entry_edit_btn'))}</button>` : ''}
      </div>
    </article>`;
  }

  function renderChips(target, items, labelBuilder) {
    target.innerHTML = items.length
      ? items.map(item => `<span class="data-chip">${escapeHtml(labelBuilder(item))}</span>`).join('')
      : `<span class="data-chip">${escapeHtml(t('no_data_chip'))}</span>`;
  }

  function renderPagination(page) {
    const totalPages = page?.limit ? Math.ceil(page.total / page.limit) : 0;
    els.feedPagination.hidden = totalPages <= 1;
    els.feedPagePrevious.disabled = loadingPage || !page?.hasPrevious;
    els.feedPageNext.disabled = loadingPage || !page?.hasMore;
    els.feedPageStatus.textContent = totalPages
      ? t('feed_page_status', {
          page: Math.floor(page.offset / page.limit) + 1,
          pages: totalPages,
        })
      : '';
  }

  function scrollToPageTop() {
    requestAnimationFrame(() => {
      els.feedList.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  }

  function renderPublicFeed(entries = latestFeed, page = publicFeedPage) {
    latestFeed = Array.isArray(entries) ? entries : [];
    publicFeedPage = page || null;
    releaseFeedPhotos();
    els.feedList.innerHTML = latestFeed.length
      ? latestFeed.map((entry, index) => entryCard(entry, false, index === 0)).join('')
      : `<div class="empty-state">${escapeHtml(query() ? t('empty_no_filter_match') : t('feed_empty'))}</div>`;
    releaseFeedPhotos = activateDeferredPhotos(els.feedList);
    renderPagination(publicFeedPage);
  }

  async function loadPublicFeed(preloaded = null) {
    feedLoader.show(t('feed_loading'));
    try {
      const result = preloaded || await fetch(pageUrl('/api/feed', 0)).then(response => {
        if (!response.ok) throw new Error('Feed request failed');
        return response.json();
      });
      renderPublicFeed(result.entries || [], result.page);
      return result;
    } catch {
      renderPublicFeed([], null);
      return null;
    }
  }

  function render(state, { searchResult = false } = {}) {
    if (!searchResult) {
      requestSequence += 1;
      loadingPage = false;
    }
    const previousState = latestState;
    const previousPublicOffset = publicFeedPage?.offset || 0;
    const preservePublicPage = !query()
      && state.viewer
      && state.summary?.total === 0
      && previousState?.viewer
      && previousPublicOffset > 0
      && !searchResult;
    if (query() && state.viewer && !searchResult) {
      if (previousState?.viewer) {
        state = { ...state, entries: previousState.entries, entriesPage: previousState.entriesPage };
      }
      scheduleRender(0, previousState?.entriesPage?.offset || 0);
    } else if (state.viewer && previousState?.viewer && previousState.entriesPage?.offset > 0 && !searchResult) {
      state = { ...state, entries: previousState.entries, entriesPage: previousState.entriesPage };
      scheduleRender(0, previousState.entriesPage.offset);
    } else if (preservePublicPage) {
      scheduleRender(0, previousPublicOffset);
    }
    latestState = state;
    if (state.publicFeed && !preservePublicPage) {
      latestFeed = Array.isArray(state.publicFeed) ? state.publicFeed : [];
      publicFeedPage = state.publicFeedPage || null;
    }
    if (state.viewer) onViewer(state.viewer);
    onProfileState(state);

    els.heroMeta.textContent = state.summary.total
      ? t(state.summary.total === 1 ? 'hero_meta_with_data_one' : 'hero_meta_with_data_many', {
          total: state.summary.total,
          date: formatDateTimeFromUnix(state.summary.lastUpdatedAt),
        })
      : t('hero_meta_empty');
    els.summaryKicker.textContent = state.summary.total
      ? t('summary_kicker_with_data', {
          total: state.summary.total,
          stories: t(state.summary.total === 1 ? 'summary_story_one' : 'summary_story_many'),
          kids: state.summary.kids,
          children: t(state.summary.kids === 1 ? 'summary_kid_one' : 'summary_kid_many'),
        })
      : t('summary_kicker_empty');
    els.totalStat.textContent = String(state.summary.total || 0);
    els.totalSub.textContent = state.summary.total ? t('total_sub_with_data') : t('total_sub_empty');
    els.favoriteStat.textContent = String(state.summary.favorites || 0);
    els.favoriteSub.textContent = state.summary.favorites ? t('favorites_sub_with_data') : t('favorites_sub_empty');
    els.kidsStat.textContent = String(state.summary.kids || 0);
    els.kidsSub.textContent = state.summary.kidsBreakdown.length
      ? state.summary.kidsBreakdown.map(item => `${item.childName} ${item.total}`).join(' \u2022 ')
      : t('kids_sub_empty');
    renderChips(els.categoryStrip, state.summary.categories || [], item => `${categoryLabel(item.label)} ${item.total}`);
    renderChips(els.kidsStrip, state.summary.kidsBreakdown || [], item => `${item.childName} ${item.total}`);
    if (state.kids) onKids(state.kids);

    const ownEntries = state.entries || [];
    const publicFallback = !query() && state.summary.total === 0;
    if (publicFallback) {
      els.archiveKicker.textContent = '';
      renderPublicFeed();
      return;
    }

    const page = state.entriesPage;
    els.archiveKicker.textContent = query()
      ? t('archive_kicker_search', { shown: ownEntries.length, total: page?.total || 0 })
      : t(state.summary.total === 1 ? 'archive_kicker_all_one' : 'archive_kicker_all_many', {
          total: state.summary.total,
        });
    releaseFeedPhotos();
    els.feedList.innerHTML = ownEntries.length
      ? ownEntries.map((entry, index) => entryCard(entry, true, index === 0)).join('')
      : `<div class="empty-state">${escapeHtml(query() ? t('empty_no_filter_match') : t('feed_empty'))}</div>`;
    releaseFeedPhotos = activateDeferredPhotos(els.feedList);
    renderPagination(page);
  }

  async function loadPage(offset = 0, { scroll = false } = {}) {
    const authenticatedArchive = !usesPublicFeed();
    const page = authenticatedArchive ? latestState?.entriesPage : publicFeedPage;
    const sequence = ++requestSequence;
    loadingPage = true;
    renderPagination(page);
    try {
      const result = authenticatedArchive
        ? await apiFetch(pageUrl('/api/howlers', offset))
        : await fetch(pageUrl('/api/feed', offset)).then(response => {
            if (!response.ok) throw new Error('Feed request failed');
            return response.json();
          });
      if (sequence !== requestSequence) return;
      if (!result.entries?.length && offset > 0 && result.page?.total > 0) {
        const lastOffset = Math.floor((result.page.total - 1) / result.page.limit) * result.page.limit;
        loadingPage = false;
        return loadPage(lastOffset, { scroll });
      }
      if (authenticatedArchive) {
        latestState = { ...latestState, entries: result.entries || [], entriesPage: result.page };
        render(latestState, { searchResult: true });
      } else {
        renderPublicFeed(result.entries || [], result.page);
      }
      if (scroll) scrollToPageTop();
    } catch {
      if (offset === 0 && !authenticatedArchive) renderPublicFeed([], null);
    } finally {
      if (sequence === requestSequence) {
        loadingPage = false;
        renderPagination(authenticatedArchive ? latestState?.entriesPage : publicFeedPage);
      }
    }
  }

  function scheduleRender(delay = 180, offset = 0) {
    if (!latestState) return;
    requestSequence += 1;
    loadingPage = false;
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      loadPage(offset);
    }, delay);
  }

  function handlePublicUpdate(entries, page) {
    requestSequence += 1;
    loadingPage = false;
    if (query()) {
      loadPage(0);
      return;
    }
    if (publicFeedPage?.offset > 0) {
      loadPage(publicFeedPage.offset);
      return;
    }
    renderPublicFeed(entries, page);
  }

  function findEntry(id) {
    const numericId = Number(id);
    return (latestState?.entries || []).find(entry => entry.id === numericId)
      || latestFeed.find(entry => entry.id === numericId)
      || null;
  }

  return {
    clearState: () => {
      latestState = null;
      latestFeed = [];
      publicFeedPage = null;
      releaseFeedPhotos();
      releaseFeedPhotos = () => {};
      els.searchInput.value = '';
      requestSequence += 1;
      renderPagination(null);
    },
    currentState: () => latestState,
    findEntry,
    handlePublicUpdate,
    nextPage: () => {
      const page = usesPublicFeed() ? publicFeedPage : latestState?.entriesPage;
      if (!loadingPage && page?.hasMore) loadPage(page.nextOffset, { scroll: true });
    },
    previousPage: () => {
      const page = usesPublicFeed() ? publicFeedPage : latestState?.entriesPage;
      if (!loadingPage && page?.hasPrevious) loadPage(page.previousOffset, { scroll: true });
    },
    loadPublicFeed,
    render,
    scheduleRender,
  };
}
