export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatDate(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function parseDateInput(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const local = input.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  const year = Number(iso?.[1] || local?.[3]);
  const month = Number(iso?.[2] || local?.[2]);
  const day = Number(iso?.[3] || local?.[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)
    || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return input;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function dataUrlBytes(dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  if (comma < 0) return 0;
  const base64 = dataUrl.slice(comma + 1);
  return Math.max(0, Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0));
}
