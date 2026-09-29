'use strict';

const db = require('./db');
const domain = require('../shared/domain');

function appInfo() {
  return {
    name: domain.brand.name,
    version: '1.0.0',
    subtitle: domain.brand.subtitle,
  };
}

function buildState(userId) {
  const viewer = db.getViewer(userId);
  if (!viewer) return null;
  const summary = db.getSummary(userId);
  const entriesPage = db.listHowlersPage(userId);
  const publicPage = summary.total ? { entries: [], page: null } : db.listPublicHowlersPage();
  return {
    app: appInfo(),
    viewer: {
      ...viewer,
    },
    profile: viewer,
    attention: db.getInviteAttention(userId),
    summary,
    entries: entriesPage.entries,
    entriesPage: entriesPage.page,
    kids: db.listKids(userId),
    publicFeed: publicPage.entries,
    publicFeedPage: publicPage.page,
  };
}

function buildGuestState() {
  const publicPage = db.listPublicHowlersPage();
  return {
    app: appInfo(),
    publicFeed: publicPage.entries,
    publicFeedPage: publicPage.page,
  };
}

module.exports = {
  buildState,
  buildGuestState,
};
