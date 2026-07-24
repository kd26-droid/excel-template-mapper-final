// CarryForwardDialog.js
//
// Groups rows under a parent/header row and reshapes them into item rows. A
// "parent" row (identified by a condition on one column) establishes shared
// context; the rows beneath it are its alternates/options. Chosen columns copy
// down from the parent, and you emit either just the child rows (dropping the
// parent headers) or the whole group.
//
// Runs before column mapping, on the source table. Nothing here is tied to a
// document or column name — the user picks the parent condition and columns.

import React, { useState, useCallback, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  Button, Box, Typography, FormControl, InputLabel, Select, MenuItem,
  TextField, Checkbox, ListItemText, OutlinedInput, Alert, CircularProgress, Divider
} from '@mui/material';
import { CallMerge as CallMergeIcon } from '@mui/icons-material';
import api from '../services/api';

const TESTS = [
  { value: 'blank', label: 'is empty', needsValue: false },
  { value: 'not_blank', label: 'is not empty', needsValue: false },
  { value: 'is_number', label: 'is a number', needsValue: false },
  { value: 'equals', label: 'equals', needsValue: true },
  { value: 'not_equals', label: 'does not equal', needsValue: true },
  { value: 'matches', label: 'matches (regex)', needsValue: true },
];

const CarryForwardDialog = ({ open, onClose, sessionId, onApplied }) => {
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [cfg, setCfg] = useState({
    column: '', test: 'blank', value: '', carryColumns: [], fillOnlyBlank: true, emit: 'children',
  });

  useEffect(() => {
    if (!open) return;
    setError(''); setPreview(null);
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await api.getSourceColumns(sessionId);
        if (!cancelled) setColumns(res.data?.columns || []);
      } catch (e) {
        if (!cancelled) { setColumns([]); setError('Could not load the source columns.'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, sessionId]);

  const testDef = TESTS.find(t => t.value === cfg.test) || TESTS[0];

  const buildPayload = useCallback(() => ({
    parentCondition: { column: cfg.column, test: cfg.test, value: testDef.needsValue ? cfg.value : '' },
    carryColumns: cfg.carryColumns,
    fillOnlyBlank: cfg.fillOnlyBlank,
    emit: cfg.emit,
  }), [cfg, testDef]);

  const handlePreview = useCallback(async () => {
    try {
      setPreviewLoading(true); setError('');
      const res = await api.carryForwardGroup(sessionId, { ...buildPayload(), preview: true });
      if (res.data?.success) setPreview(res.data);
      else { setPreview(null); setError(res.data?.error || 'Preview failed'); }
    } catch (e) {
      setPreview(null); setError(e.response?.data?.error || e.message || 'Preview failed');
    } finally { setPreviewLoading(false); }
  }, [sessionId, buildPayload]);

  const handleApply = useCallback(async () => {
    try {
      setRunning(true); setError('');
      const res = await api.carryForwardGroup(sessionId, buildPayload());
      if (res.data?.success) { setPreview(null); onApplied?.(res.data); onClose?.(); }
      else setError(res.data?.error || 'Failed to group rows');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to group rows');
    } finally { setRunning(false); }
  }, [sessionId, buildPayload, onApplied, onClose]);

  const canSubmit = !!cfg.column && (!testDef.needsValue || cfg.value.trim());

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Group header and detail rows</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Some sheets have a summary/header row for each item, followed by its supplier rows. Tell us how
          to spot the summary rows. Their details can be copied down into the rows below, and you can drop
          the summary rows so only the supplier (item) rows are left.
        </DialogContentText>

        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
            <CircularProgress size={18} /><Typography variant="body2">Loading columns...</Typography>
          </Box>
        ) : (
          <>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>A row is a summary/header row when…</Typography>
            <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <FormControl size="small" sx={{ minWidth: 200, flex: 1 }}>
                <InputLabel>Column</InputLabel>
                <Select label="Column" value={cfg.column}
                        onChange={e => setCfg(p => ({ ...p, column: e.target.value }))}>
                  {columns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 170 }}>
                <InputLabel>Condition</InputLabel>
                <Select label="Condition" value={cfg.test}
                        onChange={e => setCfg(p => ({ ...p, test: e.target.value }))}>
                  {TESTS.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                </Select>
              </FormControl>
              {testDef.needsValue && (
                <TextField size="small" label="Value" value={cfg.value} sx={{ minWidth: 160 }}
                           onChange={e => setCfg(p => ({ ...p, value: e.target.value }))} />
              )}
            </Box>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Copy details down from the summary row (optional)</Typography>
            <FormControl size="small" fullWidth sx={{ mb: 2 }}>
              <InputLabel>Columns to copy into the rows below</InputLabel>
              <Select
                multiple value={cfg.carryColumns}
                onChange={e => setCfg(p => ({ ...p, carryColumns: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value }))}
                input={<OutlinedInput label="Columns to copy into the rows below" />}
                renderValue={sel => sel.join(', ')}
              >
                {columns.map(c => (
                  <MenuItem key={c} value={c}>
                    <Checkbox checked={cfg.carryColumns.indexOf(c) > -1} />
                    <ListItemText primary={c} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth sx={{ mb: 1 }}>
              <InputLabel>Output</InputLabel>
              <Select label="Output" value={cfg.emit}
                      onChange={e => setCfg(p => ({ ...p, emit: e.target.value }))}>
                <MenuItem value="children">Keep only the rows below (drop the summary rows)</MenuItem>
                <MenuItem value="all">Keep everything (summary rows and the rows below)</MenuItem>
              </Select>
            </FormControl>

            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

            {preview && (
              <Box sx={{ mt: 2 }}>
                <Alert severity="success" sx={{ mb: 1 }}>
                  {preview.source_rows} rows → {preview.output_rows} rows
                  ({preview.parents} summary rows, {preview.children} item rows
                  {preview.orphans > 0 ? `, ${preview.orphans} rows set aside for review` : ''}).
                </Alert>
                <Box sx={{ maxHeight: 240, overflow: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
                  <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                    <Box component="thead" sx={{ position: 'sticky', top: 0, bgcolor: '#fafafa' }}>
                      <Box component="tr">
                        {preview.headers.map(h => (
                          <Box component="th" key={h} sx={{ p: 0.75, textAlign: 'left', borderBottom: '1px solid #e0e0e0', whiteSpace: 'nowrap' }}>{h}</Box>
                        ))}
                      </Box>
                    </Box>
                    <Box component="tbody">
                      {preview.data.map((row, i) => (
                        <Box component="tr" key={i}>
                          {preview.headers.map(h => (
                            <Box component="td" key={h} sx={{ p: 0.75, borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' }}>{row[h]}</Box>
                          ))}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Box>
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={running}>Cancel</Button>
        <Button onClick={handlePreview} disabled={previewLoading || running || !canSubmit}>
          {previewLoading ? 'Previewing...' : 'Preview'}
        </Button>
        <Button onClick={handleApply} variant="contained"
                startIcon={running ? <CircularProgress size={16} /> : <CallMergeIcon />}
                disabled={running || !canSubmit}>
          {running ? 'Grouping...' : 'Apply'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CarryForwardDialog;
