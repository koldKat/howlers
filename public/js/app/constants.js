const domain = globalThis.HowlersDomain;
if (!domain) throw new Error('Shared app domain was not loaded.');

export const TOKEN_KEY = 'howlers_webapp_token';
export const COPYRIGHT_START_YEAR = 2026;

export const APP_NAME = domain.brand.name;
export const ROOT_TITLE = domain.brand.rootTitle;
export const ROOT_DESCRIPTION = domain.brand.description;
export const ROOT_OG_DESCRIPTION = domain.brand.ogDescription;
export const EMOTICON_ASSET = domain.assets.emoticons;
export const MAX_AVATAR_BYTES = domain.limits.maxAvatarBytes;
export const MIN_PASSWORD_LENGTH = domain.limits.minPasswordLength;
export const MAX_POST_PHOTO_BYTES = domain.limits.maxPostPhotoBytes;
export const MAX_POST_PHOTO_DIMENSION = domain.limits.maxPostPhotoDimension;

export const CATEGORY_SLUGS = domain.categories;
export const MOOD_SLUGS = domain.moods;
export const EMOTICON_SLUGS = domain.emoticons;
export const EMOTICON_TOKEN_RE = new RegExp(`:(${EMOTICON_SLUGS.join('|')}):`, 'g');

export const TEXT_FORMATS = {
  bold: { tag: 'b', labelKey: 'format_bold', glyph: 'B', shortcut: 'Ctrl/Cmd+B' },
  italic: { tag: 'i', labelKey: 'format_italic', glyph: 'I', shortcut: 'Ctrl/Cmd+I' },
  underline: { tag: 'u', labelKey: 'format_underline', glyph: 'U', shortcut: 'Ctrl/Cmd+U' },
  strike: { tag: 's', labelKey: 'format_strike', glyph: 'S', shortcut: 'Ctrl/Cmd+Shift+X' },
};
