import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Chip, Stack, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
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
    } catch {
      // Silent — the banner is a hint, not a blocker. Failure to detect
      // (backend restart, transient 500) just hides the banner this render.
      setGroups([]);
      setPolicy(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  if (loading || groups.length === 0) return null;

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
        severity="info"
        icon={<InfoOutlinedIcon fontSize="small" />}
        variant="outlined"
        sx={{ mb: 1.5, py: 0.5, '.MuiAlert-message': { py: 0.5, flex: 1 } }}
        action={
          <Button
            size="small"
            variant="text"
            onClick={() => setDialogOpen(true)}
          >
            {isDefault ? 'Change' : 'Change setting'}
          </Button>
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
        </Stack>
      </Alert>
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
