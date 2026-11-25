import React from 'react';
import { Box, Button, FormControl, IconButton, InputLabel, MenuItem, Popover, Select, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';

export default function SheetSortPopover({ sortAnchor, sortDraft, setSortDraft, columns, tableTone, onClose, onApply }) {
  return (
    <Popover open={Boolean(sortAnchor)} anchorEl={sortAnchor} onClose={() => onClose()} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} PaperProps={{ sx: { mt: 0.75, p: 1.5, borderRadius: 2.5, width: 440, maxWidth: 'calc(100vw - 24px)' } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.25 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Sort</Typography>
        <Button size="small" sx={{ fontSize: 12, minWidth: 0, px: 1 }} onClick={() => setSortDraft([])}>Clear all</Button>
      </Stack>
      <Stack gap={1}>
        {sortDraft.map((rule, index) => (
          <Stack key={`sort-${index}`} direction="row" alignItems="center" gap={0.75}>
            <Typography sx={{ width: 34, fontSize: 10, fontWeight: 600, color: tableTone.muted }}>SORT</Typography>
            <FormControl size="small" fullWidth sx={{ '& .MuiInputLabel-root': { fontSize: 11.5 }, '& .MuiInputBase-root': { height: 36, fontSize: 13 }, '& .MuiSelect-select': { py: 0.75 } }}>
              <InputLabel>Field</InputLabel>
              <Select value={rule.field} label="Field" onChange={(event) => setSortDraft((current) => current.map((item, i) => i === index ? { ...item, field: event.target.value } : item))}>
                {columns.map((column) => <MenuItem key={column.key} value={column.key}>{column.label}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 126, '& .MuiInputLabel-root': { fontSize: 11.5 }, '& .MuiInputBase-root': { height: 36, fontSize: 13 }, '& .MuiSelect-select': { py: 0.75 } }}>
              <InputLabel>Direction</InputLabel>
              <Select value={rule.direction} label="Direction" onChange={(event) => setSortDraft((current) => current.map((item, i) => i === index ? { ...item, direction: event.target.value } : item))}>
                <MenuItem value="asc">Ascending</MenuItem><MenuItem value="desc">Descending</MenuItem>
              </Select>
            </FormControl>
            <IconButton size="small" aria-label="Remove sort rule" onClick={() => setSortDraft((current) => current.filter((_, i) => i !== index))}><CloseIcon fontSize="small" /></IconButton>
          </Stack>
        ))}
        <Button size="small" startIcon={<AddIcon />} disabled={sortDraft.length >= columns.length} onClick={() => { const available = columns.find((col) => !sortDraft.some((rule) => rule.field === col.key)); if (available) setSortDraft((current) => [...current, { field: available.key, direction: 'asc' }]); }} sx={{ alignSelf: 'flex-start', fontSize: 12 }}>Add sort</Button>
      </Stack>
      <Stack direction="row" justifyContent="flex-end" gap={0.75} sx={{ mt: 1.25, pt: 1, borderTop: `1px solid ${tableTone.headerBorder}` }}>
        <Button size="small" sx={{ fontSize: 12 }} onClick={() => onClose()}>Cancel</Button>
        <Button size="small" variant="contained" onClick={() => { onApply(sortDraft); onClose(); }}>Apply</Button>
      </Stack>
    </Popover>
  );
}
