import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import FormulaBuilder from './FormulaBuilder';
import { useThemeContext } from '../utils/ThemeContext';
import api from '../services/api';

// Tag rules only need a list of column NAMES to point their source_column at.
// The dashboard has no session open, so the columns come from the built-in
// Factwise sheet instead of asking the user to upload a sheet just to harvest
// its header row.
const StandaloneFormulaBuilder = ({ open, onClose, onSave }) => {
  const { tokens: t } = useThemeContext();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formulaRules, setFormulaRules] = useState([]);
  const [factwiseColumns, setFactwiseColumns] = useState([]);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [columnsError, setColumnsError] = useState('');
  const [saving, setSaving] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingColumns(true);
    setColumnsError('');
    api.getDefaultTemplateHeaders()
      .then(res => {
        if (cancelled) return;
        const headers = res?.data?.headers || [];
        setFactwiseColumns(headers);
        if (headers.length === 0) {
          setColumnsError('The built-in Factwise sheet returned no columns.');
        }
      })
      .catch(err => {
        if (cancelled) return;
        setColumnsError(
          err?.response?.data?.error
          || 'Could not load the Factwise columns. Check that the backend is reachable.'
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingColumns(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  // No sample data behind these columns, so tell FormulaBuilder the fill state
  // is unknown — otherwise every column renders as "(Empty)".
  const columnFillStats = factwiseColumns.reduce((acc, col) => {
    acc[col] = 'unknown';
    return acc;
  }, {});

  const handleClose = useCallback(() => {
    setName('');
    setDescription('');
    setFormulaRules([]);
    setFactwiseColumns([]);
    setColumnsError('');
    setSaving(false);
    setRulesOpen(false);
    onClose();
  }, [onClose]);

  const handleSave = async () => {
    if (!name.trim()) {
      alert('Template name is required.');
      return;
    }
    if (formulaRules.length === 0) {
      alert('Add at least one rule before saving.');
      return;
    }
    const payload = { name: name.trim(), description, formula_rules: formulaRules };
    // Parent can take over persistence; otherwise save it here so the dialog
    // works standalone.
    if (onSave) {
      onSave(payload);
      handleClose();
      return;
    }
    setSaving(true);
    try {
      await api.saveTagTemplate(payload.name, payload.description, payload.formula_rules);
      handleClose();
    } catch (err) {
      alert(err?.response?.data?.error || err.message || 'Failed to save rule set.');
    } finally {
      setSaving(false);
    }
  };

  // In template mode FormulaBuilder hands back the authored rules instead of
  // applying them to a session.
  const handleFormulasApplied = (payload) => {
    setFormulaRules(payload?.formula_rules || []);
    setRulesOpen(false);
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '16px',
          overflow: 'hidden',
          bgcolor: t.surface.elevated,
          border: `1px solid ${t.border.modal}`,
          color: t.text.primary,
        }
      }}
    >
      <DialogTitle sx={{ pr: 6, color: t.text.heading }}>
        Create New Rule Set
        <IconButton
          aria-label="close"
          onClick={handleClose}
          sx={{
            position: 'absolute',
            right: 8,
            top: 8,
            color: t.text.secondary,
            '&:hover': {
              color: t.text.primary,
              bgcolor: t.action.hover,
            },
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ bgcolor: t.surface.elevated, color: t.text.primary }}>
        <Box sx={{ my: 2 }}>
          <TextField
            autoFocus
            margin="dense"
            id="name"
            label="Rule set name"
            type="text"
            fullWidth
            variant="outlined"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <TextField
            margin="dense"
            id="description"
            label="Description"
            type="text"
            fullWidth
            multiline
            rows={2}
            variant="outlined"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2, mb: 1, flexWrap: 'wrap' }}>
          <Typography variant="h6" sx={{ color: t.text.heading }}>
            Rules
          </Typography>
          {loadingColumns ? (
            <CircularProgress size={16} />
          ) : factwiseColumns.length > 0 && (
            <Chip
              size="small"
              label={`${factwiseColumns.length} Factwise columns`}
              sx={{ height: 20, fontSize: 11 }}
            />
          )}
        </Box>
        <Typography variant="caption" sx={{ display: 'block', mb: 1.5, color: t.text.secondary }}>
          Source columns come from the built-in Factwise sheet, so these rules apply
          to any session mapped to it.
        </Typography>

        {columnsError && (
          <Alert severity="error" sx={{ mb: 2 }}>{columnsError}</Alert>
        )}

        <Box
          sx={{
            border: `1px dashed ${t.border.strong}`,
            borderRadius: '12px',
            p: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          <Typography variant="body2" sx={{ color: t.text.secondary }}>
            {formulaRules.length === 0
              ? 'No rules yet.'
              : `${formulaRules.length} rule${formulaRules.length === 1 ? '' : 's'} defined.`}
          </Typography>
          <Button
            variant="outlined"
            onClick={() => setRulesOpen(true)}
            disabled={loadingColumns || factwiseColumns.length === 0}
          >
            {formulaRules.length === 0 ? 'Add rules' : 'Edit rules'}
          </Button>
        </Box>

        {/* Rule editor. templateMode keeps it off the session APIs — "Save
            Rules" hands the rules back here instead of applying them. */}
        {rulesOpen && (
          <FormulaBuilder
            open={rulesOpen}
            onClose={() => setRulesOpen(false)}
            sessionId="standalone"
            availableColumns={factwiseColumns}
            columnExamples={{}}
            columnFillStats={columnFillStats}
            onApplyFormulas={handleFormulasApplied}
            initialRules={formulaRules}
            templateMode={true}
          />
        )}
      </DialogContent>
      <DialogActions sx={{ p: 3, bgcolor: t.surface.footer, borderTop: `1px solid ${t.border.subtle}` }}>
        <Button onClick={handleClose} sx={{ color: t.color.primarySoftText }}>Cancel</Button>
        <Box sx={{ flex: '1 1 auto' }} />
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!name.trim() || saving || loadingColumns}
          startIcon={saving ? <CircularProgress size={14} /> : null}
          sx={{ px: 3, minHeight: 38 }}
        >
          {saving ? 'Saving…' : 'Save Template'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default StandaloneFormulaBuilder;
