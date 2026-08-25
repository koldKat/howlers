#!/usr/bin/env node
const http = require('http');
const db = require('./server/db');
const { MAX_AVATAR_BYTES, PORT } = require('./server/config');
const { readBody, send, tokenFromReq } = require('./server/http');
const { authenticate } = require('./server/auth');
const { handlePublicPost, handleRobots, handleSitemap } = require('./server/public');
const { scheduleDatabaseBackups } = require('./server/backup');
const { serveFile } = require('./server/static');
const { createSseHub } = require('./server/sse');
const { buildState, buildGuestState } = require('./server/state');
const { handleExport: sendExport } = require('./server/export');
const { localDateString } = require('./server/date-validation');
const { validateHowler } = require('./server/howler-validation');
const { validateRasterImageDataUrl } = require('./server/image-validation');
const { createAdminHandlers } = require('./server/routes/admin');

const sseHub = createSseHub({ db, buildState, buildGuestState });
const {
  handleAdminPage,
  handleAdminStats,
  handleAdminUsers,
  handleAdminEntries,
  handleAdminDeleteEntry,
  handleAdminTogglePublic,
  handleAdminDeleteUser,
  handleAdminClearSessions,
  handleAdminVacuum,
} = createAdminHandlers({ sseHub });

async function handleRegister(req, res) {
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
  const token = db.createSession(user.id);
  send(res, 200, { token, username: user.username });
}

async function handleLogin(req, res) {
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
  const token = db.createSession(user.id);
  send(res, 200, { token, username: user.username });
}

async function handleUpdateLocale(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  const { locale } = await readBody(req);
  db.updateUserLocale(session.user_id, locale);
  send(res, 200, { ok: true });
}

function handleLogout(req, res) {
  const token = tokenFromReq(req);
  if (token) db.deleteSession(token);
  send(res, 200, { ok: true });
  if (token) sseHub.closeClients(client => client.token === token, { sessionExpired: true });
}

function handleFeed(res) {
  send(res, 200, db.listPublicHowlers());
}

async function handleExport(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  sendExport(req, res, session);
}

async function handleMe(req, res) {
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

async function handleGetProfile(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  send(res, 200, db.getProfile(session.user_id));
}

async function handleUpdateProfile(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  const { displayName } = await readBody(req);
  if (displayName !== undefined && displayName !== null && typeof displayName !== 'string') {
    send(res, 400, { error: 'Показваното име трябва да е текст.' });
    return;
  }
  if (String(displayName || '').trim().length > 60) {
    send(res, 400, { error: 'Показваното име трябва да е до 60 символа.' });
    return;
  }
  const saved = db.updateProfile(session.user_id, { displayName });
  const profile = db.getProfile(session.user_id);
  sseHub.publishToUsers(db.getFamilyUserIds(session.user_id));
  send(res, 200, { ok: true, displayName: saved, profile });
}

async function handleUpdatePassword(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  const { currentPassword, newPassword } = await readBody(req);
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    send(res, 400, { error: 'Текущата и новата парола са задължителни.' });
    return;
  }
  if (String(newPassword).length < 6 || String(newPassword).length > 256) {
    send(res, 400, { error: 'Новата парола трябва да е между 6 и 256 символа.' });
    return;
  }
  try {
    await db.updatePassword(session.user_id, currentPassword, newPassword);
    send(res, 200, { ok: true });
  } catch (err) {
    send(res, 400, { error: err.message });
  }
}

async function handleUpdateAvatar(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  const { avatar } = await readBody(req);
  if (avatar !== null && avatar !== undefined && avatar !== '') {
    const avatarError = validateRasterImageDataUrl(avatar, MAX_AVATAR_BYTES, '300 KB');
    if (avatarError) {
      send(res, 400, { error: avatarError });
      return;
    }
  }
  db.updateAvatar(session.user_id, avatar || null);
  sseHub.publishToUsers(db.getFamilyUserIds(session.user_id));
  send(res, 200, { ok: true, avatar: avatar || null });
}

async function handleState(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  send(res, 200, buildState(session.user_id));
}

