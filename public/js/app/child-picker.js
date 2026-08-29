import { t } from '../i18n.js';
import { escapeHtml } from './format.js';

function normalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase('bg-BG');
}

export function calculateAgeAtDate(dob, referenceDate = '') {
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

export function createChildPicker({ container, customInput, ageNoteInput, agePreview, happenedOnInput }) {
  let kids = [];

  function customNames() {
    return customInput.value.split(',').map(name => name.trim()).filter(Boolean);
  }

  function selectedKnownKids() {
    const selectedIds = new Set(
      [...container.querySelectorAll('input[data-kid-id]:checked')]
        .map(input => input.dataset.kidId)
    );
    return kids.filter(kid => selectedIds.has(String(kid.id)));
  }

  function selectedNames() {
    const names = [...selectedKnownKids().map(kid => kid.name), ...customNames()];
    const seen = new Set();
    return names.filter(name => {
      const key = normalizeName(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function showAgePreview(ageNote) {
    agePreview.hidden = !ageNote;
    agePreview.textContent = ageNote ? t('child_age_preview', { age: ageNote }) : '';
  }

  function clearAutoAgeNote() {
    if (ageNoteInput.dataset.autoAge === 'true') ageNoteInput.value = '';
    delete ageNoteInput.dataset.autoAge;
    delete ageNoteInput.dataset.autoKidIds;
    showAgePreview('');
  }

  function applyAge({ force = false } = {}) {
    const selectedKids = selectedKnownKids();
    const selectedCount = selectedKids.length + customNames().length;
    const ages = selectedKids
      .map(kid => ({ kid, age: calculateAgeAtDate(kid.dob, happenedOnInput.value) }))
      .filter(item => item.age);
    if (!ages.length) {
      clearAutoAgeNote();
      return;
    }

    const ageNote = selectedCount > 1
      ? ages.map(({ kid, age }) => `${kid.name}: ${age}`).join('; ')
      : ages[0].age;
    showAgePreview(ageNote);
    if (force || !ageNoteInput.value.trim() || ageNoteInput.dataset.autoAge === 'true') {
      ageNoteInput.value = ageNote;
      ageNoteInput.dataset.autoAge = 'true';
      ageNoteInput.dataset.autoKidIds = ages.map(({ kid }) => kid.id).join(',');
    }
  }

  function updateKids(nextKids) {
    const selectedIds = new Set(
      [...container.querySelectorAll('input[data-kid-id]:checked')]
        .map(input => input.dataset.kidId)
    );
    kids = nextKids || [];
    container.innerHTML = kids.length
      ? kids.map(kid => `<label class="child-choice">
          <input type="checkbox" data-kid-id="${kid.id}"${selectedIds.has(String(kid.id)) ? ' checked' : ''}>
          <span>${escapeHtml(kid.name)}</span>
        </label>`).join('')
      : `<span class="child-picker-empty">${escapeHtml(t('child_select_placeholder'))}</span>`;
    applyAge();
  }

  function setSelectedNames(names) {
    const requested = new Set((names || []).map(normalizeName).filter(Boolean));
    const known = new Set();
    for (const input of container.querySelectorAll('input[data-kid-id]')) {
      const kid = kids.find(item => String(item.id) === input.dataset.kidId);
      const key = normalizeName(kid?.name);
      input.checked = requested.has(key);
      if (input.checked) known.add(key);
    }
    customInput.value = (names || [])
      .filter(name => !known.has(normalizeName(name)))
      .join(', ');
  }

  function setAgeNote(value) {
    ageNoteInput.value = value || '';
    delete ageNoteInput.dataset.autoAge;
    delete ageNoteInput.dataset.autoKidIds;
    showAgePreview('');
    if (!ageNoteInput.value) applyAge();
  }

  function reset() {
    customInput.value = '';
    for (const input of container.querySelectorAll('input[data-kid-id]')) input.checked = false;
    ageNoteInput.value = '';
    delete ageNoteInput.dataset.autoAge;
    delete ageNoteInput.dataset.autoKidIds;
    showAgePreview('');
  }

  container.addEventListener('change', () => applyAge({ force: true }));
  customInput.addEventListener('input', () => applyAge());
  happenedOnInput.addEventListener('change', () => applyAge());
  ageNoteInput.addEventListener('input', () => {
    if (ageNoteInput.value.trim()) {
      delete ageNoteInput.dataset.autoAge;
      delete ageNoteInput.dataset.autoKidIds;
      showAgePreview('');
      return;
    }
    applyAge();
  });

  return {
    applyAge,
    reset,
    selectedNames,
    setAgeNote,
    setSelectedNames,
    updateKids,
  };
}
