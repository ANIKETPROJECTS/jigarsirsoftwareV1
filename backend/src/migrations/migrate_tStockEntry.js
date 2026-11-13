// migrate_tStockEntry.js
// Adds new columns to tStockEntry in ALL company databases.
// Safe to run multiple times — skips columns that already exist.
//
// Usage:  node src/migrations/migrate_tStockEntry.js
//
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Sequelize } = require('sequelize');

// Columns to add: [ name, definition, afterColumn ]
const NEW_COLUMNS = [
  ['ItemExtDesc',   "VARCHAR(200) NOT NULL DEFAULT ''",  'fkItemID'],
  ['PackingType',   "VARCHAR(50)  NOT NULL DEFAULT ''",  'Packing'],
  ['PackingColour', "VARCHAR(50)  NOT NULL DEFAULT ''",  'PackingType'],
  ['HmlBillAmt',   'DECIMAL(10,2) NOT NULL DEFAULT 0',  'HamaliAmt'],
  ['OutsideLabr',  "CHAR(2)       NOT NULL DEFAULT 'N'", 'OtherHmlAmt'],
  ['OwnTransFlg',  "CHAR(2)       NOT NULL DEFAULT 'N'", 'OutsideLabr'],
  ['TransExtDetail','TEXT          NULL',                 'BENum'],
  ['BatchNum',     'TEXT          NULL',                  'TransRemark'],
  ['TransNote',    'TEXT          NULL',                  'BatchNum'],
];

async function addColumnIfMissing(db, dbName, colName, colDef, afterCol) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tStockEntry' AND COLUMN_NAME = ?`,
    { replacements: [dbName, colName] }
  );
  if (Number(rows[0].cnt) > 0) {
    console.log(`  [SKIP]  ${colName} already exists`);
    return;
  }
  const sql = `ALTER TABLE tStockEntry ADD COLUMN \`${colName}\` ${colDef} AFTER \`${afterCol}\``;
  await db.query(sql);
  console.log(`  [ADDED] ${colName}`);
}

async function migrateDB(dbName) {
  console.log(`\n── ${dbName} ──────────────────────────`);
  const db = new Sequelize(
    dbName,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      host:    process.env.DB_HOST     || 'localhost',
      port:    parseInt(process.env.DB_PORT) || 3306,
      dialect: 'mysql',
      logging: false,
    }
  );
  try {
    await db.authenticate();
    for (const [name, def, after] of NEW_COLUMNS) {
      await addColumnIfMissing(db, dbName, name, def, after);
    }
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
  } finally {
    await db.close();
  }
}

async function main() {
  // Read company databases from gms_admin
  const adminDB = new Sequelize(
    process.env.ADMIN_DB_NAME || 'gms_admin',
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      host:    process.env.DB_HOST     || 'localhost',
      port:    parseInt(process.env.DB_PORT) || 3306,
      dialect: 'mysql',
      logging: false,
    }
  );

  let companies = [];
  try {
    await adminDB.authenticate();
    const [rows] = await adminDB.query(`SELECT dbName FROM mCompany WHERE Active = 'Y'`);
    companies = rows.map((r) => r.dbName);
    await adminDB.close();
  } catch (err) {
    console.error('Cannot connect to gms_admin:', err.message);
    process.exit(1);
  }

  if (!companies.length) {
    console.log('No active companies found in gms_admin.mCompany');
    process.exit(0);
  }

  console.log(`Found ${companies.length} company database(s): ${companies.join(', ')}`);

  for (const dbName of companies) {
    await migrateDB(dbName);
  }

  console.log('\nMigration complete.');
}

main();
