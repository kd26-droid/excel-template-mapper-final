import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Stack, TextField, Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import api from '../services/api';
import BomDuplicatePolicyDialog from './BomDuplicatePolicyDialog';

const DEFAULT_POLICY = 'aggregate_per_level';

// What joins two kept values. Named chips rather than a text box because the
// separator people reach for most is a space, and a space typed into a field is
// invisible - the box reads empty whether it holds one or not.
const JOIN_CHOICES = [
  { key: '_', label: '_' },
  { key: '-', label: '-' },
  { key: '/', label: '/' },
  { key: ' ', label: 'space' },
  { key: '.', label: '.' },
];
const DEFAULT_JOINER = '_';

// A field's selections, joined in DISPLAY order rather than click order, so the
// same chips always produce the same string no matter how they were picked.
const joinSelected = (values, selected, joiner) => (values || [])
  .filter((value) => (selected || []).includes(value))
  .join(joiner === undefined ? DEFAULT_JOINER : joiner);
// Kept in sync with GLOBAL_DUP_POLICY_KEY in pages/Settings.js. If those
// diverge the banner would ignore the user's global default.
const GLOBAL_DEFAULT_KEY = 'fw_bom_default_dup_policy';
// 'keep_at_all_levels' is still read because it may be sitting in a browser
// from the radio version of Settings; it behaves exactly as aggregate did.
const ALLOWED_GLOBAL_DEFAULTS = new Set(['aggregate_per_level', 'keep_at_all_levels', 'keep_duplicates']);

function readGlobalDefault() {
  try {
    const v = window.localStorage.getItem(GLOBAL_DEFAULT_KEY);
    return ALLOWED_GLOBAL_DEFAULTS.has(v) ? v : null;
  } catch (_) {
    return null;
  }
}

// The chip states what the export will DO, in the fewest words that stay
// true. Anything not explicitly "leave them" aggregates, including the older
// stored values from when this was a four-way choice.
const shortLabel = (value) => (
  value === 'keep_duplicates'
    ? 'Leave duplicates (export will stop)'
    : 'Aggregate quantity at each level'
);

/**
 * Editor-level banner showing "this sheet has N duplicate item groups; they
 * will be combined at each level on export unless you change it."
 *
 * Fetches the raw duplicate groups from the backend and hides itself when
 * there are none. Same detection endpoint the dialog uses, so what you see
 * here is what the exporter will apply the policy to.
 *
 * Props:
 *   sessionId  string
 *   refreshKey (optional) — bump to force re-detect (e.g., after grid edits).
 */
