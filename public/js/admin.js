import { apiJson, esc, fmtDate, fmtSize, fmtUptime, numCell } from './admin/core.js';
import { createConfirmDialog, createToast } from './admin/dialogs.js';

const toast = createToast();
const { askConfirm } = createConfirmDialog();

// ── State ────────────────────────────────────────────────────

let allEntries = [];
let entrySearchQuery = '';

// ── Stats ────────────────────────────────────────────────────

async function loadStats() {
  const stats = await apiJson('/api/admin/stats');

  document.getElementById('st-dbsize-val').textContent   = fmtSize(stats.dbSize);
  document.getElementById('st-heap-val').textContent     = fmtSize(stats.heapUsed);
  document.getElementById('st-users-val').textContent    = stats.totalUsers;
  document.getElementById('st-entries-val').textContent  = stats.totalEntries;
  document.getElementById('st-public-val').textContent   = stats.totalPublic;
  document.getElementById('st-favs-val').textContent     = stats.totalFavorites;
  document.getElementById('st-kids-val').textContent     = stats.totalKids;
  document.getElementById('st-sessions-val').textContent = stats.totalSessions;
  document.getElementById('st-uptime-val').textContent   = fmtUptime(stats.uptime);
  document.getElementById('uptime-badge').textContent    = 'работи ' + fmtUptime(stats.uptime);

  renderBreakdown('category-bars', stats.categories || []);
  renderBreakdown('mood-bars', stats.moods || []);
}

function renderBreakdown(containerId, items) {
  const el = document.getElementById(containerId);
  if (!items.length) { el.innerHTML = '<span class="cell-muted">Няма данни</span>'; return; }
  const max = Math.max(...items.map(i => i.total), 1);
  el.innerHTML = items.map(item => `
    <div class="bar-row" data-tooltip="${esc(item.label)}">
      <span class="bar-label">${esc(item.label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round((item.total / max) * 100)}%"></div></div>
      <span class="bar-count">${item.total}</span>
    </div>
  `).join('');
}

// ── Entries ──────────────────────────────────────────────────

async function loadEntries() {
  allEntries = await apiJson('/api/admin/entries');
  renderEntries();
}

