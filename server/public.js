'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { PORT } = require('./config');

const APP_SHELL = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function absoluteBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function escHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escXml(value) {
  return escHtml(value).replace(/'/g, '&apos;');
}

function stripEntryMarkup(value) {
  return String(value || '')
    .replace(/:(happy|laugh|love|surprised|silly|proud|angry|sad|crying|worried|sleepy|cool):/g, '')
    .replace(/\[(\/?)(b|i|u|s)\]/g, '').replace(/\s+/g, ' ').trim();
}

function entryDescription(entry) {
  const text = stripEntryMarkup(entry.content || entry.title);
  return text.length > 155 ? `${text.slice(0, 152).trim()}...` : text;
}

function renderServerEntry(entry) {
  const title = stripEntryMarkup(entry.title) || entry.title;
  const meta = [entry.childName, entry.happenedOn, entry.ageNote].filter(Boolean).map(escHtml).join(' &bull; ');
  return `<article class="list-item post-detail-entry">
    <div class="list-item-head"><div><h1 class="list-item-title">${escHtml(title)}</h1><div class="meta-line">${meta}</div></div></div>
    ${entry.content ? `<div class="entry-content">${escHtml(stripEntryMarkup(entry.content)).replace(/\n/g, '<br>')}</div>` : ''}
    ${entry.photo ? `<img class="entry-photo" src="${escHtml(entry.photo)}" alt="${escHtml(`Снимка към ${title}`)}">` : ''}
  </article>`;
}

function renderEntryShell(req, entry, routePath, indexable) {
  const canonical = `${absoluteBaseUrl(req)}${routePath}`;
  const entryTitle = stripEntryMarkup(entry.title) || entry.title;
  const title = `${entryTitle} - Семейни бисери`;
  const description = entryDescription(entry) || 'Споделен запис от архива „Семейни бисери“.';
  const initialData = JSON.stringify({ ...entry, sharePath: routePath }).replace(/</g, '\\u003c');
  const headExtras = [
    `<meta property="og:url" content="${escHtml(canonical)}">`,
    indexable ? '' : '<meta name="robots" content="noindex,nofollow">\n  <meta name="referrer" content="no-referrer">',
  ];
  if (indexable) {
    const jsonLd = {
      '@context': 'https://schema.org', '@type': 'Article', headline: entryTitle, description,
      datePublished: entry.createdAt ? new Date(Number(entry.createdAt) * 1000).toISOString() : undefined,
      dateModified: entry.updatedAt ? new Date(Number(entry.updatedAt) * 1000).toISOString() : undefined,
      mainEntityOfPage: canonical, isAccessibleForFree: true,
    };
    headExtras.push(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`);
  }
  let html = APP_SHELL
    .replace('<title>Семейни бисери</title>', `<title>${escHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escHtml(description)}">`)
    .replace('<meta property="og:type" content="website">', '<meta property="og:type" content="article">')
    .replace('<meta property="og:title" content="Семейни бисери">', `<meta property="og:title" content="${escHtml(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escHtml(description)}">`)
    .replace('<link rel="canonical" href="/">', `<link rel="canonical" href="${escHtml(canonical)}">`)
    .replace('</head>', `  ${headExtras.filter(Boolean).join('\n  ')}\n</head>`)
    .replace('<dialog id="post-detail-dialog"', '<dialog open id="post-detail-dialog" data-server-rendered="true"')
    .replace('<div id="post-detail-body" class="post-detail-body"></div>', `<div id="post-detail-body" class="post-detail-body">${renderServerEntry(entry)}</div>`)
    .replace('<script type="module" src="/js/app.js"></script>', `<script id="initial-post-detail" type="application/json">${initialData}</script>\n  <script type="module" src="/js/app.js"></script>`);
  if (!indexable) {
    html = html.replace('<button id="post-detail-share"', '<button hidden id="post-detail-share"');
  }
  return html;
}

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!DOCTYPE html><html lang="bg"><head><meta charset="UTF-8"><title>Записът не е намерен</title><meta name="robots" content="noindex"></head><body>Записът не е намерен.</body></html>');
}

function handlePublicPost(req, res, id) {
  const entry = db.getPublicHowler(id);
  if (!entry) return sendNotFound(res);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderEntryShell(req, entry, `/posts/${entry.id}`, true));
}

function handleSharedPost(req, res, token) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const entry = db.getSharedHowler(token);
  if (!entry) return sendNotFound(res);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderEntryShell(req, entry, `/shared/${token}`, false));
}

function handleSitemap(req, res) {
  const base = absoluteBaseUrl(req);
  const entries = db.listPublicHowlers(50000);
  const urls = [{ loc: `${base}/`, changefreq: 'daily', priority: '1.0' }, ...entries.map(entry => ({
    loc: `${base}/posts/${entry.id}`,
    lastmod: entry.updatedAt ? new Date(Number(entry.updatedAt) * 1000).toISOString() : undefined,
    changefreq: 'weekly', priority: '0.7',
  }))];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `  <url>
    <loc>${escXml(url.loc)}</loc>
${url.lastmod ? `    <lastmod>${escXml(url.lastmod)}</lastmod>\n` : ''}    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
  res.end(xml);
}

function handleRobots(req, res) {
  const base = absoluteBaseUrl(req);
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: ${base}/sitemap.xml
`);
}

module.exports = {
  absoluteBaseUrl, escHtml, escXml, stripEntryMarkup, entryDescription, renderEntryShell,
  handlePublicPost, handleSharedPost, handleSitemap, handleRobots,
};
