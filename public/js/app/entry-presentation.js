import { t } from '../i18n.js';
import { getToken } from './api.js';
import { CATEGORY_SLUGS, EMOTICON_ASSET, EMOTICON_SLUGS, EMOTICON_TOKEN_RE, MOOD_SLUGS } from './constants.js';
import { escapeHtml, formatDate } from './format.js';

export function entryMetaLine(entry) {
  return [entry.childName, formatDate(entry.happenedOn), entry.ageNote]
    .filter(Boolean)
    .map(escapeHtml)
    .join(' \u2022 ');
}

export function categoryLabel(category) {
  if (!category) return '';
  const key = `category_${category}`;
  const value = t(key);
  return value !== key ? value : category;
}

export function moodLabel(mood) {
  if (!mood) return '';
  const key = `mood_${mood}`;
  const value = t(key);
  return value !== key ? value : mood;
}

export function categoryClass(category) {
  return CATEGORY_SLUGS.includes(category) ? category : 'custom';
}

export function moodClass(mood) {
  return MOOD_SLUGS.includes(mood) ? `mood-${mood}` : 'mood-custom';
}

export function emoticonLabel(slug) {
  const key = `emoticon_${slug}`;
  const value = t(key);
  return value !== key ? value : slug;
}

export function emoticonSvg(slug, className = 'inline-emoticon') {
  if (!EMOTICON_SLUGS.includes(slug)) return '';
  return `<svg class="${className}" viewBox="0 0 64 64" role="img" aria-label="${escapeHtml(emoticonLabel(slug))}"><use href="${EMOTICON_ASSET}#${slug}"></use></svg>`;
}

export function entryPhotos(entry) {
  if (Array.isArray(entry?.photos)) return entry.photos.filter(Boolean);
  if (Array.isArray(entry?.photoUrls)) return entry.photoUrls.filter(Boolean);
  return entry?.photo ? [entry.photo] : [];
}

export function renderEntryPhotos(entry, { eagerFirst = false } = {}) {
  const photos = entryPhotos(entry);
  if (!photos.length) return '';
  const photoAlt = t('entry_photo_alt', { title: entry.title });
  return `<div class="entry-photo-gallery">${photos.map((photo, index) => {
    const position = photos.length > 1 ? ` ${index + 1}/${photos.length}` : '';
    const deferredFeedPhoto = photo.startsWith('/api/');
    const source = deferredFeedPhoto
      ? `data-photo-src="${escapeHtml(photo)}"`
      : `src="${escapeHtml(photo)}"`;
    const priority = eagerFirst && index === 0 ? 'high' : 'low';
    const loadingClass = deferredFeedPhoto ? ' is-loading' : '';
    return `<button class="entry-photo-button${loadingClass}" type="button" data-view-photo aria-label="${escapeHtml(t('entry_photo_open'))}${position}"><img class="entry-photo${loadingClass}" ${source} data-photo-priority="${priority}" alt="${escapeHtml(photoAlt)}${position}" loading="lazy" decoding="async"></button>`;
  }).join('')}</div>`;
}

export function activateDeferredPhotos(container) {
  const images = [...container.querySelectorAll('img[data-photo-src]')];
  if (!images.length) return () => {};
  const objectUrls = new Set();
  let disposed = false;

  async function load(image) {
    const source = image.dataset.photoSrc;
    if (!source) return;
    delete image.dataset.photoSrc;
    try {
      const token = getToken();
      const response = await fetch(source, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        priority: image.dataset.photoPriority === 'high' ? 'high' : 'low',
      });
      if (!response.ok) throw new Error('Photo request failed');
      const objectUrl = URL.createObjectURL(await response.blob());
      if (disposed) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      objectUrls.add(objectUrl);
      image.src = objectUrl;
      await image.decode().catch(() => {});
      image.classList.remove('is-loading');
      image.closest('.entry-photo-button')?.classList.remove('is-loading');
    } catch {
      image.closest('.entry-photo-button')?.remove();
    }
  }

  let observer = null;
  const [firstImage, ...remainingImages] = images;
  const loadRemaining = () => {
    if (disposed || !remainingImages.length) return;
    if (!('IntersectionObserver' in window)) {
      remainingImages.forEach(load);
      return;
    }
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        load(entry.target);
      }
    }, { rootMargin: '120px 0px' });
    remainingImages.forEach(image => observer.observe(image));
  };
  load(firstImage);
  loadRemaining();

  return () => {
    disposed = true;
    observer?.disconnect();
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls.clear();
  };
}

export function renderInlineContent(value) {
  const text = String(value || '');
  let html = '';
  let lastIndex = 0;
  text.replace(EMOTICON_TOKEN_RE, (token, slug, offset) => {
    html += escapeHtml(text.slice(lastIndex, offset));
    html += emoticonSvg(slug);
    lastIndex = offset + token.length;
    return token;
  });
  html += escapeHtml(text.slice(lastIndex));
  return [
    ['b', 'strong'],
    ['i', 'em'],
    ['u', 'u'],
    ['s', 's'],
  ].reduce(
    (output, [marker, element]) => output.replace(
      new RegExp(`\\[${marker}\\]([\\s\\S]*?)\\[\\/${marker}\\]`, 'g'),
      `<${element}>$1</${element}>`
    ),
    html
  );
}
