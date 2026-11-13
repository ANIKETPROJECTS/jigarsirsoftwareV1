-- ─────────────────────────────────────────────────────────
-- GMS — Godown Management System
-- MySQL 8.0 Views
-- Translated from SQL Server (script.sql, dated 25-05-2026)
--
-- Run AFTER schema.sql
-- Usage: mysql -u root -p gms_db < views.sql
-- ─────────────────────────────────────────────────────────

USE gms_db;

-- ─────────────────────────────────────────────────────────
-- vStkTransQty
-- Expands dual-godown stock entries into one row per godown.
-- A stock entry can split qty across two godowns (GodownQty1 + GodownQty2).
-- This view flattens that so every computation sees one row per godown.
-- Used directly in: tStockEntry save logic, lot balance calculations.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vStkTransQty AS
SELECT
  fkCompID, pfkLotID, pkTransID, TransDt, TransType,
  fkGodownID1 AS fkGodownID,
  GodownQty1  AS GodownQty,
  fkPartyID, fkItemID, LotNum, ItemExtDesc,
  OpFlg, pfkOriLotID, OriTransDt, OriTransQty, FaYear, fkBranchID
FROM tStockEntry
UNION ALL
SELECT
  fkCompID, pfkLotID, pkTransID, TransDt, TransType,
  fkGodownID2,
  GodownQty2,
  fkPartyID, fkItemID, LotNum, ItemExtDesc,
  OpFlg, pfkOriLotID, OriTransDt, OriTransQty, FaYear, fkBranchID
FROM tStockEntry
WHERE fkGodownID2 IS NOT NULL
  AND GodownQty2 IS NOT NULL
  AND GodownQty2 <> 0;


-- ─────────────────────────────────────────────────────────
-- vStkGodBal
-- Godown-wise balance per lot.
-- SUM(GodownQty) from vStkTransQty gives net balance
-- (ARV quantities are +ve, DEP quantities are -ve in the source data).
-- Used for: Stock Balance Report, lot status display.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vStkGodBal AS
SELECT
  fkCompID,
  pfkLotID,
  fkGodownID,
  SUM(GodownQty) AS GodBalQty,
  fkBranchID
FROM vStkTransQty
GROUP BY fkCompID, pfkLotID, fkGodownID, fkBranchID;


-- ─────────────────────────────────────────────────────────
-- vBillRegister
-- Unified bill list across ALL bill types:
--   tBill1          → BillType = 'GodRent'
--   tBillTrHmGen1   → BillType = 'Trans' or 'Hamali'
-- Used as the base for vInvoice_Recpt_Amt and all bill reports.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vBillRegister AS
SELECT
  BillType, pkBillID, fkCompID, fkBranchID, BillDt, BillNum, fkPartyID,
  GSTNo, fkStateID, GrossAmt,
  Tax1Desc, Tax1Rate, Tax1Amt,
  Tax2Desc, Tax2Rate, Tax2Amt,
  Tax3Desc, Tax3Rate, Tax3Amt,
  NetAmt, RoundOff, LtrFlg, AcknldgDt, BillStatus
FROM tBill1
UNION ALL
SELECT
  BillType, pkBillID, fkCompID, fkBranchID, BillDt, BillNum, fkPartyID,
  GSTNo, fkStateID, GrossAmt,
  Tax1Desc, Tax1Rate, Tax1Amt,
  Tax2Desc, Tax2Rate, Tax2Amt,
  Tax3Desc, Tax3Rate, Tax3Amt,
  NetAmt, RoundOff, LtrFlg, AcknldgDt, BillStatus
FROM tBillTrHmGen1;


-- ─────────────────────────────────────────────────────────
-- vInvoice_Recpt_Amt
-- Outstanding Bills report core view.
-- Formula: BalanceAmt = NetAmt − (RecptAmt + TDSAmt + DiscAmt)
-- Each bill row shows: total billed, total received, balance outstanding.
-- Used for: Receipt Entry screen (show bills to pay against),
--           Outstanding Bills / Receipt Report.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vInvoice_Recpt_Amt AS
SELECT
  b1.pkBillID,
  b1.fkCompID,
  b1.fkBranchID,
  b1.BillType,
  b1.BillNum,
  b1.BillDt,
  b1.fkPartyID,
  b1.GrossAmt,
  b1.NetAmt,
  b1.BillStatus,
  IFNULL(SUM(r2.RecptAmt + r2.TDSAmt + r2.DiscAmt), 0) AS ReceivedAmt,
  b1.NetAmt - IFNULL(SUM(r2.RecptAmt + r2.TDSAmt + r2.DiscAmt), 0) AS BalanceAmt
FROM vBillRegister AS b1
LEFT JOIN tRecpt2 AS r2
  ON b1.pkBillID = r2.fkBillID COLLATE utf8mb4_unicode_ci
  AND b1.BillType = r2.BillType COLLATE utf8mb4_unicode_ci
