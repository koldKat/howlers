'use strict';

const { MAX_POST_PHOTO_BYTES, MAX_POST_PHOTOS } = require('./config');
const { childNamesFromInput } = require('./child-names');
const { isValidLocalDate } = require('./date-validation');
const { validateRasterImageDataUrl } = require('./image-validation');
const domain = require('../shared/domain');

const VALID_CATEGORIES = new Set(domain.categories);
const VALID_MOODS = new Set(domain.moods);
const { limits } = domain;

function normalizeCategory(value) {
  return value || 'said';
}

function normalizeMood(value) {
  return value || 'golden';
}

function validateHowler(body) {
  const normalizedChildren = childNamesFromInput(body);
  if (normalizedChildren.error) return { ...normalizedChildren, field: 'children' };
  const { childNames } = normalizedChildren;
  const childName = childNames.join(', ');
  let title = String(body.title || '').trim();
  const hasCombinedContent = Object.prototype.hasOwnProperty.call(body, 'content');
  const content = String(body.content || '').trim();
  const quote = hasCombinedContent ? '' : String(body.quote || '').trim();
  const story = hasCombinedContent ? content : String(body.story || '').trim();
  const photosInput = Object.prototype.hasOwnProperty.call(body, 'photos')
    ? body.photos
    : [body.photo];
  if (!Array.isArray(photosInput)) return { error: 'Снимките трябва да са списък.', field: 'photo' };
  const photos = photosInput.map(value => String(value || '').trim()).filter(Boolean);
  const photo = photos[0] || '';
  const happenedOn = String(body.happenedOn || '').trim();
  const ageNote = String(body.ageNote || '').trim();
  const category = normalizeCategory(String(body.category || '').trim());
  const mood = normalizeMood(String(body.mood || '').trim());
  const isFavorite = Boolean(body.isFavorite);
  const isPublic = Boolean(body.isPublic);
  const tags = Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(',');

  if (photos.length > MAX_POST_PHOTOS) {
    return { error: `Можеш да добавиш най-много ${MAX_POST_PHOTOS} снимки.`, field: 'photo' };
  }
  if (!title && photos.length) title = 'Снимка';
  if (!title) return { error: 'Заглавието е задължително.', field: 'title' };
  if (!quote && !story && !photos.length) return { error: 'Добави текст или снимка към записа.', field: 'content' };
  if (title.length > limits.maxEntryTitleLength) return { error: 'Заглавието е прекалено дълго.', field: 'title' };
  if (hasCombinedContent && content.length > limits.maxEntryContentLength) return { error: 'Текстът на записа е прекалено дълъг.', field: 'content' };
  if (!hasCombinedContent && quote.length > limits.maxLegacyQuoteLength) return { error: 'Репликата е прекалено дълга.', field: 'content' };
  if (!hasCombinedContent && story.length > limits.maxLegacyStoryLength) return { error: 'Историята е прекалено дълга.', field: 'content' };
  if (!VALID_CATEGORIES.has(category)) return { error: 'Невалиден вид на записа.', field: 'category' };
  if (!VALID_MOODS.has(mood)) return { error: 'Невалидно настроение.', field: 'mood' };
  for (const candidate of photos) {
    const photoError = validateRasterImageDataUrl(candidate, MAX_POST_PHOTO_BYTES, '512 KB');
    if (photoError) return { error: photoError, field: 'photo' };
  }
  if (happenedOn && !isValidLocalDate(happenedOn)) {
    return { error: 'Въведи валидна дата във формат ДД/ММ/ГГГГ.', field: 'date' };
  }

  return {
    childName, childNames, title, quote, story, photo, photos, happenedOn, ageNote,
    category, mood, isFavorite, isPublic, tags,
  };
}

module.exports = {
  validateHowler,
};
