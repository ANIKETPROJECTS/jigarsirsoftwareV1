// balanceReportPDF.js — generates a party-balance-detail PDF using pdfkit
//
// Data shape expected:
//   lots[]  — each lot has: pName, LotNum, iName, ItemExtDesc, ArvDt, ArvQty,
//             balance, Packing, PackWght, obQty, txns[]
//   txns[]  — each tx has: TransDt, TransQty, DoNum, TransExtDetail, TransType
const PDFDocument = require('pdfkit');

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDt(s) {
  if (!s) return '';
  const str = s instanceof Date ? s.toISOString() : String(s);
  const d   = str.slice(0, 10);
  const [y, m, day] = d.split('-');
  return `${day}-${MONTHS[parseInt(m, 10) - 1]}-${y}`;
}

function f2(v) {
  const n = parseFloat(v);
  if (isNaN(n) || n === 0) return n === 0 ? '0' : '';
  return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2);
}

const PW     = 595.28;
const PH     = 841.89;
const M      = 30;              // margin
const CW     = PW - M * 2;     // 535.28

// Main table column widths — sum must equal CW (535)
// LotNo | Item | ArvDate | ArvQty | Packing | PackWt | Balance
const MW = [55, 220, 55, 40, 55, 40, 70];

// Sub-table (indented 20pt) — sum = CW - 20 = 515
const SI = 20;
const SW = CW - SI;
// Date | Qty | Balance | DoNo | Particulars  => 55+40+50+60+310 = 515
const SW_COLS = [55, 40, 50, 60, SW - 205];

function hLine(doc, y, x = M, w = CW, color = '#cccccc', lw = 0.5) {
  doc.save().moveTo(x, y).lineTo(x + w, y).strokeColor(color).lineWidth(lw).stroke().restore();
}

function fillRect(doc, x, y, w, h, color) {
  doc.save().rect(x, y, w, h).fillColor(color).fill().restore();
}

// Draw a single row of cells; returns nextY
function drawRow(doc, cells, y, x, widths, opts = {}) {
  const { fontSize = 8, font = 'Helvetica', color = 'black', rowH = 13 } = opts;
  doc.font(font).fontSize(fontSize).fillColor(color);
  let cx = x;
  for (let i = 0; i < cells.length; i++) {
    const c     = cells[i];
    const txt   = (c && typeof c === 'object') ? String(c.text ?? '') : String(c ?? '');
    const align = (c && typeof c === 'object' && c.align) || 'left';
    doc.text(txt, cx + 2, y + 2, { width: widths[i] - 4, align, lineBreak: false });
    cx += widths[i];
  }
  doc.y = y + rowH;
  return y + rowH;
}

