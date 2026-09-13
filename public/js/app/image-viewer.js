export function createImageViewer(elements) {
  function open(source, alt) {
    if (!source) return;
    elements.imageViewerImage.src = source;
    elements.imageViewerImage.alt = alt || '';
    if (!elements.imageViewerDialog.open) elements.imageViewerDialog.showModal();
  }

  function close() {
    if (elements.imageViewerDialog.open) elements.imageViewerDialog.close();
    elements.imageViewerImage.removeAttribute('src');
    elements.imageViewerImage.alt = '';
  }

  function bindEvents() {
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-view-photo]');
      if (!button) return;
      event.preventDefault();
      const image = button.querySelector('img');
      open(image?.currentSrc || image?.src, image?.alt || '');
    });
    elements.imageViewerClose.addEventListener('click', close);
    elements.imageViewerDialog.addEventListener('close', () => {
      elements.imageViewerImage.removeAttribute('src');
      elements.imageViewerImage.alt = '';
    });
  }

  return { bindEvents, close, open };
}
