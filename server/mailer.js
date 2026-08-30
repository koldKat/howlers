'use strict';

const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { once } = require('node:events');
const db = require('./db/connection');

const SECURITY_VALUES = new Set(['starttls', 'tls', 'none']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SMTP_TIMEOUT_MS = 15_000;
const clean = (value, limit = 500) => String(value || '').trim().slice(0, limit);

function encodeHeader(value) {
  const safe = String(value || '').replace(/[\r\n]/g, '');
  return /^[\x20-\x7e]*$/.test(safe)
    ? safe
    : `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
}

function applySocketTimeout(socket) {
  socket.setTimeout(SMTP_TIMEOUT_MS, () => {
    socket.destroy(new Error('SMTP връзката изтече.'));
  });
  return socket;
}

function settings() {
  return db.prepare('SELECT host, port, security, username, password, sender FROM mail_settings WHERE id = 1').get() || null;
}

function publicSettings() {
  const value = settings();
  if (!value) return {
    configured: false, host: '', port: 465, security: 'tls', username: '', sender: '', hasPassword: false,
  };
  return {
    configured: Boolean(value.host && value.sender && value.password),
    host: value.host,
    port: Number(value.port),
    security: value.security,
    username: value.username,
    sender: value.sender,
    hasPassword: Boolean(value.password),
  };
}

function saveSettings(input = {}) {
  const previous = settings() || {};
  const host = clean(input.host, 255).toLowerCase();
  const sender = clean(input.sender, 254).toLowerCase();
  const port = Number(input.port);
  const security = clean(input.security, 20);
  const username = clean(input.username, 254);
  const password = input.password == null || input.password === ''
    ? previous.password || ''
    : String(input.password).slice(0, 1000);
  if (!host || /\s/.test(host)) throw new Error('SMTP сървърът е задължителен.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP портът трябва да е между 1 и 65535.');
  if (!SECURITY_VALUES.has(security)) throw new Error('Избери STARTTLS, TLS или връзка без транспортно криптиране.');
  if (!EMAIL_PATTERN.test(sender)) throw new Error('Адресът на подателя не е валиден.');
  if (!password) throw new Error('SMTP паролата е задължителна.');
  db.prepare(`INSERT INTO mail_settings (id, host, port, security, username, password, sender, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    ON CONFLICT(id) DO UPDATE SET host=excluded.host, port=excluded.port, security=excluded.security,
      username=excluded.username, password=excluded.password, sender=excluded.sender,
      updated_at=strftime('%s', 'now')`)
    .run(host, port, security, username, password, sender);
  return publicSettings();
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let value = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('end', onEnd);
      socket.off('close', onClose);
      if (error) reject(error); else resolve(result);
    };
    const onError = error => finish(error);
    const onEnd = () => finish(new Error('SMTP сървърът затвори връзката без отговор.'));
    const onClose = () => finish(new Error('SMTP връзката беше прекъсната.'));
    const onData = chunk => {
      value += chunk.toString('utf8');
      const last = value.split(/\r?\n/).filter(Boolean).at(-1);
      if (last && /^\d{3} /.test(last)) finish(null, { code: Number(last.slice(0, 3)), text: value });
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('end', onEnd);
    socket.once('close', onClose);
  });
}

async function command(socket, line, expectedCodes) {
  socket.write(`${line}\r\n`);
  const result = await readResponse(socket);
  if (!expectedCodes.includes(result.code)) throw new Error(`SMTP отхвърли ${line.split(' ')[0]} (${result.code}).`);
  return result;
}

async function openSocket(config) {
  const socket = applySocketTimeout(config.security === 'tls'
    ? tls.connect({ host: config.host, port: config.port, servername: config.host })
    : net.createConnection({ host: config.host, port: config.port }));
  const greeting = readResponse(socket);
  const event = config.security === 'tls' ? 'secureConnect' : 'connect';
  const [, response] = await Promise.all([once(socket, event), greeting]);
  return { socket, greeting: response };
}

function message({ config, to, subject, text, html = '' }) {
  const headers = [
    `From: ${encodeHeader('Семейни бисери')} <${config.sender}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
  ];
  if (!html) return [...headers, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', text].join('\r\n');
  const boundary = `=_howlers_${crypto.randomBytes(12).toString('hex')}`;
  return [...headers, `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', text,
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', html,
    `--${boundary}--`, ''].join('\r\n');
}

async function send({ to, subject, text, html = '' }) {
  const config = settings();
  if (!config?.host || !config?.sender || !config?.password) throw new Error('Изпращането на имейли не е настроено.');
  const recipient = clean(to, 254);
  if (!EMAIL_PATTERN.test(recipient)) throw new Error('Получателят трябва да е валиден имейл адрес.');
  const opened = await openSocket(config);
  let socket = opened.socket;
  try {
    if (opened.greeting.code !== 220) throw new Error(`SMTP сървърът отхвърли връзката (${opened.greeting.code}).`);
    const hello = await command(socket, 'EHLO biseri.net', [250]);
    if (config.security === 'starttls') {
      if (!/STARTTLS/i.test(hello.text)) throw new Error('SMTP сървърът не предлага STARTTLS.');
      await command(socket, 'STARTTLS', [220]);
      socket = applySocketTimeout(tls.connect({ socket, servername: config.host }));
      await once(socket, 'secureConnect');
      await command(socket, 'EHLO biseri.net', [250]);
    }
    if (config.username) {
      const auth = Buffer.from(`\u0000${config.username}\u0000${config.password}`).toString('base64');
      await command(socket, `AUTH PLAIN ${auth}`, [235]);
    }
    await command(socket, `MAIL FROM:<${config.sender}>`, [250]);
    await command(socket, `RCPT TO:<${recipient}>`, [250, 251]);
    await command(socket, 'DATA', [354]);
    const body = message({ config, to: recipient, subject, text, html }).replace(/^\./gm, '..');
    await command(socket, `${body}\r\n.`, [250]);
    await command(socket, 'QUIT', [221]);
  } finally {
    socket.destroy();
  }
}

module.exports = { publicSettings, saveSettings, send, message };
