import { t } from '../i18n.js';

async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Заявката е неуспешна.');
  return data;
}

export function createAuthController(els, { onAuthenticated }) {
  let mode = 'login';
  let resetToken = '';

  function setMode(nextMode) {
    mode = nextMode === 'register' ? 'register' : 'login';
    const registering = mode === 'register';
    els.authLoginMode.classList.toggle('is-active', !registering);
    els.authRegisterMode.classList.toggle('is-active', registering);
    els.authEmailLabel.hidden = !registering;
    els.authConfirmLabel.hidden = !registering;
    els.authPassword.autocomplete = registering ? 'new-password' : 'current-password';
    els.authSubmit.textContent = t(registering ? 'register_btn' : 'login_btn');
    els.forgotPasswordBtn.hidden = registering;
    els.authError.textContent = '';
  }

  function showMain() {
    resetToken = '';
    els.authModeTabs.hidden = false;
    els.authMainForm.hidden = false;
    els.passwordResetRequestForm.hidden = true;
    els.passwordResetCompleteForm.hidden = true;
    setMode('login');
  }

  function open(message = '') {
    if (els.authMainForm.hidden && els.passwordResetRequestForm.hidden && els.passwordResetCompleteForm.hidden) showMain();
    els.authModal.style.display = 'flex';
    if (message) els.authError.textContent = message;
  }

  function close() {
    els.authModal.style.display = 'none';
  }

  function showResetRequest() {
    resetToken = '';
    els.authModeTabs.hidden = true;
    els.authMainForm.hidden = true;
    els.passwordResetRequestForm.hidden = false;
    els.passwordResetCompleteForm.hidden = true;
    els.passwordResetRequestForm.reset();
    els.passwordResetRequestError.textContent = '';
    els.passwordResetRequestSuccess.textContent = '';
    els.passwordResetIdentity.disabled = false;
    els.passwordResetRequestSubmit.hidden = false;
    setTimeout(() => els.passwordResetIdentity.focus(), 0);
  }

  function showResetComplete(token) {
    resetToken = token;
    els.authModeTabs.hidden = true;
    els.authMainForm.hidden = true;
    els.passwordResetRequestForm.hidden = true;
    els.passwordResetCompleteForm.hidden = false;
    els.passwordResetCompleteForm.reset();
    els.passwordResetCompleteError.textContent = '';
    els.passwordResetCompleteSuccess.textContent = '';
    els.passwordResetNew.disabled = false;
    els.passwordResetConfirm.disabled = false;
    els.passwordResetCompleteSubmit.hidden = false;
    open();
    setTimeout(() => els.passwordResetNew.focus(), 0);
  }

  function openInitialReset() {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('reset');
    if (!token) return false;
    url.searchParams.delete('reset');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    showResetComplete(token);
    return true;
  }

  els.authLoginMode.addEventListener('click', () => setMode('login'));
  els.authRegisterMode.addEventListener('click', () => setMode('register'));
  els.forgotPasswordBtn.addEventListener('click', showResetRequest);
  els.authModal.querySelectorAll('[data-auth-back]').forEach(button => button.addEventListener('click', showMain));

  els.authMainForm.addEventListener('submit', async event => {
    event.preventDefault();
    els.authError.textContent = '';
    const password = els.authPassword.value;
    if (mode === 'register' && password !== els.authPasswordConfirm.value) {
      els.authError.textContent = t('auth_passwords_mismatch');
      return;
    }
    els.authSubmit.disabled = true;
    try {
      const result = await post(mode === 'register' ? '/api/register' : '/api/login', {
        username: els.authUsername.value.trim(),
        password,
        ...(mode === 'register' ? { email: els.authEmail.value.trim() } : {}),
      });
      await onAuthenticated(result.token);
    } catch (error) {
      els.authError.textContent = error.message;
    } finally {
      els.authSubmit.disabled = false;
    }
  });

  els.passwordResetRequestForm.addEventListener('submit', async event => {
    event.preventDefault();
    els.passwordResetRequestError.textContent = '';
    els.passwordResetRequestSubmit.disabled = true;
    try {
      const result = await post('/api/password-reset/request', { identity: els.passwordResetIdentity.value.trim() });
      els.passwordResetRequestSuccess.textContent = result.message;
      els.passwordResetIdentity.disabled = true;
      els.passwordResetRequestSubmit.hidden = true;
    } catch (error) {
      els.passwordResetRequestError.textContent = error.message;
    } finally {
      els.passwordResetRequestSubmit.disabled = false;
    }
  });

  els.passwordResetCompleteForm.addEventListener('submit', async event => {
    event.preventDefault();
    els.passwordResetCompleteError.textContent = '';
    const password = els.passwordResetNew.value;
    const passwordConfirm = els.passwordResetConfirm.value;
    if (password !== passwordConfirm) {
      els.passwordResetCompleteError.textContent = t('auth_passwords_mismatch');
      return;
    }
    els.passwordResetCompleteSubmit.disabled = true;
    try {
      const result = await post('/api/password-reset', { token: resetToken, password, passwordConfirm });
      resetToken = '';
      els.passwordResetCompleteSuccess.textContent = result.message;
      els.passwordResetNew.disabled = true;
      els.passwordResetConfirm.disabled = true;
      els.passwordResetCompleteSubmit.hidden = true;
    } catch (error) {
      els.passwordResetCompleteError.textContent = error.message;
    } finally {
      els.passwordResetCompleteSubmit.disabled = false;
    }
  });

  showMain();
  return { open, close, showMain, openInitialReset };
}