GROUP BY
  b1.pkBillID, b1.fkCompID, b1.fkBranchID, b1.BillType,
  b1.BillNum, b1.BillDt, b1.fkPartyID, b1.GrossAmt,
  b1.NetAmt, b1.BillStatus;


-- ─────────────────────────────────────────────────────────
-- vLotArv
-- Latest ARV (Arrival) entry per lot.
-- When a lot is renumbered across FA years, there can be multiple ARV
-- entries sharing the same pfkOriLotID. This view returns only the
-- most recent one (identified by MAX date+FaYear string per oriLotID).
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vLotArv AS
SELECT t.*
FROM tStockEntry t
WHERE t.TransType = 'ARV'
  AND CONCAT(t.pfkOriLotId, '|', DATE_FORMAT(t.TransDt, '%Y%m%d'), '|', t.FaYear) IN (
    SELECT MAX(CONCAT(pfkOriLotId, '|', DATE_FORMAT(TransDt, '%Y%m%d'), '|', FaYear))
    FROM tStockEntry
    WHERE TransType = 'ARV'
    GROUP BY pfkOriLotId
  );


-- ─────────────────────────────────────────────────────────
-- vLotArv_1
-- Original vs Latest ARV side by side per lot.
-- _Ori columns = first ARV ever for this lot (MIN date)
-- _Let columns = most recent ARV (MAX date, i.e. after renumbering)
-- Used for: Lot detail report, showing renumber history.
--
-- Uses ROW_NUMBER() window function (MySQL 8.0+) instead of the old
-- CONCAT MAX/MIN trick — avoids string building, uses index on TransDt.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vLotArv_1 AS
WITH arv AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY pfkOriLotID ORDER BY TransDt DESC, FaYear DESC) AS rn_max,
    ROW_NUMBER() OVER (PARTITION BY pfkOriLotID ORDER BY TransDt ASC,  FaYear ASC)  AS rn_min
  FROM tStockEntry
  WHERE TransType = 'ARV'
)
SELECT
  mx.pfkOriLotID,
  mn.LotNum           AS LotNum_Ori,
  mx.LotNum           AS LotNum_Let,
  mn.DoNum            AS DoNum_Ori,
  mx.DoNum            AS DoNum_Let,
  mn.FaYear           AS FaYear_Ori,
  mx.FaYear           AS FaYear_Let,
  mn.TransDt          AS TransDt_Ori,
  mx.TransDt          AS TransDt_Let,
  mn.TransQty         AS TransQty_Ori,
  mx.TransQty         AS TransQty_Let,
  mn.Packing          AS Packing_Ori,
  mx.Packing          AS Packing_Let,
  mn.OpFlg            AS OpFlg_Ori,
  mx.OpFlg            AS OpFlg_Let,
  mn.fkItemID         AS fkItemID_Ori,
  mx.fkItemID         AS fkItemID_Let,
  mn.ItemExtDesc      AS ItemExtDesc_Ori,
  mx.ItemExtDesc      AS ItemExtDesc_Let,
  mn.RentRate         AS RentRate_Ori,
  mx.RentRate         AS RentRate_Let,
  mn.fkPartyID,
  mn.PackWght,
  mn.VehiNum,
  mn.BENum,
  mn.ActualWght,
  mn.TransNote,
  mx.OriTransQty,
  mx.OriTransDt,
  mx.ItemRate,
  mn.GrossWght,
  mn.PackingType,
  mn.PackingColour,
  mn.TransExtDetail,
  mn.BatchNum,
  mn.DelivOpt,
  mn.TransRemark,
  mn.pkTransID,
  mx.UserID,
  mx.HamaliRecd,
  mx.HamaliAmt,
  mx.HmlBillAmt,
  mx.HamaliCode,
  mn.OwnTransFlg
FROM arv AS mx
JOIN arv AS mn ON mx.pfkOriLotID = mn.pfkOriLotID
WHERE mx.rn_max = 1
  AND mn.rn_min = 1;


-- ─────────────────────────────────────────────────────────
-- vmLot
-- Current lot summary — the "live" status of every lot in stock.
-- ArvQty  = original arrival quantity
-- CurrBal = net balance today (SUM of all ARV + DEP movements, DEP is stored negative)
-- CurrBalDt = date of most recent movement
-- A lot with CurrBal = 0 has been fully dispatched.
-- Used for: Transaction entry (lot selector), Stock Balance Report.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vmLot AS
SELECT
  tArv.pfkOriLotID,
  tArv.LotNum,
  tArv.TransQty       AS ArvQty,
  SUM(tS.TransQty)    AS CurrBal,
  MAX(tS.TransDt)     AS CurrBalDt,
  tArv.TransType,
  tArv.TransDt        AS ArvDt,
  tArv.DoNum          AS ArvDoNum,
  tArv.Packing,
  tArv.ItemExtDesc,
  tArv.PackWght,
  tArv.ActualWght     AS ArvActualWght,
  tArv.fkPartyID,
  tArv.fkItemID,
  tArv.LotBillFlg
FROM tStockEntry AS tS
INNER JOIN tStockEntry AS tArv
  ON tS.pfkOriLotID = tArv.pfkOriLotID
