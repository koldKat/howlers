'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const {
  APP_ROOT,
  BACKUP_DIR,
  BACKUP_INTERVAL_MS,
  BACKUP_RETENTION_MS,
  BACKUPS_DISABLED,
} = require('./config');

function formatBackupStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  return `${year}-${month}-${day}_${hour}-00-00`;
}

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function pruneOldBackups(now = Date.now()) {
  if (!fs.existsSync(BACKUP_DIR)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!name.endsWith('.zip') && !name.endsWith('.sqlite')) continue;
    const filePath = path.join(BACKUP_DIR, name);
    const stat = fs.statSync(filePath);
    if (now - stat.mtimeMs <= BACKUP_RETENTION_MS) continue;
    fs.unlinkSync(filePath);
    removed += 1;
  }
  return removed;
}

function runDatabaseBackup() {
  ensureBackupDir();
  const stamp = formatBackupStamp();
  const snapshotPath = path.join(BACKUP_DIR, `database-${stamp}.sqlite`);
  const backupPath = path.join(BACKUP_DIR, `database-${stamp}.zip`);
  if (!fs.existsSync(backupPath)) {
    try {
      db.createBackup(snapshotPath);
      execFileSync('zip', ['-jq', backupPath, snapshotPath], { stdio: 'ignore' });
      console.log(`Created database backup: ${path.relative(APP_ROOT, backupPath)}`);
    } finally {
      if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    }
  }
  const removed = pruneOldBackups();
  console.log(`Backup retention check complete: removed ${removed} expired database backup(s).`);
}

function runScheduledBackup() {
  try {
    runDatabaseBackup();
  } catch (error) {
    console.error(`Database backup failed: ${error.message || error}`);
  }
}

function scheduleDatabaseBackups() {
  if (BACKUPS_DISABLED) return;
  const now = Date.now();
  const msUntilNextHour = BACKUP_INTERVAL_MS - (now % BACKUP_INTERVAL_MS);
  const kickoff = setTimeout(() => {
    runScheduledBackup();
    const interval = setInterval(runScheduledBackup, BACKUP_INTERVAL_MS);
    interval.unref();
  }, msUntilNextHour);
  kickoff.unref();
}

module.exports = {
  formatBackupStamp,
  pruneOldBackups,
  runDatabaseBackup,
  runScheduledBackup,
  scheduleDatabaseBackups,
};
