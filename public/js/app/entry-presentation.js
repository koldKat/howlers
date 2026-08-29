import { t } from '../i18n.js';
import { CATEGORY_SLUGS, EMOTICON_SLUGS, EMOTICON_TOKEN_RE, MOOD_SLUGS } from './constants.js';
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
  return `<svg class="${className}" viewBox="0 0 64 64" role="img" aria-label="${escapeHtml(emoticonLabel(slug))}"><use href="/emoticons.svg#${slug}"></use></svg>`;
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