WHERE tArv.TransType IN ('ARV', 'OPEN')
  AND tArv.OpFlg = 'N'
  AND tS.OpFlg   = 'N'
GROUP BY
  tArv.pfkOriLotID, tArv.LotNum, tArv.TransQty, tArv.TransDt,
  tArv.fkPartyID, tArv.TransType, tArv.DoNum, tArv.Packing,
  tArv.ItemExtDesc, tArv.PackWght, tArv.ActualWght,
  tArv.fkItemID, tArv.LotBillFlg;


-- ─────────────────────────────────────────────────────────
-- vatStockEntry_AT
-- Audit trail view — tStockEntry_AT joined with master tables
-- so report screens can show names instead of IDs.
-- (In SQL Server this was a multi-DB UNION; in our single DB it is a simple join.)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vatStockEntry_AT AS
SELECT
  ts_at.UniqueSrNo_AT, ts_at.Status_AT, ts_at.LogDate_AT,
  ts_at.pkTransID, ts_at.fkCompID, ts_at.fkBranchID,
  ts_at.TransID, ts_at.TransType,
  ts_at.pfkLotID, ts_at.LotNum,
  ts_at.fkPartyID,  mp.pName,
  ts_at.fkItemID,   mi.iName,
  ts_at.ItemExtDesc, ts_at.TransDt, ts_at.TransTm, ts_at.TransQty,
  ts_at.DoNum, ts_at.GatePass,
  ts_at.Packing, ts_at.PackingType, ts_at.PackingColour,
  ts_at.PackWght, ts_at.GrossWght, ts_at.RentRate,
  ts_at.fkGodownID1, mg1.gNum,
  ts_at.GodownQty1,
  ts_at.fkGodownID2, mg2.gNum AS gNum2,
  ts_at.GodownQty2,
  ts_at.VehiNum, ts_at.BENum, ts_at.ActualWght,
  ts_at.TransNote, ts_at.HamaliRecd, ts_at.HamaliAmt,
  ts_at.ItemRate, ts_at.TransExtDetail, ts_at.BatchNum,
  ts_at.DelivOpt, ts_at.TransRemark, ts_at.LotBillFlg,
  ts_at.OpFlg, ts_at.OutsideLabr, ts_at.OtherHmlAmt,
  ts_at.PickupBy, ts_at.OwnTransFlg,
  ts_at.HmlBillAmt, ts_at.HamaliCode,
  ts_at.pfkOriLotID, ts_at.OriTransDt, ts_at.OriTransQty,
  ts_at.FaYear, ts_at.UserID, ts_at.CrMod
FROM tStockEntry_AT AS ts_at
INNER JOIN mItem   AS mi   ON ts_at.fkItemID    = mi.pkItemID
INNER JOIN mGodown AS mg1  ON ts_at.fkGodownID1 = mg1.pkGodownID
INNER JOIN mParty  AS mp   ON ts_at.fkPartyID   = mp.pkPartyID
LEFT  JOIN mGodown AS mg2  ON ts_at.fkGodownID2 = mg2.pkGodownID;


-- ─────────────────────────────────────────────────────────
-- vamParty  (compatibility alias)
-- In the old SQL Server setup, vamParty was a UNION ALL of
-- ADS.mParty + KPS.mParty + TEST.mParty across three databases.
-- In our single MySQL database all companies are already in mParty
-- (filtered by fkCompID). This view is a simple pass-through.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vamParty AS
SELECT
  pkPartyID, fkCompID, fkBranchID, PartyID, pName, pAlias, pCode,
  pGroup, pRef, pBillType, pEmail, pBillAdd, GSTNo, fkStateID,
  pStartDate, pLotReNumFlg, StFlagGodRent, StFlagTrans,
  pNote, Active, fkUserID, CrMod
FROM mParty;


-- ─────────────────────────────────────────────────────────
-- vatStockEntry  (compatibility alias)
-- Old SQL Server: UNION ALL of ADS.tStockEntry + KPS + TEST.
-- In single MySQL DB: pass-through (all companies in one table).
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vatStockEntry AS
SELECT
  pkTransID, fkCompID, fkBranchID, TransID, TransType,
  pfkLotID, LotNum, fkPartyID, fkItemID, ItemExtDesc,
  TransDt, TransTm, TransQty, DoNum, GatePass,
  Packing, PackingType, PackingColour, PackWght, GrossWght,
  RentRate, fkGodownID1, GodownQty1, fkGodownID2, GodownQty2,
  VehiNum, BENum, ActualWght, TransNote,
  HamaliRecd, HamaliAmt, HmlBillAmt, HamaliCode,
  TransExtDetail, BatchNum, DelivOpt, TransRemark,
  PickupBy, OwnTransFlg, LotBillFlg, OutsideLabr,
  OtherHmlAmt, OpFlg, pfkOriLotID, OriTransDt, OriTransQty,
  FaYear, UserID, CrMod
FROM tStockEntry;
