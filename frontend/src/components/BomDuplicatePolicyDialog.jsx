import React, { useEffect, useMemo, useState } from 'react';
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
  FormControl,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import api from '../services/api';

// The four policy modes match the backend's VALID_DUP_POLICIES. Copy is kept
// short and concrete because these choices decide how the BOM sheet is built
// — leave user in no doubt about what each one does to their data.
export const DUP_POLICIES = [
  {
    value: 'keep_at_all_levels',
    label: 'Keep it at every level (sum same-level dups)',
    description:
      'Leave one row per level exactly as it is. Multiple rows at the SAME level get summed into one row for that level (a same-level duplicate is never a valid two rows).',
    needsLevelPick: false,
  },
  {
    value: 'aggregate_per_level',
    label: 'Aggregate quantity at each level',
    description:
      'One row per (item, level). Quantity at each level is the sum of every row of that item at that level. Across-level rows stay separate.',
    needsLevelPick: false,
  },
  {
    value: 'aggregate_all_to_one_level',
    label: 'Aggregate all quantities into one level',
    description:
      'One row per item. Quantity is the sum of every occurrence across every level. You pick which level the single row lands on.',
    needsLevelPick: true,
  },
  {
    value: 'ignore_other_levels',
    label: 'Ignore other levels — keep only at one',
    description:
      'Only the level you pick survives. Every other occurrence of that item across other levels is dropped.',
    needsLevelPick: true,
  },
];

const KIND_LABEL = {
  same_level: 'Same level',
  across_level: 'Across levels',
  both: 'Same level + across levels',
};

const KIND_COLOR = {
  same_level: 'warning',
  across_level: 'info',
  both: 'error',
};

/**
 * Modal shown before an export when the mapper's BOM has duplicate rows.
 *
 * Props:
 *   open           bool
 *   sessionId      string
 *   onClose        () => void      — user cancels; nothing is persisted
 *   onApplied      () => void      — policy stored on session; caller resumes its export
 */
const BomDuplicatePolicyDialog = ({ open, sessionId, onClose, onApplied }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [groups, setGroups] = useState([]);
  // Same default the backend applies when no policy is stored — keeps the
  // dialog's initial state honest about what will happen if the user just
  // clicks Save without changing anything.
  const [policy, setPolicy] = useState('aggregate_per_level');
  // Per-group target level — only meaningful for policies with needsLevelPick.
  const [perGroupLevel, setPerGroupLevel] = useState({});

  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.detectBomDuplicatePolicy(sessionId)
      .then((resp) => {
        if (cancelled) return;
        const data = resp?.data || {};
        const foundGroups = Array.isArray(data.groups) ? data.groups : [];
        setGroups(foundGroups);
        // Seed level pickers from existing stored policy if present, otherwise
        // default each group to its first (lowest / earliest) level. Users can
        // adjust below.
        const seed = {};
        const storedLevels = data.policy?.per_group_target_level || {};
        foundGroups.forEach((g) => {
          seed[g.signature_id] = storedLevels[g.signature_id] || g.levels[0] || '';
        });
        setPerGroupLevel(seed);
        if (data.policy?.policy && DUP_POLICIES.some((p) => p.value === data.policy.policy)) {
          setPolicy(data.policy.policy);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.error || err?.message || 'Failed to check for duplicates');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, sessionId]);

  const activePolicy = useMemo(
    () => DUP_POLICIES.find((p) => p.value === policy) || DUP_POLICIES[0],
    [policy],
  );

  const handleApply = async () => {
    if (!sessionId) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        policy,
        per_group_target_level: activePolicy.needsLevelPick ? perGroupLevel : {},
      };
      await api.setBomDuplicatePolicy(sessionId, body);
      onApplied?.();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  const handleClearAndClose = async () => {
    // If the user cancels but a stored policy exists, do NOT clear it — leaves
    // whatever they picked last time in place. Cancel is a "not now" not a
    // "forget my last choice."
    onClose?.();
  };

  return (
    <Dialog open={open} onClose={handleClearAndClose} maxWidth="md" fullWidth>
      <DialogTitle component="div">
        <Typography variant="h6" component="h2">Duplicate BOM rows detected</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          These items appear more than once in the BOM (same identity, only Level and Quantity differ).
          Pick how the exported BOM sheet should handle them. Your item directory is unaffected.
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Stack direction="row" alignItems="center" gap={1} sx={{ py: 4, justifyContent: 'center' }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Checking for duplicates…</Typography>
          </Stack>
        )}
        {!loading && error && (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        )}
        {!loading && !error && groups.length === 0 && (
          <Alert severity="success">
            No duplicate BOM rows found. Nothing to configure — you can proceed with the export.
          </Alert>
        )}
        {!loading && !error && groups.length > 0 && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {groups.length} duplicate group{groups.length === 1 ? '' : 's'} found:
            </Typography>
            <Box sx={{ maxHeight: 220, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1, mb: 2 }}>
              {groups.map((g) => (
                <Box key={g.signature_id} sx={{ py: 0.75, borderBottom: '1px dashed', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}>
                  <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      {g.raw_material_code || '(no code)'}
                    </Typography>
                    <Chip
                      size="small"
                      label={KIND_LABEL[g.kind] || g.kind}
                      color={KIND_COLOR[g.kind] || 'default'}
                      variant="outlined"
                    />
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {g.occurrences.length} rows · Levels {g.levels.join(', ')}
                    </Typography>
                  </Stack>
                  {g.description && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
                      {g.description}
                    </Typography>
                  )}
                  <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
                    {g.occurrences.map((occ, idx) => (
                      <Chip
                        key={idx}
                        size="small"
                        variant="outlined"
                        label={`L${occ.level || '?'} qty ${occ.quantity || '?'}`}
                        sx={{ fontFamily: 'monospace', fontSize: 11 }}
                      />
                    ))}
                  </Stack>
                  {activePolicy.needsLevelPick && (
                    <FormControl size="small" sx={{ mt: 0.75, minWidth: 200 }}>
                      <Select
                        value={perGroupLevel[g.signature_id] || g.levels[0] || ''}
                        onChange={(e) => setPerGroupLevel((prev) => ({ ...prev, [g.signature_id]: e.target.value }))}
                        displayEmpty
                      >
                        {g.levels.map((level) => (
                          <MenuItem key={level} value={level}>Keep at Level {level}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </Box>
              ))}
            </Box>

            <Typography variant="subtitle2" sx={{ mb: 1 }}>How should these be handled?</Typography>
            <RadioGroup value={policy} onChange={(e) => setPolicy(e.target.value)}>
              {DUP_POLICIES.map((p) => (
                <FormControlLabel
                  key={p.value}
                  value={p.value}
                  control={<Radio />}
                  sx={{ alignItems: 'flex-start', mr: 0, mb: 0.5, '.MuiRadio-root': { pt: 0.5 } }}
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{p.label}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{p.description}</Typography>
                    </Box>
                  }
                />
              ))}
            </RadioGroup>

            <Alert severity="info" sx={{ mt: 1.5 }} variant="outlined">
              The item directory sheet is unaffected — items are always deduplicated normally.
              This choice only reshapes the BOM sheet.
            </Alert>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClearAndClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={groups.length === 0 ? onApplied : handleApply}
          disabled={loading || saving}
          startIcon={saving ? <CircularProgress size={14} /> : null}
        >
          {groups.length === 0 ? 'Close' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BomDuplicatePolicyDialog;
