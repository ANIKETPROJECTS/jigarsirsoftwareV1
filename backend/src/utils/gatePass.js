// Gate Pass PDF — A6 (105mm × 148mm)
// Layout:
//   Gate Pass (title, 13pt bold, centred)
//   Gate Pass No. <bold>  |  Date : DD-Mon-YY  H:MM am/pm
//   Party Name: ...
//   Item Name: <bold>
//   Quantity : <large 19pt bold>  {qty} {Packing} X {PackWght}kg
//   ─────────────────────────────────────────────
//   Type/Colour  {type}/{colour}   |   Lot No.:{lotNum}
//   Godown No.: <bold>{godown}     |   Hamali :  {hamali}
//   Vehical No.:{vehicle}
//   Supplier Name: {remark}
//   Balance: <large 17pt bold>  {balQty} {Packing}
//   Batch No:   {batchNum}
//
//   Prepare By

const PDFDocument = require('pdfkit');

// A6 in PDF points (1pt = 1/72 inch): 105mm × 148mm
const PW = 298; // 105 mm ≈ 297.6 pts
const PH = 420; // 148 mm ≈ 419.5 pts
const ML = 12;            // left margin
const MR = 12;            // right margin
const MW = PW - ML - MR; // 273 pt usable width

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Handles both JS Date objects and ISO/MySQL string formats safely.
function fmtDateGP(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return `${val.getDate()}-${MONTHS[val.getMonth()]}-${String(val.getFullYear()).slice(2)}`;
  }
  const s = String(val);
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${parseInt(m[3], 10)}-${MONTHS[parseInt(m[2], 10) - 1]}-${m[1].slice(2)}`;
  return s;
}

function fmtTimeGP(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const h  = val.getHours();
    const mm = String(val.getMinutes()).padStart(2, '0');
    return `${h % 12 || 12}:${mm} ${h >= 12 ? 'pm' : 'am'}`;
  }
  const m = String(val).match(/(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = parseInt(m[1], 10);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'pm' : 'am'}`;
}

function fmtNum(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '0';
  return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2);
}

function hrule(doc, y) {
  doc.save().moveTo(ML, y).lineTo(PW - MR, y).lineWidth(0.4).stroke('#000000').restore();
}

