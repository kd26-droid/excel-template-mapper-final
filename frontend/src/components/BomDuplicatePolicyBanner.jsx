import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, Stack, Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import api from '../services/api';
import BomDuplicatePolicyDialog from './BomDuplicatePolicyDialog';

const DEFAULT_POLICY = 'aggregate_per_level';
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

  // Settle one disagreement by writing the value the user picked onto every row
  // carrying that item code. A conditional rule with NO 'else' branch touches
  // only the matching rows - everything else keeps what it has. Once the rows
  // agree they are the same item, so they collapse and their quantities add up.
  const useValue = useCallback(async (code, column, value) => {
    setApplying(`${code}|${column}|${value}`);
    try {
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
      await refresh();
    } catch (_) {
      // The row simply stays as it was; the banner still names the conflict.
    } finally {
      setApplying('');
    }
  }, [sessionId, refresh]);

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
                      {(field.values || []).map((v) => (
                        <Button
                          key={`${field.column}|${v}`}
                          size="small"
                          variant="outlined"
                          disabled={Boolean(applying)}
                          onClick={() => useValue(conflict.code, field.column, v)}
                          sx={{ textTransform: 'none', py: 0, minWidth: 0, fontFamily: 'monospace' }}
                        >
                          {applying === `${conflict.code}|${field.column}|${v}`
                            ? 'applying…'
                            : `use ${v === '' ? '(blank)' : v}`}
                        </Button>
                      ))}
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