function renderPageHeader(doc, compName, startDate, endDate) {
  doc.y = M;
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#181266')
    .text(compName.toUpperCase(), M, M, { width: CW, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#444')
    .text('Balance Report', M, undefined, { width: CW, align: 'center' });
  const range = startDate
    ? `From ${fmtDt(startDate)}  To  ${fmtDt(endDate)}`
    : `As on  ${fmtDt(endDate)}`;
  doc.text(range, M, undefined, { width: CW, align: 'center' });
  doc.moveDown(0.3);
  hLine(doc, doc.y, M, CW, '#000', 1);
  doc.moveDown(0.4);
}

async function generateBalanceReportPDF({ lots = [], compName = '', startDate, endDate }) {
  return new Promise((resolve, reject) => {
    const doc  = new PDFDocument({ size: 'A4', margin: M, autoFirstPage: true });
    const bufs = [];
    doc.on('data', b => bufs.push(b));
    doc.on('end',  () => resolve(Buffer.concat(bufs)));
    doc.on('error', reject);

    const checkBreak = (needed) => {
      if (doc.y + needed > PH - M - 15) {
        doc.addPage();
        renderPageHeader(doc, compName, startDate, endDate);
      }
    };

    renderPageHeader(doc, compName, startDate, endDate);

    // Group lots by party (preserving order)
    const partyMap = new Map();
    for (const lot of lots) {
      if (!partyMap.has(lot.pName)) partyMap.set(lot.pName, []);
      partyMap.get(lot.pName).push(lot);
    }

    const MAIN_HDRS = [
      { text: 'Lot No.',   align: 'left'   },
      { text: 'Item',      align: 'left'   },
      { text: 'Arv Date',  align: 'center' },
      { text: 'Arv Qty',   align: 'right'  },
      { text: 'Packing',   align: 'left'   },
      { text: 'Pack Wt',   align: 'right'  },
      { text: 'Balance',   align: 'right'  },
    ];
    const SUB_HDRS = [
      { text: 'Date',        align: 'left'  },
      { text: 'Qty',         align: 'right' },
      { text: 'Balance',     align: 'right' },
      { text: 'Do No.',      align: 'left'  },
      { text: 'Particulars', align: 'left'  },
    ];

    let firstParty = true;

    for (const [pName, pLots] of partyMap) {
      if (!firstParty) {
        doc.moveDown(0.4);
        hLine(doc, doc.y, M, CW, '#000', 0.8);
        doc.moveDown(0.3);
      }
      firstParty = false;

      checkBreak(55);

      // Party heading
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#181266')
        .text(pName, M, doc.y);
      doc.moveDown(0.15);

      // Main table header
      checkBreak(16);
      const mhY = doc.y;
      fillRect(doc, M, mhY, CW, 14, '#dde4f7');
      drawRow(doc, MAIN_HDRS, mhY, M, MW, { fontSize: 8, font: 'Helvetica-Bold', rowH: 14 });
      hLine(doc, doc.y, M, CW, '#333', 0.8);

      let partyTot = 0;

      for (const lot of pLots) {
        const bal = parseFloat(lot.balance) || 0;
        partyTot += bal;

        checkBreak(14);
        const mY   = doc.y;
        const item = [lot.iName, lot.ItemExtDesc].filter(Boolean).join(' – ');
        drawRow(doc, [
          { text: lot.LotNum || '',   align: 'left'   },
          { text: item,               align: 'left'   },
          { text: fmtDt(lot.ArvDt),  align: 'center' },
          { text: f2(lot.ArvQty),    align: 'right'  },
          { text: lot.Packing || '',  align: 'left'   },
          { text: f2(lot.PackWght),  align: 'right'  },
          { text: f2(bal),           align: 'right'  },
        ], mY, M, MW, { rowH: 13 });
        hLine(doc, doc.y, M, CW, '#e0e0e0');

        // Sub-table for dispatch history
        if (Array.isArray(lot.txns) && lot.txns.some(t => t.TransType !== 'ARV')) {
          const SL    = M + SI;
          const obQty = startDate ? (parseFloat(lot.obQty) || 0) : 0;
          let   runBal = obQty;
          const showArvAsOpening = !startDate || obQty === 0;
          let   usedArvOpening   = false;

          // Sub header
          checkBreak(13);
          const shY = doc.y;
          fillRect(doc, SL, shY, SW, 12, '#f3f3f3');
          drawRow(doc, SUB_HDRS, shY, SL, SW_COLS, { fontSize: 7, font: 'Helvetica-Bold', color: '#333', rowH: 12 });
          hLine(doc, doc.y, SL, SW, '#999');

          for (const tx of lot.txns) {
            const qty   = parseFloat(tx.TransQty) || 0;
            runBal     += qty;
            const isARV = tx.TransType === 'ARV';

            if (isARV && showArvAsOpening && !usedArvOpening) {
              usedArvOpening = true;
              checkBreak(10);
              drawRow(doc, [
                { text: fmtDt(tx.TransDt), align: 'left'  },
                { text: f2(qty),            align: 'right' },
                { text: 'Opening',          align: 'right' },
                { text: '',  align: 'left' },
                { text: '',  align: 'left' },
              ], doc.y, SL, SW_COLS, { fontSize: 7, font: 'Helvetica-Oblique', color: '#666', rowH: 10 });
            } else if (!isARV) {
              checkBreak(10);
              const txY = doc.y;
              drawRow(doc, [
                { text: fmtDt(tx.TransDt),      align: 'left'  },
                { text: f2(qty),                 align: 'right' },
                { text: f2(runBal),              align: 'right' },
                { text: tx.DoNum || '',          align: 'left'  },
                { text: tx.TransExtDetail || '', align: 'left'  },
              ], txY, SL, SW_COLS, { fontSize: 7, rowH: 10 });
              hLine(doc, doc.y, SL, SW, '#eee');
            }
          }
          doc.y += 2;
        }
      }

      // Party total
      checkBreak(16);
      hLine(doc, doc.y + 2, M, CW, '#333', 0.8);
      doc.y += 5;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('black')
        .text(`Total Balance :  ${f2(partyTot)}`, M, doc.y, { width: CW, align: 'right' });
      doc.moveDown(0.2);
    }

    // Footer
    doc.moveDown(0.6);
    hLine(doc, doc.y, M, CW, '#aaa');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(7).fillColor('#888')
      .text('This is a computer generated report subject to physical verification.', M, doc.y, { width: CW, align: 'center' });

    doc.end();
  });
}

module.exports = { generateBalanceReportPDF };
