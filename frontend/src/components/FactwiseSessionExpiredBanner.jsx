import React from 'react';
import { Alert, AlertTitle, Box, Button, Snackbar } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useFactwise } from '../contexts/FactwiseContext';

// Persistent, non-dismissable banner that shows when the FactWise JWT has
// expired (Azure AD B2C tokens live for 1 hour). Without this, users saw a
// generic "Network Error" under the Project Template dropdown and CORS
// noise in the console — the real cause (expired auth) was invisible.
//
// The reconnect button opens FactWise's BOM Directory in a new tab; user
// re-clicks "Launch mapper" there → new tab writes a fresh token to
// localStorage → the storage event on this tab clears the expired flag
// automatically.
export default function FactwiseSessionExpiredBanner() {
  const { sessionExpired, reconnect, fwOrigin } = useFactwise();
  if (!sessionExpired) return null;
  return (
    <Snackbar
      open
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      sx={{ top: { xs: 8, sm: 24 }, zIndex: (t) => t.zIndex.modal + 10 }}
    >
      <Alert
        severity="warning"
        variant="filled"
        icon={false}
        sx={{
          width: '100%',
          maxWidth: 640,
          alignItems: 'center',
          boxShadow: 6,
          '& .MuiAlert-message': { width: '100%' },
        }}
        action={
          fwOrigin ? (
            <Button
              color="inherit"
              size="small"
              startIcon={<RefreshIcon />}
              onClick={reconnect}
              sx={{ fontWeight: 600 }}
            >
              Reconnect
            </Button>
          ) : null
        }
      >
        <AlertTitle sx={{ mb: 0.25, fontWeight: 700 }}>
          Factwise session expired
        </AlertTitle>
        <Box sx={{ fontSize: 13, opacity: 0.9 }}>
          Your Factwise login timed out (1 hour). Click{' '}
          <b>Reconnect</b> to reopen Factwise and re-launch the mapper —
          any unsaved edits in this tab will stay put and pick up the new
          token automatically.
        </Box>
      </Alert>
    </Snackbar>
  );
}
