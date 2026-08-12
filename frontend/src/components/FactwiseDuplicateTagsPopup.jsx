import React from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

// Mirrors FactWise's admin BulkImportPage `Duplicate Tags Detected` popup.
// When the item sheet has DuplicateTag validation errors (same tag repeated
// on the same item), FW offers two paths:
//   - "Fix errors" → close popup, edit inline in the grid
//   - "Continue"   → reupload the same file with additional_information
//                    `ignore_duplicate_tags: true`, which tells the BE to
//                    silently dedupe and import successfully
export default function FactwiseDuplicateTagsPopup({
  open,
  onFix,
  onContinue,
  submitting = false,
}) {
  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onFix}
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: { borderRadius: '14px' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ContentCopyIcon color="warning" fontSize="small" />
        <Typography variant="h6" sx={{ fontWeight: 650 }}>
          Duplicate Tags Detected
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Some items in your sheet have the same tag repeated. A tag can only
          be assigned to an item once.
        </Typography>
        <Box
          sx={{
            p: 2,
            borderRadius: 1.5,
            bgcolor: (t) =>
              t.palette.mode === 'dark' ? 'rgba(148, 163, 184, 0.08)' : '#f5f5f5',
          }}
        >
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            If you continue:
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            <Typography component="li" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Items will be imported successfully
            </Typography>
            <Typography component="li" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Duplicate tags will be removed automatically
            </Typography>
            <Typography component="li" variant="body2" color="text.secondary">
              Each tag will only be assigned once per item
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onFix} disabled={submitting}>
          Fix errors
        </Button>
        <Button
          variant="contained"
          onClick={onContinue}
          disabled={submitting}
          startIcon={submitting ? <CircularProgress size={14} /> : null}
        >
          {submitting ? 'Retrying…' : 'Continue'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
