'use strict';

const db = require('./db');

function appInfo() {
  return {
    name: 'Семейни бисери',
    version: '1.0.0',
    subtitle: 'Реплики, случки и малки легенди',
  };
}

function buildState(userId) {
  const viewer = db.getViewer(userId);
  if (!viewer) return null;
  const profile = db.getProfile(userId);
  return {
    app: appInfo(),
    viewer: {
      ...viewer,
      avatar: profile ? profile.avatar : viewer.avatar,
    },
    profile,
    attention: db.getInviteAttention(userId),
    summary: db.getSummary(userId),
    entries: db.listHowlers(userId),
    kids: db.listKids(userId),
    publicFeed: db.listPublicHowlers(),
  };
}

function buildGuestState() {
  return {
    app: appInfo(),
    publicFeed: db.listPublicHowlers(),
  };
}

module.exports = {
  buildState,
  buildGuestState,
};
