import React, { useMemo, useState } from 'react';
import { Alert, Button, Chip, Stack, Typography } from '@mui/material';
import TranslateIcon from '@mui/icons-material/Translate';

// Unicode script ranges we can flag confidently. Each entry is
// [name, regex]. Regexes cover the most common blocks per script; extended
// blocks (e.g., CJK Extension B) are omitted because they hit almost never
// and inflate the regex cost across every cell of a large grid.
//
// Latin with diacritics (French/German/Spanish accents) is intentionally NOT
// flagged — those are usually English part descriptions that just happen to
// carry the odd accented character, and warning on them creates noise.
const SCRIPT_PATTERNS = [
  ['Chinese / Japanese / Korean', /[぀-ヿ㐀-䶿一-鿿가-힯]/],
  ['Cyrillic', /[Ѐ-ӿ]/],
  ['Arabic', /[؀-ۿݐ-ݿ]/],
  ['Hebrew', /[֐-׿]/],
  ['Greek', /[Ͱ-Ͽ]/],
  ['Devanagari (Hindi/Marathi)', /[ऀ-ॿ]/],
  ['Thai', /[฀-๿]/],
];

// Cap how many rows we scan on any single render — a 50k-row grid should not
// pay the CPU cost of checking every cell every render. The banner is a
// hint; a sample that's this large will find any real occurrence.
const MAX_ROWS_SCANNED = 2000;
const MAX_SAMPLES_PER_SCRIPT = 3;

/**
 * Banner that warns when the grid contains non-Latin script characters.
 *
 * Non-Latin script often means the source sheet is in a language other than
 * English — FactWise's importers validate English column names and can misread
 * some fields (units, boolean cells) that were translated. Surfacing this
 * lets the user decide whether to translate before exporting.
 *
 * Props:
 *   headers: string[]   — grid columns (scanned for translated headers)
 *   rows:    string[][] — grid data (scanned for non-Latin cells)
 */
const NonEnglishLanguageBanner = ({ headers, rows }) => {
  const [dismissed, setDismissed] = useState(false);

  const findings = useMemo(() => {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    // Only scan free-text columns — Item code / Level / booleans are noisy
    // and rarely translated. Use header names to guess.
    const scanColumn = (name) => {
      const n = String(name || '').toLowerCase();
      return /name|description|notes|manufacturer|category|remark|comment|title|spec/.test(n)
        && !/measurement|uom/.test(n);
    };
    const scanCols = (headers || [])
      .map((h, i) => (scanColumn(h) ? i : -1))
      .filter((i) => i >= 0);
    // If nothing looks like free-text, scan every column but only a small
    // sample — better than reporting "no issue" on a Chinese-language sheet
    // whose headers are also translated.
    const columns = scanCols.length ? scanCols : (headers || []).map((_, i) => i);

    const perScript = {}; // { name: { count, samples: Set } }
    const rowsToScan = Math.min(rows.length, MAX_ROWS_SCANNED);
    for (let r = 0; r < rowsToScan; r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;
      for (const c of columns) {
        const value = row[c];
        if (!value) continue;
        const text = String(value);
        for (const [name, pattern] of SCRIPT_PATTERNS) {
          if (pattern.test(text)) {
            if (!perScript[name]) perScript[name] = { count: 0, samples: new Set() };
            perScript[name].count += 1;
            if (perScript[name].samples.size < MAX_SAMPLES_PER_SCRIPT) {
              // Trim to a manageable snippet for the tooltip.
              perScript[name].samples.add(text.length > 60 ? `${text.slice(0, 57)}…` : text);
            }
          }
        }
      }
    }
    const scripts = Object.entries(perScript)
      .map(([name, info]) => ({ name, count: info.count, samples: [...info.samples] }))
      .sort((a, b) => b.count - a.count);
    if (!scripts.length) return null;
    return {
      scripts,
      rowsScanned: rowsToScan,
      truncated: rows.length > MAX_ROWS_SCANNED,
    };
  }, [headers, rows]);

  if (!findings || dismissed) return null;

  const totalHits = findings.scripts.reduce((sum, s) => sum + s.count, 0);
  const scriptList = findings.scripts.map((s) => `${s.name} (${s.count})`).join(', ');
  const sampleTooltip = findings.scripts
    .map((s) => `${s.name}:\n  ${s.samples.join('\n  ')}`)
    .join('\n\n');

  return (
    <Alert
      severity="warning"
      icon={<TranslateIcon fontSize="small" />}
      variant="outlined"
      sx={{ mb: 1.5, py: 0.5, '.MuiAlert-message': { py: 0.5, flex: 1 } }}
      action={
        <Button size="small" variant="text" onClick={() => setDismissed(true)}>Dismiss</Button>
      }
    >
      <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Non-English text detected in {totalHits} cell{totalHits === 1 ? '' : 's'}
        </Typography>
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', cursor: 'help' }}
          title={sampleTooltip}
        >
          ({scriptList}
          {findings.truncated ? `, scanned first ${findings.rowsScanned} rows` : ''})
        </Typography>
        <Chip
          size="small"
          label="FactWise validates in English — translate before export if needed"
          color="warning"
          variant="outlined"
        />
      </Stack>
    </Alert>
  );
};

export default NonEnglishLanguageBanner;
