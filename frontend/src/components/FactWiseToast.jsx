import React from 'react';
import { Alert, Snackbar } from '@mui/material';
import { factWiseToastAlertSx } from '../utils/factwisePageStyles';

export default function FactWiseToast({ open, severity, onClose, autoHideDuration, tokens, children }) {
  return (
    <Snackbar open={open} onClose={onClose} autoHideDuration={autoHideDuration}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      sx={{ top: '80px !important', zIndex: 1600 }}>
      <Alert variant="outlined" severity={severity} onClose={onClose}
        sx={factWiseToastAlertSx(tokens, severity, {
          solid: false, borderRadius: '10px', boxShadow: 'none',
          sx: { bgcolor: tokens.surfaceSolid, '& .MuiAlert-message': { whiteSpace: 'normal', overflowWrap: 'anywhere' } },
        })}>
        {children}
      </Alert>
    </Snackbar>
  );
}
