const db = require('./connection');
const { childNamesFromRow } = require('../child-names');
const { getFamilyIdForUser } = require('./families');

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(list.map(tag => String(tag).trim()).filter(Boolean))].slice(0, 8);
}

function mapEntry(row) {
  const content = [row.quote, row.story].map(value => String(value || '').trim()).filter(Boolean).join('\n\n');
  const childNames = childNamesFromRow(row);
  let tags = [];
  try {
    tags = normalizeTags(JSON.parse(row.tags_json || '[]'));
  } catch {
    // Invalid legacy tag data is treated as an empty list.
  }
  return {
    id: row.id, childName: childNames.join(', '), childNames, title: row.title,
    quote: row.quote, story: row.story, content, photo: row.photo || '', category: row.category,
    happenedOn: row.happened_on, ageNote: row.age_note, mood: row.mood, tags,
    isPublic: Boolean(row.is_public), isFavorite: Boolean(row.is_favorite),
    createdAt: row.created_at ? Number(row.created_at) : null,
    updatedAt: row.updated_at ? Number(row.updated_at) : null,
  };
}

function listHowlers(userId) {
  const familyId = getFamilyIdForUser(userId);
  return db.prepare(`SELECT * FROM howlers WHERE family_id = ?
    ORDER BY COALESCE(NULLIF(happened_on, ''), '') DESC, updated_at DESC, id DESC`)
    .all(familyId).map(mapEntry);
}

function getHowler(userId, howlerId) {
  const row = db.prepare('SELECT * FROM howlers WHERE family_id = ? AND id = ?')
    .get(getFamilyIdForUser(userId), howlerId);
  return row ? mapEntry(row) : null;
}

function createHowler(userId, input) {
  const familyId = getFamilyIdForUser(userId);
  const result = db.prepare(`INSERT INTO howlers (
    user_id, family_id, child_name, child_names_json, title, quote, story, photo, category,
    happened_on, age_note, mood, tags_json, is_favorite, is_public, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))`).run(
    userId, familyId, input.childNames[0], JSON.stringify(input.childNames), input.title,
    input.quote, input.story, input.photo, input.category, input.happenedOn, input.ageNote,
    input.mood, JSON.stringify(normalizeTags(input.tags)), input.isFavorite ? 1 : 0,
    input.isPublic ? 1 : 0,
  );
  return getHowler(userId, result.lastInsertRowid);
}

function updateHowler(userId, howlerId, input) {
  const familyId = getFamilyIdForUser(userId);
  const result = db.prepare(`UPDATE howlers SET
    child_name = ?, child_names_json = ?, title = ?, quote = ?, story = ?, photo = ?, category = ?,
    happened_on = ?, age_note = ?, mood = ?, tags_json = ?, is_favorite = ?, is_public = ?,
    updated_at = strftime('%s', 'now') WHERE family_id = ? AND id = ?`).run(
    input.childNames[0], JSON.stringify(input.childNames), input.title, input.quote, input.story,
    input.photo, input.category, input.happenedOn, input.ageNote, input.mood,
    JSON.stringify(normalizeTags(input.tags)), input.isFavorite ? 1 : 0, input.isPublic ? 1 : 0,
    familyId, howlerId,
  );
  return result.changes ? getHowler(userId, howlerId) : null;
}

function listPublicHowlers(limit) {
  return db.prepare(`SELECT * FROM howlers WHERE is_public = 1
    ORDER BY COALESCE(NULLIF(happened_on, ''), '') DESC, updated_at DESC, id DESC LIMIT ?`)
    .all(limit || 60).map(row => ({ ...mapEntry(row), tags: [] }));
}

function getPublicHowler(id) {
  const row = db.prepare('SELECT * FROM howlers WHERE id = ? AND is_public = 1').get(id);
  return row ? { ...mapEntry(row), tags: [] } : null;
}

function deleteHowler(userId, howlerId) {
  return db.prepare('DELETE FROM howlers WHERE family_id = ? AND id = ?')
    .run(getFamilyIdForUser(userId), howlerId).changes > 0;
}

function getSummary(userId) {
  const familyId = getFamilyIdForUser(userId);
  const totals = db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) AS favorites,
    MIN(created_at) AS first_created_at, MAX(updated_at) AS last_updated_at
    FROM howlers WHERE family_id = ?`).get(familyId);
  const categoryRows = db.prepare(`SELECT category, COUNT(*) AS total FROM howlers
    WHERE family_id = ? GROUP BY category ORDER BY total DESC, category ASC`).all(familyId);
  const childCounts = new Map();
  const childRows = db.prepare('SELECT child_name, child_names_json FROM howlers WHERE family_id = ?').all(familyId);
  for (const row of childRows) {
    for (const childName of childNamesFromRow(row)) {
      const key = childName.toLocaleLowerCase('bg-BG');
      const existing = childCounts.get(key);
      if (existing) existing.total += 1;
      else childCounts.set(key, { childName, total: 1 });
    }
  }
  const kids = [...childCounts.values()].sort((a, b) =>
    b.total - a.total || a.childName.localeCompare(b.childName, 'bg-BG')
  );
  const recent = db.prepare('SELECT * FROM howlers WHERE family_id = ? ORDER BY updated_at DESC, id DESC LIMIT 6')
    .all(familyId).map(mapEntry);
  return {
    total: Number(totals.total || 0), favorites: Number(totals.favorites || 0), kids: kids.length,
    firstCreatedAt: totals.first_created_at ? Number(totals.first_created_at) : null,
    lastUpdatedAt: totals.last_updated_at ? Number(totals.last_updated_at) : null,
    categories: categoryRows.map(row => ({ label: row.category, total: Number(row.total || 0) })),
    kidsBreakdown: kids, recent,
  };
}

module.exports = {
  listHowlers, createHowler, updateHowler, deleteHowler, getSummary,
  listPublicHowlers, getPublicHowler,
};
