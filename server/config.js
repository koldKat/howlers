'use strict';

const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3019);
const ROOT = path.join(APP_ROOT, 'public');
const BACKUP_DIR = path.join(APP_ROOT, 'backups');
const BACKUP_INTERVAL_MS = 60 * 60 * 1000;
const BACKUP_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const BACKUPS_DISABLED = process.env.DISABLE_BACKUPS === '1';
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_BYTES = 300 * 1024;
const MAX_POST_PHOTO_BYTES = 512 * 1024;
const PROTECTED_ADMIN_USERS = new Set(['slanchoff', 'koldkat']);
const PUBLIC_URL = String(process.env.PUBLIC_URL || 'https://biseri.net').replace(/\/$/, '');
const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAILURE_LIMIT = 8;
const PASSWORD_RESET_REQUEST_LIMIT = 3;
const ACCOUNT_FAILURE_LIMIT = 5;
const ACCOUNT_LOCK_SECONDS = 15 * 60;
const PASSWORD_RESET_SECONDS = 60 * 60;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

module.exports = {
  APP_ROOT,
  PORT,
  ROOT,
  BACKUP_DIR,
  BACKUP_INTERVAL_MS,
  BACKUP_RETENTION_MS,
  BACKUPS_DISABLED,
  MAX_REQUEST_BYTES,
  MAX_AVATAR_BYTES,
  MAX_POST_PHOTO_BYTES,
  PROTECTED_ADMIN_USERS,
  PUBLIC_URL,
  AUTH_FAILURE_WINDOW_MS,
  AUTH_FAILURE_LIMIT,
  PASSWORD_RESET_REQUEST_LIMIT,
  ACCOUNT_FAILURE_LIMIT,
  ACCOUNT_LOCK_SECONDS,
  PASSWORD_RESET_SECONDS,
  MIME,
};
