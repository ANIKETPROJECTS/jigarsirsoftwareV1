import {
  Drawer, Box, Typography, IconButton, Button, Divider, CircularProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

export default function FormDrawer({ open, title, onClose, onSave, saving, children, width = 420 }) {
  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width, p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 600, color: '#1565C0' }}>
            {title}
          </Typography>
          <IconButton size="small" onClick={onClose}><CloseIcon /></IconButton>
        </Box>
        <Divider sx={{ mb: 2 }} />

        {/* Form content */}
        <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
          {children}
        </Box>

        {/* Actions */}
        <Divider sx={{ mt: 2, mb: 2 }} />
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button
            variant="contained"
            onClick={onSave}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="outlined" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
}
