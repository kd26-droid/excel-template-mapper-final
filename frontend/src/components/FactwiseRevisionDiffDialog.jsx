import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { fetchEnterpriseBomDetail } from '../services/factwiseApi';
import api from '../services/api';
import {
  diffBomTrees,
  pairedRows,
  mapperTreeToBomVersion,
} from '../utils/bomDiff';

// Revision diff — visual pass mimics FactWise's own comparison UI at
// /custom/cost-tracking/projects/{id}/bom-comparison. Two synchronized panes,
// filter chips at the top with counts, colored row backgrounds by status,
// inline old→new for modified fields. Fires as the FIRST phase of the
// revise flow, before any FactWise-mutating call — both sides come from
// read-only fetches (R4 detail + mapper's local bom_tree).

// Color palette lifted from FW's ComparisonRow/ItemDisplay so this feels
// like the same product the user already knows.
const PALETTE = {
  added:     { bg: '#dcfce7', border: '#22c55e', text: '#166534', label: 'ADDED'    },
  deleted:   { bg: '#fee2e2', border: '#ef4444', text: '#991b1b', label: 'DELETED'  },
  modified:  { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', label: 'MODIFIED' },
  unchanged: { bg: 'transparent', border: 'transparent', text: '#6b7280', label: '' },
};

const FILTERS = [
  { key: 'changes',  label: 'Changes only' },
  { key: 'all',      label: 'All' },
  { key: 'added',    label: 'Added' },
  { key: 'deleted',  label: 'Deleted' },
  { key: 'modified', label: 'Modified' },
];

function useRevisionDiff({ open, supersededEnterpriseBomId, sessionId }) {
  const [state, setState] = useState({
    loading: true, error: null, diff: null,
    leftLabel: null, rightLabel: null,
  });

  useEffect(() => {
    if (!open) return undefined;
    if (!supersededEnterpriseBomId || !sessionId) {
      setState({
        loading: false,
        error: 'Missing revision context — no source BOM or session to compare against.',
        diff: null, leftLabel: null, rightLabel: null,
      });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, error: null, diff: null, leftLabel: null, rightLabel: null });
    (async () => {
      try {
        const [r4Resp, treeResp] = await Promise.all([
          fetchEnterpriseBomDetail(supersededEnterpriseBomId),
          api.getBomTree(sessionId).catch((err) => ({
            data: {
              success: false,
              error: err?.response?.data?.error || err?.message || 'BOM tree fetch failed',
            },
          })),
        ]);
        if (cancelled) return;
        if (!r4Resp?.success) {
          setState({
            loading: false,
            error: r4Resp?.error || 'Could not fetch the current BOM from Factwise.',
            diff: null, leftLabel: null, rightLabel: null,
          });
          return;
        }
        const treeData = treeResp?.data;
        if (!treeData?.success || !treeData.tree) {
          setState({
            loading: false,
            error: treeData?.error
              || 'Could not build a BOM tree from the mapper\'s current sheet.',
            diff: null, leftLabel: null, rightLabel: null,
          });
          return;
        }
        const rightVersion = mapperTreeToBomVersion(treeData.tree);
        const diff = diffBomTrees({ leftBom: r4Resp.bom, rightVersion });
        setState({
          loading: false,
          error: null,
          diff,
          leftLabel: {
            code: r4Resp.bom?.bom_code || '',
            name: r4Resp.bom?.bom_name || '',
          },
          rightLabel: {
            code: rightVersion.enterprise_bom?.bom_code || '',
            name: rightVersion.enterprise_bom?.bom_name || '',
          },
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          error: err?.message || 'Diff failed to build.',
          diff: null, leftLabel: null, rightLabel: null,
        });
      }
    })();
    return () => { cancelled = true; };
  }, [open, supersededEnterpriseBomId, sessionId]);

  return state;
}

