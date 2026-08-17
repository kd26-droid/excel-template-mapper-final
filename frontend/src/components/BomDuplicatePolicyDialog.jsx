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
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import api from '../services/api';

// The two policy values this dialog can store. The backend still understands
// three older modes (target-level picks and across-level merges); nothing here
// sends them, because the only question that turned out to matter is what
// happens to one item listed twice at ONE level.
const POLICY_AGGREGATE = 'aggregate_per_level';
const POLICY_KEEP = 'keep_duplicates';

// Kept in sync with GLOBAL_DUP_POLICY_KEY in pages/Settings.js.
const GLOBAL_DUP_POLICY_KEY = 'fw_bom_default_dup_policy';

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

const toNumber = (value) => {
  const parsed = parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

// Float addition leaves noise — 0.1 + 0.2 is 0.30000000000000004, and nobody
// wants that offered as a suggested BOM quantity.
const formatQuantity = (value) => {
  if (!Number.isFinite(value)) return '';
  return String(Math.round(value * 1e6) / 1e6);
};

// A group can span levels, and each level is its own decision — a part used
// twice at Level 2 and once at Level 3 needs an answer for Level 2 and an
// answer for Level 3, not one answer for both.
const levelBucketsOf = (group) => {
  const byLevel = new Map();
  (group.occurrences || []).forEach((occurrence) => {
    const level = String(occurrence.level ?? '');
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(occurrence);
  });
  return [...byLevel.entries()]
    // Only levels that actually hold the item more than once.
    //
    // A level with ONE occurrence is not a duplicate to resolve — it is the
    // same part legitimately used in another sub-assembly, which a multi-level
    // BOM is supposed to contain. Listing those asked the user to decide
    // something that has no wrong answer, and buried the rows that do.
    //
    // Filtering here rather than on group.kind is deliberate: a group marked
    // "both" has real same-level duplicates AND across-level rows, so dropping
    // the whole group would hide work that needs doing. This keeps its
    // same-level rows and drops only the rest.
    //
    // To show across-level rows again, drop this filter:
    //   .filter(([, occurrences]) => occurrences.length > 1)
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([level, occurrences]) => ({
      level,
      occurrences,
      // What aggregating would produce. Pre-filled, and free to overwrite.
      suggested: formatQuantity(
        occurrences.reduce((total, occurrence) => total + toNumber(occurrence.quantity), 0)
      ),
    }));
};

// Matches the backend's per-level lookup key in apply_records_duplicate_policy.
const quantityKey = (signatureId, level) => `${signatureId}::${level}`;

