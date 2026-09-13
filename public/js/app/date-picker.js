import { formatDate, parseDateInput } from './format.js';

function isoDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function selectedParts(input) {
  const iso = parseDateInput(input.value);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1, iso } : null;
}

function maskDateInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/');
}

export function createDatePicker(elements) {
  let activeInput = null;
  let viewYear = new Date().getFullYear();
  let viewMonth = new Date().getMonth();

  function render() {
    const selected = activeInput ? selectedParts(activeInput) : null;
    elements.datePickerLabel.textContent = new Intl.DateTimeFormat('bg-BG', {
      month: 'long', year: 'numeric',
    }).format(new Date(viewYear, viewMonth, 1));
    const leadingBlanks = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
    const days = new Date(viewYear, viewMonth + 1, 0).getDate();
    const today = new Date();
    const todayIso = isoDate(today.getFullYear(), today.getMonth(), today.getDate());
    const cells = Array.from({ length: leadingBlanks }, () => '<span></span>');
    for (let day = 1; day <= days; day += 1) {
      const value = isoDate(viewYear, viewMonth, day);
      const classes = [value === selected?.iso ? 'selected' : '', value === todayIso ? 'today' : '']
        .filter(Boolean).join(' ');
      cells.push(`<button class="${classes}" type="button" data-date-value="${value}"${value === selected?.iso ? ' aria-current="date"' : ''}>${day}</button>`);
    }
    elements.datePickerGrid.innerHTML = cells.join('');
  }

  function open(input) {
    activeInput = input;
    const selected = selectedParts(input);
    const now = new Date();
    viewYear = selected?.year || now.getFullYear();
    viewMonth = selected?.month ?? now.getMonth();
    render();
    if (!elements.datePickerDialog.open) elements.datePickerDialog.showModal();
  }

  function close({ focus = true } = {}) {
    if (elements.datePickerDialog.open) elements.datePickerDialog.close();
    if (focus) activeInput?.focus();
  }

  function setValue(iso) {
    if (!activeInput) return;
    activeInput.value = formatDate(iso);
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
    activeInput.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  }

  function moveMonth(offset) {
    const date = new Date(viewYear, viewMonth + offset, 1);
    viewYear = date.getFullYear();
    viewMonth = date.getMonth();
    render();
  }

  function bindEvents() {
    document.querySelectorAll('[data-date-picker]').forEach(input => {
      input.addEventListener('input', () => {
        const masked = maskDateInput(input.value);
        if (input.value !== masked) input.value = masked;
      });
    });
    document.addEventListener('click', event => {
      const trigger = event.target.closest('[data-date-picker-trigger]');
      if (trigger) open(trigger.parentElement.querySelector('[data-date-picker]'));
    });
    elements.datePickerGrid.addEventListener('click', event => {
      const day = event.target.closest('[data-date-value]');
      if (day) setValue(day.dataset.dateValue);
    });
    elements.datePickerPrev.addEventListener('click', () => moveMonth(-1));
    elements.datePickerNext.addEventListener('click', () => moveMonth(1));
    elements.datePickerToday.addEventListener('click', () => {
      const today = new Date();
      setValue(isoDate(today.getFullYear(), today.getMonth(), today.getDate()));
    });
    elements.datePickerClear.addEventListener('click', () => setValue(''));
    elements.datePickerClose.addEventListener('click', () => close());
  }

  return { bindEvents, close, open };
}
