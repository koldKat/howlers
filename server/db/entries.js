const crypto = require('crypto');
const db = require('./connection');
const { childNamesFromRow } = require('../child-names');
const { buildMultiChildAgeNote } = require('../entry-ages');
const { getFamilyIdForUser } = require('./families');
const { FEED_PAGE_SIZE, MAX_FEED_PAGE_SIZE } = require('../config');

const FEED_COLUMNS = `id, family_id, child_name, child_names_json, title, quote, story, category,
  happened_on, age_note, mood, tags_json, is_public, is_favorite, created_at, updated_at,
  CASE
    WHEN json_valid(photos_json) AND json_array_length(photos_json) > 0 THEN json_array_length(photos_json)
    WHEN photo IS NOT NULL AND photo != '' THEN 1
    ELSE 0
  END AS photo_count`;

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(list.map(tag => String(tag).trim()).filter(Boolean))].slice(0, 8);
}

function listFamilyKids(familyId) {
  return db.prepare('SELECT name, dob FROM kids WHERE family_id = ?').all(familyId);
}

function photosFromRow(row) {
  try {
    const photos = JSON.parse(row.photos_json || '[]');
    if (Array.isArray(photos) && photos.length) return photos.filter(value => typeof value === 'string' && value);
  } catch {
    // Invalid or absent collection data falls back to the legacy photo column.
  }
  return row.photo ? [row.photo] : [];
}

function mapEntry(row, familyKids = []) {
  const content = [row.quote, row.story].map(value => String(value || '').trim()).filter(Boolean).join('\n\n');
  const childNames = childNamesFromRow(row);
  const photos = photosFromRow(row);
  let tags = [];
  try {
    tags = normalizeTags(JSON.parse(row.tags_json || '[]'));
  } catch {
    // Invalid legacy tag data is treated as an empty list.
  }
  return {
    id: row.id, childName: childNames.join(', '), childNames, title: row.title,
    quote: row.quote, story: row.story, content, photo: photos[0] || '', photos, category: row.category,
    happenedOn: row.happened_on,
    ageNote: buildMultiChildAgeNote(childNames, familyKids, row.happened_on) || row.age_note,
    mood: row.mood, tags,
    isPublic: Boolean(row.is_public), isFavorite: Boolean(row.is_favorite),
    createdAt: row.created_at ? Number(row.created_at) : null,
    updatedAt: row.updated_at ? Number(row.updated_at) : null,
  };
}

function mapFeedEntry(row, familyKids, photoPath) {
  const entry = mapEntry(row, familyKids);
  const photoCount = Number(row.photo_count || 0);
  delete entry.photo;
  delete entry.photos;
  delete entry.quote;
  delete entry.story;
  return {
    ...entry,
    photoCount,
    photoUrls: Array.from(
      { length: photoCount },
      (_value, index) => photoPath(row.id, index, Number(row.updated_at || row.created_at || 0))
    ),
  };
}

function pageOptions(options = {}) {
  const requestedOffset = Number.parseInt(options.offset, 10);
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset > 0
    ? Math.min(requestedOffset, 1_000_000_000)
    : 0;
  const requestedLimit = Number.parseInt(options.limit, 10) || FEED_PAGE_SIZE;
  const limit = Math.max(1, Math.min(requestedLimit, MAX_FEED_PAGE_SIZE));
  return { offset, limit, query: String(options.query || '').trim().toLocaleLowerCase('bg-BG') };
}

function searchableRowText(row, includeTags) {
  return [
    row.child_name,
    row.child_names_json,
    row.title,
    row.quote,
    row.story,
    row.age_note,
    includeTags ? row.tags_json : '',
  ].join(' ').toLocaleLowerCase('bg-BG');
}

