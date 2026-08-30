const db = require('./db');
const { PORT } = require('./config');
const { send } = require('./http');
const { handlePublicPost, handleRobots, handleSharedPost, handleSitemap } = require('./public');
const { serveFile } = require('./static');
const { createAdminHandlers } = require('./routes/admin');
const { createEntryHandlers } = require('./routes/entries');
const { createFamilyHandlers } = require('./routes/families');
const { createProfileHandlers } = require('./routes/profile');
const { createSessionHandlers } = require('./routes/session');

function createRequestHandler({ sseHub }) {
  const admin = createAdminHandlers({ sseHub });
  const entries = createEntryHandlers({ sseHub });
  const families = createFamilyHandlers({ sseHub });
  const profile = createProfileHandlers({ sseHub });
  const session = createSessionHandlers({ sseHub });

  return async function handleRequest(req, res) {
    try {
      return await (async () => {
      const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
      const howler = url.pathname.match(/^\/api\/howlers\/(\d+)$/);
      const howlerShare = url.pathname.match(/^\/api\/howlers\/(\d+)\/share$/);
      const publicHowler = url.pathname.match(/^\/api\/public\/howlers\/(\d+)$/);
      const sharedHowler = url.pathname.match(/^\/api\/shared\/([A-Za-z0-9_-]{32})$/);
      const kid = url.pathname.match(/^\/api\/kids\/(\d+)$/);
      const publicPost = url.pathname.match(/^\/posts\/(\d+)$/);
      const sharedPost = url.pathname.match(/^\/shared\/([A-Za-z0-9_-]{32})$/);
      const invite = url.pathname.match(/^\/api\/family\/invites\/(\d+)(?:\/(accept))?$/);
      const adminEntry = url.pathname.match(/^\/api\/admin\/entries\/(\d+)$/);
      const adminUser = url.pathname.match(/^\/api\/admin\/users\/(\d+)(?:\/(sessions|lock))?$/);

      if (req.method === 'GET' && url.pathname === '/admin') return admin.handleAdminPage(req, res);
      if (req.method === 'GET' && url.pathname === '/api/admin/stats') return admin.handleAdminStats(req, res);
      if (req.method === 'GET' && url.pathname === '/api/admin/users') return admin.handleAdminUsers(req, res);
      if (req.method === 'GET' && url.pathname === '/api/admin/entries') return admin.handleAdminEntries(req, res);
      if (req.method === 'GET' && url.pathname === '/api/admin/mail') return admin.handleAdminMailSettings(req, res);
      if (req.method === 'PUT' && url.pathname === '/api/admin/mail') return admin.handleAdminSaveMailSettings(req, res);
      if (req.method === 'POST' && url.pathname === '/api/admin/mail/test') return admin.handleAdminTestMail(req, res);
      if (adminEntry && req.method === 'DELETE') return admin.handleAdminDeleteEntry(req, res, Number(adminEntry[1]));
      if (adminEntry && req.method === 'PATCH') return admin.handleAdminTogglePublic(req, res, Number(adminEntry[1]));
      if (adminUser && !adminUser[2] && req.method === 'DELETE') return admin.handleAdminDeleteUser(req, res, Number(adminUser[1]));
      if (adminUser && adminUser[2] === 'sessions' && req.method === 'DELETE') return admin.handleAdminClearSessions(req, res, Number(adminUser[1]));
      if (adminUser && adminUser[2] === 'lock' && req.method === 'PATCH') return admin.handleAdminLockUser(req, res, Number(adminUser[1]));
      if (req.method === 'POST' && url.pathname === '/api/admin/vacuum') return admin.handleAdminVacuum(req, res);

      if (req.method === 'POST' && url.pathname === '/api/register') return session.register(req, res);
      if (req.method === 'POST' && url.pathname === '/api/login') return session.login(req, res);
      if (req.method === 'POST' && url.pathname === '/api/password-reset/request') return session.requestPasswordReset(req, res);
      if (req.method === 'POST' && url.pathname === '/api/password-reset') return session.completePasswordReset(req, res);
      if (req.method === 'POST' && url.pathname === '/api/locale') return session.updateLocale(req, res);
      if (req.method === 'POST' && url.pathname === '/api/logout') return session.logout(req, res);
      if (req.method === 'GET' && url.pathname === '/api/me') return session.me(req, res);
      if (req.method === 'GET' && url.pathname === '/api/state') return session.state(req, res);
      if (req.method === 'GET' && url.pathname === '/api/events') return session.events(req, res);
      if (req.method === 'GET' && url.pathname === '/api/export') return session.exportArchive(req, res);

      if (req.method === 'GET' && url.pathname === '/api/profile') return profile.get(req, res);
      if (req.method === 'PATCH' && url.pathname === '/api/profile') return profile.update(req, res);
      if (req.method === 'POST' && url.pathname === '/api/profile/password') return profile.updatePassword(req, res);
      if (req.method === 'POST' && url.pathname === '/api/profile/avatar') return profile.updateAvatar(req, res);

      if (req.method === 'GET' && url.pathname === '/api/kids') return families.listKids(req, res);
      if (req.method === 'POST' && url.pathname === '/api/kids') return families.createKid(req, res);
      if (kid && req.method === 'DELETE') return families.deleteKid(req, res, Number(kid[1]));
      if (req.method === 'POST' && url.pathname === '/api/family/invites') return families.createInvite(req, res);
      if (invite && invite[2] === 'accept' && req.method === 'POST') return families.acceptInvite(req, res, Number(invite[1]));
      if (invite && !invite[2] && req.method === 'DELETE') return families.cancelInvite(req, res, Number(invite[1]));

      if (req.method === 'POST' && url.pathname === '/api/howlers') return entries.create(req, res);
      if (howlerShare && req.method === 'POST') return entries.share(req, res, Number(howlerShare[1]));
      if (howler && req.method === 'PUT') return entries.update(req, res, Number(howler[1]));
      if (howler && req.method === 'DELETE') return entries.remove(req, res, Number(howler[1]));
      if (req.method === 'GET' && url.pathname === '/api/feed') return send(res, 200, db.listPublicHowlers());
      if (publicHowler && req.method === 'GET') {
        const entry = db.getPublicHowler(Number(publicHowler[1]));
        return entry ? send(res, 200, entry) : send(res, 404, { error: 'Записът не е намерен.' });
      }
      if (sharedHowler && req.method === 'GET') {
        const entry = db.getSharedHowler(sharedHowler[1]);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        return entry ? send(res, 200, entry) : send(res, 404, { error: 'Записът не е намерен.' });
      }

      if (req.method === 'GET' && url.pathname === '/sitemap.xml') return handleSitemap(req, res);
      if (req.method === 'GET' && url.pathname === '/robots.txt') return handleRobots(req, res);
      if (req.method === 'GET' && publicPost) return handlePublicPost(req, res, Number(publicPost[1]));
      if (req.method === 'GET' && sharedPost) return handleSharedPost(req, res, sharedPost[1]);
      if (req.method === 'GET') {
        let pathname;
        try {
          pathname = decodeURIComponent(url.pathname);
        } catch {
          return send(res, 400, { error: 'Невалиден адрес.' });
        }
        return serveFile(req, res, pathname);
      }
      return send(res, 404, { error: 'Страницата не е намерена.' });
      })();
    } catch (error) {
      const status = Number(error.statusCode) || 500;
      if (status >= 500) console.error(error);
      if (!res.headersSent) send(res, status, { error: error.message || 'Грешка в сървъра.' });
    }
  };
}

module.exports = { createRequestHandler };
