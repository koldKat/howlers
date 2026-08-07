#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');
const documents = [
  { base: 'USER_GUIDE', lang: 'bg', title: 'Семейни бисери - Ръководство за потребителя', background: '#fffaf2' },
  { base: 'ADMIN', lang: 'bg', title: 'Семейни бисери - Админ ръководство', background: '#fffaf2' },
  { base: 'TECHNICAL', lang: 'en', title: 'Howlers Webapp - Technical Documentation', background: '#f8fafc' },
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(value) {
  const code = [];
  let output = String(value).replace(/`([^`]+)`/g, (_, content) => {
    const token = `\u0000CODE${code.length}\u0000`;
    code.push(`<code>${escapeHtml(content)}</code>`);
    return token;
  });
  output = escapeHtml(output);
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => (
    `<a href="${escapeHtml(href)}">${label}</a>`
  ));
  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  output = output.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)]);
  return output;
}

function markdownToHtml(markdown) {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let paragraph = [];
  let listType = null;
  let codeFence = null;
  let codeLines = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = null;
  }

  for (const line of lines) {
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      flushParagraph();
      closeList();
      if (codeFence !== null) {
        const language = codeFence ? ` class="language-${escapeHtml(codeFence)}"` : '';
        output.push(`<pre><code${language}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeFence = null;
        codeLines = [];
      } else {
        codeFence = fence[1].trim();
      }
      continue;
    }

    if (codeFence !== null) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const wantedType = unordered ? 'ul' : 'ol';
      if (listType !== wantedType) {
        closeList();
        output.push(`<${wantedType}>`);
        listType = wantedType;
      }
      output.push(`<li>${renderInline((unordered || ordered)[1])}</li>`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  if (codeFence !== null) throw new Error('Незатворен Markdown code fence.');
  return output.join('\n');
}

function pageTemplate(document, body) {
  return `<!DOCTYPE html>
<html lang="${document.lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(document.title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: ${document.background}; color: #24324a; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; line-height: 1.65; }
    h1, h2, h3, h4 { line-height: 1.25; color: #1f2b40; }
    h1 { margin-top: 0; }
    h2 { margin-top: 1.9rem; border-top: 1px solid #ecdcc6; padding-top: 1rem; }
    h3 { margin-top: 1.25rem; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    code { background: #f6ead8; padding: 0.1rem 0.35rem; border-radius: 6px; }
    pre { background: #f6ead8; padding: 12px 14px; border-radius: 12px; overflow-x: auto; line-height: 1.45; }
    pre code { background: transparent; padding: 0; }
    ul, ol { padding-left: 1.35rem; }
    li { margin: 0.28rem 0; }
    a { color: #1d6fa5; }
  </style>
</head>
<body>
  <main>
${body}
  </main>
</body>
</html>
`;
}

let stale = false;
for (const document of documents) {
  const markdownPath = path.join(root, 'docs', `${document.base}.md`);
  const htmlPath = path.join(root, 'docs', `${document.base}.html`);
  const expected = pageTemplate(document, markdownToHtml(fs.readFileSync(markdownPath, 'utf8')));
  if (checkOnly) {
    if (!fs.existsSync(htmlPath) || fs.readFileSync(htmlPath, 'utf8') !== expected) {
      console.error(`[docs] ${path.relative(root, htmlPath)} is stale.`);
      stale = true;
    }
  } else {
    fs.writeFileSync(htmlPath, expected);
    console.log(`[docs] Wrote ${path.relative(root, htmlPath)}`);
  }
}

if (stale) {
  console.error('[docs] Run npm run docs:build and commit the generated HTML files.');
  process.exitCode = 1;
} else if (checkOnly) {
  console.log('[docs] Markdown and HTML documentation are synchronized.');
}