function feedRowsByIds(ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const byId = new Map(db.prepare(`SELECT ${FEED_COLUMNS} FROM howlers WHERE id IN (${placeholders})`)
    .all(...ids).map(row => [row.id, row]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

function pageResult(entries, offset, limit, total) {
  const nextOffset = offset + entries.length;
  return {
    entries,
    page: {
      offset,
      limit,
      total,
      hasPrevious: offset > 0,
      previousOffset: Math.max(0, offset - limit),
      hasMore: nextOffset < total,
      nextOffset,
    },
  };
}

function listHowlersPage(userId, options = {}) {
  const familyId = getFamilyIdForUser(userId);
  const familyKids = listFamilyKids(familyId);
  const { offset, limit, query } = pageOptions(options);
  if (!query) {
    const total = Number(db.prepare('SELECT COUNT(*) AS total FROM howlers WHERE family_id = ?').get(familyId).total);
    const rows = db.prepare(`SELECT ${FEED_COLUMNS} FROM howlers WHERE family_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(familyId, limit, offset);
    return pageResult(rows.map(row => mapFeedEntry(
      row,
      familyKids,
      (id, index, version) => `/api/howlers/${id}/photos/${index}?v=${version}`
    )), offset, limit, total);
  }

  const matches = db.prepare(`SELECT id, child_name, child_names_json, title, quote, story, age_note, tags_json
    FROM howlers WHERE family_id = ? ORDER BY created_at DESC, id DESC`).all(familyId)
    .filter(row => searchableRowText(row, true).includes(query));
  const rows = feedRowsByIds(matches.slice(offset, offset + limit).map(row => row.id));
  return pageResult(rows.map(row => mapFeedEntry(
    row,
    familyKids,
    (id, index, version) => `/api/howlers/${id}/photos/${index}?v=${version}`
  )), offset, limit, matches.length);
}

function listPublicHowlersPage(options = {}) {
  const { offset, limit, query } = pageOptions(options);
  let total;
  let rows;
  if (!query) {
    total = Number(db.prepare('SELECT COUNT(*) AS total FROM howlers WHERE is_public = 1').get().total);
    rows = db.prepare(`SELECT ${FEED_COLUMNS} FROM howlers WHERE is_public = 1
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(limit, offset);
  } else {
    const matches = db.prepare(`SELECT id, child_name, child_names_json, title, quote, story, age_note, tags_json
      FROM howlers WHERE is_public = 1 ORDER BY created_at DESC, id DESC`).all()
      .filter(row => searchableRowText(row, false).includes(query));
    total = matches.length;
    rows = feedRowsByIds(matches.slice(offset, offset + limit).map(row => row.id));
  }
  const kidsByFamily = new Map();
  const entries = rows.map(row => {
    if (!kidsByFamily.has(row.family_id)) kidsByFamily.set(row.family_id, listFamilyKids(row.family_id));
    return {
      ...mapFeedEntry(
        row,
        kidsByFamily.get(row.family_id),
        (id, index, version) => `/api/public/howlers/${id}/photos/${index}?v=${version}`
      ),
      tags: [],
    };
  });
  return pageResult(entries, offset, limit, total);
}

function listHowlers(userId) {
  const familyId = getFamilyIdForUser(userId);
  const familyKids = listFamilyKids(familyId);
  return db.prepare(`SELECT * FROM howlers WHERE family_id = ?
    ORDER BY created_at DESC, id DESC`)
    .all(familyId).map(row => mapEntry(row, familyKids));
}

function getHowler(userId, howlerId) {
  const row = db.prepare('SELECT * FROM howlers WHERE family_id = ? AND id = ?')
    .get(getFamilyIdForUser(userId), howlerId);
  return row ? mapEntry(row, listFamilyKids(row.family_id)) : null;
}

function photoAt(row, index) {
  if (!row || !Number.isInteger(index) || index < 0) return null;
  return photosFromRow(row)[index] || null;
}

function getHowlerPhoto(userId, howlerId, index) {
  const row = db.prepare('SELECT photo, photos_json FROM howlers WHERE family_id = ? AND id = ?')
    .get(getFamilyIdForUser(userId), howlerId);
  return photoAt(row, index);
}

function getPublicHowlerPhoto(howlerId, index) {
  const row = db.prepare('SELECT photo, photos_json FROM howlers WHERE id = ? AND is_public = 1').get(howlerId);
  return photoAt(row, index);
}

function createHowler(userId, input) {
  const familyId = getFamilyIdForUser(userId);
  const result = db.prepare(`INSERT INTO howlers (
    user_id, family_id, child_name, child_names_json, title, quote, story, photo, photos_json, category,
    happened_on, age_note, mood, tags_json, is_favorite, is_public, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))`).run(
    userId, familyId, input.childNames[0], JSON.stringify(input.childNames), input.title,
    input.quote, input.story, input.photo, JSON.stringify(input.photos), input.category, input.happenedOn, input.ageNote,
    input.mood, JSON.stringify(normalizeTags(input.tags)), input.isFavorite ? 1 : 0,
    input.isPublic ? 1 : 0,
  );
  return getHowler(userId, result.lastInsertRowid);
}

function updateHowler(userId, howlerId, input) {
  const familyId = getFamilyIdForUser(userId);
  const result = db.prepare(`UPDATE howlers SET
    child_name = ?, child_names_json = ?, title = ?, quote = ?, story = ?, photo = ?, photos_json = ?, category = ?,
    happened_on = ?, age_note = ?, mood = ?, tags_json = ?, is_favorite = ?, is_public = ?,
    updated_at = MAX(CAST(strftime('%s', 'now') AS INTEGER), COALESCE(updated_at, 0) + 1)
    WHERE family_id = ? AND id = ?`).run(
    input.childNames[0], JSON.stringify(input.childNames), input.title, input.quote, input.story,
    input.photo, JSON.stringify(input.photos), input.category, input.happenedOn, input.ageNote, input.mood,
    JSON.stringify(normalizeTags(input.tags)), input.isFavorite ? 1 : 0, input.isPublic ? 1 : 0,
    familyId, howlerId,
  );
  return result.changes ? getHowler(userId, howlerId) : null;
}

function listPublicHowlers(limit) {
  const kidsByFamily = new Map();
  return db.prepare(`SELECT * FROM howlers WHERE is_public = 1
    ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(limit || 60).map(row => {
      if (!kidsByFamily.has(row.family_id)) kidsByFamily.set(row.family_id, listFamilyKids(row.family_id));
      return { ...mapEntry(row, kidsByFamily.get(row.family_id)), tags: [] };
    });
}

function getPublicHowler(id) {
  const row = db.prepare('SELECT * FROM howlers WHERE id = ? AND is_public = 1').get(id);
  return row ? { ...mapEntry(row, listFamilyKids(row.family_id)), tags: [] } : null;
}

function getSharedHowler(token) {
  const cleanToken = String(token || '');
  if (!/^[A-Za-z0-9_-]{32}$/.test(cleanToken)) return null;
  const row = db.prepare('SELECT * FROM howlers WHERE share_token = ?').get(cleanToken);
  return row ? { ...mapEntry(row, listFamilyKids(row.family_id)), tags: [] } : null;
}

function getSharePath(userId, howlerId) {
  const familyId = getFamilyIdForUser(userId);
  const row = db.prepare('SELECT id, is_public, share_token FROM howlers WHERE family_id = ? AND id = ?')
    .get(familyId, howlerId);
  if (!row) return null;
  if (row.is_public === 1) return `/posts/${row.id}`;
  if (row.share_token) return `/shared/${row.share_token}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = crypto.randomBytes(24).toString('base64url');
    try {
      const result = db.prepare(`UPDATE howlers SET share_token = ?
        WHERE family_id = ? AND id = ? AND share_token IS NULL`)
        .run(token, familyId, howlerId);
      if (result.changes) return `/shared/${token}`;
      const current = db.prepare('SELECT is_public, share_token FROM howlers WHERE family_id = ? AND id = ?')
        .get(familyId, howlerId);
      if (!current) return null;
      if (current.is_public === 1) return `/posts/${howlerId}`;
      if (current.share_token) return `/shared/${current.share_token}`;
    } catch (error) {
      if (!String(error.message).includes('UNIQUE')) throw error;
    }
  }
  throw new Error('Връзката за споделяне не можа да бъде създадена.');
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
  return {
    total: Number(totals.total || 0), favorites: Number(totals.favorites || 0), kids: kids.length,
    firstCreatedAt: totals.first_created_at ? Number(totals.first_created_at) : null,
    lastUpdatedAt: totals.last_updated_at ? Number(totals.last_updated_at) : null,
    categories: categoryRows.map(row => ({ label: row.category, total: Number(row.total || 0) })),
    kidsBreakdown: kids,
  };
}

module.exports = {
  listHowlers, listHowlersPage, getHowler, getHowlerPhoto, createHowler, updateHowler, deleteHowler, getSummary,
  listPublicHowlers, listPublicHowlersPage, getPublicHowler, getPublicHowlerPhoto,
  getSharedHowler, getSharePath,
};