async function generateGatePassPDF({
  dispatch, party, item, company, gatePassNum,
  arv = {}, godown1Name = '', balance = 0,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A6', margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = 12;

    // Render label (Helvetica 10pt) + value at explicit (x, y).
    // widthOfString is measured BEFORE switching to value font so the font is set correctly.
    function lv(label, value, x, vy, opts = {}) {
      const { boldVal = false, valSize = 10, maxW } = opts;
      doc.font('Helvetica').fontSize(10).fillColor('#000000');
      const lw  = doc.widthOfString(label);
      doc.text(label, x, vy, { lineBreak: false });
      const val = value !== undefined && value !== null ? String(value) : '';
      if (val) {
        doc.font(boldVal ? 'Helvetica-Bold' : 'Helvetica').fontSize(valSize).fillColor('#000000');
        if (maxW) {
          doc.text(val, x + lw, vy, { lineBreak: false, width: maxW - lw, ellipsis: true });
        } else {
          doc.text(val, x + lw, vy, { lineBreak: false });
        }
      }
    }

    // ── Title ─────────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#000000')
      .text('Gate Pass', ML, y, { width: MW, align: 'center', lineBreak: false });
    y += 22;

    // ── Gate Pass No. | Date + Time ───────────────────────────────────────────
    lv('Gate Pass No.: ', gatePassNum || '', ML, y, { boldVal: true });
    const dateTime = `${fmtDateGP(dispatch.TransDt)}  ${fmtTimeGP(dispatch.TransTm)}`.trim();
    lv('Date : ', dateTime, ML + MW / 2, y);
    y += 19;

    // ── Party Name ────────────────────────────────────────────────────────────
    lv('Party Name: ', party.pName || '', ML, y, { maxW: MW });
    y += 19;

    // ── Item Name (bold value) ────────────────────────────────────────────────
    const itemStr = [item.iName, arv.ItemExtDesc || dispatch.ItemExtDesc].filter(Boolean).join(' ');
    lv('Item Name: ', itemStr, ML, y, { boldVal: true, maxW: MW });
    y += 19;

    // ── Quantity — large prominent line ───────────────────────────────────────
    // Format: {qty} {Packing} X {PackWght}kg   e.g. "10 Drum X 250kg"
    // PackWght (net weight per unit) is taken from the ARV entry.
    const qty      = Math.abs(parseFloat(dispatch.GodownQty1 || 0))
                   + Math.abs(parseFloat(dispatch.GodownQty2 || 0));
    // Prefer ARV data (clean) over dispatch row (may have garbled values from CSV import)
    const packing  = arv.Packing  || dispatch.Packing  || '';
    const packWght = parseFloat(arv.PackWght || dispatch.PackWght || 0);

    let qtyStr;
    if (packing && packWght > 0) {
      qtyStr = `${fmtNum(qty)} ${packing} X ${fmtNum(packWght)}kg`;
    } else if (packing) {
      qtyStr = `${fmtNum(qty)} ${packing}`;
    } else {
      qtyStr = `${fmtNum(qty)} Units`;
    }

    // "Quantity : " label (10pt) baseline-aligned with large value (20pt)
    doc.font('Helvetica').fontSize(10).fillColor('#000000');
    const qLabelW = doc.widthOfString('Quantity : ');
    doc.text('Quantity : ', ML, y + 10, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#000000')
      .text(qtyStr, ML + qLabelW, y, { lineBreak: false });
    y += 32;

    // ── Horizontal rule ───────────────────────────────────────────────────────
    hrule(doc, y);
    y += 8;

    // ── Two-column detail rows ────────────────────────────────────────────────
    const RC  = ML + MW / 2 + 2;   // right-column x start
    const ROW = 19;

    const packingType   = arv.PackingType   || dispatch.PackingType   || '';
    const packingColour = arv.PackingColour || dispatch.PackingColour || '';
    const lotNum        = arv.LotNum        || dispatch.LotNum        || '';
    const hamali        = parseFloat(dispatch.HamaliRecd || 0);
    const supplierName  = arv.TransRemark || dispatch.TransRemark || '';

    // Row 1: Type/Colour (left)  |  Lot No. (right)
    lv('Type/Colour  ', `${packingType}/${packingColour}`, ML, y);
    lv('Lot No.:', lotNum, RC, y);
    y += ROW;

    // Row 2: Godown No. bold (left)  |  Hamali (right, if > 0)
    lv('Godown No.: ', godown1Name, ML, y, { boldVal: true });
    if (hamali > 0) lv('Hamali :     ', fmtNum(hamali), RC, y);
    y += ROW;

    // Row 3: Vehicle (left only)
    lv('Vehical No.:', dispatch.VehiNum || '', ML, y);
    y += ROW;

    // Row 4: Supplier Name full-width (only if set)
    if (supplierName) {
      lv('Supplier Name:    ', supplierName, ML, y, { maxW: MW });
      y += ROW;
    }

    y += 6;

    // ── Balance — large prominent line ────────────────────────────────────────
    const balStr = packing ? `${fmtNum(balance)} ${packing}` : fmtNum(balance);

    doc.font('Helvetica').fontSize(10).fillColor('#000000');
    const bLabelW = doc.widthOfString('Balance: ');
    doc.text('Balance: ', ML, y + 8, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#000000')
      .text(balStr, ML + bLabelW, y, { lineBreak: false });
    y += 29;

    // ── Batch No. (dispatch entry's own batch number) ─────────────────────────
    const batchNum = dispatch.BatchNum || '';
    if (batchNum) {
      lv('Batch No:   ', batchNum, ML, y, { maxW: MW });
      y += ROW;
    }

    // ── Prepare By ────────────────────────────────────────────────────────────
    const sigY = Math.max(y + 28, PH - 45);
    doc.font('Helvetica').fontSize(10).fillColor('#000000')
      .text('Prepare By', ML, sigY, { lineBreak: false });

    doc.end();
  });
}

module.exports = { generateGatePassPDF };
