const db = require('../db');
const { authenticate } = require('../auth');
const { readBody, send } = require('../http');

function createFamilyHandlers({ sseHub }) {
  async function listKids(req, res) {
    const session = await authenticate(req, res);
    if (session) send(res, 200, db.listKids(session.user_id));
  }

  async function createKid(req, res) {
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
    } catch (error) {
      send(res, 400, { error: error.message });
    }
  }

  async function deleteKid(req, res, id) {
    const session = await authenticate(req, res);
    if (!session) return;
    if (!db.deleteKid(session.user_id, id)) {
      send(res, 404, { error: 'Детето не е намерено.' });
      return;
    }
    sseHub.publishToUsers(db.getFamilyUserIds(session.user_id));
    send(res, 200, { ok: true });
  }

  async function createInvite(req, res) {
    const session = await authenticate(req, res);
    if (!session) return;
    const { username } = await readBody(req);
    try {
      const invite = db.createFamilyInvite(session.user_id, username);
      sseHub.publishToUsers([session.user_id, invite.inviteeUserId]);
      send(res, 200, { ok: true, inviteId: invite.id });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
  }

  async function acceptInvite(req, res, inviteId) {
    const session = await authenticate(req, res);
    if (!session) return;
    try {
      const result = db.acceptFamilyInvite(session.user_id, inviteId);
      sseHub.publishToUsers(result.memberUserIds);
      send(res, 200, { ok: true });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
  }

  async function cancelInvite(req, res, inviteId) {
    const session = await authenticate(req, res);
    if (!session) return;
    try {
      const result = db.cancelFamilyInvite(session.user_id, inviteId);
      sseHub.publishToUsers([result.inviterUserId, result.inviteeUserId]);
      send(res, 200, { ok: true });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
  }

  return { listKids, createKid, deleteKid, createInvite, acceptInvite, cancelInvite };
}

module.exports = { createFamilyHandlers };
