import { t } from '../i18n.js';
import {
  CATEGORY_SLUGS,
  EMOTICON_ASSET,
  EMOTICON_SLUGS,
  MAX_POST_PHOTO_BYTES,
  MAX_POST_PHOTO_DIMENSION,
  MAX_POST_PHOTOS,
  MOOD_SLUGS,
  TEXT_FORMATS,
} from './constants.js';
import { categoryLabel, emoticonLabel, moodLabel } from './entry-presentation.js';
import { dataUrlBytes, escapeHtml } from './format.js';

export function createEditorTools(elements) {
  let postPhotos = [];
  let photoWorkId = 0;
  let processingPhotos = false;
  let activeTextFormatFieldId = 'content';
  const textFormatSelections = new Map();

  function rememberSelection(target) {
    if (!target || !['title', 'content'].includes(target.id)) return;
    activeTextFormatFieldId = target.id;
    textFormatSelections.set(target.id, {
      start: Number.isInteger(target.selectionStart) ? target.selectionStart : target.value.length,
      end: Number.isInteger(target.selectionEnd) ? target.selectionEnd : target.value.length,
    });
  }

  function focusTarget(target) {
    try {
      target.focus({ preventScroll: true });
    } catch (_error) {
      target.focus();
    }
  }

  function toggleTextFormat(target, format) {
    const config = TEXT_FORMATS[format];
    if (!target || !config) return;
    focusTarget(target);
    const opening = `[${config.tag}]`;
    const closing = `[/${config.tag}]`;
    const start = Number.isInteger(target.selectionStart) ? target.selectionStart : target.value.length;
    const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : start;
    const selected = target.value.slice(start, end);
    target.setRangeText(`${opening}${selected}${closing}`, start, end, 'end');
    const selectionStart = start + opening.length;
    target.setSelectionRange(selectionStart, selectionStart + selected.length);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    rememberSelection(target);
    target.focus();
  }

  function restoreSelection(target, selection) {
    if (!target || !selection) return;
    focusTarget(target);
    const start = Math.max(0, Math.min(selection.start, target.value.length));
    const end = Math.max(start, Math.min(selection.end, target.value.length));
    target.setSelectionRange(start, end);
  }

  function activeTextTarget(fallbackId = 'content') {
    const target = document.getElementById(activeTextFormatFieldId)
      || document.getElementById(fallbackId);
    const selection = textFormatSelections.get(target?.id);
    if (target && selection) restoreSelection(target, selection);
    return target;
  }

  function resetTextTarget() {
    activeTextFormatFieldId = 'content';
    textFormatSelections.clear();
    const target = document.getElementById(activeTextFormatFieldId);
    if (target) {
      textFormatSelections.set(target.id, { start: target.value.length, end: target.value.length });
    }
  }

  function handleShortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const format = event.shiftKey && key === 'x'
      ? 'strike'
      : ({ b: 'bold', i: 'italic', u: 'underline' })[key];
    if (!format) return;
    event.preventDefault();
    rememberSelection(event.currentTarget);
    toggleTextFormat(event.currentTarget, format);
  }

  function insertEmoticon(target, slug) {
    if (!target || !EMOTICON_SLUGS.includes(slug)) return;
    const start = Number.isInteger(target.selectionStart) ? target.selectionStart : target.value.length;
    const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : start;
    target.setRangeText(`:${slug}:`, start, end, 'end');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.focus();
  }

  function setPhotoProcessing(processing) {
    processingPhotos = processing;
    elements.postPhotoInput.disabled = processing;
    elements.saveBtn.disabled = processing;
    elements.postPhotoField.classList.toggle('photo-processing', processing);
    elements.postPhotoField.toggleAttribute('aria-busy', processing);
    elements.postPhotoPreview.querySelectorAll('[data-remove-photo-index]').forEach(button => {
      button.disabled = processing;
    });
  }

  function renderPhotos(photos) {
    postPhotos = (Array.isArray(photos) ? photos : [photos]).filter(Boolean).slice(0, MAX_POST_PHOTOS);
    elements.postPhotoPreview.innerHTML = postPhotos.map((photo, index) => `
      <div class="post-photo-preview-item">
        <img src="${escapeHtml(photo)}" alt="${escapeHtml(t('post_photo_preview_alt', { number: index + 1 }))}">
        <button class="post-photo-remove" type="button" data-remove-photo-index="${index}" aria-label="${escapeHtml(t('post_photo_remove_number', { number: index + 1 }))}" data-tooltip="${escapeHtml(t('post_photo_remove'))}">&times;</button>
      </div>
    `).join('');
    elements.postPhotoPreview.hidden = postPhotos.length === 0;
    const totalSize = postPhotos.reduce((sum, photo) => sum + dataUrlBytes(photo), 0);
    elements.postPhotoStatus.textContent = postPhotos.length
      ? t('post_photos_ready', { count: postPhotos.length, size: Math.ceil(totalSize / 1024) })
      : t('post_photo_hint');
  }

  function setPhotos(photos) {
    photoWorkId += 1;
    setPhotoProcessing(false);
    renderPhotos(photos);
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

  async function resizePhoto(file) {
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

  function initializeControls() {
    elements.category.innerHTML = [
      `<option value="">${escapeHtml(t('form_select_category_placeholder'))}</option>`,
      ...CATEGORY_SLUGS.map(slug => `<option value="${slug}">${escapeHtml(categoryLabel(slug))}</option>`),
    ].join('');
    elements.mood.innerHTML = [
      `<option value="">${escapeHtml(t('form_select_mood_placeholder'))}</option>`,
      ...MOOD_SLUGS.map(slug => `<option value="${slug}">${escapeHtml(moodLabel(slug))}</option>`),
    ].join('');
    document.querySelectorAll('.text-format-toolbar').forEach(toolbar => {
      toolbar.innerHTML = Object.entries(TEXT_FORMATS).map(([format, config]) => {
        const label = t(config.labelKey);
        const title = `${label} (${config.shortcut})`;
        return `<button class="text-format-btn format-${format}" type="button" data-text-format="${format}" aria-label="${escapeHtml(title)}" data-tooltip="${escapeHtml(title)}">${config.glyph}</button>`;
      }).join('');
    });
    document.querySelectorAll('.inline-emote-picker').forEach(picker => {
      picker.innerHTML = EMOTICON_SLUGS.map(slug => `
        <button class="inline-emote-btn" type="button" aria-label="${escapeHtml(emoticonLabel(slug))}" data-tooltip="${escapeHtml(emoticonLabel(slug))}" data-inline-emoticon="${slug}">
          <svg viewBox="0 0 64 64" aria-hidden="true"><use href="${EMOTICON_ASSET}#${slug}"></use></svg>
        </button>
      `).join('');
    });
  }

  elements.postPhotoInput.addEventListener('change', async event => {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    if (postPhotos.length + files.length > MAX_POST_PHOTOS) {
      elements.postPhotoStatus.textContent = t('post_photo_error_count', { count: MAX_POST_PHOTOS });
      return;
    }
    const workId = ++photoWorkId;
    const existingPhotos = [...postPhotos];
    setPhotoProcessing(true);
    elements.postPhotoStatus.textContent = t('post_photo_processing');
    try {
      const resized = [];
      for (const file of files) resized.push(await resizePhoto(file));
      if (workId === photoWorkId) renderPhotos([...existingPhotos, ...resized]);
    } catch (error) {
      if (workId === photoWorkId) elements.postPhotoStatus.textContent = error.message;
    } finally {
      if (workId === photoWorkId) setPhotoProcessing(false);
    }
  });
  elements.postPhotoPreview.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-photo-index]');
    if (!button) return;
    const index = Number(button.dataset.removePhotoIndex);
    setPhotos(postPhotos.filter((_photo, photoIndex) => photoIndex !== index));
  });
  document.querySelectorAll('.text-format-toolbar').forEach(toolbar => {
    toolbar.addEventListener('pointerdown', event => {
      if (event.target.closest('[data-text-format]')) event.preventDefault();
    });
    toolbar.addEventListener('click', event => {
      const button = event.target.closest('[data-text-format]');
      if (button) toggleTextFormat(activeTextTarget(toolbar.dataset.formatTarget), button.dataset.textFormat);
    });
  });
  ['title', 'content'].forEach(id => {
    const field = document.getElementById(id);
    ['focus', 'select', 'input', 'keyup', 'mouseup'].forEach(type => {
      field.addEventListener(type, event => rememberSelection(event.currentTarget));
    });
    field.addEventListener('keydown', handleShortcut);
  });
  document.addEventListener('selectionchange', () => {
    if (['title', 'content'].includes(document.activeElement?.id)) rememberSelection(document.activeElement);
  });
  document.querySelectorAll('.inline-emote-picker').forEach(picker => {
    picker.addEventListener('pointerdown', event => {
      if (event.target.closest('[data-inline-emoticon]')) event.preventDefault();
    });
    picker.addEventListener('click', event => {
      const button = event.target.closest('[data-inline-emoticon]');
      if (button) insertEmoticon(activeTextTarget(picker.dataset.emoteTarget), button.dataset.inlineEmoticon);
    });
  });

  return {
    getPhotos: () => [...postPhotos],
    isProcessingPhotos: () => processingPhotos,
    initializeControls,
    resetTextTarget,
    setPhotos,
  };
}
