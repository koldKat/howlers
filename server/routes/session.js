const db = require('../db');
const { authenticate } = require('../auth');
const { readBody, send, tokenFromReq } = require('../http');
const { buildState } = require('../state');
const { handleExport: sendExport } = require('../export');
const { PUBLIC_URL } = require('../config');
const {
  clientIp,
  isRateLimited,
  recordFailure,
  clearFailures,
  recordPasswordResetRequest,
  isPasswordResetRateLimited,
} = require('../auth-rate-limit');
const mailer = require('../mailer');

const RESET_REQUEST_MESSAGE = 'Ако профилът има имейл адрес, изпратихме връзка за нова парола.';

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function passwordResetEmail({ username, link }) {
  const safeName = escapeHtml(username);
  const safeLink = escapeHtml(link);
  return `<!doctype html><html lang="bg"><body style="margin:0;padding:0;background:#fff6dc;color:#23314d;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;border:1px solid #f2c979;background:#fffaf0;border-radius:18px"><tr><td style="padding:18px 22px;border-bottom:1px solid #f2c979;color:#d26b48;font-size:13px;font-weight:bold">СЕМЕЙНИ БИСЕРИ</td></tr><tr><td style="padding:26px 22px"><h1 style="margin:0 0 14px;font-size:24px">Нова парола</h1><p style="line-height:1.55">Здравей, ${safeName}. Използвай бутона, за да избереш нова парола. Връзката е еднократна и важи един час.</p><p style="margin:22px 0"><a href="${safeLink}" style="display:inline-block;padding:12px 17px;background:#ffab35;color:#4a2f00;font-weight:bold;text-decoration:none;border-radius:12px">Избери нова парола</a></p><p style="font-size:12px;line-height:1.55;color:#596a89">Ако бутонът не се отваря, използвай този адрес:<br><a href="${safeLink}" style="color:#216c82;word-break:break-all">${safeLink}</a></p></td></tr><tr><td style="padding:14px 22px;border-top:1px solid #f2c979;color:#596a89;font-size:12px">Ако не си поискал промяната, просто пренебрегни този имейл.</td></tr></table></td></tr></table></body></html>`;
}

function createSessionHandlers({ sseHub }) {
  async function register(req, res) {
    const ip = clientIp(req);
    if (isRateLimited(ip)) { send(res, 429, { error: 'Твърде много опити. Опитай отново след малко.' }); return; }
    const { username, password, email } = await readBody(req);
    const cleanUsername = typeof username === 'string' ? username.trim() : '';
    const cleanPassword = typeof password === 'string' ? password : '';
    if (!cleanUsername || !cleanPassword) {
      recordFailure(ip);
      send(res, 400, { error: 'Потребителското име и паролата са задължителни.' });
      return;
    }
    if (cleanUsername.length > 60) {
      recordFailure(ip);
      send(res, 400, { error: 'Потребителското име трябва да е до 60 символа.' });
      return;
    }
    if (cleanPassword.length < 6 || cleanPassword.length > 256) {
      recordFailure(ip);
      send(res, 400, { error: 'Паролата трябва да е между 6 и 256 символа.' });
      return;
    }
    let user;
    try {
      user = await db.createUser(cleanUsername, cleanPassword, email);
    } catch (error) {
      recordFailure(ip);
      throw error;
    }
    clearFailures(ip);
    send(res, 200, { token: db.createSession(user.id), username: user.username });
  }

  async function login(req, res) {
    const ip = clientIp(req);
    if (isRateLimited(ip)) { send(res, 429, { error: 'Твърде много опити. Опитай отново след малко.' }); return; }
    const { username, password } = await readBody(req);
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      recordFailure(ip);
      send(res, 400, { error: 'Потребителското име и паролата са задължителни.' });
      return;
    }
    const user = await db.verifyUser(username.trim(), password);
    if (user?.locked) {
      const error = user.manual
        ? 'Профилът е заключен от администратор.'
        : `Профилът е временно заключен след много грешни опити. Опитай отново след ${user.minutesLeft} мин.`;
      send(res, 423, { error, locked: true, manual: Boolean(user.manual) });
      return;
    }
    if (!user) {
      recordFailure(ip);
      send(res, 401, { error: 'Невалидно потребителско име или парола.' });
      return;
    }
    clearFailures(ip);
    send(res, 200, { token: db.createSession(user.id), username: user.username });
  }

  async function requestPasswordReset(req, res) {
    const ip = clientIp(req);
    if (isRateLimited(ip) || isPasswordResetRateLimited(ip)) {
      send(res, 429, { error: 'Твърде много опити. Опитай отново след малко.' });
      return;
    }
    recordPasswordResetRequest(ip);
    const { identity } = await readBody(req);
    const reset = db.preparePasswordReset(identity);
    if (reset) {
      try {
        const link = `${PUBLIC_URL}/?reset=${encodeURIComponent(reset.token)}`;
        await mailer.send({
          to: reset.email,
          subject: 'Нова парола за Семейни бисери',
          text: `Здравей, ${reset.username}.\n\nИзползвай тази еднократна връзка, за да избереш нова парола:\n${link}\n\nВръзката важи един час.`,
          html: passwordResetEmail({ username: reset.username, link }),
        });
        db.storePasswordReset(reset);
      } catch (error) {
        console.error(`[mail] Password reset delivery failed: ${error.message}`);
      }
    }
    send(res, 200, { message: RESET_REQUEST_MESSAGE });
  }

  async function completePasswordReset(req, res) {
    const { token, password, passwordConfirm } = await readBody(req);
    if (!token || typeof password !== 'string') {
      send(res, 400, { error: 'Липсват данни за смяна на паролата.' });
      return;
    }
    if (password !== passwordConfirm) {
      send(res, 400, { error: 'Паролите не съвпадат.' });
      return;
    }
    await db.resetPassword(token, password);
    send(res, 200, { message: 'Паролата е сменена. Вече можеш да влезеш.' });
  }

  async function updateLocale(req, res) {
    const session = await authenticate(req, res);
    if (!session) return;
    const { locale } = await readBody(req);
    db.updateUserLocale(session.user_id, locale);
    send(res, 200, { ok: true });
  }

  function logout(req, res) {
    const token = tokenFromReq(req);
    if (token) db.deleteSession(token);
    send(res, 200, { ok: true });
    if (token) sseHub.closeClients(client => client.token === token, { sessionExpired: true });
  }

  async function me(req, res) {
    const session = await authenticate(req, res);
    if (!session) return;
    const profile = db.getProfile(session.user_id);
    send(res, 200, {
      username: session.username,
      email: profile ? profile.email : '',
      displayName: profile ? profile.displayName : null,
      locale: 'bg',
      avatar: profile ? profile.avatar : null,
    });
  }

  async function state(req, res) {
    const session = await authenticate(req, res);
    if (session) send(res, 200, buildState(session.user_id));
  }

  async function events(req, res) {
    const token = tokenFromReq(req);
    const session = token ? db.getSession(token) : null;
    if (token && !session) {
      send(res, 401, { error: 'Нямаш достъп. Влез отново в профила си.' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    const client = sseHub.register({ res, token: token || '', userId: session ? session.user_id : null });
    req.on('close', () => sseHub.unregister(client));
  }

  async function exportArchive(req, res) {
    const session = await authenticate(req, res);
    if (session) sendExport(req, res, session);
  }

  return {
    register, login, requestPasswordReset, completePasswordReset,
    updateLocale, logout, me, state, events, exportArchive,
  };
}

module.exports = { createSessionHandlers };
