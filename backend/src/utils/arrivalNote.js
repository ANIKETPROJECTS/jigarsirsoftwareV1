const PDFDocument = require('pdfkit');
const path        = require('path');
const fs          = require('fs');

const ASSETS = path.join(__dirname, '../assets');

// Per-group branding: logo image, godown-address image, admin office text.
// Files must exist in backend/src/assets/
const GROUP_BRAND = {
  BHW: {
    logo:      path.join(ASSETS, 'AS_Image.jpg'),
    addr:      path.join(ASSETS, 'AS_Address.jpg'),
    adminLine: 'Admin Office : 83, L.L.Shah Marg, Dana Bunder, Masjid Bunder (E),' +
               ' Mumbai - 400009.  Tel No. - (022) 23484191, 23480452.',
  },
  VLCO: {
    logo:      path.join(ASSETS, 'VLCO_Address.png'),  // black-font letterhead image
    addr:      null,                                    // address rendered as text (addrText)
    addrText:  '83, L.L.Shah Marg, Opp Ashok Hotel, Dana Bunder, Masjid Bunder (E),' +
               ' Mumbai - 400009.  Mob - 8291706505.' +
               '  Email - veljilukhamsi@gmail.com' +
               '  Website - www.adityaservices.co.in',
    adminLine: '',
  },
};

// Fallback when groupID is unknown or not in the map
const DEFAULT_BRAND = GROUP_BRAND.BHW;

const CONDITIONS = [
  "Goods are stored at Party's own account & risk.",
  "We are not responsible for any leakage, shortage, loss or damage caused directly or indirectly by fire and/or white ants or by any other cause such as flood, water rains or through bursting water or electric or by fall or displacement of the building of the godown or of the adjoining building or to roil civil commotion, insurrection, revolution, rebellion material law war or other act of foreign enemy or by earthquake or by action lawfully constituted with foreign perils.",
  "Owner of the goods are bound to check their goods from time to time and to remove the goods from our godown without delay when asked for.",
  "Whatever loading unloading charges are to be borne by owner of the goods.",
  "We have right to remove the goods from one place to other if required.",
  "We could not guarantee the description & Packing particulars of the goods given by the owner.",
  "What so ever rules & regulations we deem proper implicated in future will be binding to the owner of the goods.",
  "Necessary licences should be obtained by the parties.",
  "If goods are not cleared within twelve months and storing charges are overdue the goods will be disposed at party's own account & risk.",
  "In respect of the goods stored in the company's warehouse the company's position will be that of a bailee as defined in the Indian Contract Act.",
  "The company shall have right of retention of whole or portion of the goods in event of non payment of storage charges.",
  "The goods shall be kept insured by the clients for adequate amount against all risks at their own costs. The clients shall see that the insurance company incorporates proper warranties in policy in respect of the premises where the goods are.",
  "We are not aware of the legality of the goods, the client solely shall be responsible for the goods and its contents.",
];

// ── palette ──────────────────────────────────────────────────────────────────
const C = {
  blue:    '#1565C0',
  lblue:   '#E3F2FD',
  zebra:   '#F0F7FF',
  white:   '#FFFFFF',
  black:   '#000000',
  dgray:   '#333333',
  mgray:   '#888888',
  lgray:   '#F5F5F5',
  bdr:     '#AAAAAA',
  hdrLine: '#7AADDF',
};

// Page geometry
const PW = 595;
const ML = 28;
const MW = PW - ML * 2;   // 539

