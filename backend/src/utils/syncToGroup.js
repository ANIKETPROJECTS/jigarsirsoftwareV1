'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// syncToGroup.js  —  Replicate shared master changes across a company group
//
// WHAT ARE SHARED MASTERS?
//   mState, mHoliday, mItem, mGodown, mEmployee
//
//   RULE:
//     • Only the Primary company (e.g. ADS in BHW group) can CREATE / EDIT / DELETE.
//     • All other companies in the group (e.g. TEST) get read-only copies.
//     • When the Primary writes, this utility syncs to every other company DB
//       in the same group automatically — the user never sees this.
//
// fkCompID HANDLING:
//   Each company DB stores records with its OWN compID in fkCompID so that
//   reads with WHERE fkCompID = req.user.compID work on every company DB.
//   On upsert we therefore override fkCompID to the sibling's compID.
//
// USAGE (inside a shared master route — after writing to primary DB):
//   await syncToGroup({
//     req,                     // req.user.groupID, req.user.compID
//     modelFactory,            // e.g. defineState
//     record: row.dataValues,  // plain object from primary DB
//     operation: 'upsert',     // 'upsert' | 'softDelete'
//     pkField: 'pkStateID',    // PK field name (used for softDelete WHERE)
//   });
// ─────────────────────────────────────────────────────────────────────────────
const connectionManager = require('../config/connectionManager');

async function syncToGroup({ req, modelFactory, record, operation, pkField }) {
  const { groupID, compID: primaryCompID } = req.user;

  // All companies in the group except the caller (primary already wrote directly)
  const siblings = connectionManager
    .getGroupCompanyIDs(groupID)
    .filter(cid => cid !== primaryCompID);

  if (siblings.length === 0) return;

  await Promise.all(siblings.map(async (sibCompID) => {
    const db = connectionManager.getDB(sibCompID);
    if (!db) return;

    const Model = modelFactory(db);

    if (operation === 'upsert') {
      // Override fkCompID so the sibling can read with WHERE fkCompID = its own compID
      await Model.upsert({ ...record, fkCompID: sibCompID });
    } else if (operation === 'softDelete') {
      await Model.update(
        { Active: 'N' },
        { where: { [pkField]: record[pkField] } }
      );
    }
  }));
}

module.exports = { syncToGroup };
