// DispatchFormPage.jsx — Add / Edit Dispatch Entry (DESP / TRF / OUT)
//
// Key differences from Arrival:
//  • Lot selected via popup modal (not Autocomplete) — lot list from vStkTransQty
//  • Godown dropdown shows per-godown balance (from selected lot)
//  • Quantities stored as NEGATIVE in DB; user enters positive values here
//  • Additional fields: DelivOpt, PickupBy (with webcam capture)
//  • Post-save: GatePass PDF dialog → Email dialog
//  • Arrival stock photos shown read-only (cannot add/delete here)
//
// MIGRATION required once on DB:
//   ALTER TABLE tStockEntry ADD COLUMN PickupBy VARCHAR(100) NOT NULL DEFAULT '' AFTER DelivOpt;

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { decodeId } from '../../utils/idCodec';
import {
  Box, Paper, Typography, Button, TextField, MenuItem, Divider,
  Stack, FormControlLabel, Checkbox, Alert, CircularProgress,
  Autocomplete, IconButton, Tooltip, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, Snackbar,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  InputAdornment,
} from '@mui/material';
import ArrowBackIcon     from '@mui/icons-material/ArrowBack';
import SaveIcon          from '@mui/icons-material/Save';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import SearchIcon        from '@mui/icons-material/Search';
import AttachFileIcon    from '@mui/icons-material/AttachFile';
import CloseIcon         from '@mui/icons-material/Close';
import PictureAsPdfIcon  from '@mui/icons-material/PictureAsPdf';
import EmailIcon         from '@mui/icons-material/Email';
import ContentPasteIcon  from '@mui/icons-material/ContentPaste';
import VideocamIcon      from '@mui/icons-material/Videocam';
import DeleteIcon        from '@mui/icons-material/Delete';
import PhotoCameraIcon   from '@mui/icons-material/PhotoCamera';
import PhotoLibraryIcon  from '@mui/icons-material/PhotoLibrary';
import api         from '../../services/api';
import LocBatchGrid from '../../components/LocBatchGrid';

const STATIC_BASE = (import.meta.env.VITE_API_BASE_URL || '/api')
  .replace(/\/api\/?$/, '');

// ── Constants ─────────────────────────────────────────────────────────────────
const TRANS_TYPES = [
  { value: 'DESP', label: 'Despatch'  },
  { value: 'TRF',  label: 'Transfer'  },
  { value: 'OUT',  label: 'Out'       },
];

// ── Hamali helpers ────────────────────────────────────────────────────────────
// Exact flag combinations that map to a valid code.
// Any other combination returns '' (shown as grey "No code" — save blocked).
const HAMALI_FLAG_MAP = [
  // code   cash   onAc   varai  bankTrf lbrAmt billChk
  ['CR',  true,  false, false, false,  false, false],
  ['CB',  false, false, false, true,   false, false],
  ['OA',  false, true,  false, false,  false, false],
  ['OC',  true,  true,  false, false,  false, false],
  ['OB',  false, true,  false, true,   false, false],
  ['VC',  false, true,  true,  false,  false, false],
  ['VB',  false, true,  true,  true,   false, false],
  ['BA',  false, false, false, false,  false, true ],
  ['LA',  false, false, false, false,  true,  false],
];

function deriveHamaliCode(flags) {
  const { cash, onAc, varai, bankTrf, lbrAmt, billChk, noEntry } = flags;
  if (noEntry) return 'NO';
  const match = HAMALI_FLAG_MAP.find(
    ([, c, oa, v, bt, la, bc]) =>
      cash === c && onAc === oa && varai === v &&
      bankTrf === bt && lbrAmt === la && billChk === bc,
  );
  return match ? match[0] : '';
}

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

const EMPTY_FLAGS = { cash: false, onAc: false, varai: false, bankTrf: false, lbrAmt: false, billChk: false, noEntry: false };

// VB6 hard-coded delivery options — used as fallback if no VCComboData rows exist for DelvType.
const DEFAULT_DELIV_OPTIONS = [
  'Phone', 'Email', 'CustomerLetter', 'SMS', 'FAX', 'PurchaseOrder', 'WhatsApp',
].map((v, i) => ({ VCCode: v, VCData: v, VCSrtOrd: i + 1 }));

// DB stores FaYear as 4-char '2627'; upload folders use full '2026-2027'.
function toFaYearFull(raw) {
  if (!raw || raw.length !== 4) return raw || '';
  return `20${raw.slice(0, 2)}-20${raw.slice(2, 4)}`;
}

function flagsFromCode(code) {
  const F = { ...EMPTY_FLAGS };
  switch (code) {
    case 'CR':  return { ...F, cash: true };
    case 'CB':  return { ...F, bankTrf: true };
    case 'OA':  return { ...F, onAc: true };
    case 'OC':  return { ...F, onAc: true, cash: true };
    case 'OB':  return { ...F, onAc: true, bankTrf: true };
    case 'VC':  return { ...F, onAc: true, varai: true };
    case 'VB':  return { ...F, onAc: true, varai: true, bankTrf: true };
    case 'BA':  return { ...F, billChk: true };
    case 'LA':  return { ...F, lbrAmt: true };
    case 'NO':  return { ...F, noEntry: true };
    default:    return F;
  }
}

const EMPTY = {
  TransType:    'DESP',
  TransDt:      new Date().toISOString().slice(0, 10),
  TransTm:      new Date().toTimeString().slice(0, 5),
  GatePass:     '',
  fkPartyID:    '',
  pfkLotID:     '',
  pfkOriLotID:  '',
  LotNum:       '',
  LotBillFlg:   'Y',
  fkItemID:     '',
  iName:        '',          // display only — not sent to backend
  ItemExtDesc:  '',
  OriTransDt:   '',
  OriTransQty:  '',
  Packing:      '',
  PackingType:  '',
  PackingColour:'',
  PackWght:     '',
  GrossWght:    '',
  ActualWght:   '',
  RentRate:     '',
  ItemRate:     '',
  fkGodownID1:  '',
  GodownQty1:   '',
  fkGodownID2:  '',
  GodownQty2:   '',
  DoNum:        '',
  VehiNum:      '',
  DelivOpt:     '',
  OwnTransFlg:  false,
  PickupBy:     '',
  BatchNum:     '',
  BENum:        '',
  ArrBatchNum:  '',
  TransExtDetail: '',
  TransNote:    '',
  TransRemark:  '',
  HamaliRecd:   '',
  HamaliAmt:    '',
  HmlBillAmt:   '',
  OtherHmlAmt:  '',
  OutsideLabr:  false,
};

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

function fmtNum(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '';
  return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2);
}

// Shared props for every type="number" TextField:
//   • hides the up/down spinner arrows (Chrome + Firefox)
//   • blurs the field on wheel scroll so the value is never changed accidentally
const NUM_SX = {
  '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': { display: 'none' },
  '& input[type=number]': { MozAppearance: 'textfield' },
};
const blurOnWheel = (e) => e.target.blur();

