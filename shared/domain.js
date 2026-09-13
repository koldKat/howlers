(function defineHowlersDomain(root, factory) {
  const domain = factory();
  if (typeof module === 'object' && module.exports) module.exports = domain;
  root.HowlersDomain = domain;
})(typeof globalThis === 'undefined' ? this : globalThis, () => Object.freeze({
  brand: Object.freeze({
    name: 'Семейни бисери',
    rootTitle: 'Детски бисери и семейни истории | Семейни бисери',
    description: 'Детски бисери, смешни детски реплики и семейни истории на едно място. Семейни бисери е личен архив с публична лента за споделени моменти.',
    ogDescription: 'Детски бисери, смешни детски реплики и семейни истории на едно място.',
    shortDescription: 'Детски бисери, смешни детски реплики и семейни истории.',
    subtitle: 'Реплики, случки и малки легенди',
  }),
  assets: Object.freeze({ emoticons: '/emoticons.svg' }),
  limits: Object.freeze({
    maxAvatarBytes: 300 * 1024,
    maxPostPhotoBytes: 512 * 1024,
    maxPostPhotoDimension: 1600,
    maxUsernameLength: 60,
    maxDisplayNameLength: 60,
    maxChildNameLength: 60,
    minPasswordLength: 6,
    maxPasswordLength: 256,
    maxEntryTitleLength: 120,
    maxEntryContentLength: 5000,
    maxLegacyQuoteLength: 800,
    maxLegacyStoryLength: 4000,
  }),
  categories: Object.freeze(['said', 'did', 'mixed', 'milestone', 'oops', 'wisdom', 'art', 'bedtime']),
  moods: Object.freeze(['golden', 'chaotic', 'sweet', 'legendary', 'hilarious', 'heartwarming', 'facepalm', 'proud', 'bittersweet']),
  emoticons: Object.freeze(['happy', 'laugh', 'love', 'surprised', 'silly', 'proud', 'angry', 'sad', 'crying', 'worried', 'sleepy', 'cool']),
}));
