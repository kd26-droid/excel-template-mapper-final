import React, { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Grid,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { displayHeaderName } from '../utils/columnHeaderNames';

// The Fill / Create Column fields, as a controlled component so the same rule
// can be authored in Settings and replayed in the editor. `value` IS the rule
// payload `fill_or_create_column` accepts — no translation on either side.
export const VALUE_MODE_OPTIONS = [
  { value: 'fixed', label: 'Use a default value' },
  { value: 'copy', label: 'Copy from one column' },
  { value: 'concat', label: 'Join two columns' },
  { value: 'conditional', label: 'Use an if / else condition' },
  { value: 'serial', label: 'Generate a serial sequence' },
];

export const WRITE_MODE_OPTIONS = [
  { value: 'fill_empty', label: 'Only rows where this column is empty' },
  { value: 'overwrite', label: 'All rows' },
  { value: 'duplicates', label: 'Only rows with a duplicate value' },
];

const SEPARATOR_OPTIONS = [
  { value: '', label: 'No separator' },
  { value: ' ', label: 'Space' },
  { value: '-', label: 'Hyphen -' },
  { value: ' - ', label: 'Spaced hyphen -' },
  { value: '_', label: 'Underscore _' },
  { value: '/', label: 'Slash /' },
  { value: '|', label: 'Pipe |' },
  { value: ',', label: 'Comma ,' },
];

// These values go to the engine verbatim. 'is_not_empty' was not one it knows
// — an unrecognised operator matches nothing, so that option silently never
// fired. 'not_empty' is the name the engine and the editor's own dialog use.
const CONDITION_OPERATORS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'not_empty', label: 'is not empty' },
];

export function createEmptyColumnRule() {
  return {
    target_mode: 'existing',
    target_column: '',
    value_mode: 'fixed',
    write_mode: 'fill_empty',
    source_columns: [],
    separator: ' ',
    fixed_value: '',
    condition: { branches: [createEmptyBranch()], else: '' },
    serial_prefix: '',
    serial_start: 1,
    serial_padding: 3,
    serial_increment: 1,
  };
}

function createEmptyBranch() {
  return { column: '', operator: 'contains', compare: '', output_value: '' };
}

