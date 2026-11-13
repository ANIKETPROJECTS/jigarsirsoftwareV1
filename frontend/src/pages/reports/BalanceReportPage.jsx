// BalanceReportPage.jsx — Balance Report
// VB6 origin: frmReport.frm (class: frmBalReport)
//
// Tab 1 (General): date range, 4 toggle-filter panels, sort, template save/load
// Tab 2 (Detail):  report format, format options, main grid, lot-detail grid, View/Export

import { useCallback, useEffect, useMemo, useState } from 'react';
import { encodeId } from '../../utils/idCodec';
import { ADITYA_LOGO_B64 } from '../../assets/adityaLogo';
import { VLCO_LOGO_B64 }   from '../../assets/vlcoLogo';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Collapse,
  Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControl, FormControlLabel, FormGroup, IconButton, InputAdornment,
  InputLabel, MenuItem, Paper, Select, Snackbar, Stack, Tab, Table,
  TableBody, TableCell, TableHead, TableRow, Tabs, TextField,
  Toolbar, Tooltip, Typography,
} from '@mui/material';
import SearchIcon          from '@mui/icons-material/Search';
import SaveIcon            from '@mui/icons-material/Save';
import FolderOpenIcon      from '@mui/icons-material/FolderOpen';
import PlayArrowIcon       from '@mui/icons-material/PlayArrow';
import CancelIcon          from '@mui/icons-material/Cancel';
import PrintIcon           from '@mui/icons-material/Print';
import FileDownloadIcon    from '@mui/icons-material/FileDownload';
import CheckBoxIcon        from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import FilterListIcon      from '@mui/icons-material/FilterList';
import EditIcon            from '@mui/icons-material/Edit';
import PhotoCameraIcon     from '@mui/icons-material/PhotoCamera';
import DescriptionIcon     from '@mui/icons-material/Description';
import CloseIcon           from '@mui/icons-material/Close';
import EmailIcon           from '@mui/icons-material/Email';
import * as XLSX           from 'xlsx';
import api                 from '../../services/api';
import { useAuth }         from '../../contexts/AuthContext';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const f2    = (n) => (parseFloat(n) || 0).toFixed(2);
const f4    = (n) => (parseFloat(n) || 0).toFixed(4);
const fN    = (n) => { const v = parseFloat(n); if (isNaN(v)) return ''; return parseFloat(v.toFixed(4)).toString(); };
const fmtDt = (s) => {
  if (!s) return '';
  const d = typeof s === 'string' ? s.slice(0, 10) : new Date(s).toISOString().slice(0, 10);
  return `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
};
const fmtDtDay = (s) => {
  if (!s) return '';
  const iso = typeof s === 'string' ? s.slice(0, 10) : new Date(s).toISOString().slice(0, 10);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(iso + 'T00:00:00').getDay()];
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)} (${dow})`;
};
const fmtDtMon = (s) => {
  if (!s) return '';
  const d = typeof s === 'string' ? s.slice(0, 10) : new Date(s).toISOString().slice(0, 10);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.slice(8, 10)}-${months[parseInt(d.slice(5, 7), 10) - 1]}-${d.slice(0, 4)}`;
};
const fmtTm = (s) => {
  if (!s) return '';
  const str = typeof s === 'string' ? s : new Date(s).toTimeString();
  const m = str.match(/(\d{2}:\d{2})/);
  return m ? m[1] : '';
};

// Financial year: April 1 start (India). If current month < April, use previous year.
function fyStart() {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const REPORT_FORMATS = [
  { value: 'party-bal-detail', label: 'Party Detail Balance Report' },
  { value: 'party-bal',        label: 'Party Balance Report' },
  { value: 'lot-wise',         label: 'Lot Wise Report' },
  { value: 'godown-bal',       label: 'Godown Wise Report' },
];

const SORT_OPTIONS = [
  { value: 'LotNum', label: 'Lot Number (default)' },
  { value: 'pName',  label: 'Party Name' },
  { value: 'iName',  label: 'Item Name' },
];

const FILTER_PANELS = [
  { key: 'partyGroups', label: 'Party Group',  idField: 'pkGrpID',    nameField: 'GrpName', subField: 'compAlias' },
  { key: 'parties',     label: 'Party Name',   idField: 'pkPartyID',  nameField: 'pName',   subField: 'pCode', pillField: 'fkCompID' },
  { key: 'items',       label: 'Item Name',    idField: 'pkItemID',   nameField: 'iName' },
  { key: 'godowns',     label: 'Godown No.',   idField: 'pkGodownID', nameField: 'gNum' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Print window
// ─────────────────────────────────────────────────────────────────────────────
const PRINT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10px; padding: 12px; }
  h2 { font-size: 14px; text-align: center; margin-bottom: 4px; }
  .sub { text-align: center; margin-bottom: 10px; font-size: 10px; color: #555; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #1565C0; color: #fff; padding: 4px 6px; text-align: left; font-size: 9px; }
  td { padding: 3px 6px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
  tr:nth-child(even) td { background: #f5f5f5; }
  .ob td { background: #e3f2fd !important; font-style: italic; }
  .group-hdr { background: #eeeeee; font-weight: bold; }
  .total td { background: #fff9c4; font-weight: bold; }
  @media print { @page { margin: 10mm; } button { display: none; } }
`;

