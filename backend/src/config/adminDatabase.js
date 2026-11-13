// ─────────────────────────────────────────────────────────────────────────────
// adminDatabase.js  —  Sequelize connection to gms_admin
//
// gms_admin is the CENTRAL database that stores system-level data:
//   mCompanyGroup  — company groups (e.g. BHW, VLCO)
//   mCompany       — companies (ADS, TEST, VLCO, TEST1) with dbName + IsPrimary
//   mUser          — user accounts (shared across a group)
//   mRole          — roles per group
//   mPermission    — module permissions per role
//
// This connection is created ONCE at startup and never changes.
// All admin routes and auth routes use this connection.
//
// Company-specific data lives in separate per-company databases managed
// by connectionManager.js — NOT by this file.
// ─────────────────────────────────────────────────────────────────────────────
const { Sequelize } = require('sequelize');

const adminDB = new Sequelize(
  process.env.ADMIN_DB_NAME || 'gms_admin',
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host:    process.env.DB_HOST || 'localhost',
    port:    parseInt(process.env.DB_PORT)  || 3306,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max:     5,    // admin DB is low-traffic; 5 connections is plenty
      min:     0,
      acquire: 30000,
      idle:    10000,
    },
    define: {
      timestamps:     false,
      freezeTableName: true,
    },
  }
);

module.exports = adminDB;
