import { t } from '../i18n.js';
import { apiFetch, getToken } from './api.js';
import { escapeHtml } from './format.js';

export function createProfileController(elements, { getViewer, setViewer, onFamilyAccepted }) {
  let currentProfile = null;

  function updateNavAvatar(displayName, username, avatar) {
    const label = displayName || username || '';
    elements.navViewerName.textContent = label;
    if (avatar) {
      elements.navAvatarImg.src = avatar;
      elements.navAvatarImg.style.display = '';
      elements.navAvatarInitials.style.display = 'none';
    } else {
      elements.navAvatarImg.style.display = 'none';
      elements.navAvatarInitials.style.display = '';
      elements.navAvatarInitials.textContent = (label.charAt(0) || '?').toUpperCase();
    }
  }

  function setProfileAvatar(avatar, username, displayName) {
    const name = displayName || username || '';
    if (avatar) {
      elements.profileAvatarPreview.src = avatar;
      elements.profileAvatarPreview.style.display = '';
      elements.profileAvatarInitials.style.display = 'none';
      elements.removeAvatarBtn.style.display = '';
    } else {
      elements.profileAvatarPreview.style.display = 'none';
      elements.profileAvatarInitials.style.display = '';
      elements.profileAvatarInitials.textContent = (name.charAt(0) || '?').toUpperCase();
      elements.removeAvatarBtn.style.display = 'none';
    }
  }

  function formatPersonLabel(person) {
    if (!person) return '';
    return person.displayName ? `${person.displayName} (@${person.username})` : `@${person.username}`;
  }

  function renderInviteAttention(attention) {
    const count = Number(attention?.pendingInviteCount || 0);
    const hasAttention = count > 0;
    elements.navViewer.classList.toggle('has-attention', hasAttention);
    elements.navAttentionBadge.style.display = hasAttention ? '' : 'none';
    elements.inviteAlert.style.display = hasAttention ? '' : 'none';

    if (!hasAttention) {
      elements.navViewer.setAttribute('aria-label', t('nav_profile_label'));
      return;
    }

    elements.navAttentionBadge.textContent = count > 9 ? '9+' : String(count);
    elements.navViewer.setAttribute(
      'aria-label',
      count === 1
        ? t('nav_profile_label_with_invites_one')
        : t('nav_profile_label_with_invites_many', { count })
    );
    const firstSender = attention?.pendingInviteSenders?.[0];
    elements.inviteAlertTitle.textContent = count === 1
      ? t('invite_alert_title_single')
      : t('invite_alert_title_many', { count });
    elements.inviteAlertSubtitle.textContent = count === 1 && firstSender
      ? t('invite_alert_sub_single', { name: formatPersonLabel(firstSender) })
      : t('invite_alert_sub_many', { count });
  }

  function renderRows(target, items, emptyKey, rowBuilder) {
    target.innerHTML = items.length
      ? items.map(rowBuilder).join('')
      : `<p class="profile-empty">${escapeHtml(t(emptyKey))}</p>`;
  }

  function renderDetails(profile) {
    currentProfile = { ...currentProfile, ...profile };
    const viewer = { ...getViewer(), username: currentProfile.username, displayName: currentProfile.displayName };
    setViewer(viewer);
    updateNavAvatar(currentProfile.displayName, currentProfile.username, currentProfile.avatar);
    elements.profileUsernameRo.value = currentProfile.username;
    elements.profileDisplayName.value = currentProfile.displayName || '';
    setProfileAvatar(currentProfile.avatar || null, currentProfile.username, currentProfile.displayName);

    const incomingInvites = currentProfile.incomingInvites || [];
    elements.profileAttentionSection.style.display = incomingInvites.length ? '' : 'none';
    elements.profileAttentionDivider.style.display = incomingInvites.length ? '' : 'none';
    renderRows(elements.profileFamilyList, currentProfile.familyMembers || [], 'profile_family_empty', member => `
      <div class="profile-person-row">
        <div class="profile-person-meta">
          <div class="profile-person-title">
            <span>${escapeHtml(formatPersonLabel(member))}</span>
            ${member.id === currentProfile.id ? `<span class="profile-pill">${escapeHtml(t('profile_you_badge'))}</span>` : ''}
          </div>
          <div class="profile-person-sub">${escapeHtml(t('profile_family_member_sub'))}</div>
        </div>
      </div>
    `);
    renderRows(elements.profileIncomingInvites, incomingInvites, 'profile_incoming_empty', invite => `
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
    renderRows(elements.profileOutgoingInvites, currentProfile.outgoingInvites || [], 'profile_outgoing_empty', invite => `
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

  async function loadDetails() {
    const profile = await apiFetch('/api/profile');
    renderDetails(profile);
    return profile;
  }

  async function open() {
    const viewer = getViewer();
    if (!viewer) return;
    elements.profileUsernameRo.value = viewer.username;
    elements.profileDisplayName.value = currentProfile?.displayName || '';
    setProfileAvatar(currentProfile?.avatar || null, viewer.username, currentProfile?.displayName);
    for (const error of [elements.profileIdentityError, elements.profileInviteError, elements.profilePwError]) {
      error.textContent = '';
      error.className = 'inline-error';
    }
    elements.profileInviteUsername.value = '';
    elements.profileCurrentPw.value = '';
    elements.profileNewPw.value = '';
    elements.profileConfirmPw.value = '';
    elements.profileAttentionSection.style.display = 'none';
    elements.profileAttentionDivider.style.display = 'none';
    elements.profileModal.style.display = 'flex';
    elements.profileCard.scrollTop = 0;
    try {
      await loadDetails();
    } catch (error) {
      elements.profileInviteError.textContent = error.message;
    }
  }

  function close() {
    elements.profileModal.style.display = 'none';
  }

  async function saveIdentity() {
    elements.profileIdentityError.textContent = '';
    elements.profileIdentityError.className = 'inline-error';
    try {
      const response = await apiFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: elements.profileDisplayName.value }),
      });
      if (response.ok) {
        renderDetails(response.profile || { displayName: response.displayName });
        elements.profileIdentityError.textContent = t('profile_saved');
        elements.profileIdentityError.className = 'inline-error profile-success';
      }
    } catch (error) {
      elements.profileIdentityError.textContent = error.message;
    }
  }

  async function savePassword() {
    elements.profilePwError.textContent = '';
    elements.profilePwError.className = 'inline-error';
    const currentPassword = elements.profileCurrentPw.value;
    const newPassword = elements.profileNewPw.value;
    if (newPassword.length < 6) {
      elements.profilePwError.textContent = t('profile_error_password_too_short');
      return;
    }
    if (newPassword !== elements.profileConfirmPw.value) {
      elements.profilePwError.textContent = t('profile_error_passwords_mismatch');
      return;
    }
    try {
      await apiFetch('/api/profile/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      elements.profileCurrentPw.value = '';
      elements.profileNewPw.value = '';
      elements.profileConfirmPw.value = '';
      elements.profilePwError.textContent = t('profile_saved');
      elements.profilePwError.className = 'inline-error profile-success';
    } catch (error) {
      elements.profilePwError.textContent = error.message;
    }
  }

  async function saveAvatar(avatar) {
    try {
      const response = await apiFetch('/api/profile/avatar', {
        method: 'POST',
        body: JSON.stringify({ avatar }),
      });
      currentProfile = { ...currentProfile, avatar: response.avatar };
      const viewer = getViewer();
      updateNavAvatar(viewer?.displayName, viewer?.username, response.avatar);
      setProfileAvatar(response.avatar, viewer?.username, viewer?.displayName);
    } catch (error) {
      console.error('Avatar save failed:', error.message);
    }
  }

  async function sendInvite() {
    elements.profileInviteError.textContent = '';
    elements.profileInviteError.className = 'inline-error';
    const username = elements.profileInviteUsername.value.trim();
    if (!username) {
      elements.profileInviteError.textContent = t('profile_invite_username_required');
      return;
    }
    try {
      await apiFetch('/api/family/invites', { method: 'POST', body: JSON.stringify({ username }) });
      elements.profileInviteUsername.value = '';
      await loadDetails();
      elements.profileInviteError.textContent = t('profile_invite_sent');
      elements.profileInviteError.className = 'inline-error profile-success';
    } catch (error) {
      elements.profileInviteError.textContent = error.message;
    }
  }

  async function acceptInvite(inviteId) {
    elements.profileInviteError.textContent = '';
    elements.profileInviteError.className = 'inline-error';
    try {
      await apiFetch(`/api/family/invites/${inviteId}/accept`, { method: 'POST' });
      await onFamilyAccepted();
      elements.profileModal.style.display = 'flex';
      await loadDetails();
      elements.profileInviteError.textContent = t('profile_invite_accepted');
      elements.profileInviteError.className = 'inline-error profile-success';
    } catch (error) {
      elements.profileInviteError.textContent = error.message;
    }
  }

  async function cancelInvite(inviteId) {
    elements.profileInviteError.textContent = '';
    elements.profileInviteError.className = 'inline-error';
    try {
      await apiFetch(`/api/family/invites/${inviteId}`, { method: 'DELETE' });
      await loadDetails();
      elements.profileInviteError.textContent = t('profile_invite_removed');
      elements.profileInviteError.className = 'inline-error profile-success';
    } catch (error) {
      elements.profileInviteError.textContent = error.message;
    }
  }

  function setInitialProfile(profile) {
    currentProfile = profile || null;
    if (profile) updateNavAvatar(profile.displayName, profile.username, profile.avatar);
  }

  function syncState({ profile, viewer, attention }) {
    if (profile) currentProfile = { ...currentProfile, ...profile };
    if (viewer) updateNavAvatar(viewer.displayName, viewer.username, viewer.avatar || currentProfile?.avatar);
    renderInviteAttention(attention);
    if (elements.profileModal.style.display !== 'none' && profile) renderDetails(profile);
  }

  function clear() {
    currentProfile = null;
    renderInviteAttention(null);
    close();
  }

  elements.navViewer.addEventListener('click', open);
  elements.inviteAlert.addEventListener('click', open);
  elements.closeProfileBtn.addEventListener('click', close);
  elements.saveIdentityBtn.addEventListener('click', saveIdentity);
  elements.savePasswordBtn.addEventListener('click', savePassword);
  elements.profileSendInviteBtn.addEventListener('click', sendInvite);
  elements.exportTxtBtn.addEventListener('click', () => {
    window.location.href = `/api/export?format=txt&token=${encodeURIComponent(getToken())}`;
  });
  elements.exportPdfBtn.addEventListener('click', () => {
    window.open(`/api/export?format=pdf&token=${encodeURIComponent(getToken())}`, '_blank');
  });
  elements.avatarFileInput.addEventListener('change', event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 300 * 1024) {
      elements.profileIdentityError.textContent = t('profile_error_avatar_too_large');
      return;
    }
    const reader = new FileReader();
    reader.onload = async loadEvent => {
      const viewer = getViewer();
      setProfileAvatar(loadEvent.target.result, viewer?.username, viewer?.displayName);
      elements.removeAvatarBtn.style.display = '';
      await saveAvatar(loadEvent.target.result);
    };
    reader.readAsDataURL(file);
  });
  elements.removeAvatarBtn.addEventListener('click', async () => {
    const viewer = getViewer();
    setProfileAvatar(null, viewer?.username, viewer?.displayName);
    await saveAvatar(null);
  });
  elements.profileIncomingInvites.addEventListener('click', event => {
    const acceptButton = event.target.closest('[data-accept-invite-id]');
    if (acceptButton) { acceptInvite(Number(acceptButton.dataset.acceptInviteId)); return; }
    const cancelButton = event.target.closest('[data-cancel-invite-id]');
    if (cancelButton) cancelInvite(Number(cancelButton.dataset.cancelInviteId));
  });
  elements.profileOutgoingInvites.addEventListener('click', event => {
    const cancelButton = event.target.closest('[data-cancel-invite-id]');
    if (cancelButton) cancelInvite(Number(cancelButton.dataset.cancelInviteId));
  });

  return {
    clear,
    close,
    open,
    setInitialProfile,
    syncState,
  };
}