export default function ColumnRuleBuilder({
  value,
  onChange,
  columnOptions = [],
  // The editor supplies the destination itself (the column being filled), so
  // the picker is hidden there.
  showTargetColumn = true,
  showWriteMode = true,
}) {
  const rule = value || createEmptyColumnRule();
  const set = (patch) => onChange({ ...rule, ...patch });
  const branches = rule.condition?.branches?.length
    ? rule.condition.branches
    : [createEmptyBranch()];

  const setBranch = (index, patch) => {
    const next = branches.map((branch, i) => (i === index ? { ...branch, ...patch } : branch));
    set({ condition: { ...(rule.condition || {}), branches: next } });
  };

  // A branch matches "any of these" when `compare` is a list — the shape the
  // engine already accepts. A single typed value stays a plain string, so
  // nothing about existing rules changes; pressing Enter is what promotes it
  // to a list. Commas are never split: component descriptions are full of them
  // ("CAPACITOR 0.22U, 10V"), so splitting would match far more than intended.
  const [compareDrafts, setCompareDrafts] = useState({});
  const compareList = (branch) => (Array.isArray(branch.compare) ? branch.compare : null);

  const commitCompareDraft = (index, branch) => {
    const entered = String(compareDrafts[index] ?? '').trim();
    if (!entered) return;
    const existing = compareList(branch) || [];
    setBranch(index, { compare: Array.from(new Set([...existing, entered])) });
    setCompareDrafts(prev => ({ ...prev, [index]: '' }));
  };

  const columnField = (label, current, onPick, extraProps = {}) => (
    <TextField
      select
      fullWidth
      size="small"
      label={label}
      value={columnOptions.includes(current) ? current : ''}
      onChange={(e) => onPick(e.target.value)}
      {...extraProps}
    >
      {columnOptions.map(col => (
        <MenuItem key={col} value={col}>{displayHeaderName(col, columnOptions)}</MenuItem>
      ))}
    </TextField>
  );

  return (
    <Grid container spacing={1.5}>
      {showTargetColumn && (
        <Grid item xs={12}>
          {columnField('Column to fill', rule.target_column, v => set({ target_column: v }))}
        </Grid>
      )}

      <Grid item xs={12} sm={showWriteMode ? 6 : 12}>
        <TextField
          select
          fullWidth
          size="small"
          label="How to set the value"
          value={rule.value_mode}
          onChange={(e) => set({ value_mode: e.target.value })}
        >
          {VALUE_MODE_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </TextField>
      </Grid>

      {showWriteMode && (
        <Grid item xs={12} sm={6}>
          <TextField
            select
            fullWidth
            size="small"
            label="Rows to update"
            value={rule.write_mode}
            onChange={(e) => set({ write_mode: e.target.value })}
          >
            {WRITE_MODE_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
        </Grid>
      )}

      {rule.value_mode === 'fixed' && (
        <Grid item xs={12}>
          <TextField
            fullWidth
            size="small"
            label="Value"
            value={rule.fixed_value || ''}
            onChange={(e) => set({ fixed_value: e.target.value })}
          />
        </Grid>
      )}

      {rule.value_mode === 'copy' && (
        <Grid item xs={12}>
          {columnField('Copy from', (rule.source_columns || [])[0] || '', v => set({ source_columns: [v] }))}
        </Grid>
      )}

      {rule.value_mode === 'concat' && (
        <>
          <Grid item xs={12} sm={4}>
            {columnField('First column', (rule.source_columns || [])[0] || '',
              v => set({ source_columns: [v, (rule.source_columns || [])[1] || ''] }))}
          </Grid>
          <Grid item xs={12} sm={4}>
            {columnField('Second column', (rule.source_columns || [])[1] || '',
              v => set({ source_columns: [(rule.source_columns || [])[0] || '', v] }))}
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              select
              fullWidth
              size="small"
              label="Separator"
              value={rule.separator ?? ' '}
              onChange={(e) => set({ separator: e.target.value })}
            >
              {SEPARATOR_OPTIONS.map(o => (
                <MenuItem key={o.label} value={o.value}>{o.label}</MenuItem>
              ))}
            </TextField>
          </Grid>
        </>
      )}

      {rule.value_mode === 'conditional' && (
        <Grid item xs={12}>
          {branches.map((branch, index) => (
            <Box key={index} sx={{ mb: 1 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ minWidth: 54 }}>
                {index === 0 ? 'If' : 'Else if'}
              </Typography>
              <Box sx={{ minWidth: 160, flex: 1 }}>
                {columnField('Source column', branch.column, v => setBranch(index, { column: v }))}
              </Box>
              <TextField
                select
                size="small"
                label="Condition"
                value={branch.operator || 'contains'}
                onChange={(e) => setBranch(index, { operator: e.target.value })}
                sx={{ minWidth: 130 }}
              >
                {CONDITION_OPERATORS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
              {!['is_empty', 'not_empty'].includes(branch.operator) && (
                <TextField
                  size="small"
                  label="Text"
                  value={compareList(branch) ? (compareDrafts[index] ?? '') : (branch.compare || '')}
                  placeholder={compareList(branch)
                    ? 'Type another value, then press Enter'
                    : 'Press Enter to match any of several values'}
                  onChange={(e) => {
                    if (compareList(branch)) {
                      setCompareDrafts(prev => ({ ...prev, [index]: e.target.value }));
                    } else {
                      setBranch(index, { compare: e.target.value });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (compareList(branch)) {
                      commitCompareDraft(index, branch);
                      return;
                    }
                    const entered = String(branch.compare || '').trim();
                    if (entered) setBranch(index, { compare: [entered] });
                  }}
                  // Committed on the way out too. Typing a value and clicking
                  // Save rule without pressing Enter would otherwise drop it
                  // silently, which is the failure this whole field invites.
                  onBlur={() => { if (compareList(branch)) commitCompareDraft(index, branch); }}
                  sx={{ minWidth: 130 }}
                />
              )}
              <TextField
                size="small"
                label="Then use"
                value={branch.output_value || ''}
                onChange={(e) => setBranch(index, { output_value: e.target.value })}
                sx={{ minWidth: 130 }}
              />
              {branches.length > 1 && (
                <IconButton
                  size="small"
                  onClick={() => set({
                    condition: {
                      ...(rule.condition || {}),
                      branches: branches.filter((_, i) => i !== index),
                    },
                  })}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              )}
              </Box>
              {/* Values sit on their own row so the controls above stay
                  aligned however many are added. */}
              {compareList(branch)?.length > 0 && (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center', mt: 0.75, ml: 7 }}>
                  <Typography variant="caption" sx={{ mr: 0.5 }}>
                    {branch.operator === 'not_equals' ? 'None of:' : 'Any of:'}
                  </Typography>
                  {compareList(branch).map(entry => (
                    <Chip
                      key={entry}
                      size="small"
                      label={entry}
                      onDelete={() => {
                        const remaining = compareList(branch).filter(v => v !== entry);
                        // Back to a plain string once the list is empty, so the
                        // field returns to ordinary typing.
                        setBranch(index, { compare: remaining.length ? remaining : '' });
                      }}
                    />
                  ))}
                </Box>
              )}
            </Box>
          ))}
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mt: 1 }}>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => set({
                condition: { ...(rule.condition || {}), branches: [...branches, createEmptyBranch()] },
              })}
            >
              Add another condition
            </Button>
            <TextField
              size="small"
              label="Otherwise"
              placeholder="Leave blank to keep the current value"
              value={rule.condition?.else ?? ''}
              onChange={(e) => set({ condition: { ...(rule.condition || {}), else: e.target.value } })}
              sx={{ minWidth: 260, flex: 1 }}
            />
          </Box>
        </Grid>
      )}

      {rule.value_mode === 'serial' && (
        <>
          <Grid item xs={6} sm={3}>
            <TextField
              fullWidth size="small" label="Prefix"
              value={rule.serial_prefix || ''}
              onChange={(e) => set({ serial_prefix: e.target.value })}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              fullWidth size="small" type="number" label="Start at"
              value={rule.serial_start ?? 1}
              onChange={(e) => set({ serial_start: Number(e.target.value) })}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              fullWidth size="small" type="number" label="Number padding"
              value={rule.serial_padding ?? 3}
              onChange={(e) => set({ serial_padding: Number(e.target.value) })}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              fullWidth size="small" type="number" label="Increment"
              value={rule.serial_increment ?? 1}
              onChange={(e) => set({ serial_increment: Number(e.target.value) })}
            />
          </Grid>
        </>
      )}
    </Grid>
  );
}
