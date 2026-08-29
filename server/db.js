// Stable persistence facade. Feature repositories own their queries and can evolve independently.
module.exports = {
  ...require('./db/accounts'),
  ...require('./db/entries'),
  ...require('./db/families'),
  ...require('./db/admin'),
};
