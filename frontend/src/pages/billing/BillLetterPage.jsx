import { useState, useEffect, useCallback } from 'react';
import {
  Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress,
  FormControl, FormControlLabel, FormGroup, FormLabel, InputLabel, MenuItem,
  Paper, Radio, RadioGroup, Select, Stack, Switch, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import PrintIcon        from '@mui/icons-material/Print';
import SaveIcon         from '@mui/icons-material/Save';
import SearchIcon       from '@mui/icons-material/Search';
import { useAuth }        from '../../contexts/AuthContext';
import api                from '../../services/api';
import * as XLSX          from 'xlsx';
import { ADITYA_LOGO_B64 } from '../../assets/adityaLogo';
import { VLCO_LOGO_B64 }   from '../../assets/vlcoLogo';

const fmtAmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDt  = s => { if (!s) return ''; const d = String(s).slice(0,10); return `${d.slice(8,10)}/${d.slice(5,7)}/${d.slice(0,4)}`; };
const today  = () => new Date().toISOString().slice(0,10);

export default function BillLetterPage() {
  const { can, user } = useAuth();

  const [parties,    setParties]    = useState([]);
  const [faYears,    setFaYears]    = useState([]);
  const [party,      setParty]      = useState(null);
  const [faYear,     setFaYear]     = useState(null);
  const [mode,       setMode]       = useState('letter');
  const [letterDate, setLetterDate] = useState(today());
  const [bills,      setBills]      = useState([]);
  const [selected,   setSelected]   = useState(new Set());
  const [groupParties,  setGroupParties]  = useState([]);   // parties sharing same pGroup
  const [selPartyIDs,   setSelPartyIDs]   = useState(new Set()); // checked in party grid
  const [viewSaved,     setViewSaved]     = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [err,        setErr]        = useState('');
  const [msg,        setMsg]        = useState('');

  useEffect(() => {
    api.get('/billing/bill-letter/form-data')
      .then(r => {
        setParties(r.data.parties || []);
        const fys = r.data.faYears || [];
        setFaYears(fys);
        if (fys.length) setFaYear(fys[0]);
      })
      .catch(e => setErr(e.response?.data?.error || e.message));
  }, []);

  // When party selection changes, filter to same-group parties and auto-check all
  useEffect(() => {
    if (!party || !parties.length) {
      setGroupParties([]);
      setSelPartyIDs(new Set());
      return;
    }
    const gp = parties.filter(p => p.pGroup === party.pGroup);
    setGroupParties(gp);
    setSelPartyIDs(new Set(gp.map(p => p.pkPartyID)));
    setBills([]);
    setSelected(new Set());
  }, [party, parties]);

  const clearBills = () => { setBills([]); setSelected(new Set()); };

  const loadBills = useCallback(async () => {
    if (!selPartyIDs.size) { setErr('Select at least one party from the group'); return; }
    if (!faYear)           { setErr('Select a financial year');                  return; }
    setErr(''); setMsg(''); clearBills(); setLoading(true);

    // VB6: endDate = min(letterDate, faYear.EndDate)
    const endDate = letterDate && letterDate < faYear.EndDate ? letterDate : faYear.EndDate;
    try {
      const r = await api.get('/billing/bill-letter/bills', {
        params: { partyID: [...selPartyIDs].join(','), startDate: faYear.StartDate, endDate, mode, viewSaved },
      });
      setBills(r.data.rows || []);
      if (!(r.data.rows || []).length) setMsg('No bills found for the selected criteria.');
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [selPartyIDs, faYear, mode, letterDate, viewSaved]);

  const toggleAll = useCallback(checked => {
    setSelected(checked ? new Set(bills.map(b => b.pkBillID)) : new Set());
  }, [bills]);

  const toggleOne = useCallback(id => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSave = async () => {
    if (!selected.size) { setErr('Select at least one bill'); return; }
    setErr(''); setMsg(''); setSaving(true);
    try {
      const payload = {
        mode,
        letterDate,
        bills: bills
          .filter(b => selected.has(b.pkBillID))
          .map(b => ({ pkBillID: b.pkBillID, TableName: b.TableName })),
      };
      const r = await api.put('/billing/bill-letter/save', payload);
      setMsg(`Saved — ${r.data.updated} bill(s) updated.`);
      clearBills();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const rows = bills.map(b => ({
      'Bill Date':   fmtDt(b.BillDt),
      'Bill No.':    b.BillNum,
      'Amount':      Number(b.BillAmt || 0),
      'Party':       b.pName,
      'Ltr Flag':    b.LtrFlg || 'N',
      'Ackldg Date': fmtDt(b.AcknldgDt),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Letter & Acknowledgement');
    XLSX.writeFile(wb, 'BillLetter.xlsx');
  };

  const handlePrint = () => {
    const selBills = bills.filter(b => selected.has(b.pkBillID));
    if (!selBills.length) { setErr('Select at least one bill to print'); return; }

    const isBHW    = user?.groupID === 'BHW';
    const logo     = isBHW ? ADITYA_LOGO_B64 : user?.groupID === 'MUM' ? VLCO_LOGO_B64 : '';
    const compName = isBHW ? 'Aditya Services' : (user?.groupName || 'Company');
    const ltrDate  = fmtDt(letterDate);

    const toName = party?.pName || '';
    const toAddr = (party?.pBillAdd || '').replace(/\r?\n/g, '<br>');

    // ── Company letterhead (compact for half-A4-landscape column) ───────────
    const letterhead = isBHW ? `
      <div style="text-align:center;margin-bottom:3px">
        ${logo ? `<img src="${logo}" alt="Aditya Services" style="height:72px;width:auto">` : ''}
      </div>
      <div style="text-align:center;font-size:7.5pt;line-height:1.7;color:#111">
        H.O. Address : 83 L. L. Shah Marg, Opp. Ashok Hotel, Dana Bunder, Masjid (E),
        Mumbai - 400 009. Tel : 23484191, 23483452<br>
        Address : Shed No. 9/7A, Arun Compound, Dal Mill Compound, Near Badamwala Compound,
        Village - Purna, Bhiwandi, Thane - 421 302<br>
        Tel : 02522- 646196, 9225905505 &nbsp;&nbsp; Website : www.adityaservices.co.in
        &nbsp;&nbsp; Email : info@adityaservices.co.in
      </div>
      <hr style="border:none;border-top:1px solid #555;margin:5px 0 8px">
    ` : `
      <div style="text-align:center;margin-bottom:6px">
        ${logo ? `<img src="${logo}" alt="${compName}" style="height:72px;width:auto">` :
          `<div style="font-size:18px;font-weight:bold;letter-spacing:2px">${compName.toUpperCase()}</div>`}
      </div>
      <hr style="border:none;border-top:1px solid #555;margin:5px 0 8px">
    `;

    // ── Bill rows ────────────────────────────────────────────────────────────
    const tableRows = selBills.map(b => `
      <tr>
        <td>${fmtDt(b.BillDt)}</td>
        <td>${b.BillNum || ''}</td>
        <td class="r">${fmtAmt(b.BillAmt)}</td>
        <td>${b.pName || ''}</td>
      </tr>`).join('');

    // ── One copy of the letter (rendered inside each column) ─────────────────
    const copy = `
      ${letterhead}
      <p class="dr">Date : ${ltrDate}</p>
      <br>
      <p>To,<br><strong>${toName}</strong>${toAddr ? '<br>' + toAddr : ''}</p>
      <br>
      <p>Dear Sir,</p>
      <p style="text-indent:2em">Sending here with the bills, which are as follows</p>
      <table>
        <thead>
          <tr>
            <th>Bill Date</th><th>Bill No</th>
            <th class="r">Net Amount</th><th>Party Name</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      <p>Please make payment at earlyest</p>
      <br>
      <p>Thanking you,</p>
      <br>
      <p>For <strong>${compName}</strong></p>
      <br><br><br>
      <p>Authorised Signature</p>`;

    // ── A4 landscape: two identical copies side by side, dotted divider ──────
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Bill Letter</title>
      <style>
        @page { size:A4 landscape; margin:8mm }
        *     { box-sizing:border-box }
        body  { font-family:Arial,sans-serif; font-size:9.5pt;
                margin:0; display:flex; height:100vh; width:100% }
        .col  { flex:1; padding:6mm; overflow:hidden }
        .sep  { border-left:2px dashed #888; margin:4mm 0; align-self:stretch }
        p     { margin:4px 0; line-height:1.6 }
        table { border-collapse:collapse; width:100%; margin:6px 0 10px }
        th    { border:1px solid #444; padding:3px 6px; background:#f0f0f0;
                font-weight:bold; text-align:left; font-size:9pt }
        td    { border:1px solid #aaa; padding:2px 6px; font-size:9pt }
        .r    { text-align:right }
        .dr   { text-align:right }
        @media print { body { margin:0 } }
      </style>
    </head><body>
      <div class="col">${copy}</div>
      <div class="sep"></div>
      <div class="col">${copy}</div>
    </body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  const allChecked  = bills.length > 0 && selected.size === bills.length;
  const someChecked = selected.size > 0 && selected.size < bills.length;
  const canEdit     = can('BILL_LETTER', 'CanEdit');

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>Bill Letter &amp; Acknowledgement</Typography>

      {err && <Alert severity="error"   sx={{ mb: 1 }} onClose={() => setErr('')}>{err}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 1 }} onClose={() => setMsg('')}>{msg}</Alert>}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', md: 'flex-end' }}
          flexWrap="wrap"
          useFlexGap
        >
          <Autocomplete
            options={parties}
            getOptionLabel={o => o.pName || ''}
            value={party}
            onChange={(_, v) => { setParty(v); clearBills(); }}
            isOptionEqualToValue={(o, v) => o.pkPartyID === v?.pkPartyID}
            renderInput={p => <TextField {...p} label="Party Name" size="small" />}
            sx={{ minWidth: 240 }}
          />

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Financial Year</InputLabel>
            <Select
              label="Financial Year"
              value={faYear?.FaYear || ''}
              onChange={e => {
                setFaYear(faYears.find(f => f.FaYear === e.target.value) || null);
                clearBills();
              }}
            >
              {faYears.map(f => (
                <MenuItem key={f.FaYear} value={f.FaYear}>{f.FaYear}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Letter Date"
            type="date"
            size="small"
            value={letterDate}
            onChange={e => setLetterDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 155 }}
          />

          <FormControl>
            <FormLabel sx={{ fontSize: 12 }}>Mode</FormLabel>
            <RadioGroup
              row
              value={mode}
              onChange={e => { setMode(e.target.value); clearBills(); }}
            >
              <FormControlLabel value="letter"  control={<Radio size="small" />} label="Create Letter" />
              <FormControlLabel value="ackdate" control={<Radio size="small" />} label="Ack. Date" />
              <FormControlLabel value="both"    control={<Radio size="small" />} label="Both" />
            </RadioGroup>
          </FormControl>

          <Tooltip title="Load bills already marked / acknowledged (for review or correction)">
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={viewSaved}
                  onChange={e => { setViewSaved(e.target.checked); clearBills(); }}
                  color="warning"
                />
              }
              label={<Typography variant="caption" fontWeight={viewSaved ? 700 : 400}>View Saved</Typography>}
              sx={{ ml: 0 }}
            />
          </Tooltip>

          <Button
            variant="contained"
            size="small"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
            onClick={loadBills}
            disabled={loading || !selPartyIDs.size || !faYear}
          >
            Load Bills
          </Button>
        </Stack>
      </Paper>

      {/* ── Party selection grid (appears when a party is selected) ──────────── */}
      {groupParties.length > 0 && (
        <Paper sx={{ mb: 2 }}>
          <Box sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" fontWeight={700} sx={{ flexGrow: 1 }}>
              Group Parties — {party?.pGroup || ''}
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                ({selPartyIDs.size} of {groupParties.length} selected)
              </Typography>
            </Typography>
          </Box>
          <TableContainer sx={{ maxHeight: 200 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selPartyIDs.size === groupParties.length && groupParties.length > 0}
                      indeterminate={selPartyIDs.size > 0 && selPartyIDs.size < groupParties.length}
                      onChange={e =>
                        setSelPartyIDs(e.target.checked ? new Set(groupParties.map(p => p.pkPartyID)) : new Set())
                      }
                    />
                  </TableCell>
                  <TableCell>Party Name</TableCell>
                  <TableCell>Group</TableCell>
                  <TableCell>Comp Code</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {groupParties.map(p => {
                  const isChk = selPartyIDs.has(p.pkPartyID);
                  return (
                    <TableRow
                      key={p.pkPartyID}
                      hover
                      selected={isChk}
                      onClick={() => {
                        setSelPartyIDs(prev => {
                          const next = new Set(prev);
                          if (next.has(p.pkPartyID)) next.delete(p.pkPartyID); else next.add(p.pkPartyID);
                          return next;
                        });
                        clearBills();
                      }}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={isChk}
                          onChange={() => {}}
                          onClick={e => e.stopPropagation()}
                        />
                      </TableCell>
                      <TableCell>{p.pName}</TableCell>
                      <TableCell>{p.pGroup || ''}</TableCell>
                      <TableCell>{p.pCode || ''}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {viewSaved && bills.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Viewing saved entries. Select bills, change the Letter Date if needed, then click <strong>Save</strong> to update.
        </Alert>
      )}

      {bills.length > 0 && (
        <Paper sx={{ mb: 2 }}>
          <TableContainer sx={{ maxHeight: 440 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={allChecked}
                      indeterminate={someChecked}
                      onChange={e => toggleAll(e.target.checked)}
                    />
                  </TableCell>
                  <TableCell>Bill Date</TableCell>
                  <TableCell>Bill No.</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Party Name</TableCell>
                  <TableCell>Party Group</TableCell>
                  <TableCell align="center">Ltr&nbsp;Flag</TableCell>
                  <TableCell>Ackldg Date</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {bills.map(b => {
                  const isSelected = selected.has(b.pkBillID);
                  return (
                    <TableRow
                      key={b.pkBillID}
                      hover
                      selected={isSelected}
                      onClick={() => toggleOne(b.pkBillID)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={isSelected}
                          onChange={() => toggleOne(b.pkBillID)}
                          onClick={e => e.stopPropagation()}
                        />
                      </TableCell>
                      <TableCell>{fmtDt(b.BillDt)}</TableCell>
                      <TableCell>{b.BillNum}</TableCell>
                      <TableCell align="right">{fmtAmt(b.BillAmt)}</TableCell>
                      <TableCell>{b.pName}</TableCell>
                      <TableCell>{b.pGroup || ''}</TableCell>
                      <TableCell align="center">
                        {b.LtrFlg === 'Y'
                          ? <Chip label="Y" size="small" color="success" sx={{ height: 18, fontSize: 11 }} />
                          : <Chip label="N" size="small" variant="outlined" sx={{ height: 18, fontSize: 11 }} />
                        }
                      </TableCell>
                      <TableCell>{fmtDt(b.AcknldgDt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <Stack direction="row" spacing={1} flexWrap="wrap">
        {canEdit && (
          <Button
            variant="contained"
            size="small"
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
            onClick={handleSave}
            disabled={saving || !selected.size}
          >
            Save
          </Button>
        )}
        {bills.length > 0 && (
          <>
            <Button
              variant="outlined"
              size="small"
              startIcon={<PrintIcon />}
              onClick={handlePrint}
              disabled={!selected.size}
            >
              Print Letter
            </Button>
            {can('BILL_LETTER', 'CanExport') && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<FileDownloadIcon />}
              onClick={handleExport}
            >
              Export
            </Button>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}
