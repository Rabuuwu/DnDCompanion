// Integration scripts create/delete records. Require a deliberate test environment
// before importing the database pool or loading a repository .env file.
function requireTestEnvironment(env = process.env) {
  if (env.NODE_ENV !== 'test') {
    throw new Error('Integration tests require NODE_ENV=test and an isolated test database/API');
  }
  let database;
  try {
    database = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('Integration tests require an explicit test DATABASE_URL');
  }
  const databaseName = decodeURIComponent(database.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !/(^|[_-])test([_-]|$)/i.test(databaseName)) {
    throw new Error('Integration tests require a database name containing a separate test segment');
  }
}

module.exports = { requireTestEnvironment };
