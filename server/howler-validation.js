'use strict';

const { MAX_POST_PHOTO_BYTES } = require('./config');
const { childNamesFromInput } = require('./child-names');
const { isValidLocalDate } = require('./date-validation');
const { validateRasterImageDataUrl } = require('./image-validation');

const VALID_CATEGORIES = new Set(['said', 'did', 'mixed', 'milestone', 'oops', 'wisdom', 'art', 'bedtime']);
const VALID_MOODS = new Set(['golden', 'chaotic', 'sweet', 'legendary', 'hilarious', 'heartwarming', 'facepalm', 'proud', 'bittersweet']);

function normalizeCategory(value) {
  return value || 'said';
}

function normalizeMood(value) {
  return value || 'golden';
}

function validateHowler(body) {
  const normalizedChildren = childNamesFromInput(body);
  if (normalizedChildren.error) return normalizedChildren;
  const { childNames } = normalizedChildren;
  const childName = childNames.join(', ');
  let title = String(body.title || '').trim();
  const hasCombinedContent = Object.prototype.hasOwnProperty.call(body, 'content');
  const content = String(body.content || '').trim();
  const quote = hasCombinedContent ? '' : String(body.quote || '').trim();
  const story = hasCombinedContent ? content : String(body.story || '').trim();
  const photo = String(body.photo || '').trim();
  const happenedOn = String(body.happenedOn || '').trim();
  const ageNote = String(body.ageNote || '').trim();
  const category = normalizeCategory(String(body.category || '').trim());
  const mood = normalizeMood(String(body.mood || '').trim());
  const isFavorite = Boolean(body.isFavorite);
  const isPublic = Boolean(body.isPublic);
  const tags = Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(',');

  if (!title && photo) title = 'Снимка';
  if (!title) return { error: 'Заглавието е задължително.' };
  if (!quote && !story && !photo) return { error: 'Добави текст или снимка към записа.' };
  if (title.length > 120) return { error: 'Заглавието е прекалено дълго.' };
  if (hasCombinedContent && content.length > 5000) return { error: 'Текстът на записа е прекалено дълъг.' };
  if (!hasCombinedContent && quote.length > 800) return { error: 'Репликата е прекалено дълга.' };
  if (!hasCombinedContent && story.length > 4000) return { error: 'Историята е прекалено дълга.' };
  if (!VALID_CATEGORIES.has(category)) return { error: 'Невалиден вид на записа.' };
  if (!VALID_MOODS.has(mood)) return { error: 'Невалидно настроение.' };
  if (photo) {
    const photoError = validateRasterImageDataUrl(photo, MAX_POST_PHOTO_BYTES, '512 KB');
    if (photoError) return { error: photoError };
  }
  if (happenedOn && !isValidLocalDate(happenedOn)) return { error: 'Въведи валидна дата във формат ГГГГ-ММ-ДД.' };

  return {
    childName, childNames, title, quote, story, photo, happenedOn, ageNote,
    category, mood, isFavorite, isPublic, tags,
  };
}

module.exports = {
  validateHowler,
};
