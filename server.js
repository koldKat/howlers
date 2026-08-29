#!/usr/bin/env node
const http = require('http');
const { createRequestHandler } = require('./server/app');
const { scheduleDatabaseBackups } = require('./server/backup');
const { PORT } = require('./server/config');
const db = require('./server/db');
const { createSseHub } = require('./server/sse');
const { buildGuestState, buildState } = require('./server/state');

const sseHub = createSseHub({ db, buildState, buildGuestState });
const server = http.createServer(createRequestHandler({ sseHub }));

server.listen(PORT, () => {
  const purged = db.purgeExpiredSessions();
  if (purged > 0) console.log(`Purged ${purged} expired session(s).`);
  scheduleDatabaseBackups();
  console.log(`Семейни бисери listening on http://localhost:${PORT}`);
});
