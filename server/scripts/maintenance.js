require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const { pool } = require('../src/db');
const { runDatabaseMaintenance } = require('../src/maintenance');

runDatabaseMaintenance()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  });
