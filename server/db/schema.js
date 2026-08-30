'use strict';

function addColumnIfMissing(db, tableName, columnName, sql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some(column => column.name === columnName)) db.exec(sql);
}

function initializeSchema(db) {
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

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mail_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      security TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL,
      sender TEXT NOT NULL,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
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
      child_names_json TEXT NOT NULL DEFAULT '[]',
      title TEXT NOT NULL,
      quote TEXT NOT NULL DEFAULT '',
      story TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'said',
      happened_on TEXT NOT NULL DEFAULT '',
      age_note TEXT NOT NULL DEFAULT '',
      mood TEXT NOT NULL DEFAULT 'golden',
      tags_json TEXT NOT NULL DEFAULT '[]',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      share_token TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_family_members_user ON family_members(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_family_members_pair ON family_members(family_id, user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_family_invites_pending ON family_invites(family_id, invitee_user_id) WHERE status = 'pending';
  `);

  addColumnIfMissing(db, 'howlers', 'is_public', 'ALTER TABLE howlers ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'howlers', 'family_id', 'ALTER TABLE howlers ADD COLUMN family_id INTEGER');
  addColumnIfMissing(db, 'howlers', 'photo', "ALTER TABLE howlers ADD COLUMN photo TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'howlers', 'child_names_json', "ALTER TABLE howlers ADD COLUMN child_names_json TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, 'howlers', 'share_token', 'ALTER TABLE howlers ADD COLUMN share_token TEXT');
  addColumnIfMissing(db, 'users', 'locale', "ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'bg'");
  addColumnIfMissing(db, 'users', 'display_name', 'ALTER TABLE users ADD COLUMN display_name TEXT');
  addColumnIfMissing(db, 'users', 'avatar', 'ALTER TABLE users ADD COLUMN avatar TEXT');
  addColumnIfMissing(db, 'users', 'email', 'ALTER TABLE users ADD COLUMN email TEXT');
  addColumnIfMissing(db, 'users', 'failed_login_attempts', 'ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'users', 'locked_until', 'ALTER TABLE users ADD COLUMN locked_until INTEGER');
  addColumnIfMissing(db, 'sessions', 'last_active_at', 'ALTER TABLE sessions ADD COLUMN last_active_at INTEGER');
  addColumnIfMissing(db, 'kids', 'family_id', 'ALTER TABLE kids ADD COLUMN family_id INTEGER');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_howlers_share_token ON howlers(share_token) WHERE share_token IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id, expires_at)');

  const bootstrapFamilies = db.transaction(() => {
    const users = db.prepare('SELECT id FROM users ORDER BY id ASC').all();
    const selectMember = db.prepare('SELECT family_id FROM family_members WHERE user_id = ?');
    const insertFamily = db.prepare('INSERT INTO families DEFAULT VALUES');
    const insertMember = db.prepare('INSERT INTO family_members (family_id, user_id) VALUES (?, ?)');
    for (const user of users) {
      if (selectMember.get(user.id)) continue;
      const family = insertFamily.run();
      insertMember.run(family.lastInsertRowid, user.id);
    }
    db.prepare(`
      UPDATE howlers
      SET family_id = (SELECT family_id FROM family_members WHERE user_id = howlers.user_id)
      WHERE family_id IS NULL
    `).run();
    db.prepare(`
      UPDATE kids
      SET family_id = (SELECT family_id FROM family_members WHERE user_id = kids.user_id)
      WHERE family_id IS NULL
    `).run();
  });
  bootstrapFamilies();

  db.prepare("UPDATE users SET locale = 'bg' WHERE locale IS NULL OR locale != 'bg'").run();
  const backfillEntryChildren = db.transaction(() => {
    const rows = db.prepare(`
      SELECT id, child_name FROM howlers
      WHERE child_names_json IS NULL OR child_names_json = '' OR child_names_json = '[]'
    `).all();
    const update = db.prepare('UPDATE howlers SET child_names_json = ? WHERE id = ?');
    for (const row of rows) {
      const name = String(row.child_name || '').trim();
      update.run(JSON.stringify(name ? [name] : []), row.id);
    }
  });
  backfillEntryChildren();
}

module.exports = { initializeSchema };
