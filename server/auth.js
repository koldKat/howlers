'use strict';

const db = require('./db');
const { send, tokenFromReq } = require('./http');

async function authenticate(req, res) {
  const token = tokenFromReq(req);
  if (!token) {
    send(res, 401, { error: 'Нямаш достъп. Влез отново в профила си.' });
    return null;
  }
  const session = db.getSession(token);
  if (!session) {
    send(res, 401, { error: 'Нямаш достъп. Влез отново в профила си.' });
    return null;
  }
  return session;
}

module.exports = { authenticate };
