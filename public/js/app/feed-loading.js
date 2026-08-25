export function createFeedLoader(container) {
  const source = container.querySelector('.feed-loading');
  if (!source) throw new Error('Feed loading template is missing.');
  const template = source.cloneNode(true);

  return {
    show(label) {
      const loader = template.cloneNode(true);
      const text = loader.querySelector('[data-i18n="feed_loading"]');
      if (text && label) text.textContent = label;
      container.replaceChildren(loader);
    },
  };
}
