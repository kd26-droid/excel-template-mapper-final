// ExpandColumnGroupsDialog.js
//
// Folds repeated column groups into rows. Columns that mean the same thing often
// sit side by side on one source row: a manufacturer and MPN next to their
// alternate pair, or an item code next to its alternate item codes. Each group
// becomes its own row, and every other column on that row is copied into all of
// them.
//
// This runs before column mapping, because the alternate columns are usually
// left unmapped and so would not survive into the mapped grid.

import React, { useState, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Checkbox,
  FormControlLabel,
  Divider,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Add as AddIcon,
  DeleteOutline as DeleteIcon,
  CallSplit as CallSplitIcon
} from '@mui/icons-material';
import api from '../services/api';

const ExpandColumnGroupsDialog = ({ open, onClose, sessionId, onApplied }) => {
  const [sourceColumns, setSourceColumns] = useState([]);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState({
    targetFields: [''],
    groups: [[''], ['']],
    onPartial: 'review',
    keepRowsWithoutGroups: false
  });

  const groupWidth = config.targetFields.length;

  useEffect(() => {
    if (!open) return;

    setError('');
    setPreview(null);

    let cancelled = false;
    (async () => {
      try {
        setColumnsLoading(true);
        const response = await api.getSourceColumns(sessionId);
        if (!cancelled) setSourceColumns(response.data?.columns || []);
      } catch (err) {
        if (!cancelled) {
          setSourceColumns([]);
          setError('Could not load the source columns for this session.');
        }
      } finally {
        if (!cancelled) setColumnsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, sessionId]);

  const buildPayload = useCallback(() => ({
    targetFields: config.targetFields.map(f => f.trim()).filter(Boolean),
    groups: config.groups
      .map(group => group.map(c => (c || '').trim()))
      .filter(group => group.some(Boolean)),
    onPartial: config.onPartial,
    keepRowsWithoutGroups: config.keepRowsWithoutGroups
  }), [config]);

  const handlePreview = useCallback(async () => {
    try {
      setPreviewLoading(true);
      setError('');
      const response = await api.expandColumnGroups(sessionId, { ...buildPayload(), preview: true });
      if (response.data?.success) {
        setPreview(response.data);
      } else {
        setPreview(null);
        setError(response.data?.error || 'Preview failed');
      }
    } catch (err) {
      setPreview(null);
      setError(err.response?.data?.error || err.message || 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  }, [sessionId, buildPayload]);

  const handleApply = useCallback(async () => {
    try {
      setRunning(true);
      setError('');
      const response = await api.expandColumnGroups(sessionId, buildPayload());
      if (response.data?.success) {
        setPreview(null);
        onApplied?.(response.data);
        onClose?.();
      } else {
        setError(response.data?.error || 'Failed to expand column groups');
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to expand column groups');
    } finally {
      setRunning(false);
    }
  }, [sessionId, buildPayload, onApplied, onClose]);

  const canSubmit =
    config.targetFields.some(f => f.trim()) &&
    config.groups.filter(g => g.some(c => (c || '').trim())).length >= 2;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Split alternates into separate rows</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Sometimes one row lists the same kind of thing more than once, side by side &mdash; a main
          supplier and part number next to an alternate supplier and part number, or a code next to its
          alternate codes. This turns each one into its own row and copies the rest of the row (description,
          quantity, etc.) into all of them.
        </DialogContentText>

        {columnsLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
            <CircularProgress size={18} />
            <Typography variant="body2">Loading source columns...</Typography>
          </Box>
        ) : (
          <>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              1. What each row should end up with
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Name the field(s) each new row will hold. One name if it's a single value (e.g. Item code);
              two names if it's a pair (e.g. Supplier and Part Number).
            </Typography>

            {config.targetFields.map((field, fieldIndex) => (
              <Box key={fieldIndex} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                <TextField
                  size="small"
                  fullWidth
                  label={`Output column ${fieldIndex + 1}`}
                  value={field}
                  onChange={(e) => setConfig(prev => {
                    const targetFields = [...prev.targetFields];
                    targetFields[fieldIndex] = e.target.value;
                    return { ...prev, targetFields };
                  })}
                />
                <IconButton
                  size="small"
                  disabled={config.targetFields.length <= 1}
                  onClick={() => setConfig(prev => ({
                    ...prev,
                    targetFields: prev.targetFields.filter((_, i) => i !== fieldIndex),
                    groups: prev.groups.map(group => group.filter((_, i) => i !== fieldIndex))
                  }))}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}

            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setConfig(prev => ({
                ...prev,
                targetFields: [...prev.targetFields, ''],
                groups: prev.groups.map(group => [...group, ''])
              }))}
              sx={{ mb: 2 }}
            >
              Add a field
            </Button>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              2. Which existing columns to pull from
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Each set below becomes its own row. Add one set for the main supplier and one for each alternate.
            </Typography>

            {config.groups.map((group, groupIndex) => (
              <Box
                key={groupIndex}
                sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}
              >
                <Chip label={`Row ${groupIndex + 1}`} size="small" sx={{ minWidth: 64 }} />
                {Array.from({ length: groupWidth }).map((_, slotIndex) => (
                  <FormControl key={slotIndex} size="small" sx={{ minWidth: 190, flex: 1 }}>
                    <InputLabel>{config.targetFields[slotIndex] || `Column ${slotIndex + 1}`}</InputLabel>
                    <Select
                      label={config.targetFields[slotIndex] || `Column ${slotIndex + 1}`}
                      value={group[slotIndex] || ''}
                      onChange={(e) => setConfig(prev => {
                        const groups = prev.groups.map(g => [...g]);
                        groups[groupIndex][slotIndex] = e.target.value;
                        return { ...prev, groups };
                      })}
                    >
                      <MenuItem value=""><em>None</em></MenuItem>
                      {sourceColumns.map(column => (
                        <MenuItem key={column} value={column}>{column}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                ))}
                <IconButton
                  size="small"
                  disabled={config.groups.length <= 2}
                  onClick={() => setConfig(prev => ({
                    ...prev,
                    groups: prev.groups.filter((_, i) => i !== groupIndex)
                  }))}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}

            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setConfig(prev => ({
                ...prev,
                groups: [...prev.groups, Array.from({ length: groupWidth }, () => '')]
              }))}
              sx={{ mb: 2 }}
            >
              Add another supplier
            </Button>

            <Divider sx={{ my: 2 }} />

            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>If a supplier is missing part of its info</InputLabel>
              <Select
                label="If a supplier is missing part of its info"
                value={config.onPartial}
                onChange={(e) => setConfig(prev => ({ ...prev, onPartial: e.target.value }))}
              >
                <MenuItem value="review">Set aside for review, don't create the row</MenuItem>
                <MenuItem value="emit">Create the row anyway, leaving blanks</MenuItem>
                <MenuItem value="skip">Skip it</MenuItem>
              </Select>
            </FormControl>

            <FormControlLabel
              control={
                <Checkbox
                  checked={config.keepRowsWithoutGroups}
                  onChange={(e) => setConfig(prev => ({ ...prev, keepRowsWithoutGroups: e.target.checked }))}
                />
              }
              label="Keep rows that have no supplier filled in"
            />

            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

            {preview && (
              <Box sx={{ mt: 2 }}>
                <Alert severity="success" sx={{ mb: 1 }}>
                  {preview.source_rows} source rows would become {preview.output_rows} rows.
                  {preview.partial_groups > 0 && ` ${preview.partial_groups} incomplete group(s) flagged.`}
                  {preview.empty_groups_skipped > 0 && ` ${preview.empty_groups_skipped} empty group(s) skipped.`}
                </Alert>
                <Box sx={{ maxHeight: 240, overflow: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
                  <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                    <Box component="thead" sx={{ position: 'sticky', top: 0, bgcolor: '#fafafa' }}>
                      <Box component="tr">
                        {preview.headers.map(header => (
                          <Box
                            component="th"
                            key={header}
                            sx={{
                              p: 0.75,
                              textAlign: 'left',
                              borderBottom: '1px solid #e0e0e0',
                              whiteSpace: 'nowrap',
                              fontWeight: preview.target_fields?.includes(header) ? 700 : 500,
                              color: preview.target_fields?.includes(header) ? '#7b1fa2' : 'inherit'
                            }}
                          >
                            {header}
                          </Box>
                        ))}
                      </Box>
                    </Box>
                    <Box component="tbody">
                      {preview.data.map((row, rowIndex) => (
                        <Box component="tr" key={rowIndex}>
                          {preview.headers.map(header => (
                            <Box
                              component="td"
                              key={header}
                              sx={{ p: 0.75, borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' }}
                            >
                              {row[header]}
                            </Box>
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
        <Button
          onClick={handleApply}
          variant="contained"
          startIcon={running ? <CircularProgress size={16} /> : <CallSplitIcon />}
          disabled={running || !canSubmit}
        >
          {running ? 'Expanding...' : 'Apply'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ExpandColumnGroupsDialog;
