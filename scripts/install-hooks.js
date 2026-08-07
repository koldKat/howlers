#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const gitDir = path.join(repoRoot, '.git');
const sourceHook = path.join(repoRoot, '.githooks', 'pre-commit');
const targetHook = path.join(gitDir, 'hooks', 'pre-commit');

function log(message) {
  process.stdout.write(`${message}\n`);
}

if (!fs.existsSync(gitDir)) {
  log('[hooks] No .git directory found. Skipping hook installation.');
  process.exit(0);
}

if (!fs.existsSync(sourceHook)) {
  log(`[hooks] Source hook is missing: ${sourceHook}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(targetHook), { recursive: true });
fs.copyFileSync(sourceHook, targetHook);

try {
  fs.chmodSync(targetHook, 0o755);
} catch {}

log(`[hooks] Installed pre-commit hook at ${targetHook}`);
