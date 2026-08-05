// BomStructureDialog.js
//
// Gate shown on the Upload page before a client workbook is sent anywhere.
// It answers four questions the BOM generator cannot answer on its own:
//
//   0. Which sheets contain a BOM?
//   1. Does each of those have levels?
//   2. If no  -> the sheet is a flat component list, so the finished good does
//                not exist in the data and the user has to author it.
//   3. If yes -> show an illustrative tree and confirm the sheet is shaped that
//                way, then confirm which column holds the level.
//   4. If the user says it is not that shape, the sheet is marked
//      BOM-generation-unavailable. Nothing is blocked; only BOM generation is
//      skipped for it.
//
// The tree drawn at step 2 is a fixed illustration, NOT the user's data. No API
// call, no derivation — this dialog is entirely self-contained.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Checkbox, FormControlLabel, FormControl, InputLabel, Select, MenuItem,
  TextField, RadioGroup, Radio, Alert, Divider, Chip, Stepper, Step, StepLabel,
} from '@mui/material';
import { AccountTree as AccountTreeIcon } from '@mui/icons-material';

// Headers that mean "this column holds the BOM level". Matched whole-string so
// that "Level of detail" or "Service level" do not produce a false positive.
const LEVEL_HEADER_RE = /^\s*(level|lvl|niveau|indent(ure)?|depth|bom\s*level)\s*$/i;

// There is deliberately no fallback measurement unit. `Measurement unit` is a
// required FactWise item column, and guessing it silently mislabels real data —
// SAFRAN alone uses UN, m (metres) and bob (reels). Anything still blank is
// caught by validation at item-sheet export, where the user supplies it.

// Fixed illustration for step 2. Deliberately generic — it explains what
// "hierarchical" means so the user can recognise their own sheet in it.
const EXAMPLE_TREE = [
  { text: 'Finished good', depth: 0, note: 'the top-level assembly' },
  { text: 'Sub-assembly A', depth: 1, note: 'has its own BOM' },
  { text: 'Raw material 1', depth: 2 },
  { text: 'Raw material 2', depth: 2 },
  { text: 'Sub-assembly B', depth: 1, note: 'has its own BOM' },
  { text: 'Raw material 3', depth: 2 },
  { text: 'Raw material 4', depth: 1, note: 'direct child of the finished good' },
];

const detectLevelColumn = (headers = []) =>
  headers.find(header => LEVEL_HEADER_RE.test(String(header || ''))) || '';

// Customer BOM sheets are usually named after the assembly they describe, with
// a "BOM"/revision suffix bolted on — GE's "9926006_BOM_r1" describes assembly
// 9926006. Stripping those suffixes gives a sensible prefill for the finished
// good code, which the user can still overwrite.
// Split on spaces and underscores only. Hyphens are left alone because they are
// part of real part numbers ("188256-201", "853-042958-640").
const NOISE_TOKEN_RE = /^(bom|boms|bill|of|materials?|list)$/i;
const REV_TOKEN_RE = /^(r|rev|revision)[\s._-]*\d*[a-z]?$/i;

const guessFinishedGoodCode = (sheetName = '') => {
  const raw = String(sheetName || '').trim();
  if (!raw) return '';
  const tokens = raw.split(/[\s_]+/).filter(Boolean);
  const kept = [];
  let previousWasRev = false;
  tokens.forEach((token) => {
    if (NOISE_TOKEN_RE.test(token)) { previousWasRev = false; return; }
    if (REV_TOKEN_RE.test(token)) { previousWasRev = true; return; }
    // "rev 3" arrives as two tokens; drop the orphaned number after "rev".
    if (previousWasRev && /^\d+[a-z]?$/i.test(token)) { previousWasRev = false; return; }
    previousWasRev = false;
    kept.push(token);
  });
  // Never return something emptier than useless — fall back to the raw name.
  return kept.join('_') || raw;
};

const blankSheetAnswer = () => ({
  hasBom: false,
  hasLevels: false,
  levelColumn: '',
  treeConfirmed: null,
  bomHeader: null,
});

const blankBomHeader = (sheetName = '') => {
  const guess = guessFinishedGoodCode(sheetName);
  return {
    finishedGoodCode: guess,
    itemName: '',
    bomName: '',
    measurementUnit: '',
    baseQuantity: 1,
  };
};

