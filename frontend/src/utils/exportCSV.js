// exportCSV(filename, columns, rows)
// Downloads the given rows as a UTF-8 CSV file that opens correctly in Excel.
//
// columns  — array of { label: string, key?: string, format?: (row) => string }
//            Use `key` for direct field access, `format` for custom rendering.
// rows     — the data array (filtered list currently visible on screen)
export function exportCSV(filename, columns, rows) {
  const header = columns.map((c) => `"${c.label}"`).join(',');
  const body   = rows.map((row) =>
    columns.map((c) => {
      const raw = c.format ? c.format(row) : (row[c.key] ?? '');
      return `"${String(raw).replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\n');

  const csv  = `${header}\n${body}`;
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
