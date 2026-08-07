export function fmtSize(bytes) {
  const v = Number(bytes || 0);
  if (v >= 1024 * 1024 * 1024) return (v / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (v >= 1024 * 1024) return (v / (1024 * 1024)).toFixed(1) + ' MB';
  if (v >= 1024) return (v / 1024).toFixed(1) + ' KB';
  return Math.max(0, Math.round(v)) + ' B';
}

export function fmtUptime(seconds) {
  const s = Number(seconds || 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(d + 'д');
  if (h) parts.push(h + 'ч');
  parts.push(m + 'мин');
  return parts.join(' ');
}

export function fmtDate(unixSeconds) {
  if (!unixSeconds) return '<span class="cell-muted">-</span>';
  const d = new Date(Number(unixSeconds) * 1000);
  return `${d.toLocaleDateString()} <span class="cell-muted">${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
}

export function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function numCell(n) {
  return `<td class="num-cell ${n === 0 ? 'zero' : ''}">${n}</td>`;
}

export async function apiJson(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Заявката е неуспешна (${response.status}).`);
  return body;
}