const ExampleTree = () => (
  <Box
    sx={{
      p: 2,
      borderRadius: 1,
      border: theme => `1px solid ${theme.palette.divider}`,
      bgcolor: 'action.hover',
      fontFamily: 'monospace',
      fontSize: 13,
      lineHeight: 1.9,
    }}
  >
    {EXAMPLE_TREE.map((node, index) => (
      <Box key={index} sx={{ display: 'flex', alignItems: 'baseline' }}>
        <Box component="span" sx={{ pl: `${node.depth * 22}px`, whiteSpace: 'pre' }}>
          {node.depth > 0 ? '└── ' : ''}
          <Box
            component="span"
            sx={{ fontWeight: node.depth === 0 ? 700 : 400 }}
          >
            {node.text}
          </Box>
        </Box>
        {node.note && (
          <Typography variant="caption" sx={{ ml: 1.5, color: 'text.secondary' }}>
            {node.note}
          </Typography>
        )}
      </Box>
    ))}
  </Box>
);

const BomStructureDialog = ({
  open,
  onClose,
  sheetNames = [],
  getSheetHeaders,
  onConfirm,
}) => {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState('');

  // Props are mirrored into refs so that seeding can depend on `open` alone.
  // Callers usually build `sheetNames` inline, so it changes identity on every
  // render — depending on it directly would re-seed mid-edit and discard the
  // user's answers.
  const sheetNamesRef = useRef(sheetNames);
  const getSheetHeadersRef = useRef(getSheetHeaders);
  useEffect(() => {
    sheetNamesRef.current = sheetNames;
    getSheetHeadersRef.current = getSheetHeaders;
  });

  // Seed once per opening: every sheet starts as a BOM candidate, and any sheet
  // whose headers already expose a level column is pre-answered "yes". That is
  // the PM's "doesn't mention levels" condition — when it is visible we confirm
  // rather than ask blind.
  useEffect(() => {
    if (!open) return;
    const seeded = {};
    (sheetNamesRef.current || []).forEach((sheetName) => {
      const reader = getSheetHeadersRef.current;
      const headers = typeof reader === 'function' ? reader(sheetName) : [];
      const detected = detectLevelColumn(headers);
      seeded[sheetName] = {
        ...blankSheetAnswer(),
        hasBom: true,
        hasLevels: Boolean(detected),
        levelColumn: detected,
        bomHeader: detected ? null : blankBomHeader(sheetName),
      };
    });
    setAnswers(seeded);
    setStep(0);
    setError('');
  }, [open]);

  const headersFor = useCallback(
    sheetName => (typeof getSheetHeaders === 'function' ? getSheetHeaders(sheetName) : []),
    [getSheetHeaders]
  );

  const bomSheets = useMemo(
    () => sheetNames.filter(name => answers[name]?.hasBom),
    [sheetNames, answers]
  );
  const leveledSheets = useMemo(
    () => bomSheets.filter(name => answers[name]?.hasLevels),
    [bomSheets, answers]
  );
  // Only sheets that are flat, or that the user said are not tree-shaped, need a
  // finished good authored. A confirmed tree already carries its root.
  const flatSheets = useMemo(
    () => bomSheets.filter(name => !answers[name]?.hasLevels || answers[name]?.treeConfirmed === false),
    [bomSheets, answers]
  );

  const patch = useCallback((sheetName, changes) => {
    setAnswers(prev => ({ ...prev, [sheetName]: { ...prev[sheetName], ...changes } }));
    setError('');
  }, []);

  const patchHeader = useCallback((sheetName, changes) => {
    setAnswers(prev => ({
      ...prev,
      [sheetName]: {
        ...prev[sheetName],
        bomHeader: { ...(prev[sheetName]?.bomHeader || blankBomHeader(sheetName)), ...changes },
      },
    }));
    setError('');
  }, []);

  // Steps 2 and 3 only exist when something needs them.
  const steps = useMemo(() => {
    const list = [
      { key: 'sheets', label: 'BOM sheets' },
      { key: 'levels', label: 'Levels' },
    ];
    if (leveledSheets.length) list.push({ key: 'tree', label: 'Structure' });
    if (flatSheets.length) list.push({ key: 'finishedGood', label: 'Finished good' });
    return list;
  }, [leveledSheets.length, flatSheets.length]);

  const currentKey = steps[Math.min(step, steps.length - 1)]?.key || 'sheets';

  const validateStep = useCallback(() => {
    if (currentKey === 'levels') {
      const missing = leveledSheets.filter(name => !answers[name]?.levelColumn);
      if (missing.length) {
        setError(`Choose the level column for: ${missing.join(', ')}`);
        return false;
      }
    }
    if (currentKey === 'tree') {
      const unanswered = leveledSheets.filter(name => answers[name]?.treeConfirmed === null);
      if (unanswered.length) {
        setError(`Confirm the structure for: ${unanswered.join(', ')}`);
        return false;
      }
    }
    if (currentKey === 'finishedGood') {
      for (const name of flatSheets) {
        const header = answers[name]?.bomHeader || {};
        if (!String(header.finishedGoodCode || '').trim()) {
          setError(`Enter a finished good code for "${name}".`);
          return false;
        }
        if (!String(header.measurementUnit || '').trim()) {
          setError(`Enter a measurement unit for "${name}".`);
          return false;
        }
      }
    }
    return true;
  }, [currentKey, leveledSheets, flatSheets, answers]);

  const handleNext = () => {
    if (!validateStep()) return;
    if (step < steps.length - 1) {
      setStep(step + 1);
      return;
    }

    // Final shape. Sheets that were never marked as BOMs are dropped, and any
    // finished-good field the user left at its prefill is materialised here so
    // downstream code never has to re-apply the defaulting chain.
    const payload = { sheets: {} };
    bomSheets.forEach((name) => {
      const answer = answers[name];
      const needsHeader = flatSheets.includes(name);
      let bomHeader = null;
      if (needsHeader) {
        const raw = answer.bomHeader || blankBomHeader(name);
        const code = String(raw.finishedGoodCode || '').trim();
        bomHeader = {
          finishedGoodCode: code,
          itemName: String(raw.itemName || '').trim() || code,
          bomName: String(raw.bomName || '').trim() || code,
          measurementUnit: String(raw.measurementUnit || '').trim(),
          baseQuantity: Number(raw.baseQuantity) > 0 ? Number(raw.baseQuantity) : 1,
        };
      }
      payload.sheets[name] = {
        hasBom: true,
        hasLevels: Boolean(answer.hasLevels),
        levelColumn: answer.hasLevels ? answer.levelColumn : null,
        treeConfirmed: answer.hasLevels ? answer.treeConfirmed : null,
        bomGenerationAvailable: answer.hasLevels ? answer.treeConfirmed !== false : true,
        bomHeader,
      };
    });
    onConfirm(payload);
  };

  const handleBack = () => {
    setError('');
    if (step === 0) {
      onClose();
      return;
    }
    setStep(step - 1);
  };

  const renderSheets = () => (
    <>
      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        Which of these sheets contain a BOM? Sheets left unchecked are still uploaded
        and mapped — they are just not used to build a BOM.
      </Typography>
      {sheetNames.length === 0 && (
        <Alert severity="info">No sheets were detected in this file.</Alert>
      )}
      {sheetNames.map((name) => (
        <Box key={name} sx={{ mb: 0.5 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={Boolean(answers[name]?.hasBom)}
                onChange={e => patch(name, { hasBom: e.target.checked })}
              />
            }
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <span>{name}</span>
                <Chip size="small" variant="outlined" label={`${headersFor(name).length} columns`} />
              </Box>
            }
          />
        </Box>
      ))}
    </>
  );

  const renderLevels = () => (
    <>
      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        Does each BOM have levels? A sheet with levels describes sub-assemblies;
        a sheet without them is a single flat list of components.
      </Typography>
      {bomSheets.length === 0 && (
        <Alert severity="info">
          No sheets were marked as BOMs, so there is nothing to configure.
        </Alert>
      )}
      {bomSheets.map((name) => {
        const answer = answers[name] || blankSheetAnswer();
        const headers = headersFor(name);
        const autoDetected = detectLevelColumn(headers);
        return (
          <Box key={name} sx={{ mb: 2.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{name}</Typography>
            <RadioGroup
              row
              value={answer.hasLevels ? 'yes' : 'no'}
              onChange={(e) => {
                const hasLevels = e.target.value === 'yes';
                patch(name, {
                  hasLevels,
                  levelColumn: hasLevels ? (answer.levelColumn || autoDetected) : '',
                  treeConfirmed: null,
                  bomHeader: hasLevels ? null : (answer.bomHeader || blankBomHeader(name)),
                });
              }}
            >
              <FormControlLabel value="yes" control={<Radio size="small" />} label="Has levels" />
              <FormControlLabel value="no" control={<Radio size="small" />} label="Single level" />
            </RadioGroup>
            {answer.hasLevels && (
              <FormControl size="small" sx={{ minWidth: 260, mt: 0.5 }}>
                <InputLabel>Level column</InputLabel>
                <Select
                  label="Level column"
                  value={headers.includes(answer.levelColumn) ? answer.levelColumn : ''}
                  onChange={e => patch(name, { levelColumn: e.target.value })}
                >
                  {headers.map(header => (
                    <MenuItem key={header} value={header}>{header}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {answer.hasLevels && autoDetected && answer.levelColumn === autoDetected && (
              <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
                Detected “{autoDetected}” automatically — change it if that is the wrong column.
              </Typography>
            )}
          </Box>
        );
      })}
    </>
  );

  const renderTree = () => (
    <>
      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        A BOM with levels is built as a tree: a finished good at the top, sub-assemblies
        beneath it, and raw materials at the leaves. This is an example, not your data.
      </Typography>
      <ExampleTree />
      <Divider sx={{ my: 2.5 }} />
      {leveledSheets.map((name) => (
        <Box key={name} sx={{ mb: 2 }}>
          <Typography variant="subtitle2">
            Is “{name}” structured like this?
          </Typography>
          <RadioGroup
            row
            value={answers[name]?.treeConfirmed === null ? '' : (answers[name]?.treeConfirmed ? 'yes' : 'no')}
            onChange={e => patch(name, { treeConfirmed: e.target.value === 'yes' })}
          >
            <FormControlLabel value="yes" control={<Radio size="small" />} label="Yes" />
            <FormControlLabel value="no" control={<Radio size="small" />} label="No" />
          </RadioGroup>
          {answers[name]?.treeConfirmed === false && (
            <Alert severity="warning" sx={{ mt: 0.5 }}>
              A BOM will not be generated for this sheet. It is still uploaded, mapped and
              exported to the item directory — only the BOM is skipped.
            </Alert>
          )}
        </Box>
      ))}
    </>
  );

  const renderFinishedGood = () => (
    <>
      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        A single-level sheet lists components but not the thing they build, so the finished
        good has to be named here. It becomes an item in the item directory as well.
      </Typography>
      {flatSheets.map((name) => {
        const header = answers[name]?.bomHeader || blankBomHeader(name);
        const code = String(header.finishedGoodCode || '').trim();
        return (
          <Box key={name} sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{name}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <TextField
                size="small"
                required
                label="Finished good code"
                value={header.finishedGoodCode}
                onChange={e => patchHeader(name, { finishedGoodCode: e.target.value })}
                sx={{ width: 240 }}
              />
              <TextField
                size="small"
                label="Item name"
                value={header.itemName}
                onChange={e => patchHeader(name, { itemName: e.target.value })}
                placeholder={code || 'same as code'}
                sx={{ width: 240 }}
              />
              <TextField
                size="small"
                label="BOM name"
                value={header.bomName}
                onChange={e => patchHeader(name, { bomName: e.target.value })}
                placeholder={code || 'same as code'}
                sx={{ width: 240 }}
              />
              <TextField
                size="small"
                required
                label="Measurement unit"
                value={header.measurementUnit}
                onChange={e => patchHeader(name, { measurementUnit: e.target.value })}
                sx={{ width: 180 }}
              />
              <TextField
                size="small"
                type="number"
                label="Base quantity"
                value={header.baseQuantity}
                onChange={e => patchHeader(name, { baseQuantity: e.target.value })}
                sx={{ width: 160 }}
              />
            </Box>
            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
              Item name and BOM name default to the finished good code.
            </Typography>
          </Box>
        );
      })}
    </>
  );

  const body = {
    sheets: renderSheets,
    levels: renderLevels,
    tree: renderTree,
    finishedGood: renderFinishedGood,
  }[currentKey];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AccountTreeIcon fontSize="small" />
        BOM structure
      </DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={Math.min(step, steps.length - 1)} sx={{ mb: 3 }}>
          {steps.map(s => (
            <Step key={s.key}><StepLabel>{s.label}</StepLabel></Step>
          ))}
        </Stepper>
        {body ? body() : null}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleBack}>{step === 0 ? 'Cancel' : 'Back'}</Button>
        <Button variant="contained" onClick={handleNext}>
          {step === steps.length - 1 ? 'Continue' : 'Next'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BomStructureDialog;
