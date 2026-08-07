'use strict';

const db = require('../db');
const { PROTECTED_ADMIN_USERS } = require('../config');
const { send, isLocalhost } = require('../http');
const { serveFile } = require('../static');

function createAdminHandlers({ sseHub }) {
  function requireLocal(req, res) {
    if (isLocalhost(req)) return true;
    send(res, 403, { error: 'Забранен достъп.' });
    return false;
  }

  function handleAdminPage(req, res) {
    if (!isLocalhost(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Забранен достъп: администрацията е достъпна само от localhost');
      return;
    }
    serveFile(res, '/admin.html');
  }

  function handleAdminStats(req, res) {
    if (!requireLocal(req, res)) return;
    const stats = db.getAdminStats();
    const mem = process.memoryUsage();
    send(res, 200, { ...stats, uptime: Math.floor(process.uptime()), heapUsed: mem.heapUsed, rss: mem.rss });
  }

  function handleAdminUsers(req, res) {
    if (!requireLocal(req, res)) return;
    send(res, 200, db.listAdminUsers());
  }

  function handleAdminEntries(req, res) {
    if (!requireLocal(req, res)) return;
    send(res, 200, db.listAdminEntries(200, 0));
  }

  async function handleAdminDeleteEntry(req, res, id) {
    if (!requireLocal(req, res)) return;
    const userIds = db.adminDeleteEntry(id);
    if (!userIds) {
      send(res, 404, { error: 'Записът не е намерен.' });
      return;
    }
    if (userIds.length) sseHub.publishToAllClients();
    send(res, 200, { ok: true });
  }

  async function handleAdminTogglePublic(req, res, id) {
    if (!requireLocal(req, res)) return;
    const result = db.adminToggleEntryPublic(id);
    if (!result) {
      send(res, 404, { error: 'Записът не е намерен.' });
      return;
    }
    const { isPublic, userIds } = result;
    if (userIds.length) sseHub.publishToAllClients();
    send(res, 200, { isPublic });
  }

  async function handleAdminDeleteUser(req, res, id) {
    if (!requireLocal(req, res)) return;
    const user = db.getAdminUser(id);
    if (!user) { send(res, 404, { error: 'Потребителят не е намерен.' }); return; }
    if (PROTECTED_ADMIN_USERS.has(String(user.username || '').toLowerCase())) {
      send(res, 403, { error: 'Този администратор е защитен и не може да бъде изтрит.' });
      return;
    }
    db.adminDeleteUser(id);
    sseHub.closeClients(client => client.userId === id, { sessionExpired: true });
    sseHub.publishToAllClients();
    send(res, 200, { ok: true });
  }

  function handleAdminClearSessions(req, res, userId) {
    if (!requireLocal(req, res)) return;
    db.adminClearUserSessions(userId);
    sseHub.closeClients(client => client.userId === userId, { sessionExpired: true });
    send(res, 200, { ok: true });
  }

  async function handleAdminVacuum(req, res) {
    if (!requireLocal(req, res)) return;
    db.adminVacuum();
    send(res, 200, { ok: true });
  }

  return {
    handleAdminPage,
    handleAdminStats,
    handleAdminUsers,
    handleAdminEntries,
    handleAdminDeleteEntry,
    handleAdminTogglePublic,
    handleAdminDeleteUser,
    handleAdminClearSessions,
    handleAdminVacuum,
  };
}

module.exports = { createAdminHandlers };
