const crypto = require('crypto');
const util = require('util');
const db = require('./connection');
const {
  ACCOUNT_FAILURE_LIMIT,
  ACCOUNT_LOCK_SECONDS,
  PASSWORD_RESET_SECONDS,
  PROTECTED_ADMIN_USERS,
} = require('../config');
const {
  createFamilyForUser,
  listFamilyInvites,
  listFamilyMembers,
} = require('./families');

const scrypt = util.promisify(crypto.scrypt);
const SESSION_TTL_DAYS = 7;
const EMAIL_MAX_LENGTH = 254;
const PASSWORD_RESET_TOKEN_BYTES = 32;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return { hash: hash.toString('hex'), salt };
}

async function verifyPassword(password, storedHash, salt) {
  const hash = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), hash);
}

function normalizeEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return null;
  if (clean.length > EMAIL_MAX_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    const error = new Error('Въведи валиден имейл адрес или остави полето празно.');
    error.statusCode = 400;
    throw error;
  }
  return clean;
}

function isProtectedUsername(username) {
  return PROTECTED_ADMIN_USERS.has(String(username || '').trim().toLowerCase());
}

async function createUser(username, password, email) {
  const { hash, salt } = await hashPassword(password);
  const cleanEmail = normalizeEmail(email);
  try {
    const result = db.prepare('INSERT INTO users (username, email, password_hash, salt) VALUES (?, ?, ?, ?)')
      .run(username, cleanEmail, hash, salt);
    createFamilyForUser(result.lastInsertRowid);
    return { id: result.lastInsertRowid, username, email: cleanEmail };
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      const conflict = new Error(cleanEmail
        ? 'Потребителското име или имейлът вече се използват.'
        : 'Потребителското име вече е заето.');
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }
}

async function verifyUser(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user) return null;
  const now = Math.floor(Date.now() / 1000);
  const protectedUser = isProtectedUsername(user.username);
  if (!protectedUser && Number(user.locked_until) === -1) {
    return { locked: true, manual: true };
  }
  if (!protectedUser && Number(user.locked_until) > now) {
    return { locked: true, manual: false, minutesLeft: Math.ceil((user.locked_until - now) / 60) };
  }
  if (!protectedUser && user.locked_until && Number(user.locked_until) <= now) {
    db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
    user.failed_login_attempts = 0;
  }
  if (await verifyPassword(password, user.password_hash, user.salt)) {
    if (user.failed_login_attempts || user.locked_until) {
      db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
    }
    return { id: user.id, username: user.username };
  }
  if (!protectedUser) {
    const attempts = Number(user.failed_login_attempts || 0) + 1;
    if (attempts >= ACCOUNT_FAILURE_LIMIT) {
      db.prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?')
        .run(attempts, now + ACCOUNT_LOCK_SECONDS, user.id);
      return { locked: true, manual: false, minutesLeft: ACCOUNT_LOCK_SECONDS / 60 };
    }
    db.prepare('UPDATE users SET failed_login_attempts = ? WHERE id = ?').run(attempts, user.id);
  }
  return null;
}

function passwordResetTokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function preparePasswordReset(identity) {
  const value = String(identity || '').trim();
  if (!value) return null;
  const user = db.prepare(`SELECT id, username, email FROM users
    WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE`).get(value, value);
  if (!user?.email) return null;
  return {
    userId: user.id,
    username: user.username,
    email: user.email,
    token: crypto.randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString('base64url'),
    expiresAt: Math.floor(Date.now() / 1000) + PASSWORD_RESET_SECONDS,
  };
}

function storePasswordReset(reset) {
  if (!reset?.userId || !reset.token || !reset.expiresAt) return null;
  db.transaction(() => {
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at <= ?')
      .run(reset.userId, Math.floor(Date.now() / 1000));
    db.prepare('INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(passwordResetTokenHash(reset.token), reset.userId, reset.expiresAt);
  })();
  return reset;
}

async function resetPassword(token, password) {
  const cleanPassword = typeof password === 'string' ? password : '';
  if (cleanPassword.length < 6 || cleanPassword.length > 256) {
    const error = new Error('Паролата трябва да е между 6 и 256 символа.');
    error.statusCode = 400;
    throw error;
  }
  const now = Math.floor(Date.now() / 1000);
  const tokenHash = passwordResetTokenHash(token);
  const next = await hashPassword(cleanPassword);
  db.transaction(() => {
    const reset = db.prepare(`SELECT user_id FROM password_reset_tokens
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`).get(tokenHash, now);
    if (!reset) {
      const error = new Error('Връзката за нова парола е невалидна или е изтекла.');
      error.statusCode = 400;
      throw error;
    }
    db.prepare(`UPDATE users SET password_hash = ?, salt = ?, failed_login_attempts = 0,
      locked_until = CASE WHEN locked_until = -1 THEN -1 ELSE NULL END WHERE id = ?`)
      .run(next.hash, next.salt, reset.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id);
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?').run(now, tokenHash);
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND token_hash <> ?')
      .run(reset.user_id, tokenHash);
  })();
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
    SELECT u.id, u.username, u.email, u.display_name, u.locale, u.avatar, fm.family_id
    FROM users u JOIN family_members fm ON fm.user_id = u.id WHERE u.id = ?
  `).get(userId);
  return row ? {
    id: row.id,
    username: row.username,
    email: row.email || '',
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

function updateProfile(userId, { displayName, email }) {
  const current = db.prepare('SELECT display_name, email FROM users WHERE id = ?').get(userId);
  if (!current) throw new Error('Потребителят не е намерен.');
  const name = displayName === undefined
    ? current.display_name
    : String(displayName || '').trim().slice(0, 60) || null;
  const cleanEmail = email === undefined ? current.email : normalizeEmail(email);
  try {
    db.prepare('UPDATE users SET display_name = ?, email = ? WHERE id = ?').run(name, cleanEmail, userId);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      const conflict = new Error('Този имейл вече се използва от друг профил.');
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }
  return { displayName: name, email: cleanEmail || '' };
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
  normalizeEmail,
  isProtectedUsername,
  preparePasswordReset,
  storePasswordReset,
  resetPassword,
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
