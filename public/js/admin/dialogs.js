export function createToast() {
  const toastEl = document.getElementById('toast') || (() => {
    const el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
    return el;
  })();
  let toastTimer = null;
  return function toast(msg, duration = 2500) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
  };
}

export function createConfirmDialog() {
  const confirmOverlay  = document.getElementById('confirm-overlay');
  const confirmTitle    = document.getElementById('confirm-title');
  const confirmMessage  = document.getElementById('confirm-message');
  const confirmOk       = document.getElementById('confirm-ok');
  const confirmCancel   = document.getElementById('confirm-cancel');
  let confirmResolver   = null;
  let confirmBackdropPress = null;

  function askConfirm({ title = '', message = '', okLabel = 'Потвърди' } = {}) {
    confirmTitle.textContent   = title;
    confirmMessage.textContent = message;
    confirmOk.textContent      = okLabel;
    confirmOverlay.classList.add('active');
    return new Promise(resolve => { confirmResolver = resolve; });
  }

  function closeConfirm(result) {
    confirmOverlay.classList.remove('active');
    if (confirmResolver) { confirmResolver(result); confirmResolver = null; }
  }

  confirmCancel.addEventListener('click', () => closeConfirm(false));
  confirmOk.addEventListener('click',     () => closeConfirm(true));
  confirmOverlay.addEventListener('pointerdown', event => {
    confirmBackdropPress = event.target === confirmOverlay
      ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      : null;
  });
  confirmOverlay.addEventListener('pointerup', event => {
    if (!confirmBackdropPress || event.pointerId !== confirmBackdropPress.pointerId) return;
    const moved = Math.hypot(
      event.clientX - confirmBackdropPress.x,
      event.clientY - confirmBackdropPress.y
    );
    const shouldDismiss = event.target === confirmOverlay && moved <= 6;
    confirmBackdropPress = null;
    if (shouldDismiss) closeConfirm(false);
  });
  confirmOverlay.addEventListener('pointercancel', () => { confirmBackdropPress = null; });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && confirmOverlay.classList.contains('active')) closeConfirm(false);
  });

  return { askConfirm, closeConfirm };
}
