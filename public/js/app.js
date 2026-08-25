import { initI18n, t } from './i18n.js';
import {
  CATEGORY_SLUGS,
  EMOTICON_SLUGS,
  EMOTICON_TOKEN_RE,
  MAX_POST_PHOTO_BYTES,
  MAX_POST_PHOTO_DIMENSION,
  MOOD_SLUGS,
  TEXT_FORMATS,
} from './app/constants.js';
import { apiFetch, clearToken, getToken, setToken } from './app/api.js';
import { bindBackdropDismiss, getAppElements } from './app/dom.js';
import { createFeedLoader } from './app/feed-loading.js';
import { dataUrlBytes, escapeHtml, formatDate } from './app/format.js';

const els = getAppElements();
const feedLoader = createFeedLoader(els.feedList);

let viewer = null;
let currentProfile = null;
let eventSource = null;
let latestState = null;
let latestFeed = null;
let confirmResolver = null;
let latestKids = [];
let editorAdvancedOpen = false;
let feedRenderTimer = null;
let postPhotoData = '';
let activeTextFormatFieldId = '';
let handlingSessionExpiry = false;
const textFormatSelections = new Map();

// ── Kids ─────────────────────────────────────────────────────

function calcAge(dob) {
  return calcAgeAtDate(dob);
}

