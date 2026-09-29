const db = require('../db');
const { authenticate } = require('../auth');
const { localDateString } = require('../date-validation');
const { readBody, send, sendImageDataUrl } = require('../http');
const { validateHowler } = require('../howler-validation');
const { buildState } = require('../state');

function createEntryHandlers({ sseHub }) {
  async function list(req, res, url) {
    const session = await authenticate(req, res);
    if (!session) return;
    const result = db.listHowlersPage(session.user_id, {
      offset: url.searchParams.get('offset'),
      limit: url.searchParams.get('limit'),
      query: url.searchParams.get('q'),
    });
    send(res, 200, result);
  }

  async function get(req, res, id) {
    const session = await authenticate(req, res);
    if (!session) return;
    const entry = db.getHowler(session.user_id, id);
    send(res, entry ? 200 : 404, entry || { error: 'Записът не е намерен.' });
  }

  async function photo(req, res, id, index) {
    const session = await authenticate(req, res);
    if (!session) return;
    const dataUrl = db.getHowlerPhoto(session.user_id, id, index);
    if (!dataUrl || !sendImageDataUrl(
      res,
      dataUrl,
      'private, max-age=31536000, immutable',
      { Vary: 'Authorization' }
    )) {
      send(res, 404, { error: 'Снимката не е намерена.' });
    }
  }

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

  return { list, get, photo, create, update, remove, share };
}

module.exports = { createEntryHandlers };
