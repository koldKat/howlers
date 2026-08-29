const crypto = require('crypto');
const util = require('util');
const db = require('./connection');
const {
  createFamilyForUser,
  listFamilyInvites,
  listFamilyMembers,
} = require('./families');

const scrypt = util.promisify(crypto.scrypt);
const SESSION_TTL_DAYS = 7;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return { hash: hash.toString('hex'), salt };
}

async function verifyPassword(password, storedHash, salt) {
  const hash = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), hash);
}

async function createUser(username, password) {
  const { hash, salt } = await hashPassword(password);
  try {
    const result = db.prepare('INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)')
      .run(username, hash, salt);
    createFamilyForUser(result.lastInsertRowid);
    return { id: result.lastInsertRowid, username };
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      const conflict = new Error('Потребителското име вече е заето.');
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }
}

async function verifyUser(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;
  return await verifyPassword(password, user.password_hash, user.salt)
    ? { id: user.id, username: user.username }
    : null;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

function getSession(token) {
  const row = db.prepare(`
    SELECT s.token, s.user_id, u.username, u.locale, u.display_name
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?
  `).get(token) || null;
  if (row) db.prepare("UPDATE sessions SET last_active_at = strftime('%s', 'now') WHERE token = ?").run(token);
  return row;
}

function purgeExpiredSessions() {
  const cutoff = Math.floor(Date.now() / 1000) - SESSION_TTL_DAYS * 86400;
  return db.prepare('DELETE FROM sessions WHERE COALESCE(last_active_at, created_at) < ?').run(cutoff).changes;
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getViewer(userId) {
  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.locale, u.avatar, fm.family_id
    FROM users u JOIN family_members fm ON fm.user_id = u.id WHERE u.id = ?
  `).get(userId);
  return row ? {
    id: row.id,
    username: row.username,
    displayName: row.display_name || null,
    locale: 'bg',
    avatar: row.avatar || null,
    familyId: row.family_id,
  } : null;
}

function updateUserLocale(userId) {
  db.prepare("UPDATE users SET locale = 'bg' WHERE id = ?").run(userId);
}

function getProfile(userId) {
  const viewer = getViewer(userId);
  if (!viewer) return null;
  const invites = listFamilyInvites(userId);
  return {
    ...viewer,
    familyMembers: listFamilyMembers(userId),
    incomingInvites: invites.incoming,
    outgoingInvites: invites.outgoing,
  };
}

function updateProfile(userId, { displayName }) {
  const name = String(displayName || '').trim().slice(0, 60) || null;
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, userId);
  return name;
}

function updateAvatar(userId, avatar) {
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar || null, userId);
}

async function updatePassword(userId, currentPassword, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('Потребителят не е намерен.');
  if (!await verifyPassword(currentPassword, user.password_hash, user.salt)) {
    throw new Error('Текущата парола е грешна.');
  }
  const { hash, salt } = await hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, userId);
}

module.exports = {
  createUser,
  verifyUser,
  createSession,
  getSession,
  deleteSession,
  purgeExpiredSessions,
  getViewer,
  updateUserLocale,
  getProfile,
  updateProfile,
  updateAvatar,
  updatePassword,
};
