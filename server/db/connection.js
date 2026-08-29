'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const { initializeSchema } = require('./schema');

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, '..', '..', 'database.sqlite');
const connection = new Database(databasePath);

connection.pragma('journal_mode = WAL');
connection.pragma('foreign_keys = ON');
initializeSchema(connection);

module.exports = connection;
