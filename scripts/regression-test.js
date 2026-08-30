#!/usr/bin/env node

const assert = require('assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildMultiChildAgeNote } = require('../server/entry-ages');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'howlers-regression-'));
const databasePath = path.join(tempDir, 'database.sqlite');
const port = 3197;
const baseUrl = `http://127.0.0.1:${port}`;
const root = path.join(__dirname, '..');
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    DATABASE_PATH: databasePath,
    DISABLE_BACKUPS: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk; });
server.stderr.on('data', chunk => { serverOutput += chunk; });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited early:\n${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/api/feed`);
      if (response.ok) return;
    } catch {}
    await sleep(50);
  }
  throw new Error(`Server did not start:\n${serverOutput}`);
}

async function request(pathname, { token, method = 'GET', body, bodyText, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || bodyText !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: bodyText !== undefined ? bodyText : body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: raw ? await response.text() : await response.json(),
  };
}

async function register(username, password = 'secret12') {
  const result = await request('/api/register', {
    method: 'POST',
    body: { username, password },
  });
  assert.equal(result.status, 200);
  assert.ok(result.body.token);
  return result.body.token;
}

function entryBody(overrides = {}) {
  return {
    childName: 'Mila',
    title: 'Test entry',
    quote: 'Hello',
    story: '',
    category: 'said',
    happenedOn: '2026-06-01',
    ageNote: '4',
    mood: 'golden',
    photo: '',
    tags: ['family', 'test'],
    isFavorite: true,
    isPublic: false,
    ...overrides,
  };
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function main() {
  assert.equal(buildMultiChildAgeNote(
    ['Mila', 'Niki'],
    [{ name: 'Mila', dob: '2022-01-15' }, { name: 'Niki', dob: '2021-05-04' }],
    '2026-06-01'
  ), 'Mila: 4 г. 4 мес.; Niki: 5 г.');
  await waitForServer();

  let result = await request('/', { raw: true });
  assert.equal(result.status, 200);
  assert.match(result.body, /<nav class="site-nav">[\s\S]*id="mobile-family-settings"[\s\S]*<\/nav>/);
  assert.match(result.body, /class="mobile-family-settings-icon"/);
  assert.match(result.body, /id="mobile-family-settings-close"/);

  result = await request('/%E0%A4%A', { raw: true });
  assert.equal(result.status, 400);
  assert.match(result.body, /Невалиден адрес/);

  result = await request('/emoticons.svg', { raw: true });
  assert.equal(result.status, 200);
  assert.match(result.body, /<symbol id="happy"/);
  assert.match(result.body, /<symbol id="proud"/);
  assert.match(result.body, /<symbol id="angry"/);
  assert.match(result.body, /<symbol id="cool"/);

  const staticResponse = await fetch(`${baseUrl}/js/app.js`);
  assert.equal(staticResponse.status, 200);
  assert.equal(staticResponse.headers.get('cache-control'), 'no-cache');
  const staticEtag = staticResponse.headers.get('etag');
  assert.ok(staticEtag);
  await staticResponse.arrayBuffer();
  const revalidatedStatic = await fetch(`${baseUrl}/js/app.js`, {
    headers: { 'If-None-Match': staticEtag },
  });
  assert.equal(revalidatedStatic.status, 304);
  assert.equal(revalidatedStatic.headers.get('cache-control'), 'no-cache');

  result = await request('/js/app.js', { raw: true });
  assert.equal(result.status, 200);
  assert.match(result.body, /createFeedController/);
  assert.match(result.body, /kidsController\.render\(\[\]\)/);
  assert.match(result.body, /window\.visualViewport/);
  assert.match(result.body, /await postDetailController\.openInitialRoute\(\);\s+editorTools\.initializeControls\(\)/);
  assert.match(result.body, /els\.editorDialog\.scrollTop = 0/);
  assert.doesNotMatch(result.body, /latestKids/);

  result = await request('/css/style.css', { raw: true });
  assert.equal(result.status, 200);
  assert.match(result.body, /--editor-viewport-height/);
  assert.match(result.body, /\.editor-dialog-head\s*\{[\s\S]*position: sticky/);
  assert.match(result.body, /\.post-detail-dialog\[data-server-rendered\]\[open\]/);
  assert.match(result.body, /\.post-detail-dialog\[data-server-rendered\]\[open\]\s*\{[\s\S]*?top:\s*50%[\s\S]*?transform:\s*translate\(-50%,\s*-50%\)/);
  assert.match(result.body, /\.post-detail-dialog\s*\{[\s\S]*?height:\s*fit-content/);
  assert.match(result.body, /\.post-detail-footer:has\(#post-detail-share\[hidden\]\):has\(\.post-detail-share-status:empty\)/);
  assert.doesNotMatch(result.body, /\.post-detail-dialog\s*\{\s*width:\s*100vw;\s*height:\s*100dvh;/);
  assert.match(result.body, /\.entry-content\s*\{[\s\S]*text-align: justify/);
  assert.match(result.body, /#mobile-family-settings,\s*\.mobile-sidebar-head\s*\{ display: none; \}/);
  assert.match(result.body, /@media \(max-width: 860px\)[\s\S]*#mobile-family-settings\s*\{ display: inline-flex; \}/);

  result = await request('/js/app/feed.js', { raw: true });
  assert.equal(result.status, 200);
  assert.match(result.body, /export function createFeedController/);

  result = await request('/js/app/post-detail.js', { raw: true });
  assert.equal(result.status, 200);
  assert.match(result.body, /prepareDialog\(entry\.isPublic && !isPrivateLink\)/);
  assert.match(result.body, /<h1 class="list-item-title">/);
  assert.match(result.body, /restoreBaseMetadata/);

  result = await request('/js/app/kids.js', { raw: true });
  assert.equal(result.status, 200);
  assert.match(result.body, /export function createKidsController/);

  result = await request('/js/app/child-picker.js', { raw: true });
  assert.equal(result.status, 200);
  assert.match(result.body, /const selectedCount = selectedKids\.length \+ customNames\(\)\.length/);
  assert.match(result.body, /ages\.map\(\(\{ kid, age \}\) => `\$\{kid\.name\}: \$\{age\}`\)\.join\('; '\)/);

  const manifestResponse = await fetch(`${baseUrl}/site.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get('content-type') || '', /^application\/manifest\+json/);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#fff6dc');
  assert.equal(manifest.theme_color, '#57b9ff');
  assert.deepEqual(manifest.icons.map(icon => icon.purpose), ['any', 'any maskable', 'any maskable']);

  const iconResponse = await fetch(`${baseUrl}/icons/app-icon-sky-192.png`);
  assert.equal(iconResponse.status, 200);
  assert.equal(iconResponse.headers.get('content-type'), 'image/png');
  const iconBytes = Buffer.from(await iconResponse.arrayBuffer());
  assert.deepEqual([...iconBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(iconBytes.readUInt8(25), 2);

  result = await request('/', { raw: true });
  assert.equal(result.status, 200);
  assert.match(result.body, /<link rel="manifest" href="\/site\.webmanifest">/);
  assert.match(result.body, /<link rel="apple-touch-icon" sizes="180x180" href="\/icons\/apple-touch-icon-sky\.png">/);
  assert.match(result.body, /<meta name="theme-color" content="#57b9ff">/);
  assert.match(result.body, /class="feed-loading" role="status" aria-live="polite"/);
  assert.match(result.body, /class="panel-head editor-dialog-head"/);
  assert.equal((result.body.match(/class="feed-loading-spoke feed-loading-spoke-\d"/g) || []).length, 4);
  assert.match(result.body, /feed-loading-spoke-1[^>]*><path d="M32 7\.5v9" \/><path d="M32 47\.5v9"/);

  result = await request('/js/app/feed-loading.js', { raw: true });
  assert.equal(result.status, 200);
  assert.match(result.body, /export function createFeedLoader/);
  assert.match(result.body, /container\.replaceChildren\(loader\)/);

  result = await request('/css/style.css', { raw: true });
  assert.equal(result.status, 200);
  assert.match(result.body, /@keyframes feed-sun-spokes/);
  assert.match(result.body, /prefers-reduced-motion: reduce/);

  result = await request('/api/register', {
    method: 'POST',
    bodyText: '{"username":',
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Невалидни JSON данни.');

  result = await request('/api/register', {
    method: 'POST',
    body: null,
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'JSON данните трябва да са обект.');

  result = await request('/api/register', {
    method: 'POST',
    body: { username: 'short-password', password: '12345' },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Паролата трябва да е между 6 и 256 символа.');

  result = await request('/api/register', {
    method: 'POST',
    body: { username: 'x'.repeat(61), password: 'secret12' },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Потребителското име трябва да е до 60 символа.');

  result = await request('/api/login', {
    method: 'POST',
    body: { username: 123, password: 'secret12' },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Потребителското име и паролата са задължителни.');

  const alpha = await register('alpha');
  const beta = await register('beta');
  const gamma = await register('gamma');
  await register('koldkat');

  result = await request('/api/register', {
    method: 'POST',
    body: { username: 'alpha', password: 'secret12' },
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'Потребителското име вече е заето.');

  result = await request('/api/profile', {
    token: alpha,
    method: 'PATCH',
    body: { displayName: 'x'.repeat(2 * 1024 * 1024) },
  });
  assert.equal(result.status, 413);
  assert.equal(result.body.error, 'Заявката е прекалено голяма.');

  result = await request('/api/profile', {
    token: alpha,
    method: 'PATCH',
    body: { displayName: 'x'.repeat(61) },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Показваното име трябва да е до 60 символа.');

  result = await request('/api/howlers', {
    token: alpha,
    method: 'POST',
    body: entryBody({ childName: '' }),
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Избери поне едно дете.');

  result = await request('/api/howlers', {
    token: alpha,
    method: 'POST',
    body: entryBody({ childNames: ['Mila', { name: 'Niki' }] }),
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Имената на децата трябва да са текст.');

  result = await request('/api/howlers', {
    token: alpha,
    method: 'POST',
    body: entryBody({ happenedOn: '2026-02-30' }),
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Въведи валидна дата във формат ГГГГ-ММ-ДД.');

  result = await request('/api/howlers', {
    token: alpha,
    method: 'POST',
    body: entryBody({ category: 'invented' }),
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Невалиден вид на записа.');

  result = await request('/api/howlers', {
    token: alpha,
    method: 'POST',
    body: entryBody({ mood: 'invented' }),
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Невалидно настроение.');

  result = await request('/api/howlers', {
    token: alpha,
    method: 'POST',
    body: entryBody({ title: 'Default classification', category: '', mood: '' }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.entry.category, 'said');
  assert.equal(result.body.entry.mood, 'golden');
  assert.equal((await request(`/api/howlers/${result.body.entry.id}`, {
    token: alpha,
    method: 'DELETE',
  })).status, 200);

  result = await request('/api/howlers', {
    token: alpha,
    method: 'POST',
    body: entryBody({
      title: '',
      quote: '',
      story: '',
      photo: TINY_PNG,
      happenedOn: '2018-03-14',
      isPublic: true,
    }),
  });
  assert.equal(result.status, 200);
  const backdatedPhotoId = result.body.entry.id;
  assert.equal(result.body.entry.title, 'Снимка');
  assert.equal(result.body.entry.content, '');
  assert.equal(result.body.entry.photo, TINY_PNG);
  assert.equal(result.body.entry.happenedOn, '2018-03-14');
  assert.equal(result.body.state.entries[0].id, backdatedPhotoId);
  result = await request('/api/feed');
  assert.equal(result.body[0].id, backdatedPhotoId);
  assert.equal((await request(`/api/howlers/${backdatedPhotoId}`, {
    token: alpha,
    method: 'DELETE',
  })).status, 200);

  result = await request('/api/howlers', {
    token: alpha,
    method: 'POST',
    body: entryBody({ quote: '', story: '', photo: '' }),
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Добави текст или снимка към записа.');

  result = await request('/api/howlers', {
    token: alpha,
    method: 'POST',
    body: entryBody({
      title: 'Alpha [b]:happy: entry[/b]',
      quote: 'Hello [u]:love:[/u]',
      story: 'Original story details.',
      photo: TINY_PNG,
      isPublic: true,
    }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.entry.title, 'Alpha [b]:happy: entry[/b]');
  assert.equal(result.body.entry.quote, 'Hello [u]:love:[/u]');
  assert.equal(result.body.entry.story, 'Original story details.');
  assert.equal(result.body.entry.content, 'Hello [u]:love:[/u]\n\nOriginal story details.');
  assert.equal(result.body.entry.photo, TINY_PNG);
  assert.equal(result.body.state.entries.some(entry => entry.id === result.body.entry.id), true);
  const alphaEntryId = result.body.entry.id;

  result = await request('/api/howlers', {
    token: alpha,
    method: 'POST',
    body: entryBody({
      title: 'Auto-dated entry',
      happenedOn: '',
      isPublic: false,
    }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.entry.happenedOn, localDateString());
  assert.equal((await request(`/api/howlers/${result.body.entry.id}`, {
    token: alpha,
    method: 'DELETE',
  })).status, 200);

  const oversizedPhoto = `data:image/png;base64,${Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(512 * 1024),
  ]).toString('base64')}`;
  result = await request('/api/howlers', {
    token: alpha,
    method: 'POST',
    body: entryBody({ title: 'Oversized photo', photo: oversizedPhoto }),
  });
  assert.equal(result.status, 400);

  result = await request('/api/kids', {
    token: beta,
    method: 'POST',
    body: { name: 'Niki', dob: '2021-05-04' },
  });
  assert.equal(result.status, 200);
  const betaKidId = result.body.kid.id;

  result = await request('/api/kids', {
    token: beta,
    method: 'POST',
    body: { name: 'Impossible birthday', dob: '2021-02-30' },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Въведи валидна дата на раждане във формат ГГГГ-ММ-ДД.');

  result = await request('/api/kids', {
    token: beta,
    method: 'POST',
    body: { name: 'x'.repeat(61), dob: '' },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Името трябва да е до 60 символа.');

  result = await request('/api/howlers', {
    token: beta,
    method: 'POST',
    body: entryBody({
      childName: 'Niki',
      title: 'Beta entry',
      quote: '',
      story: 'Before merge',
      category: 'did',
      happenedOn: '',
      mood: 'sweet',
      tags: 'merge',
      isFavorite: false,
    }),
  });
  assert.equal(result.status, 200);
  const betaEntryId = result.body.entry.id;

  result = await request('/api/family/invites', {
    token: alpha,
    method: 'POST',
    body: { username: 'gamma' },
  });
  assert.equal(result.status, 200);
  const cancelledInviteId = result.body.inviteId;

  result = await request('/api/family/invites', {
    token: alpha,
    method: 'POST',
    body: { username: 'gamma' },
  });
  assert.equal(result.status, 400);

  result = await request('/api/profile', { token: gamma });
  assert.equal(result.body.incomingInvites[0].id, cancelledInviteId);

  result = await request(`/api/family/invites/${cancelledInviteId}/accept`, {
    token: beta,
    method: 'POST',
  });
  assert.equal(result.status, 400);

  result = await request(`/api/family/invites/${cancelledInviteId}`, {
    token: alpha,
    method: 'DELETE',
  });
  assert.equal(result.status, 200);
  result = await request('/api/profile', { token: gamma });
  assert.equal(result.body.incomingInvites.length, 0);
  result = await request('/api/profile', { token: alpha });
  assert.equal(result.body.outgoingInvites.length, 0);

  result = await request('/api/family/invites', {
    token: alpha,
    method: 'POST',
    body: { username: 'beta' },
  });
  assert.equal(result.status, 200);
  const mergeInviteId = result.body.inviteId;

  result = await request('/api/state', { token: beta });
  assert.equal(result.body.attention.pendingInviteCount, 1);
  assert.equal(result.body.attention.pendingInviteSenders[0].username, 'alpha');

  result = await request(`/api/family/invites/${mergeInviteId}/accept`, {
    token: beta,
    method: 'POST',
  });
  assert.equal(result.status, 200);

  const alphaState = await request('/api/state', { token: alpha });
  const betaState = await request('/api/state', { token: beta });
  assert.deepEqual(
    alphaState.body.entries.map(entry => entry.id).sort(),
    [alphaEntryId, betaEntryId].sort()
  );
  assert.deepEqual(
    betaState.body.entries.map(entry => entry.id).sort(),
    [alphaEntryId, betaEntryId].sort()
  );
  assert.equal(alphaState.body.kids.some(kid => kid.id === betaKidId), true);
  assert.equal(betaState.body.profile.familyMembers.length, 2);
  assert.equal(alphaState.body.viewer.id, alphaState.body.profile.id);
  assert.equal(alphaState.body.viewer.locale, 'bg');
  assert.ok(Number.isInteger(alphaState.body.viewer.familyId));
  assert.equal(alphaState.body.viewer.familyId, betaState.body.viewer.familyId);

  result = await request('/api/family/invites', {
    token: alpha,
    method: 'POST',
    body: { username: 'beta' },
  });
  assert.equal(result.status, 400);

  result = await request('/api/kids', {
    token: alpha,
    method: 'POST',
    body: { name: 'Mila', dob: '2022-01-15' },
  });
  assert.equal(result.status, 200);

  result = await request(`/api/howlers/${alphaEntryId}`, {
    token: beta,
    method: 'PUT',
    body: entryBody({
      childNames: ['Mila', 'Niki', 'mila'],
      title: 'Edited [b]:laugh: by beta[/b]',
      quote: undefined,
      story: undefined,
      content: 'Shared [u]:surprised:[/u]\n\nA [i]silly ending :silly:[/i] then [s]angry :angry:[/s]',
      photo: TINY_PNG,
      category: 'mixed',
      mood: 'hilarious',
      tags: ['shared'],
      isFavorite: false,
      isPublic: true,
    }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.entry.title, 'Edited [b]:laugh: by beta[/b]');
  assert.deepEqual(result.body.entry.childNames, ['Mila', 'Niki']);
  assert.equal(result.body.entry.childName, 'Mila, Niki');
  assert.equal(result.body.entry.ageNote, 'Mila: 4 г. 4 мес.; Niki: 5 г.');
  assert.equal(result.body.entry.quote, '');
  assert.equal(result.body.entry.story, 'Shared [u]:surprised:[/u]\n\nA [i]silly ending :silly:[/i] then [s]angry :angry:[/s]');
  assert.equal(result.body.entry.content, 'Shared [u]:surprised:[/u]\n\nA [i]silly ending :silly:[/i] then [s]angry :angry:[/s]');
  assert.equal(result.body.entry.photo, TINY_PNG);
  assert.equal(result.body.state.entries.find(entry => entry.id === alphaEntryId).photo, TINY_PNG);
  assert.deepEqual(result.body.state.entries.find(entry => entry.id === alphaEntryId).childNames, ['Mila', 'Niki']);
  assert.deepEqual(result.body.state.summary.kidsBreakdown, [
    { childName: 'Niki', total: 2 },
    { childName: 'Mila', total: 1 },
  ]);

  result = await request('/api/feed');
  assert.equal(result.body.some(entry => entry.id === alphaEntryId), true);
  assert.equal(result.body.find(entry => entry.id === alphaEntryId).title, 'Edited [b]:laugh: by beta[/b]');
  assert.match(result.body.find(entry => entry.id === alphaEntryId).content, /Shared \[u\]:surprised:/);
  assert.equal(result.body.find(entry => entry.id === alphaEntryId).photo, TINY_PNG);
  assert.deepEqual(result.body.find(entry => entry.id === alphaEntryId).childNames, ['Mila', 'Niki']);
  assert.deepEqual(result.body.find(entry => entry.id === alphaEntryId).tags, []);
  assert.equal(result.body.some(entry => entry.id === betaEntryId), false);

  result = await request('/api/state', { token: alpha });
  assert.deepEqual(result.body.entries.find(entry => entry.id === alphaEntryId).tags, ['shared']);
  assert.equal(JSON.stringify(result.body).includes('share_token'), false);
  assert.equal(JSON.stringify(result.body).includes('shareToken'), false);

  result = await request(`/api/howlers/${alphaEntryId}/share`, { token: alpha, method: 'POST' });
  assert.equal(result.status, 200);
  assert.equal(result.body.path, `/posts/${alphaEntryId}`);

  result = await request(`/api/howlers/${betaEntryId}/share`, { method: 'POST' });
  assert.equal(result.status, 401);
  result = await request(`/api/howlers/${betaEntryId}/share`, { token: gamma, method: 'POST' });
  assert.equal(result.status, 404);

  result = await request(`/api/howlers/${betaEntryId}/share`, { token: beta, method: 'POST' });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.match(result.body.path, /^\/shared\/[A-Za-z0-9_-]{32}$/);
  const privateSharePath = result.body.path;
  const privateShareToken = privateSharePath.split('/').pop();

  result = await request(`/api/howlers/${betaEntryId}/share`, { token: beta, method: 'POST' });
  assert.equal(result.body.path, privateSharePath);

  result = await request(`/api/shared/${privateShareToken}`);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(result.body.id, betaEntryId);
  assert.equal(result.body.isPublic, false);
  assert.deepEqual(result.body.tags, []);
  assert.equal(JSON.stringify(result.body).includes(privateShareToken), false);

  result = await request(`/api/public/howlers/${alphaEntryId}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.id, alphaEntryId);
  result = await request(`/api/public/howlers/${betaEntryId}`);
  assert.equal(result.status, 404);

  result = await request('/sitemap.xml', { raw: true });
  assert.equal(result.status, 200);
  assert.match(result.body, new RegExp(`<loc>http://127\\.0\\.0\\.1:${port}/</loc>`));
  assert.match(result.body, new RegExp(`<loc>http://127\\.0\\.0\\.1:${port}/posts/${alphaEntryId}</loc>`));
  assert.doesNotMatch(result.body, new RegExp(`/posts/${betaEntryId}</loc>`));
  assert.doesNotMatch(result.body, new RegExp(privateShareToken));

  result = await request('/robots.txt', { raw: true });
  assert.equal(result.status, 200);
  assert.match(result.body, new RegExp(`Sitemap: http://127\\.0\\.0\\.1:${port}/sitemap\\.xml`));
  assert.match(result.body, /Disallow: \/api\//);
  assert.doesNotMatch(result.body, /Disallow: \/shared\//);

  result = await request(`/posts/${alphaEntryId}`, { raw: true });
  assert.equal(result.status, 200);
  assert.match(result.body, /<link rel="canonical"/);
  assert.match(result.body, /Семейни бисери/);
  assert.match(result.body, /"datePublished":"\d{4}-\d{2}-\d{2}T/);
  assert.match(result.body, /data-server-rendered="true"/);
  assert.match(result.body, /<button id="post-detail-share"/);
  assert.doesNotMatch(result.body, /<button hidden id="post-detail-share"/);
  assert.doesNotMatch(result.body, /shared/);
  assert.doesNotMatch(result.body, /id="post-detail-title"/);

  result = await request(privateSharePath, { raw: true });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(result.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(result.body, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(result.body, /<meta name="referrer" content="no-referrer">/);
  assert.match(result.body, /id="post-detail-dialog"/);
  assert.match(result.body, /data-server-rendered="true"/);
  assert.match(result.body, /<button hidden id="post-detail-share"/);
  assert.match(result.body, /aria-labelledby="post-detail-eyebrow"/);
  assert.doesNotMatch(result.body, /id="post-detail-title"/);
  assert.match(result.body, /id="initial-post-detail"/);
  assert.match(result.body, new RegExp(privateShareToken));

  result = await request('/shared/not-a-valid-token', { raw: true });
  assert.equal(result.status, 404);

  result = await request(`/shared/${'A'.repeat(32)}`, { raw: true });
  assert.equal(result.status, 404);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(result.headers.get('x-robots-tag'), 'noindex, nofollow');

  result = await request(`/posts/${betaEntryId}`, { raw: true });
  assert.equal(result.status, 404);

  result = await request('/api/profile', {
    token: alpha,
    method: 'PATCH',
    body: { displayName: 'Alpha Parent' },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.displayName, 'Alpha Parent');
  assert.equal(result.body.profile.displayName, 'Alpha Parent');
  assert.equal(result.body.profile.username, 'alpha');

  result = await request('/api/profile', { token: alpha });
  assert.equal(result.body.displayName, 'Alpha Parent');

  result = await request('/api/profile/avatar', {
    token: alpha,
    method: 'POST',
    body: { avatar: TINY_PNG },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.avatar, TINY_PNG);
  result = await request('/api/profile/avatar', {
    token: alpha,
    method: 'POST',
    body: { avatar: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
  });
  assert.equal(result.status, 400);
  result = await request('/api/profile/avatar', {
    token: alpha,
    method: 'POST',
    body: {
      avatar: `data:image/png;base64,${Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(300 * 1024),
      ]).toString('base64')}`,
    },
  });
  assert.equal(result.status, 400);
  result = await request('/api/profile/avatar', {
    token: alpha,
    method: 'POST',
    body: { avatar: null },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.avatar, null);

  result = await request('/api/profile/password', {
    token: alpha,
    method: 'POST',
    body: { currentPassword: 'secret12', newPassword: 'changed12' },
  });
  assert.equal(result.status, 200);
  result = await request('/api/profile/password', {
    token: alpha,
    method: 'POST',
    body: { currentPassword: 'changed12', newPassword: 'x'.repeat(257) },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'Новата парола трябва да е между 6 и 256 символа.');
  result = await request('/api/login', {
    method: 'POST',
    body: { username: 'alpha', password: 'changed12' },
  });
  assert.equal(result.status, 200);

  result = await request('/api/export?format=txt', { token: beta, raw: true });
  assert.match(result.body, /Edited \[b\]:laugh: by beta\[\/b\]/);
  assert.match(result.body, /Beta entry/);
  assert.match(result.body, /Дете:\s+Mila, Niki/);
  assert.match(result.body, /Възраст:\s+Mila: 4 г\. 4 мес\.; Niki: 5 г\./);
  assert.match(result.body, /Shared \[u\]:surprised:\[\/u\]/);
  assert.match(result.body, /A \[i\]silly ending :silly:\[\/i\] then \[s\]angry :angry:\[\/s\]/);
  assert.match(result.body, /\[Има прикачена снимка\]/);

  result = await request('/api/export?format=pdf', { token: beta, raw: true });
  assert.match(result.body, /<use href="\/emoticons\.svg#laugh"><\/use>/);
  assert.match(result.body, /<use href="\/emoticons\.svg#silly"><\/use>/);
  assert.match(result.body, /<use href="\/emoticons\.svg#angry"><\/use>/);
  assert.match(result.body, /<strong><svg class="inline-emoticon"/);
  assert.match(result.body, /<em>silly ending <svg class="inline-emoticon"/);
  assert.match(result.body, /<s>angry <svg class="inline-emoticon"/);
  assert.match(result.body, /<img class="photo" src="data:image\/png;base64,/);

  result = await request(`/api/howlers/${alphaEntryId}`, {
    token: alpha,
    method: 'PUT',
    body: entryBody({
      title: 'Edited [b]:laugh: by beta[/b]',
      quote: undefined,
      story: undefined,
      content: 'Shared [u]:surprised:[/u]\n\nA [i]silly ending :silly:[/i] then [s]angry :angry:[/s]',
      photo: '',
      category: 'mixed',
      mood: 'hilarious',
      tags: ['shared'],
      isFavorite: false,
      isPublic: true,
    }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.entry.photo, '');
  assert.equal(result.body.state.entries.find(entry => entry.id === alphaEntryId).photo, '');

  result = await request('/api/admin/stats');
  assert.equal(result.status, 200);
  assert.equal(result.body.totalUsers, 4);
  result = await request('/api/admin/users');
  assert.equal(result.status, 200);
  const protectedUser = result.body.find(user => user.username === 'koldkat');
  assert.ok(protectedUser);
  assert.equal(protectedUser.isProtected, true);
  result = await request(`/api/admin/users/${protectedUser.id}`, { method: 'DELETE' });
  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'Този администратор е защитен и не може да бъде изтрит.');
  result = await request('/api/admin/entries');
  assert.equal(result.status, 200);
  assert.equal(result.body.length, 2);
  result = await request('/api/admin/entries/999999', { method: 'PATCH' });
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'Записът не е намерен.');
  result = await request('/api/admin/entries/999999', { method: 'DELETE' });
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'Записът не е намерен.');

  result = await request('/api/logout', { token: gamma, method: 'POST' });
  assert.equal(result.status, 200);
  result = await request('/api/me', { token: gamma });
  assert.equal(result.status, 401);

  assert.equal((await request(`/api/kids/${betaKidId}`, {
    token: alpha,
    method: 'DELETE',
  })).status, 200);
  result = await request(`/api/howlers/${betaEntryId}`, {
    token: alpha,
    method: 'DELETE',
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.state.entries.some(entry => entry.id === betaEntryId), false);
  assert.equal((await request(`/api/shared/${privateShareToken}`)).status, 404);

  console.log('Regression suite passed: auth, profiles, invites, kids, entries, photos, sharing, SEO, feed, export, logout, and admin routes.');
}

main()
  .catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill('SIGTERM');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
