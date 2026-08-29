import { initI18n, t } from './i18n.js';
import { apiFetch, clearToken, getToken, setToken } from './app/api.js';
import { createChildPicker } from './app/child-picker.js';
import { bindBackdropDismiss, getAppElements } from './app/dom.js';
import { createEditorTools } from './app/editor-tools.js';
import { createFeedController } from './app/feed.js';
import { createFeedLoader } from './app/feed-loading.js';
import { formatDate } from './app/format.js';
import { createKidsController } from './app/kids.js';
import { createProfileController } from './app/profile.js';

const els = getAppElements();
const feedLoader = createFeedLoader(els.feedList);
const editorTools = createEditorTools(els);
const childPicker = createChildPicker({
  container: els.childSelect,
  customInput: els.childName,
  ageNoteInput: els.ageNote,
  agePreview: els.childAgePreview,
  happenedOnInput: els.happenedOn,
});

let viewer = null;
let eventSource = null;
let confirmResolver = null;
let editorAdvancedOpen = false;
let handlingSessionExpiry = false;
const profileController = createProfileController(els, {
  getViewer: () => viewer,
  setViewer: value => { viewer = value; },
  onFamilyAccepted: () => hydrateApp(),
});
const kidsController = createKidsController(els, { childPicker, askConfirm });
const feedController = createFeedController(els, {
  feedLoader,
  onKids: kidsController.render,
  onProfileState: state => profileController.syncState({
    profile: state.profile,
    viewer: state.viewer,
    attention: state.attention,
  }),
  onViewer: nextViewer => { viewer = { ...viewer, ...nextViewer }; },
});

// ── Auth state ──────────────────────────────────────────────

function setAuthState(isLoggedIn) {
  els.navAddBtn.style.display    = isLoggedIn ? '' : 'none';
  els.navViewer.style.display    = isLoggedIn ? '' : 'none';
  els.navLogoutBtn.style.display = isLoggedIn ? '' : 'none';
  els.navLoginBtn.style.display  = isLoggedIn ? 'none' : '';
  els.feedToolbar.style.display  = isLoggedIn ? '' : 'none';
  els.feedKickerRow.style.display = isLoggedIn ? '' : 'none';
  els.feedSidebar.style.display  = isLoggedIn ? '' : 'none';
  els.guestSidebar.style.display = isLoggedIn ? 'none' : '';
  if (!isLoggedIn) {
    profileController.syncState({ attention: null });
  }
}
function showAuthModal(show) {
  els.authModal.style.display = show ? 'flex' : 'none';
}

// ── Editor ──────────────────────────────────────────────────

function isEditorOpen() { return els.editorOverlay.classList.contains('active'); }
function openEditor()   { els.editorOverlay.classList.add('active'); }
function closeEditor()  { els.editorOverlay.classList.remove('active'); els.formError.textContent = ''; }

function setEditorAdvancedOpen(open) {
  editorAdvancedOpen = Boolean(open);
  els.editorAdvanced.hidden = !editorAdvancedOpen;
  els.editorAdvancedToggle.setAttribute('aria-expanded', editorAdvancedOpen ? 'true' : 'false');
  els.editorAdvancedToggle.textContent = t(editorAdvancedOpen ? 'editor_advanced_hide' : 'editor_advanced_show');
}

function hasAdvancedEntryData(entry) {
  if (!entry) return false;
  return Boolean(
    entry.happenedOn ||
    entry.category ||
    entry.mood ||
    entry.ageNote ||
    (entry.tags || []).length ||
    entry.isFavorite ||
    entry.isPublic
  );
}

// ── Form ─────────────────────────────────────────────────────

function entryPayload() {
  return {
    childNames: childPicker.selectedNames(),
    happenedOn: els.happenedOn.value,
    title: els.title.value.trim(),
    category: els.category.value,
    mood: els.mood.value,
    content: els.content.value.trim(),
    photo: editorTools.getPhoto(),
    ageNote: els.ageNote.value.trim(),
    tags: els.tags.value,
    isFavorite: els.isFavorite.checked,
    isPublic: els.isPublic.checked,
  };
}

