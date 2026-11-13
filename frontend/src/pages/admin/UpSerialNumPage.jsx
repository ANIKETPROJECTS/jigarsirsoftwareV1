// ─────────────────────────────────────────────────────────────────────────────
// UpSerialNumPage.jsx
//
// VB6 origin: frmUpSerialNo.frm  ("Update Serial Number")
//
// Purpose: Administrative screen that lets a privileged user manually override
// the "last used" serial counter for either:
//   • Bill Numbers  — stored in VCSeriesSrno.LastNo
//   • Lot Numbers   — stored in SerialIDLot.LastNum
//
// This is a correction/reset tool, not a normal entry form.  Only roles with
// the UP_SERIAL_NUM module permission can access it.
//
// VB6 → React mapping:
//   OptUpSeriesNo radio array  →  `mode` state ('bill' | 'lot')
//   fraBillNum / fraLotNum     →  conditional rendering of <BillSection> / <LotSection>
//   VSFlexGrid combos          →  MUI <Select> dropdowns
//   txtBillSerialNum           →  `billSerial` state
//   txtLotSerialNum            →  `lotSerial` state
//   udfFillGridCombo           →  useEffect on mount (load parties + bill types)
//   vfgBillType_AfterEdit      →  handleBillTypeChange
//   vfgBillYear_AfterEdit      →  handleBillYearChange
//   vfgBillSeriesDt_AfterEdit  →  handleSeriesDateChange  (also triggers serial fetch)
//   vfgPartyName_AfterEdit     →  handlePartyChange
//   vfgLotYear_AfterEdit       →  handleLotYearChange
//   vfgToBilled_AfterEdit      →  handleToBilledChange    (also triggers serial fetch)
//   udfValSerialNum            →  validateSerial()
//   cmdUpdate_Click            →  handleUpdate()
//   udfInitialiseControls      →  resetForm() called after successful save
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import {
  Alert, Box, Button, CircularProgress, Divider, FormControl,
  FormControlLabel, InputLabel, MenuItem, Paper, Radio, RadioGroup,
  Select, Stack, TextField, Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import api      from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Static combo data — VB6: udfFillGridCombo() hardcoded lists ─────────────
// vfgItemType.ColComboList(0) = "|#ITM;Item|#SPC;Space"
// VSFlexGrid strips the # prefix before storing — DB has ITM / SPC (no #)
const ITEM_TYPES = [
  { value: 'ITM', label: 'Item' },
  { value: 'SPC', label: 'Space' },
];

// vfgToBilled.ColComboList(0) = "|#Y;Yes|#N;No"
// VSFlexGrid strips the # prefix before storing — DB has Y / N (no #)
const TO_BILLED_OPTIONS = [
  { value: 'Y', label: 'Yes' },
  { value: 'N', label: 'No' },
];

// ── Helper: blank Bill state ─────────────────────────────────────────────────
function fmtSeriesDate(sd) {
  if (!sd || sd === '00000000') return 'Annual';
  if (sd.length === 8) {
    const y = sd.slice(0, 4), m = sd.slice(4, 6), d = sd.slice(6, 8);
    if (m === '00') return y;
    if (d === '00') { const mo = new Date(`${y}-${m}-01`); return mo.toLocaleString('default', { month: 'short', year: 'numeric' }); }
    return new Date(`${y}-${m}-${d}`).toLocaleDateString('en-IN');
  }
  return sd;
}

// VB6: udfInitialiseControls clears mImp.fkSeriesID, mFv.sFaYear, mFv.sSeriesDt
function makeBillEmpty() {
  return { seriesID: '', faYear: '', seriesDate: '', serial: '' };
}

// ── Helper: blank Lot state ─────────────────────────────────────────────────
// VB6: udfInitialiseControls clears mImp.fkPartyID, mFv.sFaYear, mFv.sItemType, mFv.sToBilled
function makeLotEmpty() {
  return { partyID: '', faYear: '', itemType: '', toBilled: '', serial: '' };
}

export default function UpSerialNumPage() {
  const { can } = useAuth();

  // ── Mode toggle ────────────────────────────────────────────────────────────
  // VB6: OptUpSeriesNo control array; Index 0 = Bill No, Index 1 = Lot No
  // cixBillNo = 0, cixLotNo = 1
  const [mode, setMode] = useState('bill'); // 'bill' | 'lot'

  // ── Static dropdown data — loaded once on mount ────────────────────────────
  // VB6: udfFillGridCombo() populates vfgPartyName + vfgBillType from DB
  const [parties,   setParties]   = useState([]);
  const [billTypes, setBillTypes] = useState([]);
  const [loadingForm, setLoadingForm] = useState(true);
  const [formError,   setFormError]   = useState('');

  // ── Dynamic Bill-mode state ────────────────────────────────────────────────
  // VB6 module variables: mImp.fkSeriesID, mFv.sFaYear, mFv.sSeriesDt, mFv.nLastNum
  const [bill,       setBill]       = useState(makeBillEmpty);
  const [billYears,  setBillYears]  = useState([]);   // vfgBillYear options
  const [seriesDates, setSeriesDates] = useState([]); // vfgBillSeriesDt options

  // ── Dynamic Lot-mode state ─────────────────────────────────────────────────
  // VB6 module variables: mImp.fkPartyID, mFv.sFaYear, mFv.sItemType, mFv.sToBilled, mFv.nLastNum
  const [lot,      setLot]      = useState(makeLotEmpty);
  const [lotYears, setLotYears] = useState([]); // vfgLotYear options

  // ── UI feedback ────────────────────────────────────────────────────────────
  const [serialLoading, setSerialLoading] = useState(false); // spinner while fetching serial
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');
  const [successMsg,    setSuccessMsg]    = useState('');

  // ─────────────────────────────────────────────────────────────────────────
  // Load parties and bill types once when the page mounts.
  // VB6: Form_Load → udfFillGridCombo()
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/admin/up-serial-num/form-data');
        setParties(data.parties   || []);
        setBillTypes(data.billTypes || []);
      } catch (err) {
        setFormError(err.response?.data?.error || 'Failed to load form data');
      } finally {
        setLoadingForm(false);
      }
    })();
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Mode toggle handler
  // VB6: OptUpSeriesNo_Click(Index)
  //   Index = cixBillNo (0) → fraBillNum.Enabled = True, fraLotNum.Enabled = False
  //   Index = cixLotNo  (1) → fraBillNum.Enabled = False, fraLotNum.Enabled = True
  //
  // Also resets both panels (udfInitialiseControls resets all mFv / mImp vars)
  // ─────────────────────────────────────────────────────────────────────────
  function handleModeChange(e) {
    setMode(e.target.value);
    // Reset both panels and their cascading options
    setBill(makeBillEmpty());
    setBillYears([]);
    setSeriesDates([]);
    setLot(makeLotEmpty());
    setLotYears([]);
    setError('');
    setSuccessMsg('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BILL FLOW — Step 1: select Bill Type
  // VB6: vfgBillType_AfterEdit
  //   mImp.fkSeriesID = vfgBillType.TextMatrix(0, 0)   ← stores the ID
  //   Call udfFillFaYear                                ← populates vfgBillYear
  // ─────────────────────────────────────────────────────────────────────────
  const handleBillTypeChange = useCallback(async (seriesID) => {
    // Reset downstream fields whenever the upstream selection changes
    setBill({ seriesID, faYear: '', seriesDate: '', serial: '' });
    setBillYears([]);
    setSeriesDates([]);
    setError('');
    setSuccessMsg('');

    if (!seriesID) return;

    try {
      // VB6: "select Distinct FaYear from VCSeriesSrNo where ... and fkSeriesID=? order by FaYear DESC"
      const { data } = await api.get('/admin/up-serial-num/bill-years', { params: { seriesID } });
      setBillYears(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load financial years');
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // BILL FLOW — Step 2: select Financial Year
  // VB6: vfgBillYear_AfterEdit
  //   mFv.sFaYear = vfgBillYear.TextMatrix(0, 0)   ← stores selected year
  //   Call udfFillSeriesDt                          ← populates vfgBillSeriesDt
  // ─────────────────────────────────────────────────────────────────────────
  const handleBillYearChange = async (faYear) => {
    setBill((prev) => ({ ...prev, faYear, seriesDate: '', serial: '' }));
    setSeriesDates([]);
    setError('');
    setSuccessMsg('');

    if (!faYear || !bill.seriesID) return;

    try {
      // VB6: "Select SeriesDate,fkSeriesID from VCSeriesSrno where ... and FaYear=? order by SeriesDate DESC"
      const { data } = await api.get('/admin/up-serial-num/series-dates', {
        params: { seriesID: bill.seriesID, faYear },
      });
      setSeriesDates(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load series dates');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // BILL FLOW — Step 3: select Series Date  →  auto-fetch current serial number
  // VB6: vfgBillSeriesDt_AfterEdit
  //   mFv.sSeriesDt = vfgBillSeriesDt.TextMatrix(0, 0)
  //   udfUpdateSerialNumber  →  SELECT * from VCSeriesSrno where ... → fills txtBillSerialNum
  // ─────────────────────────────────────────────────────────────────────────
  const handleSeriesDateChange = async (seriesDate) => {
    setBill((prev) => ({ ...prev, seriesDate, serial: '' }));
    setError('');
    setSuccessMsg('');

    if (!seriesDate || !bill.seriesID || !bill.faYear) return;

    setSerialLoading(true);
    try {
      // VB6: udfUpdateSerialNumber → "Select * from VCSeriesSrno where ... and SeriesDate=?"
      const { data } = await api.get('/admin/up-serial-num/bill-serial', {
        params: { seriesID: bill.seriesID, faYear: bill.faYear, seriesDate },
      });
      // VB6: txtBillSerialNum.Text = mRs.rsUpSerialNum("LastNo")
      setBill((prev) => ({ ...prev, seriesDate, serial: String(data.LastNo ?? '') }));
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to fetch serial number';
      // VB6: MsgBox "There is no record to show.", vbInformation, ...
      setError(msg);
    } finally {
      setSerialLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // LOT FLOW — Step 1: select Party Name
  // VB6: vfgPartyName_AfterEdit
  //   mImp.fkPartyID = vfgPartyName.TextMatrix(0, 0)
  //   Call udfFillFaYear  →  Lot branch — fills vfgLotYear
  // ─────────────────────────────────────────────────────────────────────────
  const handlePartyChange = useCallback(async (partyID) => {
    setLot({ partyID, faYear: '', itemType: '', toBilled: '', serial: '' });
    setLotYears([]);
    setError('');
    setSuccessMsg('');

    if (!partyID) return;

    try {
      // VB6: "select Distinct FaYear from SerialIDLot where ... and fkPartyID=? order by FaYear DESC"
      const { data } = await api.get('/admin/up-serial-num/lot-years', { params: { partyID } });
      setLotYears(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load financial years');
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // LOT FLOW — Step 2: select Financial Year
  // VB6: vfgLotYear_AfterEdit
  //   mFv.sFaYear = vfgLotYear.TextMatrix(0, 0)
  //   (Note: VB6 does NOT immediately fetch serial here — waits for ToBilled)
  // ─────────────────────────────────────────────────────────────────────────
  function handleLotYearChange(faYear) {
    setLot((prev) => ({ ...prev, faYear, serial: '' }));
    setError('');
    setSuccessMsg('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOT FLOW — Step 3: select Item Type
  // VB6: vfgItemType_AfterEdit
  //   mFv.sItemType = vfgItemType.TextMatrix(0, 0)
  //   (VB6 does NOT fetch serial here — commented out: 'udfUpdateSerialNumber')
  // ─────────────────────────────────────────────────────────────────────────
  function handleItemTypeChange(itemType) {
    setLot((prev) => ({ ...prev, itemType, serial: '' }));
    setError('');
    setSuccessMsg('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOT FLOW — Step 4: select To Billed  →  auto-fetch current serial number
  // VB6: vfgToBilled_AfterEdit
  //   mFv.sToBilled = vfgToBilled.TextMatrix(0, 0)
  //   Call udfUpdateSerialNumber  →  SELECT * from SerialIDLot where ... → fills txtLotSerialNum
  // ─────────────────────────────────────────────────────────────────────────
  const handleToBilledChange = useCallback(async (toBilled) => {
    setLot((prev) => ({ ...prev, toBilled, serial: '' }));
    setError('');
    setSuccessMsg('');

    // Need all four keys before fetching
    if (!lot.partyID || !lot.faYear || !lot.itemType || !toBilled) return;

    setSerialLoading(true);
    try {
      // VB6: udfUpdateSerialNumber → "Select * from SerialIDLot where ... and LotBillFlg=?"
      const { data } = await api.get('/admin/up-serial-num/lot-serial', {
        params: {
          partyID:  lot.partyID,
          faYear:   lot.faYear,
          itemType: lot.itemType,
          toBilled,
        },
      });
      // VB6: txtLotSerialNum.Text = mRs.rsUpSerialNum("LastNum")
      setLot((prev) => ({ ...prev, toBilled, serial: String(data.LastNum ?? '') }));
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to fetch serial number';
      setError(msg);
    } finally {
      setSerialLoading(false);
    }
  }, [lot.partyID, lot.faYear, lot.itemType]);

  // ─────────────────────────────────────────────────────────────────────────
  // Validation — mirrors VB6 udfValSerialNum(psErrMsg)
  // VB6 only validated the Bill textbox (a bug); we validate whichever mode is active.
  // Rule: not empty AND must be a whole number >= 0
  // ─────────────────────────────────────────────────────────────────────────
  function validateSerial() {
    const raw = mode === 'bill' ? bill.serial : lot.serial;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return 'Please enter Serial Number.';
    }
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 0) {
      return 'Serial Number must be a whole number ≥ 0.';
    }
    return null; // null = valid
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Submit handler — mirrors VB6 cmdUpdate_Click → udfValSerialNum → udfSaveData
  // ─────────────────────────────────────────────────────────────────────────
  async function handleUpdate() {
    setError('');
    setSuccessMsg('');

    // VB6: udfValSerialNum(sErrMsg) — validate before touching the DB
    const validationError = validateSerial();
    if (validationError) {
      // VB6: MsgBox sErrMsg, vbOKOnly + vbExclamation, ...
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      if (mode === 'bill') {
        // VB6: udfSaveData → Bill branch → UPDATE VCSeriesSrno SET LastNo = ?
        await api.put('/admin/up-serial-num/bill-serial', {
          seriesID:   bill.seriesID,
          faYear:     bill.faYear,
          seriesDate: bill.seriesDate,
          lastNo:     parseInt(bill.serial, 10),
        });
      } else {
        // VB6: udfSaveData → Lot branch → UPDATE SerialIDLot SET LastNum = ?
        await api.put('/admin/up-serial-num/lot-serial', {
          partyID:  lot.partyID,
          faYear:   lot.faYear,
          itemType: lot.itemType,
          toBilled: lot.toBilled,
          lastNum:  parseInt(lot.serial, 10),
        });
      }

      // VB6: MsgBox "Series Number Updated.", vbOKOnly + vbInformation, ...
      setSuccessMsg('Series Number Updated successfully.');

      // VB6: udfInitialiseControls — reset form after successful save
      setBill(makeBillEmpty());
      setBillYears([]);
      setSeriesDates([]);
      setLot(makeLotEmpty());
      setLotYears([]);
    } catch (err) {
      // VB6: MsgBox "Serial Number Not Saved !!!", vbOKOnly + vbExclamation, ...
      setError(err.response?.data?.error || 'Serial Number Not Saved !!!');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loadingForm) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* ── Page title ── */}
      <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
        Update Serial Number
      </Typography>

      {formError && (
        <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>
      )}

      {/* ── Mode radio buttons ─────────────────────────────────────────────
          VB6: OptUpSeriesNo control array (Index 0 = Bill No, Index 1 = Lot No)
          Default: Bill No selected (cixBillNo)
      ── */}
      <RadioGroup
        row
        value={mode}
        onChange={handleModeChange}
        sx={{ mb: 2 }}
      >
        {/* VB6: OptUpSeriesNo(0).Caption = "Bill No" */}
        <FormControlLabel value="bill" control={<Radio />} label="Bill No" />
        {/* VB6: OptUpSeriesNo(1).Caption = "Lot No" */}
        <FormControlLabel value="lot"  control={<Radio />} label="Lot No" />
      </RadioGroup>

      {/* ── Alerts ── */}
      {error      && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      {/* ══════════════════════════════════════════════════════════════════════
          BILL NO SECTION — VB6: fraBillNum frame
          Enabled only when OptUpSeriesNo(0).Value = True
      ══════════════════════════════════════════════════════════════════════ */}
      {mode === 'bill' && (
        <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
          <Typography variant="subtitle2" color="primary" fontWeight={600} sx={{ mb: 2 }}>
            Bill No.
          </Typography>

          <Stack spacing={2}>
            {/* Row 1: Bill Type  |  Financial Year
                VB6: vfgBillType (combo, col 0 = SeriesName, col 1 = pkSeriesID)
                     vfgBillYear (after Bill Type selected — udfFillFaYear) */}
            <Stack direction="row" spacing={2} flexWrap="wrap">
              {/* vfgBillType → SELECT SeriesName+pkSeriesID FROM VCSeriesMast */}
              <FormControl size="small" sx={{ minWidth: 260, flexGrow: 2 }}>
                <InputLabel>Bill Type</InputLabel>
                <Select
                  label="Bill Type"
                  value={bill.seriesID}
                  onChange={(e) => handleBillTypeChange(e.target.value)}
                >
                  <MenuItem value=""><em>(Select)</em></MenuItem>
                  {billTypes.map((bt) => (
                    <MenuItem key={bt.pkSeriesID} value={bt.pkSeriesID}>
                      {bt.SeriesName}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* vfgBillYear → populated after Bill Type selected */}
              <FormControl size="small" sx={{ minWidth: 160, flexGrow: 1 }}
                disabled={!bill.seriesID || billYears.length === 0}>
                <InputLabel>Year</InputLabel>
                <Select
                  label="Year"
                  value={bill.faYear}
                  onChange={(e) => handleBillYearChange(e.target.value)}
                >
                  <MenuItem value=""><em>(Select)</em></MenuItem>
                  {billYears.map((r) => (
                    <MenuItem key={r.FaYear} value={r.FaYear}>{r.FaYear}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            {/* Row 2: Series Date  |  Serial Number (editable)
                VB6: vfgBillSeriesDt (after Year selected — udfFillSeriesDt)
                     txtBillSerialNum (pre-filled from DB — user can change it) */}
            <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
              {/* vfgBillSeriesDt → populated after Bill Year selected */}
              <FormControl size="small" sx={{ minWidth: 180, flexGrow: 1 }}
                disabled={!bill.faYear || seriesDates.length === 0}>
                <InputLabel>Series Date</InputLabel>
                <Select
                  label="Series Date"
                  value={bill.seriesDate}
                  onChange={(e) => handleSeriesDateChange(e.target.value)}
                >
                  <MenuItem value=""><em>(Select)</em></MenuItem>
                  {seriesDates.map((r) => (
                    <MenuItem key={r.SeriesDate} value={r.SeriesDate}>
                      {fmtSeriesDate(r.SeriesDate)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* txtBillSerialNum — pre-filled by udfUpdateSerialNumber; user edits before saving */}
              <Box sx={{ position: 'relative', minWidth: 160, flexGrow: 1 }}>
                <TextField
                  label="Series No."
                  size="small"
                  fullWidth
                  type="number"
                  inputProps={{ min: 0, step: 1 }}
                  value={bill.serial}
                  onChange={(e) => setBill((p) => ({ ...p, serial: e.target.value }))}
                  disabled={!bill.seriesDate || serialLoading}
                />
                {/* Spinner while fetching the current serial number from DB */}
                {serialLoading && (
                  <CircularProgress size={18} sx={{ position: 'absolute', right: 10, top: 10 }} />
                )}
              </Box>
            </Stack>
          </Stack>
        </Paper>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          LOT NO SECTION — VB6: fraLotNum frame
          Enabled only when OptUpSeriesNo(1).Value = True
      ══════════════════════════════════════════════════════════════════════ */}
      {mode === 'lot' && (
        <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
          <Typography variant="subtitle2" color="primary" fontWeight={600} sx={{ mb: 2 }}>
            Lot No.
          </Typography>

          <Stack spacing={2}>
            {/* Row 1: Party Name
                VB6: vfgPartyName → SELECT pName+pkPartyID FROM mParty */}
            <FormControl size="small" fullWidth>
              <InputLabel>Party Name</InputLabel>
              <Select
                label="Party Name"
                value={lot.partyID}
                onChange={(e) => handlePartyChange(e.target.value)}
              >
                <MenuItem value=""><em>(Select)</em></MenuItem>
                {parties.map((p) => (
                  <MenuItem key={p.pkPartyID} value={p.pkPartyID}>
                    {p.pName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Row 2: Year  |  Item Type  |  To Billed
                VB6: vfgLotYear  (after Party selected — udfFillFaYear Lot branch)
                     vfgItemType (static: #ITM=Item, #SPC=Space)
                     vfgToBilled (static: #Y=Yes, #N=No) — triggers serial fetch */}
            <Stack direction="row" spacing={2} flexWrap="wrap">
              {/* vfgLotYear */}
              <FormControl size="small" sx={{ minWidth: 140, flexGrow: 1 }}
                disabled={!lot.partyID || lotYears.length === 0}>
                <InputLabel>Year</InputLabel>
                <Select
                  label="Year"
                  value={lot.faYear}
                  onChange={(e) => handleLotYearChange(e.target.value)}
                >
                  <MenuItem value=""><em>(Select)</em></MenuItem>
                  {lotYears.map((r) => (
                    <MenuItem key={r.FaYear} value={r.FaYear}>{r.FaYear}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* vfgItemType — static list (VB6: "|#ITM;Item|#SPC;Space") */}
              <FormControl size="small" sx={{ minWidth: 140, flexGrow: 1 }}
                disabled={!lot.faYear}>
                <InputLabel>Item Type</InputLabel>
                <Select
                  label="Item Type"
                  value={lot.itemType}
                  onChange={(e) => handleItemTypeChange(e.target.value)}
                >
                  <MenuItem value=""><em>(Select)</em></MenuItem>
                  {ITEM_TYPES.map((it) => (
                    <MenuItem key={it.value} value={it.value}>{it.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* vfgToBilled — static list; selection triggers serial fetch
                  VB6: vfgToBilled_AfterEdit → udfUpdateSerialNumber */}
              <FormControl size="small" sx={{ minWidth: 120, flexGrow: 1 }}
                disabled={!lot.itemType}>
                <InputLabel>To Billed</InputLabel>
                <Select
                  label="To Billed"
                  value={lot.toBilled}
                  onChange={(e) => handleToBilledChange(e.target.value)}
                >
                  <MenuItem value=""><em>(Select)</em></MenuItem>
                  {TO_BILLED_OPTIONS.map((tb) => (
                    <MenuItem key={tb.value} value={tb.value}>{tb.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            {/* Row 3: Serial Number (editable)
                VB6: txtLotSerialNum — pre-filled by udfUpdateSerialNumber; user edits */}
            <Box sx={{ position: 'relative', maxWidth: 220 }}>
              <TextField
                label="Series No."
                size="small"
                fullWidth
                type="number"
                inputProps={{ min: 0, step: 1 }}
                value={lot.serial}
                onChange={(e) => setLot((p) => ({ ...p, serial: e.target.value }))}
                disabled={!lot.toBilled || serialLoading}
              />
              {serialLoading && (
                <CircularProgress size={18} sx={{ position: 'absolute', right: 10, top: 10 }} />
              )}
            </Box>
          </Stack>
        </Paper>
      )}

      <Divider sx={{ my: 2 }} />

      {/* ── Action buttons
          VB6: cmdUpdate (Update) + cmdCancel (Exit)
          cmdCancel_Click → Unload Me (navigate away in React) */}
      <Stack direction="row" spacing={2}>
        {can('UP_SERIAL_NUM', 'CanEdit') && (
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleUpdate}
            disabled={saving}
          >
            {saving ? 'Updating…' : 'Update'}
          </Button>
        )}
      </Stack>
    </Box>
  );
}