/**
 * Modal shown before an export when the mapper's BOM has duplicate rows.
 *
 * Two things to decide, and only two:
 *   1. aggregate quantities of the same item within a level, or leave them
 *   2. for any individual (item, level), the exact quantity to use
 *
 * A quantity typed here beats the switch. That is what makes "delete the
 * duplicates and choose the quantity" the same control as aggregation rather
 * than a separate mode: the sum is only ever the suggestion, and typing one of
 * the original figures over it keeps that row and drops the other.
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
  const [aggregate, setAggregate] = useState(true);
  // Only what the user actually typed — never the suggested sums, even though
  // the boxes SHOW those. Storing the suggestions here would send an explicit
  // quantity for every group, resolving them all and leaving the switch with
  // nothing to do; turning aggregation off would then silently keep working.
  // So the sum is displayed, and sent only once someone has taken it as their
  // own by editing it.
  const [quantities, setQuantities] = useState({});

  useEffect(() => {
    if (!open || !sessionId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.detectBomDuplicatePolicy(sessionId)
      .then((resp) => {
        if (cancelled) return;
        const data = resp?.data || {};
        setGroups(Array.isArray(data.groups) ? data.groups : []);

        const stored = data.policy || {};
        if (stored.policy === POLICY_KEEP) {
          setAggregate(false);
        } else if (stored.policy) {
          setAggregate(true);
        } else {
          // No per-session choice yet: fall back to the global default so the
          // dialog opens showing what would happen if the user just saved.
          let preference = null;
          try { preference = window.localStorage.getItem(GLOBAL_DUP_POLICY_KEY); } catch (_) { /* ignore */ }
          setAggregate(preference !== POLICY_KEEP);
        }
        setQuantities({ ...(stored.per_group_quantity || {}) });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.error || err?.message || 'Failed to check for duplicates');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, sessionId]);

  const invalidKeys = useMemo(() => (
    Object.entries(quantities)
      .filter(([, value]) => String(value ?? '').trim() !== '' && !Number.isFinite(parseFloat(value)))
      .map(([key]) => key)
  ), [quantities]);

  // Groups with something to decide. A group whose only duplication is across
  // levels has no same-level buckets left after filtering, so it drops out
  // entirely rather than showing as an empty row.
  const visibleGroups = useMemo(() => (
    groups
      .map((group) => ({ group, buckets: levelBucketsOf(group) }))
      .filter((entry) => entry.buckets.length > 0)
  ), [groups]);

  // With aggregation off, a group is only resolved once the user has taken
  // ownership of a quantity by editing it. The rest is what the export refuses.
  const unresolvedCount = useMemo(() => {
    if (aggregate) return 0;
    return visibleGroups.reduce((total, { group, buckets }) => (
      total + buckets.filter((bucket) => (
        String(quantities[quantityKey(group.signature_id, bucket.level)] ?? '').trim() === ''
      )).length
    ), 0);
  }, [aggregate, visibleGroups, quantities]);

  const setQuantity = (key, value) => {
    setQuantities((prev) => {
      const next = { ...prev };
      if (String(value ?? '').trim() === '') delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const handleApply = async () => {
    if (!sessionId || invalidKeys.length) return;
    setSaving(true);
    setError(null);
    try {
      await api.setBomDuplicatePolicy(sessionId, {
        policy: aggregate ? POLICY_AGGREGATE : POLICY_KEEP,
        per_group_target_level: {},
        per_group_quantity: quantities,
      });
      onApplied?.();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  // Cancel is "not now", not "forget my last choice" — a stored policy stays.
  const handleClose = () => { onClose?.(); };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle component="div">
        <Typography variant="h6" component="h2">Duplicate BOM rows detected</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          These items appear more than once in the BOM (same identity — only Level and Quantity differ).
          Your item directory is unaffected; this only reshapes the BOM sheet.
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Stack direction="row" alignItems="center" gap={1} sx={{ py: 4, justifyContent: 'center' }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Checking for duplicates…</Typography>
          </Stack>
        )}
        {!loading && error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {/* visibleGroups, not groups: a sheet whose only duplication is across
            levels has nothing here to decide, so it should read as clear rather
            than open onto an empty list. */}
        {!loading && !error && visibleGroups.length === 0 && (
          <Alert severity="success">
            No duplicate BOM rows found at a single level. Nothing to configure — you can proceed
            with the export.
          </Alert>
        )}

        {!loading && !error && visibleGroups.length > 0 && (
          <>
            <FormControlLabel
              control={<Switch checked={aggregate} onChange={(e) => setAggregate(e.target.checked)} />}
              sx={{ alignItems: 'flex-start', ml: 0, mr: 0, mb: 1 }}
              label={
                <Box sx={{ ml: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Aggregate quantity of the same item within a level
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {aggregate
                      ? 'Rows below become one row per level, using the quantity shown. Replace any of them to use a different quantity.'
                      : 'Rows are left as they are. FactWise does not accept a part listed twice in one BOM, so the export will stop unless you set a quantity below.'}
                  </Typography>
                </Box>
              }
            />

            {!aggregate && unresolvedCount > 0 && (
              <Alert severity="warning" variant="outlined" sx={{ mb: 1.5 }}>
                {unresolvedCount} group{unresolvedCount === 1 ? '' : 's'} still {unresolvedCount === 1 ? 'has' : 'have'} no
                quantity set. The BOM export will report {unresolvedCount === 1 ? 'it' : 'them'} and stop.
              </Alert>
            )}

            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {visibleGroups.length} duplicate group{visibleGroups.length === 1 ? '' : 's'} found:
            </Typography>

            <Box sx={{ maxHeight: 380, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
              {visibleGroups.map(({ group, buckets }) => (
                <Box
                  key={group.signature_id}
                  sx={{ py: 1, borderBottom: '1px dashed', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}
                >
                  <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      {group.raw_material_code || '(no code)'}
                    </Typography>
                    <Chip
                      size="small"
                      label={KIND_LABEL[group.kind] || group.kind}
                      color={KIND_COLOR[group.kind] || 'default'}
                      variant="outlined"
                    />
                  </Stack>
                  {group.description && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
                      {group.description}
                    </Typography>
                  )}

                  {buckets.map((bucket) => {
                    const key = quantityKey(group.signature_id, bucket.level);
                    const typed = quantities[key];
                    const hasTyped = String(typed ?? '').trim() !== '';
                    const invalid = invalidKeys.includes(key);
                    return (
                      <Stack
                        key={key}
                        direction="row"
                        alignItems="center"
                        gap={1.5}
                        flexWrap="wrap"
                        sx={{ mt: 0.75, pl: 0.5 }}
                      >
                        <Typography variant="caption" sx={{ minWidth: 62, color: 'text.secondary' }}>
                          Level {bucket.level || '?'}
                        </Typography>
                        <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ flex: 1, minWidth: 140 }}>
                          {bucket.occurrences.map((occurrence, index) => (
                            <Chip
                              key={index}
                              size="small"
                              variant="outlined"
                              label={`qty ${occurrence.quantity || '?'}`}
                              sx={{ fontFamily: 'monospace', fontSize: 11 }}
                            />
                          ))}
                        </Stack>
                        <TextField
                          size="small"
                          label="Quantity"
                          // Shows the aggregated figure until the user replaces
                          // it. What is stored stays separate — see `quantities`.
                          value={hasTyped ? typed : bucket.suggested}
                          onChange={(e) => setQuantity(key, e.target.value)}
                          error={invalid}
                          helperText={invalid ? 'Must be a number' : undefined}
                          inputProps={{ inputMode: 'decimal', style: { fontFamily: 'monospace', width: 92 } }}
                        />
                      </Stack>
                    );
                  })}
                </Box>
              ))}
            </Box>

            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
              Each box is filled with the aggregated quantity. Replace it with whatever quantity you
              want that line to carry — decimals such as 1.7 are allowed — and yours is used instead,
              whether or not aggregation is on.
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={visibleGroups.length === 0 ? onApplied : handleApply}
          disabled={loading || saving || invalidKeys.length > 0}
          startIcon={saving ? <CircularProgress size={14} /> : null}
        >
          {visibleGroups.length === 0 ? 'Close' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BomDuplicatePolicyDialog;