function resetForm() {
  els.entryId.value = '';
  els.happenedOn.value = '';
  els.title.value = '';
  els.category.value = '';
  els.mood.value = '';
  els.content.value = '';
  editorTools.setPhoto('');
  childPicker.reset();
  els.tags.value = '';
  els.isFavorite.checked = false;
  els.isPublic.checked = false;
  els.editorTitle.textContent = t('editor_title_add');
  els.editorKicker.textContent = t('editor_kicker_new');
  els.deleteBtn.style.display = 'none';
  els.formError.textContent = '';
  setEditorAdvancedOpen(false);
}

function fillForm(entry) {
  els.entryId.value = String(entry.id);
  const childNames = entry.childNames?.length ? entry.childNames : [entry.childName].filter(Boolean);
  childPicker.setSelectedNames(childNames);
  els.happenedOn.value = entry.happenedOn || '';
  els.title.value = entry.title || '';
  els.category.value = entry.category || '';
  els.mood.value = entry.mood || '';
  els.content.value = entry.content || [entry.quote, entry.story].filter(Boolean).join('\n\n');
  editorTools.setPhoto(entry.photo || '');
  childPicker.setAgeNote(entry.ageNote || '');
  els.tags.value = (entry.tags || []).join(', ');
  els.isFavorite.checked = Boolean(entry.isFavorite);
  els.isPublic.checked = Boolean(entry.isPublic);
  els.editorTitle.textContent = t('editor_title_edit');
  els.editorKicker.textContent = [entry.childName, formatDate(entry.happenedOn)]
    .filter(Boolean)
    .join(' \u2022 ');
  els.deleteBtn.style.display = 'inline-flex';
  els.formError.textContent = '';
  setEditorAdvancedOpen(hasAdvancedEntryData(entry));
  openEditor();
}

// ── SSE ──────────────────────────────────────────────────────

function closeEvents() {
  if (!eventSource) return;
  eventSource.close();
  eventSource = null;
}

function openEvents() {
  closeEvents();
  const token = getToken();
  const url = token ? `/api/events?token=${encodeURIComponent(token)}` : '/api/events';
  eventSource = new EventSource(url);
  eventSource.onmessage = event => {
    const payload = JSON.parse(event.data);
    if (payload.sessionExpired) {
      handleSessionExpired();
      return;
    }
    if (payload.publicFeed) feedController.setPublicFeed(payload.publicFeed);
    if (payload.entries || payload.summary || payload.attention || payload.viewer) {
      feedController.render(payload);
      return;
    }
    feedController.renderPublicFeed();
  };
  eventSource.onerror = () => {};
}

// ── Confirm dialog ───────────────────────────────────────────

function askConfirm({ title, message, okLabel = 'Потвърди' }) {
  els.confirmTitle.textContent = title;
  els.confirmMessage.textContent = message;
  els.confirmOk.textContent = okLabel;
  els.confirmOverlay.classList.add('active');
  return new Promise(resolve => { confirmResolver = resolve; });
}

function closeConfirm(result) {
  els.confirmOverlay.classList.remove('active');
  if (confirmResolver) { confirmResolver(result); confirmResolver = null; }
}

// ── Auth flow ─────────────────────────────────────────────────

async function hydrateApp() {
  const me = await apiFetch('/api/me');
  viewer = { username: me.username, displayName: me.displayName || null };
  profileController.setInitialProfile(me);
  setAuthState(true);
  showAuthModal(false);
  feedController.render(await apiFetch('/api/state'));
  openEvents();
}

async function handleAuth(endpoint) {
  els.authError.textContent = '';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: els.authUsername.value.trim(), password: els.authPassword.value }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Заявката е неуспешна.');
    setToken(data.token);
    await hydrateApp();
  } catch (error) {
    els.authError.textContent = error.message;
  }
}

async function logout() {
  closeEvents();
  try { await apiFetch('/api/logout', { method: 'POST' }); } catch {}
  await becomeGuest();
}