const BomDuplicatePolicyBanner = ({ sessionId, refreshKey }) => {
  const [groups, setGroups] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Codes that two different parts are claiming. Not a duplicate GROUP - those
  // merge on export - but a conflict only the user can settle, and until now it
  // surfaced for the first time at the export gate.
  const [conflicts, setConflicts] = useState([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [applying, setApplying] = useState('');

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const resp = await api.detectBomDuplicatePolicy(sessionId);
      const data = resp?.data || {};
      const rawGroups = Array.isArray(data.groups) ? data.groups : [];
      const serverPolicy = data.policy?.policy || null;
      let effectivePolicy = serverPolicy;
      // If the session hasn't had a policy set yet but the user has a global
      // default configured in Settings, seed the session with it so exports
      // honour the default without a manual click. Only when there are
      // actually duplicates — otherwise the setting is irrelevant to this
      // session and we don't want to store noise.
      if (!serverPolicy && rawGroups.length > 0) {
        const globalDefault = readGlobalDefault();
        if (globalDefault) {
          try {
            await api.setBomDuplicatePolicy(sessionId, {
              policy: globalDefault,
              per_group_target_level: {},
            });
            effectivePolicy = globalDefault;
          } catch (_) {
            // Non-fatal — the backend fallback (aggregate_per_level) still
            // applies, so exports remain correct.
          }
        }
      }
      setGroups(rawGroups);
      setPolicy(effectivePolicy);

      // Same report the export gate uses, so the banner cannot disagree with it.
      try {
        const report = await api.validateBomSheet(sessionId);
        const errors = report?.data?.errors || [];
        const clash = errors.find((e) => e?.rule === 'item_code_duplicate');
        setConflicts(Array.isArray(clash?.conflicts) ? clash.conflicts : []);
      } catch (_) {
        setConflicts([]);
      }
    } catch {
      // Silent — the banner is a hint, not a blocker. Failure to detect
      // (backend restart, transient 500) just hides the banner this render.
      setGroups([]);
      setPolicy(null);
      setConflicts([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // What the user has picked, per conflict and field: which values to keep, and
  // what to put between them. Keyed '<code>|<column>' so two fields of the same
  // conflict stay independent - one may want '_' and the other a space.
  const [picks, setPicks] = useState({});
  const [joiners, setJoiners] = useState({});
  const [customJoiners, setCustomJoiners] = useState({});
  const [applyError, setApplyError] = useState('');

  const fieldKey = (code, column) => `${code}|${column}`;

  const joinerFor = useCallback((key) => {
    const custom = customJoiners[key];
    if (custom) return custom;
    return joiners[key] === undefined ? DEFAULT_JOINER : joiners[key];
  }, [joiners, customJoiners]);

  const toggleValue = useCallback((code, column, value) => {
    const key = fieldKey(code, column);
    setPicks((prev) => {
      const current = prev[key] || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
    setApplyError('');
  }, []);

  // Everything the user has chosen, flattened into one write per field. A field
  // with nothing picked is left alone rather than blocking the rest: fixing one
  // column and leaving the other is a normal thing to want.
  const pendingWrites = useCallback(() => {
    const writes = [];
    (conflicts || []).forEach((conflict) => {
      (conflict.fields || []).forEach((field) => {
        const key = fieldKey(conflict.code, field.column);
        const chosen = picks[key] || [];
        if (chosen.length === 0) return;
        writes.push({
          code: conflict.code,
          column: field.column,
          value: joinSelected(field.values, chosen, joinerFor(key)),
        });
      });
    });
    return writes;
  }, [conflicts, picks, joinerFor]);

  // Settle one disagreement by writing the value the user picked onto every row
  // carrying that item code. A conditional rule with NO 'else' branch touches
  // only the matching rows - everything else keeps what it has. Once the rows
  // agree they are the same item, so they collapse and their quantities add up.
  const writeOne = useCallback(async (code, column, value) => {
    await api.fillOrCreateColumn(sessionId, {
      type: 'column_value',
      target_mode: 'existing',
      target_column: column,
      value_mode: 'conditional',
      write_mode: 'overwrite',
      source_columns: [],
      separator: '_',
      condition: {
        branches: [{
          column: 'Item code',
          operator: 'equals',
          compare: [code],
          output_value: value,
        }],
      },
    });
  }, [sessionId]);

  // One Apply for the whole dialog. Writing on every chip click meant a person
  // correcting two fields of one code watched the grid rebuild twice and could
  // not change their mind halfway; here nothing is written until they say so.
  const applyAll = useCallback(async () => {
    const writes = pendingWrites();
    if (writes.length === 0) return;
    setApplyError('');
    const failed = [];
    for (let i = 0; i < writes.length; i += 1) {
      const write = writes[i];
      setApplying(`${i + 1} of ${writes.length}`);
      try {
        // Sequential on purpose: these are writes to the same grid, and firing
        // them together lets two land on one stale copy.
        await writeOne(write.code, write.column, write.value);
      } catch (_) {
        failed.push(`${write.code} / ${write.column}`);
      }
    }
    setApplying('');
    if (failed.length > 0) {
      // Selections are kept so the user can press Apply again rather than
      // rebuilding every choice.
      setApplyError(`Could not apply: ${failed.join(', ')}. Your choices are still here - try Apply again.`);
      await refresh();
      return;
    }
    setPicks({});
    setReviewOpen(false);
    await refresh();
  }, [pendingWrites, writeOne, refresh]);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  if (loading || (groups.length === 0 && conflicts.length === 0)) return null;

  const activePolicy = policy || DEFAULT_POLICY;
  const isDefault = !policy;

  const sameLevelCount = groups.filter((g) => g.kind === 'same_level').length;
  const acrossLevelCount = groups.filter((g) => g.kind === 'across_level').length;
  const bothCount = groups.filter((g) => g.kind === 'both').length;

  const parts = [];
  if (sameLevelCount) parts.push(`${sameLevelCount} same-level`);
  if (acrossLevelCount) parts.push(`${acrossLevelCount} across-level`);
  if (bothCount) parts.push(`${bothCount} same + across`);

  return (
    <>
      <Alert
        /* Blue means "handled on export". Anything needing a human decision has
           to look different, or it reads as handled and is met for the first
           time at the export gate. */
        severity={conflicts.length > 0 ? 'warning' : 'info'}
        icon={conflicts.length > 0
          ? <WarningAmberOutlinedIcon fontSize="small" />
          : <InfoOutlinedIcon fontSize="small" />}
        variant="outlined"
        sx={{ mb: 1.5, py: 0.5, '.MuiAlert-message': { py: 0.5, flex: 1 } }}
        action={
          <Stack direction="row" gap={1}>
            {conflicts.length > 0 && (
              <Button size="small" variant="text" onClick={() => setReviewOpen(true)}>
                Review
              </Button>
            )}
            <Button
              size="small"
              variant="text"
              onClick={() => setDialogOpen(true)}
            >
              {isDefault ? 'Change' : 'Change setting'}
            </Button>
          </Stack>
        }
      >
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {groups.length} duplicate item group{groups.length === 1 ? '' : 's'} detected
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            ({parts.join(', ')})
          </Typography>
          <Chip
            size="small"
            label={`On export: ${shortLabel(activePolicy)}${isDefault ? ' (default)' : ''}`}
            color={isDefault ? 'default' : 'primary'}
            variant="outlined"
          />
          {conflicts.length > 0 && (
            <Chip
              size="small"
              color="warning"
              label={`${conflicts.length} need your decision`}
            />
          )}
        </Stack>
      </Alert>
      <Dialog open={reviewOpen} onClose={() => setReviewOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            One item code, two different parts
          </Typography>
          <Typography variant="body2" color="text.secondary">
            These codes are shared by rows that disagree, so every BOM line using
            them is ambiguous. Pick a value to make the rows match - they then
            merge into one item and their quantities add up. If they really are
            different parts, give them different item codes in the grid instead.
            Do not delete a row: that removes its BOM line too.
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Stack gap={1.5}>
            {conflicts.map((conflict) => (
              <Box key={conflict.code}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {conflict.code}
                  <Box component="span" sx={{ fontWeight: 400, opacity: 0.7 }}>
                    {` — ${conflict.rows} rows`}
                  </Box>
                </Typography>
                {(conflict.fields || []).length > 0 ? (
                  (conflict.fields || []).map((field) => (
                    <Stack
                      key={field.column}
                      direction="row"
                      alignItems="center"
                      gap={0.75}
                      flexWrap="wrap"
                      sx={{ pl: 1.5, mt: 0.25 }}
                    >
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {`differs on ${field.column}:`}
                      </Typography>
                      {(field.values || []).map((v) => {
                        const key = `${conflict.code}|${field.column}`;
                        const chosen = (picks[key] || []).includes(v);
                        return (
                          <Chip
                            key={`${field.column}|${v}`}
                            size="small"
                            clickable
                            disabled={Boolean(applying)}
                            color={chosen ? 'primary' : 'default'}
                            variant={chosen ? 'filled' : 'outlined'}
                            onClick={() => toggleValue(conflict.code, field.column, v)}
                            label={v === '' ? '(blank)' : v}
                            sx={{ fontFamily: 'monospace' }}
                          />
                        );
                      })}
                      {(picks[`${conflict.code}|${field.column}`] || []).length > 1 && (
                        <Stack
                          direction="row"
                          alignItems="center"
                          gap={0.5}
                          flexWrap="wrap"
                          sx={{ width: '100%', pl: 0.5, mt: 0.25 }}
                        >
                          <Typography variant="caption" color="text.secondary">
                            join with:
                          </Typography>
                          {JOIN_CHOICES.map((choice) => {
                            const key = `${conflict.code}|${field.column}`;
                            const active = !customJoiners[key] && joinerFor(key) === choice.key;
                            return (
                              <Chip
                                key={choice.key}
                                size="small"
                                clickable
                                disabled={Boolean(applying)}
                                color={active ? 'primary' : 'default'}
                                variant={active ? 'filled' : 'outlined'}
                                label={choice.label}
                                onClick={() => {
                                  setJoiners((prev) => ({ ...prev, [key]: choice.key }));
                                  setCustomJoiners((prev) => ({ ...prev, [key]: '' }));
                                }}
                              />
                            );
                          })}
                          <TextField
                            size="small"
                            placeholder="other"
                            value={customJoiners[`${conflict.code}|${field.column}`] || ''}
                            disabled={Boolean(applying)}
                            onChange={(e) => setCustomJoiners((prev) => ({
                              ...prev, [`${conflict.code}|${field.column}`]: e.target.value,
                            }))}
                            sx={{ width: 78 }}
                            inputProps={{ style: { padding: '2px 6px', fontSize: 12 } }}
                          />
                          <Typography
                            variant="caption"
                            sx={{ fontFamily: 'monospace', fontWeight: 700, ml: 0.5 }}
                          >
                            {joinSelected(
                              field.values,
                              picks[`${conflict.code}|${field.column}`],
                              joinerFor(`${conflict.code}|${field.column}`),
                            )}
                          </Typography>
                        </Stack>
                      )}
                    </Stack>
                  ))
                ) : (
                  <Typography variant="caption" sx={{ display: 'block', pl: 1.5 }} color="text.secondary">
                    rows match — they merge into one item automatically
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5, gap: 1 }}>
          {applyError ? (
            <Typography variant="caption" color="error" sx={{ flex: 1 }}>
              {applyError}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
              {pendingWrites().length === 0
                ? 'Pick a value on any line. Pick two or more to join them.'
                : `${pendingWrites().length} field${pendingWrites().length === 1 ? '' : 's'} will be written.`}
            </Typography>
          )}
          <Button onClick={() => setReviewOpen(false)} disabled={Boolean(applying)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={applyAll}
            disabled={Boolean(applying) || pendingWrites().length === 0}
          >
            {applying ? `Applying ${applying}…` : 'Apply'}
          </Button>
        </DialogActions>
      </Dialog>
      <BomDuplicatePolicyDialog
        open={dialogOpen}
        sessionId={sessionId}
        onClose={() => setDialogOpen(false)}
        onApplied={() => { setDialogOpen(false); refresh(); }}
      />
    </>
  );
};

export default BomDuplicatePolicyBanner;