function renderEntries() {
  const tbody = document.getElementById('entries-body');
  const q = entrySearchQuery.toLowerCase();
  const filtered = q
    ? allEntries.filter(e =>
        (e.username + e.title + e.childName + e.category + e.mood + e.happenedOn)
          .toLowerCase().includes(q))
    : allEntries;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="loading-cell">${q ? 'Няма записи по този филтър.' : 'Още няма записи.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(e => `
    <tr data-entry-id="${e.id}">
      <td class="num-cell cell-muted">${e.id}</td>
      <td><strong>${esc(e.username)}</strong></td>
      <td>${esc(e.childName)}</td>
      <td class="admin-entry-title" data-tooltip="${esc(e.title)}"><span>${esc(e.title)}</span></td>
      <td><span class="pill pill-private">${esc(e.category)}</span></td>
      <td class="cell-muted">${esc(e.mood)}</td>
      <td class="cell-muted" style="white-space:nowrap">${esc(e.happenedOn || '-')}</td>
      <td style="white-space:nowrap">${fmtDate(e.updatedAt)}</td>
      <td class="center-col">
        <span class="pill ${e.isPublic ? 'pill-public' : 'pill-private'}">${e.isPublic ? 'Публичен' : 'Личен'}</span>
      </td>
      <td class="center-col">${e.isFavorite ? '<span class="pill pill-fav">★</span>' : '<span class="cell-muted">-</span>'}</td>
      <td>
        <div class="row-actions">
          <button class="btn-sm btn-sm-toggle ${e.isPublic ? 'is-public' : ''}" data-action="toggle-public" data-id="${e.id}">${e.isPublic ? 'Направи личен' : 'Направи публичен'}</button>
          <button class="btn-sm btn-sm-danger" data-action="delete-entry" data-id="${e.id}">Изтрий</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function toggleEntryPublic(id) {
  const res = await apiJson(`/api/admin/entries/${id}`, { method: 'PATCH' });
  const entry = allEntries.find(e => e.id === id);
  if (entry) entry.isPublic = res.isPublic;
  renderEntries();
  loadStats();
  toast(res.isPublic ? 'Записът вече е публичен.' : 'Записът вече е личен.');
}

async function deleteEntry(id) {
  const ok = await askConfirm({
    title: 'Изтриване на запис',
    message: 'Записът ще бъде изтрит завинаги. Това действие не може да се отмени.',
    okLabel: 'Изтрий'
  });
  if (!ok) return;
  await apiJson(`/api/admin/entries/${id}`, { method: 'DELETE' });
  allEntries = allEntries.filter(e => e.id !== id);
  renderEntries();
  loadStats();
  toast('Записът е изтрит.');
}

// ── Users ────────────────────────────────────────────────────

async function loadUsers() {
  const users = await apiJson('/api/admin/users');
  const tbody = document.getElementById('users-body');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="loading-cell">Още няма потребители.</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => `
    <tr data-user-id="${u.id}">
      <td class="num-cell cell-muted">${u.id}</td>
      <td><strong>${esc(u.username)}</strong></td>
      <td class="cell-muted">${esc(u.locale)}</td>
      <td style="white-space:nowrap">${fmtDate(u.createdAt)}</td>
      ${numCell(u.entryCount)}
      ${numCell(u.publicCount)}
      ${numCell(u.favoriteCount)}
      <td style="white-space:nowrap">${fmtDate(u.lastEntryAt)}</td>
      ${numCell(u.sessionCount)}
      <td><span class="pill ${u.isLocked ? 'pill-locked' : 'pill-public'}">${u.isProtected ? 'Защитен' : u.isManualLock ? 'Заключен' : u.isLocked ? 'Временно заключен' : 'Активен'}</span></td>
      <td>
        <div class="row-actions">
          <button class="btn-sm btn-sm-warn" data-action="clear-sessions" data-id="${u.id}">Изчисти сесиите</button>
          ${u.isProtected
            ? '<span class="pill pill-public">Защитен</span>'
            : `<button class="btn-sm ${u.isLocked ? 'btn-sm-toggle' : 'btn-sm-warn'}" data-action="toggle-user-lock" data-id="${u.id}" data-username="${esc(u.username)}" data-locked="${u.isLocked}">${u.isLocked ? 'Отключи' : 'Заключи'}</button>
               <button class="btn-sm btn-sm-danger" data-action="delete-user" data-id="${u.id}" data-username="${esc(u.username)}">Изтрий потребителя</button>`}
        </div>
      </td>
    </tr>
  `).join('');
}

async function toggleUserLock(userId, username, currentlyLocked) {
  const locking = !currentlyLocked;
  const ok = await askConfirm({
    title: locking ? `Заключване на „${username}“` : `Отключване на „${username}“`,
    message: locking
      ? 'Потребителят ще бъде изкаран от всички устройства и няма да може да влиза, докато не го отключиш.'
      : 'Потребителят отново ще може да влиза в профила си.',
    okLabel: locking ? 'Заключи' : 'Отключи'
  });
  if (!ok) return;
  await apiJson(`/api/admin/users/${userId}/lock`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locked: locking }),
  });
  toast(locking ? 'Профилът е заключен.' : 'Профилът е отключен.');
  await loadUsers();
}

// SMTP settings
const mailForm = document.getElementById('mail-settings-form');

async function loadMailSettings() {
  const settings = await apiJson('/api/admin/mail');
  mailForm.elements.host.value = settings.host || '';
  mailForm.elements.port.value = settings.port || 465;
  mailForm.elements.security.value = settings.security || 'tls';
  mailForm.elements.username.value = settings.username || '';
  mailForm.elements.password.value = '';
  mailForm.elements.sender.value = settings.sender || '';
  const status = document.getElementById('mail-status');
  status.textContent = settings.configured ? 'Настроен' : 'Не е настроен';
  status.className = `pill ${settings.configured ? 'pill-public' : 'pill-private'}`;
}

