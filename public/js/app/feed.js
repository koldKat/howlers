import { t } from '../i18n.js';
import { categoryClass, categoryLabel, entryMetaLine, renderInlineContent } from './entry-presentation.js';
import { escapeHtml } from './format.js';

export function createFeedController(els, { feedLoader, onKids, onProfileState, onViewer }) {
  let latestState = null;
  let latestFeed = [];
  let renderTimer = null;

  function formatDateTimeFromUnix(value) {
    return value ? new Date(Number(value) * 1000).toLocaleString('bg-BG') : t('date_na');
  }

  function query() {
    return els.searchInput.value.trim().toLowerCase();
  }

  function filterEntries(entries) {
    const value = query();
    if (!value) return entries;
    return entries.filter(entry =>
      [entry.childName, entry.title, entry.content, entry.quote, entry.story, entry.ageNote, ...(entry.tags || [])]
        .join(' ').toLowerCase().includes(value)
    );
  }

  function entryCard(entry, editable) {
    const title = editable
      ? `<a class="list-item-title public-entry-link" href="/posts/${entry.id}">${renderInlineContent(entry.title)}</a>`
      : `<div class="list-item-title">${renderInlineContent(entry.title)}</div>`;
    return `<article class="list-item">
      <div class="list-item-head">
        <div>${title}<div class="meta-line">${entryMetaLine(entry)}</div></div>
        ${entry.category ? `<span class="badge ${escapeHtml(categoryClass(entry.category))}">${escapeHtml(categoryLabel(entry.category))}</span>` : ''}
      </div>
      ${entry.content ? `<div class="entry-content">${renderInlineContent(entry.content)}</div>` : ''}
      ${entry.photo ? `<img class="entry-photo" src="${escapeHtml(entry.photo)}" alt="${escapeHtml(t('entry_photo_alt', { title: entry.title }))}">` : ''}
      ${editable ? `<div class="entry-meta">
        ${entry.isFavorite ? `<span class="tag-chip favorite-chip">${escapeHtml(t('tag_favorite'))}</span>` : ''}
        ${(entry.tags || []).map(tag => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join('')}
      </div><div class="entry-actions"><button class="secondary-link" data-edit-id="${entry.id}">${escapeHtml(t('entry_edit_btn'))}</button></div>` : ''}
    </article>`;
  }

  function renderChips(target, items, labelBuilder) {
    target.innerHTML = items.length
      ? items.map(item => `<span class="data-chip">${escapeHtml(labelBuilder(item))}</span>`).join('')
      : `<span class="data-chip">${escapeHtml(t('no_data_chip'))}</span>`;
  }

  function renderPublicFeed(entries) {
    latestFeed = Array.isArray(entries) ? entries : [];
    els.feedList.innerHTML = latestFeed.length
      ? latestFeed.map(entry => entryCard(entry, false)).join('')
      : `<div class="empty-state">${escapeHtml(t('feed_empty'))}</div>`;
  }

  async function loadPublicFeed() {
    feedLoader.show(t('feed_loading'));
    try {
      const response = await fetch('/api/feed');
      renderPublicFeed(await response.json());
    } catch {
      renderPublicFeed([]);
    }
  }

  function render(state) {
    latestState = state;
    if (state.publicFeed) latestFeed = Array.isArray(state.publicFeed) ? state.publicFeed : [];
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
    const publicFallback = ownEntries.length === 0;
    const filtered = filterEntries(publicFallback ? latestFeed : ownEntries);
    if (publicFallback) {
      els.archiveKicker.textContent = '';
      els.feedList.innerHTML = filtered.length
        ? filtered.map(entry => entryCard(entry, false)).join('')
        : `<div class="empty-state">${escapeHtml(t(query() ? 'empty_no_filter_match' : 'feed_empty'))}</div>`;
      return;
    }
    const total = ownEntries.length;
    els.archiveKicker.textContent = filtered.length === total
      ? t(total === 1 ? 'archive_kicker_all_one' : 'archive_kicker_all_many', { total })
      : t('archive_kicker_filtered', { filtered: filtered.length, total });
    els.feedList.innerHTML = filtered.length
      ? filtered.map(entry => entryCard(entry, true)).join('')
      : `<div class="empty-state">${escapeHtml(t('empty_no_filter_match'))}</div>`;
  }

  function scheduleRender(delay = 120) {
    if (!latestState) return;
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      render(latestState);
    }, delay);
  }

  function setPublicFeed(entries) {
    latestFeed = Array.isArray(entries) ? entries : [];
  }

  return {
    clearState: () => { latestState = null; },
    currentState: () => latestState,
    loadPublicFeed,
    render,
    renderPublicFeed: () => renderPublicFeed(latestFeed),
    scheduleRender,
    setPublicFeed,
  };
}
