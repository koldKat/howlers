'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MIME, ROOT } = require('./config');

function serveFile(req, res, pathname) {
  const cleanPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(ROOT, cleanPath.replace(/^\/+/, ''));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Забранен достъп');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Файлът не е намерен');
      return;
    }
    const etag = `"${data.length}-${crypto.createHash('md5').update(data).digest('hex').slice(0, 8)}"`;
    const headers = {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'ETag': etag,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': data.length });
    res.end(data);
  });
}

module.exports = { serveFile };
