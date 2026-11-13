// AuditReportPage.jsx — Audit Report
// VB6 origin: frmAuditReport.frm, "Transaction Log" tab
//
// Workflow:
//   1. Page loads → GET /init → populate Report Name dropdown, Date Field dropdown,
//      seed Start Date from fiscal year (FaYearInfo.StartDate), End Date from today
//   2. User selects Report Name; optionally selects a Date Field and sets date range
//   3. Click VIEW → POST /data → receive columns + rows → processRows() → render grid
//   4. Click EXCEL → export grid to XLSX:
//        sheet name "Hamali Calculation" (as in VB6, despite being the Audit Report)
//        col 0 (UniqueSrNo_AT) hidden, freeze pane at B2
//
// Client-side post-processing — mirrors VB6 udfTLModifiedEntryCheck:
//   - DEL rows: highlighted #FFC0C0 (VB6 BGR &HC0C0FF = RGB 255,192,192 light pink)
//   - UPD2/UPD1 adjacent pairs (UPD2 appears directly above UPD1 due to ORDER BY):
//       Bold cells in cols 2+ that differ between the two rows
//       If NO differences exist (nDiffCount=0) — remove BOTH rows entirely

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  Alert, Box, Button, CircularProgress,
  FormControl, InputLabel, MenuItem, Paper,
  Select, TextField, Typography,
} from '@mui/material';
import SearchIcon       from '@mui/icons-material/Search';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import * as XLSX        from 'xlsx';
import api              from '../../services/api';

// VB6 &HC0C0FF (BGR format): Blue=0xC0=192, Green=0xC0=192, Red=0xFF=255 → RGB(255,192,192) light pink
const DEL_BG = '#FFC0C0';

function isoDate(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  return new Date(v).toISOString().slice(0, 10);
}

// ── processRows ───────────────────────────────────────────────────────────────
// Converts raw DB row objects + column definitions into a displayable grid structure,
// then runs the UPD1/UPD2 post-processing that mirrors VB6 udfTLModifiedEntryCheck.
//
// Input:
//   rawRows — array of plain objects (key = ColName) from the backend
//   columns — [{ ColName, ColDisplayName }] in SortOrder
//             columns[0] = UniqueSrNo_AT (hidden)
//             columns[1] = Status_AT     (DEL/UPD1/UPD2/INS)
//             columns[2+] = data fields
//
// Output: [{ rawStatus, bg, cells: [{ text, bold }] }]
//
// Algorithm (mirrors VB6 For nCurrRow = .Rows-1 To .FixedRows Step -1):
//   Scan from last row up to row index 1 (row 0 can never be UPD2 with a UPD1 above it).
//   If row[i].Status_AT === 'UPD2' AND row[i-1].Status_AT === 'UPD1':
//     Compare each data cell (cols 2+) in both rows.
//     Bold cells that differ in BOTH the UPD2 row and the UPD1 row.
//     If nDiffCount === 0 (rows are identical): splice both out and step i back one extra.
function processRows(rawRows, columns) {
  const statusKey = columns[1]?.ColName; // 'Status_AT' — col index 1 per VB6 convention

  const grid = rawRows.map(r => {
    const status = String(r[statusKey] ?? '');
    return {
      rawStatus: status,
      // DEL rows: VB6 sets .Cell(flexcpBackColor, row, col) = &HC0C0FF for every col
      bg: status === 'DEL' ? DEL_BG : '',
      // One cell entry per column; bold is set later by UPD1/UPD2 comparison
      cells: columns.map(col => ({ text: String(r[col.ColName] ?? ''), bold: false })),
    };
  });

  // VB6: For nCurrRow = .Rows - 1 To .FixedRows Step -1
  // FixedRows=1 means the loop runs from last data row down to index 1 (not 0),
  // because we need row[i-1] to exist for the UPD1 check.
  for (let i = grid.length - 1; i >= 1; i--) {
    if (grid[i].rawStatus === 'UPD2' && grid[i - 1].rawStatus === 'UPD1') {
      let nDiffCount = 0;

      // VB6: For nCurrCol = .FixedCols + 2 To .Cols - 1
      // FixedCols=0, so data columns start at index 2 (after UniqueSrNo_AT and Status_AT).
      for (let c = 2; c < columns.length; c++) {
        if (grid[i].cells[c].text !== grid[i - 1].cells[c].text) {
          // VB6: .Cell(flexcpFontBold, nCurrRow,   nCurrCol) = True  (UPD2 row)
          //      .Cell(flexcpFontBold, nCurrRow-1, nCurrCol) = True  (UPD1 row)
          grid[i].cells[c].bold     = true;
          grid[i - 1].cells[c].bold = true;
          nDiffCount++;
        }
      }

      if (nDiffCount === 0) {
        // VB6: .RemoveItem(nCurrRow) then .RemoveItem(nCurrRow-1)
        // Both UPD2 and UPD1 are identical — remove them both
        grid.splice(i - 1, 2);
        // VB6: nCurrRow = nCurrRow - 1 after the double-remove
        // Our loop decrements i automatically, so subtract one more here
        i--;
      }
    }
  }

  return grid.filter(r => r.rawStatus !== 'INS');
}