const PARTY_BAL_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #000; padding: 16px; }
  .no-print { margin-bottom: 10px; }
  .no-print button { padding: 5px 14px; cursor: pointer; font-size: 11px; }
  .pg-hdr { text-align: center; margin-bottom: 6px; }
  .pg-hdr img { display: block; margin: 0 auto 2px; height: 50px; width: auto; max-width: 100%; }
  .bal-on { display: block; font-size: 10px; margin-top: 2px; }
  .party-stmt { font-size: 11px; margin: 10px 0 5px 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 2px; }
  th { font-weight: bold; font-size: 10px; padding: 4px 5px;
       border-top: 1px solid #000; border-bottom: 1px solid #000; }
  th.r, td.r { text-align: right; }
  th.c, td.c { text-align: center; }
  td { font-size: 10px; padding: 2px 5px; vertical-align: top; }
  tr.doc td { font-size: 9px; }
  tr.val td { font-size: 9px; text-align: right; }
  .ptot { font-weight: bold; font-size: 11px; text-align: right;
          border-top: 1px solid #000; padding: 3px 5px 10px; }
  .note { font-size: 10px; margin-top: 14px; }
  .pf   { font-size: 10px; margin-top: 4px; }
  @page { size: A4 portrait; margin: 12mm; }
  @media print { .no-print { display: none !important; } body { padding: 0; } }
`;

const GODOWN_BAL_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #000; padding: 16px; }
  .no-print { margin-bottom: 10px; }
  .no-print button { padding: 5px 14px; cursor: pointer; font-size: 11px; }
  .pg-title { text-align: right; font-size: 10px; margin-bottom: 10px; }
  table.god-tbl { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  .god-tbl .god-hdr-cell { font-size: 10px; padding: 2px 4px; }
  .god-tbl th { font-size: 10px; font-weight: bold; padding: 2px 4px; vertical-align: top; }
  .god-tbl th.l { text-align: left; }
  .god-tbl th.r { text-align: right; }
  .god-tbl td { font-size: 10px; padding: 1px 4px; vertical-align: top; }
  .god-tbl td.r { text-align: right; }
  .god-tbl tr.sep td { border-top: 1px dashed #000; padding: 0; height: 3px; }
  .god-tbl tr.main td { font-size: 10px; padding: 2px 4px; }
  .god-tbl tr.main td.bold { font-weight: bold; }
  .god-tbl tr.sub td { font-size: 9px; padding: 1px 4px; }
  .god-tbl tr.gtot td { font-size: 10px; padding: 2px 4px; text-align: right; }
  .god-tbl tr.val td { font-size: 9px; padding: 1px 4px; text-align: right; }
  .xxx { text-align: center; font-size: 10px; margin: 6px 0 12px; }
  .pf { font-size: 10px; margin-top: 16px; }
  @page { size: A4 portrait; margin: 12mm; }
  @media print { .no-print { display: none !important; } body { padding: 0; } }
`;

const LOT_WISE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #000; padding: 16px; }
  .no-print { margin-bottom: 10px; }
  .no-print button { padding: 5px 14px; cursor: pointer; font-size: 11px; }
  .pg-hdr { text-align: center; margin-bottom: 8px; }
  .pg-hdr img { display: block; margin: 0 auto 4px; height: 55px; width: auto; max-width: 100%; }
  .pg-title { font-size: 10px; white-space: nowrap; }
  .lot-section { margin-bottom: 4px; }
  table.lw-tbl { width: 100%; border-collapse: collapse; }
  .lw-tbl td, .lw-tbl th { font-size: 10px; padding: 1px 4px; vertical-align: top; }
  .lw-tbl .lot-hdr td { font-size: 11px; font-weight: bold; padding: 3px 4px; }
  .lw-tbl .lot-info td { font-size: 10px; padding: 1px 4px; }
  .lw-tbl .lot-arv td { font-size: 10px; padding: 1px 4px 3px; }
  .lw-tbl .col-hdr1 th { font-size: 10px; font-weight: bold; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 2px 4px; }
  .lw-tbl .col-hdr1 th.r { text-align: right; }
  .lw-tbl .col-hdr2 td { font-size: 9px; padding: 1px 4px; border-bottom: 1px dashed #000; }
  .lw-tbl .lw-main td { font-size: 10px; padding: 1px 4px; }
  .lw-tbl .lw-main td.r { text-align: right; }
  .lw-tbl .lw-sub td { font-size: 9px; padding: 0 4px 2px; color: #333; }
  .lw-tbl .ob-row td { font-style: italic; }
  .lw-tbl .lot-rem td { font-size: 9px; padding: 2px 4px; }
  .lot-sep { font-size: 10px; text-align: center; margin: 4px 0 10px; }
  .lw-note { font-size: 10px; margin-top: 16px; }
  .pf { font-size: 10px; margin-top: 4px; }
  @page { size: A4 portrait; margin: 12mm; }
  @media print { .no-print { display: none !important; } body { padding: 0; } }
`;

const PARTY_BAL_DETAIL_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #000; padding: 16px; }
  .no-print { margin-bottom: 10px; }
  .no-print button { padding: 5px 14px; cursor: pointer; font-size: 11px; }
  .pg-hdr { text-align: center; margin-bottom: 8px; }
  .pg-hdr img { display: block; margin: 0 auto 4px; height: 60px; width: auto; max-width: 100%; }
  .bal-range { font-size: 10px; margin-top: 2px; }
  .party-stmt { font-size: 11px; margin: 10px 0 4px 0; }
  table.main-tbl { width: 100%; border-collapse: collapse; margin-bottom: 2px; }
  .main-tbl th { font-weight: bold; font-size: 10px; padding: 3px 4px;
                 border-top: 1px solid #000; border-bottom: 1px solid #000; }
  .main-tbl th.r { text-align: right; }
  .main-tbl td { font-size: 10px; padding: 2px 4px; vertical-align: top; }
  .main-tbl td.bold { font-weight: bold; }
  .main-tbl td.r { text-align: right; }
  .main-tbl tr.doc td { font-size: 9px; }
  .main-tbl tr.val td { font-size: 9px; text-align: right; }
  .main-tbl tr.sub-wrap td { padding: 1px 0; }
  table.sub-tbl { width: 90%; margin: 2px 0 4px 20px; border-collapse: collapse; border: 1px solid #aaa; }
  .sub-tbl th { font-size: 9px; font-weight: bold; padding: 2px 4px; border-bottom: 1px solid #aaa;
                background: #f0f0f0; }
  .sub-tbl th.r { text-align: right; }
  .sub-tbl td { font-size: 9px; padding: 1px 4px; border-bottom: 1px solid #e0e0e0; }
  .sub-tbl td.r { text-align: right; }
  .sub-tbl th:nth-child(3), .sub-tbl td:nth-child(3) { min-width: 80px; text-align: center !important; }
  .sub-tbl th:nth-child(4), .sub-tbl td:nth-child(4) { min-width: 60px; border-left: 1px solid #bbb; text-align: center !important; padding-left: 8px; padding-right: 8px; }
  .sub-tbl tr.ob td { font-style: italic; }
  .sub-tbl tr.col-hdr2 td { font-size: 8px; color: #555; font-style: italic; background: #f8f8f8; border-bottom: 1px solid #aaa; padding: 1px 4px; }
  .sub-tbl tr.lw-sub td { font-size: 8px; color: #555; border-bottom: 1px solid #e8e8e8; padding: 0 4px 2px; }
  .ptot { font-weight: bold; font-size: 10px; text-align: right;
          border-top: 1px solid #000; padding: 3px 4px 10px; }
  .note { font-size: 10px; margin-top: 14px; }
  .pf   { font-size: 10px; margin-top: 4px; }
  @page { size: A4 portrait; margin: 12mm; }
  @media print { .no-print { display: none !important; } body { padding: 0; } }
`;

// Indian-style money format with commas
function fmtMoney(n) {
  const v = parseFloat(n) || 0;
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildReportHTML({ rows, lots, reportType, startDate, endDate, fmtChecks = {}, compName = '', logo = '' }) {
  const title  = REPORT_FORMATS.find((f) => f.value === reportType)?.label || 'Balance Report';
  const period = `${fmtDt(startDate) || 'All'} to ${fmtDt(endDate)}`;

  let body = '';

  if (reportType === 'lot-wise') {
    const asFrom  = fmtDt(startDate) || 'All';
    const asTo    = fmtDt(endDate);
    const printDt = fmtDt(new Date().toISOString().slice(0, 10));

    let sections = '';
    for (const lot of (lots || [])) {
      let runBal = 0;
      let txnRows = '';

      // Opening balance row: only when startDate is provided AND obQty is non-zero
      if (startDate) {
        const obQty = parseFloat(lot.obQty) || 0;
        if (obQty !== 0) {
          runBal = obQty;
          txnRows += `<tr class="lw-main ob-row">
            <td>${fmtDtDay(startDate)}</td>
            <td class="r">${f2(obQty)}</td>
            <td class="r">Opening</td>
            <td></td><td></td><td></td><td></td>
          </tr>
          <tr class="lw-sub"><td colspan="7"></td></tr>`;
        }
      }

      let isFirstArv = !startDate;
      for (const tx of (lot.txns || [])) {
        const qty          = parseFloat(tx.TransQty) || 0;
        runBal            += qty;
        const isARV        = tx.TransType === 'ARV';
        const showOpening  = isFirstArv && isARV;
        if (showOpening) isFirstArv = false;

        const particularsDisp = fmtChecks.particulars ? (tx.TransExtDetail || '').replace(/\r?\n/g, '<br>') : '';
        const batchDisp       = fmtChecks.batchNo     ? (tx.BatchNum       || '').replace(/\r?\n/g, '<br>') : '';
        const delivBy         = fmtChecks.delivOn     ? (tx.PickupBy || tx.TransNote || tx.DelivOpt || '') : '';
        const vehiNum         = fmtChecks.vehicleNo   ? (tx.VehiNum  || '') : '';
        const gatePass        = fmtChecks.gatePass    ? (tx.GatePass || '') : '';
        const gNum            = fmtChecks.godownNo    ? (tx.gNum     || '') : '';
        const transType       = fmtChecks.transType   ? (tx.TransType || '') : '';
        const actualWt        = fmtChecks.actualWt    ? f2(tx.ActualWght) : '';

        txnRows += `<tr class="lw-main">
          <td>${fmtDtDay(tx.TransDt)}</td>
          <td class="r">${f2(qty)}</td>
          <td class="r">${showOpening ? 'Opening' : f2(runBal)}</td>
          <td>${tx.DoNum || ''}</td>
          <td>${vehiNum}</td>
          <td>${particularsDisp}</td>
          <td>${delivBy}</td>
        </tr>
        <tr class="lw-sub">
          <td></td>
          <td>${batchDisp}</td>
          <td>${gatePass}</td>
          <td>${gNum}</td>
          <td>${transType}</td>
          <td>${actualWt}</td>
          <td></td>
        </tr>`;
      }

      const remarkLine = fmtChecks.remarks && lot.TransRemark
        ? `<tr class="lot-rem"><td colspan="7">Remark : ${lot.TransRemark}</td></tr>` : '';

      sections += `
        <div class="lot-section">
          <table class="lw-tbl">
            <tr class="lot-hdr">
              <td colspan="4">Lot Num : ${lot.LotNum || ''} &nbsp;&nbsp;&nbsp; ${lot.pName || ''}</td>
              <td colspan="3"></td>
            </tr>
            <tr class="lot-info">
              <td colspan="4">Item Name : ${lot.iName || ''} &nbsp;&nbsp;&nbsp; Doc No.: ${lot.DocNo || ''}</td>
              <td colspan="3"></td>
            </tr>
            <tr class="lot-arv">
              <td colspan="7">Arrival Quantity : ${f2(lot.ArvQty)} ${lot.Packing || ''} &nbsp;&nbsp;&nbsp; Arrival Date : ${fmtDtDay(lot.ArvDt)} &nbsp;&nbsp;&nbsp; Weight : ${lot.PackWght || ''} &nbsp;&nbsp;&nbsp; Do No.: ${lot.ArvDoNum || ''}</td>
            </tr>
            <tr class="col-hdr1">
              <th>Date</th>
              <th class="r">Quantity</th>
              <th class="r">Balance</th>
              <th>Do No.</th>
              <th>${fmtChecks.vehicleNo  ? 'Vehical No'  : ''}</th>
              <th>${fmtChecks.particulars ? 'Particulars' : ''}</th>
              <th>${fmtChecks.delivOn    ? 'Delivery By' : ''}</th>
            </tr>
            <tr class="col-hdr2">
              <td></td>
              <td>${fmtChecks.batchNo   ? 'Batch No.'    : ''}</td>
              <td>${fmtChecks.gatePass  ? 'Gate Pass'    : ''}</td>
              <td>${fmtChecks.godownNo  ? 'GNum'         : ''}</td>
              <td>${fmtChecks.transType ? 'Type'         : ''}</td>
              <td>${fmtChecks.actualWt  ? 'Actual Weight': ''}</td>
              <td></td>
            </tr>
            ${txnRows}
            ${remarkLine}
          </table>
          <div class="lot-sep">&mdash;&nbsp;&mdash;&nbsp;&mdash;&nbsp;&mdash;&nbsp;&mdash;&nbsp;&mdash;&nbsp;&mdash;&nbsp;&mdash;&nbsp;&mdash;&nbsp;&mdash;&nbsp;&mdash;&nbsp;&mdash;</div>
        </div>
      `;
    }

    return `<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>Lot Wise Report</title>
      <style>${LOT_WISE_CSS}</style>
    </head><body>
      <div class="no-print">
        <button onclick="window.print()">Print / Save as PDF</button>
      </div>
      <div class="pg-hdr">
        ${logo ? `<img src="${logo}" alt="">` : `<div style="font-size:16px;font-weight:bold;letter-spacing:2px">${compName || ''}</div>`}
        <div class="pg-title">Lot detail from ${asFrom} to ${asTo}</div>
      </div>
      ${sections}
      <p class="lw-note">Note : This is computer generated report subject to physical verification.</p>
      <p class="pf">Print Date &nbsp;&nbsp;${printDt}</p>
      <script>window.addEventListener('load',function(){window.print();});<\/script>
    </body></html>`;

  } else if (reportType === 'party-bal') {
    // ── Group rows by party ─────────────────────────────────────────────────
    const parties = [];
    let cur = null;
    for (const r of rows) {
      if (r.pName !== cur) { cur = r.pName; parties.push({ name: r.pName, lots: [] }); }
      parties[parties.length - 1].lots.push(r);
    }

    const showTotWt  = fmtChecks.totalWt;
    const showVal    = fmtChecks.itemValue;
    const showManuf  = fmtChecks.manuf;
    const showRem    = fmtChecks.remarks;
    const colCount   = showTotWt ? 7 : 6;
    const asOn       = fmtDt(endDate);
    const printDt    = fmtDt(new Date().toISOString().slice(0, 10));

    // ── Build per-party tables ──────────────────────────────────────────────
    let sections = '';
    for (const party of parties) {
      let partyValue = 0;
      let lotRows = '';

      for (const r of party.lots) {
        const bal      = parseFloat(r.balance)  || 0;
        const pwt      = parseFloat(r.PackWght) || 0;
        const rate     = parseFloat(r.ItemRate) || 0;
        const totalWt  = bal * pwt;
        const value    = totalWt * rate;
        partyValue    += value;

        // Main lot row
        lotRows += `<tr>
          <td>${r.LotNum || ''}</td>
          <td>${r.iName || ''}${r.ItemExtDesc ? ' ' + r.ItemExtDesc : ''}</td>
          <td>${f2(bal)} ${r.Packing || ''}</td>
          <td class="r">${parseFloat(r.ArvQty) || ''}</td>
          <td class="r">${f2(pwt)}</td>
          <td class="c">${fmtDt(r.ArvDt)}</td>
          ${showTotWt ? `<td class="r">${Math.round(totalWt)}</td>` : ''}
        </tr>`;

        // Doc / supplier row
        const docNo  = r.BENum || r.DoNum || '';
        let suppPart = '';
        if (showManuf && r.TransExtDetail) suppPart += `Supplier Name - ${r.TransExtDetail}`;
        if (showRem   && r.TransRemark)    suppPart += `${suppPart ? '&nbsp;&nbsp;&nbsp;' : ''}Remarks: ${r.TransRemark}`;
        lotRows += `<tr class="doc">
          <td colspan="2">Doc No. - ${docNo}</td>
          <td colspan="${colCount - 2}">${suppPart}</td>
        </tr>`;

        // Value calculation row (only when ItemValue checked and rate > 0)
        if (showVal && rate > 0) {
          lotRows += `<tr class="val">
            <td colspan="${colCount}" style="text-align:right">
              ${Math.round(totalWt)} x ${f2(rate)} = ${f2(value)}
            </td>
          </tr>`;
        }
      }

      const pgBreak = !fmtChecks.continuousPage && sections !== '' ? ' style="page-break-before:always"' : '';
      sections += `
        <div${pgBreak}>
        <p class="party-stmt">Balance statement for M/s <strong>${party.name}</strong></p>
        <table>
          <thead><tr>
            <th style="width:10%">Lot No</th>
            <th style="width:30%">Item Name</th>
            <th style="width:14%">Balance</th>
            <th class="r" style="width:10%">Arrival<br>Quantity</th>
            <th class="r" style="width:9%">Weight<br>(Kg)</th>
            <th class="c" style="width:11%">Arrival<br>Date</th>
            ${showTotWt ? '<th class="r" style="width:10%">Total<br>Weight</th>' : ''}
          </tr></thead>
          <tbody>${lotRows}</tbody>
        </table>
        ${showVal ? `<div class="ptot">${party.name} Total Value &nbsp;&nbsp;${fmtMoney(partyValue)}</div>` : ''}
        </div>
      `;
    }

    const html = `<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>${title}</title>
      <style>${PARTY_BAL_CSS}</style>
    </head><body>
      <div class="no-print">
        <button onclick="window.print()">Print / Save as PDF</button>
      </div>
      <div class="pg-hdr">
        ${logo ? `<img src="${logo}" alt="">` : compName ? `<div style="font-size:18px;font-weight:bold;letter-spacing:3px">${compName}</div>` : ''}
        <div class="bal-on">Balance as on ${asOn}</div>
      </div>
      ${sections}
      <p class="note">Note : This is computer generated report subject to physical verification.</p>
      <p class="pf">Print Date &nbsp;&nbsp;${printDt}</p>
      <script>window.addEventListener('load',function(){window.print();});<\/script>
    </body></html>`;

    return html;

  } else if (reportType === 'party-bal-detail') {
    // Group lots by party
    const parties = [];
    let curParty = null;
    for (const lot of (lots || [])) {
      if (lot.pName !== curParty) {
        curParty = lot.pName;
        parties.push({ name: lot.pName, lots: [] });
      }
      parties[parties.length - 1].lots.push(lot);
    }

    const showTotWt = fmtChecks.totalWt;
    const showBeNo  = fmtChecks.beNo;
    const showVal   = fmtChecks.itemValue;
    const showManuf = fmtChecks.manuf;
    const showRem   = fmtChecks.remarks;
    const colCount  = showTotWt ? 7 : 6;
    const asFrom    = fmtDtMon(startDate) || 'All';
    const asTo      = fmtDtMon(endDate);
    const printDt   = fmtDt(new Date().toISOString().slice(0, 10));

    let sections = '';
    for (const party of parties) {
      let partyValue = 0;
      let lotRows = '';

      for (const lot of party.lots) {
        const bal     = parseFloat(lot.balance) || 0;
        const pwt     = parseFloat(lot.PackWght) || 0;
        const rate    = parseFloat(lot.ItemRate) || 0;
        const totalWt = Math.round(bal * pwt);
        const value   = totalWt * rate;
        if (showVal) partyValue += value;

        const iNameDisp = (lot.iName || '') + (lot.ItemExtDesc ? ' ' + lot.ItemExtDesc : '');
        const balDisp   = `${parseInt(bal)}${lot.Packing ? ' ' + lot.Packing : ''}`;

        lotRows += `<tr>
          <td class="bold">${lot.LotNum || ''}</td>
          <td>${iNameDisp}</td>
          <td>${balDisp}</td>
          <td class="r">${parseFloat(lot.ArvQty) || ''}</td>
          <td class="r">${pwt || ''}</td>
          <td>${fmtDtMon(lot.ArvDt)}</td>
          ${showTotWt ? `<td class="r">${totalWt.toLocaleString('en-IN')}</td>` : ''}
        </tr>`;

        const docNo   = lot.BENum || lot.DoNum || '';
        let suppPart  = '';
        if (showManuf && lot.TransExtDetail) suppPart = `Supplier Name : ${lot.TransExtDetail}`;
        if (showRem && lot.TransRemark)      suppPart += (suppPart ? '&nbsp;&nbsp;&nbsp;' : '') + `Remarks: ${lot.TransRemark}`;
        lotRows += `<tr class="doc">
          <td colspan="2">Doc No. - ${docNo}</td>
          <td colspan="${colCount - 2}">${suppPart}</td>
        </tr>`;

        if (showVal && rate > 0) {
          lotRows += `<tr class="val">
            <td colspan="${colCount}" style="text-align:right">
              ${totalWt.toLocaleString('en-IN')} X ${fmtMoney(rate)} = ${fmtMoney(value)}
            </td>
          </tr>`;
        }

        // Sub-table: shown only when lot has period transactions
        if (lot.txns && lot.txns.length > 0) {
          let runBal = 0;
          let subRows = '';
          let showArvAsOpening = false;

          if (startDate) {
            const obQty = parseFloat(lot.obQty) || 0;
            if (obQty !== 0) {
              runBal = obQty;
              subRows += `<tr class="ob">
                <td>${fmtDt(startDate)}</td>
                <td class="r">${f2(obQty)}</td>
                <td class="r">Opening</td>
                <td></td><td></td><td></td><td></td>
              </tr>
              <tr class="lw-sub"><td colspan="7"></td></tr>`;
            } else {
              showArvAsOpening = true;
            }
          } else {
            showArvAsOpening = true;
          }

          let usedArvOpening = false;
          let hasDispatch = false;
          for (const tx of lot.txns) {
            const isARV = tx.TransType === 'ARV';
            // Skip ARV that isn't being used as the Opening row — don't corrupt runBal
            if (isARV && !showArvAsOpening) continue;

            const qty = parseFloat(tx.TransQty) || 0;
            runBal   += qty;

            const particularsDisp = fmtChecks.particulars ? (tx.TransExtDetail || '').replace(/\r?\n/g, '<br>') : (tx.TransExtDetail || '');
            const batchDisp       = fmtChecks.batchNo     ? (tx.BatchNum  || '') : '';
            const delivBy         = fmtChecks.delivOn     ? (tx.PickupBy || tx.TransNote || tx.DelivOpt || '') : '';
            const vehiNum         = fmtChecks.vehicleNo   ? (tx.VehiNum  || '') : '';
            const gatePass        = fmtChecks.gatePass    ? (tx.GatePass || '') : '';
            const gNum            = fmtChecks.godownNo    ? (tx.gNum     || '') : '';
            const transType       = fmtChecks.transType   ? (tx.TransType || '') : '';
            const actualWt        = fmtChecks.actualWt    ? f2(tx.ActualWght) : '';

            if (isARV && showArvAsOpening && !usedArvOpening) {
              usedArvOpening = true;
              subRows += `<tr class="ob">
                <td>${fmtDt(tx.TransDt)}</td>
                <td class="r">${f2(qty)}</td>
                <td class="r">Opening</td>
                <td></td><td></td><td></td><td></td>
              </tr>
              <tr class="lw-sub"><td colspan="7"></td></tr>`;
            } else if (!isARV) {
              hasDispatch = true;
              subRows += `<tr>
                <td>${fmtDt(tx.TransDt)}</td>
                <td class="r">${f2(qty)}</td>
                <td class="r">${f2(runBal)}</td>
                <td>${tx.DoNum || ''}</td>
                <td>${vehiNum}</td>
                <td>${particularsDisp}</td>
                <td>${delivBy}</td>
              </tr>
              <tr class="lw-sub">
                <td></td>
                <td>${batchDisp}</td>
                <td>${gatePass}</td>
                <td>${gNum}</td>
                <td>${transType}</td>
                <td>${actualWt}</td>
                <td></td>
              </tr>`;
            }
          }

          if (hasDispatch) {
            lotRows += `<tr class="sub-wrap"><td colspan="${colCount}">
              <table class="sub-tbl">
                <tr>
                  <th>Date</th>
                  <th class="r">Quantity</th>
                  <th class="r">Balance</th>
                  <th>Do No.</th>
                  <th>${fmtChecks.vehicleNo  ? 'Vehicle No.' : ''}</th>
                  <th>${fmtChecks.particulars ? 'Particulars' : 'Particulars'}</th>
                  <th>${fmtChecks.delivOn    ? 'Delivery By' : ''}</th>
                </tr>
                <tr class="col-hdr2">
                  <td></td>
                  <td>${fmtChecks.batchNo   ? 'Batch No.'     : ''}</td>
                  <td>${fmtChecks.gatePass  ? 'Gate Pass'     : ''}</td>
                  <td>${fmtChecks.godownNo  ? 'GNum'          : ''}</td>
                  <td>${fmtChecks.transType ? 'Type'          : ''}</td>
                  <td>${fmtChecks.actualWt  ? 'Actual Weight' : ''}</td>
                  <td></td>
                </tr>
                ${subRows}
              </table>
            </td></tr>`;
          }
        }
      }

      const pgBreakD = !fmtChecks.continuousPage && sections !== '' ? ' style="page-break-before:always"' : '';
      sections += `
        <div${pgBreakD}>
        <p class="party-stmt">Balance statement for M/s <strong>${party.name}</strong></p>
        <table class="main-tbl">
          <thead><tr>
            <th style="width:10%">Lot No</th>
            <th style="width:30%">Item Name</th>
            <th style="width:12%">Balance</th>
            <th class="r" style="width:10%">Arrival<br>Quantity</th>
            <th class="r" style="width:8%">Weight<br>(Kg)</th>
            <th style="width:12%">Arrival<br>Date</th>
            ${showTotWt ? '<th class="r" style="width:10%">Total<br>Weight</th>' : ''}
          </tr></thead>
          <tbody>${lotRows}</tbody>
        </table>
        ${showVal ? `<div class="ptot">${party.name} Total Value &nbsp;&nbsp;${fmtMoney(partyValue)}</div>` : ''}
        </div>
      `;
    }

    return `<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>Party Detail Balance Report</title>
      <style>${PARTY_BAL_DETAIL_CSS}</style>
    </head><body>
      <div class="no-print">
        <button onclick="window.print()">Print / Save as PDF</button>
      </div>
      <div class="pg-hdr">
        ${logo ? `<img src="${logo}" alt="">` : `<div style="font-size:18px;font-weight:bold;letter-spacing:3px">${compName || ''}</div>`}
        <div class="bal-range">Balance Statement from ${asFrom} to ${asTo}</div>
      </div>
      ${sections}
      <p class="note">Note : This is computer generated report subject to physical verification.</p>
      <p class="pf">Print Date : ${printDt}</p>
      <script>window.addEventListener('load',function(){window.print();});<\/script>
    </body></html>`;

  } else if (reportType === 'godown-bal') {
    // Group rows by godown number
    const godowns = [];
    let curGod = null;
    for (const r of rows) {
      if (r.gNum !== curGod) { curGod = r.gNum; godowns.push({ gNum: r.gNum, lots: [] }); }
      godowns[godowns.length - 1].lots.push(r);
    }

    const showVal   = fmtChecks.itemValue;
    const showTotWt = fmtChecks.totalWt;
    const COLS      = showTotWt ? 8 : 7;
    const asOn      = fmtDt(endDate);
    const printDt   = fmtDt(new Date().toISOString().slice(0, 10));

    let sections = '';
    for (const god of godowns) {
      let godTotalWt = 0;
      let lotRows    = '';

      for (const r of god.lots) {
        const bal     = parseFloat(r.balance)   || 0;
        const pwt     = parseFloat(r.PackWght)  || 0;
        const gwt     = parseFloat(r.GrossWght) || 0;
        const rate    = parseFloat(r.ItemRate)  || 0;
        const totalWt = Math.round(bal * pwt);
        if (showTotWt) godTotalWt += totalWt;

        const iNameDisp = (r.iName || '') + (r.ItemExtDesc ? ' ' + r.ItemExtDesc : '');
        const packDisp  = `${r.PackingType || ''}/${r.PackingColour || ''}`;
        const batchDisp = (r.BatchNum || '').replace(/\r?\n/g, '<br>');

        lotRows += `<tr class="main">
          <td>${r.pName || ''}</td>
          <td class="bold">${iNameDisp}</td>
          <td class="r">${pwt || ''}</td>
          <td class="r">${fmtDt(r.ArvDt)}</td>
          <td class="r">${f2(r.ArvQty)} ${r.Packing || ''}</td>
          <td class="r">${f2(bal)}</td>
          <td></td>
          ${showTotWt ? `<td class="r">${Math.round(totalWt).toLocaleString('en-IN')}</td>` : ''}
        </tr>
        <tr class="sub">
          <td>${r.LotNum || ''}</td>
          <td>Supplier Name :${r.TransExtDetail || ''}</td>
          <td class="r">${gwt || 0}</td>
          <td></td>
          <td>${packDisp}</td>
          <td></td>
          <td>${batchDisp}</td>
          ${showTotWt ? '<td></td>' : ''}
        </tr>`;

        if (showVal && rate > 0) {
          const value = totalWt * rate;
          lotRows += `<tr class="val"><td colspan="${COLS}">${totalWt} x ${f2(rate)} = ${f2(value)}</td></tr>`;
        }
      }

      sections += `
        <table class="god-tbl">
          <tr>
            <td colspan="2" class="god-hdr-cell">Godown No.&nbsp;&nbsp;&nbsp;${god.gNum}</td>
            <th class="r">Weight<br>(Kg)</th>
            <th class="r">Arrival<br>Date</th>
            <th class="r">Arrival<br>Quantity</th>
            <th class="r">Balance</th>
            <th>BatchNum</th>
            ${showTotWt ? '<th class="r">Total<br>Weight</th>' : ''}
          </tr>
          <tr>
            <th class="l">Party Name</th>
            <th class="l">Item Name</th>
            <td colspan="${COLS - 2}"></td>
          </tr>
          <tr class="sep"><td colspan="${COLS}"></td></tr>
          ${lotRows}
          <tr class="gtot">
            <td colspan="${COLS - 1}"></td>
            <td>${showTotWt ? godTotalWt : ''}</td>
          </tr>
        </table>
        <div class="xxx">--- XXX ---</div>
      `;
    }

    return `<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>Godown Balance Report</title>
      <style>${GODOWN_BAL_CSS}</style>
    </head><body>
      <div class="no-print">
        <button onclick="window.print()">Print / Save as PDF</button>
      </div>
      <p class="pg-title">Godown wise balance report as on ${asOn}</p>
      ${sections}
      <p class="pf">Print Date &nbsp;&nbsp;${printDt}</p>
      <script>window.addEventListener('load',function(){window.print();});<\/script>
    </body></html>`;
  }

  const html = `<!DOCTYPE html><html><head>
    <meta charset="utf-8"/>
    <title>${title}</title>
    <style>${PRINT_CSS}</style>
  </head><body>
    <button onclick="window.print()" style="margin-bottom:8px;padding:4px 12px;cursor:pointer">Print / Save as PDF</button>
    <h2>${title}</h2>
    <p class="sub">Period: ${period} &nbsp;|&nbsp; ${rows.length} records</p>
    ${body}
    <script>window.addEventListener('load',function(){window.print();});<\/script>
  </body></html>`;

  return html;
}

function openReportWindow(data, logo = '') {
  const html = buildReportHTML({ ...data, compName: data.compName || '', logo });
  const win = window.open('', '_blank');
  if (!win) return 'blocked';
  win.document.write(html);
  win.document.close();
  return 'ok';
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// EmailSendDialog
//
// GROUP mode   (selGroups selected in template):
//   • One PDF per pGroup containing ALL parties in that group
//   • Email sent to ONE contact address (first party in group with email)
//   • Parties/groups with zero balance are excluded
//
// INDIVIDUAL mode (specific parties selected, or no filter):
//   • One PDF per party with only their own lots
//   • Email sent to that party's address
//   • Parties with zero balance are excluded
// ─────────────────────────────────────────────────────────────────────────────
function EmailSendDialog({ open, onClose, reportParams, mainRows, selectedLots, compName, logo = '', mode = 'individual', groupCompName = '' }) {
  // items = list shown in dialog
  // GROUP mode:   [{ key: groupName, label: groupName, email, lotIds[], partyCount }]
  // INDIV mode:   [{ key: partyName, label: partyName, email, lotIds[] }]
  const [items,     setItems]     = useState([]);
  const [selKeys,   setSelKeys]   = useState(new Set());
  const [subject,   setSubject]   = useState('');
  const [sending,   setSending]   = useState(false);
  const [results,   setResults]   = useState([]);

  useEffect(() => {
    if (!open) { setResults([]); return; }

    // Only include lots that are selected in the grid AND have non-zero balance
    const activeRows = (mainRows || []).filter(
      (r) => (!selectedLots || selectedLots.has(r.pfkOriLotID)) && parseFloat(r.balance) !== 0
    );

    const endDate = reportParams.endDate || '';
    const ds = endDate ? `${endDate.slice(8,10)}-${endDate.slice(5,7)}-${endDate.slice(2,4)}` : '';
    setSubject(`Statement: Balance stock as on ${ds}`);

    if (mode === 'group') {
      // Build one entry per pGroup; email = first party in group that has an email
      const groupMap = new Map();
      for (const row of activeRows) {
        const g = row.pGroup || '(No Group)';
        if (!groupMap.has(g)) groupMap.set(g, { key: g, label: g, email: '', lotIds: new Set(), parties: new Set() });
        const grp = groupMap.get(g);
        grp.lotIds.add(row.pfkOriLotID);
        grp.parties.add(row.pName);
        if (!grp.email && row.pEmail) grp.email = row.pEmail; // first email found
      }
      const list = [...groupMap.values()]
        .map((g) => ({ ...g, lotIds: [...g.lotIds], partyCount: g.parties.size }))
        .sort((a, b) => a.label.localeCompare(b.label));
      setItems(list);
      setSelKeys(new Set(list.filter((g) => g.email).map((g) => g.key)));
    } else {
      // Build one entry per party
      const partyMap = new Map();
      for (const row of activeRows) {
        if (!partyMap.has(row.pName))
          partyMap.set(row.pName, { key: row.pName, label: row.pName, email: row.pEmail || '', lotIds: new Set() });
        partyMap.get(row.pName).lotIds.add(row.pfkOriLotID);
      }
      const list = [...partyMap.values()]
        .map((p) => ({ ...p, lotIds: [...p.lotIds] }))
        .sort((a, b) => a.label.localeCompare(b.label));
      setItems(list);
      setSelKeys(new Set(list.filter((p) => p.email).map((p) => p.key)));
    }
  }, [open]);

  const toggle = (key) => setSelKeys((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const handleSend = async () => {
    setSending(true);
    setResults([]);
    const selected = items.filter((it) => selKeys.has(it.key) && it.email);
    if (!selected.length) { setSending(false); return; }

    try {
      const rt        = reportParams.reportType;
      const useLots   = rt === 'party-bal-detail' || rt === 'lot-wise';
      const allLotIds = [...new Set(selected.flatMap((it) => it.lotIds))];

      // Fetch report data using the SAME reportType the user has selected in the combo box.
      const { data } = await api.post('/reports/balance-report/report', {
        ...reportParams,
        selectedLotIds: allLotIds,
      });

      const resolvedCompName = data.compName || compName || '';
      const emailCompName = groupCompName || resolvedCompName;

      // party-bal-detail / lot-wise → data.lots[]
      // party-bal / godown-bal      → data.rows[]  (these don't include pGroup in SQL)
      const allItems = useLots ? (data.lots || []) : (data.rows || []);

      // party-bal and godown-bal rows lack pGroup; build lookups from mainRows
      const pNameToGroup    = new Map(); // pName → pGroup
      const groupFirstParty = new Map(); // pGroup → first pName in that group
      for (const row of (mainRows || [])) {
        if (row.pName && !pNameToGroup.has(row.pName))
          pNameToGroup.set(row.pName, row.pGroup || '(No Group)');
        const g = row.pGroup || '(No Group)';
        if (row.pName && !groupFirstParty.has(g))
          groupFirstParty.set(g, row.pName);
      }

      const itemsByGroup = new Map();
      const itemsByParty = new Map();
      for (const item of allItems) {
        const g = item.pGroup || pNameToGroup.get(item.pName) || '(No Group)';
        if (!itemsByGroup.has(g)) itemsByGroup.set(g, []);
        itemsByGroup.get(g).push(item);
        if (!itemsByParty.has(item.pName)) itemsByParty.set(item.pName, []);
        itemsByParty.get(item.pName).push(item);
      }

      // Build HTML for each recipient using the SAME buildReportHTML as View Report.
      // Puppeteer on the backend will convert this HTML to a PDF attachment.
      const partiesData = selected.map((it) => {
        const partyItems = mode === 'group'
          ? (itemsByGroup.get(it.key) || [])
          : (itemsByParty.get(it.key) || []);
        if (partyItems.length === 0) return null;

        const html = buildReportHTML({
          lots:       useLots ? partyItems : [],
          rows:       useLots ? [] : partyItems,
          reportType: rt,
          startDate:  reportParams.startDate,
          endDate:    reportParams.endDate,
          fmtChecks:  reportParams.formatSettings || {},
          compName:   emailCompName,
          logo,
        });

        // In group mode use the first party name from mainRows for the email greeting
        const greetingName = mode === 'group'
          ? (groupFirstParty.get(it.key) || it.label)
          : it.label;

        return { partyName: it.label, greetingName, email: it.email, html };
      }).filter(Boolean);

      if (!partiesData.length) {
        setResults([{ partyName: 'All', email: '', status: 'skipped', error: 'All selected parties have zero balance' }]);
        return;
      }

      const resp = await api.post('/reports/balance-report/send-emails', {
        mode,
        partiesData,
        subject,
        compName:  emailCompName,
        startDate: reportParams.startDate,
        endDate:   reportParams.endDate,
      }, { timeout: 300000 }); // 5 min — Puppeteer PDF generation for many parties
      setResults(resp.data.results || []);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Network error';
      setResults(selected.map((it) => ({ partyName: it.label, email: it.email, status: 'failed', error: msg })));
    } finally {
      setSending(false);
    }
  };

  const selCount     = [...selKeys].filter((k) => items.find((it) => it.key === k && it.email)).length;
  const noEmailCount = items.filter((it) => !it.email).length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Box>
          <Typography fontWeight={600}>Send Balance Report Emails</Typography>
          <Typography fontSize={10} color="text.secondary">
            {mode === 'group' ? 'Group mode — one combined PDF per group' : 'Individual mode — separate PDF per party'}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 200 }}>
        {results.length === 0 && (
          <>
            {items.length === 0 && (
              <Alert severity="info">No parties with non-zero stock balance found.</Alert>
            )}
            {noEmailCount > 0 && items.length > 0 && (
              <Alert severity="warning" sx={{ mb: 1.5, fontSize: 11 }}>
                {noEmailCount} {mode === 'group' ? 'group' : 'part'}{noEmailCount > 1 ? 's have' : ' has'} no email address — will be skipped.
              </Alert>
            )}
            {items.length > 0 && (
              <>
                <TextField fullWidth size="small" label="Subject" value={subject}
                  onChange={(e) => setSubject(e.target.value)} sx={{ mb: 1.5 }} />
                <Typography fontSize={12} fontWeight={600} sx={{ mb: 0.5 }}>
                  {mode === 'group'
                    ? `Groups — ${selCount} of ${items.length} selected`
                    : `Parties — ${selCount} of ${items.length} selected (zero-balance excluded)`}
                </Typography>
                <Box sx={{ border: '1px solid #e0e0e0', borderRadius: 1, maxHeight: 260, overflowY: 'auto' }}>
                  {items.map((it) => (
                    <Box key={it.key}
                      sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.5,
                            '&:hover': { bgcolor: '#f5f5f5' },
                            cursor: it.email ? 'pointer' : 'default', opacity: it.email ? 1 : 0.45 }}
                      onClick={() => it.email && toggle(it.key)}
                    >
                      <Checkbox size="small" checked={selKeys.has(it.key) && !!it.email}
                        disabled={!it.email} disableRipple sx={{ p: 0.25 }} />
                      <Box sx={{ ml: 0.5, flex: 1 }}>
                        <Typography fontSize={12}>{it.label}
                          {mode === 'group' && it.partyCount > 0 && (
                            <Typography component="span" fontSize={10} color="text.secondary" sx={{ ml: 0.5 }}>
                              ({it.partyCount} {it.partyCount === 1 ? 'party' : 'parties'})
                            </Typography>
                          )}
                        </Typography>
                        <Typography fontSize={10} color={it.email ? 'text.secondary' : 'error.main'}>
                          {it.email || 'No email address'}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </>
            )}
          </>
        )}
        {results.length > 0 && (
          <Box>
            <Alert severity={results.every((r) => r.status === 'sent') ? 'success' : 'warning'} sx={{ mb: 1.5 }}>
              Sent: {results.filter((r) => r.status === 'sent').length} &nbsp;|&nbsp;
              Failed/Skipped: {results.filter((r) => r.status !== 'sent').length}
            </Alert>
            {results.map((r, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
                <Typography fontSize={11} sx={{ color: r.status === 'sent' ? 'success.main' : 'error.main', minWidth: 44, flexShrink: 0 }}>
                  {r.status === 'sent' ? '✓ Sent' : r.status === 'skipped' ? '– Skip' : '✗ Fail'}
                </Typography>
                <Box>
                  <Typography fontSize={11}>{r.partyName}{r.email ? ` <${r.email}>` : ''}</Typography>
                  {r.error && <Typography fontSize={10} color="error.main">{r.error}</Typography>}
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{results.length > 0 ? 'Close' : 'Cancel'}</Button>
        {results.length === 0 && (
          <Button variant="contained" onClick={handleSend}
            disabled={sending || selCount === 0}
            startIcon={sending ? <CircularProgress size={14} color="inherit" /> : null}>
            {sending
              ? 'Sending…'
              : mode === 'group'
                ? `Send ${selCount} Group Report${selCount !== 1 ? 's' : ''}`
                : `Send to ${selCount} Part${selCount !== 1 ? 'ies' : 'y'}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FilterPanel — searchable checkbox list
// ─────────────────────────────────────────────────────────────────────────────
function FilterPanel({ items, idField, nameField, subField, pillField, selected, onChange }) {
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      String(it[nameField]).toLowerCase().includes(q) ||
      (subField   && String(it[subField]   || '').toLowerCase().includes(q)) ||
      (pillField  && String(it[pillField]  || '').toLowerCase().includes(q))
    );
  }, [items, nameField, subField, pillField, search]);

  const allSelected  = items.length > 0 && items.every((it) => selected.includes(it[idField]));
  const noneSelected = items.every((it) => !selected.includes(it[idField]));

  const toggleAll = () => {
    if (allSelected) onChange([]);
    else onChange(items.map((it) => it[idField]));
  };

  const toggle = (id) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <Box>
      <TextField
        size="small" fullWidth placeholder="Search…"
        value={search} onChange={(e) => setSearch(e.target.value)}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        sx={{ mb: 1 }}
      />
      <Stack direction="row" spacing={1} sx={{ mb: 0.5 }}>
        <Button size="small" variant="text" sx={{ fontSize: 11 }} onClick={toggleAll}>
          {allSelected ? 'Deselect All' : 'Select All'}
        </Button>
        {!noneSelected && !allSelected && (
          <Button size="small" variant="text" sx={{ fontSize: 11 }} onClick={() => onChange([])}>
            Clear
          </Button>
        )}
      </Stack>
      <Box sx={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
        {visible.map((it) => (
          <Box key={it[idField]}
            sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.25, '&:hover': { bgcolor: '#f5f5f5' }, cursor: 'pointer' }}
            onClick={() => toggle(it[idField])}
          >
            <Checkbox size="small" checked={selected.includes(it[idField])} disableRipple sx={{ p: 0.25 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 0.5, flex: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: 12 }}>{it[nameField]}</Typography>
              {subField && it[subField] && (
                <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>({it[subField]})</Typography>
              )}
              {pillField && it[pillField] && (
                <Chip
                  label={it[pillField]}
                  size="small"
                  sx={{ fontSize: 10, height: 18, fontWeight: 500, borderRadius: '9px',
                        bgcolor: 'action.selected', color: 'text.secondary',
                        border: '1px solid', borderColor: 'divider',
                        '& .MuiChip-label': { px: '7px' } }}
                />
              )}
            </Box>
          </Box>
        ))}
        {visible.length === 0 && (
          <Typography sx={{ fontSize: 11, color: 'text.secondary', p: 1 }}>No items found</Typography>
        )}
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TemplateDialog — save template
// ─────────────────────────────────────────────────────────────────────────────
function TemplateSaveDialog({ open, onClose, onSave, onUpdate, existingTemplate }) {
  const [name, setName] = useState('');
  useEffect(() => { if (open) setName(''); }, [open]);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Save Template</DialogTitle>
      <DialogContent>
        {existingTemplate && (
          <Box sx={{ mb: 1.5, p: 1.5, bgcolor: '#f5f5f5', borderRadius: 1, border: '1px solid #e0e0e0' }}>
            <Typography fontSize={11} color="text.secondary" sx={{ mb: 1 }}>Currently loaded:</Typography>
            <Button fullWidth variant="contained" size="small" startIcon={<SaveIcon />}
              onClick={() => onUpdate(existingTemplate.id)}>
              Update &ldquo;{existingTemplate.name}&rdquo;
            </Button>
          </Box>
        )}
        <Divider sx={{ my: 1 }}><Typography fontSize={11} color="text.secondary">{existingTemplate ? 'or save as new' : 'template name'}</Typography></Divider>
        <TextField autoFocus fullWidth size="small" label="New Template Name"
          value={name} onChange={(e) => setName(e.target.value)} sx={{ mt: 1 }}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="outlined" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save as New</Button>
      </DialogActions>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TemplateSelectDialog — load template
// ─────────────────────────────────────────────────────────────────────────────
function TemplateSelectDialog({ open, onClose, onSelect }) {
  const [templates, setTemplates] = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [err,       setErr]       = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setErr('');
    api.get('/reports/templates?repName=BAL_REP')
      .then((r) => setTemplates(r.data))
      .catch((e) => setErr(e.response?.data?.error || 'Failed to load templates'))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Select Template</DialogTitle>
      <DialogContent dividers>
        {loading && <CircularProgress size={24} />}
        {!loading && err && <Alert severity="error" sx={{ mb: 1 }}>{err}</Alert>}
        {!loading && !err && templates.length === 0 && (
          <Typography color="text.secondary">
            No saved templates found. Use "Save Template" on the General tab to create one.
          </Typography>
        )}
        {templates.map((t) => (
          <Box key={t.cpkTemplID}
            sx={{ p: 1, mb: 0.5, borderRadius: 1, border: '1px solid #e0e0e0', cursor: 'pointer', '&:hover': { bgcolor: '#f5f5f5' } }}
            onClick={() => onSelect(t.cpkTemplID)}
          >
            <Typography fontWeight={600} fontSize={13}>{t.Template_Name}</Typography>
            {t.Template_Desc && <Typography fontSize={11} color="text.secondary">{t.Template_Desc}</Typography>}
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MediaViewerDialog — shows photos / documents fetched from the backend
// ─────────────────────────────────────────────────────────────────────────────
const backendOrigin = (api.defaults.baseURL || '/api').replace(/\/api\/?$/, '');

// DB stores FaYear as 4-char '2627'; upload folders use full '2026-2027'.
function toFaYearFull(raw) {
  if (!raw || raw.length !== 4) return raw || '';
  return `20${raw.slice(0, 2)}-20${raw.slice(2, 4)}`;
}
const isImageFile   = (name) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(name || '');

function MediaViewerDialog({ open, onClose, title, loading, files }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Typography fontWeight={600}>{title}</Typography>
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 120 }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        )}
        {!loading && files.length === 0 && (
          <Typography color="text.secondary" align="center" sx={{ py: 2 }}>No files found.</Typography>
        )}
        {!loading && files.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
            {files.map((f, i) => {
              const fullUrl  = `${backendOrigin}${f.url}`;
              const filename = f.filename || `File ${i + 1}`;
              return isImageFile(f.filename || f.url) ? (
                <Box key={i} component="a" href={fullUrl} target="_blank" rel="noopener noreferrer"
                  sx={{ display: 'block', border: '1px solid #e0e0e0', borderRadius: 1, overflow: 'hidden', textDecoration: 'none' }}>
                  <img src={fullUrl} alt={filename}
                    style={{ display: 'block', maxWidth: 200, maxHeight: 160, objectFit: 'contain' }} />
                  <Typography fontSize={10} sx={{ px: 0.5, py: 0.25, bgcolor: '#f5f5f5', color: 'text.secondary' }}>{filename}</Typography>
                </Box>
              ) : (
                <Box key={i} component="a" href={fullUrl} target="_blank" rel="noopener noreferrer"
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.5, p: 1, border: '1px solid #e0e0e0', borderRadius: 1,
                    textDecoration: 'none', color: 'primary.main', '&:hover': { bgcolor: '#f5f5f5' } }}>
                  <DescriptionIcon fontSize="small" />
                  <Typography fontSize={12}>{filename}</Typography>
                </Box>
              );
            })}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function BalanceReportPage() {
  const { can, user } = useAuth();
  const logo = user?.groupID === 'BHW'  ? ADITYA_LOGO_B64
             : user?.groupID === 'VLCO' ? VLCO_LOGO_B64 : '';
  const GROUP_DISPLAY_NAMES = { BHW: 'Aditya Services', VLCO: 'Velji Lukhamsi & Co' };
  const groupCompName = GROUP_DISPLAY_NAMES[user?.groupID] || '';

  // ── Filter data from /filters ──────────────────────────────────────────────
  const [filterData, setFilterData] = useState({ partyGroups: [], parties: [], items: [], godowns: [] });
  const [filtersLoading, setFiltersLoading] = useState(true);

  // ── Tab 1: General state ───────────────────────────────────────────────────
  const [startDate,      setStartDate]      = useState(fyStart);
  const [endDate,        setEndDate]        = useState(todayISO);
  const [sortBy,         setSortBy]         = useState('LotNum');
  const [activeFilter,   setActiveFilter]   = useState(null);  // which panel is open
  const [selGroups,      setSelGroups]      = useState([]);
  const [selParties,     setSelParties]     = useState([]);
  const [selItems,       setSelItems]       = useState([]);
  const [selGodowns,     setSelGodowns]     = useState([]);

  // ── Tab 2: Detail state ────────────────────────────────────────────────────
  const [tab,            setTab]            = useState(0);
  const [reportFormat,   setReportFormat]   = useState('party-bal-detail');
  const [hideZeroBal,    setHideZeroBal]    = useState(false);
  const [itemSearch,     setItemSearch]     = useState('');
  const [mainRows,       setMainRows]       = useState([]);
  const [detailRows,     setDetailRows]     = useState([]);
  const [selectedLots,   setSelectedLots]   = useState(new Set());
  const [detailLotId,    setDetailLotId]    = useState(null);
  const [detailLotNum,   setDetailLotNum]   = useState('');
  const [batchLocRows,   setBatchLocRows]   = useState([]);
  const [batchLocLoading,setBatchLocLoading]= useState(false);

  // ── Loading / error state ──────────────────────────────────────────────────
  const [loading,        setLoading]        = useState(false);
  const [detailLoading,  setDetailLoading]  = useState(false);
  const [viewLoading,    setViewLoading]    = useState(false);
  const [error,          setError]          = useState('');
  const [snack,          setSnack]          = useState('');
  const [popupWarn,      setPopupWarn]      = useState(false);

  // ── Template dialogs ───────────────────────────────────────────────────────
  const [saveDialogOpen,   setSaveDialogOpen]   = useState(false);
  const [selectDialogOpen, setSelectDialogOpen] = useState(false);
  const [loadedTemplate,   setLoadedTemplate]   = useState(null); // { id, name }
  const [emailDialogOpen,  setEmailDialogOpen]  = useState(false);
  const [reportCompName,   setReportCompName]   = useState('');

  // ── Lot file existence (orange button indicator) ───────────────────────────
  const [lotFileInfo,   setLotFileInfo]   = useState({});
  const [detailDocInfo, setDetailDocInfo] = useState({});

  // ── Media viewer dialog ────────────────────────────────────────────────────
  const [mediaDialog, setMediaDialog] = useState({ open: false, title: '', loading: false, files: [] });
  const closeMedia = () => setMediaDialog((p) => ({ ...p, open: false }));

  const openMedia = useCallback((title, fetchFn) => {
    setMediaDialog({ open: true, title, loading: true, files: [] });
    fetchFn()
      .then((files) => setMediaDialog((p) => ({ ...p, loading: false, files })))
      .catch(() => setMediaDialog((p) => ({ ...p, loading: false, files: [] })));
  }, []);

  // Format checkboxes (sent to View report for print formatting context)
  const [fmtChecks, setFmtChecks] = useState({
    delivOn: false, particulars: false, batchNo: false, transType: false,
    vehicleNo: false, actualWt: false, gatePass: false, godownNo: false,
    totalWt: false, continuousPage: false, beNo: false, itemValue: false, manuf: false,
    remarks: false,
  });
  const toggleFmt = (k) => setFmtChecks((p) => ({ ...p, [k]: !p[k] }));

  // ── Load filter data on mount ──────────────────────────────────────────────
  useEffect(() => {
    api.get('/reports/balance-report/filters')
      .then((r) => setFilterData(r.data))
      .catch((err) => setError(err.response?.data?.error || 'Failed to load filter data'))
      .finally(() => setFiltersLoading(false));
  }, []);

  // ── Derived: filtered parties by selected groups ───────────────────────────
  const visibleParties = useMemo(() => {
    if (selGroups.length === 0) return filterData.parties;
    return filterData.parties.filter((p) => selGroups.includes(p.pGroup));
  }, [filterData.parties, selGroups]);

  // ── Derived: visible main grid rows (client-side hideZeroBal + itemSearch) ─
  const displayedRows = useMemo(() => {
    let rows = mainRows;
    if (hideZeroBal) rows = rows.filter((r) => parseFloat(r.balance || 0) !== 0);
    if (itemSearch.trim()) {
      const q = itemSearch.toLowerCase();
      rows = rows.filter((r) => (r.iName || '').toLowerCase().includes(q));
    }
    return rows;
  }, [mainRows, hideZeroBal, itemSearch]);

  // Sync selection to visible rows: hidden rows deselect, visible rows auto-select
  useEffect(() => {
    setSelectedLots(new Set(displayedRows.map((r) => r.pfkOriLotID)));
  }, [displayedRows]);

  // ── Running balance computation for detail grid ────────────────────────────
  const detailWithBalance = useMemo(() => {
    let running = 0;
    return detailRows
      .filter((r) => !(r.sortOrd === 1 && !parseFloat(r.TransQty)))
      .map((r) => {
        running += parseFloat(r.TransQty) || 0;
        return { ...r, runningBal: running };
      });
  }, [detailRows]);

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate() {
    if (!endDate) { setError('End Date is required.'); return false; }
    if (startDate && endDate && startDate > endDate) {
      setError('Start Date must be before End Date.');
      return false;
    }
    return true;
  }

  // ── Go ─────────────────────────────────────────────────────────────────────
  const handleGo = useCallback(async () => {
    setError('');
    if (!validate()) return;
    setLoading(true);
    setDetailRows([]);
    setDetailLotId(null);
    setBatchLocRows([]);
    try {
      const { data } = await api.post('/reports/balance-report/balances', {
        startDate: startDate || undefined,
        endDate,
        partyIds:    selParties,
        partyGroups: selGroups,
        itemIds:     selItems,
        godownIds:   selGodowns,
        sortBy,
      });
      const rows = data.rows || [];
      setMainRows(rows);
      setSelectedLots(new Set(rows.map((r) => r.pfkOriLotID)));
      if (rows.length === 0) {
        setError('No balance records found for the selected criteria.');
      } else {
        setTab(1);
      }
      if (rows.length > 0) {
        // Pass transID (= pfkOriLotID = the ARV pkTransID) so the backend can find
        // arrival docs in TransDocuments/{faYear}/{pkTransID}_N.ext
        const lots = rows
          .filter((r) => r.LotNum)
          .map((r) => ({ lotNum: r.LotNum, transID: r.pfkOriLotID }));
        api.post('/uploads/check-lots', { lots })
          .then((r) => setLotFileInfo(r.data))
          .catch(() => {});
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load balance data.');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selParties, selGroups, selItems, selGodowns, sortBy]);

  // ── Row click → lot detail ─────────────────────────────────────────────────
  const handleRowClick = useCallback(async (row) => {
    setDetailLotId(row.pfkOriLotID);
    setDetailLotNum(row.LotNum || row.pfkOriLotID);
    setDetailLoading(true);
    setDetailRows([]);
    setBatchLocRows([]);
    setBatchLocLoading(true);
    api.get(`/reports/balance-report/batch-location/${encodeURIComponent(row.pfkOriLotID)}`,
      { params: row.fkCompID ? { lotCompID: row.fkCompID } : {} })
      .then(r => setBatchLocRows(r.data?.rows || []))
      .catch(err => { console.error('[BatchLoc]', err?.response?.data || err.message); setBatchLocRows([]); })
      .finally(() => setBatchLocLoading(false));
    try {
      const params = new URLSearchParams({ endDate });
      if (startDate) params.set('startDate', startDate);
      if (row.fkCompID) params.set('lotCompID', row.fkCompID);
      const { data } = await api.get(`/reports/balance-report/lot-detail/${encodeURIComponent(row.pfkOriLotID)}?${params}`);
      const rows = data.rows || [];
      setDetailRows(rows);
      // Check file existence for all non-OB rows (arrival docs + dispatch pickup photos + trans-docs)
      const dispatchEntries = rows
        .filter((r) => r.sortOrd !== 1 && r.pkTransID)
        .map((r) => ({ transID: r.pkTransID, faYear: toFaYearFull(r.FaYear), compCode: r.pkTransID.split('!')[0], gatePass: r.GatePass || '' }));
      if (dispatchEntries.length > 0) {
        api.post('/uploads/check-dispatch-docs', { entries: dispatchEntries })
          .then((r) => setDetailDocInfo(r.data))
          .catch(() => {});
      } else {
        setDetailDocInfo({});
      }
    } catch {
      setDetailRows([]);
      setDetailDocInfo({});
    } finally {
      setDetailLoading(false);
    }
  }, [startDate, endDate]);

  // ── View (print window) ────────────────────────────────────────────────────
  const handleView = useCallback(async () => {
    setError('');
    if (!endDate) { setError('End Date is required.'); return; }
    const checked = [...selectedLots];
    setViewLoading(true);
    try {
      const { data } = await api.post('/reports/balance-report/report', {
        reportType: reportFormat,
        startDate: startDate || undefined,
        endDate,
        selectedLotIds: checked,
        partyIds:    selParties,
        itemIds:     selItems,
        godownIds:   selGodowns,
        formatSettings: fmtChecks,
      });
      if (data.empty) { setError('No data for the selected report.'); return; }
      if (data.compName) setReportCompName(data.compName);
      const result = openReportWindow({ rows: data.rows, lots: data.lots, reportType: data.reportType, startDate: data.startDate, endDate: data.endDate, fmtChecks, compName: data.compName }, logo);
      if (result === 'blocked') setPopupWarn(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate report.');
    } finally {
      setViewLoading(false);
    }
  }, [reportFormat, startDate, endDate, selectedLots, selParties, selItems, selGodowns, fmtChecks]);

  // ── Export main grid to Excel ──────────────────────────────────────────────
  const handleExport = useCallback(() => {
    if (displayedRows.length === 0) return;
    const wsData = [
      ['Lot No', 'Party', 'Item', 'Arrival Date', 'Arv Qty', 'Balance', 'Packing', 'Pack Wt', 'G.Wt', 'Godown~Qty', 'BE Num', 'DO Num', 'Pack Type', 'Pack Colour', 'Batch No', 'Hamali', 'Hamali Code', 'Remarks', 'Rent Rate', 'Vehicle No', 'Actual Wt'],
      ...displayedRows.map((r) => [
        r.LotNum || '', r.pName || '', r.iName || '', fmtDt(r.OriTransDt),
        parseFloat(r.OriTransQty) || 0, parseFloat(r.balance) || 0,
        r.Packing || '', parseFloat(r.PackWght) || 0, parseFloat(r.GrossWght) || 0,
        r.godQty || '', r.BENum || '', r.DoNum || '', r.PackingType || '', r.PackingColour || '',
        r.BatchNum || '', r.HamaliRecd || '', r.HamaliCode || '', r.TransRemark || '',
        parseFloat(r.RentRate) || 0, r.VehiNum || '', parseFloat(r.ActualWght) || 0,
      ]),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsData), 'Balance Report');
    XLSX.writeFile(wb, `BalanceReport_${endDate || 'export'}.xlsx`);
  }, [displayedRows, endDate]);

  // ── Template save ──────────────────────────────────────────────────────────
  const handleTemplateSave = useCallback(async (name) => {
    setSaveDialogOpen(false);
    try {
      await api.post('/reports/templates', {
        templateName: name,
        repName: 'BAL_REP',
        reportType: reportFormat,
        filters: { pGroup: selGroups, fkPartyID: selParties, fkItemID: selItems, fkGodownID1: selGodowns },
        printSettings: { sortBy, ...fmtChecks },
      });
      setSnack(`Template "${name}" saved.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save template.');
    }
  }, [reportFormat, selGroups, selParties, selItems, selGodowns, sortBy, fmtChecks]);

  // ── Template load ──────────────────────────────────────────────────────────
  const handleTemplateLoad = useCallback(async (id) => {
    setSelectDialogOpen(false);
    try {
      const { data } = await api.get(`/reports/templates/${encodeURIComponent(id)}`);
      const f  = data.filters      || {};
      const ps = data.printSettings || {};

      if (Array.isArray(f.pGroup)      && f.pGroup.length)      setSelGroups(f.pGroup);
      if (Array.isArray(f.fkPartyID)   && f.fkPartyID.length)   setSelParties(f.fkPartyID);
      if (Array.isArray(f.fkItemID)    && f.fkItemID.length)    setSelItems(f.fkItemID);
      if (Array.isArray(f.fkGodownID1) && f.fkGodownID1.length) setSelGodowns(f.fkGodownID1);

      if (data.reportType) setReportFormat(data.reportType);
      if (ps.sortBy)       setSortBy(ps.sortBy);

      const fmtKeys = ['delivOn','particulars','batchNo','transType','vehicleNo','actualWt','gatePass','godownNo','totalWt','continuousPage','beNo','itemValue','manuf'];
      const fmtLoaded = {};
      for (const k of fmtKeys) if (ps[k] !== undefined) fmtLoaded[k] = Boolean(ps[k]);
      if (Object.keys(fmtLoaded).length > 0) setFmtChecks((prev) => ({ ...prev, ...fmtLoaded }));

      setLoadedTemplate({ id, name: data.Template_Name });
      setSnack('Template loaded.');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load template.');
    }
  }, []);

  // ── Template update (overwrite existing) ──────────────────────────────────
  const handleTemplateUpdate = useCallback(async (id) => {
    setSaveDialogOpen(false);
    try {
      await api.post('/reports/templates', {
        templateName: loadedTemplate.name,
        repName: 'BAL_REP',
        reportType: reportFormat,
        filters: { pGroup: selGroups, fkPartyID: selParties, fkItemID: selItems, fkGodownID1: selGodowns },
        printSettings: { sortBy, ...fmtChecks },
        replaceId: id,
      });
      setSnack(`Template "${loadedTemplate.name}" updated.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update template.');
    }
  }, [reportFormat, selGroups, selParties, selItems, selGodowns, sortBy, fmtChecks, loadedTemplate]);

  // ── Reset / Cancel ─────────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    setStartDate(fyStart()); setEndDate(todayISO()); setSortBy('LotNum');
    setSelGroups([]); setSelParties([]); setSelItems([]); setSelGodowns([]);
    setMainRows([]); setDetailRows([]); setSelectedLots(new Set());
    setDetailLotId(null); setActiveFilter(null); setError(''); setTab(0);
    setLotFileInfo({}); setDetailDocInfo({}); setLoadedTemplate(null);
    setReportFormat('party-bal-detail'); setHideZeroBal(false); setItemSearch('');
    setFmtChecks({
      delivOn: false, particulars: false, batchNo: false, transType: false,
      vehicleNo: false, actualWt: false, gatePass: false, godownNo: false,
      totalWt: false, continuousPage: false, beNo: false, itemValue: false, manuf: false,
      remarks: false,
    });
  }, []);

  // ── Arrival grid action handlers ───────────────────────────────────────────
  const handleArrivalEdit  = useCallback((row) => {
    window.open(`/transactions/arrivals/${encodeId(row.pkTransID)}/edit`, '_blank');
  }, []);

  const handleArrivalPhotos = useCallback((row) => {
    openMedia(`Stock Photos — ${row.LotNum}`, () =>
      api.get('/uploads/stock-photos', { params: { lotNum: row.LotNum } }).then((r) => r.data)
    );
  }, [openMedia]);

  const handleArrivalDocs = useCallback((row) => {
    // pfkOriLotID = the ARV entry's pkTransID; arrival docs are keyed by transID
    openMedia(`Arrival Documents — ${row.LotNum}`, () =>
      api.get('/uploads/arrival', { params: { transID: row.pfkOriLotID } }).then((r) => r.data)
    );
  }, [openMedia]);

  // ── Detail grid action handlers ────────────────────────────────────────────
  const handleDetailEdit = useCallback((r) => {
    if (!r.pkTransID) return;
    const isArrivalType = ['ARV', 'IN', 'DESPRET'].includes(r.TransType);
    const path = isArrivalType
      ? `/transactions/arrivals/${encodeId(r.pkTransID)}/edit`
      : `/transactions/dispatches/${encodeId(r.pkTransID)}/edit`;
    window.open(path, '_blank');
  }, []);

  const handleDetailDocs = useCallback((r) => {
    if (!r.pkTransID) return;
    const isDispatch = ['DESP', 'TRF', 'OUT'].includes(r.TransType);
    openMedia(`Documents — ${r.pkTransID}`, async () => {
      const fy = toFaYearFull(r.FaYear);
      const transDocs = await api.get('/uploads/trans-docs', { params: { transID: r.pkTransID, faYear: fy } })
        .then((res) => res.data).catch(() => []);
      if (isDispatch) {
        const compCode   = r.pkTransID.split('!')[0];
        const pickupFile = await api.get('/uploads/pickup-photo', {
          params: { compCode, gatePass: r.GatePass || '', faYear: fy },
        }).then((res) => res.data.url ? [{ url: res.data.url, filename: 'Pickup Photo' }] : [])
          .catch(() => []);
        return [...pickupFile, ...transDocs];
      }
      return transDocs;
    });
  }, [openMedia]);

  // ── Selection helpers ──────────────────────────────────────────────────────
  const toggleLot = (id) => setSelectedLots((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectAll    = () => setSelectedLots(new Set(displayedRows.map((r) => r.pfkOriLotID)));
  const deselectAll  = () => setSelectedLots(new Set());
  const invertSel    = () => setSelectedLots(new Set(displayedRows.filter((r) => !selectedLots.has(r.pfkOriLotID)).map((r) => r.pfkOriLotID)));

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  const selCount = (arr) => arr.length > 0 ? <Chip label={arr.length} size="small" color="primary" sx={{ ml: 0.5, height: 16, fontSize: 10 }} /> : null;

  return (
    <Box sx={{ p: 2 }}>
      <Toolbar disableGutters sx={{ mb: 1 }}>
        <Typography variant="h5" fontWeight={700} sx={{ flexGrow: 1 }}>Balance Report</Typography>
        <Button variant="outlined" startIcon={<CancelIcon />} onClick={handleCancel} size="small" sx={{ mr: 1 }}>Cancel</Button>
        <Button variant="contained" startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon />}
          onClick={handleGo} disabled={loading} size="small">
          Go
        </Button>
      </Toolbar>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 1 }}>{error}</Alert>}
      {popupWarn && (
        <Alert severity="warning" onClose={() => setPopupWarn(false)} sx={{ mb: 1 }}>
          Popup was blocked. Please allow popups for this site to view the print report.
        </Alert>
      )}

      <Paper sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}>
          <Tab label="General" sx={{ minHeight: 40, fontSize: 13 }} />
          <Tab label="Detail" sx={{ minHeight: 40, fontSize: 13 }} disabled={mainRows.length === 0} />
        </Tabs>

        {/* ── Tab 1: General ── */}
        {tab === 0 && (
          <Box sx={{ p: 2 }}>
            {filtersLoading ? <CircularProgress size={24} /> : (
              <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>

                {/* Left column */}
                <Box sx={{ minWidth: 280, flex: '0 0 280px' }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>Date Range</Typography>
                  <Stack spacing={1.5} sx={{ mb: 2 }}>
                    <TextField
                      type="date" size="small" label="Balance Start Date (optional)"
                      InputLabelProps={{ shrink: true }} value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                    <TextField
                      type="date" size="small" label="Balance End Date *"
                      InputLabelProps={{ shrink: true }} value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </Stack>

                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Sort By</Typography>
                  <FormControl size="small" fullWidth sx={{ mb: 2 }}>
                    <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                      {SORT_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                    </Select>
                  </FormControl>

                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Templates</Typography>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" variant="outlined" startIcon={<FolderOpenIcon />} onClick={() => setSelectDialogOpen(true)}>
                      Load Template
                    </Button>
                  </Stack>
                </Box>

                {/* Right column — filter buttons + active panel */}
                <Box sx={{ flex: 1, minWidth: 260 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Filters</Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1.5 }}>
                    {FILTER_PANELS.map((fp) => {
                      const count = fp.key === 'partyGroups' ? selGroups.length
                        : fp.key === 'parties' ? selParties.length
                        : fp.key === 'items' ? selItems.length
                        : selGodowns.length;
                      // Party Group and Party Name are mutually exclusive:
                      // selecting one disables the other.
                      const isMutuallyDisabled =
                        (fp.key === 'partyGroups' && selParties.length > 0) ||
                        (fp.key === 'parties'     && selGroups.length  > 0);
                      return (
                        <Tooltip
                          key={fp.key}
                          title={isMutuallyDisabled
                            ? fp.key === 'partyGroups'
                              ? 'Clear Party Name selection first'
                              : 'Clear Party Group selection first'
                            : ''}
                          disableHoverListener={!isMutuallyDisabled}
                        >
                          <span>
                            <Button
                              size="small"
                              variant={activeFilter === fp.key ? 'contained' : 'outlined'}
                              startIcon={<FilterListIcon />}
                              disabled={isMutuallyDisabled}
                              onClick={() => setActiveFilter(activeFilter === fp.key ? null : fp.key)}
                              sx={{ mb: 0.5 }}
                            >
                              {fp.label}{count > 0 && <Chip label={count} size="small" color={activeFilter === fp.key ? 'default' : 'primary'} sx={{ ml: 0.5, height: 16, fontSize: 10 }} />}
                            </Button>
                          </span>
                        </Tooltip>
                      );
                    })}
                  </Stack>

                  {FILTER_PANELS.map((fp) => {
                    if (activeFilter !== fp.key) return null;
                    const items = fp.key === 'partyGroups' ? filterData.partyGroups
                      : fp.key === 'parties' ? visibleParties
                      : fp.key === 'items' ? filterData.items
                      : filterData.godowns;
                    const selected = fp.key === 'partyGroups' ? selGroups
                      : fp.key === 'parties' ? selParties
                      : fp.key === 'items' ? selItems
                      : selGodowns;
                    // Party Group and Party Name are mutually exclusive — selecting one clears the other
                    const onChange = fp.key === 'partyGroups'
                      ? (ids) => { setSelGroups(ids); if (ids.length > 0) setSelParties([]); }
                      : fp.key === 'parties'
                      ? (ids) => { setSelParties(ids); if (ids.length > 0) setSelGroups([]); }
                      : fp.key === 'items' ? setSelItems
                      : setSelGodowns;
                    return (
                      <Box key={fp.key}>
                        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                          {fp.label} filter {selected.length > 0 ? `— ${selected.length} selected` : '(all)'}
                        </Typography>
                        <FilterPanel items={items} idField={fp.idField} nameField={fp.nameField} subField={fp.subField} pillField={fp.pillField} selected={selected} onChange={onChange} />
                      </Box>
                    );
                  })}

                  {!activeFilter && (
                    <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1 }}>
                      Click a filter button to select specific records. No selection = all records.
                    </Typography>
                  )}
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* ── Tab 2: Detail ── */}
        {tab === 1 && (
          <Box sx={{ p: 2 }}>
            {/* Top bar */}
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" sx={{ mb: 1.5 }}>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel>Report Format</InputLabel>
                <Select value={reportFormat} label="Report Format" onChange={(e) => setReportFormat(e.target.value)}>
                  {REPORT_FORMATS.map((f) => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
                </Select>
              </FormControl>

              <Button variant="contained" size="small"
                startIcon={viewLoading ? <CircularProgress size={14} color="inherit" /> : <PrintIcon />}
                onClick={handleView} disabled={viewLoading || selectedLots.size === 0}>
                View Report
              </Button>
              {can('BAL_REP', 'CanExport') && (
              <Button variant="outlined" size="small" startIcon={<FileDownloadIcon />} onClick={handleExport}
                disabled={displayedRows.length === 0}>
                Export Excel
              </Button>
              )}

              <Button size="small" variant="outlined" startIcon={<SaveIcon />} onClick={() => setSaveDialogOpen(true)}>
                Save Template
              </Button>
              {mainRows.length > 0 && (
                <Button size="small" variant="contained" color="primary"
                  startIcon={<EmailIcon />}
                  onClick={() => setEmailDialogOpen(true)}>
                  Send Email
                </Button>
              )}
            </Stack>

            {/* Format checkboxes — two separate groups */}
            <Stack direction="row" spacing={1} sx={{ mb: 1 }} alignItems="stretch">
              {/* Group 1: always enabled */}
              <Box sx={{ p: 1, bgcolor: '#f9f9f9', borderRadius: 1, border: '1px solid #e0e0e0' }}>
                <FormGroup row sx={{ gap: 0 }}>
                  {[
                    ['totalWt','Total Weight'], ['beNo','BE No.'], ['itemValue','Item Value'],
                    ['manuf','Manufacture'], ['remarks','Remarks'], ['continuousPage','Continuous Page'],
                  ].map(([k, lbl]) => (
                    <FormControlLabel key={k}
                      control={<Checkbox size="small" checked={fmtChecks[k]} onChange={() => toggleFmt(k)} />}
                      label={<Typography fontSize={11}>{lbl}</Typography>}
                      sx={{ mr: 1 }}
                    />
                  ))}
                </FormGroup>
              </Box>

              {/* Group 2: Detail columns — enabled for lot-wise and party-bal-detail */}
              <Box sx={{ p: 1, bgcolor: '#f9f9f9', borderRadius: 1, border: '1px solid #e0e0e0', opacity: (reportFormat === 'lot-wise' || reportFormat === 'party-bal-detail') ? 1 : 0.4 }}>
                <Typography fontSize={11} fontWeight={700} sx={{ mb: 0.5 }}>Lot Wise Selection</Typography>
                <FormGroup row sx={{ gap: 0 }}>
                  {[
                    ['delivOn','Delivery On'], ['particulars','Particulars'], ['batchNo','Batch No.'],
                    ['transType','Trans Type'], ['vehicleNo','Vehicle No.'], ['actualWt','Actual Weight'],
                    ['gatePass','Gate Pass'], ['godownNo','Godown No.'],
                  ].map(([k, lbl]) => (
                    <FormControlLabel key={k}
                      control={<Checkbox size="small" checked={fmtChecks[k]} onChange={() => toggleFmt(k)} disabled={reportFormat !== 'lot-wise' && reportFormat !== 'party-bal-detail'} />}
                      label={<Typography fontSize={11}>{lbl}</Typography>}
                      sx={{ mr: 1 }}
                    />
                  ))}
                </FormGroup>
              </Box>
            </Stack>

            {/* Selection buttons */}
            <Stack direction="row" spacing={1} sx={{ mb: 0.5 }}>
              <Button size="small" variant="text" sx={{ fontSize: 11 }} onClick={selectAll} startIcon={<CheckBoxIcon fontSize="small" />}>All</Button>
              <Button size="small" variant="text" sx={{ fontSize: 11 }} onClick={deselectAll} startIcon={<CheckBoxOutlineBlankIcon fontSize="small" />}>None</Button>
              <Button size="small" variant="text" sx={{ fontSize: 11 }} onClick={invertSel}>Invert</Button>
              <TextField size="small" placeholder="Search item…" value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                sx={{ width: 180 }}
              />
              <FormControlLabel
                control={<Checkbox size="small" checked={hideZeroBal} onChange={(e) => setHideZeroBal(e.target.checked)} />}
                label={<Typography fontSize={12}>Hide Zero Balance</Typography>}
              />
              <Typography sx={{ fontSize: 11, color: 'text.secondary', ml: 'auto !important', alignSelf: 'center' }}>
                {selectedLots.size} of {displayedRows.length} selected
              </Typography>
            </Stack>

            {/* Main grid */}
            <Box sx={{ overflowX: 'auto', mb: 2, border: '1px solid #e0e0e0', borderRadius: 1, maxHeight: 360 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={{ '& th': { bgcolor: '#1565C0', color: '#fff', fontSize: 11, py: 0.5, px: 1, whiteSpace: 'nowrap' } }}>
                    <TableCell padding="checkbox" sx={{ bgcolor: '#1565C0 !important' }}></TableCell>
                    <TableCell sx={{ bgcolor: '#1565C0 !important', minWidth: 90 }}>Actions</TableCell>
                    {['Lot No','Party','Item','Arrival Dt','Arv Qty','Balance','Packing','Pack Wt','G.Wt','Godown~Qty','BE Num','DO Num','Pack Type','Pack Colour','Hamali','Hamali Code','Remarks','Rent','Vehicle No','Act.Wt','Batch No','Notes'].map((h) => (
                      <TableCell key={h}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={24} align="center"><CircularProgress size={20} /></TableCell>
                    </TableRow>
                  )}
                  {!loading && displayedRows.map((row, idx) => {
                    const isChecked  = selectedLots.has(row.pfkOriLotID);
                    const isSelected = detailLotId === row.pfkOriLotID;
                    return (
                      <TableRow
                        key={row.pfkOriLotID || idx}
                        hover selected={isSelected}
                        onClick={() => handleRowClick(row)}
                        sx={{ cursor: 'pointer', fontSize: 11,
                          bgcolor: isSelected ? '#E3F2FD !important' : undefined }}
                      >
                        <TableCell padding="checkbox" onClick={(e) => { e.stopPropagation(); toggleLot(row.pfkOriLotID); }}>
                          <Checkbox size="small" checked={isChecked} />
                        </TableCell>
                        <TableCell sx={{ py: 0, px: 0.5, whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                          <Tooltip title="Edit Arrival"><span>
                            <IconButton size="small" onClick={() => handleArrivalEdit(row)}>
                              <EditIcon sx={{ fontSize: 15 }} />
                            </IconButton>
                          </span></Tooltip>
                          <Tooltip title="Stock Photos"><span>
                            <IconButton size="small" onClick={() => handleArrivalPhotos(row)}
                              sx={{ color: lotFileInfo[row.LotNum]?.hasPhotos ? 'warning.main' : 'inherit' }}>
                              <PhotoCameraIcon sx={{ fontSize: 15 }} />
                            </IconButton>
                          </span></Tooltip>
                          <Tooltip title="Arrival Documents"><span>
                            <IconButton size="small" onClick={() => handleArrivalDocs(row)}
                              sx={{ color: lotFileInfo[row.LotNum]?.hasDocs ? 'warning.main' : 'inherit' }}>
                              <DescriptionIcon sx={{ fontSize: 15 }} />
                            </IconButton>
                          </span></Tooltip>
                        </TableCell>
                        {[
                          row.LotNum || '', row.pName || '',
                          row.iName + (row.ItemExtDesc ? ' ' + row.ItemExtDesc : ''),
                          fmtDt(row.OriTransDt),
                          fN(row.OriTransQty), fN(row.balance),
                          row.Packing || '', fN(row.PackWght), fN(row.GrossWght),
                          row.godQty || '', row.BENum || '', row.DoNum || '',
                          row.PackingType || '', row.PackingColour || '',
                          fN(row.HamaliRecd), row.HamaliCode || '', row.TransRemark || '', fN(row.RentRate),
                          row.VehiNum || '', fN(row.ActualWght), row.BatchNum || '', row.TransNote || '',
                        ].map((val, ci) => (
                          <TableCell key={ci} sx={{ fontSize: 11, py: 0.25, px: 1, whiteSpace: 'nowrap' }}>{val}</TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                  {!loading && displayedRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={24} align="center">
                        <Typography color="text.secondary" fontSize={12}>
                          {mainRows.length === 0 ? 'Run Go on the General tab to load data.' : 'No rows match the current filters.'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>

            {/* Batch / Location panel */}
            {detailLotId && (
              <>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5, mt: 1.5 }}>
                  Batch / Location Balance — {detailLotNum}
                  {batchLocLoading && <CircularProgress size={14} sx={{ ml: 1 }} />}
                </Typography>
                {!batchLocLoading && batchLocRows.length === 0 ? (
                  <Typography fontSize={11} color="text.secondary" sx={{ mb: 1 }}>
                    No batch / location data for this lot.
                  </Typography>
                ) : (
                  <Box sx={{ overflowX: 'auto', border: '1px solid #e0e0e0', borderRadius: 1, maxHeight: 220, mb: 2 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow sx={{ '& th': { bgcolor: '#2E7D32', color: '#fff', fontSize: 11, py: 0.5, px: 1, whiteSpace: 'nowrap' } }}>
                          <TableCell sx={{ bgcolor: '#2E7D32 !important', minWidth: 160 }}>Batch No</TableCell>
                          <TableCell sx={{ bgcolor: '#2E7D32 !important', minWidth: 60 }}>Godown</TableCell>
                          <TableCell sx={{ bgcolor: '#2E7D32 !important', minWidth: 100 }}>Location</TableCell>
                          <TableCell sx={{ bgcolor: '#2E7D32 !important', minWidth: 80, textAlign: 'right' }}>Balance Qty</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(() => {
                          const rendered = [];
                          let prevKey = null;
                          for (let i = 0; i < batchLocRows.length; i++) {
                            const r = batchLocRows[i];
                            const batchKey = `${r.BatchNum}||${r.fkGodownID}`;
                            const isFirst  = batchKey !== prevKey;
                            // Batch total = sum of all rows with same batchKey
                            const batchTotal = isFirst
                              ? batchLocRows
                                  .filter(x => x.BatchNum === r.BatchNum && x.fkGodownID === r.fkGodownID)
                                  .reduce((s, x) => s + (parseFloat(x.BalQty) || 0), 0)
                              : 0;
                            prevKey = batchKey;
                            const locLabel = r.LocationCode || r.LocationName || r.fkLocationID || '—';
                            rendered.push(
                              <TableRow key={i} sx={{ bgcolor: i % 2 === 0 ? '#fafafa' : '#fff' }}>
                                <TableCell sx={{ fontSize: 11, py: 0.3, px: 1, fontWeight: isFirst ? 600 : 400, color: isFirst ? '#1B5E20' : 'inherit' }}>
                                  {isFirst ? `${r.BatchNum || '—'} · [Bal: ${batchTotal}]` : ''}
                                </TableCell>
                                <TableCell sx={{ fontSize: 11, py: 0.3, px: 1 }}>
                                  {isFirst ? (r.GodownNum || r.fkGodownID || '') : ''}
                                </TableCell>
                                <TableCell sx={{ fontSize: 11, py: 0.3, px: 1 }}>{locLabel}</TableCell>
                                <TableCell sx={{ fontSize: 11, py: 0.3, px: 1, textAlign: 'right', fontWeight: 600 }}>
                                  {parseFloat(r.BalQty) || 0}
                                </TableCell>
                              </TableRow>
                            );
                          }
                          return rendered;
                        })()}
                      </TableBody>
                    </Table>
                  </Box>
                )}
              </>
            )}

            {/* Detail grid */}
            {detailLotId && (
              <>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                  Lot Detail — {detailLotNum}
                  {detailLoading && <CircularProgress size={14} sx={{ ml: 1 }} />}
                </Typography>
                <Box sx={{ overflowX: 'auto', border: '1px solid #e0e0e0', borderRadius: 1, maxHeight: 280 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={{ '& th': { bgcolor: '#37474F', color: '#fff', fontSize: 11, py: 0.5, px: 1, whiteSpace: 'nowrap' } }}>
                        <TableCell sx={{ bgcolor: '#37474F !important', minWidth: 64 }}>Actions</TableCell>
                        {['Date','Time','Qty','Balance','DO No','Godown','Gate Pass','Vehicle No','Particulars','Deliv By','Hamali','Hmli Code','Own Trans','Pickup By','Act.Wt','Type','Batch No','Notes','User'].map((h) => (
                          <TableCell key={h}>{h}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detailWithBalance.map((r, idx) => {
                        const isOB       = r.sortOrd === 1;
                        const isARV      = r.TransType === 'ARV';
                        const isAdditive = ['IN', 'DESPRET'].includes(r.TransType);
                        const rowBg = isOB       ? '#E3F2FD !important'
                                    : isARV      ? '#F5F5F5 !important'
                                    : isAdditive ? '#E8F5E9 !important'   // light green — adds to balance
                                    : undefined;
                        const qtyDisplay = isAdditive
                          ? <span style={{ color: '#2e7d32', fontWeight: 700 }}>{'+' + fN(r.TransQty)}</span>
                          : fN(r.TransQty);
                        return (
                          <TableRow key={idx} sx={{ bgcolor: rowBg }}>
                            <TableCell sx={{ py: 0, px: 0.5, whiteSpace: 'nowrap' }}>
                              {!isOB && !isARV && (
                                <>
                                  <Tooltip title={['ARV','IN','DESPRET'].includes(r.TransType) ? 'Edit Arrival' : 'Edit Dispatch'}><span>
                                    <IconButton size="small" onClick={() => handleDetailEdit(r)}>
                                      <EditIcon sx={{ fontSize: 15 }} />
                                    </IconButton>
                                  </span></Tooltip>
                                  <Tooltip title="Documents"><span>
                                    <IconButton size="small" onClick={() => handleDetailDocs(r)}
                                      sx={{ color: detailDocInfo[r.pkTransID] ? 'warning.main' : 'inherit' }}>
                                      <DescriptionIcon sx={{ fontSize: 15 }} />
                                    </IconButton>
                                  </span></Tooltip>
                                </>
                              )}
                            </TableCell>
                            {[
                              fmtDt(r.TransDt), fmtTm(r.TransTm), qtyDisplay, fN(r.runningBal),
                              isOB ? <span style={{ color: 'red', fontStyle: 'italic' }}>Opening</span> : (r.DoNum || ''),
                              r.gNum || '', r.GatePass || '', r.VehiNum || '',
                              r.TransExtDetail || '', r.DelivOpt || '',
                              fN(r.HamaliRecd), r.HamaliCode || '', r.OwnTransFlg || '',
                              r.PickupBy || '', fN(r.ActualWght), r.TransType || '',
                              r.BatchNum || '', r.TransNote || '', r.UserID || '',
                            ].map((val, ci) => (
                              <TableCell key={ci} sx={{ fontSize: 11, py: 0.25, px: 1, whiteSpace: 'nowrap', fontStyle: isOB ? 'italic' : undefined }}>{val}</TableCell>
                            ))}
                          </TableRow>
                        );
                      })}
                      {detailWithBalance.length === 0 && !detailLoading && (
                        <TableRow>
                          <TableCell colSpan={20} align="center">
                            <Typography color="text.secondary" fontSize={12}>Click a lot row above to view its ledger.</Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Box>
                <Typography fontSize={11} color="text.secondary" sx={{ mt: 0.5 }}>
                  {(() => { const c = detailWithBalance.filter((r) => r.sortOrd !== 1 && r.TransType !== 'ARV').length; return `${c} record${c !== 1 ? 's' : ''} in this lot.`; })()}
                </Typography>
              </>
            )}
          </Box>
        )}
      </Paper>

      {/* Dialogs */}
      <TemplateSaveDialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)} onSave={handleTemplateSave} onUpdate={handleTemplateUpdate} existingTemplate={loadedTemplate} />
      <TemplateSelectDialog open={selectDialogOpen} onClose={() => setSelectDialogOpen(false)} onSelect={handleTemplateLoad} />
      <EmailSendDialog
        open={emailDialogOpen}
        onClose={() => setEmailDialogOpen(false)}
        mainRows={mainRows}
        selectedLots={selectedLots}
        compName={reportCompName}
        logo={logo}
        groupCompName={groupCompName}
        mode={selParties.length > 0 ? 'individual' : selGroups.length > 0 ? 'group' : 'individual'}
        reportParams={{
          reportType: reportFormat,
          startDate:  startDate || undefined,
          endDate,
          selectedLotIds: [...selectedLots],
          partyIds:    selParties,
          itemIds:     selItems,
          godownIds:   selGodowns,
          formatSettings: fmtChecks,
        }}
      />
      <MediaViewerDialog
        open={mediaDialog.open} onClose={closeMedia}
        title={mediaDialog.title} loading={mediaDialog.loading} files={mediaDialog.files}
      />

      {/* Snackbar */}
      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack('')}
        message={snack} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} />
    </Box>
  );
}
