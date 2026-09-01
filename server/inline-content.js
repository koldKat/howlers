'use strict';

const EMOTICON_PATTERN = /:(happy|laugh|love|surprised|silly|proud|angry|sad|crying|worried|sleepy|cool):/g;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderInlineContent(value) {
  const text = String(value || '');
  let html = '';
  let lastIndex = 0;
  text.replace(EMOTICON_PATTERN, (token, slug, offset) => {
    html += escapeHtml(text.slice(lastIndex, offset));
    html += `<svg class="inline-emoticon" viewBox="0 0 64 64" aria-label="${escapeHtml(slug)}"><use href="/emoticons.svg#${slug}"></use></svg>`;
    lastIndex = offset + token.length;
    return token;
  });
  html += escapeHtml(text.slice(lastIndex));
  html = [
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
  return html.replace(/\n/g, '<br>');
}

module.exports = { renderInlineContent };