// ── AuditReportPage ──────────────────────────────────────────────────────────
export default function AuditReportPage() {
  const { can } = useAuth();
  // Init data from GET /init
  const [reports,    setReports]    = useState([]);  // [{ pkAudRepID, RepName }]
  const [dateFields, setDateFields] = useState([]);  // [{ ColName, ColDisplayName }]

  // Filter state
  const [selReport,  setSelReport]  = useState('');  // chosen pkAudRepID
  const [selField,   setSelField]   = useState('');  // chosen ColName for date filter ('' = none)
  const [fromDate,   setFromDate]   = useState('');  // seeded from FaYearInfo.StartDate
  const [toDate,     setToDate]     = useState('');  // seeded from today

  // Grid state
  const [columns,  setColumns]  = useState([]);  // column definitions from /data
  const [gridRows, setGridRows] = useState([]);  // processed rows from processRows()

  // UI state
  const [loading,  setLoading]  = useState(false);
  const [initErr,  setInitErr]  = useState('');
  const [err,      setErr]      = useState('');

  const tableRef = useRef(null);

  // ── Mount: load reports + date fields + fiscal year dates ──────────────────
  // VB6: Form_Load → udfTLInitialiseControls (Q1 + Q2 + Q3)
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/reports/audit-report/init');
        setReports(data.reports     || []);
        setDateFields(data.dateFields || []);
        // Seed date range from fiscal year (VB6: dtpTLFromDt = StartDate, dtpTLEndDt = today)
        setFromDate(isoDate(data.startDate) || new Date().toISOString().slice(0, 10));
        setToDate(isoDate(data.endDate)   || new Date().toISOString().slice(0, 10));
      } catch (e) {
        setInitErr(e.response?.data?.error || 'Failed to load report configuration');
      }
    })();
  }, []);

  // ── VIEW button ────────────────────────────────────────────────────────────
  // VB6: cmdTLView_Click → udfTLFillGrid (Q4 + Q5 + Q6) → udfTLModifiedEntryCheck
  const handleView = useCallback(async () => {
    if (!selReport) { setErr('Please select a Report Name'); return; }
    setErr('');
    setLoading(true);
    setGridRows([]);
    setColumns([]);
    try {
      const { data } = await api.post('/reports/audit-report/data', {
        audRepID:  selReport,
        fromDate:  selField ? (fromDate || undefined) : undefined,
        toDate:    selField ? (toDate   || undefined) : undefined,
        dateField: selField,
      });

      const cols = data.columns || [];
      // processRows runs the VB6 udfTLModifiedEntryCheck logic client-side
      const rows = processRows(data.rows || [], cols);

      setColumns(cols);
      setGridRows(rows);
      if (rows.length === 0) setErr('No data found for the selected criteria');
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [selReport, selField, fromDate, toDate]);

  // ── EXCEL button ───────────────────────────────────────────────────────────
  // VB6: cmdTLExcel_Click
  // Sheet name: "Hamali Calculation" (literal from VB6, despite being Audit Report)
  // Col 0 (UniqueSrNo_AT) hidden: VB6 wsXL.Columns(col).Hidden = True when ColHidden(col-1)
  // Freeze at B2: VB6 wsXL.Range("B2").Select; objXL.ActiveWindow.FreezePanes = True
  // Bold: VB6 wsXL.Range(cell).Font.Bold = True  when .Cell(flexcpFontBold, row, col)
  // BG:   VB6 wsXL.Range(cell).Interior.Color = backColor  when backColor <> vbDefault
  //
  // NOTE: The 'xlsx' CE package (v0.18.x) does not write cell styles to output files.
  // Bold text and DEL row background colors require replacing 'xlsx' with 'xlsx-js-style'
  // (drop-in API-compatible fork). The style properties below are written correctly
  // so upgrading the package is all that is needed for full style support.
  const handleExcel = useCallback(() => {
    if (!gridRows.length || !columns.length) return;

    const wb = XLSX.utils.book_new();

    // Header row: ColDisplayName for each column (including hidden col 0)
    const aoa = [columns.map(c => c.ColDisplayName)];

    // Data rows: plain text — styles applied separately via cell.s property
    for (const row of gridRows) {
      aoa.push(row.cells.map(c => c.text));
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Hide col 0 (UniqueSrNo_AT) by setting its width to 0
    // VB6: If .ColHidden(intCol-1) Then wsXL.Columns(intCol).Hidden = True
    ws['!cols'] = columns.map((_, i) => i === 0 ? { wpx: 0 } : {});

    // Freeze pane at B2 — VB6: Range("B2").Select + FreezePanes = True
    // xSplit=1 freezes col A; ySplit=1 freezes row 1 (header)
    ws['!views'] = [{
      state: 'frozen', xSplit: 1, ySplit: 1,
      topLeftCell: 'B2', activePane: 'bottomRight',
    }];

    // Apply bold and DEL background colors to individual cells
    // VB6: copies both font bold and interior color from the flexgrid to Excel
    for (let r = 0; r < gridRows.length; r++) {
      const row = gridRows[r];
      for (let c = 0; c < row.cells.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: r + 1, c }); // +1 offset for header row
        if (!ws[addr]) continue;
        const needsBold = row.cells[c].bold;
        const needsBg   = !!row.bg; // only DEL rows have a background
        if (needsBold || needsBg) {
          ws[addr].s = {
            ...(needsBold ? { font: { bold: true } } : {}),
            ...(needsBg   ? { fill: { patternType: 'solid', fgColor: { rgb: 'FFC0C0' } } } : {}),
          };
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, 'Hamali Calculation');
    XLSX.writeFile(wb, 'AuditReport.xlsx');
  }, [gridRows, columns]);

  const hasData = columns.length > 0 && gridRows.length > 0;

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>Audit Report</Typography>

      {initErr && <Alert severity="error" sx={{ mb: 2 }}>{initErr}</Alert>}

      {/* ── Filter bar ── */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-end' }}>

          {/* Report Name dropdown — populated from Q2 (AuditReport table) */}
          {/* VB6: vfgTLRepName combo, value = pkAudRepID, display = RepName */}
          <FormControl sx={{ minWidth: 220 }} size="small">
            <InputLabel>Report Name</InputLabel>
            <Select
              label="Report Name"
              value={selReport}
              onChange={e => {
                setSelReport(e.target.value);
                setGridRows([]);
                setColumns([]);
                setErr('');
              }}
            >
              <MenuItem value=""><em>— Select —</em></MenuItem>
              {reports.map(r => (
                <MenuItem key={r.pkAudRepID} value={r.pkAudRepID}>{r.RepName}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Select Date Field dropdown — populated from Q3 (AuditReportColumns, ComposeFlg='Y') */}
          {/* VB6: vfgTLSelDateField combo, value = ColName, display = ColDisplayName */}
          {/* Empty = no date filter (VB6 bug: Or condition always applied the filter) */}
          <FormControl sx={{ minWidth: 200 }} size="small">
            <InputLabel>Select Date Field</InputLabel>
            <Select
              label="Select Date Field"
              value={selField}
              onChange={e => setSelField(e.target.value)}
            >
              <MenuItem value=""><em>— None (all records) —</em></MenuItem>
              {dateFields.map(f => (
                <MenuItem key={f.ColName} value={f.ColName}>{f.ColDisplayName}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Start Date — seeded from FaYearInfo.StartDate (VB6: dtpTLFromDt) */}
          <TextField
            label="Start Date"
            type="date"
            size="small"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            disabled={!selField}
            sx={{ width: 155 }}
          />

          {/* End Date — seeded from today (VB6: dtpTLEndDt = gudfGetCurrDateTime("D")) */}
          <TextField
            label="End Date"
            type="date"
            size="small"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            disabled={!selField}
            sx={{ width: 155 }}
          />

          {/* VIEW button — VB6: cmdTLView */}
          <Button
            variant="contained"
            size="small"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
            onClick={handleView}
            disabled={loading || !selReport}
          >
            View
          </Button>

          {/* EXCEL button — VB6: cmdTLExcel — only shown when data is loaded */}
          {hasData && can('AUDIT_REP', 'CanExport') && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<FileDownloadIcon />}
              onClick={handleExcel}
            >
              Excel
            </Button>
          )}
        </Box>

        {/* Clarify that date pickers are inactive when no date field is selected */}
        {!selField && selReport && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            No date field selected — all records for the chosen report will be returned.
          </Typography>
        )}
      </Paper>

      {err && (
        <Alert severity={hasData ? 'error' : 'info'} sx={{ mb: 2 }}>{err}</Alert>
      )}

      {/* ── Data Grid ── */}
      {/* VB6: vfgTL FlexGrid — col 0 hidden, DEL rows pink, UPD diffs bold */}
      {hasData && (
        <Paper sx={{ overflow: 'auto' }}>
          <div ref={tableRef} style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, minWidth: 600 }}>
              <thead>
                <tr style={{ background: '#1565c0' }}>
                  {columns.map((col, ci) => (
                    // Col 0 (UniqueSrNo_AT) is hidden — VB6: vfgTL.ColHidden(0) = True
                    <th
                      key={col.ColName}
                      style={{
                        display:    ci === 0 ? 'none' : undefined,
                        padding:    '5px 8px',
                        color:      '#fff',
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                        textAlign:  'left',
                        borderBottom: '1px solid #0d47a1',
                        userSelect: 'none',
                      }}
                    >
                      {col.ColDisplayName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gridRows.map((row, ri) => (
                  <tr
                    key={ri}
                    style={{
                      // DEL rows: VB6 &HC0C0FF — always pink regardless of zebra stripe
                      background: row.bg || (ri % 2 === 0 ? '#ffffff' : '#f9f9f9'),
                    }}
                  >
                    {row.cells.map((cell, ci) => (
                      <td
                        key={ci}
                        style={{
                          display:    ci === 0 ? 'none' : undefined,
                          padding:    '3px 8px',
                          // Bold set by UPD1/UPD2 comparison — VB6: .Cell(flexcpFontBold,...)
                          fontWeight: cell.bold ? 'bold' : 'normal',
                          whiteSpace: 'nowrap',
                          borderBottom: '1px solid #e0e0e0',
                        }}
                      >
                        {cell.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer: record count + legend */}
          <Box sx={{ p: 1, borderTop: '1px solid #e0e0e0' }}>
            <Typography variant="caption" color="text.secondary">
              {gridRows.length} record{gridRows.length !== 1 ? 's' : ''}
              {' — '}
              <span style={{ background: DEL_BG, padding: '1px 6px', borderRadius: 2 }}>pink</span>
              {' = deleted rows; '}
              <strong>bold</strong>
              {' = changed fields between UPD1 → UPD2'}
            </Typography>
          </Box>
        </Paper>
      )}
    </Box>
  );
}
