import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

// After browser closes, the heartbeat stops. If it stays silent for longer than
// HEARTBEAT_STALE we treat the previous browser session as closed and force re-login.
// Worst case: user closes browser, reopens within ~30s and stays logged in.
// That window (= HEARTBEAT_MS) is acceptable for an internal ERP.
const INACTIVITY_MS   = 60 * 60 * 1000; // 60 min idle → auto-logout
const HEARTBEAT_MS    = 30_000;          // write heartbeat every 30 s
const HEARTBEAT_STALE = 5 * 60_000;     // > 5 min gap = browser was closed (extended for slow Win7 machines)

const SESSION_KEYS = ['gms_token', 'gms_user', 'gms_permissions', 'gms_heartbeat'];

function clearSession() {
  SESSION_KEYS.forEach(k => localStorage.removeItem(k));
}

function readLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

// Called once at module init to decide the starting auth state.
// Runs before the component mounts, so any cleanup (clearSession) happens
// before React reads the stored values.
function resolveInitialSession() {
  const lastBeat = parseInt(localStorage.getItem('gms_heartbeat') || '0', 10);
  const isStale  = Date.now() - lastBeat > HEARTBEAT_STALE;

  if (isStale) {
    // Browser was closed (or first ever load) — discard any leftover session.
    clearSession();
    return { user: null, permissions: {} };
  }

  const u = readLS('gms_user', null);
  const p = readLS('gms_permissions', null);

  // Pre-roles session (permissions missing) — force re-login.
  if (u && (!p || Object.keys(p).length === 0)) {
    clearSession();
    return { user: null, permissions: {} };
  }

  return { user: u, permissions: p || {} };
}

export function AuthProvider({ children }) {
  const initial = resolveInitialSession();

  const [user,        setUser]        = useState(initial.user);
  const [permissions, setPermissions] = useState(initial.permissions);

  // can('MASTERS', 'CanAdd') → boolean
  const can = useCallback((moduleCode, action) => {
    return permissions[moduleCode]?.[action] === true;
  }, [permissions]);

  const logout = useCallback(() => {
    clearSession(); // also removes heartbeat so cross-tab re-use is blocked
    setUser(null);
    setPermissions({});
  }, []);

  const login = useCallback(async (compID, userCode, password) => {
    const { data } = await api.post('/auth/login', { compID, userCode, password });
    localStorage.setItem('gms_token',       data.token);
    localStorage.setItem('gms_user',        JSON.stringify(data.user));
    localStorage.setItem('gms_permissions', JSON.stringify(data.permissions));
    localStorage.setItem('gms_heartbeat',   Date.now().toString());
    setUser(data.user);
    setPermissions(data.permissions);
    return data.user;
  }, []);

  const refreshPermissions = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/permissions');
      localStorage.setItem('gms_permissions', JSON.stringify(data.permissions));
      setPermissions(data.permissions);
    } catch {}
  }, []);

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  // While this tab is alive and the user is logged in, refresh the heartbeat
  // timestamp every 30 s. When all browser tabs close, the heartbeat stops.
  // The next tab/browser-open sees a stale heartbeat and clears the session.
  useEffect(() => {
    if (!user) return;

    // Stamp immediately so a concurrently opening new tab gets a fresh heartbeat.
    localStorage.setItem('gms_heartbeat', Date.now().toString());

    const id = setInterval(() => {
      localStorage.setItem('gms_heartbeat', Date.now().toString());
    }, HEARTBEAT_MS);

    return () => clearInterval(id);
  }, [user]);

  // ── Inactivity auto-logout ─────────────────────────────────────────────────
  const timerRef  = useRef(null);
  const logoutRef = useRef(logout);
  logoutRef.current = logout; // always current without being a dep

  useEffect(() => {
    if (!user) return;

    const reset = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        logoutRef.current();
        window.location.href = '/login';
      }, INACTIVITY_MS);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset(); // start timer on login / page load

    return () => {
      clearTimeout(timerRef.current);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user, permissions, can,
      login, logout, refreshPermissions,
      isAuthenticated: !!user,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
