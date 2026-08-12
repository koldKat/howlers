#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const DOC_PATHS = new Set(['docs/USER_GUIDE.md', 'docs/TECHNICAL.md', 'docs/ADMIN.md']);
const RELEVANT_FILES = new Set(['server.js', 'package.json', 'package-lock.json']);
const RELEVANT_PREFIXES = ['public/', 'server/', 'scripts/'];

function checkHtmlSync() {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'generate-docs.js'), '--check'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  return result.status === 0;
}

function pass(message) {
  print(message);
  process.exit(checkHtmlSync() ? 0 : 1);
}

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function isRelevantChange(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized || DOC_PATHS.has(normalized)) return false;
  if (RELEVANT_FILES.has(normalized)) return true;
  return RELEVANT_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    return { ok: false, reason: result.error.code || result.error.message };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      reason: (result.stderr || result.stdout || `git exited with ${result.status}`).trim(),
    };
  }

  return { ok: true, output: result.stdout };
}

function collectChangedFiles() {
  const explicit = process.argv.slice(2).map(normalizePath).filter(Boolean);
  if (explicit.length) {
    return { source: 'args', files: explicit };
  }

  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    return { source: 'nogit', files: [] };
  }

  const diff = runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMRD']);
  if (!diff.ok) {
    return { source: 'git-error', files: [], reason: diff.reason };
  }

  return {
    source: 'git',
    files: diff.output.split(/\r?\n/).map(normalizePath).filter(Boolean),
  };
}

function print(message) {
  process.stdout.write(`${message}\n`);
}

if (process.env.DOCS_GUARD_BYPASS === '1') {
  pass('[docs-guard] Relevance check bypassed by DOCS_GUARD_BYPASS=1');
}

const changed = collectChangedFiles();

if (changed.source === 'nogit') {
  pass('[docs-guard] No .git directory detected. Pass changed paths explicitly or run inside a git checkout.');
}

if (changed.source === 'git-error') {
  print(`[docs-guard] Unable to read staged files: ${changed.reason}`);
  process.exit(1);
}

if (!changed.files.length) {
  pass('[docs-guard] No staged or supplied files to inspect.');
}

const relevantChanges = changed.files.filter(isRelevantChange);
if (!relevantChanges.length) {
  pass('[docs-guard] No documentation-relevant app changes detected.');
}

const touchedDocs = changed.files.filter(filePath => DOC_PATHS.has(filePath));
if (touchedDocs.length) {
  pass('[docs-guard] Relevant code changed and docs were updated in the same change.');
}

print('[docs-guard] Relevant app files changed, but no tracked Markdown docs were updated.');
print('[docs-guard] Changed files:');
for (const filePath of relevantChanges) {
  print(`  - ${filePath}`);
}
print('[docs-guard] Update docs/USER_GUIDE.md, docs/TECHNICAL.md, or docs/ADMIN.md when behavior, UI flow, setup, API, auth/session, or storage details changed.');
print('[docs-guard] If the change is truly doc-neutral, rerun with DOCS_GUARD_BYPASS=1.');
process.exit(1);
