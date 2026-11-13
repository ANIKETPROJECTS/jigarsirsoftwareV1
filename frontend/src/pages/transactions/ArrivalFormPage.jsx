// ArrivalFormPage.jsx — Add / Edit Stock Entry (Arrival / Return / In)
//
// Tab order per spec. Flat single-Paper layout.
// Dropdowns: TransType/Packing/PackType/PackColour use MenuItem (shrink label when empty).
//            Party/Item/Godown/LotNum(non-ARV) use Autocomplete.
// HamaliCode: NO > BA > LA > VB > VC > OB > OA/OC > CB > CR
// Rate = Amount / TotalQty (bidirectional).
// Tab 32: Cash Received + Rate → HamaliRecd
// Tab 33: Labour Amount + Rate → HamaliAmt
// Tab 34: Bill Amount  + Rate → OtherHmlAmt  (also used by Outside Labour Amount near checkbox)
// For IN/DESPRET: LotNum is an Autocomplete of open ARV lots → auto-fills Item/Weight/Packing.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { decodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, TextField, MenuItem, Divider,
  Stack, FormControlLabel, Checkbox, Alert, CircularProgress, Autocomplete, Chip,
  IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Snackbar,
} from '@mui/material';
import ArrowBackIcon     from '@mui/icons-material/ArrowBack';
import SaveIcon          from '@mui/icons-material/Save';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import AttachFileIcon    from '@mui/icons-material/AttachFile';
import CloseIcon         from '@mui/icons-material/Close';
import PictureAsPdfIcon  from '@mui/icons-material/PictureAsPdf';
import EmailIcon         from '@mui/icons-material/Email';
import PhotoCameraIcon    from '@mui/icons-material/PhotoCamera';
import PhotoLibraryIcon   from '@mui/icons-material/PhotoLibrary';
import ContentPasteIcon   from '@mui/icons-material/ContentPaste';
import api         from '../../services/api';
import LocBatchGrid from '../../components/LocBatchGrid';

// Base URL for serving static uploads (strips /api suffix from API base URL)
const STATIC_BASE = (import.meta.env.VITE_API_BASE_URL || '/api')
  .replace(/\/api\/?$/, '');

// ── Constants ─────────────────────────────────────────────────────────────────
const TRANS_TYPES = [
  { value: 'ARV',     label: 'Arrival' },
  { value: 'DESPRET', label: 'Return'  },
  { value: 'IN',      label: 'In'      },
];
const PACK_TYPES   = ['MS', 'Plastic', 'Wood', 'Cloth', 'Fiber', 'Paper'];
const DEFAULT_PACKINGS = [
  { VCCode: 'BAG', VCData: 'Bag' },
  { VCCode: 'LSE', VCData: 'Loose' },
  { VCCode: 'TAR', VCData: 'Tarpaulin' },
  { VCCode: 'DRM', VCData: 'Drum' },
  { VCCode: 'BNL', VCData: 'Bundle' },
  { VCCode: 'BOX', VCData: 'Box' },
  { VCCode: 'CTN', VCData: 'Carton' },
  { VCCode: 'CAN', VCData: 'Can' },
];
const PACK_COLOURS = ['White', 'Brown', 'Blue', 'Red', 'Green', 'Black',
                      'Silver', 'Grey', 'Orange', 'Purple', 'Yellow', 'Pink'];

// ── Hamali helpers ────────────────────────────────────────────────────────────
function deriveHamaliCode(flags, hamaliRecd) {
  const { onAc, varai, bankTrf, lbrAmt, billChk, noEntry } = flags;
  if (noEntry)                  return 'NO';
  if (billChk)                  return 'BA';
  if (lbrAmt)                   return 'LA';
  if (onAc && varai && bankTrf) return 'VB';
  if (onAc && varai)            return 'VC';
  if (onAc && bankTrf)          return 'OB';
  if (onAc)                     return Number(hamaliRecd) === 0 ? 'OA' : 'OC';
  if (bankTrf)                  return 'CB';
  return 'CR';
}

// cash → HamaliRecd | labour → HamaliAmt | bill → OtherHmlAmt
const HAMALI_FIELDS = {
  CR: { cash: true,  labour: false, bill: false },
  CB: { cash: false, labour: true,  bill: false },
  OA: { cash: false, labour: true,  bill: true  },
  OC: { cash: true,  labour: true,  bill: true  },
  OB: { cash: false, labour: true,  bill: true  },
  VC: { cash: true,  labour: true,  bill: true  },
  VB: { cash: false, labour: true,  bill: true  },
  BA: { cash: false, labour: false, bill: true  },
  LA: { cash: false, labour: true,  bill: false },
  NO: { cash: false, labour: false, bill: false },
};

const EMPTY_FLAGS = { onAc: false, varai: false, bankTrf: false, lbrAmt: false, billChk: false, noEntry: false };

function flagsFromCode(code) {
  const F = { ...EMPTY_FLAGS };
  switch (code) {
    case 'CB':  return { ...F, bankTrf: true };
    case 'OA':
    case 'OC':  return { ...F, onAc: true };
    case 'OB':  return { ...F, onAc: true, bankTrf: true };
    case 'VC':  return { ...F, onAc: true, varai: true };
    case 'VB':  return { ...F, onAc: true, varai: true, bankTrf: true };
    case 'BA':  return { ...F, billChk: true };
    case 'LA':  return { ...F, lbrAmt: true };
    case 'NO':  return { ...F, noEntry: true };
    default:    return F;
  }
}

// ── Empty form state ──────────────────────────────────────────────────────────
const EMPTY = {
  TransType:      'ARV',
  TransDt:        new Date().toISOString().slice(0, 10),
  TransTm:        new Date().toTimeString().slice(0, 5),
  fkPartyID:      '',
  pName:          '',
  LotNum:         '',
  pfkLotID:       '',
  pfkOriLotID:    '',
  fkItemID:       '',
  ItemExtDesc:    '',
  OwnTransFlg:    false,
  DoNum:          '',
  Billable:       'Y',
  fkGodownID1:    '',
  GodownQty1:     '',
  fkGodownID2:    '',
  GodownQty2:     '',
  Packing:        '',
  PackingType:    '',
  PackingColour:  '',
  PackWght:       '',
  GrossWght:      '',
  ActualWght:     '',
  RentRate:       '',
  VehiNum:        '',
  BENum:          '',
  ItemRate:       '',
  TransExtDetail: '',
  HamaliRecd:     '',
  HamaliAmt:      '',
  HmlBillAmt:     '',
  OtherHmlAmt:    '',
  OutsideLabr:    false,
  TransRemark:    '',
  BatchNum:       '',
  TransNote:      '',
};

const NUM_SX = {
  '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': { display: 'none' },
  '& input[type=number]': { MozAppearance: 'textfield' },
};
const blurOnWheel = (e) => e.target.blur();

