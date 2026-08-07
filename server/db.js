const path = require('path');
const crypto = require('crypto');
const util = require('util');
const Database = require('better-sqlite3');

const scrypt = util.promisify(crypto.scrypt);
const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, '..', 'database.sqlite');
const db = new Database(databasePath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS families (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS family_members (
    family_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS family_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id INTEGER NOT NULL,
    inviter_user_id INTEGER NOT NULL,
    invitee_user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    responded_at INTEGER,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
    FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (invitee_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS kids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    dob TEXT NOT NULL DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS howlers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    child_name TEXT NOT NULL,
    title TEXT NOT NULL,
    quote TEXT NOT NULL DEFAULT '',
    story TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'said',
    happened_on TEXT NOT NULL DEFAULT '',
    age_note TEXT NOT NULL DEFAULT '',
    mood TEXT NOT NULL DEFAULT 'golden',
    tags_json TEXT NOT NULL DEFAULT '[]',
    is_favorite INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_family_members_user ON family_members(user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_family_members_pair ON family_members(family_id, user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_family_invites_pending ON family_invites(family_id, invitee_user_id) WHERE status = 'pending';
`);

function addColumnIfMissing(tableName, columnName, sql) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!cols.some(col => col.name === columnName)) db.exec(sql);
}

addColumnIfMissing('howlers', 'is_public', 'ALTER TABLE howlers ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('howlers', 'family_id', 'ALTER TABLE howlers ADD COLUMN family_id INTEGER');
addColumnIfMissing('howlers', 'photo', "ALTER TABLE howlers ADD COLUMN photo TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('users', 'locale', "ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'bg'");
addColumnIfMissing('users', 'display_name', 'ALTER TABLE users ADD COLUMN display_name TEXT');
addColumnIfMissing('users', 'avatar', 'ALTER TABLE users ADD COLUMN avatar TEXT');
addColumnIfMissing('sessions', 'last_active_at', 'ALTER TABLE sessions ADD COLUMN last_active_at INTEGER');
addColumnIfMissing('kids', 'family_id', 'ALTER TABLE kids ADD COLUMN family_id INTEGER');

const bootstrapFamilies = db.transaction(() => {
  const users = db.prepare('SELECT id FROM users ORDER BY id ASC').all();
  const selectMember = db.prepare('SELECT family_id FROM family_members WHERE user_id = ?');
  const insertFamily = db.prepare('INSERT INTO families DEFAULT VALUES');
  const insertMember = db.prepare('INSERT INTO family_members (family_id, user_id) VALUES (?, ?)');
  const backfillHowlers = db.prepare(`
    UPDATE howlers
    SET family_id = (
      SELECT fm.family_id
      FROM family_members fm
      WHERE fm.user_id = howlers.user_id
    )
    WHERE family_id IS NULL
  `);
  const backfillKids = db.prepare(`
    UPDATE kids
    SET family_id = (
      SELECT fm.family_id
      FROM family_members fm
      WHERE fm.user_id = kids.user_id
    )
    WHERE family_id IS NULL
  `);

  for (const user of users) {
    if (selectMember.get(user.id)) continue;
    const family = insertFamily.run();
    insertMember.run(family.lastInsertRowid, user.id);
  }

  backfillHowlers.run();
  backfillKids.run();
});

bootstrapFamilies();
db.prepare("UPDATE users SET locale = 'bg' WHERE locale IS NULL OR locale != 'bg'").run();

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return { hash: hash.toString('hex'), salt };
}

async function verifyPassword(password, storedHash, salt) {
  const hash = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), hash);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createFamilyForUser(userId) {
  const existing = db.prepare('SELECT family_id FROM family_members WHERE user_id = ?').get(userId);
  if (existing) return existing.family_id;
  const family = db.prepare('INSERT INTO families DEFAULT VALUES').run();
  db.prepare('INSERT INTO family_members (family_id, user_id) VALUES (?, ?)').run(family.lastInsertRowid, userId);
  db.prepare('UPDATE howlers SET family_id = ? WHERE user_id = ? AND family_id IS NULL').run(family.lastInsertRowid, userId);
  db.prepare('UPDATE kids SET family_id = ? WHERE user_id = ? AND family_id IS NULL').run(family.lastInsertRowid, userId);
  return family.lastInsertRowid;
}

function getFamilyIdForUser(userId) {
  const row = db.prepare('SELECT family_id FROM family_members WHERE user_id = ?').get(userId);
  return row ? row.family_id : createFamilyForUser(userId);
}

function listFamilyUserIds(familyId) {
  return db.prepare('SELECT user_id FROM family_members WHERE family_id = ? ORDER BY user_id ASC')
    .all(familyId)
    .map(row => row.user_id);
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(list.map(tag => String(tag).trim()).filter(Boolean))].slice(0, 8);
}

function mapEntry(row) {
  const content = [row.quote, row.story].map(value => String(value || '').trim()).filter(Boolean).join('\n\n');
  return {
    id: row.id,
    childName: row.child_name,
    title: row.title,
    quote: row.quote,
    story: row.story,
    content,
    photo: row.photo || '',
    category: row.category,
    happenedOn: row.happened_on,
    ageNote: row.age_note,
    mood: row.mood,
    tags: (() => {
      try {
        return normalizeTags(JSON.parse(row.tags_json || '[]'));
      } catch {
        return [];
      }
    })(),
    isPublic: Boolean(row.is_public),
    isFavorite: Boolean(row.is_favorite),
    createdAt: row.created_at ? Number(row.created_at) : null,
    updatedAt: row.updated_at ? Number(row.updated_at) : null,
  };
}

function mapFamilyMember(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || null,
    avatar: row.avatar || null,
    joinedAt: row.joined_at ? Number(row.joined_at) : null,
  };
}

function mapInvite(row, direction) {
  return {
    id: row.id,
    familyId: row.family_id,
    createdAt: row.created_at ? Number(row.created_at) : null,
    respondedAt: row.responded_at ? Number(row.responded_at) : null,
    status: row.status,
    inviter: direction === 'incoming' ? {
      id: row.inviter_id,
      username: row.inviter_username,
      displayName: row.inviter_display_name || null,
      avatar: row.inviter_avatar || null,
    } : undefined,
    invitee: direction === 'outgoing' ? {
      id: row.invitee_id,
      username: row.invitee_username,
      displayName: row.invitee_display_name || null,
      avatar: row.invitee_avatar || null,
    } : undefined,
  };
}

function getViewer(userId) {
  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.locale, u.avatar, fm.family_id
    FROM users u
    JOIN family_members fm ON fm.user_id = u.id
    WHERE u.id = ?
  `).get(userId);
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || null,
    locale: 'bg',
    avatar: row.avatar || null,
    familyId: row.family_id,
  };
}

function listFamilyMembers(userId) {
  const familyId = getFamilyIdForUser(userId);
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar, fm.created_at AS joined_at
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    WHERE fm.family_id = ?
    ORDER BY fm.created_at ASC, u.id ASC
  `).all(familyId).map(mapFamilyMember);
}

function listFamilyInvites(userId) {
  const familyId = getFamilyIdForUser(userId);
  const incoming = db.prepare(`
    SELECT fi.id, fi.family_id, fi.status, fi.created_at, fi.responded_at,
           inviter.id AS inviter_id,
           inviter.username AS inviter_username,
           inviter.display_name AS inviter_display_name,
           inviter.avatar AS inviter_avatar
    FROM family_invites fi
    JOIN users inviter ON inviter.id = fi.inviter_user_id
    WHERE fi.invitee_user_id = ? AND fi.status = 'pending'
    ORDER BY fi.created_at DESC, fi.id DESC
  `).all(userId).map(row => mapInvite(row, 'incoming'));

  const outgoing = db.prepare(`
    SELECT fi.id, fi.family_id, fi.status, fi.created_at, fi.responded_at,
           invitee.id AS invitee_id,
           invitee.username AS invitee_username,
           invitee.display_name AS invitee_display_name,
           invitee.avatar AS invitee_avatar
    FROM family_invites fi
    JOIN users invitee ON invitee.id = fi.invitee_user_id
    WHERE fi.family_id = ? AND fi.status = 'pending'
    ORDER BY fi.created_at DESC, fi.id DESC
  `).all(familyId).map(row => mapInvite(row, 'outgoing'));

  return { incoming, outgoing };
}

function getInviteAttention(userId) {
  const incoming = listFamilyInvites(userId).incoming;
  return {
    pendingInviteCount: incoming.length,
    pendingInviteSenders: incoming.slice(0, 2).map(invite => invite.inviter),
  };
}

async function createUser(username, password) {
  const { hash, salt } = await hashPassword(password);
  try {
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)'
    ).run(username, hash, salt);
    createFamilyForUser(result.lastInsertRowid);
    return { id: result.lastInsertRowid, username };
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new Error('Потребителското име вече е заето.');
    throw error;
  }
}

async function verifyUser(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;
  const ok = await verifyPassword(password, user.password_hash, user.salt);
  return ok ? { id: user.id, username: user.username } : null;
}

function createSession(userId) {
  const token = generateToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

function getSession(token) {
  const row = db.prepare(`
    SELECT s.token, s.user_id, u.username, u.locale, u.display_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token) || null;
  if (row) {
    db.prepare('UPDATE sessions SET last_active_at = strftime(\'%s\', \'now\') WHERE token = ?').run(token);
  }
  return row;
}

const SESSION_TTL_DAYS = 7;
function purgeExpiredSessions() {
  const cutoff = Math.floor(Date.now() / 1000) - SESSION_TTL_DAYS * 86400;
  const { changes } = db.prepare(
    'DELETE FROM sessions WHERE COALESCE(last_active_at, created_at) < ?'
  ).run(cutoff);
  return changes;
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function listHowlers(userId) {
  const familyId = getFamilyIdForUser(userId);
  return db.prepare(`
    SELECT *
    FROM howlers
    WHERE family_id = ?
    ORDER BY COALESCE(NULLIF(happened_on, ''), '') DESC, updated_at DESC, id DESC
  `).all(familyId).map(mapEntry);
}

function getHowler(userId, howlerId) {
  const familyId = getFamilyIdForUser(userId);
  const row = db.prepare('SELECT * FROM howlers WHERE family_id = ? AND id = ?').get(familyId, howlerId);
  return row ? mapEntry(row) : null;
}

function createHowler(userId, input) {
  const familyId = getFamilyIdForUser(userId);
  const tags = normalizeTags(input.tags);
  const result = db.prepare(`
    INSERT INTO howlers (
      user_id, family_id, child_name, title, quote, story, photo, category, happened_on, age_note, mood, tags_json, is_favorite, is_public, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
  `).run(
    userId,
    familyId,
    input.childName,
    input.title,
    input.quote,
    input.story,
    input.photo,
    input.category,
    input.happenedOn,
    input.ageNote,
    input.mood,
    JSON.stringify(tags),
    input.isFavorite ? 1 : 0,
    input.isPublic ? 1 : 0,
  );
  return getHowler(userId, result.lastInsertRowid);
}

function updateHowler(userId, howlerId, input) {
  const familyId = getFamilyIdForUser(userId);
  const tags = normalizeTags(input.tags);
  const result = db.prepare(`
    UPDATE howlers
    SET child_name = ?, title = ?, quote = ?, story = ?, photo = ?, category = ?, happened_on = ?,
        age_note = ?, mood = ?, tags_json = ?, is_favorite = ?, is_public = ?, updated_at = strftime('%s', 'now')
    WHERE family_id = ? AND id = ?
  `).run(
    input.childName,
    input.title,
    input.quote,
    input.story,
    input.photo,
    input.category,
    input.happenedOn,
    input.ageNote,
    input.mood,
    JSON.stringify(tags),
    input.isFavorite ? 1 : 0,
    input.isPublic ? 1 : 0,
    familyId,
    howlerId,
  );
  return result.changes ? getHowler(userId, howlerId) : null;
}

function listPublicHowlers(limit) {
  return db.prepare(`
    SELECT *
    FROM howlers
    WHERE is_public = 1
    ORDER BY COALESCE(NULLIF(happened_on, ''), '') DESC, updated_at DESC, id DESC
    LIMIT ?
  `).all(limit || 60).map(row => ({
    ...mapEntry(row),
    tags: [],
  }));
}

function getPublicHowler(id) {
  const row = db.prepare('SELECT * FROM howlers WHERE id = ? AND is_public = 1').get(id);
  if (!row) return null;
  return {
    ...mapEntry(row),
    tags: [],
  };
}

function deleteHowler(userId, howlerId) {
  const familyId = getFamilyIdForUser(userId);
  const result = db.prepare('DELETE FROM howlers WHERE family_id = ? AND id = ?').run(familyId, howlerId);
  return result.changes > 0;
}

function getSummary(userId) {
  const familyId = getFamilyIdForUser(userId);
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) AS favorites,
      COUNT(DISTINCT child_name) AS kids,
      MIN(created_at) AS first_created_at,
      MAX(updated_at) AS last_updated_at
    FROM howlers
    WHERE family_id = ?
  `).get(familyId);

  const categoryRows = db.prepare(`
    SELECT category, COUNT(*) AS total
    FROM howlers
    WHERE family_id = ?
    GROUP BY category
    ORDER BY total DESC, category ASC
  `).all(familyId);

  const kids = db.prepare(`
    SELECT child_name AS childName, COUNT(*) AS total
    FROM howlers
    WHERE family_id = ?
    GROUP BY child_name
    ORDER BY total DESC, child_name ASC
  `).all(familyId);

  const recent = db.prepare(`
    SELECT *
    FROM howlers
    WHERE family_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 6
  `).all(familyId).map(mapEntry);

  return {
    total: Number(totals.total || 0),
    favorites: Number(totals.favorites || 0),
    kids: Number(totals.kids || 0),
    firstCreatedAt: totals.first_created_at ? Number(totals.first_created_at) : null,
    lastUpdatedAt: totals.last_updated_at ? Number(totals.last_updated_at) : null,
    categories: categoryRows.map(row => ({ label: row.category, total: Number(row.total || 0) })),
    kidsBreakdown: kids.map(row => ({ childName: row.childName, total: Number(row.total || 0) })),
    recent,
  };
}

function updateUserLocale(userId, locale) {
  db.prepare("UPDATE users SET locale = 'bg' WHERE id = ?").run(userId);
}

function getProfile(userId) {
  const viewer = getViewer(userId);
  if (!viewer) return null;
  const invites = listFamilyInvites(userId);
  return {
    id: viewer.id,
    username: viewer.username,
    displayName: viewer.displayName,
    locale: viewer.locale,
    avatar: viewer.avatar,
    familyId: viewer.familyId,
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
  const ok = await verifyPassword(currentPassword, user.password_hash, user.salt);
  if (!ok) throw new Error('Текущата парола е грешна.');
  const { hash, salt } = await hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, userId);
}

function listKids(userId) {
  const familyId = getFamilyIdForUser(userId);
  return db.prepare(
    'SELECT id, name, dob FROM kids WHERE family_id = ? ORDER BY created_at ASC, id ASC'
  ).all(familyId);
}

function createKid(userId, { name, dob }) {
  const familyId = getFamilyIdForUser(userId);
  const cleanName = String(name || '').trim().slice(0, 60);
  if (!cleanName) throw new Error('Името е задължително.');
  const cleanDob = /^\d{4}-\d{2}-\d{2}$/.test(dob || '') ? dob : '';
  const result = db.prepare(
    'INSERT INTO kids (user_id, family_id, name, dob) VALUES (?, ?, ?, ?)'
  ).run(userId, familyId, cleanName, cleanDob);
  return { id: result.lastInsertRowid, name: cleanName, dob: cleanDob };
}

function deleteKid(userId, kidId) {
  const familyId = getFamilyIdForUser(userId);
  const result = db.prepare('DELETE FROM kids WHERE family_id = ? AND id = ?').run(familyId, kidId);
  return result.changes > 0;
}

function createFamilyInvite(inviterUserId, inviteeUsername) {
  const cleanUsername = String(inviteeUsername || '').trim();
  if (!cleanUsername) throw new Error('Потребителското име е задължително.');

  const invitee = db.prepare(
    'SELECT id, username, display_name, avatar FROM users WHERE username = ?'
  ).get(cleanUsername);
  if (!invitee) throw new Error('Потребителят не е намерен.');
  if (invitee.id === inviterUserId) throw new Error('Вече си част от този семеен архив.');

  const familyId = getFamilyIdForUser(inviterUserId);
  const inviteeFamilyId = getFamilyIdForUser(invitee.id);
  if (inviteeFamilyId === familyId) throw new Error('Този родител вече е в семейния ти архив.');

  const existing = db.prepare(`
    SELECT id
    FROM family_invites
    WHERE family_id = ? AND invitee_user_id = ? AND status = 'pending'
  `).get(familyId, invitee.id);
  if (existing) throw new Error('Вече има чакаща покана към този потребител.');

  const result = db.prepare(`
    INSERT INTO family_invites (family_id, inviter_user_id, invitee_user_id)
    VALUES (?, ?, ?)
  `).run(familyId, inviterUserId, invitee.id);

  return {
    id: result.lastInsertRowid,
    inviteeUserId: invitee.id,
    familyId,
  };
}

const acceptFamilyInviteTx = db.transaction((inviteeUserId, inviteId) => {
  const invite = db.prepare(`
    SELECT id, family_id, inviter_user_id, invitee_user_id, status
    FROM family_invites
    WHERE id = ? AND invitee_user_id = ?
  `).get(inviteId, inviteeUserId);

  if (!invite || invite.status !== 'pending') throw new Error('Поканата не е намерена.');

  const targetFamilyId = invite.family_id;
  const sourceFamilyId = getFamilyIdForUser(inviteeUserId);

  db.prepare(`
    UPDATE family_invites
    SET status = 'accepted', responded_at = strftime('%s', 'now')
    WHERE id = ?
  `).run(inviteId);

  if (sourceFamilyId !== targetFamilyId) {
    db.prepare('UPDATE howlers SET family_id = ? WHERE family_id = ?').run(targetFamilyId, sourceFamilyId);
    db.prepare('UPDATE kids SET family_id = ? WHERE family_id = ?').run(targetFamilyId, sourceFamilyId);
    db.prepare('UPDATE family_members SET family_id = ? WHERE family_id = ?').run(targetFamilyId, sourceFamilyId);
    db.prepare(`
      UPDATE family_invites
      SET status = 'cancelled', responded_at = strftime('%s', 'now')
      WHERE family_id = ?
        AND status = 'pending'
        AND invitee_user_id IN (
          SELECT invitee_user_id
          FROM family_invites
          WHERE family_id = ?
            AND status = 'pending'
        )
    `).run(sourceFamilyId, targetFamilyId);
    db.prepare(`
      UPDATE family_invites
      SET family_id = ?
      WHERE family_id = ? AND status = 'pending'
    `).run(targetFamilyId, sourceFamilyId);
    db.prepare('DELETE FROM families WHERE id = ?').run(sourceFamilyId);
  }

  db.prepare(`
    UPDATE family_invites
    SET status = 'cancelled', responded_at = strftime('%s', 'now')
    WHERE id != ?
      AND status = 'pending'
      AND invitee_user_id IN (
        SELECT user_id
        FROM family_members
        WHERE family_id = ?
      )
  `).run(inviteId, targetFamilyId);

  return {
    familyId: targetFamilyId,
    inviterUserId: invite.inviter_user_id,
    inviteeUserId,
    memberUserIds: listFamilyUserIds(targetFamilyId),
  };
});

function acceptFamilyInvite(inviteeUserId, inviteId) {
  return acceptFamilyInviteTx(inviteeUserId, inviteId);
}

function cancelFamilyInvite(userId, inviteId) {
  const familyId = getFamilyIdForUser(userId);
  const invite = db.prepare(`
    SELECT id, family_id, inviter_user_id, invitee_user_id, status
    FROM family_invites
    WHERE id = ?
  `).get(inviteId);

  if (!invite || invite.status !== 'pending') throw new Error('Поканата не е намерена.');
  if (invite.invitee_user_id !== userId && invite.family_id !== familyId) throw new Error('Поканата не е намерена.');

  db.prepare(`
    UPDATE family_invites
    SET status = 'cancelled', responded_at = strftime('%s', 'now')
    WHERE id = ?
  `).run(inviteId);

  return {
    familyId: invite.family_id,
    inviterUserId: invite.inviter_user_id,
    inviteeUserId: invite.invitee_user_id,
  };
}

function getFamilyUserIds(userId) {
  return listFamilyUserIds(getFamilyIdForUser(userId));
}

function getAdminStats() {
  const pageCount = Number(db.prepare('PRAGMA page_count').get().page_count || 0);
  const pageSize = Number(db.prepare('PRAGMA page_size').get().page_size || 0);
  const dbSize = pageCount * pageSize;

  const totalUsers = Number(db.prepare('SELECT COUNT(*) AS n FROM users').get().n || 0);
  const totalEntries = Number(db.prepare('SELECT COUNT(*) AS n FROM howlers').get().n || 0);
  const totalPublic = Number(db.prepare('SELECT COUNT(*) AS n FROM howlers WHERE is_public = 1').get().n || 0);
  const totalSessions = Number(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n || 0);
  const totalFavorites = Number(db.prepare('SELECT COUNT(*) AS n FROM howlers WHERE is_favorite = 1').get().n || 0);
  const totalKids = Number(db.prepare('SELECT COUNT(*) AS n FROM kids').get().n || 0);

  const categories = db.prepare(`
    SELECT category AS label, COUNT(*) AS total
    FROM howlers GROUP BY category ORDER BY total DESC
  `).all().map(row => ({ label: row.label, total: Number(row.total) }));

  const moods = db.prepare(`
    SELECT mood AS label, COUNT(*) AS total
    FROM howlers GROUP BY mood ORDER BY total DESC
  `).all().map(row => ({ label: row.label, total: Number(row.total) }));

  return { dbSize, totalUsers, totalEntries, totalPublic, totalSessions, totalFavorites, totalKids, categories, moods };
}

function listAdminEntries(limit = 100, offset = 0) {
  return db.prepare(`
    SELECT h.id, h.title, h.child_name, h.category, h.mood, h.happened_on,
           h.is_public, h.is_favorite, h.created_at, h.updated_at,
           u.username, u.id AS user_id
    FROM howlers h
    JOIN users u ON u.id = h.user_id
    ORDER BY h.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset).map(row => ({
    id: row.id,
    title: row.title,
    childName: row.child_name,
    category: row.category,
    mood: row.mood,
    happenedOn: row.happened_on,
    isPublic: row.is_public === 1,
    isFavorite: row.is_favorite === 1,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    username: row.username,
    userId: row.user_id,
  }));
}

function adminDeleteEntry(id) {
  const row = db.prepare('SELECT family_id FROM howlers WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare('DELETE FROM howlers WHERE id = ?').run(id);
  return listFamilyUserIds(row.family_id);
}

function adminToggleEntryPublic(id) {
  db.prepare('UPDATE howlers SET is_public = 1 - is_public, updated_at = strftime(\'%s\',\'now\') WHERE id = ?').run(id);
  const row = db.prepare('SELECT is_public, family_id FROM howlers WHERE id = ?').get(id);
  if (!row) return null;
  return { isPublic: row.is_public === 1, userIds: listFamilyUserIds(row.family_id) };
}

function adminDeleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

function getAdminUser(id) {
  const row = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  return row ? { id: row.id, username: row.username } : null;
}

function adminClearUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
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
  return db.prepare(`
    SELECT
      u.id,
      u.username,
      u.locale,
      u.created_at,
      COUNT(h.id)                                         AS entry_count,
      SUM(CASE WHEN h.is_public = 1 THEN 1 ELSE 0 END)   AS public_count,
      SUM(CASE WHEN h.is_favorite = 1 THEN 1 ELSE 0 END) AS favorite_count,
      MAX(h.updated_at)                                   AS last_entry_at,
      (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS session_count
    FROM users u
    LEFT JOIN howlers h ON h.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all().map(row => ({
    id: row.id,
    username: row.username,
    locale: row.locale,
    createdAt: row.created_at ? Number(row.created_at) : null,
    entryCount: Number(row.entry_count || 0),
    publicCount: Number(row.public_count || 0),
    favoriteCount: Number(row.favorite_count || 0),
    lastEntryAt: row.last_entry_at ? Number(row.last_entry_at) : null,
    sessionCount: Number(row.session_count || 0),
    isProtected: ['slanchoff', 'koldkat'].includes(String(row.username || '').toLowerCase()),
  }));
}

module.exports = {
  createUser,
  verifyUser,
  createSession,
  getSession,
  deleteSession,
  purgeExpiredSessions,
  getViewer,
  listHowlers,
  createHowler,
  updateHowler,
  deleteHowler,
  getSummary,
  updateUserLocale,
  getProfile,
  getInviteAttention,
  updateProfile,
  updateAvatar,
  updatePassword,
  listPublicHowlers,
  getPublicHowler,
  getAdminStats,
  listAdminUsers,
  listAdminEntries,
  adminDeleteEntry,
  adminToggleEntryPublic,
  adminDeleteUser,
  getAdminUser,
  adminClearUserSessions,
  adminVacuum,
  createBackup,
  listKids,
  createKid,
  deleteKid,
  createFamilyInvite,
  acceptFamilyInvite,
  cancelFamilyInvite,
  getFamilyUserIds,
};
