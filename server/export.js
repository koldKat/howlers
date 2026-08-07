'use strict';

const db = require('./db');
const { send } = require('./http');

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
  text.replace(/:(happy|laugh|love|surprised|silly|proud|angry|sad|crying|worried|sleepy|cool):/g, (token, slug, offset) => {
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

function sendTxtExport(req, res, session, entries) {
  const name = session.display_name || session.username;
  const lines = [];
  lines.push(`Семейни бисери - ${name}`);
  lines.push(`Изтеглено: ${new Date().toLocaleString('bg-BG')}`);
  lines.push('═'.repeat(60));
  for (const e of entries) {
    lines.push('');
    lines.push(`Заглавие:   ${e.title}`);
    if (e.childName) lines.push(`Дете:       ${e.childName}`);
    if (e.happenedOn) lines.push(`Дата:       ${e.happenedOn}`);
    if (e.ageNote) lines.push(`Възраст:    ${e.ageNote}`);
    if (e.category) lines.push(`Категория:  ${e.category}`);
    if (e.mood) lines.push(`Настроение: ${e.mood}`);
    if (e.content) lines.push(`\n${e.content}`);
    if (e.photo) lines.push('[Има прикачена снимка]');
    if ((e.tags || []).length) lines.push(`Тагове:     ${e.tags.join(', ')}`);
    lines.push('─'.repeat(60));
  }
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': `attachment; filename="howlers-${session.username}.txt"`,
  });
  res.end(lines.join('\n'));
}

function sendPrintExport(res, session, entries) {
  const name = session.display_name || session.username;
  const cards = entries.map(e => `
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">${renderInlineContent(e.title)}</div>
            <div class="card-meta">${[e.childName, e.happenedOn, e.ageNote].filter(Boolean).map(escapeHtml).join(' · ')}</div>
          </div>
          ${e.category ? `<span class="badge">${escapeHtml(e.category)}</span>` : ''}
        </div>
        ${e.content ? `<div class="content">${renderInlineContent(e.content)}</div>` : ''}
        ${e.photo ? `<img class="photo" src="${escapeHtml(e.photo)}" alt="">` : ''}
        ${e.mood ? `<div class="mood">${escapeHtml(e.mood)}</div>` : ''}
        ${(e.tags || []).length ? `<div class="tags">${e.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="bg"><head>
<meta charset="UTF-8">
<title>Семейни бисери - ${escapeHtml(name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, serif; font-size: 13px; color: #2c1a0e; background: #fff; padding: 28px 36px; }
  h1 { font-size: 1.6rem; font-weight: 800; margin-bottom: 0.2rem; }
  .subtitle { color: #888; font-size: 0.85rem; margin-bottom: 2rem; }
  .card { border: 1px solid #e0d5c8; border-radius: 10px; padding: 14px 16px; margin-bottom: 16px; break-inside: avoid; }
  .card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .card-title { font-weight: 700; font-size: 1rem; font-family: 'Trebuchet MS', sans-serif; }
  .inline-emoticon { display: inline-block; width: 1.45em; height: 1.45em; margin: 0 0.06em; vertical-align: -0.38em; }
  .card-meta { font-size: 0.78rem; color: #888; margin-top: 2px; }
  .badge { font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 99px; background: #f3e9d5; color: #7a5020; white-space: nowrap; }
  .content { font-size: 0.96rem; color: #4f4036; line-height: 1.65; margin: 6px 0; }
  .photo { display: block; max-width: 100%; max-height: 520px; object-fit: contain; border-radius: 10px; margin: 8px 0; }
  .mood { font-size: 0.75rem; color: #888; margin-top: 6px; }
  .tags { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
  .tag { font-size: 0.7rem; padding: 1px 7px; border-radius: 99px; background: #ede8f0; color: #5a3a7a; }
  @media print { body { padding: 0; } }
</style>
</head><body>
<h1>Семейни бисери</h1>
<div class="subtitle">${escapeHtml(name)} · Изтеглено ${new Date().toLocaleDateString('bg-BG')}</div>
${cards}
<script>window.addEventListener('load', () => window.print());<\/script>
</body></html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleExport(req, res, session) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const format = url.searchParams.get('format') || 'txt';
  const entries = db.listHowlers(session.user_id);

  if (format === 'txt') {
    sendTxtExport(req, res, session, entries);
    return;
  }

  if (format === 'pdf') {
    sendPrintExport(res, session, entries);
    return;
  }

  send(res, 400, { error: 'Непознат формат. Използвай ?format=txt или ?format=pdf.' });
}

module.exports = { handleExport };