// One cell inside a pane. Empty box for absent-on-this-side rows so the two
// panes stay aligned line-for-line — that alignment is what makes visual
// scanning of a diff work at all.
function PaneCell({ side, row }) {
  const isEmpty = side === 'left' ? !row.leftNode : !row.rightNode;
  const status = row.status;
  const palette = PALETTE[status] || PALETTE.unchanged;
  const label = row.leftLabel || row.rightLabel;
  const indent = row.depth * 20;

  if (isEmpty) {
    // Placeholder so the counterpart pane's row still has a spot. Faded
    // rail on the correct side (delete → left rail red, add → right rail
    // green) so a scanner sees "this side didn't have this" at a glance.
    const railColor =
      status === 'added' ? PALETTE.added.border
      : status === 'deleted' ? PALETTE.deleted.border
      : 'transparent';
    return (
      <Box
        sx={{
          minHeight: 44,
          borderLeft: `3px solid ${railColor}`,
          bgcolor: 'transparent',
          opacity: 0.4,
          display: 'flex',
          alignItems: 'center',
          pl: `${8 + indent}px`,
          pr: 1,
          fontSize: 12,
          color: 'text.disabled',
          fontStyle: 'italic',
        }}
      >
        —
      </Box>
    );
  }

  const node = side === 'left' ? row.leftNode : row.rightNode;
  const qty = node?.quantity ?? null;
  const qtyChange = row.changes?.quantity;
  const isSubBom = row.type === 'sub-bom';

  return (
    <Box
      sx={{
        minHeight: 44,
        borderLeft: `3px solid ${palette.border}`,
        bgcolor: palette.bg,
        display: 'flex',
        alignItems: 'center',
        pl: `${8 + indent}px`,
        pr: 1.5,
        py: 0.75,
        gap: 1.5,
      }}
    >
      {/* Type badge — sub-BOM triangle vs raw material dot, keeps them
          distinguishable without a whole extra column. */}
      <Typography sx={{
        fontSize: 10, color: palette.text, fontWeight: 700,
        minWidth: 14, textAlign: 'center',
      }}>
        {isSubBom ? '▸' : '•'}
      </Typography>

      {/* Code (mono, prominent) + name (secondary). Same layout FW uses. */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{
          fontSize: 13, fontFamily: 'monospace', fontWeight: 600,
          color: palette.text || 'text.primary',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {label?.code || '—'}
        </Typography>
        {label?.name && label.name !== label.code && (
          <Typography sx={{
            fontSize: 11, color: 'text.secondary',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {label.name}
          </Typography>
        )}
      </Box>

      {/* Quantity — with old→new highlight on the correct side when modified.
          "OLD" chip on the left pane, "NEW" chip on the right pane. FW
          calls these badges the same. */}
      {qty !== null && (
        <Box sx={{ textAlign: 'right', minWidth: 80 }}>
          {qtyChange ? (
            <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end">
              <Typography sx={{
                fontSize: 12,
                fontWeight: 700,
                color: side === 'left' ? PALETTE.deleted.text : PALETTE.added.text,
              }}>
                qty {qty}
              </Typography>
              <Chip
                size="small"
                label={side === 'left' ? 'OLD' : 'NEW'}
                sx={{
                  height: 16, fontSize: 9, fontWeight: 700,
                  bgcolor: side === 'left' ? PALETTE.deleted.border : PALETTE.added.border,
                  color: 'white',
                }}
              />
            </Stack>
          ) : (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              qty {qty}
            </Typography>
          )}
        </Box>
      )}

      {/* Status pill on the far right — FW's ADDED/DELETED/MODIFIED tag. */}
      {status !== 'unchanged' && (
        <Chip
          size="small"
          label={palette.label}
          sx={{
            height: 20, fontSize: 10, fontWeight: 700,
            bgcolor: palette.border,
            color: 'white',
            letterSpacing: 0.5,
          }}
        />
      )}
    </Box>
  );
}

// One diff row rendered across both panes. Two cells side-by-side plus, for
// sub-BOMs, a shared expand/collapse chevron column between the panes so
// toggling on one side toggles both.
function DiffRow({ row, onToggle }) {
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '1fr 32px 1fr',
      alignItems: 'stretch',
      borderBottom: '1px solid',
      borderColor: 'divider',
    }}>
      <PaneCell side="left" row={row} />
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.paper',
        borderLeft: '1px solid', borderRight: '1px solid', borderColor: 'divider',
      }}>
        {row.hasChildren ? (
          <IconButton size="small" onClick={onToggle} sx={{ p: 0.25 }}>
            {row.isExpanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
          </IconButton>
        ) : null}
      </Box>
      <PaneCell side="right" row={row} />
    </Box>
  );
}

