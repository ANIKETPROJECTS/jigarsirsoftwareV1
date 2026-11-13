import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 15000,
});

// Attach JWT from localStorage on every request (localStorage is shared across tabs)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('gms_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, clear token and redirect to login — BUT only if this was NOT a login request.
// If the login request itself returns 401 (wrong password), we must NOT redirect,
// because we are already on the login page and the redirect causes a full page reload
// that wipes the error message before the user can read it.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isLoginRequest = err.config?.url?.includes('/auth/login');
    if (err.response?.status === 401 && !isLoginRequest) {
      ['gms_token', 'gms_user', 'gms_permissions', 'gms_heartbeat'].forEach((k) => localStorage.removeItem(k));
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