mailForm.addEventListener('submit', async event => {
  event.preventDefault();
  const fields = new FormData(mailForm);
  const body = Object.fromEntries(fields.entries());
  body.port = Number(body.port);
  const result = document.getElementById('mail-result');
  result.textContent = '';
  try {
    await apiJson('/api/admin/mail', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    result.textContent = 'Настройките са запазени.';
    await loadMailSettings();
  } catch (error) {
    result.textContent = error.message;
  }
});

document.getElementById('mail-test-btn').addEventListener('click', async event => {
  const button = event.currentTarget;
  const result = document.getElementById('mail-result');
  button.disabled = true;
  result.textContent = 'Изпращане...';
  try {
    await apiJson('/api/admin/mail/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: mailForm.elements.sender.value }),
    });
    result.textContent = 'Тестовият имейл е изпратен.';
  } catch (error) {
    result.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

async function clearUserSessions(userId) {
  const ok = await askConfirm({
    title: 'Изчистване на сесии',
    message: 'Потребителят ще бъде изкаран от всички активни сесии.',
    okLabel: 'Изчисти сесиите'
  });
  if (!ok) return;
  await apiJson(`/api/admin/users/${userId}/sessions`, { method: 'DELETE' });
  toast('Сесиите са изчистени. Потребителят ще бъде излязъл.');
  loadUsers();
}

async function deleteUser(userId, username) {
  const ok = await askConfirm({
    title: `Изтриване на „${username}“`,
    message: 'Потребителят, всички негови записи, деца и сесии ще бъдат изтрити завинаги. Това не може да се отмени.',
    okLabel: 'Изтрий потребителя'
  });
  if (!ok) return;
  try {
    await apiJson(`/api/admin/users/${userId}`, { method: 'DELETE' });
  } catch (error) {
    toast(error.message || 'Потребителят не може да бъде изтрит.');
    return;
  }
  toast(`Потребителят „${username}“ е изтрит.`);
  loadAll();
}

// ── Vacuum ───────────────────────────────────────────────────

async function vacuumDb() {
  const btn = document.getElementById('vacuum-btn');
  btn.disabled = true;
  btn.textContent = 'Работи...';
  try {
    await apiJson('/api/admin/vacuum', { method: 'POST' });
    toast('Базата е оптимизирана и WAL промените са записани.');
    await loadStats();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Оптимизирай БД';
  }
}

// ── Refresh ──────────────────────────────────────────────────

async function loadAll() {
  await Promise.all([loadStats(), loadEntries(), loadUsers()]);
}

let refreshSecs = 30;
let refreshInterval = null;

function startAutoRefresh() {
  clearInterval(refreshInterval);
  refreshSecs = 30;
  refreshInterval = setInterval(() => {
    refreshSecs--;
    const el = document.getElementById('refresh-countdown');
    if (el) el.textContent = `обновяване след ${refreshSecs} сек.`;
    if (refreshSecs <= 0) {
      refreshSecs = 30;
      loadAll().catch(console.error);
    }
  }, 1000);
}

// ── Event delegation ─────────────────────────────────────────

document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id, username, locked } = btn.dataset;
  const numId = Number(id);
  if (action === 'toggle-public')  await toggleEntryPublic(numId);
  if (action === 'delete-entry')   await deleteEntry(numId);
  if (action === 'clear-sessions') await clearUserSessions(numId);
  if (action === 'toggle-user-lock') await toggleUserLock(numId, username, locked === 'true');
  if (action === 'delete-user')    await deleteUser(numId, username);
});

document.getElementById('refresh-btn').addEventListener('click', () => {
  loadAll().catch(console.error);
  startAutoRefresh();
  toast('Данните са обновени.');
});

document.getElementById('vacuum-btn').addEventListener('click', vacuumDb);

document.getElementById('entry-search').addEventListener('input', e => {
  entrySearchQuery = e.target.value.trim();
  renderEntries();
});

// ── Boot ─────────────────────────────────────────────────────

Promise.all([loadAll(), loadMailSettings()]).catch(console.error);
startAutoRefresh();
