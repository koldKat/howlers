const SUPPORTED = ['bg'];
const DEFAULT = 'bg';

let locale = DEFAULT;
let strings = {};

async function loadStrings(lang) {
  const res = await fetch(`/locales/${lang}.json`);
  if (!res.ok) throw new Error(`Езиковият файл не може да бъде зареден: ${lang}`);
  return res.json();
}

export async function initI18n(preferredLocale) {
  locale = SUPPORTED.includes(preferredLocale) ? preferredLocale : DEFAULT;
  strings = await loadStrings(locale);
  applyI18n();
}

export function t(key, vars = {}) {
  let s = Object.prototype.hasOwnProperty.call(strings, key) ? strings[key] : key;
  for (const [k, v] of Object.entries(vars)) {
    s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

export function getLocale() {
  return locale;
}

export async function setLocale(lang) {
  if (!SUPPORTED.includes(lang)) return;
  locale = lang;
  strings = await loadStrings(lang);
  applyI18n();
}

export function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-tooltip]').forEach(el => {
    const value = t(el.dataset.i18nTooltip);
    el.dataset.tooltip = value;
    el.setAttribute('aria-label', value);
  });
  document.documentElement.lang = locale;
}
