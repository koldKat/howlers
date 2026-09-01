const db = require('./connection');
const { isValidLocalDate } = require('../date-validation');

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
           inviter.id AS inviter_id, inviter.username AS inviter_username,
           inviter.display_name AS inviter_display_name, inviter.avatar AS inviter_avatar
    FROM family_invites fi
    JOIN users inviter ON inviter.id = fi.inviter_user_id
    WHERE fi.invitee_user_id = ? AND fi.status = 'pending'
    ORDER BY fi.created_at DESC, fi.id DESC
  `).all(userId).map(row => mapInvite(row, 'incoming'));
  const outgoing = db.prepare(`
    SELECT fi.id, fi.family_id, fi.status, fi.created_at, fi.responded_at,
           invitee.id AS invitee_id, invitee.username AS invitee_username,
           invitee.display_name AS invitee_display_name, invitee.avatar AS invitee_avatar
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

function listKids(userId) {
  const familyId = getFamilyIdForUser(userId);
  return db.prepare('SELECT id, name, dob FROM kids WHERE family_id = ? ORDER BY created_at ASC, id ASC').all(familyId);
}

function createKid(userId, { name, dob }) {
  const familyId = getFamilyIdForUser(userId);
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Името е задължително.');
  if (cleanName.length > 60) throw new Error('Името трябва да е до 60 символа.');
  const cleanDob = String(dob || '').trim();
  if (cleanDob && !isValidLocalDate(cleanDob)) {
    throw new Error('Въведи валидна дата на раждане във формат ДД/ММ/ГГГГ.');
  }
  const result = db.prepare('INSERT INTO kids (user_id, family_id, name, dob) VALUES (?, ?, ?, ?)')
    .run(userId, familyId, cleanName, cleanDob);
  return { id: result.lastInsertRowid, name: cleanName, dob: cleanDob };
}

function deleteKid(userId, kidId) {
  const familyId = getFamilyIdForUser(userId);
  return db.prepare('DELETE FROM kids WHERE family_id = ? AND id = ?').run(familyId, kidId).changes > 0;
}

function createFamilyInvite(inviterUserId, inviteeUsername) {
  const cleanUsername = String(inviteeUsername || '').trim();
  if (!cleanUsername) throw new Error('Потребителското име е задължително.');
  const invitee = db.prepare('SELECT id, username, display_name, avatar FROM users WHERE username = ?').get(cleanUsername);
  if (!invitee) throw new Error('Потребителят не е намерен.');
  if (invitee.id === inviterUserId) throw new Error('Вече си част от този семеен архив.');
  const familyId = getFamilyIdForUser(inviterUserId);
  const inviteeFamilyId = getFamilyIdForUser(invitee.id);
  if (inviteeFamilyId === familyId) throw new Error('Този родител вече е в семейния ти архив.');
  const existing = db.prepare(`
    SELECT id FROM family_invites
    WHERE family_id = ? AND invitee_user_id = ? AND status = 'pending'
  `).get(familyId, invitee.id);
  if (existing) throw new Error('Вече има чакаща покана към този потребител.');
  const result = db.prepare(`
    INSERT INTO family_invites (family_id, inviter_user_id, invitee_user_id) VALUES (?, ?, ?)
  `).run(familyId, inviterUserId, invitee.id);
  return { id: result.lastInsertRowid, inviteeUserId: invitee.id, familyId };
}

const acceptFamilyInviteTx = db.transaction((inviteeUserId, inviteId) => {
  const invite = db.prepare(`
    SELECT id, family_id, inviter_user_id, invitee_user_id, status
    FROM family_invites WHERE id = ? AND invitee_user_id = ?
  `).get(inviteId, inviteeUserId);
  if (!invite || invite.status !== 'pending') throw new Error('Поканата не е намерена.');
  const targetFamilyId = invite.family_id;
  const sourceFamilyId = getFamilyIdForUser(inviteeUserId);
  db.prepare("UPDATE family_invites SET status = 'accepted', responded_at = strftime('%s', 'now') WHERE id = ?").run(inviteId);
  if (sourceFamilyId !== targetFamilyId) {
    db.prepare('UPDATE howlers SET family_id = ? WHERE family_id = ?').run(targetFamilyId, sourceFamilyId);
    db.prepare('UPDATE kids SET family_id = ? WHERE family_id = ?').run(targetFamilyId, sourceFamilyId);
    db.prepare('UPDATE family_members SET family_id = ? WHERE family_id = ?').run(targetFamilyId, sourceFamilyId);
    db.prepare(`
      UPDATE family_invites SET status = 'cancelled', responded_at = strftime('%s', 'now')
      WHERE family_id = ? AND status = 'pending' AND invitee_user_id IN (
        SELECT invitee_user_id FROM family_invites WHERE family_id = ? AND status = 'pending'
      )
    `).run(sourceFamilyId, targetFamilyId);
    db.prepare("UPDATE family_invites SET family_id = ? WHERE family_id = ? AND status = 'pending'")
      .run(targetFamilyId, sourceFamilyId);
    db.prepare('DELETE FROM families WHERE id = ?').run(sourceFamilyId);
  }
  db.prepare(`
    UPDATE family_invites SET status = 'cancelled', responded_at = strftime('%s', 'now')
    WHERE id != ? AND status = 'pending' AND invitee_user_id IN (
      SELECT user_id FROM family_members WHERE family_id = ?
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
    SELECT id, family_id, inviter_user_id, invitee_user_id, status FROM family_invites WHERE id = ?
  `).get(inviteId);
  if (!invite || invite.status !== 'pending') throw new Error('Поканата не е намерена.');
  if (invite.invitee_user_id !== userId && invite.family_id !== familyId) throw new Error('Поканата не е намерена.');
  db.prepare("UPDATE family_invites SET status = 'cancelled', responded_at = strftime('%s', 'now') WHERE id = ?")
    .run(inviteId);
  return { familyId: invite.family_id, inviterUserId: invite.inviter_user_id, inviteeUserId: invite.invitee_user_id };
}

function getFamilyUserIds(userId) {
  return listFamilyUserIds(getFamilyIdForUser(userId));
}

module.exports = {
  createFamilyForUser,
  getFamilyIdForUser,
  listFamilyUserIds,
  listFamilyMembers,
  listFamilyInvites,
  getInviteAttention,
  listKids,
  createKid,
  deleteKid,
  createFamilyInvite,
  acceptFamilyInvite,
  cancelFamilyInvite,
  getFamilyUserIds,
};
