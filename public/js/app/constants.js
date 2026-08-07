export const TOKEN_KEY = 'howlers_webapp_token';

export const MAX_POST_PHOTO_BYTES = 512 * 1024;
export const MAX_POST_PHOTO_DIMENSION = 1600;

export const CATEGORY_SLUGS = ['said','did','mixed','milestone','oops','wisdom','art','bedtime'];
export const MOOD_SLUGS = ['golden','chaotic','sweet','legendary','hilarious','heartwarming','facepalm','proud','bittersweet'];
export const EMOTICON_SLUGS = [
  'happy', 'laugh', 'love', 'surprised', 'silly', 'proud',
  'angry', 'sad', 'crying', 'worried', 'sleepy', 'cool',
];
export const EMOTICON_TOKEN_RE = /:(happy|laugh|love|surprised|silly|proud|angry|sad|crying|worried|sleepy|cool):/g;

export const TEXT_FORMATS = {
  bold: { tag: 'b', labelKey: 'format_bold', glyph: 'B', shortcut: 'Ctrl/Cmd+B' },
  italic: { tag: 'i', labelKey: 'format_italic', glyph: 'I', shortcut: 'Ctrl/Cmd+I' },
  underline: { tag: 'u', labelKey: 'format_underline', glyph: 'U', shortcut: 'Ctrl/Cmd+U' },
  strike: { tag: 's', labelKey: 'format_strike', glyph: 'S', shortcut: 'Ctrl/Cmd+Shift+X' },
};
