'use strict';

const db = require('./db');
const { PORT } = require('./config');

function absoluteBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function escHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escXml(value) {
  return escHtml(value).replace(/'/g, '&apos;');
}

function stripEntryMarkup(value) {
  return String(value || '')
    .replace(/:(happy|laugh|love|surprised|silly|proud|angry|sad|crying|worried|sleepy|cool):/g, '')
    .replace(/\[(\/?)(b|i|u|s)\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function entryDescription(entry) {
  const text = stripEntryMarkup(entry.content || entry.title);
  return text.length > 155 ? `${text.slice(0, 152).trim()}...` : text;
}

function renderPublicEntryHtml(req, entry) {
  const base = absoluteBaseUrl(req);
  const canonical = `${base}/posts/${entry.id}`;
  const entryTitle = stripEntryMarkup(entry.title) || entry.title;
  const title = `${entryTitle} - Семейни бисери`;
  const description = entryDescription(entry) || 'Публичен семеен бисер от архива „Семейни бисери“.';
  const date = entry.happenedOn || '';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: entryTitle,
    description,
    datePublished: entry.createdAt ? new Date(Number(entry.createdAt) * 1000).toISOString() : undefined,
    dateModified: entry.updatedAt ? new Date(Number(entry.updatedAt) * 1000).toISOString() : undefined,
    mainEntityOfPage: canonical,
    isAccessibleForFree: true,
  };
  return `<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(description)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(description)}">
  <meta property="og:url" content="${escHtml(canonical)}">
  <meta name="twitter:card" content="summary">
  <link rel="canonical" href="${escHtml(canonical)}">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="/css/style.css">
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>
<body>
  <nav class="site-nav">
    <div class="nav-inner">
      <a class="nav-brand public-post-brand" href="/">
        <span class="nav-eyebrow">Личен дневник</span>
        <span class="nav-title">Семейни бисери</span>
        <span class="nav-subtitle">Реплики, случки и малки легенди</span>
      </a>
      <div class="nav-actions">
        <a class="primary-btn small-btn public-post-home" href="/">Към лентата</a>
      </div>
    </div>
  </nav>
  <main class="public-post-main">
    <article class="list-item public-post-card">
      <div class="list-item-head">
        <div>
          <h1 class="list-item-title">${escHtml(entryTitle)}</h1>
          <div class="meta-line">${[entry.childName, date].filter(Boolean).map(escHtml).join(' • ')}</div>
        </div>
      </div>
      ${entry.content ? `<div class="entry-content">${escHtml(stripEntryMarkup(entry.content)).replace(/\n/g, '<br>')}</div>` : ''}
      ${entry.photo ? `<img class="entry-photo" src="${escHtml(entry.photo)}" alt="${escHtml(`Снимка към ${entryTitle}`)}">` : ''}
    </article>
  </main>
</body>
</html>`;
}

function handlePublicPost(req, res, id) {
  const entry = db.getPublicHowler(id);
  if (!entry) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="bg"><head><meta charset="UTF-8"><title>Записът не е намерен</title><meta name="robots" content="noindex"></head><body>Записът не е намерен.</body></html>`);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderPublicEntryHtml(req, entry));
}

function handleSitemap(req, res) {
  const base = absoluteBaseUrl(req);
  const entries = db.listPublicHowlers(50000);
  const urls = [
    { loc: `${base}/`, changefreq: 'daily', priority: '1.0' },
    ...entries.map(entry => ({
      loc: `${base}/posts/${entry.id}`,
      lastmod: entry.updatedAt ? new Date(Number(entry.updatedAt) * 1000).toISOString() : undefined,
      changefreq: 'weekly',
      priority: '0.7',
    })),
  ];
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
  absoluteBaseUrl,
  escHtml,
  escXml,
  stripEntryMarkup,
  entryDescription,
  renderPublicEntryHtml,
  handlePublicPost,
  handleSitemap,
  handleRobots,
};
