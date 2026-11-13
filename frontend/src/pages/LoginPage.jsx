import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, Typography, TextField, Button,
  MenuItem, CircularProgress, Alert,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [companies, setCompanies]   = useState([]);
  const [compID, setCompID]         = useState('');
  const [userCode, setUserCode]     = useState('');
  const [password, setPassword]     = useState('');
  const [loading, setLoading]       = useState(false);
  const [compLoading, setCompLoading] = useState(true);
  const [error, setError]           = useState('');

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  // Load company list
  useEffect(() => {
    api.get('/auth/companies')
      .then(({ data }) => {
        setCompanies(data);
        if (data.length === 1) setCompID(data[0].pkCompID);
      })
      .catch(() => setError('Could not load companies. Check server connection.'))
      .finally(() => setCompLoading(false));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!compID) { setError('Please select a company'); return; }
    setLoading(true);
    try {
      await login(compID, userCode, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1565C0 0%, #0D47A1 100%)',
      }}
    >
      <Paper elevation={8} sx={{ p: 5, width: 360, borderRadius: 2 }}>
        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <img src="/gms-logo.png" alt="GMS – Godown Management System"
               style={{ width: 180, height: 'auto' }} />
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box component="form" onSubmit={handleSubmit} noValidate>
          {/* Company selector */}
          <TextField
            select
            label="Company"
            value={compID}
            onChange={(e) => setCompID(e.target.value)}
            fullWidth
            required
            size="small"
            sx={{ mb: 2 }}
            disabled={compLoading}
          >
            {compLoading
              ? <MenuItem value=""><em>Loading…</em></MenuItem>
              : companies.map((c) => (
                  <MenuItem key={c.pkCompID} value={c.pkCompID}>
                    {c.CompName} ({c.CompAlias})
                  </MenuItem>
                ))
            }
          </TextField>

          <TextField
            label="User Code"
            value={userCode}
            onChange={(e) => setUserCode(e.target.value.toUpperCase())}
            fullWidth
            required
            size="small"
            autoComplete="username"
            slotProps={{ htmlInput: { maxLength: 10 } }}
            sx={{ mb: 2 }}
          />

          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            required
            size="small"
            autoComplete="current-password"
            sx={{ mb: 3 }}
          />

          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={loading || compLoading}
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : 'Login'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
