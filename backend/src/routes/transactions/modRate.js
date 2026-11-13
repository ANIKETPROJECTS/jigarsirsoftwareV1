// MODIFY RATE — Transaction Rate Entry  (frmModRate.frm / frmTransRate migration)
// /api/transactions/mod-rate
//
// Allows supervisors to view and bulk-edit financial fields on existing
// tStockEntry rows across ALL transaction types (ARV, DESP, DESPRET, TRF, IN, OUT).
//
// Permissions:
//   MOD_RATE / CanView    — GET endpoints (fa-years, entries, search-values)
//   MOD_RATE / CanEdit    — PUT /entries (batch update)
//
// Cross-company: each company in the group has its own DB.
// GET /entries loops over all group companies, queries each DB, merges in Node.js.
// (MySQL cross-schema UNION ALL is not used — each query scoped to one DB.)
//
// VB6 mapping:
//   cmdView_Click     → GET /entries
//   cmdSave_Click     → PUT /entries
//   cobFaYear         → GET /fa-years
//   cobSelField       → GET /search-values
//   vfgModRate_AfterEdit → enforced by frontend edit rules; validated on save
//   cmdValidate_Click → hamali validation rules in PUT /entries (also in frontend)

const router            = require('express').Router();
const requireAuth       = require('../../middleware/auth');
const requirePerm       = require('../../middleware/permission');
const connectionManager = require('../../config/connectionManager');