export default function ArrivalFormPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { id: _rawParamId } = useParams();
  const id       = state?.id ?? decodeId(_rawParamId) ?? null;
  const isEdit   = !!id;

  const [form,         setForm]         = useState(() => ({ ...EMPTY, TransTm: new Date().toTimeString().slice(0, 5) }));
  const [flags,        setFlags]        = useState(EMPTY_FLAGS);
  const [hamaliRates,  setHamaliRates]  = useState({ cash: '', labour: '', bill: '', ct: '', chargeType: '' });
  const [parties,      setParties]      = useState([]);
  const [items,        setItems]        = useState([]);
  const [godowns,      setGodowns]      = useState([]);
  const [packings,     setPackings]     = useState([]);
  const [linkedGIDs,   setLinkedGIDs]   = useState(null); // null = not yet loaded; [] = loaded but none
  const [lotOptions,   setLotOptions]   = useState([]);
  const [lastLotNum,   setLastLotNum]   = useState('');
  const [partyInfo,    setPartyInfo]    = useState({ pCode: '', pLotType: '' });
  const [iType,        setIType]        = useState('');
  const [billableEditable, setBillableEditable] = useState(false);
  const [selPartyCompID, setSelPartyCompID] = useState('');
  const [attachments,  setAttachments]  = useState([]); // pending uploads: { file, preview, isPdf }
  const [savedDocs,    setSavedDocs]    = useState([]); // already saved on server: { filename, url }
  const [saving,       setSaving]       = useState(false);
  const [submitted,    setSubmitted]    = useState(false);
  const [loading,      setLoading]      = useState(isEdit);
  const [error,        setError]        = useState('');
  const [insStatus,    setInsStatus]    = useState({ g1: null, g2: null }); // null|'insured'|'not_insured'|'none'
  const [emailDialog,  setEmailDialog]  = useState({ open: false, transID: null, partyCompID: null });
  const [emailSending, setEmailSending] = useState(false);
  const [emailSnack,   setEmailSnack]   = useState({ open: false, msg: '', severity: 'success' });

  const fileInputRef    = useRef(null);
  const cameraInputRef  = useRef(null);
  const pasteZoneRef    = useRef(null);
  const photoInputRef   = useRef(null);

  const [stockPhotos,   setStockPhotos]   = useState([]);
  const [pendingPhotos, setPendingPhotos] = useState([]);
  const [locBatches,    setLocBatches]    = useState([{ fkGodownID: '', fkLocationID: '', batchNum: '', qty: '', remark: '' }]);
  const [arvTransDt,    setArvTransDt]    = useState(''); // arrival date of the selected lot (non-ARV only)

  // ── Derived ───────────────────────────────────────────────────────────────
  const hamaliCode = deriveHamaliCode(flags, form.HamaliRecd);
  const hmlFields  = HAMALI_FIELDS[hamaliCode] || HAMALI_FIELDS.CR;
  const totalQty   = (parseFloat(form.GodownQty1) || 0) + (parseFloat(form.GodownQty2) || 0);

  // Godown 1/2 dropdown options — all godowns, or filtered to linked ones when links exist
  const godownOpts = useMemo(() => {
    if (!linkedGIDs || linkedGIDs.length === 0) return godowns; // no links → show all
    return godowns.filter((g) => linkedGIDs.includes(g.pkGodownID));
  }, [godowns, linkedGIDs]);

  // Godown options for the LocBatch grid — derived from the parent godown selection
  const activeGodownOptions = useMemo(() => {
    const opts = [];
    if (form.fkGodownID1) {
      const g = godowns.find((g) => g.pkGodownID === form.fkGodownID1);
      if (g) opts.push({ pkGodownID: g.pkGodownID, gNum: g.gNum });
    }
    if (form.fkGodownID2 && form.fkGodownID2 !== form.fkGodownID1) {
      const g = godowns.find((g) => g.pkGodownID === form.fkGodownID2);
      if (g) opts.push({ pkGodownID: g.pkGodownID, gNum: g.gNum });
    }
    return opts;
  }, [form.fkGodownID1, form.fkGodownID2, godowns]);

  // FaYear computed from date — used both for display and lot-list query
  const faYearRaw = useMemo(() => {
    if (!form.TransDt) return '';
    const d = new Date(form.TransDt);
    if (isNaN(d.getTime())) return '';
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const sy = m >= 4 ? y : y - 1;
    return String(sy).slice(-2) + String(sy + 1).slice(-2);
  }, [form.TransDt]);

  const faYearDisplay = faYearRaw
    ? `FY ${faYearRaw.slice(0, 2)}-${faYearRaw.slice(2)}`
    : '';

  // Full faYear string for folder names: '2026-2027'
  const faYearFull = useMemo(() => {
    if (!faYearRaw || faYearRaw.length !== 4) return '';
    const sy = 2000 + parseInt(faYearRaw.slice(0, 2), 10);
    const ey = 2000 + parseInt(faYearRaw.slice(2, 4), 10);
    return `${sy}-${ey}`;
  }, [faYearRaw]);

  // Month-year folder for StockPhotos: 'Apr26'
  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthYear = useMemo(() => {
    if (!form.TransDt) return '';
    const d = new Date(form.TransDt);
    if (isNaN(d.getTime())) return '';
    return `${MONTH_SHORT[d.getMonth()]}${String(d.getFullYear()).slice(-2)}`;
  }, [form.TransDt]); // eslint-disable-line

  const selParty = useMemo(
    () => parties.find((p) => p.pkPartyID === form.fkPartyID)
      || (isEdit && form.pName ? { pkPartyID: form.fkPartyID, pName: form.pName, pCode: '', fkCompID: '' } : null),
    [parties, form.fkPartyID, form.pName, isEdit]
  );

  // ── Generic helpers ───────────────────────────────────────────────────────
  const f      = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const fUpper = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value.toUpperCase() }));
  const fCheck = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.checked }));
  const fFlag  = (k) => (e) => setFlags((p) => ({ ...p, [k]: e.target.checked }));

  // ── Hamali amount ↔ rate (bidirectional, PT/PP aware) ────────────────────
  const handleHmlAmount = (amtKey, rateKey) => (e) => {
    const val      = e.target.value;
    const packWght = parseFloat(form.PackWght) || 0;
    const isPT     = hamaliRates.ct === 'PT';
    const divisor  = isPT ? (totalQty * packWght) / 1000 : totalQty;
    const rate     = val !== '' && divisor > 0 ? (parseFloat(val) / divisor).toFixed(2) : '';
    setForm((p) => ({ ...p, [amtKey]: val }));
    setHamaliRates((p) => ({ ...p, [rateKey]: rate }));
  };
  const handleHmlRate = (amtKey, rateKey) => (e) => {
    const val      = e.target.value;
    const packWght = parseFloat(form.PackWght) || 0;
    const isPT     = hamaliRates.ct === 'PT';
    const factor   = isPT ? (totalQty * packWght) / 1000 : totalQty;
    const amt      = val !== '' && factor > 0 ? (parseFloat(val) * factor).toFixed(2) : '';
    setForm((p) => ({ ...p, [amtKey]: amt }));
    setHamaliRates((p) => ({ ...p, [rateKey]: val }));
  };

  // Recalculate rates when TotalQty changes (PT/PP aware)
  useEffect(() => {
    if (totalQty <= 0) { setHamaliRates((p) => ({ ...p, cash: '', labour: '', bill: '' })); return; }
    const packWght = parseFloat(form.PackWght) || 0;
    const isPT     = hamaliRates.ct === 'PT';
    const divisor  = isPT ? (totalQty * packWght) / 1000 : totalQty;
    const rateFrom = (amt) => amt && divisor > 0 ? (parseFloat(amt) / divisor).toFixed(2) : '';
    setHamaliRates((p) => ({
      ...p,
      cash:   rateFrom(form.HamaliRecd),
      labour: rateFrom(form.HamaliAmt),
      bill:   rateFrom(form.HmlBillAmt),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.GodownQty1, form.GodownQty2]);

  // ── Load masters ──────────────────────────────────────────────────────────
  const loadMasters = useCallback(async () => {
    try {
      const [pRes, iRes, gRes] = await Promise.all([
        api.get('/masters/parties/vam'),
        api.get('/masters/items', { params: { slim: 1 } }),
        api.get('/masters/godowns', { params: { slim: 1 } }),
      ]);
      setParties(Array.isArray(pRes.data) ? pRes.data : []);
      setItems(iRes.data.filter((r) => r.Active === 'Y'));
      setGodowns(gRes.data.filter((r) => r.Active === 'Y'));
    } catch {
      setError('Failed to load master data');
    }
    // Packing list loaded separately — failure must not block party/item/godown
    try {
      const pkRes = await api.get('/transactions/arrivals/packing-types');
      setPackings(pkRes.data.length > 0 ? pkRes.data : DEFAULT_PACKINGS);
    } catch { setPackings(DEFAULT_PACKINGS); }
  }, []);

  // ── Load existing record ──────────────────────────────────────────────────
  const loadRecord = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/transactions/arrivals/${id}`);
      const tq = (parseFloat(data.GodownQty1) || 0) + (parseFloat(data.GodownQty2) || 0);
      setForm({
        TransType:      data.TransType      || 'ARV',
        TransDt:        data.TransDt ? String(data.TransDt).slice(0, 10) : '',
        TransTm:        data.TransTm ? new Date(data.TransTm).toTimeString().slice(0, 5) : '',
        fkPartyID:      data.fkPartyID      || '',
        pName:          data.pName          || '',
        LotNum:         data.LotNum         || '',
        pfkLotID:       data.pfkLotID       || '',
        pfkOriLotID:    data.pfkOriLotID    || '',
        fkItemID:       data.fkItemID       || '',
        ItemExtDesc:    data.ItemExtDesc    || '',
        OwnTransFlg:    data.OwnTransFlg    === 'Y',
        DoNum:          data.DoNum          || '',
        Billable:       data.LotBillFlg     || 'Y',
        fkGodownID1:    data.fkGodownID1    || '',
        GodownQty1:     data.GodownQty1     || '',
        fkGodownID2:    data.fkGodownID2    || '',
        GodownQty2:     data.GodownQty2     || '',
        Packing:        data.Packing        || '',
        PackingType:    data.PackingType    || '',
        PackingColour:  data.PackingColour  || '',
        PackWght:       data.PackWght       || '',
        GrossWght:      data.GrossWght      || '',
        ActualWght:     data.ActualWght     || '',
        RentRate:       data.RentRate       || '',
        VehiNum:        data.VehiNum        || '',
        BENum:          data.BENum          || '',
        ItemRate:       data.ItemRate       || '',
        TransExtDetail: data.TransExtDetail || '',
        HamaliRecd:     data.HamaliRecd     || '',
        HamaliAmt:      data.HamaliAmt      || '',
        HmlBillAmt:     data.HmlBillAmt     || '',
        OtherHmlAmt:    data.OtherHmlAmt    || '',
        OutsideLabr:    data.OutsideLabr    === 'Y',
        TransRemark:    data.TransRemark    || '',
        BatchNum:       data.BatchNum       || '',
        TransNote:      data.TransNote      || '',
      });
      if (data.TransType !== 'ARV' && data.ArvTransDt)
        setArvTransDt(String(data.ArvTransDt).slice(0, 10));
      if (data.HamaliCode) setFlags(flagsFromCode(data.HamaliCode));
      if (tq > 0) {
        setHamaliRates({
          cash:   data.HamaliRecd  ? (parseFloat(data.HamaliRecd)  / tq).toFixed(2) : '',
          labour: data.HamaliAmt   ? (parseFloat(data.HamaliAmt)   / tq).toFixed(2) : '',
          bill:   data.HmlBillAmt  ? (parseFloat(data.HmlBillAmt)  / tq).toFixed(2) : '',
        });
      }
      setLocBatches(
        Array.isArray(data.locBatches) && data.locBatches.length > 0
          ? data.locBatches.map((r) => ({
              fkGodownID:   r.fkGodownID   || '',
              fkLocationID: r.fkLocationID || '',
              locationCode: r.LocationCode || '',
              batchNum:     r.BatchNum     || '',
              qty:          String(Math.abs(parseFloat(r.Qty) || 0)),
              remark:       r.Remark       || '',
            }))
          : [{ fkGodownID: '', fkLocationID: '', locationCode: '', batchNum: '', qty: '', remark: '' }]
      );
      // Reload packing types scoped to the record's company (cross-company support)
      try {
        const params = data.fkCompID ? { partyCompID: data.fkCompID } : {};
        const pkRes  = await api.get('/transactions/arrivals/packing-types', { params });
        setPackings(pkRes.data.length > 0 ? pkRes.data : DEFAULT_PACKINGS);
      } catch { setPackings(DEFAULT_PACKINGS); }
    } catch {
      setError('Failed to load entry');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadMasters(); loadRecord(); }, [loadMasters, loadRecord]);

  // Paste image from clipboard — shared handler used by both the paste zone and window listener
  // Falls back to clipboardData.files for older browsers (Win7 Chrome/Firefox)
  const handleDocPaste = useCallback((e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const items = Array.from(cd.items || []);
    const imgItem = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    const file = imgItem
      ? imgItem.getAsFile()
      : Array.from(cd.files || []).find((f) => f.type.startsWith('image/')) || null;
    if (!file) return;
    e.preventDefault();
    const preview = URL.createObjectURL(file);
    setAttachments((prev) => [...prev, { file, preview, isPdf: false }]);
  }, []);

  // Window-level paste listener scoped to the paste zone (fixes Win7 Chrome 109
  // where paste events don't fire on plain divs even with tabIndex=0).
  useEffect(() => {
    function onWindowPaste(e) {
      if (document.activeElement !== pasteZoneRef.current) return;
      handleDocPaste(e);
    }
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [handleDocPaste]);

  // Revoke blob preview URLs when component unmounts or attachments cleared
  useEffect(() => {
    return () => { attachments.forEach((a) => a.preview && URL.revokeObjectURL(a.preview)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load already-saved docs in edit mode
  useEffect(() => {
    if (!isEdit || !id || !faYearFull) return;
    api.get('/uploads/arrival', { params: { transID: id, faYear: faYearFull } })
      .then(({ data }) => setSavedDocs(data))
      .catch(() => {});
  }, [isEdit, id, faYearFull]);

  // Load saved stock photos in edit mode
  useEffect(() => {
    if (!isEdit || !form.LotNum || !faYearFull || !monthYear) return;
    api.get('/uploads/stock-photos', { params: { lotNum: form.LotNum, faYear: faYearFull, monthYear } })
      .then(({ data }) => setStockPhotos(data))
      .catch(() => {});
  }, [isEdit, form.LotNum, faYearFull, monthYear]);

  // ── Sync selPartyCompID when party selection or parties list changes ─────
  useEffect(() => {
    if (!form.fkPartyID) { setSelPartyCompID(''); return; }
    const found = parties.find((p) => p.pkPartyID === form.fkPartyID);
    if (found) setSelPartyCompID(found.fkCompID || '');
  }, [form.fkPartyID, parties]);

  // ── Party → load linked godowns (used to filter Godown 1/2 dropdown) ─────
  // Fetches party-godown-links for the selected party; slim bypass skips MASTERS.CanView.
  // null = not loaded yet, [] = no links (fall back to all godowns), [...] = linked IDs
  useEffect(() => {
    if (!form.fkPartyID) { setLinkedGIDs(null); return; }
    api.get('/masters/party-godown-links', { params: { partyID: form.fkPartyID, slim: 1 } })
      .then(({ data }) => setLinkedGIDs(Array.isArray(data) ? data.map((r) => r.fkGodownID) : []))
      .catch(() => setLinkedGIDs([]));
  }, [form.fkPartyID]);

  // ── Lot list for non-ARV (after party or transType changes) ──────────────
  useEffect(() => {
    if (!form.fkPartyID || form.TransType === 'ARV' || !form.TransDt) {
      setLotOptions([]);
      return;
    }
    api.get('/transactions/arrivals/lot-list', {
      params: { partyID: form.fkPartyID, transType: form.TransType, transDate: form.TransDt, partyCompID: selPartyCompID },
    })
      .then(({ data }) => setLotOptions(data))
      .catch((err) => { console.error('lot-list failed:', err.response?.data || err.message); setLotOptions([]); });
  }, [form.fkPartyID, form.TransType, form.TransDt]);

  // ── Last lot (for ARV reference display) ─────────────────────────────────
  useEffect(() => {
    if (!form.fkPartyID || form.TransType !== 'ARV') { setLastLotNum(''); return; }
    api.get('/transactions/arrivals/last-lot', { params: { partyID: form.fkPartyID, partyCompID: selPartyCompID } })
      .then(({ data }) => setLastLotNum(data.LotNum || ''))
      .catch(() => setLastLotNum(''));
  }, [form.fkPartyID, form.TransType]);

  // ── Party + Item → billable ───────────────────────────────────────────────
  useEffect(() => {
    if (!form.fkPartyID || !form.fkItemID) return;
    api.get('/transactions/arrivals/billable', {
      params: { partyID: form.fkPartyID, itemID: form.fkItemID, partyCompID: selPartyCompID },
    }).then(({ data }) => {
      setPartyInfo({ pCode: data.pCode, pLotType: data.pLotType });
      setIType(data.iType);
      setBillableEditable(data.editable);
      if (!data.editable) setForm((p) => ({ ...p, Billable: data.value }));
    }).catch(() => {});
  }, [form.fkPartyID, form.fkItemID]);

  // ── RentRate auto-calc on PackWght blur (ARV only) ───────────────────────
  // weight is passed directly from e.target.value to avoid stale closure on form.PackWght
  const calcRentRate = useCallback(async (weight) => {
    if (form.TransType !== 'ARV') return;
    if (!form.fkPartyID || !form.Packing || !weight) return;
    try {
      const { data } = await api.get('/transactions/arrivals/rate', {
        params: {
          partyID:     form.fkPartyID,
          packing:     form.Packing,
          weight,
          transDate:   form.TransDt,
          partyCompID: selPartyCompID,
        },
      });
      if (data.BillRate) setForm((p) => ({ ...p, RentRate: String(data.BillRate) }));
    } catch {}
  }, [form.TransType, form.fkPartyID, form.Packing, form.TransDt, selPartyCompID]);

  // ── Hamali rate auto-calc when checkboxes change ──────────────────────────
  // BillRate / LabourRate from RateChart are per-unit rates; Amount = Rate × totalQty.
  // CR is the only code where LabourRate goes into the cash (HamaliRecd) field.
  // All other labour-enabled codes put LabourRate into the labour (HamaliAmt) field.
  const calcHamaliRate = useCallback(async (code) => {
    if (!form.fkPartyID || !code || code === 'NO') return;
    const fields   = HAMALI_FIELDS[code] || HAMALI_FIELDS.CR;
    const cashOnly = fields.cash && !fields.labour; // true only for CR
    try {
      const { data } = await api.get('/transactions/arrivals/hamali-rate', {
        params: {
          partyID:     form.fkPartyID,
          packing:     form.Packing,
          weight:      form.PackWght,
          hamaliCode:  code,
          transType:   form.TransType,
          transDate:   form.TransDt,
          partyCompID: selPartyCompID,
        },
      });
      const tq       = totalQty;
      const packWght = parseFloat(form.PackWght) || 0;
      const ct       = data.ChargeType || '';
      // PP: Amount = Rate × Qty; PT: Amount = ((Qty × PackWght) / 1000) × Rate
      const calcAmt  = (rate) => {
        if (tq <= 0 || !rate) return '';
        return ct === 'PT'
          ? ((tq * packWght / 1000) * rate).toFixed(2)
          : (rate * tq).toFixed(2);
      };
      const newRates = { chargeType: data.ChargeTypeLabel || ct, ct };
      const newForm  = {};

      if (data.LabourRate) {
        const r = parseFloat(data.LabourRate);
        if (cashOnly) {
          newRates.cash      = String(r);
          newForm.HamaliRecd = calcAmt(r);
        } else if (fields.labour) {
          newRates.labour   = String(r);
          newForm.HamaliAmt = calcAmt(r);
        }
      }
      if (data.BillRate && fields.bill) {
        const r = parseFloat(data.BillRate);
        newRates.bill      = String(r);
        newForm.HmlBillAmt = calcAmt(r);
      }

      if (Object.keys(newRates).length) setHamaliRates((p) => ({ ...p, ...newRates }));
      if (Object.keys(newForm).length)  setForm((p) => ({ ...p, ...newForm }));
    } catch {}
  }, [form.fkPartyID, form.Packing, form.PackWght, form.TransType, form.TransDt, totalQty, selPartyCompID]);

  const prevCode = useRef('');
  useEffect(() => {
    const code = deriveHamaliCode(flags, form.HamaliRecd);
    if (code !== prevCode.current) {
      prevCode.current = code;
      calcHamaliRate(code);
    }
  }, [flags, form.HamaliRecd, calcHamaliRate]);

  // ── Lot selection for non-ARV (auto-fills item + packing details) ─────────
  function handleLotSelect(lot) {
    if (!lot) {
      setForm((p) => ({ ...p, LotNum: '', pfkLotID: '', pfkOriLotID: '', fkItemID: '', fkGodownID1: '', fkGodownID2: '', RentRate: '' }));
      setArvTransDt('');
      return;
    }
    setArvTransDt(lot.ArvTransDt ? String(lot.ArvTransDt).slice(0, 10) : '');
    setForm((p) => ({
      ...p,
      LotNum:        lot.LotNum,
      pfkLotID:      lot.pfkLotID,
      pfkOriLotID:   lot.pfkOriLotID || lot.pfkLotID,
      fkItemID:      lot.fkItemID      || '',
      PackWght:      lot.PackWght  != null ? String(lot.PackWght)  : '',
      Packing:       lot.Packing       || '',
      PackingType:   lot.PackingType   || '',
      PackingColour: lot.PackingColour || '',
      fkGodownID1:   lot.fkGodownID1   || '',
      fkGodownID2:   lot.fkGodownID2   || '',
      RentRate:      lot.RentRate != null ? String(lot.RentRate) : '',
    }));
  }

  // ── File attachment helpers ───────────────────────────────────────────────
  function handleFileChange(e) {
    const files = Array.from(e.target.files);
    const newAtts = files.map((file) => ({
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      isPdf:   file.type === 'application/pdf',
    }));
    setAttachments((prev) => [...prev, ...newAtts]);
    e.target.value = '';
  }

  function removeAttachment(idx) {
    setAttachments((prev) => {
      const a = prev[idx];
      if (a.preview) URL.revokeObjectURL(a.preview);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function deleteSavedDoc(filename) {
    if (!window.confirm(`Delete "${filename}" permanently from the server?`)) return;
    try {
      await api.delete('/uploads/arrival', { params: { transID: id, faYear: faYearFull, filename } });
      setSavedDocs((prev) => prev.filter((d) => d.filename !== filename));
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to delete document');
    }
  }

  async function uploadFiles(transID) {
    for (const att of attachments) {
      const fd = new FormData();
      const ext = att.isPdf ? '.pdf' : (att.file.type === 'image/png' ? '.png' : '.jpg');
      fd.append('file', att.file, `${transID}${ext}`);
      fd.append('transID', transID);
      fd.append('faYear', faYearFull);
      await api.post('/uploads/arrival', fd);
    }
  }

  // ── Stock photo helpers ───────────────────────────────────────────────────
  function handlePhotoChange(e) {
    const files = Array.from(e.target.files);
    const newPhotos = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setPendingPhotos((prev) => [...prev, ...newPhotos]);
    e.target.value = '';
  }

  function removePendingPhoto(idx) {
    setPendingPhotos((prev) => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function deleteStockPhoto(photo) {
    try {
      await api.delete('/uploads/stock-photos', {
        params: { lotNum: form.LotNum, faYear: faYearFull, monthYear, filename: photo.filename },
      });
      setStockPhotos((prev) => prev.filter((p) => p.filename !== photo.filename));
    } catch {}
  }

  // ── Insurance status check (PartyGodownLink, LinkType='I') ──────────────
  async function checkIns(slot, godownID) {
    if (!form.fkPartyID || !godownID || !form.TransDt) {
      setInsStatus((p) => ({ ...p, [slot]: null }));
      return;
    }
    try {
      const { data } = await api.get('/transactions/arrivals/insurance-check', {
        params: { partyID: form.fkPartyID, godownID, transDate: form.TransDt, partyCompID: selPartyCompID },
      });
      setInsStatus((p) => ({ ...p, [slot]: data.status }));
    } catch {
      setInsStatus((p) => ({ ...p, [slot]: null }));
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSubmitted(true);
    if (!form.TransType || !form.TransDt || !form.fkPartyID || !form.fkItemID) {
      setError('Transaction Type, Date, Party and Item are required'); return;
    }
    if (form.TransType !== 'ARV' && arvTransDt && form.TransDt < arvTransDt) {
      setError(`Date cannot be before the Arrival date (${arvTransDt})`); return;
    }
    if (!form.DoNum) { setError('Do Number is required'); return; }
    if (!form.Packing) { setError('Packing is required'); return; }
    if (!form.PackWght) { setError('Net Weight is required'); return; }
    if (!form.RentRate) { setError('Rent Rate is required'); return; }
    if (!form.fkGodownID1 || !form.GodownQty1) {
      setError('Godown 1 and Quantity 1 are required'); return;
    }
    if (form.fkGodownID2 && form.fkGodownID1 === form.fkGodownID2) {
      setError('Godown 1 and Godown 2 cannot be the same'); return;
    }

    // Hamali is compulsory: either "No Entry" is checked, or all enabled amount fields must be filled.
    if (!flags.noEntry) {
      const missing = [];
      if (hmlFields.cash   && !form.HamaliRecd) missing.push('Cash Received');
      if (hmlFields.labour && !form.HamaliAmt)  missing.push('Labour Amount');
      if (hmlFields.bill   && !form.HmlBillAmt) missing.push('Bill Amount');
      if (missing.length > 0) {
        setError(`Hamali required: check "No Entry" or fill — ${missing.join(', ')}`);
        return;
      }
    }

    // Batch Detail grid is compulsory — at least one row with Batch No, Location and Qty
    const activeLocRows = locBatches.filter((r) => r.batchNum?.trim() || r.fkLocationID || parseFloat(r.qty) > 0);
    if (activeLocRows.length === 0) {
      setError('Batch Detail is required. Enter at least one row with Batch No., Location and Qty.'); return;
    }
    const badRow = activeLocRows.find((r) => !r.batchNum?.trim() || !r.fkLocationID || !parseFloat(r.qty));
    if (badRow) { setError('Each Batch Detail row must have Batch No., Location and Qty'); return; }
    const locTotal = activeLocRows.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0);
    if (Math.abs(locTotal - totalQty) >= 0.01) {
      setError(`Batch Detail total (${locTotal}) must match Total Qty (${totalQty})`); return;
    }

    setSaving(true); setError('');
    try {
      // Derive BatchNum from the locBatch grid rows as "BatchNo - LocationCode - Qty", one per line.
      const gridBatchNum = activeLocRows.length > 0
        ? activeLocRows
            .filter((r) => r.batchNum)
            .map((r) => [r.batchNum, r.locationCode, r.qty].filter(Boolean).join(' - '))
            .join('\n')
        : '';

      // Zero out hamali amounts whose fields are disabled — they may hold stale auto-filled
      // values from a previous hamali code and should not be saved when hidden/disabled.
      const payload = {
        ...form,
        BatchNum:    gridBatchNum || form.BatchNum || '',
        HamaliRecd:  hmlFields.cash   ? form.HamaliRecd  : 0,
        HamaliAmt:   hmlFields.labour ? form.HamaliAmt   : 0,
        HmlBillAmt:  hmlFields.bill   ? form.HmlBillAmt  : 0,
        hamaliFlags:  flags,
        OwnTransFlg:  form.OwnTransFlg ? 'Y' : 'N',
        OutsideLabr:  form.OutsideLabr,
        Billable:     form.Billable,
        pfkLotID:     form.pfkLotID,
        partyCompID:  selPartyCompID,
        locBatches:   activeLocRows,
      };
      const saveRes = isEdit
        ? await api.put(`/transactions/arrivals/${id}`, payload)
        : await api.post('/transactions/arrivals', payload);

      const lotNum  = saveRes.data?.LotNum  || form.LotNum;
      const transID = saveRes.data?.pkTransID || id;
      if (attachments.length > 0 && transID) await uploadFiles(transID);
      if (pendingPhotos.length > 0 && lotNum) {
        const fd = new FormData();
        pendingPhotos.forEach((p) => fd.append('photos', p.file));
        fd.append('lotNum', lotNum);
        fd.append('faYear', faYearFull);
        fd.append('monthYear', monthYear);
        await api.post('/uploads/stock-photos', fd);
        setPendingPhotos([]);
      }
      setEmailDialog({
        open:       true,
        transID,
        partyCompID: selPartyCompID,
        pName:  selParty?.pName || form.pName || '',
        lotNum,
        qty:    totalQty,
        packing: form.Packing || '',
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleSendEmail() {
    setEmailSending(true);
    try {
      await api.post(`/transactions/arrivals/${emailDialog.transID}/email`, {
        partyCompID: emailDialog.partyCompID,
      });
      setEmailSnack({ open: true, msg: 'Arrival note sent successfully', severity: 'success' });
    } catch (err) {
      setEmailSnack({ open: true, msg: err.response?.data?.error || 'Failed to send email', severity: 'error' });
    } finally {
      setEmailSending(false);
      setEmailDialog((p) => ({ ...p, open: false }));
      navigate('/transactions/arrivals');
    }
  }

  function handleSkipEmail() {
    setEmailDialog((p) => ({ ...p, open: false }));
    navigate('/transactions/arrivals');
  }

  async function handlePrintNote() {
    try {
      const res = await api.get(`/transactions/arrivals/${id}/note`, {
        params:       { partyCompID: selPartyCompID },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
    } catch {
      setError('Failed to generate arrival note');
    }
  }

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;

  // Shared props for MenuItem-based selects
  const selectProps = {
    size: 'small', slotProps: { inputLabel: { shrink: true } },
    SelectProps: { MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } },
  };

  // Shared slotProps for all Autocomplete components
  // paper: expands to fit widest option; listbox li: never wraps text
  const acSlotProps = {
    paper:   { sx: { minWidth: 'fit-content' } },
    listbox: { sx: { '& li': { whiteSpace: 'nowrap' } } },
  };

  // Renders the Autocomplete input; Tooltip shows full selected value when text is truncated
  const acInput = (label, extra) => (params) => (
    <Tooltip
      title={params.inputProps?.value || ''}
      placement="bottom-start"
      arrow
      disableHoverListener={!params.inputProps?.value}
      enterDelay={600}
    >
      <TextField {...params} label={label} {...extra} />
    </Tooltip>
  );

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/transactions/arrivals')} sx={{ mr: 2 }}>Back</Button>
        <LocalShippingIcon color="primary" sx={{ mr: 1 }} />
        <Typography variant="h6" fontWeight={600}>
          {isEdit ? 'Edit Entry' : 'New Entry'}
        </Typography>
        {form.LotNum && (
          <Chip label={form.LotNum} color="error" size="small" sx={{ ml: 2, fontWeight: 700, letterSpacing: 1 }} />
        )}
        {isEdit && (
          <Tooltip title="Print Arrival Note">
            <Button
              size="small"
              variant="outlined"
              startIcon={<PictureAsPdfIcon />}
              onClick={handlePrintNote}
              sx={{ ml: 'auto' }}
            >
              Print Note
            </Button>
          </Tooltip>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper elevation={1} sx={{ p: 3 }}>
        <Stack spacing={1.5}>

          {/* Row 0: Type | Date | Time | Financial Year */}
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <TextField label="Type *" select size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}
              sx={{ minWidth: 120 }}
              value={form.TransType} onChange={f('TransType')} disabled={isEdit}>
              {TRANS_TYPES.map((t) => <MenuItem key={t.value} value={t.value} sx={{ whiteSpace: 'nowrap' }}>{t.label}</MenuItem>)}
            </TextField>
            <TextField label="Date *" type="date" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 150 }}
              value={form.TransDt} onChange={f('TransDt')} />
            <TextField label="Time" type="time" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 130 }}
              value={form.TransTm} onChange={f('TransTm')} />
            <TextField label="Financial Year" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 140, '& .MuiInputBase-input': { color: '#1565C0', fontWeight: 600 } }}
              value={faYearDisplay} InputProps={{ readOnly: true }} />
          </Stack>

          {/* Row 1: Party | Lot No. */}
          <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="flex-start">
            <Box sx={{ minWidth: 300, flexGrow: 2, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Autocomplete size="small" sx={{ flex: 1 }} disabled={isEdit}
                openOnFocus
                autoHighlight
                autoSelect
                options={parties}
                getOptionLabel={(o) => o.pName || ''}
                renderOption={(props, o) => {
                  const { key: _key, ...liProps } = props;
                  return (
                    <li key={`${o.fkCompID}|${o.pkPartyID}`} {...liProps}>
                      <span style={{ fontWeight: 500 }}>{o.pName}</span>
                      {o.pCode && <span style={{ color: '#666', fontSize: 12, marginLeft: 6 }}>({o.pCode})</span>}
                      {o.fkCompID && (
                        <Chip label={o.fkCompID} size="small" variant="outlined"
                          sx={{ ml: 1, height: 18, fontSize: 11, pointerEvents: 'none' }} />
                      )}
                    </li>
                  );
                }}
                value={selParty}
                onChange={(_, v) => {
                  setForm((p) => ({ ...p, fkPartyID: v ? v.pkPartyID : '', LotNum: '', pfkLotID: '', pfkOriLotID: '' }));
                  setSelPartyCompID(v ? (v.fkCompID || '') : '');
                  setInsStatus({ g1: null, g2: null });
                }}
                slotProps={acSlotProps}
                renderInput={acInput('Party Name *', {
                  helperText: selParty
                    ? `${selParty.pCode || ''}${selParty.fkCompID ? '  |  ' + selParty.fkCompID : ''}`
                    : ' ',
                })}
                isOptionEqualToValue={(o, v) => o.pkPartyID === v.pkPartyID}
                filterOptions={(opts, { inputValue }) => {
                  const q = inputValue.toLowerCase();
                  return opts.filter((o) =>
                    (o.pName    || '').toLowerCase().includes(q) ||
                    (o.pCode    || '').toLowerCase().includes(q) ||
                    (o.fkCompID || '').toLowerCase().includes(q)
                  );
                }}
              />
              {selPartyCompID && (
                <Chip label={selPartyCompID} size="small" color="primary" variant="outlined"
                  sx={{ mt: 1, fontWeight: 700, letterSpacing: 1 }} />
              )}
            </Box>
            <Box sx={{ minWidth: 200, flexGrow: 1 }}>
              {form.TransType === 'ARV' ? (
                <TextField label="Lot No. (auto)" size="small" fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={isEdit ? form.LotNum : '(generated on save)'}
                  InputProps={{ readOnly: true }}
                  helperText={lastLotNum ? `Last: ${lastLotNum}` : ''}
                  sx={{ '& .MuiInputBase-input': { color: '#C62828', fontWeight: 700, letterSpacing: 1 } }} />
              ) : (
                <Autocomplete size="small" fullWidth disabled={isEdit}
                  options={lotOptions}
                  getOptionLabel={(o) => `${o.LotNum} | ${o.iName} [Bal: ${o.BalQty}]`}
                  value={lotOptions.find((l) => l.pfkLotID === form.pfkLotID) || null}
                  onChange={(_, v) => handleLotSelect(v)}
                  slotProps={acSlotProps}
                  renderInput={acInput('Lot No. *', { helperText: !form.fkPartyID ? 'Select Party first' : '' })}
                  isOptionEqualToValue={(o, v) => o.pfkLotID === v.pfkLotID}
                  noOptionsText="No open lots for this party"
                />
              )}
            </Box>
          </Stack>

          {/* Row 2: Item | Item Extra Description */}
          <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="flex-start">
            <Autocomplete size="small" sx={{ minWidth: 300, flexGrow: 2 }} disabled={form.TransType !== 'ARV'}
              autoHighlight
              autoSelect
              options={items}
              getOptionLabel={(o) => o.iName || ''}
              value={items.find((i) => i.pkItemID === form.fkItemID) || null}
              onChange={(_, v) => setForm((p) => ({ ...p, fkItemID: v ? v.pkItemID : '' }))}
              slotProps={acSlotProps}
              renderInput={acInput('Item *')}
              isOptionEqualToValue={(o, v) => o.pkItemID === v.pkItemID}
            />
            <TextField label="Item Extra Description" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 200, flexGrow: 1 }}
              value={form.ItemExtDesc} onChange={f('ItemExtDesc')} />
          </Stack>

          {/* Row 3: Transport By Us | Do No. | Billable */}
          <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
            <FormControlLabel
              control={<Checkbox checked={form.OwnTransFlg} onChange={fCheck('OwnTransFlg')} />}
              label="Transport By Us"
            />
            <TextField label="Do No. *" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 160, flexGrow: 1 }}
              value={form.DoNum} onChange={fUpper('DoNum')}
              error={!form.DoNum && saving} />
            <FormControlLabel
              control={
                <Checkbox checked={form.Billable === 'Y'}
                  disabled={!billableEditable || form.TransType !== 'ARV'}
                  onChange={(e) => setForm((p) => ({ ...p, Billable: e.target.checked ? 'Y' : 'N' }))} />
              }
              label={`Billable  [${partyInfo.pLotType || '—'} / ${iType || '—'}]`}
            />
          </Stack>

          <Divider />

          {/* Row 4: Godown1 | Qty1 | Godown2 | Qty2 | Total Qty */}
          <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="flex-start">
            <Autocomplete size="small"
              sx={{
                minWidth: 160, flexGrow: 1,
                ...(insStatus.g1 === 'insured' && {
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#43a047', borderWidth: 2 },
                    boxShadow: '0 0 10px 3px rgba(76,175,80,0.45)',
                    borderRadius: '4px',
                  },
                }),
                ...(insStatus.g1 === 'not_insured' && {
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#d32f2f', borderWidth: 2 },
                    borderRadius: '4px',
                  },
                }),
              }}
              autoHighlight
              autoSelect
              options={godownOpts}
              getOptionLabel={(o) => o.gNum || ''}
              value={godowns.find((g) => g.pkGodownID === form.fkGodownID1) || null}
              onChange={(_, v) => {
                setForm((p) => ({ ...p, fkGodownID1: v ? v.pkGodownID : '' }));
                checkIns('g1', v ? v.pkGodownID : null);
              }}
              slotProps={acSlotProps}
              renderInput={acInput('Godown 1 *', {
                helperText: insStatus.g1 === 'insured'     ? 'Insured'
                          : insStatus.g1 === 'not_insured' ? 'Not Insured'
                          : '',
                FormHelperTextProps: insStatus.g1 === 'insured' ? {
                  sx: { color: '#66bb6a', fontWeight: 700, textShadow: '0 0 8px rgba(102,187,106,0.95)' },
                } : insStatus.g1 === 'not_insured' ? {
                  sx: { color: '#d32f2f', fontWeight: 700 },
                } : undefined,
              })}
              isOptionEqualToValue={(o, v) => o.pkGodownID === v.pkGodownID}
            />
            <TextField label="Qty 1 *" type="number" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 100, flexGrow: 1, ...NUM_SX }}
              onWheel={blurOnWheel}
              value={form.GodownQty1} onChange={f('GodownQty1')} />
            <Autocomplete size="small"
              sx={{
                minWidth: 160, flexGrow: 1,
                ...(insStatus.g2 === 'insured' && {
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#43a047', borderWidth: 2 },
                    boxShadow: '0 0 10px 3px rgba(76,175,80,0.45)',
                    borderRadius: '4px',
                  },
                }),
                ...(insStatus.g2 === 'not_insured' && {
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': { borderColor: '#d32f2f', borderWidth: 2 },
                    borderRadius: '4px',
                  },
                }),
              }}
              autoHighlight
              autoSelect
              options={godownOpts}
              getOptionLabel={(o) => o.gNum || ''}
              value={godowns.find((g) => g.pkGodownID === form.fkGodownID2) || null}
              onChange={(_, v) => {
                setForm((p) => ({ ...p, fkGodownID2: v ? v.pkGodownID : '' }));
                checkIns('g2', v ? v.pkGodownID : null);
              }}
              slotProps={acSlotProps}
              renderInput={acInput('Godown 2', {
                helperText: insStatus.g2 === 'insured'     ? 'Insured'
                          : insStatus.g2 === 'not_insured' ? 'Not Insured'
                          : '',
                FormHelperTextProps: insStatus.g2 === 'insured' ? {
                  sx: { color: '#66bb6a', fontWeight: 700, textShadow: '0 0 8px rgba(102,187,106,0.95)' },
                } : insStatus.g2 === 'not_insured' ? {
                  sx: { color: '#d32f2f', fontWeight: 700 },
                } : undefined,
              })}
              isOptionEqualToValue={(o, v) => o.pkGodownID === v.pkGodownID}
            />
            <TextField label="Qty 2" type="number" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 100, flexGrow: 1, ...NUM_SX }}
              onWheel={blurOnWheel}
              value={form.GodownQty2} onChange={f('GodownQty2')} />
            <TextField label="Total Qty" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 100, '& .MuiInputBase-input': { fontWeight: 700 } }}
              value={totalQty > 0 ? totalQty : ''}
              InputProps={{ readOnly: true }} />
          </Stack>

          {/* Location / Batch grid — additive, does not affect existing godown/qty fields */}
          {activeGodownOptions.length > 0 && (
            <LocBatchGrid
              rows={locBatches}
              onChange={setLocBatches}
              godownOptions={activeGodownOptions}
              targetTotalQty={totalQty}
              submitted={submitted}
            />
          )}

          {/* Row 5: Packing | Packing Type | Packing Colour */}
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <TextField label="Packing *" select size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}
              sx={{ minWidth: 180, flexGrow: 1 }}
              value={form.Packing} onChange={f('Packing')}
              error={!form.Packing && submitted}>
              <MenuItem value=""><em>(Select)</em></MenuItem>
              {packings.map((p) => (
                <MenuItem key={p.VCData} value={p.VCData} sx={{ whiteSpace: 'nowrap' }}>{p.VCData}</MenuItem>
              ))}
            </TextField>
            <TextField label="Packing Type" select size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}
              sx={{ minWidth: 180, flexGrow: 1 }}
              value={form.PackingType} onChange={f('PackingType')}>
              <MenuItem value=""><em>(Select)</em></MenuItem>
              {PACK_TYPES.map((t) => <MenuItem key={t} value={t} sx={{ whiteSpace: 'nowrap' }}>{t}</MenuItem>)}
            </TextField>
            <TextField label="Packing Colour" select size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}
              sx={{ minWidth: 180, flexGrow: 1 }}
              value={form.PackingColour} onChange={f('PackingColour')}>
              <MenuItem value=""><em>(Select)</em></MenuItem>
              {PACK_COLOURS.map((c) => <MenuItem key={c} value={c} sx={{ whiteSpace: 'nowrap' }}>{c}</MenuItem>)}
            </TextField>
          </Stack>

          {/* Row 6: Net Weight | Gross Weight | Actual Weight | Rent Rate */}
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <TextField label="Net Weight *" type="number" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 140, flexGrow: 1, ...NUM_SX }}
              onWheel={blurOnWheel}
              value={form.PackWght} onChange={f('PackWght')} onBlur={(e) => calcRentRate(e.target.value)}
              error={!form.PackWght && saving} />
            <TextField label="Gross Weight" type="number" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 140, flexGrow: 1, ...NUM_SX }}
              onWheel={blurOnWheel}
              value={form.GrossWght} onChange={f('GrossWght')} />
            <TextField label="Actual Weight" type="number" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 140, flexGrow: 1, ...NUM_SX }}
              onWheel={blurOnWheel}
              value={form.ActualWght} onChange={f('ActualWght')} />
            <TextField label="Rent Rate *" type="number" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 140, flexGrow: 1, ...NUM_SX }}
              onWheel={blurOnWheel}
              value={form.RentRate} onChange={f('RentRate')}
              error={!form.RentRate && saving} />
          </Stack>

          {/* Row 7: Vehicle No. | Document No. | Item Rate */}
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <TextField label="Vehicle No." size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 160, flexGrow: 1 }}
              value={form.VehiNum} onChange={fUpper('VehiNum')} />
            <TextField label="Document No." size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 160, flexGrow: 1 }}
              value={form.BENum} onChange={f('BENum')} />
            <TextField label="Item Rate" type="number" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 120, flexGrow: 1, ...NUM_SX }}
              onWheel={blurOnWheel}
              value={form.ItemRate} onChange={f('ItemRate')} />
          </Stack>

          {/* Row 8: Supplier Name */}
          <TextField label="Supplier Name" size="small" fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
            value={form.TransExtDetail} onChange={f('TransExtDetail')} />

          {/* Hamali Divider */}
          <Divider>
            <Typography variant="caption" fontWeight={700} color="primary">
              HAMALI / LABOUR &nbsp;|&nbsp; Code:&nbsp;
              <Typography component="span" variant="caption" color="error" fontWeight={800}>
                {hamaliCode}
              </Typography>
              {hamaliRates.chargeType && (
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  ({hamaliRates.chargeType})
                </Typography>
              )}
              {submitted && !flags.noEntry &&
                ((hmlFields.cash && !form.HamaliRecd) ||
                 (hmlFields.labour && !form.HamaliAmt) ||
                 (hmlFields.bill && !form.HmlBillAmt)) && (
                <Typography component="span" variant="caption" color="error" sx={{ ml: 1 }}>
                  ★ Required
                </Typography>
              )}
            </Typography>
          </Divider>

          {/* Hamali checkboxes */}
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <FormControlLabel control={<Checkbox size="small" checked={flags.onAc}    onChange={fFlag('onAc')}    />} label="Party A/C" />
            <FormControlLabel control={<Checkbox size="small" checked={flags.varai}   onChange={fFlag('varai')}   />} label="Varai" />
            <FormControlLabel control={<Checkbox size="small" checked={flags.bankTrf} onChange={fFlag('bankTrf')} />} label="Bank Transfer" />
            <FormControlLabel control={<Checkbox size="small" checked={flags.lbrAmt}  onChange={fFlag('lbrAmt')}  />} label="Labour Amount" />
            <FormControlLabel control={<Checkbox size="small" checked={flags.billChk} onChange={fFlag('billChk')} />} label="Bill Amount" />
            <FormControlLabel control={<Checkbox size="small" checked={flags.noEntry} onChange={fFlag('noEntry')} />} label="No Entry" />
          </Box>

          {/* Hamali amounts: Cash | Labour | Bill */}
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <Box sx={{ display: 'flex', gap: 1, minWidth: 240, flexGrow: 1 }}>
              <TextField label="Cash Received" type="number" size="small" sx={{ flex: 2, ...NUM_SX }}
                onWheel={blurOnWheel}
                value={form.HamaliRecd}
                onChange={handleHmlAmount('HamaliRecd', 'cash')}
                disabled={!hmlFields.cash}
                error={submitted && !flags.noEntry && hmlFields.cash && !form.HamaliRecd} />
              <TextField label="Rate" type="number" size="small" sx={{ flex: 1, ...NUM_SX }}
                onWheel={blurOnWheel}
                value={hamaliRates.cash}
                onChange={handleHmlRate('HamaliRecd', 'cash')}
                disabled={!hmlFields.cash} />
            </Box>
            <Box sx={{ display: 'flex', gap: 1, minWidth: 240, flexGrow: 1 }}>
              <TextField label="Labour Amount" type="number" size="small" sx={{ flex: 2, ...NUM_SX }}
                onWheel={blurOnWheel}
                value={form.HamaliAmt}
                onChange={handleHmlAmount('HamaliAmt', 'labour')}
                disabled={!hmlFields.labour}
                error={submitted && !flags.noEntry && hmlFields.labour && !form.HamaliAmt} />
              <TextField label="Rate" type="number" size="small" sx={{ flex: 1, ...NUM_SX }}
                onWheel={blurOnWheel}
                value={hamaliRates.labour}
                onChange={handleHmlRate('HamaliAmt', 'labour')}
                disabled={!hmlFields.labour} />
            </Box>
            <Box sx={{ display: 'flex', gap: 1, minWidth: 240, flexGrow: 1 }}>
              <TextField label="Bill Amount" type="number" size="small" sx={{ flex: 2, ...NUM_SX }}
                onWheel={blurOnWheel}
                value={form.HmlBillAmt}
                onChange={handleHmlAmount('HmlBillAmt', 'bill')}
                disabled={!hmlFields.bill}
                error={submitted && !flags.noEntry && hmlFields.bill && !form.HmlBillAmt} />
              <TextField label="Rate" type="number" size="small" sx={{ flex: 1, ...NUM_SX }}
                onWheel={blurOnWheel}
                value={hamaliRates.bill}
                onChange={handleHmlRate('HmlBillAmt', 'bill')}
                disabled={!hmlFields.bill} />
            </Box>
          </Stack>

          {/* Outside Labour checkbox + amount */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <FormControlLabel
              control={<Checkbox size="small" checked={form.OutsideLabr} onChange={fCheck('OutsideLabr')} />}
              label="Hamali by Outside Labour"
            />
            {form.OutsideLabr && (
              <TextField label="Outside Labour Amount" type="number" size="small"
                value={form.OtherHmlAmt} onChange={f('OtherHmlAmt')}
                onWheel={blurOnWheel}
                sx={{ width: 220, ...NUM_SX }} />
            )}
          </Box>

          <Divider />

          {/* Row 9: Remarks | Batch No. | Note */}
          <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="flex-start">
            <TextField label="Remarks" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 200, flexGrow: 1 }}
              value={form.TransRemark} onChange={f('TransRemark')} />
            <TextField label="Batch No." size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 200, flexGrow: 1 }}
              multiline rows={3}
              value={form.BatchNum} onChange={f('BatchNum')} />
            <TextField label="Note" size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 200, flexGrow: 1 }}
              multiline rows={3}
              value={form.TransNote} onChange={f('TransNote')} />
          </Stack>

        </Stack>
      </Paper>

      {/* ── 38: Documents panel ── */}
      <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Documents
        </Typography>

        {/* Saved docs (edit mode) */}
        {savedDocs.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
            {savedDocs.map((d) => (
              <Box key={d.filename} sx={{ position: 'relative' }}>
                {d.filename.endsWith('.pdf') ? (
                  <Button size="small" variant="outlined" startIcon={<PictureAsPdfIcon />}
                    component="a" href={`${STATIC_BASE}${d.url}`} target="_blank" rel="noopener">
                    {d.filename}
                  </Button>
                ) : (
                  <Box component="img" src={`${STATIC_BASE}${d.url}`} alt={d.filename}
                    title={d.filename}
                    onClick={() => window.open(`${STATIC_BASE}${d.url}`, '_blank')}
                    sx={{ height: 80, width: 80, objectFit: 'cover', borderRadius: 1,
                      border: '1px solid #ccc', cursor: 'pointer' }} />
                )}
                {isEdit && (
                  <IconButton size="small" onClick={() => deleteSavedDoc(d.filename)}
                    sx={{ position: 'absolute', top: -8, right: -8,
                      bgcolor: 'error.main', color: '#fff', width: 20, height: 20,
                      '&:hover': { bgcolor: 'error.dark' } }}>
                    <CloseIcon sx={{ fontSize: 12 }} />
                  </IconButton>
                )}
              </Box>
            ))}
          </Box>
        )}

        {/* Pending (unsaved) attachments */}
        {attachments.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
            {attachments.map((a, i) => (
              <Box key={i} sx={{ position: 'relative' }}>
                {a.preview ? (
                  <Box component="img" src={a.preview} alt={`attach-${i}`}
                    onClick={() => window.open(a.preview, '_blank')}
                    sx={{ height: 80, width: 80, objectFit: 'cover', borderRadius: 1,
                      border: '2px dashed #1976d2', display: 'block', cursor: 'pointer',
                      '&:hover': { opacity: 0.85 } }} />
                ) : (
                  <Box onClick={() => { const u = URL.createObjectURL(a.file); window.open(u, '_blank'); }}
                    sx={{ height: 80, width: 80, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      border: '2px dashed #1976d2', borderRadius: 1, bgcolor: '#f5f5f5',
                      cursor: 'pointer', '&:hover': { bgcolor: '#e3f2fd' } }}>
                    <PictureAsPdfIcon color="error" />
                    <Typography variant="caption" sx={{ fontSize: 9, textAlign: 'center', px: 0.5 }}>
                      {a.file.name}
                    </Typography>
                  </Box>
                )}
                <IconButton size="small" onClick={() => removeAttachment(i)}
                  sx={{ position: 'absolute', top: -8, right: -8,
                    bgcolor: 'error.main', color: '#fff', width: 20, height: 20,
                    '&:hover': { bgcolor: 'error.dark' } }}>
                  <CloseIcon sx={{ fontSize: 12 }} />
                </IconButton>
              </Box>
            ))}
          </Box>
        )}

        {/* Paste zone — click to focus, then Ctrl+V to paste a screenshot */}
        <Box
          ref={pasteZoneRef}
          tabIndex={0}
          onClick={(e) => e.currentTarget.focus()}
          sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 0.5,
            border: '2px dashed', borderColor: 'divider',
            borderRadius: 1, p: 1.5, mb: 1.5, cursor: 'pointer',
            color: 'text.disabled', outline: 'none', userSelect: 'none',
            transition: 'border-color 0.15s, color 0.15s',
            '&:hover': { borderColor: 'primary.light', color: 'primary.light' },
            '&:focus': { borderColor: 'primary.main', color: 'primary.main', bgcolor: 'action.focus' },
          }}
        >
          <ContentPasteIcon sx={{ fontSize: 28 }} />
          <Typography variant="caption">Click here, then Ctrl+V to paste a screenshot</Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <input type="file" accept="image/*,.pdf" multiple ref={fileInputRef}
            style={{ display: 'none' }} onChange={handleFileChange} />
          <Button variant="outlined" size="small" startIcon={<AttachFileIcon />}
            onClick={() => fileInputRef.current?.click()}>
            Select File(s)
          </Button>
          {attachments.length > 0 && (
            <Typography variant="caption" color="primary" fontWeight={600}>
              {attachments.length} file{attachments.length > 1 ? 's' : ''} ready to upload on Save
            </Typography>
          )}
        </Box>
      </Paper>

      {/* ── Stock Photos panel ── */}
      <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          Stock Photos
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            — Use camera (mobile) or pick from gallery / computer
          </Typography>
        </Typography>

        {/* Saved photos */}
        {stockPhotos.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
            {stockPhotos.map((p) => (
              <Box key={p.filename} sx={{ position: 'relative' }}>
                <Box
                  component="img"
                  src={`${STATIC_BASE}${p.url}`}
                  alt={p.filename}
                  onClick={() => window.open(`${STATIC_BASE}${p.url}`, '_blank')}
                  sx={{ height: 90, width: 90, objectFit: 'cover', borderRadius: 1,
                        border: '1px solid #ccc', cursor: 'pointer',
                        '&:hover': { opacity: 0.85 } }}
                />
                <IconButton size="small" onClick={() => deleteStockPhoto(p)}
                  sx={{ position: 'absolute', top: -8, right: -8,
                        bgcolor: 'error.main', color: '#fff', width: 20, height: 20,
                        '&:hover': { bgcolor: 'error.dark' } }}>
                  <CloseIcon sx={{ fontSize: 12 }} />
                </IconButton>
              </Box>
            ))}
          </Box>
        )}

        {/* Pending (not yet uploaded) photos */}
        {pendingPhotos.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
            {pendingPhotos.map((p, i) => (
              <Box key={i} sx={{ position: 'relative' }}>
                <Box
                  component="img"
                  src={p.preview}
                  alt={`pending-photo-${i}`}
                  onClick={() => window.open(p.preview, '_blank')}
                  sx={{ height: 90, width: 90, objectFit: 'cover', borderRadius: 1,
                        border: '2px dashed #2e7d32', display: 'block', cursor: 'pointer',
                        '&:hover': { opacity: 0.85 } }}
                />
                <IconButton size="small" onClick={() => removePendingPhoto(i)}
                  sx={{ position: 'absolute', top: -8, right: -8,
                        bgcolor: 'error.main', color: '#fff', width: 20, height: 20,
                        '&:hover': { bgcolor: 'error.dark' } }}>
                  <CloseIcon sx={{ fontSize: 12 }} />
                </IconButton>
              </Box>
            ))}
          </Box>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {/* Camera — opens device camera on mobile, file picker on desktop */}
          <input type="file" accept="image/*" capture="environment" multiple
            ref={cameraInputRef} style={{ display: 'none' }} onChange={handlePhotoChange} />
          <Button variant="outlined" size="small" startIcon={<PhotoCameraIcon />}
            onClick={() => cameraInputRef.current?.click()}>
            Camera
          </Button>
          {/* Gallery / file picker */}
          <input type="file" accept="image/*" multiple
            ref={photoInputRef} style={{ display: 'none' }} onChange={handlePhotoChange} />
          <Button variant="outlined" size="small" startIcon={<PhotoLibraryIcon />}
            onClick={() => photoInputRef.current?.click()}>
            Gallery / Computer
          </Button>
          {pendingPhotos.length > 0 && (
            <Typography variant="caption" color="success.main" fontWeight={600}>
              {pendingPhotos.length} photo{pendingPhotos.length > 1 ? 's' : ''} — will upload on Save
            </Typography>
          )}
        </Box>
      </Paper>

      {/* ── 39: Save / Cancel ── */}
      <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
        <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="outlined" onClick={() => navigate('/transactions/arrivals')} disabled={saving}>
          Cancel
        </Button>
      </Box>

      {/* ── Email confirmation dialog ── */}
      <Dialog open={emailDialog.open} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          <EmailIcon sx={{ mr: 1, verticalAlign: 'middle', color: '#1565C0' }} />
          Send Arrival Note
        </DialogTitle>
        <DialogContent>
          <Alert severity="success" sx={{ mb: 2 }}>
            Entry saved successfully!
          </Alert>
          <Box sx={{ mb: 2, p: 1.5, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'grey.200' }}>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              <strong>Party&nbsp;:</strong>&nbsp;{emailDialog.pName}
            </Typography>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              <strong>Lot No.&nbsp;:</strong>&nbsp;{emailDialog.lotNum || '—'}
            </Typography>
            <Typography variant="body2">
              <strong>Quantity&nbsp;:</strong>&nbsp;{emailDialog.qty}&nbsp;{emailDialog.packing}
            </Typography>
          </Box>
          <Typography variant="body2">
            Do you want to send the arrival note email to the party?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleSkipEmail} disabled={emailSending} color="inherit">
            Skip
          </Button>
          <Button
            variant="contained"
            startIcon={emailSending ? <CircularProgress size={16} color="inherit" /> : <EmailIcon />}
            onClick={handleSendEmail}
            disabled={emailSending}
          >
            {emailSending ? 'Sending…' : 'Send Email'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Email result snackbar ── */}
      <Snackbar
        open={emailSnack.open}
        autoHideDuration={4000}
        onClose={() => setEmailSnack((p) => ({ ...p, open: false }))}
        message={emailSnack.msg}
      />
    </Box>
  );
}
