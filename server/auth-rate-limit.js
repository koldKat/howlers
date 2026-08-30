'use strict';

const {
  AUTH_FAILURE_LIMIT,
  AUTH_FAILURE_WINDOW_MS,
  PASSWORD_RESET_REQUEST_LIMIT,
} = require('./config');

const failures = new Map();
const resetRequests = new Map();

function purgeExpiredEvents(events, now = Date.now()) {
  for (const [ip, timestamps] of events) {
    const recent = timestamps.filter(at => now - at < AUTH_FAILURE_WINDOW_MS);
    if (recent.length) events.set(ip, recent);
    else events.delete(ip);
  }
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  purgeExpiredEvents(failures, now);
  purgeExpiredEvents(resetRequests, now);
}, AUTH_FAILURE_WINDOW_MS);
cleanupTimer.unref();

function clientIp(req) {
  const remoteAddress = String(req.socket.remoteAddress || '').trim();
  const isLoopback = remoteAddress === '127.0.0.1'
    || remoteAddress === '::1'
    || remoteAddress === '::ffff:127.0.0.1';
  if (!isLoopback) return remoteAddress;
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  return forwarded.at(-1) || remoteAddress;
}

function recentEvents(events, ip) {
  const now = Date.now();
  const recent = (events.get(ip) || []).filter(at => now - at < AUTH_FAILURE_WINDOW_MS);
  if (recent.length) events.set(ip, recent);
  else events.delete(ip);
  return recent;
}

const recentFailures = ip => recentEvents(failures, ip);

function isRateLimited(ip) {
  return recentFailures(ip).length >= AUTH_FAILURE_LIMIT;
}

function recordFailure(ip) {
  failures.set(ip, [...recentFailures(ip), Date.now()]);
}

function clearFailures(ip) {
  failures.delete(ip);
}

function recordPasswordResetRequest(ip) {
  resetRequests.set(ip, [...recentEvents(resetRequests, ip), Date.now()]);
}

function isPasswordResetRateLimited(ip) {
  return recentEvents(resetRequests, ip).length >= PASSWORD_RESET_REQUEST_LIMIT;
}

module.exports = {
  clientIp,
  isRateLimited,
  recordFailure,
  clearFailures,
  recordPasswordResetRequest,
  isPasswordResetRateLimited,
};