export default function DispatchFormPage() {
  const navigate = useNavigate();
  const { id: _rawId } = useParams();
  const id       = decodeId(_rawId);
  const isEdit   = !!id;

  // Form state
  const [form,          setForm]          = useState(() => ({ ...EMPTY, TransTm: new Date().toTimeString().slice(0, 5) }));
  const [flags,         setFlags]         = useState(EMPTY_FLAGS);
  const [hamaliRates,   setHamaliRates]   = useState({ cash: '', labour: '', bill: '', chargeType: '', ct: '' });
  const [selPartyCompID, setSelPartyCompID] = useState('');
  const gatePassEdited    = useRef(false);
  const prevHamaliCode    = useRef('');   // tracks last-fetched code to avoid redundant calls
  const pasteZoneRef      = useRef(null);
  const selectLotRef      = useRef(null);
  const lotSearchRef      = useRef(null);
  const prevQtyPositive   = useRef(false); // detects first moment qty becomes > 0

  // Master data
  const [parties,      setParties]      = useState([]);
  const [godowns,      setGodowns]      = useState([]);
  const [items,        setItems]        = useState([]);
  const [delivOptions, setDelivOptions] = useState([]);

  // Lot selection
  const [lotModal,      setLotModal]      = useState(false);
  const [lotSearch,     setLotSearch]     = useState('');
  const [lotLoading,    setLotLoading]    = useState(false);
  const [lots,          setLots]          = useState([]);
  const [selLot,        setSelLot]        = useState(null);
  const [lotGodowns,    setLotGodowns]    = useState([]);
  const [lotDetail,     setLotDetail]     = useState(null); // ARV entry data for lot info box
  const [hideZeroLot,   setHideZeroLot]   = useState(true); // checkbox: hide zero-balance lots

  // Documents
  const [attachments, setAttachments] = useState([]);
  const [savedDocs,   setSavedDocs]   = useState([]);
  const fileInputRef    = useRef(null);
  const cameraInputRef  = useRef(null);
  const photoInputRef   = useRef(null);

  // Webcam (pickup photo)
  const [cameraOpen,      setCameraOpen]      = useState(false);
  const [pickupPhotoUrl,  setPickupPhotoUrl]  = useState('');
  const [pickupPhotoBlob, setPickupPhotoBlob] = useState(null);
  const [pickupPreview,   setPickupPreview]   = useState('');
  const videoRef      = useRef(null);
  const streamRef     = useRef(null);
  const pickupFileRef = useRef(null);
  const actualWghtRef = useRef(null);

  // Arrival stock photos (read-only)
  const [arrivalPhotos, setArrivalPhotos] = useState([]);

  // Save state
  const [saving,     setSaving]    = useState(false);
  const [loading,    setLoading]   = useState(isEdit);
  const [submitted,  setSubmitted] = useState(false);
  const [error,      setError]     = useState('');
  const [arvTransDt, setArvTransDt] = useState(''); // ARV date for TransDt >= validation

  // Post-save dialogs
  const [savedRow,       setSavedRow]       = useState(null);
  const [gatepassDialog, setGatepassDialog] = useState(false);
  const [emailDialog,    setEmailDialog]    = useState(false);
  const [emailSending,   setEmailSending]   = useState(false);
  const [emailSnack,     setEmailSnack]     = useState({ open: false, msg: '', severity: 'success' });
  const [locBatches,     setLocBatches]     = useState([{ fkGodownID: '', fkLocationID: '', locationCode: '', batchNum: '', qty: '', remark: '' }]);
  const [locBatches2,    setLocBatches2]    = useState([{ fkGodownID: '', fkLocationID: '', locationCode: '', batchNum: '', qty: '', remark: '' }]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const hamaliCode = deriveHamaliCode(flags);
  const hmlFields  = HAMALI_FIELDS[hamaliCode] || { cash: false, labour: false, bill: false };
  const selParty   = useMemo(() => parties.find((p) => p.pkPartyID === form.fkPartyID) || null, [parties, form.fkPartyID]);
  const godowns2   = useMemo(() => lotGodowns.filter((g) => g.fkGodownID !== form.fkGodownID1), [lotGodowns, form.fkGodownID1]);
  const totalQty   = Math.abs(parseFloat(form.GodownQty1) || 0) + Math.abs(parseFloat(form.GodownQty2) || 0);
  const isTRF      = form.TransType === 'TRF';
  const isDespMode = form.TransType === 'DESP' || form.TransType === 'OUT';

  // Godown options for the LocBatch grid — normalised to { pkGodownID, gNum }
  const activeGodownOptions = useMemo(() => {
    const findG = (gid) => {
      const fromLot    = lotGodowns.find((g) => g.fkGodownID === gid);
      const fromMaster = godowns.find((g) => g.pkGodownID === gid);
      const gNum = fromLot?.gNum || fromMaster?.gNum || gid;
      return gid ? { pkGodownID: gid, gNum } : null;
    };
    const opts = [];
    if (form.fkGodownID1) { const g = findG(form.fkGodownID1); if (g) opts.push(g); }
    if (form.fkGodownID2 && form.fkGodownID2 !== form.fkGodownID1) {
      const g = findG(form.fkGodownID2); if (g) opts.push(g);
    }
    return opts;
  }, [form.fkGodownID1, form.fkGodownID2, lotGodowns, godowns]);

  // For TRF: separate options per godown so each grid only shows its own godown
  const g1GodownOptions = useMemo(
    () => activeGodownOptions.filter((g) => g.pkGodownID === form.fkGodownID1),
    [activeGodownOptions, form.fkGodownID1],
  );
  const g2GodownOptions = useMemo(
    () => activeGodownOptions.filter((g) => g.pkGodownID === form.fkGodownID2),
    [activeGodownOptions, form.fkGodownID2],
  );

  // Bidirectional hamali: amount ↔ rate, respecting PP vs PT charge type
  const hmlTons = () => {
    const packWght = parseFloat(lotDetail?.PackWght) || 0;
    return (totalQty * packWght) / 1000;
  };
  const handleHmlAmount = (amtKey, rateKey) => (e) => {
    const val = e.target.value;
    let rate  = '';
    if (totalQty > 0 && val !== '') {
      if (hamaliRates.ct === 'PT') {
        const tons = hmlTons();
        rate = tons > 0 ? (parseFloat(val) / tons).toFixed(2) : '';
      } else {
        rate = (parseFloat(val) / totalQty).toFixed(2);
      }
    }
    setForm((p) => ({ ...p, [amtKey]: val }));
    setHamaliRates((p) => ({ ...p, [rateKey]: rate }));
  };
  const handleHmlRate = (amtKey, rateKey) => (e) => {
    const val = e.target.value;
    let amt   = '';
    if (totalQty > 0 && val !== '') {
      if (hamaliRates.ct === 'PT') {
        amt = (hmlTons() * parseFloat(val)).toFixed(2);
      } else {
        amt = (parseFloat(val) * totalQty).toFixed(2);
      }
    }
    setForm((p) => ({ ...p, [amtKey]: amt }));
    setHamaliRates((p) => ({ ...p, [rateKey]: val }));
  };

  // Item name for display in lot info box.
  // For a new dispatch the lot-list API returns iName already as CONCAT(iName, ' ', ItemExtDesc),
  // so form.iName is used as-is.  For edit mode form.iName is cleared and we resolve the base name
  // from the items master then append form.ItemExtDesc from the saved row.
  const lotItemName = useMemo(() => {
    if (form.iName) return form.iName;
    const itemID = lotDetail?.fkItemID || form.fkItemID;
    const item   = items.find((i) => i.pkItemID === itemID);
    const base   = item?.iName || '';
    const ext    = (form.ItemExtDesc || lotDetail?.ItemExtDesc || '').trim();
    return [base, ext].filter(Boolean).join(' ') || '—';
  }, [form.iName, form.fkItemID, form.ItemExtDesc, lotDetail, items]);

  // ── Auto-fetch next GatePass number for new entries ──────────────────────
  useEffect(() => {
    if (isEdit) return;
    if (!form.TransDt) return;
    if (gatePassEdited.current) return; // user already typed their own value
    api.get('/transactions/dispatches/next-gatepass', {
      params: { partyCompID: selPartyCompID, transDate: form.TransDt },
    }).then(({ data }) => {
      if (!gatePassEdited.current) setForm((p) => ({ ...p, GatePass: data.nextGatePass || '' }));
    }).catch(() => {});
  }, [isEdit, form.TransDt, selPartyCompID]);

  // Paste image — shared handler used by both the paste zone and window listener
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
    setAttachments((prev) => [...prev, { file, preview: URL.createObjectURL(file), isPdf: false }]);
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

  // ── Load master data ──────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      api.get('/masters/parties/group'),
      api.get('/masters/godowns', { params: { slim: 1 } }),
      api.get('/masters/items', { params: { slim: 1 } }),
      api.get('/combo?purpose=DelvType'),
    ]).then(([pRes, gRes, iRes, dRes]) => {
      setParties(pRes.data.filter((r) => r.Active === 'Y'));
      setGodowns(gRes.data);
      setItems(iRes.data);
      setDelivOptions(dRes.data.length > 0 ? dRes.data : DEFAULT_DELIV_OPTIONS);
    }).catch(() => {});
  }, []);

  // ── Load existing entry (edit mode) ──────────────────────────────────────
  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    api.get(`/transactions/dispatches/${id}`)
      .then(({ data }) => {
        const row = data;
        const qty1 = Math.abs(parseFloat(row.GodownQty1 || 0));
        const qty2 = Math.abs(parseFloat(row.GodownQty2 || 0));
        setForm({
          TransType:     row.TransType,
          TransDt:       row.TransDt ? String(row.TransDt).slice(0, 10) : '',
          TransTm:       row.TransTm ? String(row.TransTm).slice(11, 16) : '',
          GatePass:      row.GatePass || '',
          fkPartyID:     row.fkPartyID,
          pfkLotID:      row.pfkLotID,
          pfkOriLotID:   row.pfkOriLotID,
          LotNum:        data.lotDetail?.LotNum || row.LotNum || '',
          LotBillFlg:    row.LotBillFlg || 'Y',
          fkItemID:      row.fkItemID,
          iName:         '',   // resolved via lotItemName useMemo from items master
          ItemExtDesc:   row.ItemExtDesc || '',
          OriTransDt:    row.OriTransDt ? String(row.OriTransDt).slice(0, 10) : '',
          OriTransQty:   row.OriTransQty || '',
          Packing:       row.Packing || '',
          PackingType:   row.PackingType || '',
          PackingColour: row.PackingColour || '',
          PackWght:      fmtNum(row.PackWght) || '',
          GrossWght:     fmtNum(row.GrossWght) || '',
          ActualWght:    fmtNum(row.ActualWght) || '',
          RentRate:      fmtNum(row.RentRate) || '',
          ItemRate:      fmtNum(row.ItemRate) || '',
          fkGodownID1:   row.fkGodownID1 || '',
          GodownQty1:    qty1 ? String(qty1) : '',
          fkGodownID2:   row.fkGodownID2 || '',
          GodownQty2:    qty2 ? String(qty2) : '',
          DoNum:         row.DoNum || '',
          VehiNum:       row.VehiNum || '',
          DelivOpt:      row.DelivOpt || '',
          OwnTransFlg:   row.OwnTransFlg === 'Y',
          PickupBy:      row.PickupBy || '',
          BatchNum:      row.BatchNum || '',
          BENum:         row.BENum || '',
          ArrBatchNum:   '',
          TransExtDetail:row.TransExtDetail || '',
          TransNote:     row.TransNote || '',
          TransRemark:   row.TransRemark || '',
          HamaliRecd:    fmtNum(row.HamaliRecd) || '',
          HamaliAmt:     fmtNum(row.HamaliAmt) || '',
          HmlBillAmt:    fmtNum(row.HmlBillAmt) || '',
          OtherHmlAmt:   fmtNum(row.OtherHmlAmt) || '',
          OutsideLabr:   row.OutsideLabr === 'Y',
        });
        setFlags(flagsFromCode(row.HamaliCode || ''));
        if (data.godowns)   setLotGodowns(data.godowns);
        if (data.lotDetail) {
          setLotDetail(data.lotDetail);
          if (data.lotDetail.ArvTransDt) setArvTransDt(String(data.lotDetail.ArvTransDt).slice(0, 10));
        }
        setSelPartyCompID(row.fkCompID || '');
        const mapLBRow = (r) => ({
          fkGodownID:   r.fkGodownID   || '',
          fkLocationID: r.fkLocationID || '',
          locationCode: r.LocationCode || '',
          batchNum:     r.BatchNum     || '',
          qty:          String(Math.abs(parseFloat(r.Qty) || 0)),
          remark:       r.Remark       || '',
        });
        const EMPTY_LB = { fkGodownID: '', fkLocationID: '', locationCode: '', batchNum: '', qty: '', remark: '' };
        // Backend splits locBatches by fkGodownID for TRF; non-TRF has no locBatches2.
        const g1Src = Array.isArray(data.locBatches)  ? data.locBatches  : [];
        const g2Src = Array.isArray(data.locBatches2) ? data.locBatches2 : [];
        setLocBatches(g1Src.length > 0 ? g1Src.map(mapLBRow) : [{ ...EMPTY_LB }]);
        setLocBatches2(g2Src.length > 0 ? g2Src.map(mapLBRow) : [{ ...EMPTY_LB }]);

        if (id) {
          api.get('/uploads/trans-docs', { params: { transID: id } })
            .then(({ data: d }) => setSavedDocs(d)).catch(() => {});
          api.get('/uploads/stock-photos', { params: { lotNum: row.LotNum } })
            .then(({ data: d }) => setArrivalPhotos(d)).catch(() => {});
        }
        if (row.FaYear && row.GatePass && id) {
          const compCode = id.split('!')[0];
          api.get('/uploads/pickup-photo', {
            params: { compCode, gatePass: row.GatePass, faYear: toFaYearFull(row.FaYear) },
          }).then(({ data: d }) => { if (d.url) setPickupPhotoUrl(d.url); }).catch(() => {});
        }
      })
      .catch(() => setError('Failed to load entry'))
      .finally(() => setLoading(false));
  }, [isEdit, id]);

  // Recalculate amounts from stored rates when total qty changes.
  // Rates come from RateChart and stay fixed; only the derived amounts update.
  useEffect(() => {
    if (totalQty <= 0) { setHamaliRates((p) => ({ ...p, cash: '', labour: '', bill: '' })); return; }
    const packWght = parseFloat(lotDetail?.PackWght) || 0;
    const tons     = (totalQty * packWght) / 1000;
    const isPT     = hamaliRates.ct === 'PT';
    const amtFromRate = (rate) => {
      if (!rate) return '';
      if (isPT) return (tons * parseFloat(rate)).toFixed(2);
      return (parseFloat(rate) * totalQty).toFixed(2);
    };
    setForm((p) => ({
      ...p,
      HamaliRecd: hamaliRates.cash   ? amtFromRate(hamaliRates.cash)   : p.HamaliRecd,
      HamaliAmt:  hamaliRates.labour ? amtFromRate(hamaliRates.labour) : p.HamaliAmt,
      HmlBillAmt: hamaliRates.bill   ? amtFromRate(hamaliRates.bill)   : p.HmlBillAmt,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.GodownQty1, form.GodownQty2]);

  // Reset prevHamaliCode when lot or party changes so a fresh rate is fetched.
  useEffect(() => {
    prevHamaliCode.current = '';
  }, [lotDetail, form.fkPartyID]);

  // Auto-fetch hamali rate — mirrors ArrivalFormPage.calcHamaliRate.
  // totalQty in deps so the callback is recreated when qty changes;
  // prevQtyPositive detects the first moment qty > 0 to fill amounts that were empty.
  const calcHamaliRate = useCallback(async (code) => {
    if (!form.fkPartyID || !code || code === 'NO') return;
    const fields   = HAMALI_FIELDS[code] || HAMALI_FIELDS.CR;
    const cashOnly = fields.cash && !fields.labour; // CR only
    // OC/OB share the OA rate chart entry; VB shares VC
    const RATE_CODE_MAP = { OC: 'OA', OB: 'OA', VB: 'VC' };
    const rateCode = RATE_CODE_MAP[code] || code;
    try {
      const { data } = await api.get('/transactions/dispatches/hamali-rate', {
        params: {
          partyID:     form.fkPartyID,
          packing:     lotDetail?.Packing  ?? '',
          weight:      lotDetail?.PackWght ?? '',
          hamaliCode:  rateCode,
          transType:   form.TransType,
          transDate:   form.TransDt,
          partyCompID: selPartyCompID,
        },
      });
      const tq       = totalQty;
      const packWght = parseFloat(lotDetail?.PackWght) || 0;
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
    } catch (err) {
      console.error('hamali-rate:', err?.response?.data || err?.message);
    }
  }, [form.fkPartyID, lotDetail, form.TransType, form.TransDt, totalQty, selPartyCompID]);

  useEffect(() => {
    const code          = deriveHamaliCode(flags);
    const qtyNowPos     = totalQty > 0 && !prevQtyPositive.current;
    prevQtyPositive.current = totalQty > 0;
    if (code !== prevHamaliCode.current || qtyNowPos) {
      prevHamaliCode.current = code;
      calcHamaliRate(code);
    }
  }, [flags, form.HamaliRecd, calcHamaliRate, totalQty]);

  // ── Lot modal: load lots when open or search changes ─────────────────────
  const loadLots = useCallback(async () => {
    if (!form.fkPartyID || !form.TransDt) { setLots([]); return; }
    setLotLoading(true);
    try {
      const { data } = await api.get('/transactions/dispatches/lot-list', {
        params: {
          partyID:     form.fkPartyID,
          transDate:   form.TransDt,
          partyCompID: selPartyCompID,
          search:      lotSearch,
          hideZero:    String(hideZeroLot),
        },
      });
      setLots(data);
    } catch { setLots([]); }
    setLotLoading(false);
  }, [form.fkPartyID, form.TransDt, selPartyCompID, lotSearch, hideZeroLot]);

  useEffect(() => {
    if (!lotModal) return;
    const t = setTimeout(loadLots, 300);
    const f = setTimeout(() => lotSearchRef.current?.focus(), 150);
    return () => { clearTimeout(t); clearTimeout(f); };
  }, [lotModal, loadLots]);

  // ── Lot selection ─────────────────────────────────────────────────────────
  async function handleSelectLot(lot) {
    setSelLot(lot);
    setLotDetail(lot);
    setLotGodowns(lot.godowns || []);
    const singleGodownID = lot.godowns?.length === 1 ? lot.godowns[0].fkGodownID : '';
    setForm((p) => ({
      ...p,
      pfkLotID:      lot.pfkLotID,
      pfkOriLotID:   lot.pfkOriLotID || lot.pfkLotID,
      LotNum:        lot.LotNum,
      LotBillFlg:    lot.LotBillFlg || 'Y',
      fkItemID:      lot.fkItemID || '',
      iName:         lot.iName || '',
      ItemExtDesc:   lot.ItemExtDesc || '',
      OriTransDt:    lot.OriTransDt ? String(lot.OriTransDt).slice(0, 10) : '',

      OriTransQty:   lot.OriTransQty || '',
      Packing:       lot.Packing || '',
      PackingType:   lot.PackingType || '',
      PackingColour: lot.PackingColour || '',
      PackWght:      lot.PackWght  != null ? fmtNum(lot.PackWght)  : '',
      GrossWght:     lot.GrossWght != null ? fmtNum(lot.GrossWght) : '',
      BENum:         lot.BENum || '',
      ArrBatchNum:   lot.BatchNum || '',
      BatchNum:      lot.BatchNum || '',
      RentRate:      lot.RentRate != null ? fmtNum(lot.RentRate) : '',
      TransRemark:   lot.TransRemark || '',
      fkGodownID1:   singleGodownID,
      GodownQty1:    '',
      fkGodownID2:   '',
      GodownQty2:    '',
    }));
    setArvTransDt(lot.ArvTransDt ? String(lot.ArvTransDt).slice(0, 10) : '');
    // Reset both loc/batch grids on every new lot selection
    const EMPTY_LB = { fkGodownID: '', fkLocationID: '', locationCode: '', batchNum: '', qty: '', remark: '' };
    setLocBatches([{ ...EMPTY_LB }]);
    setLocBatches2([{ ...EMPTY_LB }]);
    setLotModal(false);

    if (lot.LotNum) {
      api.get('/uploads/stock-photos', { params: { lotNum: lot.LotNum } })
        .then(({ data }) => setArrivalPhotos(data)).catch(() => {});
    }

    // Auto-fill batch + location when the lot has exactly 1 of each
    if (singleGodownID && (form.TransType === 'DESP' || form.TransType === 'OUT')) {
      const pfkOriLotID = lot.pfkOriLotID || lot.pfkLotID;
      try {
        const { data: batches } = await api.get('/transactions/dispatches/batch-list', {
          params: { pfkOriLotID, godownID: singleGodownID, partyCompID: selPartyCompID },
        });
        if (!Array.isArray(batches) || batches.length !== 1) return;

        const batchNum = batches[0].batchNum;
        const { data: locs } = await api.get('/transactions/dispatches/location-list', {
          params: { pfkOriLotID, godownID: singleGodownID, batchNum, partyCompID: selPartyCompID },
        });
        if (!Array.isArray(locs) || locs.length !== 1) return;

        const loc = locs[0];
        setLocBatches([{
          fkGodownID:   singleGodownID,
          fkLocationID: loc.fkLocationID || '',
          locationCode: loc.LocationCode || '',
          batchNum,
          qty:          '',   // filled when user enters GodownQty1
          remark:       '',
        }]);
      } catch {
        // silently skip — user fills manually
      }
    }
  }

  // ── Party change ─────────────────────────────────────────────────────────
  function handlePartyChange(party) {
    setForm((p) => ({ ...p, fkPartyID: party ? party.pkPartyID : '', pfkLotID: '', LotNum: '', iName: '' }));
    setSelPartyCompID(party ? (party.fkCompID || '') : '');
    setSelLot(null);
    setLotDetail(null);
    setLotGodowns([]);
    setArrivalPhotos([]);
    setSavedDocs([]);
  }

  // ── Webcam (pickup photo) ─────────────────────────────────────────────────
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 100);
    } catch (err) {
      setError('Camera access denied: ' + err.message);
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (pickupPreview) URL.revokeObjectURL(pickupPreview);
      setPickupPhotoBlob(blob);
      setPickupPreview(URL.createObjectURL(blob));
      setPickupPhotoUrl('');
    }, 'image/jpeg', 0.92);
    stopCamera();
  }

  function handlePickupFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (pickupPreview) URL.revokeObjectURL(pickupPreview);
    setPickupPhotoBlob(file);
    setPickupPreview(URL.createObjectURL(file));
    setPickupPhotoUrl('');
    e.target.value = '';
  }

  function clearPickupPhoto() {
    if (pickupPreview) URL.revokeObjectURL(pickupPreview);
    setPickupPhotoBlob(null);
    setPickupPreview('');
    setPickupPhotoUrl('');
  }

  // ── Documents ─────────────────────────────────────────────────────────────
  function handleFileChange(e) {
    const files = Array.from(e.target.files);
    setAttachments((prev) => [
      ...prev,
      ...files.map((f) => ({
        file:    f,
        preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
        isPdf:   f.type === 'application/pdf',
      })),
    ]);
    e.target.value = '';
  }

  function removeAttachment(i) {
    setAttachments((prev) => {
      if (prev[i].preview) URL.revokeObjectURL(prev[i].preview);
      return prev.filter((_, idx) => idx !== i);
    });
  }

  async function deleteDoc(filename) {
    if (!window.confirm(`Delete "${filename}" permanently from the server?`)) return;
    try {
      await api.delete('/uploads/trans-docs', { params: { transID: id, filename } });
      setSavedDocs((prev) => prev.filter((d) => d.filename !== filename));
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to delete document');
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSubmitted(true);
    setError('');

    if (!form.fkPartyID)          { setError('Party is required'); return; }
    if (!isEdit && !form.pfkLotID) { setError('Please select a Lot'); return; }
    if (arvTransDt && form.TransDt < arvTransDt) {
      setError(`Date cannot be before the Arrival date (${arvTransDt})`); return;
    }
    if (!form.DoNum)     { setError('Do Number is required'); return; }
    if (!form.fkGodownID1 || !form.GodownQty1) {
      setError('Godown 1 and Quantity 1 are required'); return;
    }

    const g1 = lotGodowns.find((g) => g.fkGodownID === form.fkGodownID1);
    if (g1 && parseFloat(form.GodownQty1) > g1.BalQty) {
      setError(`Qty 1 exceeds available balance in ${g1.gNum} (Balance: ${g1.BalQty})`); return;
    }
    // For TRF, Godown 2 is the arrival (receiving) godown — no stock-balance check applies.
    if (!isTRF && form.fkGodownID2 && form.GodownQty2) {
      const g2 = lotGodowns.find((g) => g.fkGodownID === form.fkGodownID2);
      if (g2 && parseFloat(form.GodownQty2) > g2.BalQty) {
        setError(`Qty 2 exceeds available balance in ${g2.gNum} (Balance: ${g2.BalQty})`); return;
      }
    }
    if (form.fkGodownID2 && form.fkGodownID2 === form.fkGodownID1) {
      setError('Godown 1 and Godown 2 cannot be the same'); return;
    }

    if (!flags.noEntry) {
      if (!hamaliCode) { setError('Please select Hamali Entry'); return; }
      const missing = [];
      if (flags.cash       && !form.HamaliRecd) missing.push('Cash Received');
      if (hmlFields.labour && !form.HamaliAmt)  missing.push('Labour Amount');
      if (hmlFields.bill   && !form.HmlBillAmt) missing.push('Bill Amount');
      if (missing.length > 0) {
        setError(`Hamali required: check "No Entry" or fill — ${missing.join(', ')}`); return;
      }
    }

    // Batch Detail grid is compulsory — at least one row with Batch No, Location and Qty
    const isActive = (r) => r.batchNum?.trim() || r.fkLocationID || parseFloat(r.qty) > 0;
    const isBadRow = (r) => !r.batchNum?.trim() || !r.fkLocationID || !parseFloat(r.qty);
    const qty1Abs  = Math.abs(parseFloat(form.GodownQty1) || 0);
    const qty2Abs  = Math.abs(parseFloat(form.GodownQty2) || 0);

    const activeLocRows  = locBatches.filter(isActive);
    const activeLocRows2 = locBatches2.filter(isActive);

    if (isTRF) {
      // TRF: validate G1 and G2 grids separately
      if (activeLocRows.length === 0) {
        setError('Batch Detail – Godown 1 is required. Enter at least one row.'); return;
      }
      if (activeLocRows.find(isBadRow)) {
        setError('Each Godown 1 Batch Detail row must have Batch No., Location and Qty'); return;
      }
      const g1Total = activeLocRows.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0);
      if (Math.abs(g1Total - qty1Abs) >= 0.01) {
        setError(`Godown 1 Batch Detail total (${g1Total}) must match Qty 1 (${qty1Abs})`); return;
      }
      if (form.fkGodownID2 && form.GodownQty2) {
        if (activeLocRows2.length === 0) {
          setError('Batch Detail – Godown 2 is required. Enter at least one row.'); return;
        }
        if (activeLocRows2.find(isBadRow)) {
          setError('Each Godown 2 Batch Detail row must have Batch No., Location and Qty'); return;
        }
        const g2Total = activeLocRows2.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0);
        if (Math.abs(g2Total - qty2Abs) >= 0.01) {
          setError(`Godown 2 Batch Detail total (${g2Total}) must match Qty 2 (${qty2Abs})`); return;
        }
      }
    } else {
      // Non-TRF (DESP / OUT): validate single grid vs totalQty
      if (activeLocRows.length === 0) {
        setError('Batch Detail is required. Enter at least one row with Batch No., Location and Qty.'); return;
      }
      if (activeLocRows.find(isBadRow)) {
        setError('Each Batch Detail row must have Batch No., Location and Qty'); return;
      }
      const locTotal = activeLocRows.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0);
      if (Math.abs(locTotal - totalQty) >= 0.01) {
        setError(`Batch Detail total (${locTotal}) must match Total Qty (${totalQty})`); return;
      }
    }

    setSaving(true);
    try {
      // For TRF: merge G1 + G2 rows into one locBatches array with fkGodownID tags.
      // gridBatchNum shows all rows from both grids for TRF, else just G1.
      const allActiveRows = isTRF
        ? [
            ...activeLocRows.map((r)  => ({ ...r, fkGodownID: r.fkGodownID || form.fkGodownID1, isArrival: false })),
            ...activeLocRows2.map((r) => ({ ...r, fkGodownID: form.fkGodownID2, isArrival: true })),
          ]
        : activeLocRows;

      const gridBatchNum = allActiveRows.length > 0
        ? allActiveRows
            .filter((r) => r.batchNum)
            .map((r) => [r.batchNum, r.locationCode, r.qty].filter(Boolean).join(' - '))
            .join('\n')
        : '';

      // iName is display-only; strip before sending.
      // Zero out any hamali amounts whose fields are hidden (e.g. HamaliRecd when On A/C
      // is checked — the field hides but its value persists in state if not cleared here).
      const { iName: _iName, ...payload } = {
        ...form,
        BatchNum:    gridBatchNum || form.BatchNum || '',
        HamaliRecd:  hmlFields.cash   ? form.HamaliRecd  : 0,
        HamaliAmt:   hmlFields.labour ? form.HamaliAmt   : 0,
        HmlBillAmt:  hmlFields.bill   ? form.HmlBillAmt  : 0,
        GatePass:    form.GatePass || '',
        OwnTransFlg: form.OwnTransFlg ? 'Y' : 'N',
        OutsideLabr: form.OutsideLabr,
        hamaliFlags: flags,
        partyCompID: selPartyCompID,
        locBatches:  allActiveRows,
      };

      const { data: row } = isEdit
        ? await api.put(`/transactions/dispatches/${id}`, payload)
        : await api.post('/transactions/dispatches', payload);

      setSavedRow(row);

      const lotNumToUse = row.LotNum || form.LotNum;
      const faYearRaw   = row.FaYear;
      const faYear      = toFaYearFull(faYearRaw);
      const transID     = row.pkTransID;
      const compCode    = transID ? transID.split('!')[0] : '';
      const gatePass    = row.GatePass || form.GatePass || '';

      if (attachments.length > 0 && transID && faYear) {
        await Promise.all(attachments.map((att) => {
          const fd = new FormData();
          fd.append('file', att.file);
          fd.append('transID', transID);
          fd.append('faYear', faYear);
          return api.post('/uploads/trans-docs', fd).catch(() => {});
        }));
        setAttachments([]);
        const { data: d } = await api.get('/uploads/trans-docs', { params: { transID, faYear } });
        setSavedDocs(d);
      }

      if (pickupPhotoBlob && compCode && gatePass && faYear) {
        const fd = new FormData();
        fd.append('photo', pickupPhotoBlob, 'pickup.jpg');
        fd.append('compCode', compCode);
        fd.append('gatePass', gatePass);
        fd.append('faYear', faYear);
        await api.post('/uploads/pickup-photo', fd).catch(() => {});
        setPickupPhotoBlob(null);
        // Refresh the saved URL so the photo appears immediately after upload
        api.get('/uploads/pickup-photo', { params: { compCode, gatePass, faYear } })
          .then(({ data: d }) => { if (d.url) setPickupPhotoUrl(d.url); }).catch(() => {});
      }

      setGatepassDialog(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleViewGatepass() {
    if (savedRow) {
      try {
        const res = await api.get(`/transactions/dispatches/${savedRow.pkTransID}/gatepass`, {
          params: { partyCompID: selPartyCompID || savedRow.fkCompID },
          responseType: 'blob',
        });
        const pdfUrl = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
        // Open a wrapper HTML page with @page A6 so the print dialog defaults to A6 paper.
        // window.print() fires automatically once the PDF iframe has loaded.
        const pw = window.open('', '_blank');
        if (pw) {
          pw.document.write(
            '<!DOCTYPE html><html><head><title>Gate Pass</title><style>' +
            '@page{size:A6 portrait;margin:0}' +
            'html,body{margin:0;padding:0;width:105mm;height:148mm}' +
            'iframe{display:block;width:105mm;height:148mm;border:none}' +
            '</style></head><body>' +
            '<iframe src="' + pdfUrl + '"></iframe>' +
            '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print()},800)}<\/scr' + 'ipt>' +
            '</body></html>'
          );
          pw.document.close();
        }
      } catch {
        setError('Failed to generate Gate Pass PDF');
      }
    }
    setGatepassDialog(false);
    setEmailDialog(true);
  }

  async function handleSendEmail() {
    if (!savedRow) return;
    setEmailSending(true);
    try {
      const { data } = await api.post(`/transactions/dispatches/${savedRow.pkTransID}/email`, {
        partyCompID: selPartyCompID || savedRow.fkCompID,
      });
      setEmailSnack({ open: true, msg: `Email sent to ${data.to}`, severity: 'success' });
      setEmailDialog(false);
      setTimeout(() => navigate('/transactions/dispatches'), 1500);
    } catch (err) {
      setEmailSnack({ open: true, msg: err.response?.data?.error || 'Email failed', severity: 'error' });
      setEmailDialog(false);
      navigate('/transactions/dispatches');
    } finally {
      setEmailSending(false);
    }
  }

  const setFlag = (key) => (e) => setFlags((p) => ({ ...p, [key]: e.target.checked }));
  const set     = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}><CircularProgress /></Box>;

  const selG1 = lotGodowns.find((g) => g.fkGodownID === form.fkGodownID1);
  const selG2 = lotGodowns.find((g) => g.fkGodownID === form.fkGodownID2);
  const totalBalQty = lotGodowns.reduce((s, g) => s + g.BalQty, 0);

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <IconButton onClick={() => navigate('/transactions/dispatches')}><ArrowBackIcon /></IconButton>
        <LocalShippingIcon color="primary" />
        <Typography variant="h5" fontWeight="bold">
          {isEdit ? 'Edit Dispatch Entry' : 'New Dispatch Entry'}
        </Typography>
        {isEdit && form.LotNum && (
          <Chip label={form.LotNum} color="primary" size="small" sx={{ ml: 1 }} />
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Paper sx={{ p: 3, mb: 2 }}>
        {/* ── Section: Transaction Info ──────────────────────────────────── */}
        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2, color: 'primary.main' }}>
          Transaction Info
        </Typography>
        <Stack spacing={1.5}>
          {/* Row: Type | Date | Time | Gate Pass */}
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
            <TextField select size="small" label="Type"
              sx={{ minWidth: 140 }}
              SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}
              value={form.TransType}
              onChange={(e) => {
                const v = e.target.value;
                setForm((p) => ({
                  ...p,
                  TransType: v,
                  ...(v !== 'TRF' ? { fkGodownID2: '', GodownQty2: '' } : {}),
                }));
              }}>
              {TRANS_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Date" type="date"
              sx={{ minWidth: 150 }}
              value={form.TransDt} onChange={set('TransDt')}
              slotProps={{ inputLabel: { shrink: true } }}
              error={submitted && !form.TransDt} />
            <TextField size="small" label="Time" type="time"
              sx={{ minWidth: 130 }}
              value={form.TransTm} onChange={set('TransTm')}
              slotProps={{ inputLabel: { shrink: true } }} />
            <TextField size="small" label="Gate Pass No." type="number"
              sx={{ minWidth: 150, ...NUM_SX }}
              value={form.GatePass}
              onWheel={blurOnWheel}
              onChange={(e) => { gatePassEdited.current = true; set('GatePass')(e); }}
              InputProps={{ style: { fontWeight: 'bold', color: '#1565C0' } }} />
          </Stack>
          {/* Row: Party */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <Autocomplete size="small" sx={{ flex: 1 }} disabled={isEdit}
              openOnFocus
              autoHighlight
              autoSelect
              options={parties}
              getOptionLabel={(o) => o.pName || ''}
              renderOption={(props, o) => {
                const { key, ...liProps } = props;
                return (
                  <li key={o.pkPartyID} {...liProps}>
                    {o.pName}&nbsp;
                    <span style={{ color: '#666', fontSize: 12 }}>({o.pCode || ''})</span>&nbsp;
                    {o.fkCompID && (
                      <Chip label={o.fkCompID} size="small" variant="outlined"
                        sx={{ ml: 0.5, height: 18, fontSize: 11, pointerEvents: 'none' }} />
                    )}
                  </li>
                );
              }}
              value={selParty}
              onChange={(_, v) => handlePartyChange(v)}
              isOptionEqualToValue={(o, v) => o.pkPartyID === v.pkPartyID}
              filterOptions={(opts, { inputValue }) => {
                const q = inputValue.toLowerCase();
                return opts.filter((o) =>
                  (o.pName || '').toLowerCase().includes(q) ||
                  (o.pCode || '').toLowerCase().includes(q) ||
                  (o.fkCompID || '').toLowerCase().includes(q)
                );
              }}
              renderInput={(p) => (
                <TextField {...p} label="Party Name *"
                  error={submitted && !form.fkPartyID}
                  helperText={selParty ? (selParty.pCode || '') : ' '}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab') {
                      // Let autoSelect fire onChange first, then redirect focus to Select Lot
                      setTimeout(() => {
                        if (selectLotRef.current && !selectLotRef.current.disabled) {
                          selectLotRef.current.focus();
                        }
                      }, 0);
                    }
                  }} />
              )} />
            {selPartyCompID && (
              <Chip label={selPartyCompID} size="small" color="primary" variant="outlined"
                sx={{ mt: 1, fontWeight: 700, letterSpacing: 1 }} />
            )}
          </Box>
        </Stack>

        <Divider sx={{ my: 3 }} />

        {/* ── Section: Lot Selection ────────────────────────────────────── */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ color: 'primary.main' }}>
            Lot Selection
          </Typography>
          <Button ref={selectLotRef} variant="outlined" size="small" startIcon={<SearchIcon />}
            disabled={!form.fkPartyID || !form.TransDt}
            onClick={() => { setLotSearch(''); setLots([]); setLotModal(true); }}>
            {isEdit ? 'Change Lot' : 'Select Lot'}
          </Button>
          {submitted && !form.pfkLotID && (
            <Typography color="error" variant="caption">★ Lot required</Typography>
          )}
        </Box>

        {(form.pfkLotID || lotDetail) ? (
          <Box sx={{ bgcolor: 'primary.50', p: 2, borderRadius: 2, border: '1px solid', borderColor: 'primary.light', boxShadow: '0 4px 18px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)' }}>
            <Stack spacing={1}>
              <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
                <Box sx={{ minWidth: 120 }}>
                  <Typography variant="caption" color="text.secondary">Lot No.</Typography>
                  <Typography fontWeight="bold" color="primary.main">{lotDetail?.LotNum || form.LotNum || '—'}</Typography>
                </Box>
                <Box sx={{ minWidth: 240, flexGrow: 1 }}>
                  <Typography variant="caption" color="text.secondary">Item</Typography>
                  <Typography fontWeight={600}>{lotItemName}</Typography>
                </Box>
                <Box sx={{ minWidth: 120 }}>
                  <Typography variant="caption" color="text.secondary">Balance Qty</Typography>
                  <Typography fontWeight="bold" color="success.dark" fontSize={15}>{fmtNum(totalBalQty)}</Typography>
                </Box>
              </Stack>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                <Box sx={{ flex: '1 1 100px', minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">Packing</Typography>
                  <Typography noWrap>{lotDetail?.Packing || '—'}</Typography>
                </Box>
                <Box sx={{ flex: '1 1 100px', minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">Pack Wt</Typography>
                  <Typography noWrap>{lotDetail?.PackWght ? `${fmtNum(lotDetail.PackWght)} kg` : '—'}</Typography>
                </Box>
                <Box sx={{ flex: '1 1 100px', minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">Arrival Qty</Typography>
                  <Typography noWrap>{fmtNum(lotDetail?.OriTransQty) || '—'}</Typography>
                </Box>
                <Box sx={{ flex: '1 1 100px', minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">Arrival Date</Typography>
                  <Typography noWrap>{fmtDate(lotDetail?.OriTransDt)}</Typography>
                </Box>
                <Box sx={{ flex: '1 1 110px', minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">Arrival Doc No.</Typography>
                  <Typography noWrap>{lotDetail?.BENum || '—'}</Typography>
                </Box>
                <Box sx={{ flex: '1 1 100px', minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">Pack Colour</Typography>
                  <Typography noWrap>{lotDetail?.PackingColour || '—'}</Typography>
                </Box>
                <Box sx={{ flex: '1 1 100px', minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">Pack Type</Typography>
                  <Typography noWrap>{lotDetail?.PackingType || '—'}</Typography>
                </Box>
                <Box sx={{ flex: '1 1 120px', minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">Arrival Batch No.</Typography>
                  <Typography sx={{ whiteSpace: 'pre-line' }}>{lotDetail?.BatchNum || form.ArrBatchNum || '—'}</Typography>
                </Box>
              </Box>
            </Stack>
          </Box>
        ) : (
          <Typography color="text.secondary" variant="body2" sx={{ py: 1 }}>
            {form.fkPartyID ? 'Click "Select Lot" to choose a lot' : 'Select a party first'}
          </Typography>
        )}

        <Divider sx={{ my: 3 }} />

        {/* ── Section: Godown & Dispatch Qty ────────────────────────────── */}
        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2, color: 'primary.main' }}>
          Dispatch Quantity
        </Typography>
        <Stack spacing={1.5}>
          {/* Row: Godown 1 | Qty 1 */}
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
            <TextField select size="small" label="Godown 1 *"
              sx={{ minWidth: 200, flexGrow: 1 }}
              SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}
              value={form.fkGodownID1} onChange={set('fkGodownID1')}
              error={submitted && !form.fkGodownID1}>
              <MenuItem value=""><em>— Select —</em></MenuItem>
              {lotGodowns.map((g) => (
                <MenuItem key={g.fkGodownID} value={g.fkGodownID}>
                  {g.gNum} — Bal: {g.BalQty}
                </MenuItem>
              ))}
              {lotGodowns.length === 0 && godowns.map((g) => (
                <MenuItem key={g.pkGodownID} value={g.pkGodownID}>{g.gNum}</MenuItem>
              ))}
            </TextField>
            <TextField size="small" label="Qty 1 *" type="number"
              sx={{ minWidth: 160, flexGrow: 1, ...NUM_SX }}
              value={form.GodownQty1} onChange={set('GodownQty1')}
              onWheel={blurOnWheel}
              onBlur={(e) => {
                const qty = e.target.value;
                if (!qty) return;
                // If the grid was auto-filled with 1 row (batch+location but no qty), fill it now
                setLocBatches((prev) => {
                  if (prev.length === 1 && prev[0].batchNum && !prev[0].qty) {
                    return [{ ...prev[0], qty: String(qty) }];
                  }
                  return prev;
                });
                setTimeout(() => actualWghtRef.current?.focus(), 50);
              }}
              error={submitted && !form.GodownQty1}
              InputProps={{
                endAdornment: selG1
                  ? <InputAdornment position="end">
                      <Typography variant="caption" color={parseFloat(form.GodownQty1) > selG1.BalQty ? 'error' : 'text.secondary'}>
                        / {selG1.BalQty}
                      </Typography>
                    </InputAdornment>
                  : null,
              }} />
          </Stack>

          {/* TRF layout: G1 batch grid then Godown2+Qty2 then G2 batch grid */}
          {isTRF ? (
            <>
              {/* G1 Batch Detail – Dispatch from Godown 1 */}
              {g1GodownOptions.length > 0 && (
                <LocBatchGrid
                  label="Batch Detail – Godown 1"
                  rows={locBatches}
                  onChange={setLocBatches}
                  godownOptions={g1GodownOptions}
                  targetTotalQty={Math.abs(parseFloat(form.GodownQty1) || 0)}
                  submitted={submitted}
                  mode="desp"
                  pfkOriLotID={form.pfkOriLotID}
                  partyCompID={selPartyCompID}
                />
              )}

              {/* Godown 2 + Qty 2 row */}
              <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
                <TextField select size="small" label="Godown 2 (optional)"
                  sx={{ minWidth: 200, flexGrow: 1 }}
                  SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}
                  value={form.fkGodownID2}
                  onChange={(e) => {
                    setForm((p) => ({ ...p, fkGodownID2: e.target.value }));
                    setLocBatches2([{ fkGodownID: '', fkLocationID: '', locationCode: '', batchNum: '', qty: '', remark: '' }]);
                  }}>
                  <MenuItem value=""><em>— None —</em></MenuItem>
                  {/* TRF arrival godown: show full active list (any godown can receive stock) */}
                  {godowns.filter((g) => g.pkGodownID !== form.fkGodownID1).map((g) => (
                    <MenuItem key={g.pkGodownID} value={g.pkGodownID}>{g.gNum}</MenuItem>
                  ))}
                </TextField>
                <TextField size="small" label="Qty 2" type="number"
                  sx={{ minWidth: 160, flexGrow: 1, ...NUM_SX }}
                  value={form.GodownQty2} onChange={set('GodownQty2')}
                  onWheel={blurOnWheel}
                  disabled={!form.fkGodownID2}
                  InputProps={{
                    endAdornment: selG2
                      ? <InputAdornment position="end">
                          <Typography variant="caption" color={parseFloat(form.GodownQty2) > selG2.BalQty ? 'error' : 'text.secondary'}>
                            / {selG2.BalQty}
                          </Typography>
                        </InputAdornment>
                      : null,
                  }} />
              </Stack>

              {/* G2 Batch Detail – Arrival at Godown 2 */}
              {form.fkGodownID2 && g2GodownOptions.length > 0 && (
                <LocBatchGrid
                  label="Batch Detail – Godown 2"
                  rows={locBatches2}
                  onChange={setLocBatches2}
                  godownOptions={g2GodownOptions}
                  targetTotalQty={Math.abs(parseFloat(form.GodownQty2) || 0)}
                  submitted={submitted}
                  mode="generic"
                  pfkOriLotID={form.pfkOriLotID}
                  partyCompID={selPartyCompID}
                />
              )}
            </>
          ) : (
            /* Non-TRF: single batch grid */
            activeGodownOptions.length > 0 && (
              <LocBatchGrid
                rows={locBatches}
                onChange={setLocBatches}
                godownOptions={activeGodownOptions}
                targetTotalQty={totalQty}
                submitted={submitted}
                mode={isDespMode ? 'desp' : 'generic'}
                pfkOriLotID={form.pfkOriLotID}
                partyCompID={selPartyCompID}
              />
            )
          )}

          {/* Row: Actual Wt | Batch No. */}
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <TextField size="small" label="Actual Wt (kg)" type="number"
              sx={{ minWidth: 150, flexGrow: 1, ...NUM_SX }}
              inputRef={actualWghtRef}
              onWheel={blurOnWheel}
              value={form.ActualWght} onChange={set('ActualWght')} />
            <TextField size="small" label="Batch No."
              sx={{ minWidth: 200, flexGrow: 1 }}
              value={form.BatchNum} onChange={set('BatchNum')}
              multiline rows={3} />
          </Stack>
        </Stack>

        <Divider sx={{ my: 3 }} />

        {/* ── Section: Transport ────────────────────────────────────────── */}
        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2, color: 'primary.main' }}>
          Transport Details
        </Typography>
        <Stack spacing={1.5}>
          {/* Row: Do Number | Vehicle No. | Delivery Option */}
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
            <TextField size="small" label="Do Number *"
              sx={{ minWidth: 180, flexGrow: 1 }}
              value={form.DoNum} onChange={set('DoNum')}
              error={submitted && !form.DoNum}
              slotProps={{ htmlInput: { style: { textTransform: 'uppercase' } } }} />
            <TextField size="small" label="Vehicle No."
              sx={{ minWidth: 180, flexGrow: 1 }}
              value={form.VehiNum} onChange={(e) => setForm((p) => ({ ...p, VehiNum: e.target.value.toUpperCase() }))} />
            <TextField size="small" label="Delivery Option" select
              sx={{ minWidth: 180, flexGrow: 1 }}
              slotProps={{ inputLabel: { shrink: true } }}
              SelectProps={{ MenuProps: { PaperProps: { sx: { minWidth: 'fit-content' } } } }}
              value={form.DelivOpt}
              onChange={(e) => setForm((p) => ({ ...p, DelivOpt: e.target.value }))}>
              <MenuItem value=""><em>(Select)</em></MenuItem>
              {delivOptions.map((o) => (
                <MenuItem key={o.VCCode} value={o.VCData}>{o.VCData}</MenuItem>
              ))}
            </TextField>
          </Stack>
          {/* Row: Particulars | Pickup By */}
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <TextField size="small" label="Particulars" multiline rows={2}
              sx={{ minWidth: 200, flexGrow: 1 }}
              value={form.TransExtDetail} onChange={set('TransExtDetail')} />
            <TextField size="small" label="Pickup By"
              sx={{ minWidth: 200, flexGrow: 1 }}
              value={form.PickupBy} onChange={set('PickupBy')} />
          </Stack>
          {/* Row: Own Transport */}
          <FormControlLabel
            control={<Checkbox checked={form.OwnTransFlg} onChange={(e) => setForm((p) => ({ ...p, OwnTransFlg: e.target.checked }))} />}
            label="Own Transport" />
          <TextField fullWidth size="small" label="Note" multiline rows={2}
            value={form.TransNote} onChange={set('TransNote')} />
        </Stack>

        <Divider sx={{ my: 3 }} />

        {/* ── Section: Hamali ───────────────────────────────────────────── */}
        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1, color: 'primary.main' }}>
          Hamali Entry
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControlLabel control={<Checkbox checked={flags.cash}   onChange={setFlag('cash')}   />} label="Cash" />
          <FormControlLabel control={<Checkbox checked={flags.onAc}    onChange={setFlag('onAc')}    />} label="Party A/C" />
          <FormControlLabel control={<Checkbox checked={flags.varai}   onChange={setFlag('varai')}   />} label="Varai" />
          <FormControlLabel control={<Checkbox checked={flags.bankTrf} onChange={setFlag('bankTrf')} />} label="Bank Trf" />
          <FormControlLabel control={<Checkbox checked={flags.lbrAmt}  onChange={setFlag('lbrAmt')}  />} label="Lbr Amt" />
          <FormControlLabel control={<Checkbox checked={flags.billChk} onChange={setFlag('billChk')} />} label="Bill" />
          <FormControlLabel control={<Checkbox checked={flags.noEntry} onChange={setFlag('noEntry')} />} label="No Entry" />
          <Chip label={`Code: ${hamaliCode || '—'}`} size="small" color={hamaliCode ? 'info' : 'default'} />
          {hamaliRates.chargeType && (
            <Chip label={hamaliRates.chargeType} size="small" color="secondary" variant="outlined" />
          )}
        </Box>

        {!flags.noEntry && (
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', mt: 1 }}>
            {flags.cash && (
              <Box sx={{ display: 'flex', gap: 1, minWidth: 240, flexGrow: 1 }}>
                <TextField size="small" label="Cash Received" type="number" sx={{ flex: 2, ...NUM_SX }}
                  value={form.HamaliRecd} onChange={handleHmlAmount('HamaliRecd', 'cash')}
                  onWheel={blurOnWheel}
                  error={submitted && !flags.noEntry && flags.cash && !form.HamaliRecd} />
                <TextField size="small" label="Rate" type="number" sx={{ flex: 1, ...NUM_SX }}
                  onWheel={blurOnWheel}
                  value={hamaliRates.cash} onChange={handleHmlRate('HamaliRecd', 'cash')} />
              </Box>
            )}
            {hmlFields.labour && (
              <Box sx={{ display: 'flex', gap: 1, minWidth: 240, flexGrow: 1 }}>
                <TextField size="small" label="Labour Amount" type="number" sx={{ flex: 2, ...NUM_SX }}
                  value={form.HamaliAmt} onChange={handleHmlAmount('HamaliAmt', 'labour')}
                  onWheel={blurOnWheel}
                  error={submitted && !flags.noEntry && hmlFields.labour && !form.HamaliAmt} />
                <TextField size="small" label="Rate" type="number" sx={{ flex: 1, ...NUM_SX }}
                  onWheel={blurOnWheel}
                  value={hamaliRates.labour} onChange={handleHmlRate('HamaliAmt', 'labour')} />
              </Box>
            )}
            {hmlFields.bill && (
              <Box sx={{ display: 'flex', gap: 1, minWidth: 240, flexGrow: 1 }}>
                <TextField size="small" label="Bill Amount" type="number" sx={{ flex: 2, ...NUM_SX }}
                  value={form.HmlBillAmt} onChange={handleHmlAmount('HmlBillAmt', 'bill')}
                  onWheel={blurOnWheel}
                  error={submitted && !flags.noEntry && hmlFields.bill && !form.HmlBillAmt} />
                <TextField size="small" label="Rate" type="number" sx={{ flex: 1, ...NUM_SX }}
                  onWheel={blurOnWheel}
                  value={hamaliRates.bill} onChange={handleHmlRate('HmlBillAmt', 'bill')} />
              </Box>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', minWidth: '100%' }}>
              <FormControlLabel
                control={<Checkbox checked={form.OutsideLabr} onChange={(e) => setForm((p) => ({ ...p, OutsideLabr: e.target.checked }))} />}
                label="Outside Labour" />
              {form.OutsideLabr && (
                <TextField size="small" label="Outside Labour Amt" type="number" sx={{ width: 200, ...NUM_SX }}
                  onWheel={blurOnWheel}
                  value={form.OtherHmlAmt} onChange={set('OtherHmlAmt')} />
              )}
            </Box>
          </Stack>
        )}

        <Divider sx={{ my: 3 }} />

        {/* ── Section: Pickup Person Photo ──────────────────────────────── */}
        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2, color: 'primary.main' }}>
          Pickup Person Photo
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<VideocamIcon />} onClick={startCamera}>
            Use Webcam
          </Button>
          <Button variant="outlined" startIcon={<AttachFileIcon />}
            onClick={() => pickupFileRef.current?.click()}>
            Upload Photo
          </Button>
          <input ref={pickupFileRef} type="file" hidden accept="image/*"
            onChange={handlePickupFileChange} />
          {(pickupPreview || pickupPhotoUrl) && (
            <Box sx={{ position: 'relative', display: 'inline-block' }}>
              <img
                src={pickupPreview || `${STATIC_BASE}${pickupPhotoUrl}`}
                alt="Pickup person"
                style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '2px solid #1565C0' }} />
              <IconButton size="small" sx={{ position: 'absolute', top: -8, right: -8, bgcolor: 'white' }}
                onClick={clearPickupPhoto}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
        </Box>

        {/* ── Section: Arrival Stock Photos (read-only) ─────────────────── */}
        {arrivalPhotos.length > 0 && (
          <>
            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2, color: 'primary.main' }}>
              Arrival Stock Photos
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {arrivalPhotos.map((photo) => (
                <Box key={photo.filename} component="a"
                  href={`${STATIC_BASE}${photo.url}`} target="_blank" rel="noreferrer">
                  <img src={`${STATIC_BASE}${photo.url}`} alt={photo.filename}
                    style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 6,
                      border: '1px solid #ccc', cursor: 'pointer' }} />
                </Box>
              ))}
            </Box>
          </>
        )}

        <Divider sx={{ my: 3 }} />

        {/* ── Section: Documents ────────────────────────────────────────── */}
        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1, color: 'primary.main' }}>
          Documents
        </Typography>
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

        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <Button variant="outlined" size="small" startIcon={<AttachFileIcon />}
            onClick={() => fileInputRef.current?.click()}>
            Attach File
          </Button>
          <Button variant="outlined" size="small" startIcon={<PhotoCameraIcon />}
            onClick={() => cameraInputRef.current?.click()}>
            Camera
          </Button>
          <Button variant="outlined" size="small" startIcon={<PhotoLibraryIcon />}
            onClick={() => photoInputRef.current?.click()}>
            Gallery
          </Button>
          <input ref={fileInputRef}   type="file" hidden accept="image/*,.pdf" multiple onChange={handleFileChange} />
          <input ref={cameraInputRef} type="file" hidden accept="image/*" capture="environment" onChange={handleFileChange} />
          <input ref={photoInputRef}  type="file" hidden accept="image/*" multiple onChange={handleFileChange} />
        </Box>
        {savedDocs.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
            {savedDocs.map((doc) => (
              <Box key={doc.filename} sx={{ position: 'relative' }}>
                {/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(doc.filename) ? (
                  <Box component="img" src={`${STATIC_BASE}${doc.url}`} alt={doc.filename}
                    title={doc.filename}
                    onClick={() => window.open(`${STATIC_BASE}${doc.url}`, '_blank')}
                    sx={{ height: 80, width: 80, objectFit: 'cover', borderRadius: 1,
                      border: '1px solid #ccc', cursor: 'pointer',
                      '&:hover': { opacity: 0.85 } }} />
                ) : (
                  <Box onClick={() => window.open(`${STATIC_BASE}${doc.url}`, '_blank')}
                    title={doc.filename}
                    sx={{ height: 80, width: 80, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      border: '1px solid #ccc', borderRadius: 1, bgcolor: '#f5f5f5',
                      cursor: 'pointer', '&:hover': { bgcolor: '#e3f2fd' } }}>
                    <PictureAsPdfIcon color="error" />
                    <Typography variant="caption" sx={{ fontSize: 9, textAlign: 'center', px: 0.5 }}>
                      {doc.filename}
                    </Typography>
                  </Box>
                )}
                {isEdit && (
                  <IconButton size="small" onClick={() => deleteDoc(doc.filename)}
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
        {attachments.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {attachments.map((att, i) => (
              <Box key={i} sx={{ position: 'relative' }}>
                {att.preview ? (
                  <Box component="img" src={att.preview} alt={att.file.name}
                    onClick={() => window.open(att.preview, '_blank')}
                    sx={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 1,
                      border: '2px dashed #1976d2', display: 'block', cursor: 'pointer',
                      '&:hover': { opacity: 0.85 } }} />
                ) : (
                  <Box onClick={() => { const u = URL.createObjectURL(att.file); window.open(u, '_blank'); }}
                    sx={{ width: 80, height: 80, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      border: '2px dashed #1976d2', borderRadius: 1, bgcolor: '#f5f5f5',
                      cursor: 'pointer', '&:hover': { bgcolor: '#e3f2fd' } }}>
                    <PictureAsPdfIcon color="error" />
                    <Typography variant="caption" sx={{ fontSize: 9, textAlign: 'center', px: 0.5 }}>
                      {att.file.name}
                    </Typography>
                  </Box>
                )}
                <IconButton size="small" sx={{ position: 'absolute', top: -8, right: -8,
                  bgcolor: 'error.main', color: '#fff', width: 20, height: 20,
                  '&:hover': { bgcolor: 'error.dark' } }}
                  onClick={() => removeAttachment(i)}>
                  <CloseIcon sx={{ fontSize: 12 }} />
                </IconButton>
              </Box>
            ))}
          </Box>
        )}
      </Paper>

      {/* ── Save button ────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', gap: 2, mb: 4 }}>
        <Button variant="contained" size="large"
          startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
          disabled={saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save Dispatch'}
        </Button>
        <Button variant="outlined" onClick={() => navigate('/transactions/dispatches')}>Cancel</Button>
      </Box>

      {/* ── Lot Selection Modal ───────────────────────────────────────── */}
      <Dialog open={lotModal} onClose={() => setLotModal(false)} maxWidth="lg" fullWidth>
        <DialogTitle>
          Select Lot
          <IconButton onClick={() => setLotModal(false)} sx={{ position: 'absolute', right: 8, top: 8 }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <TextField size="small" label="Search Item" value={lotSearch}
              onChange={(e) => setLotSearch(e.target.value)}
              inputRef={lotSearchRef}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
              sx={{ width: 280 }} />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={hideZeroLot}
                  onChange={(e) => setHideZeroLot(e.target.checked)}
                />
              }
              label="Hide Zero Balance"
              sx={{ ml: 0, whiteSpace: 'nowrap' }}
            />
            {lotLoading && <CircularProgress size={20} sx={{ alignSelf: 'center' }} />}
          </Box>
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow sx={{ bgcolor: 'primary.main' }}>
                  {['Lot No.', 'Item', 'Balance Qty', 'Packing', 'Pack Wght', 'Arrival Date', 'Arrival Doc No.', 'Arrival Batch No.', 'Godowns', 'Remarks'].map((h) => (
                    <TableCell key={h} sx={{ bgcolor: 'primary.main', color: 'white', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {lots.length === 0 && !lotLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                      {form.fkPartyID
                        ? (hideZeroLot ? 'No lots with available balance found' : 'No lots found for this party')
                        : 'Select a party first'}
                    </TableCell>
                  </TableRow>
                ) : lots.map((lot) => {
                  const isZero = lot.TotalBalQty <= 0;
                  return (
                    <TableRow key={lot.LotNum} hover onClick={() => handleSelectLot(lot)}
                      sx={{
                        cursor: 'pointer',
                        opacity: isZero ? 0.55 : 1,
                        '&:hover': { bgcolor: 'primary.50' },
                      }}>
                      <TableCell sx={{ fontWeight: 'bold' }}>{lot.LotNum}</TableCell>
                      <TableCell>{lot.iName}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold', color: isZero ? 'text.secondary' : 'success.dark' }}>
                        {fmtNum(lot.TotalBalQty)}
                      </TableCell>
                      <TableCell>{lot.Packing}</TableCell>
                      <TableCell align="right">{lot.PackWght != null && lot.PackWght !== '' ? Math.round(lot.PackWght) : '—'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(lot.OriTransDt)}</TableCell>
                      <TableCell>{lot.BENum || '—'}</TableCell>
                      <TableCell>{lot.BatchNum || '—'}</TableCell>
                      <TableCell>
                        {(lot.godowns || []).filter((g) => g.BalQty > 0).map((g) => (
                          <Chip key={g.fkGodownID} label={`${g.gNum}: ${g.BalQty}`} size="small" sx={{ mr: 0.5 }} />
                        ))}
                      </TableCell>
                      <TableCell>{lot.TransRemark || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLotModal(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* ── Webcam Dialog ─────────────────────────────────────────────── */}
      <Dialog open={cameraOpen} onClose={stopCamera} maxWidth="sm" fullWidth>
        <DialogTitle>Capture Pickup Person Photo</DialogTitle>
        <DialogContent>
          <video ref={videoRef} autoPlay muted playsInline
            style={{ width: '100%', borderRadius: 8, background: '#000' }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={stopCamera}>Cancel</Button>
          <Button variant="contained" onClick={capturePhoto} startIcon={<VideocamIcon />}>Capture</Button>
        </DialogActions>
      </Dialog>

      {/* ── GatePass Print Dialog ─────────────────────────────────────── */}
      <Dialog open={gatepassDialog} maxWidth="xs" fullWidth>
        <DialogTitle>{isEdit ? 'Dispatch Updated!' : 'Dispatch Saved!'}</DialogTitle>
        <DialogContent>
          <Alert severity="success" sx={{ mb: 2 }}>
            {isEdit ? 'Dispatch updated successfully!' : 'Dispatch saved successfully!'}
          </Alert>
          {savedRow?.GatePass && (
            <Typography sx={{ mb: 2 }}>Gate Pass No.: <b>{savedRow.GatePass}</b></Typography>
          )}
          <Box sx={{ mb: 2, p: 1.5, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'grey.200' }}>
            <Typography variant="body2" sx={{ mb: 0.5 }}><strong>Party&nbsp;:</strong>&nbsp;{selParty?.pName || ''}</Typography>
            <Typography variant="body2" sx={{ mb: 0.5 }}><strong>Lot No.&nbsp;:</strong>&nbsp;{form.LotNum || '—'}</Typography>
            <Typography variant="body2" sx={{ mb: 0.5 }}><strong>Trans Qty&nbsp;:</strong>&nbsp;{fmtNum(totalQty)}{form.Packing ? ' ' + form.Packing : ''}</Typography>
            <Typography variant="body2"><strong>Balance Qty&nbsp;:</strong>&nbsp;{fmtNum(Math.max(0, totalBalQty - totalQty))}{form.Packing ? ' ' + form.Packing : ''}</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Do you want to print Gate Pass?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setGatepassDialog(false); setEmailDialog(true); }}>No</Button>
          <Button variant="contained" startIcon={<LocalShippingIcon />} onClick={handleViewGatepass}>
            Print Gate Pass
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Email Dialog ──────────────────────────────────────────────── */}
      <Dialog open={emailDialog} maxWidth="xs" fullWidth>
        <DialogTitle>Send Dispatch Email</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Do you want to send dispatch confirmation email to the party?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setEmailDialog(false); navigate('/transactions/dispatches'); }}>No</Button>
          <Button variant="contained"
            startIcon={emailSending ? <CircularProgress size={16} color="inherit" /> : <EmailIcon />}
            disabled={emailSending} onClick={handleSendEmail}>
            Send Email
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Email snackbar ────────────────────────────────────────────── */}
      <Snackbar open={emailSnack.open} autoHideDuration={4000}
        onClose={() => setEmailSnack((p) => ({ ...p, open: false }))}
        message={emailSnack.msg} />
    </Box>
  );
}
