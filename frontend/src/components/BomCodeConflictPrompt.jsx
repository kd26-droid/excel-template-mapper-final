import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';

// Shown when the sheet's BOM ID is already taken in FactWise, where bom_code is
// unique per organisation. The export has NOT failed at this point — nothing
// has been uploaded — so this asks for a new ID rather than reporting an error.
//
// It deliberately does not invent a code. The previous behaviour appended a
// timestamp suffix silently, and the BOM landed in the admin directory under a
// name the user never chose and would not think to search for.
export default function BomCodeConflictPrompt({
  conflicts = [],
  disabled = false,
  onSubmit,
}) {
  const [drafts, setDrafts] = useState({});

  // Reset whenever a different set of codes comes back — a second pass through
  // the gate must not keep the value that just turned out to be taken too.
  const conflictsKey = conflicts.join('␟');
  useEffect(() => {
    setDrafts({});
  }, [conflictsKey]);

  const trimmed = useMemo(
    () => conflicts.map((code) => String(drafts[code] ?? '').trim()),
    [conflicts, drafts]
  );

  // Every field filled, nothing left as-is, and no two fields the same — a
  // repeat here would only collide with itself on the FactWise side.
  const ready = useMemo(() => {
    if (!conflicts.length) return false;
    if (trimmed.some((value) => !value)) return false;
    if (trimmed.some((value, index) => value.toLowerCase() === conflicts[index].toLowerCase())) {
      return false;
    }
    const lowered = trimmed.map((value) => value.toLowerCase());
    return new Set(lowered).size === lowered.length;
  }, [conflicts, trimmed]);

  if (!conflicts.length) return null;

  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {conflicts.length === 1
          ? `BOM ID "${conflicts[0]}" already exists in Factwise.`
          : `${conflicts.length} BOM IDs in this sheet already exist in Factwise.`}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block', mt: 0.5, mb: 1.5, color: 'text.secondary' }}>
        A BOM ID has to be unique across the organisation, so this one cannot be
        reused. Enter a different ID and the export continues from here — the
        items already imported are kept.
      </Typography>

      <Stack spacing={1.5}>
        {conflicts.map((code) => (
          <TextField
            key={code}
            size="small"
            fullWidth
            label={`New BOM ID for "${code}"`}
            placeholder={`${code}-2`}
            value={drafts[code] ?? ''}
            disabled={disabled}
            onChange={(event) => setDrafts((prev) => ({ ...prev, [code]: event.target.value }))}
            error={Boolean(
              String(drafts[code] ?? '').trim()
              && String(drafts[code] ?? '').trim().toLowerCase() === code.toLowerCase()
            )}
            helperText={
              String(drafts[code] ?? '').trim().toLowerCase() === code.toLowerCase()
                ? 'That is the ID that is already taken — pick another.'
                : ' '
            }
          />
        ))}
        <Stack direction="row" justifyContent="flex-end">
          <Button
            variant="contained"
            size="small"
            disabled={disabled || !ready}
            onClick={() => {
              const renames = {};
              conflicts.forEach((code, index) => { renames[code] = trimmed[index]; });
              onSubmit?.(renames);
            }}
          >
            {conflicts.length === 1 ? 'Use this BOM ID' : 'Use these BOM IDs'}
          </Button>
        </Stack>
      </Stack>
    </Alert>
  );
}
