'use strict';

function createSseHub({ db, buildState, buildGuestState }) {
  const clients = new Set();

  function closeClient(client, payload) {
    try {
      if (payload) client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
      client.res.end();
    } catch {}
    clients.delete(client);
  }

  function writePayload(client) {
    try {
      if (client.res.destroyed || client.res.writableEnded) {
        clients.delete(client);
        return false;
      }
      if (client.token && !db.getSession(client.token)) {
        closeClient(client, { sessionExpired: true });
        return false;
      }
      const payload = client.userId ? buildState(client.userId) : buildGuestState();
      if (!payload) {
        closeClient(client);
        return false;
      }
      client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
      return true;
    } catch {
      closeClient(client);
      return false;
    }
  }

  function register({ res, token = '', userId = null }) {
    const client = { res, token, userId };
    clients.add(client);
    writePayload(client);
    return client;
  }

  function unregister(client) {
    clients.delete(client);
  }

  function publishToUser(userId) {
    for (const client of clients) {
      if (client.userId !== userId) continue;
      writePayload(client);
    }
  }

  function publishToUsers(userIds) {
    const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
    for (const userId of uniqueIds) publishToUser(userId);
  }

  function publishToAllClients() {
    for (const client of clients) writePayload(client);
  }

  function closeClients(predicate, payload) {
    for (const client of [...clients]) {
      if (predicate(client)) closeClient(client, payload);
    }
  }

  return {
    register,
    unregister,
    publishToUser,
    publishToUsers,
    publishToAllClients,
    closeClients,
  };
}

module.exports = { createSseHub };