function calcAgeAtDate(dob, referenceDate = '') {
  if (!dob) return '';
  const birth = new Date(`${dob}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return '';

  const reference = referenceDate
    ? new Date(`${referenceDate}T12:00:00`)
    : new Date();
  if (Number.isNaN(reference.getTime()) || reference < birth) return '';

  let years = reference.getFullYear() - birth.getFullYear();
  let months = reference.getMonth() - birth.getMonth();
  if (reference.getDate() < birth.getDate()) months -= 1;
  if (months < 0) { years -= 1; months += 12; }
  if (years < 0) return '';
  if (years > 0) return months > 0 ? `${years} г. ${months} мес.` : `${years} г.`;
  return months > 0 ? `${months} мес.` : t('age_under_one_month');
}

function normalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase('bg-BG');
}

function findKidByName(name) {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  return latestKids.find(kid => normalizeName(kid.name) === normalized) || null;
}

function findKidById(id) {
  return latestKids.find(kid => String(kid.id) === String(id)) || null;
}

function syncChildSelectFromName() {
  const kid = findKidByName(els.childName.value);
  els.childSelect.value = kid ? String(kid.id) : '';
  return kid;
}

function showChildAgePreview(ageNote) {
  if (!ageNote) {
    els.childAgePreview.hidden = true;
    els.childAgePreview.textContent = '';
    return;
  }
  els.childAgePreview.hidden = false;
  els.childAgePreview.textContent = t('child_age_preview', { age: ageNote });
}

function clearAutoAgeNote() {
  if (els.ageNote.dataset.autoAge === 'true') {
    els.ageNote.value = '';
  }
  delete els.ageNote.dataset.autoAge;
  delete els.ageNote.dataset.autoKidId;
  showChildAgePreview('');
}

function applyAgeFromSelectedKid({ force = false } = {}) {
  const kid = syncChildSelectFromName();
  if (!kid || !kid.dob) {
    clearAutoAgeNote();
    return;
  }

  const ageNote = calcAgeAtDate(kid.dob, els.happenedOn.value);
  showChildAgePreview(ageNote);
  if (!ageNote) {
    if (els.ageNote.dataset.autoAge === 'true') els.ageNote.value = '';
    delete els.ageNote.dataset.autoAge;
    delete els.ageNote.dataset.autoKidId;
    return;
  }

  if (force || !els.ageNote.value.trim() || els.ageNote.dataset.autoAge === 'true') {
    els.ageNote.value = ageNote;
    els.ageNote.dataset.autoAge = 'true';
    els.ageNote.dataset.autoKidId = String(kid.id);
  }
}

function updateChildSelect(kids) {
  const options = [
    `<option value="">${escapeHtml(t('child_select_placeholder'))}</option>`,
    ...kids.map(kid => `<option value="${kid.id}">${escapeHtml(kid.name)}</option>`),
  ];
  els.childSelect.innerHTML = options.join('');
  syncChildSelectFromName();
  applyAgeFromSelectedKid();
}

function renderKidsPanel(kids) {
  latestKids = kids || [];
  updateChildSelect(latestKids);
  if (!latestKids.length) {
    els.kidsPanelList.innerHTML = `<p class="kid-panel-empty">${escapeHtml(t('panel_kids_empty'))}</p>`;
    return;
  }
  els.kidsPanelList.innerHTML = latestKids.map(kid => {
    const age = calcAge(kid.dob);
    const dobLabel = kid.dob ? ` \u2022 ${kid.dob}${age ? ` (${age})` : ''}` : '';
    return `<div class="kid-row">
      <span class="kid-name">${escapeHtml(kid.name)}</span>
      <span class="kid-dob">${escapeHtml(dobLabel)}</span>
      <button class="kid-delete-btn" data-kid-id="${kid.id}" aria-label="Премахни">\u2715</button>
    </div>`;
  }).join('');
}

async function submitAddKid(e) {
  e.preventDefault();
  els.kidAddError.textContent = '';
  const name = els.kidNameInput.value.trim();
  if (!name) { els.kidAddError.textContent = t('kids_error_name_required'); return; }
  try {
    await apiFetch('/api/kids', {
      method: 'POST',
      body: JSON.stringify({ name, dob: els.kidDobInput.value || '' }),
    });
    els.kidNameInput.value = '';
    els.kidDobInput.value = '';
  } catch (err) {
    els.kidAddError.textContent = err.message;
  }
}

async function handleDeleteKidClick(id) {
  const kid = latestKids.find(k => k.id === id);
  const confirmed = await askConfirm({
    title: t('confirm_delete_kid_title'),
    message: t('confirm_delete_kid_message'),
    okLabel: t('confirm_delete_ok'),
  });
  if (!confirmed) return;
  try {
    await apiFetch(`/api/kids/${id}`, { method: 'DELETE' });
  } catch (err) {
    console.error('Delete kid failed:', err.message);
  }
}

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
    els.inviteAlert.style.display = 'none';
    els.navAttentionBadge.style.display = 'none';
    els.navViewer.classList.remove('has-attention');
    els.navViewer.setAttribute('aria-label', t('nav_profile_label'));
  }
}
function showAuthModal(show) {
  els.authModal.style.display = show ? 'flex' : 'none';
}

// ── Profile modal ────────────────────────────────────────────

function updateNavAvatar(displayName, username, avatar) {
  const label = displayName || username || '';
  els.navViewerName.textContent = label;
  if (avatar) {
    els.navAvatarImg.src = avatar;
    els.navAvatarImg.style.display = '';
    els.navAvatarInitials.style.display = 'none';
  } else {
    els.navAvatarImg.style.display = 'none';
    els.navAvatarInitials.style.display = '';
    els.navAvatarInitials.textContent = (label.charAt(0) || '?').toUpperCase();
  }
}

function setProfileAvatar(avatar, username, displayName) {
  const name = displayName || username || '';
  if (avatar) {
    els.profileAvatarPreview.src = avatar;
    els.profileAvatarPreview.style.display = '';
    els.profileAvatarInitials.style.display = 'none';
    els.removeAvatarBtn.style.display = '';
  } else {
    els.profileAvatarPreview.style.display = 'none';
    els.profileAvatarInitials.style.display = '';
    els.profileAvatarInitials.textContent = (name.charAt(0) || '?').toUpperCase();
    els.removeAvatarBtn.style.display = 'none';
  }
}

function formatPersonLabel(person) {
  if (!person) return '';
  return person.displayName ? `${person.displayName} (@${person.username})` : `@${person.username}`;
}

function renderInviteAttention(attention) {
  const count = Number(attention?.pendingInviteCount || 0);
  const hasAttention = count > 0;
  els.navViewer.classList.toggle('has-attention', hasAttention);
  els.navAttentionBadge.style.display = hasAttention ? '' : 'none';
  els.inviteAlert.style.display = hasAttention ? '' : 'none';

  if (!hasAttention) {
    els.navViewer.setAttribute('aria-label', t('nav_profile_label'));
    return;
  }

  els.navAttentionBadge.textContent = count > 9 ? '9+' : String(count);
  els.navViewer.setAttribute(
    'aria-label',
    count === 1
      ? t('nav_profile_label_with_invites_one')
      : t('nav_profile_label_with_invites_many', { count })
  );

  const firstSender = attention?.pendingInviteSenders?.[0];
  els.inviteAlertTitle.textContent = count === 1
    ? t('invite_alert_title_single')
    : t('invite_alert_title_many', { count });
  els.inviteAlertSubtitle.textContent = count === 1 && firstSender
    ? t('invite_alert_sub_single', { name: formatPersonLabel(firstSender) })
    : t('invite_alert_sub_many', { count });
}

function renderProfileRows(target, items, emptyKey, rowBuilder) {
  if (!items.length) {
    target.innerHTML = `<p class="profile-empty">${escapeHtml(t(emptyKey))}</p>`;
    return;
  }
  target.innerHTML = items.map(rowBuilder).join('');
}

function renderProfileDetails(profile) {
  currentProfile = { ...currentProfile, ...profile };
  const mergedProfile = currentProfile;
  viewer = {
    ...viewer,
    username: mergedProfile.username,
    displayName: mergedProfile.displayName,
  };
  updateNavAvatar(mergedProfile.displayName, mergedProfile.username, mergedProfile.avatar);
  els.profileUsernameRo.value = mergedProfile.username;
  els.profileDisplayName.value = mergedProfile.displayName || '';
  setProfileAvatar(
    mergedProfile.avatar || null,
    mergedProfile.username,
    mergedProfile.displayName
  );

  const incomingInvites = mergedProfile.incomingInvites || [];
  const hasIncomingInvites = incomingInvites.length > 0;
  els.profileAttentionSection.style.display = hasIncomingInvites ? '' : 'none';
  els.profileAttentionDivider.style.display = hasIncomingInvites ? '' : 'none';

  renderProfileRows(els.profileFamilyList, mergedProfile.familyMembers || [], 'profile_family_empty', member => `
    <div class="profile-person-row">
      <div class="profile-person-meta">
        <div class="profile-person-title">
          <span>${escapeHtml(formatPersonLabel(member))}</span>
          ${member.id === mergedProfile.id ? `<span class="profile-pill">${escapeHtml(t('profile_you_badge'))}</span>` : ''}
        </div>
        <div class="profile-person-sub">${escapeHtml(t('profile_family_member_sub'))}</div>
      </div>
    </div>
  `);

  renderProfileRows(els.profileIncomingInvites, incomingInvites, 'profile_incoming_empty', invite => `
    <div class="profile-person-row">
      <div class="profile-person-meta">
        <div class="profile-person-title">${escapeHtml(formatPersonLabel(invite.inviter))}</div>
        <div class="profile-person-sub">${escapeHtml(t('profile_invite_incoming_sub'))}</div>
      </div>
      <div class="profile-row-actions">
        <button class="primary-btn small-btn" type="button" data-accept-invite-id="${invite.id}">${escapeHtml(t('profile_accept_invite'))}</button>
        <button class="ghost-btn small-btn" type="button" data-cancel-invite-id="${invite.id}">${escapeHtml(t('profile_decline_invite'))}</button>
      </div>
    </div>
  `);

  renderProfileRows(els.profileOutgoingInvites, mergedProfile.outgoingInvites || [], 'profile_outgoing_empty', invite => `
    <div class="profile-person-row">
      <div class="profile-person-meta">
        <div class="profile-person-title">${escapeHtml(formatPersonLabel(invite.invitee))}</div>
        <div class="profile-person-sub">${escapeHtml(t('profile_invite_outgoing_sub'))}</div>
      </div>
      <div class="profile-row-actions">
        <button class="ghost-btn small-btn" type="button" data-cancel-invite-id="${invite.id}">${escapeHtml(t('profile_cancel_invite'))}</button>
      </div>
    </div>
  `);
}

async function loadProfileDetails() {
  const profile = await apiFetch('/api/profile');
  renderProfileDetails(profile);
  return profile;
}

async function openProfileModal() {
  if (!viewer) return;
  els.profileUsernameRo.value = viewer.username;
  els.profileDisplayName.value = currentProfile?.displayName || '';
  setProfileAvatar(currentProfile?.avatar || null, viewer.username, currentProfile?.displayName);
  els.profileIdentityError.textContent = '';
  els.profileIdentityError.className = 'inline-error';
  els.profileInviteError.textContent = '';
  els.profileInviteError.className = 'inline-error';
  els.profilePwError.textContent = '';
  els.profilePwError.className = 'inline-error';
  els.profileInviteUsername.value = '';
  els.profileCurrentPw.value = '';
  els.profileNewPw.value = '';
  els.profileConfirmPw.value = '';
  els.profileAttentionSection.style.display = 'none';
  els.profileAttentionDivider.style.display = 'none';
  els.profileModal.style.display = 'flex';
  els.profileCard.scrollTop = 0;
  try {
    await loadProfileDetails();
  } catch (error) {
    els.profileInviteError.textContent = error.message;
  }
}

function closeProfileModal() {
  els.profileModal.style.display = 'none';
}

async function saveIdentity() {
  els.profileIdentityError.textContent = '';
  els.profileIdentityError.className = 'inline-error';
  try {
    const res = await apiFetch('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ displayName: els.profileDisplayName.value }),
    });
    if (res.ok) {
      renderProfileDetails(res.profile || { displayName: res.displayName });
      els.profileIdentityError.textContent = t('profile_saved');
      els.profileIdentityError.className = 'inline-error profile-success';
    }
  } catch (e) {
    els.profileIdentityError.textContent = e.message;
  }
}

async function savePassword() {
  els.profilePwError.textContent = '';
  els.profilePwError.className = 'inline-error';
  const currentPw  = els.profileCurrentPw.value;
  const newPw      = els.profileNewPw.value;
  const confirmPw  = els.profileConfirmPw.value;
  if (newPw.length < 6) {
    els.profilePwError.textContent = t('profile_error_password_too_short');
    return;
  }
  if (newPw !== confirmPw) {
    els.profilePwError.textContent = t('profile_error_passwords_mismatch');
    return;
  }
  try {
    await apiFetch('/api/profile/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
    });
    els.profileCurrentPw.value = '';
    els.profileNewPw.value = '';
    els.profileConfirmPw.value = '';
    els.profilePwError.textContent = t('profile_saved');
    els.profilePwError.className = 'inline-error profile-success';
  } catch (e) {
    els.profilePwError.textContent = e.message;
  }
}

async function doAvatarUpload(avatar) {
  try {
    const res = await apiFetch('/api/profile/avatar', {
      method: 'POST',
      body: JSON.stringify({ avatar }),
    });
    currentProfile = { ...currentProfile, avatar: res.avatar };
    updateNavAvatar(viewer?.displayName, viewer?.username, res.avatar);
    setProfileAvatar(res.avatar, viewer?.username, viewer?.displayName);
  } catch (e) {
    console.error('Avatar save failed:', e.message);
  }
}

async function sendFamilyInvite() {
  els.profileInviteError.textContent = '';
  els.profileInviteError.className = 'inline-error';
  const username = els.profileInviteUsername.value.trim();
  if (!username) {
    els.profileInviteError.textContent = t('profile_invite_username_required');
    return;
  }
  try {
    await apiFetch('/api/family/invites', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    els.profileInviteUsername.value = '';
    await loadProfileDetails();
    els.profileInviteError.textContent = t('profile_invite_sent');
    els.profileInviteError.className = 'inline-error profile-success';
  } catch (error) {
    els.profileInviteError.textContent = error.message;
  }
}

async function acceptFamilyInvite(inviteId) {
  els.profileInviteError.textContent = '';
  els.profileInviteError.className = 'inline-error';
  try {
    await apiFetch(`/api/family/invites/${inviteId}/accept`, { method: 'POST' });
    await hydrateApp();
    els.profileModal.style.display = 'flex';
    await loadProfileDetails();
    els.profileInviteError.textContent = t('profile_invite_accepted');
    els.profileInviteError.className = 'inline-error profile-success';
  } catch (error) {
    els.profileInviteError.textContent = error.message;
  }
}

async function cancelFamilyInvite(inviteId) {
  els.profileInviteError.textContent = '';
  els.profileInviteError.className = 'inline-error';
  try {
    await apiFetch(`/api/family/invites/${inviteId}`, { method: 'DELETE' });
    await loadProfileDetails();
    els.profileInviteError.textContent = t('profile_invite_removed');
    els.profileInviteError.className = 'inline-error profile-success';
  } catch (error) {
    els.profileInviteError.textContent = error.message;
  }
}

// ── Tokens ──────────────────────────────────────────────────

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

// ── Dates & formatting ───────────────────────────────────────

function entryMetaLine(entry) {
  return [entry.childName, formatDate(entry.happenedOn), entry.ageNote]
    .filter(Boolean)
    .map(escapeHtml)
    .join(' \u2022 ');
}

function formatDateTimeFromUnix(value) {
  if (!value) return t('date_na');
  return new Date(Number(value) * 1000).toLocaleString('bg-BG');
}

// ── Category / mood helpers ──────────────────────────────────

function categoryLabel(cat) {
  if (!cat) return '';
  const key = 'category_' + cat;
  const v = t(key);
  return v !== key ? v : cat;
}

function moodLabel(mood) {
  if (!mood) return '';
  const key = 'mood_' + mood;
  const v = t(key);
  return v !== key ? v : mood;
}

function categoryClass(cat) {
  return CATEGORY_SLUGS.includes(cat) ? cat : 'custom';
}

function moodClass(mood) {
  return MOOD_SLUGS.includes(mood) ? 'mood-' + mood : 'mood-custom';
}

function emoticonLabel(slug) {
  const key = `emoticon_${slug}`;
  const value = t(key);
  return value !== key ? value : slug;
}

function emoticonSvg(slug, className = 'inline-emoticon') {
  if (!EMOTICON_SLUGS.includes(slug)) return '';
  return `<svg class="${className}" viewBox="0 0 64 64" role="img" aria-label="${escapeHtml(emoticonLabel(slug))}"><use href="/emoticons.svg#${slug}"></use></svg>`;
}

function renderInlineContent(value) {
  const text = String(value || '');
  let html = '';
  let lastIndex = 0;
  text.replace(EMOTICON_TOKEN_RE, (token, slug, offset) => {
    html += escapeHtml(text.slice(lastIndex, offset));
    html += emoticonSvg(slug);
    lastIndex = offset + token.length;
    return token;
  });
  html += escapeHtml(text.slice(lastIndex));
  return [
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
}

function populateTextFormatToolbars() {
  document.querySelectorAll('.text-format-toolbar').forEach(toolbar => {
    toolbar.innerHTML = Object.entries(TEXT_FORMATS).map(([format, config]) => {
      const label = t(config.labelKey);
      const title = `${label} (${config.shortcut})`;
      return `<button class="text-format-btn format-${format}" type="button" data-text-format="${format}" aria-label="${escapeHtml(title)}" data-tooltip="${escapeHtml(title)}">${config.glyph}</button>`;
    }).join('');
  });
}

function toggleTextFormat(target, format) {
  const config = TEXT_FORMATS[format];
  if (!target || !config) return;
  try {
    target.focus({ preventScroll: true });
  } catch (_error) {
    target.focus();
  }
  const opening = `[${config.tag}]`;
  const closing = `[/${config.tag}]`;
  const start = Number.isInteger(target.selectionStart) ? target.selectionStart : target.value.length;
  const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : start;
  const selected = target.value.slice(start, end);
  const wrapped = `${opening}${selected}${closing}`;
  target.setRangeText(wrapped, start, end, 'end');
  const selectionStart = start + opening.length;
  target.setSelectionRange(selectionStart, selectionStart + selected.length);
  target.dispatchEvent(new Event('input', { bubbles: true }));
  rememberTextFormatSelection(target);
  target.focus();
}

function rememberTextFormatSelection(target) {
  if (!target || !['title', 'content'].includes(target.id)) return;
  activeTextFormatFieldId = target.id;
  textFormatSelections.set(target.id, {
    start: Number.isInteger(target.selectionStart) ? target.selectionStart : target.value.length,
    end: Number.isInteger(target.selectionEnd) ? target.selectionEnd : target.value.length,
  });
}

function restoreTextFormatSelection(target, selection) {
  if (!target || !selection) return;
  try {
    target.focus({ preventScroll: true });
  } catch (_error) {
    target.focus();
  }
  const start = Math.max(0, Math.min(selection.start, target.value.length));
  const end = Math.max(start, Math.min(selection.end, target.value.length));
  target.setSelectionRange(start, end);
}

function getToolbarTextFormatTarget(toolbar) {
  const fallback = document.getElementById(toolbar.dataset.formatTarget);
  if (['title', 'content'].includes(document.activeElement?.id) && activeTextFormatFieldId) {
    const target = document.getElementById(activeTextFormatFieldId);
    const selection = textFormatSelections.get(activeTextFormatFieldId);
    if (target && selection && selection.start !== selection.end) {
      restoreTextFormatSelection(target, selection);
      return target;
    }
  }
  return fallback;
}

function handleTextFormatShortcut(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  const format = event.shiftKey && key === 'x'
    ? 'strike'
    : ({ b: 'bold', i: 'italic', u: 'underline' })[key];
  if (!format) return;
  event.preventDefault();
  rememberTextFormatSelection(event.currentTarget);
  toggleTextFormat(event.currentTarget, format);
}

function populateInlineEmoticonPickers() {
  document.querySelectorAll('.inline-emote-picker').forEach(picker => {
    picker.innerHTML = EMOTICON_SLUGS.map(slug => `
      <button
        class="inline-emote-btn"
        type="button"
        aria-label="${escapeHtml(emoticonLabel(slug))}"
        data-tooltip="${escapeHtml(emoticonLabel(slug))}"
        data-inline-emoticon="${slug}"
      >
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <use href="/emoticons.svg#${slug}"></use>
        </svg>
      </button>
    `).join('');
  });
}

function insertInlineEmoticon(target, slug) {
  if (!target || !EMOTICON_SLUGS.includes(slug)) return;
  const token = `:${slug}:`;
  const start = Number.isInteger(target.selectionStart) ? target.selectionStart : target.value.length;
  const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : start;
  target.setRangeText(token, start, end, 'end');
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.focus();
}

function setPostPhoto(photo) {
  postPhotoData = photo || '';
  els.postPhotoPreview.src = postPhotoData;
  els.postPhotoPreview.hidden = !postPhotoData;
  els.removePostPhotoBtn.hidden = !postPhotoData;
  els.postPhotoStatus.textContent = postPhotoData
    ? t('post_photo_ready', { size: Math.ceil(dataUrlBytes(postPhotoData) / 1024) })
    : t('post_photo_hint');
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t('post_photo_error_read')));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error(t('post_photo_error_invalid')));
      image.onload = () => resolve(image);
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function resizePostPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error(t('post_photo_error_invalid'));
  const image = await loadImageFile(file);
  const scale = Math.min(1, MAX_POST_PHOTO_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let quality = 0.9;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrlBytes(dataUrl) > MAX_POST_PHOTO_BYTES && quality > 0.35) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  let source = canvas;
  while (dataUrlBytes(dataUrl) > MAX_POST_PHOTO_BYTES && source.width > 320 && source.height > 320) {
    const shrink = Math.min(0.82, Math.sqrt(MAX_POST_PHOTO_BYTES / dataUrlBytes(dataUrl)) * 0.92);
    const smaller = document.createElement('canvas');
    smaller.width = Math.max(1, Math.round(source.width * shrink));
    smaller.height = Math.max(1, Math.round(source.height * shrink));
    smaller.getContext('2d').drawImage(source, 0, 0, smaller.width, smaller.height);
    dataUrl = smaller.toDataURL('image/jpeg', 0.72);
    source = smaller;
  }
  if (dataUrlBytes(dataUrl) > MAX_POST_PHOTO_BYTES) throw new Error(t('post_photo_error_too_large'));
  return dataUrl;
}

function populateFormSelectOptions() {
  els.category.innerHTML = [
    `<option value="">${escapeHtml(t('form_select_category_placeholder'))}</option>`,
    ...CATEGORY_SLUGS.map(slug => `<option value="${slug}">${escapeHtml(categoryLabel(slug))}</option>`),
  ].join('');
  els.mood.innerHTML = [
    `<option value="">${escapeHtml(t('form_select_mood_placeholder'))}</option>`,
    ...MOOD_SLUGS.map(slug => `<option value="${slug}">${escapeHtml(moodLabel(slug))}</option>`),
  ].join('');
}

// ── Filters ─────────────────────────────────────────────────

function getFilters() {
  return {
    query: els.searchInput.value.trim().toLowerCase(),
  };
}

function hasActiveFilters() {
  const { query } = getFilters();
  return Boolean(query);
}

function filterEntries(entries) {
  const { query } = getFilters();
  return entries.filter(entry => {
    if (!query) return true;
    return [entry.childName, entry.title, entry.content, entry.quote, entry.story, entry.ageNote, ...(entry.tags || [])]
      .join(' ').toLowerCase().includes(query);
  });
}

// ── Form ─────────────────────────────────────────────────────

function entryPayload() {
  return {
    childName: els.childName.value.trim(),
    happenedOn: els.happenedOn.value,
    title: els.title.value.trim(),
    category: els.category.value,
    mood: els.mood.value,
    content: els.content.value.trim(),
    photo: postPhotoData,
    ageNote: els.ageNote.value.trim(),
    tags: els.tags.value,
    isFavorite: els.isFavorite.checked,
    isPublic: els.isPublic.checked,
  };
}

function resetForm() {
  els.entryId.value = '';
  els.childName.value = '';
  els.happenedOn.value = '';
  els.title.value = '';
  els.category.value = '';
  els.mood.value = '';
  els.content.value = '';
  setPostPhoto('');
  els.ageNote.value = '';
  delete els.ageNote.dataset.autoAge;
  delete els.ageNote.dataset.autoKidId;
  els.tags.value = '';
  els.isFavorite.checked = false;
  els.isPublic.checked = false;
  els.childSelect.value = '';
  showChildAgePreview('');
  els.editorTitle.textContent = t('editor_title_add');
  els.editorKicker.textContent = t('editor_kicker_new');
  els.deleteBtn.style.display = 'none';
  els.formError.textContent = '';
  setEditorAdvancedOpen(false);
}

function fillForm(entry) {
  els.entryId.value = String(entry.id);
  els.childName.value = entry.childName || '';
  els.happenedOn.value = entry.happenedOn || '';
  els.title.value = entry.title || '';
  els.category.value = entry.category || '';
  els.mood.value = entry.mood || '';
  els.content.value = entry.content || [entry.quote, entry.story].filter(Boolean).join('\n\n');
  setPostPhoto(entry.photo || '');
  els.ageNote.value = entry.ageNote || '';
  if (entry.ageNote) {
    delete els.ageNote.dataset.autoAge;
    delete els.ageNote.dataset.autoKidId;
  }
  els.tags.value = (entry.tags || []).join(', ');
  els.isFavorite.checked = Boolean(entry.isFavorite);
  els.isPublic.checked = Boolean(entry.isPublic);
  els.editorTitle.textContent = t('editor_title_edit');
  els.editorKicker.textContent = [entry.childName, formatDate(entry.happenedOn)]
    .filter(Boolean)
    .join(' \u2022 ');
  els.deleteBtn.style.display = 'inline-flex';
  els.formError.textContent = '';
  syncChildSelectFromName();
  if (!entry.ageNote) applyAgeFromSelectedKid();
  else showChildAgePreview('');
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
    if (payload.publicFeed) latestFeed = Array.isArray(payload.publicFeed) ? payload.publicFeed : [];
    if (payload.entries || payload.summary || payload.attention || payload.viewer) {
      render(payload);
      return;
    }
    renderPublicFeed(latestFeed || []);
  };
  eventSource.onerror = () => {};
}

function scheduleFeedRender(delay = 120) {
  if (!latestState) return;
  if (feedRenderTimer) clearTimeout(feedRenderTimer);
  feedRenderTimer = setTimeout(() => {
    feedRenderTimer = null;
    render(latestState);
  }, delay);
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

// ── Entry card rendering ─────────────────────────────────────

function entryCard(entry) {
  return `
    <article class="list-item">
      <div class="list-item-head">
        <div>
          <a class="list-item-title public-entry-link" href="/posts/${entry.id}">${renderInlineContent(entry.title)}</a>
          <div class="meta-line">${entryMetaLine(entry)}</div>
        </div>
        ${entry.category ? `<span class="badge ${escapeHtml(categoryClass(entry.category))}">${escapeHtml(categoryLabel(entry.category))}</span>` : ''}
      </div>
      ${entry.content ? `<div class="entry-content">${renderInlineContent(entry.content)}</div>` : ''}
      ${entry.photo ? `<img class="entry-photo" src="${escapeHtml(entry.photo)}" alt="${escapeHtml(t('entry_photo_alt', { title: entry.title }))}">` : ''}
      <div class="entry-meta">
        ${entry.isFavorite ? `<span class="tag-chip favorite-chip">${escapeHtml(t('tag_favorite'))}</span>` : ''}
        ${(entry.tags || []).map(tag => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join('')}
      </div>
      <div class="entry-actions">
        <button class="secondary-link" data-edit-id="${entry.id}">${escapeHtml(t('entry_edit_btn'))}</button>
      </div>
    </article>
  `;
}

function feedCard(entry) {
  return `
    <article class="list-item">
      <div class="list-item-head">
        <div>
          <div class="list-item-title">${renderInlineContent(entry.title)}</div>
          <div class="meta-line">${entryMetaLine(entry)}</div>
        </div>
        ${entry.category ? `<span class="badge ${escapeHtml(categoryClass(entry.category))}">${escapeHtml(categoryLabel(entry.category))}</span>` : ''}
      </div>
      ${entry.content ? `<div class="entry-content">${renderInlineContent(entry.content)}</div>` : ''}
      ${entry.photo ? `<img class="entry-photo" src="${escapeHtml(entry.photo)}" alt="${escapeHtml(t('entry_photo_alt', { title: entry.title }))}">` : ''}
    </article>
  `;
}

// ── Render sidebar ───────────────────────────────────────────

function renderChips(target, items, labelBuilder) {
  if (!items.length) {
    target.innerHTML = `<span class="data-chip">${escapeHtml(t('no_data_chip'))}</span>`;
    return;
  }
  target.innerHTML = items.map(item => `<span class="data-chip">${escapeHtml(labelBuilder(item))}</span>`).join('');
}

// ── Render public feed (guest) ───────────────────────────────

function renderPublicFeed(entries) {
  latestFeed = entries;
  if (!entries.length) {
    els.feedList.innerHTML = `<div class="empty-state">${escapeHtml(t('feed_empty'))}</div>`;
    return;
  }
  els.feedList.innerHTML = entries.map(feedCard).join('');
}

async function fetchPublicFeedEntries() {
  try {
    const entries = await fetch('/api/feed').then(r => r.json());
    latestFeed = Array.isArray(entries) ? entries : [];
  } catch {
    latestFeed = [];
  }
  return latestFeed;
}

async function loadPublicFeed() {
  feedLoader.show(t('feed_loading'));
  renderPublicFeed(await fetchPublicFeedEntries());
}

// ── Render logged-in feed + sidebar ──────────────────────────

function render(state) {
  latestState = state;
  if (state.publicFeed) latestFeed = Array.isArray(state.publicFeed) ? state.publicFeed : [];
  if (state.profile) currentProfile = { ...currentProfile, ...state.profile };
  if (state.viewer) {
    viewer = { ...viewer, ...state.viewer };
    updateNavAvatar(state.viewer.displayName, state.viewer.username, state.viewer.avatar || currentProfile?.avatar);
  }
  renderInviteAttention(state.attention);
  if (els.profileModal.style.display !== 'none' && state.profile) renderProfileDetails(state.profile);

  // Sidebar stats
  els.heroMeta.textContent = state.summary.total
    ? t(state.summary.total === 1 ? 'hero_meta_with_data_one' : 'hero_meta_with_data_many', {
        total: state.summary.total,
        date: formatDateTimeFromUnix(state.summary.lastUpdatedAt),
      })
    : t('hero_meta_empty');
  els.summaryKicker.textContent = state.summary.total
    ? t('summary_kicker_with_data', {
        total: state.summary.total,
        stories: t(state.summary.total === 1 ? 'summary_story_one' : 'summary_story_many'),
        kids: state.summary.kids,
        children: t(state.summary.kids === 1 ? 'summary_kid_one' : 'summary_kid_many'),
      })
    : t('summary_kicker_empty');
  els.totalStat.textContent = String(state.summary.total || 0);
  els.totalSub.textContent = state.summary.total ? t('total_sub_with_data') : t('total_sub_empty');
  els.favoriteStat.textContent = String(state.summary.favorites || 0);
  els.favoriteSub.textContent = state.summary.favorites ? t('favorites_sub_with_data') : t('favorites_sub_empty');
  els.kidsStat.textContent = String(state.summary.kids || 0);
  els.kidsSub.textContent = state.summary.kidsBreakdown.length
    ? state.summary.kidsBreakdown.map(item => `${item.childName} ${item.total}`).join(' \u2022 ')
    : t('kids_sub_empty');
  renderChips(els.categoryStrip, state.summary.categories || [], item => `${categoryLabel(item.label)} ${item.total}`);
  renderChips(els.kidsStrip, state.summary.kidsBreakdown || [], item => `${item.childName} ${item.total}`);
  if (state.kids) renderKidsPanel(state.kids);

  const ownEntries = state.entries || [];
  const usePublicFallback = ownEntries.length === 0;
  const feedEntries = usePublicFallback ? latestFeed || [] : ownEntries;
  const filtered = filterEntries(feedEntries);
  const filtersActive = hasActiveFilters();

  if (usePublicFallback) {
    els.archiveKicker.textContent = '';
    els.feedList.innerHTML = filtered.length
      ? filtered.map(feedCard).join('')
      : `<div class="empty-state">${escapeHtml(t(filtersActive ? 'empty_no_filter_match' : 'feed_empty'))}</div>`;
    return;
  }

  const total = ownEntries.length;
  els.archiveKicker.textContent = filtered.length === total
    ? t(total === 1 ? 'archive_kicker_all_one' : 'archive_kicker_all_many', { total })
    : t('archive_kicker_filtered', { filtered: filtered.length, total });

  els.feedList.innerHTML = filtered.length
    ? filtered.map(entryCard).join('')
    : `<div class="empty-state">${escapeHtml(t('empty_no_filter_match'))}</div>`;
}

// ── Auth flow ─────────────────────────────────────────────────

async function hydrateApp() {
  const me = await apiFetch('/api/me');
  viewer = { username: me.username, displayName: me.displayName || null };
  currentProfile = me;
  populateFormSelectOptions();
  updateNavAvatar(me.displayName, me.username, me.avatar);
  setAuthState(true);
  showAuthModal(false);
  render(await apiFetch('/api/state'));
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
  currentProfile = null;
  latestState = null;
  latestKids = [];
  renderInviteAttention(null);
  closeEditor();
  closeProfileModal();
  resetForm();
  setAuthState(false);
  showAuthModal(false);
  await loadPublicFeed();
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
    render(result.state || await apiFetch('/api/state'));
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
    render(result.state || await apiFetch('/api/state'));
    resetForm();
    closeEditor();
  } catch (error) {
    els.formError.textContent = error.message;
  }
}

// ── Boot ─────────────────────────────────────────────────────

async function boot() {
  await initI18n();
  populateFormSelectOptions();
  populateTextFormatToolbars();
  populateInlineEmoticonPickers();
  if (!getToken()) {
    setAuthState(false);
    await loadPublicFeed();
    openEvents();
    return;
  }
  try {
    await hydrateApp();
  } catch {
    clearToken();
    setAuthState(false);
    await loadPublicFeed();
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

// Profile modal
els.navViewer.addEventListener('click', openProfileModal);
els.inviteAlert.addEventListener('click', openProfileModal);
els.closeProfileBtn.addEventListener('click', closeProfileModal);
els.saveIdentityBtn.addEventListener('click', saveIdentity);
els.profileSendInviteBtn.addEventListener('click', sendFamilyInvite);
els.savePasswordBtn.addEventListener('click', savePassword);
els.exportTxtBtn.addEventListener('click', () => {
  const token = getToken();
  window.location.href = `/api/export?format=txt&token=${encodeURIComponent(token)}`;
});
els.exportPdfBtn.addEventListener('click', () => {
  const token = getToken();
  window.open(`/api/export?format=pdf&token=${encodeURIComponent(token)}`, '_blank');
});
els.avatarFileInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 300 * 1024) {
    els.profileIdentityError.textContent = t('profile_error_avatar_too_large');
    return;
  }
  const reader = new FileReader();
  reader.onload = async ev => {
    setProfileAvatar(ev.target.result, viewer?.username, viewer?.displayName);
    els.removeAvatarBtn.style.display = '';
    await doAvatarUpload(ev.target.result);
  };
  reader.readAsDataURL(file);
});
els.removeAvatarBtn.addEventListener('click', async () => {
  setProfileAvatar(null, viewer?.username, viewer?.displayName);
  await doAvatarUpload(null);
});
els.profileIncomingInvites.addEventListener('click', event => {
  const acceptBtn = event.target.closest('[data-accept-invite-id]');
  if (acceptBtn) { acceptFamilyInvite(Number(acceptBtn.dataset.acceptInviteId)); return; }
  const cancelBtn = event.target.closest('[data-cancel-invite-id]');
  if (cancelBtn) cancelFamilyInvite(Number(cancelBtn.dataset.cancelInviteId));
});
els.profileOutgoingInvites.addEventListener('click', event => {
  const cancelBtn = event.target.closest('[data-cancel-invite-id]');
  if (cancelBtn) cancelFamilyInvite(Number(cancelBtn.dataset.cancelInviteId));
});

els.closeEditorBtn.addEventListener('click', closeEditor);
els.postPhotoInput.addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  els.postPhotoStatus.textContent = t('post_photo_processing');
  try {
    setPostPhoto(await resizePostPhoto(file));
  } catch (error) {
    els.postPhotoStatus.textContent = error.message;
  }
});
els.removePostPhotoBtn.addEventListener('click', () => setPostPhoto(''));
document.querySelectorAll('.text-format-toolbar').forEach(toolbar => {
  toolbar.addEventListener('pointerdown', event => {
    if (event.target.closest('[data-text-format]')) event.preventDefault();
  });
  toolbar.addEventListener('click', event => {
    const button = event.target.closest('[data-text-format]');
    if (!button) return;
    toggleTextFormat(getToolbarTextFormatTarget(toolbar), button.dataset.textFormat);
  });
});
['title', 'content'].forEach(id => {
  const field = document.getElementById(id);
  ['focus', 'select', 'input', 'keyup', 'mouseup'].forEach(type => {
    field.addEventListener(type, event => rememberTextFormatSelection(event.currentTarget));
  });
  field.addEventListener('keydown', handleTextFormatShortcut);
});
document.addEventListener('selectionchange', () => {
  if (['title', 'content'].includes(document.activeElement?.id)) {
    rememberTextFormatSelection(document.activeElement);
  }
});
document.querySelectorAll('.inline-emote-picker').forEach(picker => {
  picker.addEventListener('pointerdown', event => {
    if (event.target.closest('[data-inline-emoticon]')) event.preventDefault();
  });
  picker.addEventListener('click', event => {
    const button = event.target.closest('[data-inline-emoticon]');
    if (!button) return;
    insertInlineEmoticon(document.getElementById(picker.dataset.emoteTarget), button.dataset.inlineEmoticon);
  });
});
els.editorAdvancedToggle.addEventListener('click', () => setEditorAdvancedOpen(!editorAdvancedOpen));
els.childSelect.addEventListener('change', () => {
  const kid = findKidById(els.childSelect.value);
  if (!kid) return;
  els.childName.value = kid.name;
  applyAgeFromSelectedKid({ force: true });
});
els.childName.addEventListener('input', () => applyAgeFromSelectedKid());
els.happenedOn.addEventListener('change', () => applyAgeFromSelectedKid());
els.ageNote.addEventListener('input', () => {
  if (els.ageNote.value.trim()) {
    delete els.ageNote.dataset.autoAge;
    delete els.ageNote.dataset.autoKidId;
    showChildAgePreview('');
    return;
  }
  applyAgeFromSelectedKid();
});
els.saveBtn.addEventListener('click', saveEntry);
els.resetBtn.addEventListener('click', resetForm);
els.deleteBtn.addEventListener('click', deleteEntry);

els.searchInput.addEventListener('input', () => scheduleFeedRender());

els.feedList.addEventListener('click', event => {
  const button = event.target.closest('[data-edit-id]');
  if (!button || !latestState) return;
  const entry = (latestState.entries || []).find(item => item.id === Number(button.dataset.editId));
  if (entry) fillForm(entry);
});

els.confirmCancel.addEventListener('click', () => closeConfirm(false));
els.confirmOk.addEventListener('click', () => closeConfirm(true));
bindBackdropDismiss(els.confirmOverlay, () => closeConfirm(false));
bindBackdropDismiss(els.editorOverlay, closeEditor);
bindBackdropDismiss(els.profileModal, closeProfileModal);
bindBackdropDismiss(els.authModal, () => showAuthModal(false));

// Kids panel
els.kidAddForm.addEventListener('submit', submitAddKid);
els.kidsPanelList.addEventListener('click', event => {
  const btn = event.target.closest('[data-kid-id]');
  if (btn) handleDeleteKidClick(Number(btn.dataset.kidId));
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (els.confirmOverlay.classList.contains('active')) closeConfirm(false);
    else if (isEditorOpen()) closeEditor();
    else if (els.profileModal.style.display !== 'none') closeProfileModal();
    else if (els.authModal.style.display !== 'none') showAuthModal(false);
  }
});

resetForm();
boot();