async function handleSessionExpired() {
  if (handlingSessionExpiry) return;
  handlingSessionExpiry = true;
  try {
    await becomeGuest();
    showAuthModal(true);
    els.authError.textContent = t('auth_session_expired');
  } finally {
    handlingSessionExpiry = false;
  }
}

async function becomeGuest() {
  closeEvents();
  clearToken();
  viewer = null;
  feedController.clearState();
  kidsController.render([]);
  profileController.clear();
  closeEditor();
  resetForm();
  setAuthState(false);
  showAuthModal(false);
  await feedController.loadPublicFeed();
  openEvents();
}

// ── CRUD ─────────────────────────────────────────────────────

async function saveEntry() {
  els.formError.textContent = '';
  const id = els.entryId.value;
  try {
    const result = await apiFetch(id ? `/api/howlers/${id}` : '/api/howlers', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(entryPayload()),
    });
    feedController.render(result.state || await apiFetch('/api/state'));
    resetForm();
    closeEditor();
  } catch (error) {
    els.formError.textContent = error.message;
  }
}

async function deleteEntry() {
  const id = els.entryId.value;
  if (!id) return;
  const confirmed = await askConfirm({
    title: t('confirm_delete_title'),
    message: t('confirm_delete_message'),
    okLabel: t('confirm_delete_ok'),
  });
  if (!confirmed) return;
  els.formError.textContent = '';
  try {
    const result = await apiFetch(`/api/howlers/${id}`, { method: 'DELETE' });
    feedController.render(result.state || await apiFetch('/api/state'));
    resetForm();
    closeEditor();
  } catch (error) {
    els.formError.textContent = error.message;
  }
}

// ── Boot ─────────────────────────────────────────────────────

async function boot() {
  await initI18n();
  editorTools.initializeControls();
  if (!getToken()) {
    setAuthState(false);
    await feedController.loadPublicFeed();
    openEvents();
    return;
  }
  try {
    await hydrateApp();
  } catch {
    clearToken();
    setAuthState(false);
    await feedController.loadPublicFeed();
    openEvents();
  }
}

// ── Event listeners ───────────────────────────────────────────

els.navLoginBtn.addEventListener('click', () => showAuthModal(true));
els.guestLoginBtn.addEventListener('click', () => showAuthModal(true));
els.navLogoutBtn.addEventListener('click', logout);
els.navAddBtn.addEventListener('click', () => { resetForm(); openEditor(); });
els.closeAuthBtn.addEventListener('click', () => showAuthModal(false));
els.loginBtn.addEventListener('click', () => handleAuth('/api/login'));
els.registerBtn.addEventListener('click', () => handleAuth('/api/register'));

els.closeEditorBtn.addEventListener('click', closeEditor);
els.editorAdvancedToggle.addEventListener('click', () => setEditorAdvancedOpen(!editorAdvancedOpen));
els.saveBtn.addEventListener('click', saveEntry);
els.resetBtn.addEventListener('click', resetForm);
els.deleteBtn.addEventListener('click', deleteEntry);

els.searchInput.addEventListener('input', () => feedController.scheduleRender());

els.feedList.addEventListener('click', event => {
  const button = event.target.closest('[data-edit-id]');
  const state = feedController.currentState();
  if (!button || !state) return;
  const entry = (state.entries || []).find(item => item.id === Number(button.dataset.editId));
  if (entry) fillForm(entry);
});

els.confirmCancel.addEventListener('click', () => closeConfirm(false));
els.confirmOk.addEventListener('click', () => closeConfirm(true));
bindBackdropDismiss(els.confirmOverlay, () => closeConfirm(false));
bindBackdropDismiss(els.editorOverlay, closeEditor);
bindBackdropDismiss(els.profileModal, profileController.close);
bindBackdropDismiss(els.authModal, () => showAuthModal(false));

kidsController.bindEvents();

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (els.confirmOverlay.classList.contains('active')) closeConfirm(false);
    else if (isEditorOpen()) closeEditor();
    else if (els.profileModal.style.display !== 'none') profileController.close();
    else if (els.authModal.style.display !== 'none') showAuthModal(false);
  }
});

resetForm();
boot();
