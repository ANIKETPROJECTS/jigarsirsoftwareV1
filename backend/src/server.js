// server.js -- Application entry point
//
// Startup sequence:
//   1. Load environment variables (.env).
//   2. Connect to gms_admin (adminDB) -- central database for Company, User, Role, Permission.
//   3. connectionManager.init(adminDB) -- loads ALL company records from gms_admin and
//      creates one Sequelize connection pool per company database (gms_ads, gms_test, etc).
//      This runs BEFORE the HTTP server starts so that req.db is always ready.
//   4. Start HTTP server and begin accepting requests.
//
// If init fails (e.g. gms_admin is unreachable), the process exits with code 1
// so that process managers (PM2, Docker) can restart it.
require('dotenv').config();

const adminDB           = require('./config/adminDatabase');
const connectionManager = require('./config/connectionManager');
const app               = require('./app');

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    // Step 1: verify gms_admin connection
    await adminDB.authenticate();
    console.log('[startup] Connected to gms_admin');

    // Step 2: load all company DB connections from gms_admin
    // After this call, connectionManager.getDB(compID) works for every active company.
    await connectionManager.init(adminDB);
    console.log('[startup] All company databases loaded');

    // Step 3: start accepting HTTP requests
    app.listen(PORT, () => {
      console.log(`[startup] GMS API server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('[startup] FATAL: could not initialize server', err);
    process.exit(1);
  }
}

start();
