const db = require('../db');
const { authenticate } = require('../auth');
const { MAX_AVATAR_BYTES } = require('../config');
const { readBody, send } = require('../http');
const { validateRasterImageDataUrl } = require('../image-validation');

function createProfileHandlers({ sseHub }) {
  async function get(req, res) {
    const session = await authenticate(req, res);
    if (session) send(res, 200, db.getProfile(session.user_id));
  }

  async function update(req, res) {
    const session = await authenticate(req, res);
    if (!session) return;
    const { displayName, email } = await readBody(req);
    if (displayName !== undefined && displayName !== null && typeof displayName !== 'string') {
      send(res, 400, { error: 'Показваното име трябва да е текст.' });
      return;
    }
    if (String(displayName || '').trim().length > 60) {
      send(res, 400, { error: 'Показваното име трябва да е до 60 символа.' });
      return;
    }
    if (email !== undefined && email !== null && typeof email !== 'string') {
      send(res, 400, { error: 'Имейлът трябва да е текст.' });
      return;
    }
    const saved = db.updateProfile(session.user_id, { displayName, email });
    const profile = db.getProfile(session.user_id);
    sseHub.publishToUsers(db.getFamilyUserIds(session.user_id));
    send(res, 200, { ok: true, ...saved, profile });
  }

  async function updatePassword(req, res) {
    const session = await authenticate(req, res);
    if (!session) return;
    const { currentPassword, newPassword } = await readBody(req);
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
      send(res, 400, { error: 'Текущата и новата парола са задължителни.' });
      return;
    }
    if (newPassword.length < 6 || newPassword.length > 256) {
      send(res, 400, { error: 'Новата парола трябва да е между 6 и 256 символа.' });
      return;
    }
    try {
      await db.updatePassword(session.user_id, currentPassword, newPassword);
      send(res, 200, { ok: true });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
  }

  async function updateAvatar(req, res) {
    const session = await authenticate(req, res);
    if (!session) return;
    const { avatar } = await readBody(req);
    if (avatar !== null && avatar !== undefined && avatar !== '') {
      const error = validateRasterImageDataUrl(avatar, MAX_AVATAR_BYTES, '300 KB');
      if (error) {
        send(res, 400, { error });
        return;
      }
    }
    db.updateAvatar(session.user_id, avatar || null);
    sseHub.publishToUsers(db.getFamilyUserIds(session.user_id));
    send(res, 200, { ok: true, avatar: avatar || null });
  }

  return { get, update, updatePassword, updateAvatar };
}

module.exports = { createProfileHandlers };