export default function FactwiseRevisionDiffDialog({
  open,
  supersededEnterpriseBomId,
  sessionId,
  reviseBomCode,
  onConfirm,
  onCancel,
}) {
  const { loading, error, diff, leftLabel, rightLabel } = useRevisionDiff({
    open, supersededEnterpriseBomId, sessionId,
  });

  const [filter, setFilter] = useState('changes');
  const [expanded, setExpanded] = useState(() => new Set());

  // Auto-expand ancestors of any changed node the first time a diff arrives.
  // Otherwise the "Changes only" default filter shows nothing when every
  // change is nested under a collapsed sub-BOM.
  useEffect(() => {
    if (!diff) { setExpanded(new Set()); return; }
    const auto = new Set();
    const walk = (nodes) => {
      for (const n of nodes) {
        const kidsChanged = (n.rollup?.added || 0) + (n.rollup?.deleted || 0) + (n.rollup?.modified || 0);
        if (kidsChanged > 0 && n.children?.length) {
          auto.add(n.path);
          walk(n.children);
        }
      }
    };
    walk(diff.children);
    setExpanded(auto);
  }, [diff]);

  const rows = useMemo(() => {
    if (!diff) return [];
    return pairedRows(diff, { filter, expanded });
  }, [diff, filter, expanded]);

  const toggleNode = useCallback((path) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const summary = diff?.summary || { added: 0, deleted: 0, modified: 0, unchanged: 0, total: 0 };
  const changesTotal = summary.added + summary.deleted + summary.modified;

  const filterCount = (key) => {
    if (key === 'all')     return summary.total;
    if (key === 'changes') return changesTotal;
    return summary[key] || 0;
  };

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth={false}
      fullWidth
      PaperProps={{ sx: {
        borderRadius: 2,
        width: '96vw', height: '94vh', maxWidth: 'none', maxHeight: 'none',
      } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Review revision {reviseBomCode ? `— ${reviseBomCode}` : ''}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Nothing is committed to Factwise until you confirm. Reject and edit the sheet freely.
          </Typography>
        </Box>
        <IconButton size="small" onClick={onCancel}><CloseIcon /></IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <Box sx={{ p: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <CircularProgress />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Loading current BOM and building tree from the mapper sheet…
            </Typography>
          </Box>
        )}

        {!loading && error && (
          <Box sx={{ p: 3 }}>
            <Alert severity="error">{error}</Alert>
          </Box>
        )}

        {!loading && !error && diff && (
          <>
            {/* Summary tiles — matches FW's dashboard-metrics header up top. */}
            <Box sx={{
              px: 3, py: 2,
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 2,
              borderBottom: '1px solid',
              borderColor: 'divider',
              bgcolor: '#fafafa',
            }}>
              {[
                { key: 'total',    label: 'Total rows',   value: summary.total,    color: '#374151' },
                { key: 'added',    label: 'Added',        value: summary.added,    color: PALETTE.added.border },
                { key: 'deleted',  label: 'Deleted',      value: summary.deleted,  color: PALETTE.deleted.border },
                { key: 'modified', label: 'Modified',     value: summary.modified, color: PALETTE.modified.border },
              ].map((tile) => (
                <Box
                  key={tile.key}
                  onClick={() => {
                    if (tile.key === 'total') setFilter('all');
                    else setFilter(tile.key);
                  }}
                  sx={{
                    p: 1.5, borderRadius: 1.5,
                    border: '2px solid',
                    borderColor: filter === (tile.key === 'total' ? 'all' : tile.key) ? tile.color : 'transparent',
                    bgcolor: 'white',
                    cursor: 'pointer',
                    transition: 'all 120ms',
                    '&:hover': { borderColor: tile.color, opacity: 0.9 },
                  }}
                >
                  <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {tile.label}
                  </Typography>
                  <Typography sx={{ fontSize: 28, fontWeight: 700, color: tile.color, lineHeight: 1.2 }}>
                    {tile.value}
                  </Typography>
                </Box>
              ))}
            </Box>

            {/* Filter chip row — Changes only is default. */}
            <Box sx={{ px: 3, py: 1.5, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', mr: 1 }}>
                FILTER
              </Typography>
              {FILTERS.map((f) => {
                const active = filter === f.key;
                const n = filterCount(f.key);
                return (
                  <Chip
                    key={f.key}
                    label={`${f.label} (${n})`}
                    size="small"
                    color={active ? 'primary' : 'default'}
                    variant={active ? 'filled' : 'outlined'}
                    onClick={() => setFilter(f.key)}
                    sx={{ fontWeight: 600 }}
                  />
                );
              })}
            </Box>

            {/* Two-pane column headers — sticky above the scrolling body. */}
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 32px 1fr',
              borderBottom: '2px solid',
              borderColor: 'divider',
              bgcolor: '#f9fafb',
              position: 'sticky',
              top: 0,
              zIndex: 2,
            }}>
              <Box sx={{ px: 2, py: 1.5, borderLeft: `4px solid ${PALETTE.deleted.border}` }}>
                <Typography sx={{ fontSize: 11, color: PALETTE.deleted.text, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Current — {leftLabel?.code || 'R4'}
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  What Factwise has right now
                </Typography>
              </Box>
              <Box />
              <Box sx={{ px: 2, py: 1.5, borderLeft: `4px solid ${PALETTE.added.border}` }}>
                <Typography sx={{ fontSize: 11, color: PALETTE.added.text, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Uploaded sheet — {rightLabel?.code || 'preview'}
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  What this revision will make it
                </Typography>
              </Box>
            </Box>

            {/* Scrollable body — the paired panes. */}
            <Box sx={{ flex: 1, overflow: 'auto' }}>
              {rows.length === 0 ? (
                <Box sx={{ p: 5, textAlign: 'center', color: 'text.secondary' }}>
                  <Typography variant="body2">
                    {filter === 'all'
                      ? 'This revision is empty — no items on either side.'
                      : `No ${filter === 'changes' ? 'changes' : filter} to show.`}
                  </Typography>
                </Box>
              ) : (
                rows.map((row) => (
                  <DiffRow
                    key={row.path}
                    row={row}
                    onToggle={() => toggleNode(row.path)}
                  />
                ))
              )}
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', mr: 'auto' }}>
          {changesTotal === 0
            ? 'No changes vs the current BOM. Confirm to proceed anyway, or reject to edit the sheet first — nothing is committed to Factwise yet.'
            : `${changesTotal} change${changesTotal === 1 ? '' : 's'} vs the current BOM. Confirm to send items, upload the sheet, and hand off — nothing runs until you do.`}
        </Typography>
        <Button color="warning" onClick={onCancel} disabled={loading}>
          Reject &amp; edit sheet
        </Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          disabled={loading || Boolean(error)}
        >
          Confirm &amp; export
        </Button>
      </DialogActions>
    </Dialog>
  );
}
