const db = require('../db');
const { authenticate } = require('../auth');
const { localDateString } = require('../date-validation');
const { readBody, send } = require('../http');
const { validateHowler } = require('../howler-validation');
const { buildState } = require('../state');

function createEntryHandlers({ sseHub }) {
  async function create(req, res) {
    const session = await authenticate(req, res);
    if (!session) return;
    const parsed = validateHowler(await readBody(req));
    if (parsed.error) {
      send(res, 400, { error: parsed.error, field: parsed.field });
      return;
    }
    const entry = db.createHowler(session.user_id, {
      ...parsed,
      happenedOn: parsed.happenedOn || localDateString(),
    });
    sseHub.publishToAllClients();
    send(res, 200, { ok: true, entry, state: buildState(session.user_id) });
  }

  async function update(req, res, id) {
    const session = await authenticate(req, res);
    if (!session) return;
    const parsed = validateHowler(await readBody(req));
    if (parsed.error) {
      send(res, 400, { error: parsed.error, field: parsed.field });
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

  async function remove(req, res, id) {
    const session = await authenticate(req, res);
    if (!session) return;
    if (!db.deleteHowler(session.user_id, id)) {
      send(res, 404, { error: 'Записът не е намерен.' });
      return;
    }
    sseHub.publishToAllClients();
    send(res, 200, { ok: true, state: buildState(session.user_id) });
  }

  async function share(req, res, id) {
    const session = await authenticate(req, res);
    if (!session) return;
    const path = db.getSharePath(session.user_id, id);
    if (!path) {
      send(res, 404, { error: 'Записът не е намерен.' });
      return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    send(res, 200, { path });
  }

  return { create, update, remove, share };
}

module.exports = { createEntryHandlers };