router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Hamali validation per VB6 cmdValidate_Click rules.
// Returns null if valid, or an error string.
// VB6 logic: each HamaliCode has specific valid ranges for HamaliRecd, HamaliAmt,
// OutsideLabr, OtherHmlAmt, and OwnTransFlg.
function validateHamali(row) {
  const code = (row.HamaliCode || '').trim();
  const recd = parseFloat(row.HamaliRecd) || 0;
  const amt  = parseFloat(row.HamaliAmt)  || 0;
  const outL = parseFloat(row.OutsideLabr) || 0;
  const othH = parseFloat(row.OtherHmlAmt) || 0;
  const own  = row.OwnTransFlg;

  switch (code) {
    case 'CR':
      // Cash Receipt — recd > 0, amt must be 0
      if (recd <= 0) return `LotNum ${row.LotNum}: CR code requires HamaliRecd > 0`;
      if (amt !== 0) return `LotNum ${row.LotNum}: CR code requires HamaliAmt = 0`;
      break;
    case 'CB':
      // Cash + Bank — recd > 0 or amt > 0
      if (recd <= 0 && amt <= 0) return `LotNum ${row.LotNum}: CB code requires HamaliRecd or HamaliAmt > 0`;
      break;
    case 'OA':
      // On Account — recd must be 0
      if (recd !== 0) return `LotNum ${row.LotNum}: OA code requires HamaliRecd = 0`;
      break;
    case 'OB':
      // On Account + Bank — recd must be 0, amt > 0
      if (recd !== 0) return `LotNum ${row.LotNum}: OB code requires HamaliRecd = 0`;
      if (amt <= 0)   return `LotNum ${row.LotNum}: OB code requires HamaliAmt > 0`;
      break;
    case 'VB':
      // Varai + Bank — recd must be 0, amt > 0
      if (recd !== 0) return `LotNum ${row.LotNum}: VB code requires HamaliRecd = 0`;
      if (amt <= 0)   return `LotNum ${row.LotNum}: VB code requires HamaliAmt > 0`;
      break;
    case 'OC':
      // On Account (recd > 0) — recd > 0
      if (recd <= 0) return `LotNum ${row.LotNum}: OC code requires HamaliRecd > 0`;
      break;
    case 'VC':
      // Varai — recd must be 0
      if (recd !== 0) return `LotNum ${row.LotNum}: VC code requires HamaliRecd = 0`;
      break;
    case 'NO':
      // No Entry — all hamali fields must be 0
      if (recd !== 0 || amt !== 0 || outL !== 0 || othH !== 0)
        return `LotNum ${row.LotNum}: NO code requires all hamali fields = 0`;
      break;
    case 'BA':
      // Bill Amount — HmlBillAmt must be set
      if (!row.HmlBillAmt || parseFloat(row.HmlBillAmt) <= 0)
        return `LotNum ${row.LotNum}: BA code requires HmlBillAmt > 0`;
      break;
    case 'LA':
      // Labour Amount — OutsideLabr must be set
      if (outL <= 0) return `LotNum ${row.LotNum}: LA code requires OutsideLabr > 0`;
      break;
    default:
      break;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /fa-years
// Returns distinct active financial years across all group company DBs.
// VB6: cobFaYear populated from FaYearInfo table in Form_Load.
// ─────────────────────────────────────────────────────────────────────────────
// Returns [{ faYear, startDt, endDt }] for the FaYear dropdown.
// Frontend uses startDt/endDt to auto-fill the date range when the user
// selects a year (VB6 cobFaYear_Validate behaviour).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/fa-years', requirePerm('MOD_RATE', 'CanView'), async (req, res) => {
  try {
    const { groupID, branchID } = req.user;
    const companies = connectionManager.getGroupCompanyDetails(groupID);

    const yearSets = await Promise.all(
      companies.map(async (c) => {
        const db = connectionManager.getDB(c.pkCompID);
        if (!db) return [];
        const [rows] = await db.query(
          `SELECT FaYear,
                  DATE_FORMAT(MIN(StartDate), '%Y-%m-%d') AS startDt,
                  DATE_FORMAT(MAX(EndDate),   '%Y-%m-%d') AS endDt
           FROM FaYearInfo
           WHERE fkBranchID = ? AND Active = 'Y'
           GROUP BY FaYear
           ORDER BY FaYear DESC`,
          { replacements: [branchID] }
        );
        return rows; // [{ faYear, startDt, endDt }]
      })
    );

    // Merge across companies: de-duplicate by FaYear, keep widest date range
    const byYear = {};
    for (const row of yearSets.flat()) {
      const y = row.FaYear;
      if (!byYear[y]) {
        byYear[y] = { faYear: y, startDt: row.startDt, endDt: row.endDt };
      } else {
        if (row.startDt < byYear[y].startDt) byYear[y].startDt = row.startDt;
        if (row.endDt   > byYear[y].endDt)   byYear[y].endDt   = row.endDt;
      }
    }

    const result = Object.values(byYear).sort((a, b) => b.faYear.localeCompare(a.faYear));
    res.json(result);
  } catch (err) {
    console.error('GET /fa-years error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /entries
// Main transaction grid data query — mirrors VB6 cmdView_Click SQL.
//
// Body params (all optional unless noted):
//   startDate   {string}   'YYYY-MM-DD'  — filter ts.TransDt >= startDate
//   endDate     {string}   'YYYY-MM-DD'  — filter ts.TransDt <= endDate (required)
//   faYear      {string}   filter by FaYear when useFaYear=true
//   useFaYear   {boolean}
//   transTypes  {string[]} e.g. ['ARV','DESP','DESPRET','TRF','IN','OUT']
//   searchField {string}   column name to filter (e.g. 'LotNum', 'GatePass')
//   searchValue {string}   value to match (LIKE '%val%')
//
// Cross-company: queries each company DB separately, merges in Node.js.
// Each row gets compID/compName added so the frontend can colour by company.
//
// VB6 SQL (translated to MySQL):
//   SELECT ... FROM tStockEntry ts
//     JOIN mParty pm ON ts.fkPartyID = pm.pkPartyID
//     JOIN mItem  im ON ts.fkItemID  = im.pkItemID
//     JOIN mGodown gm ON ts.fkGodownID1 = gm.pkGodownID
//     JOIN tStockEntry ts1 ON ts.pfkLotID = ts1.pfkLotID AND ts1.TransType = 'ARV'
//   WHERE ts.fkCompID = ? AND ts.fkBranchID = ?
//     AND ts.TransDt BETWEEN ? AND ?
//     AND ts.TransType IN (...)
//   ORDER BY ts.TransDt DESC, ts.TransType, ts.GatePass DESC, ts.DoNum DESC, ts1.LotNum DESC
// ─────────────────────────────────────────────────────────────────────────────
router.post('/entries', requirePerm('MOD_RATE', 'CanView'), async (req, res) => {
  try {
    const { groupID, branchID } = req.user;
    const {
      startDate,
      endDate,
      faYear,
      useFaYear,
      transTypes,
      searchField,
      searchValue,
    } = req.body;

    if (!endDate) return res.status(400).json({ error: 'endDate is required' });

    const types = Array.isArray(transTypes) && transTypes.length > 0
      ? transTypes
      : ['ARV', 'DESP', 'DESPRET', 'TRF', 'IN', 'OUT'];

    const companies = connectionManager.getGroupCompanyDetails(groupID);

    const allRows = await Promise.all(
      companies.map(async (c) => {
        const db = connectionManager.getDB(c.pkCompID);
        if (!db) return [];

        // Allowed search fields to prevent SQL injection (whitelist)
        const allowedSearchFields = new Set([
          'LotNum', 'GatePass', 'DoNum', 'VehiNum', 'BENum', 'BatchNum',
          'pm.pName', 'im.iName', 'gm.gNum',
        ]);

        let whereExtra = '';
        const replacements = [c.pkCompID, branchID];

        if (useFaYear && faYear) {
          whereExtra += ' AND ts.FaYear = ?';
          replacements.push(faYear);
          if (startDate) { whereExtra += ' AND ts.TransDt >= ?'; replacements.push(startDate); }
          if (endDate)   { whereExtra += ' AND ts.TransDt <= ?'; replacements.push(endDate); }
        } else {
          if (startDate) { whereExtra += ' AND ts.TransDt >= ?'; replacements.push(startDate); }
          whereExtra += ' AND ts.TransDt <= ?';
          replacements.push(endDate);
        }

        const typePlaceholders = types.map(() => '?').join(',');
        whereExtra += ` AND ts.TransType IN (${typePlaceholders})`;
        replacements.push(...types);

        // LotNum filter deferred to Node.js (LotNum comes from the ARV row, not ts)
        let searchOnLotNum = false;
        if (searchField && searchValue && allowedSearchFields.has(searchField)) {
          const colMap = {
            GatePass:   'ts.GatePass',
            DoNum:      'ts.DoNum',
            VehiNum:    'ts.VehiNum',
            BENum:      'ts.BENum',
            BatchNum:   'ts.BatchNum',
            'pm.pName': 'pm.pName',
            'im.iName': 'im.iName',
            'gm.gNum':  'gm.gNum',
          };
          const col = colMap[searchField] || null;
          if (col) {
            whereExtra += ` AND ${col} LIKE ?`;
            replacements.push(`%${searchValue}%`);
          } else if (searchField === 'LotNum') {
            searchOnLotNum = true;
          }
        }

        // Query 1: Main transaction rows — no self-join, no filesort on joined columns.
        // ts.pfkLotID kept for the Node.js join below.
        const sql = `
          SELECT
            ts.pkTransID,
            ts.TransType,
            ts.pfkLotID,
            pm.pName,
            im.iName,
            gm.gNum,
            DATE_FORMAT(ts.TransDt, '%Y-%m-%d')   AS TransDt,
            TIME_FORMAT(ts.TransTm, '%H:%i')       AS TransTm,
            ts.TransQty,
            ts.DoNum,
            ts.GatePass,
            ts.RentRate,
            ts.ItemRate,
            ts.ActualWght,
            ts.pfkOriLotID,
            ts.fkCompID,
            ts.fkBranchID,
            ts.fkPartyID,
            ts.fkItemID,
            ts.fkGodownID1,
            ts.OpFlg,
            ts.HamaliRecd,
            ts.HamaliAmt,
            ts.TransExtDetail,
            ts.DelivOpt,
            ts.BatchNum,
            ts.BENum,
            ts.VehiNum,
            ts.TransRemark,
            ts.UserID,
            ts.OutsideLabr,
            ts.OtherHmlAmt,
            ts.OwnTransFlg,
            ts.PickupBy,
            ts.HmlBillAmt,
            ts.HamaliCode,
            ts.FaYear
          FROM tStockEntry ts
          JOIN mParty     pm  ON ts.fkPartyID   = pm.pkPartyID
          JOIN mItem      im  ON ts.fkItemID    = im.pkItemID
          JOIN mGodown    gm  ON ts.fkGodownID1 = gm.pkGodownID
          WHERE ts.fkCompID  = ?
            AND ts.fkBranchID = ?
            ${whereExtra}
          ORDER BY ts.TransDt DESC, ts.TransType,
                   ts.GatePass DESC, ts.DoNum DESC
        `;

        console.log(
          `\n─── MOD-RATE /entries query [${c.CompName || c.pkCompID}] ───\n` +
          interpolateSQL(sql, replacements) +
          '\n─────────────────────────────────────────────────────────\n'
        );

        const [mainRows] = await db.query(sql, { replacements });

        // Query 2: Fetch ARV-level fields for the distinct lot IDs in the result.
        // IN (...) with a small list is O(n log n) instead of the prior O(n²) self-join.
        const lotIDs = [...new Set(mainRows.map((r) => r.pfkLotID).filter(Boolean))];
        const arvMap = {};
        if (lotIDs.length > 0) {
          const [arvRows] = await db.query(
            `SELECT pfkLotID, LotNum, ItemExtDesc, Packing, PackWght,
                    GrossWght, PackingType, PackingColour
             FROM tStockEntry
             WHERE fkCompID = ?
               AND pfkLotID IN (${lotIDs.map(() => '?').join(',')})
               AND TransType = 'ARV'`,
            { replacements: [c.pkCompID, ...lotIDs] }
          );
          for (const arv of arvRows) arvMap[arv.pfkLotID] = arv;
        }

        // Merge ARV fields into each row, replicating the original INNER JOIN behaviour
        // (rows with no matching ARV entry are excluded).
        let rows = mainRows
          .filter((r) => arvMap[r.pfkLotID])
          .map((r) => ({
            ...r,
            TransQty:      Math.abs(parseFloat(r.TransQty) || 0),
            LotNum:        arvMap[r.pfkLotID].LotNum,
            ItemExtDesc:   arvMap[r.pfkLotID].ItemExtDesc,
            Packing:       arvMap[r.pfkLotID].Packing,
            PackWght:      arvMap[r.pfkLotID].PackWght,
            GrossWght:     arvMap[r.pfkLotID].GrossWght,
            PackingType:   arvMap[r.pfkLotID].PackingType,
            PackingColour: arvMap[r.pfkLotID].PackingColour,
            compName:      c.CompName,
            compAlias:     c.CompAlias,
          }));

        // LotNum search applied in Node.js now that the field is available
        if (searchOnLotNum && searchValue) {
          const sv = searchValue.toLowerCase();
          rows = rows.filter((r) => (r.LotNum || '').toLowerCase().includes(sv));
        }

        return rows;
      })
    );

    // Merge all company results sorted by TransDt DESC, then by LotNum DESC
    // (LotNum sort now done here in Node.js — no SQL filesort needed)
    const merged = allRows
      .flat()
      .sort((a, b) => {
        if (b.TransDt !== a.TransDt) return b.TransDt.localeCompare(a.TransDt);
        const tCmp = (a.TransType || '').localeCompare(b.TransType || '');
        if (tCmp !== 0) return tCmp;
        const gpCmp = String(b.GatePass || '').localeCompare(String(a.GatePass || ''));
        if (gpCmp !== 0) return gpCmp;
        const dnCmp = String(b.DoNum || '').localeCompare(String(a.DoNum || ''));
        if (dnCmp !== 0) return dnCmp;
        return String(b.LotNum || '').localeCompare(String(a.LotNum || ''));
      });

    res.json(merged);
  } catch (err) {
    console.error('POST /entries error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /search-values
// Returns distinct values for the chosen search field — used to populate the
// search value autocomplete (VB6 cobSelField_Validate → fills cobSelVal).
//
// Query params:
//   field       {string}   one of: LotNum, GatePass, DoNum, VehiNum, BENum, BatchNum
//   startDate   {string}
//   endDate     {string}
// ─────────────────────────────────────────────────────────────────────────────
router.get('/search-values', requirePerm('MOD_RATE', 'CanView'), async (req, res) => {
  try {
    const { groupID, branchID } = req.user;
    const { field, startDate, endDate } = req.query;

    // Whitelist + mapping: frontend field name → SQL expression
    const fieldMap = {
      LotNum:   { col: 'ts1.LotNum',  join: true  },
      GatePass: { col: 'ts.GatePass', join: false },
      DoNum:    { col: 'ts.DoNum',    join: false },
      VehiNum:  { col: 'ts.VehiNum',  join: false },
      BENum:    { col: 'ts.BENum',    join: false },
      BatchNum: { col: 'ts.BatchNum', join: false },
    };

    const fieldInfo = fieldMap[field];
    if (!fieldInfo) return res.status(400).json({ error: 'Invalid field' });

    const companies = connectionManager.getGroupCompanyDetails(groupID);

    const allValues = await Promise.all(
      companies.map(async (c) => {
        const db = connectionManager.getDB(c.pkCompID);
        if (!db) return [];

        const replacements = [c.pkCompID, branchID];
        let dateWhere = '';
        if (startDate) { dateWhere += ' AND ts.TransDt >= ?'; replacements.push(startDate); }
        if (endDate)   { dateWhere += ' AND ts.TransDt <= ?'; replacements.push(endDate); }

        const joinClause = fieldInfo.join
          ? `JOIN tStockEntry ts1 ON ts.pfkLotID = ts1.pfkLotID AND ts1.TransType = 'ARV'`
          : `JOIN tStockEntry ts1 ON ts.pfkLotID = ts1.pfkLotID AND ts1.TransType = 'ARV'`;

        const sql = `
          SELECT DISTINCT ${fieldInfo.col} AS val
          FROM tStockEntry ts
          ${joinClause}
          WHERE ts.fkCompID = ? AND ts.fkBranchID = ?
            ${dateWhere}
            AND ${fieldInfo.col} IS NOT NULL
            AND ${fieldInfo.col} <> ''
          ORDER BY ${fieldInfo.col}
          LIMIT 500
        `;

        const [rows] = await db.query(sql, { replacements });
        return rows.map((r) => r.val).filter(Boolean);
      })
    );

    const merged = [...new Set(allValues.flat())].sort();
    res.json(merged);
  } catch (err) {
    console.error('GET /search-values error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /entries
// Saves only the two fields the user can edit in this screen:
//   RentRate — ARV / DESPRET / IN rows only (required, cannot be blank)
//   LotNum   — ARV rows only (required, cannot be blank)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/entries', requirePerm('MOD_RATE', 'CanEdit'), async (req, res) => {
  try {
    const { userId } = req.user;
    const { rows } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'No rows to update' });
    }

    // Validate before touching DB
    for (const row of rows) {
      const transType = row.TransType || '';
      if (['ARV', 'DESPRET', 'IN'].includes(transType)) {
        if (row.RentRate === null || row.RentRate === undefined || String(row.RentRate).trim() === '') {
          return res.status(400).json({ error: `Rate cannot be blank for Lot No. ${row.LotNum}` });
        }
      }
      if (transType === 'ARV' && !String(row.LotNum ?? '').trim()) {
        return res.status(400).json({ error: `Lot No cannot be blank for pkTransID ${row.pkTransID}` });
      }
    }

    // Group by compID → one transaction per company DB
    const byComp = {};
    for (const row of rows) {
      if (!byComp[row.fkCompID]) byComp[row.fkCompID] = [];
      byComp[row.fkCompID].push(row);
    }

    let totalUpdated = 0;

    for (const [compID, compRows] of Object.entries(byComp)) {
      const db = connectionManager.getDB(compID);
      if (!db) return res.status(400).json({ error: `No DB for company ${compID}` });

      const txn = await db.transaction();
      try {
        for (const row of compRows) {
          const transType  = row.TransType || '';
          const setClauses = ['UserID = ?'];
          const vals       = [userId];

          // RentRate — ARV / DESPRET / IN only
          if (['ARV', 'DESPRET', 'IN'].includes(transType)) {
            setClauses.push('RentRate = ?');
            vals.push(parseFloat(row.RentRate) || 0);
          }

          // LotNum — ARV only
          if (transType === 'ARV') {
            setClauses.push('LotNum = ?');
            vals.push(String(row.LotNum).trim());
          }

          // WHERE clause bindings
          vals.push(row.pkTransID, compID);

          const sql = `UPDATE tStockEntry SET ${setClauses.join(', ')}
                       WHERE pkTransID = ? AND fkCompID = ?`;

          const [result] = await db.query(sql, { replacements: vals, transaction: txn });
          totalUpdated += result.affectedRows || 0;
        }
        await txn.commit();
      } catch (updateErr) {
        await txn.rollback();
        throw updateErr;
      }
    }

    res.json({ updated: totalUpdated });
  } catch (err) {
    console.error('PUT /entries error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Substitutes ? placeholders with quoted values for terminal logging only (not for execution)
function interpolateSQL(sql, replacements) {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = replacements[i++];
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Print helpers
// ─────────────────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtAmt(v) {
  const n = parseFloat(v);
  return isNaN(n) ? '' : n.toFixed(2);
}

// 'YYYY-MM-DD' → 'DD/MM/YYYY'
function fmtDisplayDate(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-');
  return `${day}/${m}/${y}`;
}

// ── Rate chart lookup ──────────────────────────────────────────────────────────
// Mirrors VB6 udfHMRateChart priority: party+item → party+wild → wild+item → wild+wild.
// rcRows: all active HM RateChart rows for the company (pre-fetched).
// row: a tStockEntry row with fkPartyID, fkItemID, PackingType, TransType, HamaliCode,
//      PackWght, TransDt (YYYY-MM-DD).
function matchRateChart(rcRows, row) {
  const td     = String(row.TransDt  || '').slice(0, 10);
  const pw     = parseFloat(row.PackWght)    || 0;
  const ptype  = row.PackingType || '';
  const ttype  = row.TransType   || '';
  const hcode  = row.HamaliCode  || '';
  const party  = row.fkPartyID   || '';
  const item   = row.fkItemID    || '';

  const isWild = (v) => !v || v === '0';
  const dtStr  = (d) => d ? String(d).slice(0, 10) : null;

  const cands = rcRows.filter((rc) => {
    if ((rc.PackingType || '') !== ptype) return false;
    if ((rc.TransType   || '') !== ttype) return false;
    if ((rc.HamaliCode  || '') !== hcode) return false;
    const fd = dtStr(rc.FromDt);
    if (fd && fd > td) return false;
    const td2 = dtStr(rc.ToDt);
    if (td2 && td2 < td) return false;
    const uf = parseFloat(rc.UnitFrom) || 0;
    const ut = parseFloat(rc.UnitTo)   || 99999;
    if (pw < uf || pw > ut) return false;
    const pm = rc.fkPartyID === party || isWild(rc.fkPartyID);
    const im = rc.fkItemID  === item  || isWild(rc.fkItemID);
    return pm && im;
  });

  if (!cands.length) return null;

  // Priority 1: exact party + exact item
  let m = cands.find((rc) => !isWild(rc.fkPartyID) && rc.fkPartyID === party && !isWild(rc.fkItemID) && rc.fkItemID === item);
  if (m) return m;
  // Priority 2: exact party + wildcard item
  m = cands.find((rc) => !isWild(rc.fkPartyID) && rc.fkPartyID === party && isWild(rc.fkItemID));
  if (m) return m;
  // Priority 3: wildcard party + exact item
  m = cands.find((rc) => isWild(rc.fkPartyID) && !isWild(rc.fkItemID) && rc.fkItemID === item);
  if (m) return m;
  // Priority 4: wildcard party + wildcard item
  return cands.find((rc) => isWild(rc.fkPartyID) && isWild(rc.fkItemID)) || null;
}

// Validate a transaction row against its matched RateChart entry.
// Returns true if bill amount is within ±0.50 of the expected amount per chart.
function validateAgainstChart(row, rc) {
  if (!rc) return null; // null = no chart entry found (display as unknown)
  const hmlBill = Math.abs(parseFloat(row.HmlBillAmt) || 0);
  const absQty  = Math.abs(parseFloat(row.TransQty)   || 0);
  const pw      = parseFloat(row.PackWght) || 0;
  const br      = parseFloat(rc.BillRate)  || 0;
  const ct      = rc.ChargeType || 'PP';

  // PP (or default) = per bag: expected = BillRate × qty
  // PT              = per ton: expected = BillRate × (qty × packWght / 1000)
  const expected = ct === 'PT'
    ? br * (absQty * pw / 1000)
    : br * absQty;

  return Math.abs(hmlBill - expected) < 0.5;
}

// Build WHERE + replacements array for the standard date/faYear/transType filters.
// Mutates `replacements` in place; returns the extra WHERE fragment.
function buildWhereExtra(replacements, { startDate, endDate, faYear, useFaYear, types }) {
  let w = '';
  if (useFaYear && faYear) {
    w += ' AND ts.FaYear = ?'; replacements.push(faYear);
    if (startDate) { w += ' AND ts.TransDt >= ?'; replacements.push(startDate); }
    if (endDate)   { w += ' AND ts.TransDt <= ?'; replacements.push(endDate); }
  } else {
    if (startDate) { w += ' AND ts.TransDt >= ?'; replacements.push(startDate); }
    w += ' AND ts.TransDt <= ?'; replacements.push(endDate);
  }
  w += ` AND ts.TransType IN (${types.map(() => '?').join(',')})`;
  replacements.push(...types);
  return w;
}

// ── Daily Report HTML ──────────────────────────────────────────────────────────
// Columns: Date | Party Name | Item Name | Lot No | Quantity | Hamali | Mark | Outstand Hamali | T
function buildDailyHamaliHTML(rows, fromDt, toDt) {
  let totalHamali = 0;
  let totalOutstand = 0;

  const rowsHtml = rows.map((r) => {
    const hamt = parseFloat(r.HamaliRecd) || 0;
    const hbl  = parseFloat(r.HamaliAmt)  || 0;
    totalHamali  += hamt;
    totalOutstand += hbl;

    const itemName = [r.iName, r.ItemExtDesc].filter(Boolean).join(' ');
    const qty      = Math.round(Math.abs(parseFloat(r.TransQty) || 0));
    const packing  = r.Packing || '';
    const packWght = Math.round(parseFloat(r.PackWght) || 0);
    const qtyStr   = packing ? `${qty} ${packing} X ${packWght}` : `${qty}`;

    const code = r.HamaliCode || '';
    const markStyle = code === 'OC'
      ? 'text-align:center;background:#ff0000;color:#fff;font-weight:bold;'
      : code === 'CB'
        ? 'text-align:center;background:#ffff00;font-weight:bold;'
        : 'text-align:center;';

    return `<tr>
      <td>${escHtml(fmtDisplayDate(r.TransDt))}</td>
      <td>${escHtml(r.pName)}</td>
      <td>${escHtml(itemName)}</td>
      <td>${escHtml(r.LotNum)}</td>
      <td style="text-align:right">${escHtml(qtyStr)}</td>
      <td style="text-align:right">${fmtAmt(r.HamaliRecd)}</td>
      <td style="${markStyle}">${escHtml(code)}</td>
      <td style="text-align:right">${fmtAmt(r.HamaliAmt)}</td>
      <td style="text-align:center">${escHtml(r.TransType)}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Daily Report</title>
<style>
  body{font-family:Arial,sans-serif;font-size:10pt;margin:8mm;}
  h2{text-align:center;font-size:11pt;margin:4px 0 8px;}
  table{border-collapse:collapse;width:100%;}
  th{background:#c8c8c8;border:1px solid #777;padding:3px 5px;font-size:10pt;white-space:nowrap;}
  td{border:1px solid #999;padding:2px 5px;font-size:9pt;white-space:nowrap;}
  tfoot td{font-weight:bold;border-top:2px solid #444;background:#eee;}
  @media print{@page{size:A4 portrait;margin:8mm;}.no-print{display:none!important;}}
  .no-print{margin-bottom:8px;}
  .no-print button{padding:5px 14px;cursor:pointer;font-size:11px;}
</style></head><body>
<div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div>
<h2>Daily Report From Date ${escHtml(fromDt)} To Date ${escHtml(toDt)}</h2>
<table>
<thead><tr>
  <th>Date</th><th>Party Name</th><th>Item Name</th><th>Lot No</th>
  <th>Quantity</th><th>Hamali</th><th>Mark</th><th>Outstand Hamali</th><th>T</th>
</tr></thead>
<tbody>${rowsHtml}</tbody>
<tfoot><tr>
  <td colspan="4" style="text-align:left">Total Transection: ${rows.length}</td>
  <td></td>
  <td style="text-align:right">${fmtAmt(totalHamali)}</td>
  <td></td>
  <td style="text-align:right">${fmtAmt(totalOutstand)}</td>
  <td></td>
</tr></tfoot>
</table>
<script>window.onload = () => window.print();</script>
</body></html>`;
}

// ── Hamali List HTML ───────────────────────────────────────────────────────────
// Grouped by party. Columns: Date | LotNum | Item Name | Quantity | Type | T | Rate | Ton | Bill Amt | Code
// All Bill Amt values are always positive; DESP qty is shown in parentheses for context.
function buildHamaliListHTML(rows, fromDt, toDt) {
  // Group by pName preserving ORDER BY pName sort
  const partyOrder = [];
  const partyMap   = {};
  for (const r of rows) {
    const key = r.pName || '';
    if (!partyMap[key]) { partyMap[key] = []; partyOrder.push(key); }
    partyMap[key].push(r);
  }

  let bodyHtml = '';

  for (const party of partyOrder) {
    const pRows = partyMap[party];
    let partyTotal = 0;

    bodyHtml += `<tr style="background:#d0d0d0;font-weight:bold;">
      <td colspan="10" style="padding:3px 6px">${escHtml(party)}</td>
    </tr>`;

    for (const r of pRows) {
      const isDesp   = r.TransType === 'DESP';
      const hmlBill  = parseFloat(r.HmlBillAmt) || parseFloat(r.HamaliRecd) || parseFloat(r.HamaliAmt) || 0;
      const absBill  = Math.abs(hmlBill);       // always positive for display and totals
      partyTotal    += absBill;

      const itemName = [r.iName, r.ItemExtDesc].filter(Boolean).join(' ');
      const qty      = parseFloat(r.TransQty) || 0;
      const absQty   = Math.abs(qty);           // DESP qty is negative in DB → make positive
      const packing  = r.Packing || '';
      const packWght = parseFloat(r.PackWght) || 0;
      const qtyStr   = packing ? `${absQty.toFixed(2)} ${packing} X ${packWght.toFixed(2)}` : absQty.toFixed(2);

      // Rate = abs(BillAmt) / abs(Qty) → always positive
      const rate = absQty > 0 ? absBill / absQty : 0;
      // Ton  = (rate × 1000) / packWght → rate per ton
      const ton  = packWght > 0 ? (rate * 1000) / packWght : 0;

      const rateOk = r.rateOk;
      const rateStyle = rateOk === false
        ? 'text-align:right;color:#cc0000;font-weight:bold;'
        : 'text-align:right;';

      bodyHtml += `<tr>
        <td>${escHtml(fmtDisplayDate(r.TransDt))}</td>
        <td>${escHtml(r.LotNum)}</td>
        <td>${escHtml(itemName)}</td>
        <td style="text-align:right">${escHtml(qtyStr)}</td>
        <td style="text-align:center">${escHtml(r.TransType)}</td>
        <td style="text-align:center">${escHtml(r.OwnTransFlg || '')}</td>
        <td style="${rateStyle}">${rate.toFixed(2)}</td>
        <td style="text-align:right">${ton.toFixed(2)}</td>
        <td style="text-align:right">${absBill.toFixed(2)}</td>
        <td style="text-align:center">${escHtml(r.HamaliCode || '')}</td>
      </tr>`;
    }

    bodyHtml += `<tr style="background:#e8e8e8;font-weight:bold;">
      <td colspan="8" style="text-align:left;padding:2px 5px">
        Total Records ${pRows.length} &nbsp;&nbsp; ${escHtml(party)} Total
      </td>
      <td style="text-align:right">${partyTotal.toFixed(2)}</td>
      <td></td>
    </tr>`;
  }

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Hamali List</title>
<style>
  body{font-family:Arial,sans-serif;font-size:9pt;margin:8mm;}
  h2{text-align:center;font-size:11pt;margin:4px 0 8px;}
  table{border-collapse:collapse;width:100%;}
  th{background:#c8c8c8;border:1px solid #777;padding:3px 4px;font-size:9pt;white-space:nowrap;}
  td{border:1px solid #999;padding:2px 4px;font-size:8pt;white-space:nowrap;}
  @media print{@page{size:A4 portrait;margin:8mm;}.no-print{display:none!important;}}
  .no-print{margin-bottom:8px;}
  .no-print button{padding:5px 14px;cursor:pointer;font-size:11px;}
</style></head><body>
<div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div>
<h2>Hamali List from ${escHtml(fromDt)} To ${escHtml(toDt)}</h2>
<table>
<thead><tr>
  <th>Date</th><th>Lot Num</th><th>Item Name</th><th>Quantity</th>
  <th>Type</th><th>T</th><th>Rate</th><th>Ton</th><th>Bill Amt</th><th>Code</th>
</tr></thead>
<tbody>${bodyHtml}</tbody>
</table>
<script>window.onload = () => window.print();</script>
</body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /daily-report
// Printable daily hamali report — mirrors VB6 cmdDailyRep_Click / drsDailyReport.
// Returns browser-printable HTML; frontend opens it in a new tab.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/daily-report', requirePerm('MOD_RATE', 'CanView'), async (req, res) => {
  try {
    const { groupID, branchID } = req.user;
    const { startDate, endDate, faYear, useFaYear, transTypes, rows: clientRows } = req.body;
    if (!endDate) return res.status(400).json({ error: 'endDate is required' });

    // If the frontend already has filtered rows loaded, use them directly
    if (Array.isArray(clientRows) && clientRows.length > 0) {
      const html = buildDailyHamaliHTML(clientRows, fmtDisplayDate(startDate), fmtDisplayDate(endDate));
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    if (Array.isArray(clientRows) && clientRows.length === 0) {
      return res.status(404).json({ error: 'No records found for the selected filters.' });
    }

    const types = Array.isArray(transTypes) && transTypes.length > 0
      ? transTypes : ['ARV', 'DESP', 'DESPRET', 'TRF', 'IN', 'OUT'];

    const companies = connectionManager.getGroupCompanyDetails(groupID);

    const allRows = await Promise.all(companies.map(async (c) => {
      const db = connectionManager.getDB(c.pkCompID);
      if (!db) return [];

      const replacements = [c.pkCompID, branchID];
      const whereExtra   = buildWhereExtra(replacements, { startDate, endDate, faYear, useFaYear, types });

      const sql = `
        SELECT ts.TransType, ts1.LotNum, pm.pName, im.iName, ts1.ItemExtDesc,
               DATE_FORMAT(ts.TransDt, '%Y-%m-%d') AS TransDt,
               ts.TransQty, ts1.Packing, ts1.PackWght,
               ts.HamaliRecd, ts.HamaliAmt, ts.HmlBillAmt, ts.HamaliCode
        FROM tStockEntry ts
        JOIN mParty pm      ON ts.fkPartyID  = pm.pkPartyID
        JOIN mItem  im      ON ts.fkItemID   = im.pkItemID
        JOIN tStockEntry ts1 ON ts.pfkLotID  = ts1.pfkLotID AND ts1.TransType = 'ARV'
        WHERE ts.fkCompID = ? AND ts.fkBranchID = ? ${whereExtra}
        ORDER BY ts.TransDt, ts.TransType, ts1.LotNum
      `;

      const [rows] = await db.query(sql, { replacements });
      return rows;
    }));

    const rows = allRows.flat().sort((a, b) => {
      if (a.TransDt !== b.TransDt) return a.TransDt.localeCompare(b.TransDt);
      return (a.TransType || '').localeCompare(b.TransType || '');
    });

    if (!rows.length) return res.status(404).json({ error: 'No records found for the selected filters.' });

    const html = buildDailyHamaliHTML(rows, fmtDisplayDate(startDate), fmtDisplayDate(endDate));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('POST /daily-report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /hamali-list
// Printable hamali list — mirrors VB6 cmdHamaliList_Click / drsHamaliList.
// Filtered to ts.OpFlg = 'N' AND ts.HmlBillAmt <> 0; grouped by party.
// Returns browser-printable HTML.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/hamali-list', requirePerm('MOD_RATE', 'CanView'), async (req, res) => {
  try {
    const { groupID, branchID } = req.user;
    const { startDate, endDate, faYear, useFaYear, transTypes, colFilters } = req.body;
    if (!endDate) return res.status(400).json({ error: 'endDate is required' });

    const types = Array.isArray(transTypes) && transTypes.length > 0
      ? transTypes : ['ARV', 'DESP', 'DESPRET', 'TRF', 'IN', 'OUT'];

    const companies = connectionManager.getGroupCompanyDetails(groupID);

    const allRows = await Promise.all(companies.map(async (c) => {
      const db = connectionManager.getDB(c.pkCompID);
      if (!db) return [];

      const replacements = [c.pkCompID, branchID];
      const whereExtra   = buildWhereExtra(replacements, { startDate, endDate, faYear, useFaYear, types });

      const sql = `
        SELECT ts.TransType, ts1.LotNum, pm.pName, im.iName, ts1.ItemExtDesc,
               DATE_FORMAT(ts.TransDt, '%Y-%m-%d') AS TransDt,
               ts.TransQty, ts1.Packing, ts1.PackWght, ts1.PackingType,
               ts.fkPartyID, ts.fkItemID,
               ts.HamaliRecd, ts.HamaliAmt, ts.HmlBillAmt, ts.HamaliCode, ts.OwnTransFlg
        FROM tStockEntry ts
        JOIN mParty pm      ON ts.fkPartyID  = pm.pkPartyID
        JOIN mItem  im      ON ts.fkItemID   = im.pkItemID
        JOIN tStockEntry ts1 ON ts.pfkLotID  = ts1.pfkLotID AND ts1.TransType = 'ARV'
        WHERE ts.fkCompID = ? AND ts.fkBranchID = ?
          AND ts.OpFlg = 'N'
          AND (COALESCE(ts.HmlBillAmt, 0) <> 0 OR COALESCE(ts.HamaliRecd, 0) <> 0 OR COALESCE(ts.HamaliAmt, 0) <> 0)
          ${whereExtra}
        ORDER BY pm.pName, ts.TransDt, ts.TransType
      `;

      const [rows] = await db.query(sql, { replacements });

      // Fetch all active HM rate chart entries for this company once
      const [rcRows] = await db.query(`
        SELECT fkPartyID, fkItemID, PackingType, TransType, HamaliCode,
               ChargeType, BillRate,
               DATE_FORMAT(FromDt, '%Y-%m-%d') AS FromDt,
               DATE_FORMAT(ToDt,   '%Y-%m-%d') AS ToDt,
               UnitFrom, UnitTo
        FROM RateChart
        WHERE fkCompID = ? AND fkBranchID = ? AND RateType = 'HM' AND Active = 'Y'
      `, { replacements: [c.pkCompID, branchID] });

      // Tag each row with rate validation result
      for (const r of rows) {
        const rc    = matchRateChart(rcRows, r);
        r.rateOk    = validateAgainstChart(r, rc);
      }

      return rows;
    }));

    const rows = allRows.flat().sort((a, b) => {
      const pc = (a.pName || '').localeCompare(b.pName || '');
      if (pc) return pc;
      if (a.TransDt !== b.TransDt) return a.TransDt.localeCompare(b.TransDt);
      return (a.TransType || '').localeCompare(b.TransType || '');
    });

    // Apply column filters from the grid (field → comma-OR filter text)
    let finalRows = rows;
    if (colFilters && typeof colFilters === 'object') {
      for (const [field, txt] of Object.entries(colFilters)) {
        if (!txt) continue;
        const terms = txt.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
        if (!terms.length) continue;
        finalRows = finalRows.filter((r) => {
          const val = String(r[field] ?? '').toLowerCase();
          return terms.some((t) => val.includes(t));
        });
      }
    }

    if (!finalRows.length) return res.status(404).json({ error: 'No records found for the selected filters.' });

    const html = buildHamaliListHTML(finalRows, fmtDisplayDate(startDate), fmtDisplayDate(endDate));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('POST /hamali-list error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