function fmtDate(iso) {
  if (!iso) return '';
  if (iso instanceof Date) {
    const dd = String(iso.getDate()).padStart(2, '0');
    const mm = String(iso.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${iso.getFullYear()}`;
  }
  const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return String(iso);
}

function fmtNum(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '';
  return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2);
}

// Draw a filled-and-stroked rectangle
function box(doc, x, y, w, h, fill, stroke = C.bdr, lw = 0.5) {
  doc.save();
  doc.lineWidth(lw);
  if (fill && stroke) {
    doc.rect(x, y, w, h).fillAndStroke(fill, stroke);
  } else if (fill) {
    doc.rect(x, y, w, h).fill(fill);
  } else {
    doc.rect(x, y, w, h).stroke(stroke);
  }
  doc.restore();
}

// Vertical divider inside a row
function vline(doc, x, y, h) {
  doc.save().moveTo(x, y).lineTo(x, y + h).lineWidth(0.3).strokeColor(C.bdr).stroke().restore();
}

// Horizontal divider
function hline(doc, x, y, w) {
  doc.save().moveTo(x, y).lineTo(x + w, y).lineWidth(0.3).strokeColor(C.bdr).stroke().restore();
}

// Place text inside a cell with optional vertical centering
function txt(doc, str, x, y, w, cellH, opts = {}) {
  const {
    size   = 9,
    font   = 'Helvetica',
    color  = C.black,
    align  = 'left',
    padX   = 4,
    vpad   = 4,
  } = opts;
  const ty = cellH > 0 ? y + Math.max(vpad, (cellH - size * 1.2) / 2) : y + vpad;
  doc.fontSize(size).font(font).fillColor(color)
     .text(String(str ?? ''), x + padX, ty, { width: w - padX * 2, align, lineBreak: true });
}

// Draw footer colour bars (called on every page before doc.end or addPage)
function footerBars(doc) {
  const ph = doc.page.height;
  const fy = ph - 20;
  doc.rect(ML, fy,      MW, 6).fill('#FFA500');
  doc.rect(ML, fy + 6,  MW, 6).fill('#181266');
  doc.rect(ML, fy + 12, MW, 6).fill('#3065CF');
}

function generateArrivalNotePDF({ party, item, arrival, company, groupID }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const brand    = GROUP_BRAND[groupID] || DEFAULT_BRAND;
    let y          = 25;
    const compName = company.CompName || 'Aditya Services';

    // ════════════════════════════════════════════════════════════════
    // SECTION 1 — COMPANY HEADER
    // ════════════════════════════════════════════════════════════════

    // Row A: Logo (left 60%) | "ARRIVAL NOTE" badge (right 40%)
    const logoW  = Math.round(MW * 0.60);
    const badgeW = MW - logoW;
    const rowAH  = 54;

    box(doc, ML,           y, logoW,  rowAH, C.white, C.blue, 1);
    box(doc, ML + logoW,   y, badgeW, rowAH, C.blue,  C.blue, 1);

    if (fs.existsSync(brand.logo)) {
      doc.image(brand.logo, ML + 5, y + 5, { fit: [logoW - 10, rowAH - 10] });
    }
    doc.fontSize(15).font('Helvetica-Bold').fillColor(C.white)
       .text('ARRIVAL NOTE', ML + logoW, y + 10, { width: badgeW, align: 'center' });
    doc.fontSize(7).font('Helvetica').fillColor('#BFD9F5')
       .text('Subject to Mumbai Jurisdiction', ML + logoW, y + 30, { width: badgeW, align: 'center' });
    y += rowAH;

    // Row B: Admin Office line (hidden when brand has no adminLine)
    const rowBH = 15;
    box(doc, ML, y, MW, rowBH, C.lblue, C.blue, 0.7);
    if (brand.adminLine) {
      doc.fontSize(7).font('Helvetica').fillColor(C.dgray)
         .text(brand.adminLine, ML + 2, y + 3.5, { width: MW - 4, align: 'center' });
    }
    y += rowBH;

    // Row C: Godown address — image for BHW, centred text for VLCO
    const rowCH = 68;
    box(doc, ML, y, MW, rowCH, C.white, C.blue, 0.7);
    if (brand.addrText) {
      doc.fontSize(8).font('Helvetica').fillColor(C.dgray)
         .text(brand.addrText, ML + 6, y + (rowCH / 2) - 8, { width: MW - 12, align: 'center' });
    } else if (brand.addr && fs.existsSync(brand.addr)) {
      doc.image(brand.addr, ML + 4, y + 4, { fit: [MW - 8, rowCH - 8] });
    }
    y += rowCH;

    // ════════════════════════════════════════════════════════════════
    // SECTION 2 — PARTY INFO (left) | DOCUMENT INFO (right)
    // ════════════════════════════════════════════════════════════════
    y += 6;

    const partyW  = Math.round(MW * 0.56);
    const docInfoW = MW - partyW;
    const sec2H   = 92;

    // Party box
    box(doc, ML, y, partyW, sec2H, C.white, C.blue, 1);
    // Party header band
    box(doc, ML, y, partyW, 15, C.blue, C.blue, 0);
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.white)
       .text('TO :', ML + 4, y + 4, { width: partyW - 8 });

    let py = y + 17;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(C.black)
       .text(`M/S, ${party.pName || ''}`, ML + 4, py, { width: partyW - 8 });
    py = doc.y + 2;
    if (party.pBillAdd) {
      doc.fontSize(7.5).font('Helvetica').fillColor(C.dgray)
         .text(party.pBillAdd, ML + 4, py, { width: partyW - 8 });
      py = doc.y + 2;
    }
    if (party.GSTNo) {
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.dgray)
         .text(`GST No.: ${party.GSTNo}`, ML + 4, py, { width: partyW - 8 });
    }

    // Document info box
    const dX = ML + partyW;
    box(doc, dX, y, docInfoW, sec2H, C.white, C.blue, 1);
    box(doc, dX, y, docInfoW, 15, C.blue, C.blue, 0);
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.white)
       .text('DOCUMENT DETAILS', dX + 4, y + 4, { width: docInfoW - 8, align: 'center' });

    const docFields = [
      ['Lot No.', arrival.LotNum  || '—'],
      ['Doc No.', arrival.BENum   || '—'],
      ['Date',    fmtDate(arrival.TransDt)],
    ];
    const dRowH = (sec2H - 15) / docFields.length;
    const lW    = 52;
    docFields.forEach(([label, val], i) => {
      const ry = y + 15 + i * dRowH;
      if (i > 0) hline(doc, dX + 2, ry, docInfoW - 4);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(C.mgray)
         .text(label, dX + 4, ry + (dRowH - 8) / 2, { width: lW });
      doc.fontSize(9).font('Helvetica').fillColor(C.black)
         .text(val, dX + 4 + lW, ry + (dRowH - 9) / 2, { width: docInfoW - lW - 8 });
    });

    y += sec2H + 8;

    // ════════════════════════════════════════════════════════════════
    // SECTION 3 — GOODS TABLE
    // ════════════════════════════════════════════════════════════════

    // Column definitions (widths must sum to MW = 539)
    const COLS = [
      { label: 'Sr.',                   w: 30,  align: 'center' },
      { label: 'Description of Goods',  w: 172, align: 'left'   },
      { label: 'Packing',               w: 66,  align: 'center' },
      { label: 'Quantity',              w: 64,  align: 'center' },
      { label: 'Wt / Pkg (kg)',         w: 95,  align: 'center' },
      { label: 'Total Wt (kg)',         w: 112, align: 'center' },
    ];

    // Table header row
    const tHH = 22;
    box(doc, ML, y, MW, tHH, C.blue, C.blue, 0);
    doc.rect(ML, y, MW, tHH).lineWidth(1).stroke(C.blue);
    let cx = ML;
    COLS.forEach((col, i) => {
      if (i > 0) vline(doc, cx, y, tHH);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(C.white)
         .text(col.label, cx + 3, y + (tHH - 8) / 2, { width: col.w - 6, align: col.align });
      cx += col.w;
    });
    y += tHH;

    // Data row
    const qty    = fmtNum(arrival.GodownQty1);
    const wt     = fmtNum(arrival.PackWght);
    const totWt  = fmtNum(parseFloat(arrival.GodownQty1 || 0) * parseFloat(arrival.PackWght || 0));
    const iDesc  = [item.iName, arrival.ItemExtDesc].filter(Boolean).join(' ');
    const dRowH2 = 30;

    box(doc, ML, y, MW, dRowH2, C.white, C.bdr, 0.5);
    cx = ML;
    const rowVals = ['1', iDesc, arrival.Packing || '—', qty, wt, totWt];
    COLS.forEach((col, i) => {
      if (i > 0) vline(doc, cx, y, dRowH2);
      doc.fontSize(i === 1 ? 9 : 9)
         .font(i === 1 ? 'Helvetica-Bold' : 'Helvetica')
         .fillColor(C.black)
         .text(rowVals[i], cx + 3, y + (dRowH2 - 9) / 2, { width: col.w - 6, align: col.align });
      cx += col.w;
    });
    y += dRowH2;

    // Total row  (spans first 3 cols for label; individual values for Qty, Wt/Pkg, TotWt)
    const spanW  = COLS[0].w + COLS[1].w + COLS[2].w;  // 268
    const totRH  = 20;
    box(doc, ML, y, MW, totRH, C.lblue, C.bdr, 0.5);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(C.blue)
       .text('Total', ML + 4, y + (totRH - 9) / 2, { width: spanW - 8 });
    let tx = ML + spanW;
    vline(doc, tx, y, totRH);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(C.black)
       .text(qty, tx + 3, y + (totRH - 9) / 2, { width: COLS[3].w - 6, align: 'center' });
    tx += COLS[3].w;
    vline(doc, tx, y, totRH);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(C.black)
       .text(wt, tx + 3, y + (totRH - 9) / 2, { width: COLS[4].w - 6, align: 'center' });
    tx += COLS[4].w;
    vline(doc, tx, y, totRH);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(C.blue)
       .text(`${totWt} kg`, tx + 3, y + (totRH - 9) / 2, { width: COLS[5].w - 6, align: 'center' });
    y += totRH;

    // ════════════════════════════════════════════════════════════════
    // SECTION 4 — REMARKS
    // ════════════════════════════════════════════════════════════════
    y += 6;
    const rmkH  = 34;
    const rmkLW = 62;
    box(doc, ML,          y, rmkLW, rmkH, C.lgray, C.bdr, 0.5);
    box(doc, ML + rmkLW,  y, MW - rmkLW, rmkH, C.white, C.bdr, 0.5);
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(C.dgray)
       .text('Remarks :', ML + 4, y + (rmkH - 8.5) / 2, { width: rmkLW - 8 });
    if (arrival.TransRemark) {
      doc.fontSize(8.5).font('Helvetica').fillColor(C.black)
         .text(arrival.TransRemark, ML + rmkLW + 4, y + 8, { width: MW - rmkLW - 8 });
    }
    y += rmkH + 8;

    // ════════════════════════════════════════════════════════════════
    // SECTION 5 — SIGNATURE BOX
    // ════════════════════════════════════════════════════════════════
    const sigW = 210;
    const sigX = ML + MW - sigW;
    const sigH = 48;
    box(doc, sigX, y, sigW, sigH, C.lgray, C.blue, 0.7);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(C.blue)
       .text(`For ${compName}`, sigX, y + 8, { width: sigW, align: 'center' });
    doc.save().moveTo(sigX + 20, y + 37).lineTo(sigX + sigW - 20, y + 37)
       .lineWidth(0.6).strokeColor(C.mgray).stroke().restore();
    doc.fontSize(7.5).font('Helvetica').fillColor(C.mgray)
       .text('Authorised Signatory', sigX, y + 39, { width: sigW, align: 'center' });
    y += sigH + 10;

    // ════════════════════════════════════════════════════════════════
    // SECTION 6 — CONDITIONS OF STORAGE
    // ════════════════════════════════════════════════════════════════
    const condFontSize = 7.5;
    const condPadY     = 3;
    const condPadX     = 5;
    const condW        = MW - condPadX * 2;

    // Measure all conditions first so we can decide if a page break is needed
    doc.fontSize(condFontSize).font('Helvetica');
    const condHeights = CONDITIONS.map((c, i) =>
      doc.heightOfString(`${i + 1}.  ${c}`, { width: condW })
    );
    const condTitleH = 18;
    const totalCondH = condTitleH + condHeights.reduce((s, h) => s + h + condPadY * 2, 0);

    // If conditions don't fit on current page, start a new page
    const pageBottom = doc.page.height - 30;  // leave 30pt for footer
    if (y + totalCondH > pageBottom) {
      footerBars(doc);
      doc.addPage();
      y = 25;
    }

    // Conditions title bar
    box(doc, ML, y, MW, condTitleH, C.blue, C.blue, 0);
    doc.rect(ML, y, MW, condTitleH).lineWidth(1).stroke(C.blue);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(C.white)
       .text('CONDITIONS OF STORAGE', ML, y + 4.5, { width: MW, align: 'center' });
    y += condTitleH;

    // Condition rows (zebra striped)
    CONDITIONS.forEach((cond, i) => {
      const ch  = condHeights[i];
      const rowH3 = ch + condPadY * 2;
      const bg  = i % 2 === 0 ? C.zebra : C.white;
      box(doc, ML, y, MW, rowH3, bg, C.bdr, 0.3);
      doc.fontSize(condFontSize).font('Helvetica').fillColor(C.dgray)
         .text(`${i + 1}.  ${cond}`, ML + condPadX, y + condPadY, { width: condW });
      y += rowH3;

      // Page overflow guard (mid-conditions)
      if (i < CONDITIONS.length - 1 && y > pageBottom - 20) {
        footerBars(doc);
        doc.addPage();
        y = 25;
      }
    });

    footerBars(doc);
    doc.end();
  });
}

module.exports = { generateArrivalNotePDF };
