const db = require('./connection');
const { childNamesFromRow } = require('../child-names');
const { listFamilyUserIds } = require('./families');

function getAdminStats() {
  const pageCount = Number(db.prepare('PRAGMA page_count').get().page_count || 0);
  const pageSize = Number(db.prepare('PRAGMA page_size').get().page_size || 0);
  const scalar = sql => Number(db.prepare(sql).get().n || 0);
  const groups = field => db.prepare(`SELECT ${field} AS label, COUNT(*) AS total
    FROM howlers GROUP BY ${field} ORDER BY total DESC`).all()
    .map(row => ({ label: row.label, total: Number(row.total) }));
  return {
    dbSize: pageCount * pageSize,
    totalUsers: scalar('SELECT COUNT(*) AS n FROM users'),
    totalEntries: scalar('SELECT COUNT(*) AS n FROM howlers'),
    totalPublic: scalar('SELECT COUNT(*) AS n FROM howlers WHERE is_public = 1'),
    totalSessions: scalar('SELECT COUNT(*) AS n FROM sessions'),
    totalFavorites: scalar('SELECT COUNT(*) AS n FROM howlers WHERE is_favorite = 1'),
    totalKids: scalar('SELECT COUNT(*) AS n FROM kids'),
    categories: groups('category'),
    moods: groups('mood'),
  };
}

function listAdminEntries(limit = 100, offset = 0) {
  return db.prepare(`SELECT h.id, h.title, h.child_name, h.child_names_json, h.category, h.mood,
    h.happened_on, h.is_public, h.is_favorite, h.created_at, h.updated_at,
    u.username, u.id AS user_id FROM howlers h JOIN users u ON u.id = h.user_id
    ORDER BY h.updated_at DESC LIMIT ? OFFSET ?`).all(limit, offset).map(row => {
    const childNames = childNamesFromRow(row);
    return {
      id: row.id, title: row.title, childName: childNames.join(', '), childNames,
      category: row.category, mood: row.mood, happenedOn: row.happened_on,
      isPublic: row.is_public === 1, isFavorite: row.is_favorite === 1,
      createdAt: Number(row.created_at || 0), updatedAt: Number(row.updated_at || 0),
      username: row.username, userId: row.user_id,
    };
  });
}

function adminDeleteEntry(id) {
  const row = db.prepare('SELECT family_id FROM howlers WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare('DELETE FROM howlers WHERE id = ?').run(id);
  return listFamilyUserIds(row.family_id);
}

function adminToggleEntryPublic(id) {
  db.prepare("UPDATE howlers SET is_public = 1 - is_public, updated_at = strftime('%s','now') WHERE id = ?").run(id);
  const row = db.prepare('SELECT is_public, family_id FROM howlers WHERE id = ?').get(id);
  return row ? { isPublic: row.is_public === 1, userIds: listFamilyUserIds(row.family_id) } : null;
}

function adminDeleteUser(id) { db.prepare('DELETE FROM users WHERE id = ?').run(id); }

function getAdminUser(id) {
  const row = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  return row ? { id: row.id, username: row.username } : null;
}

function adminClearUserSessions(userId) { db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); }

function adminSetUserLocked(userId, locked) {
  const user = getAdminUser(userId);
  if (!user) return null;
  if (['slanchoff', 'koldkat'].includes(String(user.username || '').toLowerCase())) {
    const error = new Error('Този администратор е защитен и не може да бъде заключен.');
    error.statusCode = 403;
    throw error;
  }
  const shouldLock = Boolean(locked);
  db.transaction(() => {
    db.prepare('UPDATE users SET locked_until = ?, failed_login_attempts = 0 WHERE id = ?')
      .run(shouldLock ? -1 : null, user.id);
    if (shouldLock) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  })();
  return { id: user.id, username: user.username, locked: shouldLock };
}

function adminVacuum() {
  db.exec('VACUUM');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
}

function createBackup(targetPath) {
  const escapedPath = String(targetPath).replace(/'/g, "''");
  db.exec('PRAGMA wal_checkpoint(PASSIVE)');
  db.exec(`VACUUM INTO '${escapedPath}'`);
}

function listAdminUsers() {
  return db.prepare(`SELECT u.id, u.username, u.locale, u.created_at, u.locked_until,
    u.failed_login_attempts, COUNT(h.id) AS entry_count,
    SUM(CASE WHEN h.is_public = 1 THEN 1 ELSE 0 END) AS public_count,
    SUM(CASE WHEN h.is_favorite = 1 THEN 1 ELSE 0 END) AS favorite_count,
    MAX(h.updated_at) AS last_entry_at,
    (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS session_count
    FROM users u LEFT JOIN howlers h ON h.user_id = u.id GROUP BY u.id ORDER BY u.created_at DESC`)
    .all().map(row => ({
      id: row.id, username: row.username, locale: row.locale,
      createdAt: row.created_at ? Number(row.created_at) : null,
      entryCount: Number(row.entry_count || 0), publicCount: Number(row.public_count || 0),
      favoriteCount: Number(row.favorite_count || 0),
      lastEntryAt: row.last_entry_at ? Number(row.last_entry_at) : null,
      sessionCount: Number(row.session_count || 0),
      isProtected: ['slanchoff', 'koldkat'].includes(String(row.username || '').toLowerCase()),
      lockedUntil: row.locked_until == null ? null : Number(row.locked_until),
      failedLoginAttempts: Number(row.failed_login_attempts || 0),
      isLocked: Number(row.locked_until) === -1 || Number(row.locked_until) > Math.floor(Date.now() / 1000),
      isManualLock: Number(row.locked_until) === -1,
    }));
}

module.exports = {
  getAdminStats, listAdminUsers, listAdminEntries, adminDeleteEntry, adminToggleEntryPublic,
  adminDeleteUser, getAdminUser, adminClearUserSessions, adminSetUserLocked,
  adminVacuum, createBackup,
};
