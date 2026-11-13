// ─────────────────────────────────────────────────────────────────────────────
// AttendancePage.jsx  —  /transactions/attendance
//
// VB6 origin: frmAttendanceEntry.frm
//
// Grid layout:
//   Rows    = Dates  (fromDate → toDate), one row per day
//   Columns = Employees, sorted by eType then eShortName, grouped by type header
//
// Employee header has a checkbox below the name:
//   Checked      = all days Present  for that employee
//   Unchecked    = all days Absent   for that employee
//   Indeterminate= mixed (some days differ)
//   Click        = toggle entire month for that employee
//
// Holiday color coding (matches VB6 udfMarkHoliday + Sunday check):
//   Sunday                         → Green  (overrides everything)
//   hBoard='Y' AND hOffice='Y'     → Red    (both holidays — all employees)
//   hBoard='Y' AND eType ≠ 'Off'   → Blue   (board holiday — labour only)
//   hOffice='Y' AND eType = 'Off'  → Yellow (office holiday — office staff only)
//
// Default state: all employees Present ('Y') — overridden by existing DB records.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box, Paper, Typography, Button, TextField,
  Select, FormControl, InputLabel, MenuItem,
  Alert, CircularProgress, Checkbox, Chip, Tooltip,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Constants ──────────────────────────────────────────────────────────────

const OFFICE_TYPE = 'Off'; // VB6 eType code for Office employees

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Helpers ────────────────────────────────────────────────────────────────

function buildDateRange(fromDate, toDate) {
  const dates = [];
  let d = new Date(fromDate + 'T00:00:00');
  const end = new Date(toDate + 'T00:00:00');
  while (d <= end) {
    // Use local date parts — toISOString() would shift to UTC and give previous day in IST (UTC+5:30)
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${dy}`);
    d = new Date(d.getTime() + 86_400_000);
  }
  return dates;
}

// Cell background — Sunday overrides holidays (mirrors VB6 priority)
function computeCellBg(dateStr, empType, holidayMap) {
  const date = new Date(dateStr + 'T00:00:00');
  if (date.getDay() === 0) return '#b7f5b7'; // Sunday → green

  const h = holidayMap[dateStr];
  if (!h) return undefined;

  const isBoard  = h.hBoard  === 'Y';
  const isOffice = h.hOffice === 'Y';

  if (isBoard && isOffice)                    return '#ffaaaa'; // Red   — both holidays
  if (isBoard  && empType !== OFFICE_TYPE)    return '#aaaaff'; // Blue  — board, non-office
  if (isOffice && empType === OFFICE_TYPE)    return '#fffaaa'; // Yellow— office holiday
  return undefined;
}

// Row background for the date label column
function computeRowBg(dateStr, holidayMap) {
  const date = new Date(dateStr + 'T00:00:00');
  if (date.getDay() === 0) return '#b7f5b7';
  const h = holidayMap[dateStr];
  if (!h) return undefined;
  if (h.hBoard === 'Y' && h.hOffice === 'Y') return '#ffaaaa';
  if (h.hBoard === 'Y')  return '#aaaaff';
  if (h.hOffice === 'Y') return '#fffaaa';
  return undefined;
}

function getDefaultDates() {
  const today = new Date();
  const y  = today.getFullYear();
  const mo = today.getMonth() + 1;                      // 1–12
  const mm = String(mo).padStart(2, '0');
  // Last day of current month: day 0 of next month
  const lastDay = String(new Date(y, mo, 0).getDate()).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${lastDay}` };
}

// ── Sticky table styles ────────────────────────────────────────────────────

const S = {
  stickyCorner: {
    position: 'sticky', top: 0, left: 0, zIndex: 3,
    background: '#1565c0', color: '#fff',
    padding: '4px 8px', textAlign: 'center',
    fontWeight: 700, fontSize: 11,
    border: '1px solid #0d47a1', minWidth: 180,
  },
  th: {
    position: 'sticky', top: 0, zIndex: 2,
    background: '#1565c0', color: '#fff',
    padding: '3px 5px', textAlign: 'center',
    fontSize: 11, fontWeight: 600,
    border: '1px solid #0d47a1', minWidth: 56, maxWidth: 72,
  },
  thEmpName: {
    position: 'sticky', zIndex: 2,
    background: '#1976d2', color: '#fff',
    padding: '4px 4px', textAlign: 'center',
    fontSize: 11, border: '1px solid #1565c0',
    minWidth: 56, maxWidth: 72,
  },
  tdLeft: {
    position: 'sticky', left: 0, zIndex: 1,
    background: '#f5f5f5', padding: '2px 8px',
    border: '1px solid #ddd', minWidth: 180,
    fontSize: 12, whiteSpace: 'nowrap',
  },
  tdCell: {
    textAlign: 'center', padding: '0 2px',
    border: '1px solid #e0e0e0', cursor: 'pointer',
  },
};

