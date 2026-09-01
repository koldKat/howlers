import { t } from '../i18n.js';
import { apiFetch } from './api.js';
import { calculateAgeAtDate } from './child-picker.js';
import { escapeHtml, formatDate, parseDateInput } from './format.js';

export function createKidsController(els, { childPicker, askConfirm }) {
  let kids = [];

  function render(nextKids) {
    kids = nextKids || [];
    childPicker.updateKids(kids);
    if (!kids.length) {
      els.kidsPanelList.innerHTML = `<p class="kid-panel-empty">${escapeHtml(t('panel_kids_empty'))}</p>`;
      return;
    }
    els.kidsPanelList.innerHTML = kids.map(kid => {
      const age = calculateAgeAtDate(kid.dob);
      const dobLabel = kid.dob ? ` \u2022 ${formatDate(kid.dob)}${age ? ` (${age})` : ''}` : '';
      return `<div class="kid-row">
        <span class="kid-name">${escapeHtml(kid.name)}</span>
        <span class="kid-dob">${escapeHtml(dobLabel)}</span>
        <button class="kid-delete-btn" data-kid-id="${kid.id}" aria-label="Премахни">\u2715</button>
      </div>`;
    }).join('');
  }

  async function add(event) {
    event.preventDefault();
    els.kidAddError.textContent = '';
    const name = els.kidNameInput.value.trim();
    if (!name) {
      els.kidAddError.textContent = t('kids_error_name_required');
      return;
    }
    try {
      await apiFetch('/api/kids', {
        method: 'POST',
        body: JSON.stringify({ name, dob: parseDateInput(els.kidDobInput.value) }),
      });
      els.kidNameInput.value = '';
      els.kidDobInput.value = '';
    } catch (error) {
      els.kidAddError.textContent = error.message;
    }
  }

  async function remove(id) {
    const confirmed = await askConfirm({
      title: t('confirm_delete_kid_title'),
      message: t('confirm_delete_kid_message'),
      okLabel: t('confirm_delete_ok'),
    });
    if (!confirmed) return;
    try {
      await apiFetch(`/api/kids/${id}`, { method: 'DELETE' });
    } catch (error) {
      console.error('Delete kid failed:', error.message);
    }
  }

  function bindEvents() {
    els.kidAddForm.addEventListener('submit', add);
    els.kidsPanelList.addEventListener('click', event => {
      const button = event.target.closest('[data-kid-id]');
      if (button) remove(Number(button.dataset.kidId));
    });
  }

  return { bindEvents, render };
}