async function handleEvents(req, res) {
  const token = tokenFromReq(req);
  let session = null;
  if (token) {
    session = db.getSession(token);
    if (!session) {
      send(res, 401, { error: 'Нямаш достъп. Влез отново в профила си.' });
      return;
    }
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  const client = sseHub.register({ res, token: token || '', userId: session ? session.user_id : null });
  req.on('close', () => {
    sseHub.unregister(client);
  });
}

async function handleListKids(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  send(res, 200, db.listKids(session.user_id));
}

async function handleCreateKid(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  const { name, dob } = await readBody(req);
  if (typeof name !== 'string' || (dob !== undefined && dob !== null && typeof dob !== 'string')) {
    send(res, 400, { error: 'Името и датата трябва да са текст.' });
    return;
  }
  try {
    const kid = db.createKid(session.user_id, { name, dob });
    sseHub.publishToUsers(db.getFamilyUserIds(session.user_id));
    send(res, 200, { ok: true, kid });
  } catch (err) {
    send(res, 400, { error: err.message });
  }
}

async function handleDeleteKid(req, res, id) {
  const session = await authenticate(req, res);
  if (!session) return;
  const ok = db.deleteKid(session.user_id, id);
  if (!ok) { send(res, 404, { error: 'Детето не е намерено.' }); return; }
  sseHub.publishToUsers(db.getFamilyUserIds(session.user_id));
  send(res, 200, { ok: true });
}

async function handleCreateHowler(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  const parsed = validateHowler(await readBody(req));
  if (parsed.error) {
    send(res, 400, { error: parsed.error });
    return;
  }
  const entry = db.createHowler(session.user_id, {
    ...parsed,
    happenedOn: parsed.happenedOn || localDateString(),
  });
  sseHub.publishToAllClients();
  send(res, 200, { ok: true, entry, state: buildState(session.user_id) });
}

async function handleUpdateHowler(req, res, id) {
  const session = await authenticate(req, res);
  if (!session) return;
  const parsed = validateHowler(await readBody(req));
  if (parsed.error) {
    send(res, 400, { error: parsed.error });
    return;
  }
  const entry = db.updateHowler(session.user_id, id, parsed);
  if (!entry) {
    send(res, 404, { error: 'Записът не е намерен.' });
    return;
  }
  sseHub.publishToAllClients();
  send(res, 200, { ok: true, entry, state: buildState(session.user_id) });
}

async function handleDeleteHowler(req, res, id) {
  const session = await authenticate(req, res);
  if (!session) return;
  const ok = db.deleteHowler(session.user_id, id);
  if (!ok) {
    send(res, 404, { error: 'Записът не е намерен.' });
    return;
  }
  sseHub.publishToAllClients();
  send(res, 200, { ok: true, state: buildState(session.user_id) });
}

async function handleCreateFamilyInvite(req, res) {
  const session = await authenticate(req, res);
  if (!session) return;
  const { username } = await readBody(req);
  try {
    const invite = db.createFamilyInvite(session.user_id, username);
    sseHub.publishToUsers([session.user_id, invite.inviteeUserId]);
    send(res, 200, { ok: true, inviteId: invite.id });
  } catch (err) {
    send(res, 400, { error: err.message });
  }
}

async function handleAcceptFamilyInvite(req, res, inviteId) {
  const session = await authenticate(req, res);
  if (!session) return;
  try {
    const result = db.acceptFamilyInvite(session.user_id, inviteId);
    sseHub.publishToUsers(result.memberUserIds);
    send(res, 200, { ok: true });
  } catch (err) {
    send(res, 400, { error: err.message });
  }
}

async function handleCancelFamilyInvite(req, res, inviteId) {
  const session = await authenticate(req, res);
  if (!session) return;
  try {
    const result = db.cancelFamilyInvite(session.user_id, inviteId);
    sseHub.publishToUsers([result.inviterUserId, result.inviteeUserId]);
    send(res, 200, { ok: true });
  } catch (err) {
    send(res, 400, { error: err.message });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
    const howlerMatch = url.pathname.match(/^\/api\/howlers\/(\d+)$/);
    const kidMatch = url.pathname.match(/^\/api\/kids\/(\d+)$/);
    const publicPostMatch = url.pathname.match(/^\/posts\/(\d+)$/);
    const familyInviteMatch = url.pathname.match(/^\/api\/family\/invites\/(\d+)(?:\/(accept))?$/);
    const adminEntryMatch = url.pathname.match(/^\/api\/admin\/entries\/(\d+)$/);
    const adminUserMatch  = url.pathname.match(/^\/api\/admin\/users\/(\d+)(?:\/(sessions))?$/);

    if (req.method === 'GET' && url.pathname === '/admin') return void handleAdminPage(req, res);
    if (req.method === 'GET' && url.pathname === '/api/admin/stats') return void handleAdminStats(req, res);
    if (req.method === 'GET' && url.pathname === '/api/admin/users') return void handleAdminUsers(req, res);
    if (req.method === 'GET' && url.pathname === '/api/admin/entries') return void handleAdminEntries(req, res);
    if (adminEntryMatch && req.method === 'DELETE') return void await handleAdminDeleteEntry(req, res, Number(adminEntryMatch[1]));
    if (adminEntryMatch && req.method === 'PATCH') return void await handleAdminTogglePublic(req, res, Number(adminEntryMatch[1]));
    if (adminUserMatch && !adminUserMatch[2] && req.method === 'DELETE') return void await handleAdminDeleteUser(req, res, Number(adminUserMatch[1]));
    if (adminUserMatch && adminUserMatch[2] === 'sessions' && req.method === 'DELETE') return void handleAdminClearSessions(req, res, Number(adminUserMatch[1]));
    if (req.method === 'POST' && url.pathname === '/api/admin/vacuum') return void await handleAdminVacuum(req, res);
    if (req.method === 'POST' && url.pathname === '/api/register') return void await handleRegister(req, res);
    if (req.method === 'POST' && url.pathname === '/api/login') return void await handleLogin(req, res);
    if (req.method === 'POST' && url.pathname === '/api/locale') return void await handleUpdateLocale(req, res);
    if (req.method === 'POST' && url.pathname === '/api/logout') return void handleLogout(req, res);
    if (req.method === 'GET'  && url.pathname === '/api/profile') return void await handleGetProfile(req, res);
    if (req.method === 'PATCH' && url.pathname === '/api/profile') return void await handleUpdateProfile(req, res);
    if (req.method === 'POST' && url.pathname === '/api/profile/password') return void await handleUpdatePassword(req, res);
    if (req.method === 'POST' && url.pathname === '/api/profile/avatar') return void await handleUpdateAvatar(req, res);
    if (req.method === 'POST' && url.pathname === '/api/family/invites') return void await handleCreateFamilyInvite(req, res);
    if (familyInviteMatch && familyInviteMatch[2] === 'accept' && req.method === 'POST') return void await handleAcceptFamilyInvite(req, res, Number(familyInviteMatch[1]));
    if (familyInviteMatch && !familyInviteMatch[2] && req.method === 'DELETE') return void await handleCancelFamilyInvite(req, res, Number(familyInviteMatch[1]));
    if (req.method === 'GET' && url.pathname === '/api/feed') return void handleFeed(res);
    if (req.method === 'GET' && url.pathname === '/api/export') return void await handleExport(req, res);
    if (req.method === 'GET' && url.pathname === '/api/me') return void await handleMe(req, res);
    if (req.method === 'GET' && url.pathname === '/api/state') return void await handleState(req, res);
    if (req.method === 'GET' && url.pathname === '/api/events') return void await handleEvents(req, res);
    if (req.method === 'GET' && url.pathname === '/sitemap.xml') return void handleSitemap(req, res);
    if (req.method === 'GET' && url.pathname === '/robots.txt') return void handleRobots(req, res);
    if (req.method === 'GET' && publicPostMatch) return void handlePublicPost(req, res, Number(publicPostMatch[1]));
    if (req.method === 'GET'  && url.pathname === '/api/kids') return void await handleListKids(req, res);
    if (req.method === 'POST' && url.pathname === '/api/kids') return void await handleCreateKid(req, res);
    if (kidMatch && req.method === 'DELETE') return void await handleDeleteKid(req, res, Number(kidMatch[1]));
    if (req.method === 'POST' && url.pathname === '/api/howlers') return void await handleCreateHowler(req, res);
    if (howlerMatch && req.method === 'PUT') return void await handleUpdateHowler(req, res, Number(howlerMatch[1]));
    if (howlerMatch && req.method === 'DELETE') return void await handleDeleteHowler(req, res, Number(howlerMatch[1]));
    if (req.method === 'GET') {
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        send(res, 400, { error: 'Невалиден адрес.' });
        return;
      }
      return void serveFile(req, res, pathname);
    }
    send(res, 404, { error: 'Страницата не е намерена.' });
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    if (status >= 500) console.error(error);
    if (!res.headersSent) send(res, status, { error: error.message || 'Грешка в сървъра.' });
  }
});

server.listen(PORT, () => {
  const purged = db.purgeExpiredSessions();
  if (purged > 0) console.log(`Purged ${purged} expired session(s).`);
  scheduleDatabaseBackups();
  console.log(`Семейни бисери listening on http://localhost:${PORT}`);
});