// ── Component ──────────────────────────────────────────────────────────────

export default function AttendancePage() {
  const { can } = useAuth();
  const defaults = getDefaultDates();

  const [fromDate,    setFromDate]    = useState(defaults.from);
  const [toDate,      setToDate]      = useState(defaults.to);
  const [empTypeCode, setEmpTypeCode] = useState('');
  const [empIDFilter, setEmpIDFilter] = useState('');

  const [empTypes, setEmpTypes] = useState([]);
  const [allEmps,  setAllEmps]  = useState([]);

  const [employees,  setEmployees]  = useState([]);
  const [holidayMap, setHolidayMap] = useState({});
  const [attendance, setAttendance] = useState({});
  const [dates,      setDates]      = useState([]);
  const [faYear,     setFaYear]     = useState('');

  const [loaded,  setLoaded]  = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [dirty,   setDirty]   = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  // Measure the first header row height so the second row can sticky below it
  const typeRowRef  = useRef(null);
  const [typeRowH, setTypeRowH] = useState(28); // default until measured
  useEffect(() => {
    if (typeRowRef.current) setTypeRowH(typeRowRef.current.offsetHeight);
  }, [loaded, employees.length]);

  useEffect(() => {
    api.get('/transactions/attendance/meta')
      .then(({ data }) => {
        setEmpTypes(data.empTypes  || []);
        setAllEmps(data.employees  || []);
      })
      .catch(() => {});
  }, []);

  function validateDates() {
    if (!fromDate || !toDate)  return 'Both dates are required';
    if (fromDate > toDate)     return 'From Date cannot be greater than To Date';
    const days = (new Date(toDate) - new Date(fromDate)) / 86_400_000 + 1;
    if (days > 92)             return 'Date range cannot exceed 3 months (92 days)';
    return null;
  }

  async function handleGo() {
    const err = validateDates();
    if (err) { setError(err); return; }
    setError(''); setSuccess(''); setLoading(true);

    try {
      const { data } = await api.post('/transactions/attendance/load', {
        fromDate,
        toDate,
        empTypeCode: empTypeCode || undefined,
        empID:       empIDFilter || undefined,
      });

      const newDates = buildDateRange(fromDate, toDate);
      setDates(newDates);
      setEmployees(data.employees || []);
      setFaYear(data.faYear || '');

      const hMap = {};
      for (const h of data.holidays || []) {
        const ds = String(h.hDate || '').slice(0, 10);
        if (ds) hMap[ds] = { hBoard: h.hBoard, hOffice: h.hOffice };
      }
      setHolidayMap(hMap);

      // Default all Present; override with DB records
      const aMap = {};
      for (const emp of data.employees || []) {
        aMap[emp.pkEmpID] = {};
        for (const ds of newDates) aMap[emp.pkEmpID][ds] = 'Y';
      }
      for (const rec of data.attendance || []) {
        const ds = String(rec.aDate || '').slice(0, 10);
        if (aMap[rec.fkEmpID] && ds) aMap[rec.fkEmpID][ds] = rec.aPresent;
      }
      setAttendance(aMap);
      setLoaded(true);
      setDirty(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  }

  // Toggle a single cell
  function toggleCell(empID, dateStr) {
    setAttendance(prev => ({
      ...prev,
      [empID]: {
        ...prev[empID],
        [dateStr]: prev[empID]?.[dateStr] === 'N' ? 'Y' : 'N',
      },
    }));
    setDirty(true);
  }

  // Mark all days for one employee (used by header checkbox)
  function markEmpAllDays(empID, val) {
    setAttendance(prev => {
      const next = { ...prev, [empID]: {} };
      for (const ds of dates) next[empID][ds] = val;
      return next;
    });
    setDirty(true);
  }

  // Header checkbox state for an employee:
  //   all Present  → checked=true,  indeterminate=false
  //   all Absent   → checked=false, indeterminate=false
  //   mixed        → checked=false, indeterminate=true
  function empCheckState(empID) {
    const vals = dates.map(ds => attendance[empID]?.[ds] ?? 'Y');
    const allP = vals.every(v => v !== 'N');
    const allA = vals.every(v => v === 'N');
    return { checked: allP, indeterminate: !allP && !allA };
  }

  async function handleSave() {
    const err = validateDates();
    if (err) { setError(err); return; }
    if (employees.length === 0) return;

    setSaving(true); setError(''); setSuccess('');
    try {
      const entries = [];
      for (const emp of employees) {
        for (const ds of dates) {
          entries.push({
            fkEmpID:  emp.pkEmpID,
            aDate:    ds,
            aPresent: attendance[emp.pkEmpID]?.[ds] ?? 'Y',
            aFaYear:  faYear,
          });
        }
      }

      const { data } = await api.post('/transactions/attendance/save', { entries });
      setSuccess(`Attendance saved — ${data.saved} record(s) updated.`);
      if (data.errors?.length > 0)
        setError(`${data.errors.length} record(s) failed: ${data.errors.join('; ')}`);
      setDirty(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const labourPresentCount = useCallback((dateStr) => {
    return employees.filter(
      e => e.eType !== OFFICE_TYPE && attendance[e.pkEmpID]?.[dateStr] !== 'N'
    ).length;
  }, [employees, attendance]);

  const groupedEmps = useMemo(() => {
    const groups = {};
    for (const emp of employees) {
      if (!groups[emp.eType]) groups[emp.eType] = [];
      groups[emp.eType].push(emp);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [employees]);

  const flatEmps = useMemo(() => groupedEmps.flatMap(([, emps]) => emps), [groupedEmps]);

  const typeLabel = useMemo(() => {
    const m = {};
    for (const t of empTypes) m[t.VCCode] = t.VCData;
    return m;
  }, [empTypes]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <Box>
      <Typography variant="h6" fontWeight={600} mb={2}>Attendance Entry</Typography>

      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* ── Filter Toolbar ─────────────────────────────────────────────── */}
      <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <TextField
            label="From Date *" type="date" size="small"
            value={fromDate} onChange={e => setFromDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 170 }}
          />
          <TextField
            label="To Date *" type="date" size="small"
            value={toDate} onChange={e => setToDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 170 }}
          />

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Employee Type</InputLabel>
            <Select label="Employee Type" value={empTypeCode} onChange={e => setEmpTypeCode(e.target.value)}>
              <MenuItem value="">All Types</MenuItem>
              {empTypes.map(t => (
                <MenuItem key={t.VCCode} value={t.VCCode}>{t.VCData}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Employee</InputLabel>
            <Select label="Employee" value={empIDFilter} onChange={e => setEmpIDFilter(e.target.value)}>
              <MenuItem value="">All Employees</MenuItem>
              {allEmps
                .filter(e => !empTypeCode || e.eType === empTypeCode)
                .map(e => (
                  <MenuItem key={e.pkEmpID} value={e.pkEmpID}>{e.eShortName}</MenuItem>
                ))}
            </Select>
          </FormControl>

          <Button
            variant="contained" size="small"
            onClick={handleGo}
            disabled={loading}
            sx={{ height: 40, minWidth: 80 }}
          >
            {loading ? <CircularProgress size={18} color="inherit" /> : 'Go'}
          </Button>
        </Box>
      </Paper>

      {loaded && (
        <>
          {/* ── Holiday Legend ───────────────────────────────────────────── */}
          <Box sx={{ display: 'flex', gap: 2, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography variant="caption" fontWeight={700} sx={{ mr: 0.5 }}>Legend:</Typography>
            {[
              { label: 'Sunday',         bg: '#b7f5b7' },
              { label: 'Board Holiday',  bg: '#aaaaff' },
              { label: 'Office Holiday', bg: '#fffaaa' },
              { label: 'Board + Office', bg: '#ffaaaa' },
            ].map(({ label, bg }) => (
              <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 14, height: 14, bgcolor: bg, border: '1px solid #bbb', borderRadius: '2px' }} />
                <Typography variant="caption">{label}</Typography>
              </Box>
            ))}
          </Box>

          {/* ── Attendance Grid ──────────────────────────────────────────── */}
          {employees.length === 0 ? (
            <Alert severity="info">No employees found for the selected filters.</Alert>
          ) : (
            <Box
              sx={{
                overflow: 'auto',
                maxHeight: 'calc(100vh - 340px)',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              <table style={{ borderCollapse: 'collapse', minWidth: 'max-content', tableLayout: 'auto' }}>
                <thead>
                  {/* Row 1: Employee Type group headers — ref used to measure height for Row 2 sticky top */}
                  <tr ref={typeRowRef}>
                    <th rowSpan={2} style={S.stickyCorner}>
                      Date · Day · Labour
                    </th>

                    {groupedEmps.map(([typeCode, emps]) => (
                      <th
                        key={typeCode}
                        colSpan={emps.length}
                        style={{ ...S.th, borderLeft: '2px solid #0d47a1' }}
                      >
                        {typeLabel[typeCode] || typeCode}
                        <span style={{ marginLeft: 4, opacity: 0.7, fontWeight: 400 }}>({emps.length})</span>
                      </th>
                    ))}
                  </tr>

                  {/* Row 2: Employee names + whole-month toggle checkbox */}
                  <tr>
                    {flatEmps.map(emp => {
                      const { checked, indeterminate } = empCheckState(emp.pkEmpID);
                      return (
                        <th key={emp.pkEmpID} style={{ ...S.thEmpName, top: typeRowH }}>
                          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                            {/* Rotated employee name */}
                            <span style={{
                              writingMode: 'vertical-rl',
                              textOrientation: 'mixed',
                              transform: 'rotate(180deg)',
                              fontSize: 10,
                              lineHeight: 1.1,
                              maxHeight: 80,
                              overflow: 'hidden',
                              display: 'block',
                            }}>
                              {emp.eShortName}
                            </span>

                            {/* Whole-month toggle: checked=All Present, unchecked=All Absent */}
                            <Tooltip title={checked ? 'Click to mark all Absent' : 'Click to mark all Present'} arrow>
                              <Checkbox
                                size="small"
                                checked={checked}
                                indeterminate={indeterminate}
                                onChange={e => markEmpAllDays(emp.pkEmpID, e.target.checked ? 'Y' : 'N')}
                                sx={{
                                  p: '1px',
                                  color: '#90caf9',
                                  '&.Mui-checked':        { color: '#a5d6a7' },
                                  '&.MuiCheckbox-indeterminate': { color: '#ffe082' },
                                }}
                              />
                            </Tooltip>
                          </Box>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {dates.map(ds => {
                    const date      = new Date(ds + 'T00:00:00');
                    const dayName   = DAY_NAMES[date.getDay()];
                    const isSunday  = date.getDay() === 0;
                    const labourCnt = labourPresentCount(ds);
                    const rowColor  = computeRowBg(ds, holidayMap);

                    return (
                      <tr key={ds}>
                        {/* Date / Day / Labour count — sticky left */}
                        <td style={{ ...S.tdLeft, background: rowColor || '#fafafa' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <span style={{ fontWeight: 600, minWidth: 62, color: isSunday ? '#1b6b1b' : 'inherit' }}>
                              {date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                            </span>
                            <span style={{ minWidth: 28, color: isSunday ? '#1b6b1b' : '#666', fontSize: 11 }}>
                              {dayName}
                            </span>
                            <Chip
                              label={`${labourCnt}P`}
                              size="small"
                              color={labourCnt > 0 ? 'success' : 'default'}
                              sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.7 } }}
                            />
                          </Box>
                        </td>

                        {/* One checkbox cell per employee */}
                        {flatEmps.map(emp => {
                          const bg        = computeCellBg(ds, emp.eType, holidayMap);
                          const isPresent = attendance[emp.pkEmpID]?.[ds] !== 'N';

                          return (
                            <td key={emp.pkEmpID} style={{ ...S.tdCell, background: bg }}>
                              <Checkbox
                                size="small"
                                checked={isPresent}
                                onChange={() => toggleCell(emp.pkEmpID, ds)}
                                sx={{
                                  p: '2px',
                                  color: isPresent ? 'success.main' : 'error.main',
                                  '&.Mui-checked': { color: 'success.main' },
                                }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Box>
          )}

          {/* ── Save Button ─────────────────────────────────────────────── */}
          {can('ATTENDANCE', 'CanAdd') && (
            <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
              <Button
                variant="contained"
                color="primary"
                size="medium"
                startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                onClick={handleSave}
                disabled={saving || employees.length === 0}
              >
                {saving ? 'Saving…' : 'Save Attendance'}
              </Button>
              {dirty && (
                <Typography variant="caption" color="warning.main" fontWeight={600}>
                  Unsaved changes
                </Typography>
              )}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
