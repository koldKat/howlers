const db = require('../db');
const { authenticate } = require('../auth');
const { readBody, send, tokenFromReq } = require('../http');
const { buildState } = require('../state');
const { handleExport: sendExport } = require('../export');

function createSessionHandlers({ sseHub }) {
  async function register(req, res) {
    const { username, password } = await readBody(req);
    const cleanUsername = typeof username === 'string' ? username.trim() : '';
    const cleanPassword = typeof password === 'string' ? password : '';
    if (!cleanUsername || !cleanPassword) {
      send(res, 400, { error: 'Потребителското име и паролата са задължителни.' });
      return;
    }
    if (cleanUsername.length > 60) {
      send(res, 400, { error: 'Потребителското име трябва да е до 60 символа.' });
      return;
    }
    if (cleanPassword.length < 6 || cleanPassword.length > 256) {
      send(res, 400, { error: 'Паролата трябва да е между 6 и 256 символа.' });
      return;
    }
    const user = await db.createUser(cleanUsername, cleanPassword);
    send(res, 200, { token: db.createSession(user.id), username: user.username });
  }

  async function login(req, res) {
    const { username, password } = await readBody(req);
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      send(res, 400, { error: 'Потребителското име и паролата са задължителни.' });
      return;
    }
    const user = await db.verifyUser(username.trim(), password);
    if (!user) {
      send(res, 401, { error: 'Невалидно потребителско име или парола.' });
      return;
    }
    send(res, 200, { token: db.createSession(user.id), username: user.username });
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

  return { register, login, updateLocale, logout, me, state, events, exportArchive };
}

module.exports = { createSessionHandlers };
