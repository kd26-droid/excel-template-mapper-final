// BomStructureDialog.js
//
// Gate shown on the Upload page before a client workbook is sent anywhere.
//
// It opens on one question — is this a NEW BOM or a REVISION of one that already
// exists in FactWise? — because the answer decides which of two entirely
// different sets of questions follow. A new BOM has to be described from the
// workbook (which sheets, what shape, what finished good). A revision already
// has all of that: it inherits it from the BOM being revised, so the only things
// left to establish are which BOM, and whether the revision lands on a project.
//
// The new-BOM branch answers the questions the BOM generator cannot answer on
// its own:
//
//   0. Which sheets contain a BOM, and does each of those have levels? These are
//      one step because they are one decision per sheet — ticking a sheet
//      reveals its single/multi choice directly underneath, so the user never
//      has to hold a list of sheet names in their head across two screens.
//      A sheet without levels is a flat component list, so the finished good
//      does not exist in the data and the user has to author it (step 2).
//   1. If it has levels -> show an illustrative tree and confirm the sheet is
//      shaped that way.
//   2. Author the level-0 finished good for every BOM sheet. Levelled sheets
//      need this too: they normally start at level 1 and name their assembly in
//      a preamble above the table, which is prefilled here when detected.
//
// If the user says a levelled sheet is not tree-shaped, it is marked
// BOM-generation-unavailable. Nothing is blocked; only BOM generation is
// skipped for it.
//
// The tree drawn at the Structure step is a fixed illustration, NOT the user's
// data. The new-BOM branch derives everything else from the parsed workbook, so
// it needs no network at all; only the revision branch calls out, and only for
// the two lists it cannot know locally (existing BOMs, projects).

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Checkbox, FormControlLabel, FormControl, InputLabel, Select, MenuItem,
  TextField, RadioGroup, Radio, Alert, Divider, Chip, Stepper, Step, StepLabel,
  Autocomplete, CircularProgress,
} from '@mui/material';
import { AccountTree as AccountTreeIcon } from '@mui/icons-material';
import {
  fetchEnterpriseBomCodes, collapseBomRevisions, fetchProjectsWithBom, fetchProjectBomSlots,
} from '../services/factwiseApi';
import {
  readBomRevisionIntent, saveBomRevisionIntent, clearBomRevisionIntent,
} from '../utils/bomRevisionIntent';

// Headers that mean "this column holds the BOM level". Matched whole-string so
// that "Level of detail" or "Service level" do not produce a false positive.
const LEVEL_HEADER_RE = /^\s*(level|lvl|niveau|indent(ure)?|depth|bom\s*level)\s*$/i;

// Measurement unit and base quantity are prefilled (EA, 1) rather than left
// blank, but only in editable fields the user is looking at. That is not the
// same as guessing at export time: SAFRAN measures in UN, metres and reels, and
// the point of showing the prefill is that a sheet like that gets corrected here
// instead of silently mislabelled downstream. Clearing a prefill still blocks.

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

// Whether a level column actually describes a hierarchy, judged on its VALUES.
//
// The presence of the column says nothing on its own. The BOM Normalizer's
// output always carries a `level` column, filling it with 1 for a flat sheet, so
// going by the header alone would call every normalized sheet multi-level. And a
// sheet whose levels really do run 1, 2, 3 is multi-level however its column is
// named — which is what a customer export with no "Level" header but derived
// levels looks like.
//
// More than one distinct level is the only thing that makes a tree.
const hasRealLevels = (records, levelColumn) => {
  if (!levelColumn || !Array.isArray(records) || !records.length) return false;
  const seen = new Set();
  for (const record of records) {
    const level = parseLevelValue(record?.[levelColumn]);
    if (level === null) continue;
    seen.add(level);
    if (seen.size > 1) return true;
  }
  return false;
};

// Mirrors bom_tree.parse_level / parse_quantity / is_document_row on the backend.
// The dialog derives structure locally so it can show it before anything is
// uploaded; the backend re-derives it authoritatively at generation time.
const DASH_RE = /^[-‐-―]+$/;
const QTY_HEADER_RE = /^\s*(qty|quantity|qnty|amount)\s*$/i;
const UOM_HEADER_RE = /^\s*(uom|u\.?o\.?m\.?|unit(\s*of\s*measure(ment)?)?|measurement\s*unit)\s*$/i;
const CODE_HEADER_RE = /^\s*(part\s*(number|no\.?|#)?|item\s*(code|number|no\.?)|cpn|component)\s*$/i;
const NAME_HEADER_RE = /^\s*(description|nomenclature|item\s*name|name|title)\s*$/i;

const parseLevelValue = (value) => {
  const text = String(value ?? '').replace(/^\s*=\s*CONCATENATE\s*\(\s*"(.*)"\s*\)\s*$/i, '$1').trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0) return null;
  return number;
};

// A row that consumes nothing is not a BOM line — see is_document_row.
const consumesQuantity = (value) => {
  const text = String(value ?? '').trim();
  if (!text || DASH_RE.test(text)) return false;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) && number > 0;
};

const findHeader = (headers, pattern) =>
  (headers || []).find(header => pattern.test(String(header || ''))) || '';

// Scan the rows above the table for the block that names the assembly. THALES
// exports put "Part Number / Description" on one row and the values on the next,
// which is the only place the level-0 finished good appears at all.
// The root as stated by the DATA: the single shallowest row in the table.
//
// Some exports contain their own finished good - Honeywell puts it on the first
// row at the shallowest outline level, marked "Make Finished Good". Asking the
// user to name one anyway is how a BOM ends up with an invented parent above the
// real product, named after the spreadsheet tab.
//
// Quantity is deliberately ignored here. A finished good is not consumed by
// anything, so its quantity cell is routinely blank - the very thing that would
// disqualify it if this reused the document filter.
//
// Returns null unless exactly ONE row sits at the shallowest level. Several tops
// is a forest, and which of them is "the" finished good is the user's call.
const detectRootFromRecords = (records = [], levelColumn = '', headers = []) => {
  const codeColumn = findHeader(headers, CODE_HEADER_RE);
  if (!levelColumn || !codeColumn) return null;
  const nameColumn = findHeader(headers, NAME_HEADER_RE);
  const uomColumn = findHeader(headers, UOM_HEADER_RE);

  const rows = [];
  (records || []).forEach((record) => {
    const level = parseLevelValue(record[levelColumn]);
    if (level === null) return;
    const code = String(record[codeColumn] ?? '').trim();
    if (!code) return;
    rows.push({
      level,
      code,
      name: String(record[nameColumn] ?? '').trim(),
      uom: String(record[uomColumn] ?? '').trim(),
    });
  });
  if (!rows.length) return null;

  const minLevel = Math.min(...rows.map(row => row.level));
  const tops = rows.filter(row => row.level === minLevel);
  if (tops.length !== 1) return null;
  // A lone row that is also the ONLY row is a one-line sheet, not a hierarchy.
  if (rows.length === 1) return null;
  return tops[0];
};

const detectRootFromPreamble = (preambleRows = []) => {
  for (let index = 0; index < preambleRows.length - 1; index += 1) {
    const labels = (preambleRows[index] || []).map(cell => String(cell ?? '').trim());
    const codeAt = labels.findIndex(label => CODE_HEADER_RE.test(label));
    const nameAt = labels.findIndex(label => NAME_HEADER_RE.test(label));
    if (codeAt < 0) continue;
    const values = preambleRows[index + 1] || [];
    const code = String(values[codeAt] ?? '').trim();
    if (!code) continue;
    return { code, name: nameAt >= 0 ? String(values[nameAt] ?? '').trim() : '' };
  }
  return null;
};

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

// Defaults every BOM starts from. They are prefills, not silent fallbacks —
// each one is on screen in an editable field, so a sheet that measures in UN,
// metres or reels is corrected by the user rather than mislabelled behind their
// back. That is the difference from guessing at export time.
const DEFAULT_BASE_QUANTITY = 1;
const DEFAULT_MEASUREMENT_UNIT = 'EA';

// Enough of a uuid to tell two otherwise identical rows apart, short enough to
// sit in a caption without becoming the thing the eye lands on.
const shortId = value => (value ? String(value).slice(0, 8) : '');

// The opening branch. 'create' is the default because it is what an upload of a
// brand new customer workbook is; revising is the deliberate choice.
const MODE_CREATE = 'create';
const MODE_REVISE = 'revise';

// A base quantity has to be a number the user meant. Blank counts as valid only
// because the prefill fills it - what this rejects is a value that was typed and
// does not parse, which the confirm step would otherwise rewrite to 1 in silence.
const isPositiveQuantity = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return false;
  const number = Number(text);
  return Number.isFinite(number) && number > 0;
};

const blankSheetAnswer = () => ({
  hasBom: false,
  hasLevels: false,
  levelColumn: '',
  treeConfirmed: null,
  // Whether rows that consume nothing are dropped as documents. Defaults on
  // because a row consuming nothing is usually a drawing, but the user can turn
  // it off for exports that write 0 on real parts.
  dropDocuments: true,
  bomHeader: null,
  // Per sub-assembly overrides, keyed by part code. A multi-level sheet produces
  // one BOM per assembly, and each of those BOMs needs its own name, base
  // quantity and unit — the sheet only supplies the code.
  subBoms: {},
});

const blankBomHeader = (sheetName = '') => {
  const guess = guessFinishedGoodCode(sheetName);
  return {
    finishedGoodCode: guess,
    itemName: '',
    bomName: '',
    measurementUnit: DEFAULT_MEASUREMENT_UNIT,
    baseQuantity: DEFAULT_BASE_QUANTITY,
  };
};

const blankSubBom = (assembly = {}) => ({
  bomName: assembly.name || assembly.code || '',
  measurementUnit: assembly.uom || DEFAULT_MEASUREMENT_UNIT,
  baseQuantity: DEFAULT_BASE_QUANTITY,
});

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

// What the level column says about a sheet: which codes are assemblies at each
// level, and how many rows are documents. Used only to label the finished-good
// step so the user can see which BOM they are naming.
const analyzeLevels = (records, levelColumn, headers) => {
  const codeColumn = findHeader(headers, CODE_HEADER_RE);
  const nameColumn = findHeader(headers, NAME_HEADER_RE);
  const qtyColumn = findHeader(headers, QTY_HEADER_RE);
  const uomColumn = findHeader(headers, UOM_HEADER_RE);

  const rows = [];
  let documents = 0;
  (records || []).forEach((record) => {
    const level = parseLevelValue(record[levelColumn]);
    if (level === null) return;
    // Rows that consume nothing are skipped here even though the backend's
    // is_document_row now keeps the ones carrying a part number. The two are
    // deliberately NOT aligned: this list exists to name the BOMs, and a row
    // with no children is not a BOM whatever its quantity says. Including the
    // finished good here would also make it the shallowest row, shifting every
    // "Level N BOM" label down by one.
    if (qtyColumn && !consumesQuantity(record[qtyColumn])) { documents += 1; return; }
    const code = String(record[codeColumn] ?? '').trim();
    if (!code) return;
    rows.push({
      level,
      code,
      name: String(record[nameColumn] ?? '').trim(),
      uom: String(record[uomColumn] ?? '').trim(),
    });
  });

  // An assembly is a row the next row sits deeper than.
  const byLevel = new Map();
  rows.forEach((row, index) => {
    const next = rows[index + 1];
    if (!next || next.level <= row.level) return;
    if (!byLevel.has(row.level)) byLevel.set(row.level, new Map());
    if (!byLevel.get(row.level).has(row.code)) {
      byLevel.get(row.level).set(row.code, { code: row.code, name: row.name, uom: row.uom });
    }
  });

  const minLevel = rows.length ? Math.min(...rows.map(row => row.level)) : 0;
  const levels = [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, assemblies]) => ({
      // The authored root sits above the shallowest sheet row, so a sheet that
      // starts at level 1 has its own level 1 displayed as BOM level 1.
      label: level - minLevel + 1,
      assemblies: [...assemblies.values()],
    }));
  return { levels, documents, rowCount: rows.length };
};

// Decide whether answers saved on a mapping template still describe the file in
// front of us.
//
// A template's answers split in two. The *format* — which sheets hold a BOM,
// whether they have levels, which column holds the level — is a property of the
// customer's export and is stable across their files. The *identity* — the
// finished good code, the sub-BOM part numbers — describes one specific
// assembly, and next month's BOM from the same customer is a different assembly.
//
// Replaying the format silently is right. Replaying the identity silently would
// stamp last month's finished good onto this month's BOM with nothing to catch
// it, so it is only reused when it still matches the sheet.
//
// Returns { answers, complete }. `complete` false means the gate must be shown,
// seeded with whatever survived.
export const reconcileSavedBomStructure = (saved, { sheetNames = [], getSheetHeaders, getSheetRecords } = {}) => {
  const savedSheets = (saved || {}).sheets || {};
  if (!Object.keys(savedSheets).length) return { answers: null, complete: false };

  const answers = {};
  let complete = true;

  sheetNames.forEach((name) => {
    const savedAnswer = savedSheets[name];
    const headers = typeof getSheetHeaders === 'function' ? getSheetHeaders(name) : [];

    const detected = detectLevelColumn(headers);
    // Judged on the level VALUES, exactly as the fresh-seed path does. Going by
    // the column's existence alone disagrees with that path, and the two must
    // reach the same verdict about the same sheet.
    let levelled = Boolean(detected);
    if (detected && typeof getSheetRecords === 'function') {
      try {
        levelled = hasRealLevels(getSheetRecords(name), detected);
      } catch (err) {
        levelled = Boolean(detected);
      }
    }

    // A sheet the template has never seen has to be asked about.
    if (!savedAnswer) {
      answers[name] = {
        ...blankSheetAnswer(),
        hasBom: true,
        hasLevels: levelled,
        levelColumn: detected,
        bomHeader: blankBomHeader(name),
      };
      complete = false;
      return;
    }

    const next = {
      ...blankSheetAnswer(),
      hasBom: Boolean(savedAnswer.hasBom),
      hasLevels: Boolean(savedAnswer.hasLevels),
      levelColumn: savedAnswer.levelColumn || '',
      treeConfirmed: savedAnswer.treeConfirmed ?? null,
      bomHeader: savedAnswer.bomHeader || blankBomHeader(name),
      subBoms: savedAnswer.subBoms || {},
    };

    // The level column is part of the format, but a renamed column makes the
    // saved answer unusable rather than merely stale.
    if (next.hasLevels && next.levelColumn && !headers.includes(next.levelColumn)) {
      next.levelColumn = detected;
      // Even when another column looks right, the saved answer no longer
      // describes this file — confirm rather than substitute silently.
      complete = false;
    }

    // The saved single/multi answer contradicting the sheet in front of us.
    //
    // This is not a stale identity, it is a stale FORMAT answer, and replaying it
    // silently is how a four-level BOM gets exported as one flat list: the
    // template was saved when the level column was not being detected, and every
    // reuse faithfully repeats that "no levels" answer no matter what the file
    // says. The data wins, and the gate opens so the correction is seen.
    if (next.hasBom && levelled !== next.hasLevels) {
      next.hasLevels = levelled;
      next.levelColumn = levelled ? (next.levelColumn || detected) : '';
      // Pre-answered Yes for the same reason as the fresh seed. `complete` is
      // false regardless, so the gate still opens and the user sees the change.
      next.treeConfirmed = levelled ? true : null;
      complete = false;
    }

    // Identity check: does this sheet still contain the assemblies the template
    // was saved from? If none of them are here, it is a different BOM.
    if (next.hasLevels && next.levelColumn && typeof getSheetRecords === 'function') {
      const savedCodes = Object.keys(next.subBoms || {});
      if (savedCodes.length) {
        let present = [];
        try {
          present = analyzeLevels(getSheetRecords(name), next.levelColumn, headers)
            .levels.flatMap(level => level.assemblies.map(assembly => assembly.code));
        } catch (err) {
          present = [];
        }
        if (present.length && !savedCodes.some(code => present.includes(code))) {
          // Same format, different assembly. Keep the format, drop the identity.
          next.bomHeader = blankBomHeader(name);
          next.subBoms = {};
          next.treeConfirmed = null;
          complete = false;
        }
      }
    }

    if (!String(next.bomHeader?.finishedGoodCode || '').trim()) complete = false;

    answers[name] = next;
  });

  return { answers, complete };
};

const BomStructureDialog = ({
  open,
  onClose,
  sheetNames = [],
  getSheetHeaders,
  getSheetRecords,
  getSheetPreambleRows,
  initialAnswers = null,
  onConfirm,
  // The lists the revision branch needs, each narrowing the one before it:
  // every BOM → the projects holding that BOM → the slots it occupies in one
  // project. Injected rather than hardcoded so swapping an endpoint is a prop
  // at the call site instead of a rewrite in here.
  loadReviseBoms = fetchEnterpriseBomCodes,
  loadProjects = fetchProjectsWithBom,
  loadProjectSlots = fetchProjectBomSlots,
}) => {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState('');

  const [mode, setMode] = useState(MODE_CREATE);

  // Revision branch. Held apart from `answers`, which describes sheets — none of
  // this is per-sheet, and mixing them would put a project id inside a structure
  // answer that gets saved onto a mapping template.
  const [reviseBom, setReviseBom] = useState(null);
  const [bomOptions, setBomOptions] = useState([]);
  const [bomsLoading, setBomsLoading] = useState(false);
  const [bomsError, setBomsError] = useState('');
  // null until answered, so "did you skip this?" is distinguishable from "no".
  const [reviseOnProject, setReviseOnProject] = useState(null);
  const [reviseProject, setReviseProject] = useState(null);
  const [projectOptions, setProjectOptions] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState('');
  // Which of the project's slots this revision moves. Multi: the same BOM can
  // occupy several slots at once, each at its own revision, and moving only one
  // leaves the others behind on the old version.
  const [reviseSlots, setReviseSlots] = useState([]);
  const [slotOptions, setSlotOptions] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  // The base BOM behind the chosen revision. Everything downstream is looked up
  // by this, never by enterprise_bom_id — see the note in factwiseApi.
  const [baseBomId, setBaseBomId] = useState(null);
  const [baseBomError, setBaseBomError] = useState('');
  // Set when the BOM/project below were carried over from the export dialog
  // rather than chosen here, so the helper text can say so.
  const [prefilled, setPrefilled] = useState(false);
  // The BOM id the project below was chosen for. See the effect that reads it.
  const lastBomIdRef = useRef(null);

  // Props are mirrored into refs so that seeding can depend on `open` alone.
  // Callers usually build `sheetNames` inline, so it changes identity on every
  // render — depending on it directly would re-seed mid-edit and discard the
  // user's answers.
  const sheetNamesRef = useRef(sheetNames);
  const getSheetHeadersRef = useRef(getSheetHeaders);
  const getSheetRecordsRef = useRef(getSheetRecords);
  const getSheetPreambleRowsRef = useRef(getSheetPreambleRows);
  const initialAnswersRef = useRef(initialAnswers);
  useEffect(() => {
    sheetNamesRef.current = sheetNames;
    getSheetHeadersRef.current = getSheetHeaders;
    getSheetRecordsRef.current = getSheetRecords;
    getSheetPreambleRowsRef.current = getSheetPreambleRows;
    initialAnswersRef.current = initialAnswers;
  });

  // Seed once per opening: every sheet starts as a BOM candidate, and any sheet
  // whose headers already expose a level column is pre-answered "yes". That is
  // the PM's "doesn't mention levels" condition — when it is visible we confirm
  // rather than ask blind.
  useEffect(() => {
    if (!open) return;
    // The revision branch is never carried over. A saved mapping template
    // describes a customer's export FORMAT; which BOM a particular upload
    // revises is the most identity-bound answer in the dialog, and replaying it
    // would silently revise last month's BOM with this month's file.
    //
    // The BOM and project themselves ARE carried, from whatever the export
    // dialog was last pointed at in this tab. Those are a prefill sitting in a
    // visible dropdown; the branch is a question about this upload, so `mode`
    // stays on create and the user still has to choose Revise to reach them.
    const intent = readBomRevisionIntent();
    setMode(MODE_CREATE);
    setPrefilled(Boolean(intent));
    // Primed so the carried project is not immediately cleared as "the BOM
    // changed" by the effect that watches for exactly that.
    lastBomIdRef.current = intent?.enterpriseBomId ?? null;
    setReviseBom(
      intent?.enterpriseBomId
        ? {
          enterprise_bom_id: intent.enterpriseBomId,
          bom_code: intent.bomCode,
          // Carried so the base-BOM effect can skip its lookup entirely.
          base_bom_id: intent.baseBomId || undefined,
        }
        : null
    );
    // A carried project implies the previous answer to "on a project?" was yes.
    // With no project carried the question is left unanswered rather than
    // pre-answered No — validation catches a skip, and a wrong No would not be.
    setReviseOnProject(intent?.projectId ? true : null);
    setReviseProject(
      intent?.projectId
        ? {
          project_id: intent.projectId,
          project_code: intent.projectCode,
          project_name: intent.projectName,
        }
        : null
    );
    // Never carried. Which slots get moved is specific to one project's current
    // contents, and those change between uploads far more readily than the
    // project or the BOM do.
    setReviseSlots([]);
    setSlotOptions([]);
    setBaseBomId(null);
    setBomsError('');
    setProjectsError('');
    setSlotsError('');
    setBaseBomError('');
    // Answers carried over from a mapping template are already reconciled
    // against this file, so they are used as-is; the gate is only open because
    // something in them did not survive that check.
    const carried = initialAnswersRef.current;
    if (carried && Object.keys(carried).length) {
      setAnswers(carried);
      setStep(0);
      setError('');
      return;
    }

    const seeded = {};
    (sheetNamesRef.current || []).forEach((sheetName) => {
      const reader = getSheetHeadersRef.current;
      const headers = typeof reader === 'function' ? reader(sheetName) : [];
      const detected = detectLevelColumn(headers);

      // Judge on the level VALUES, not on the column existing. A sheet whose
      // levels are all 1 is flat no matter what the column is called, and a
      // sheet running 1/2/3 is a tree even when the column was derived rather
      // than supplied by the customer. Falls back to "the column exists" only
      // when the rows cannot be read.
      const recordReader = getSheetRecordsRef.current;
      let records = null;
      let levelled = Boolean(detected);
      if (detected && typeof recordReader === 'function') {
        try {
          records = recordReader(sheetName);
          levelled = hasRealLevels(records, detected);
        } catch (err) {
          records = null;
          levelled = Boolean(detected);
        }
      }

      const bomHeader = blankBomHeader(sheetName);
      if (detected) {
        // Preamble first. A block above the table that names the assembly is the
        // sheet SAYING what the finished good is; the shallowest row is only an
        // inference from shape. On a THALES export both exist and they disagree
        // - the preamble names 253653-01 while the shallowest row is
        // 253653-01900, which is that assembly's child. Preferring the inference
        // demoted the real finished good and put its own child above it.
        const preambleReader = getSheetPreambleRowsRef.current;
        const preamble = typeof preambleReader === 'function' ? preambleReader(sheetName) : [];
        const root = detectRootFromPreamble(preamble)
          || detectRootFromRecords(records || [], detected, headers);
        // Nothing detected means nothing prefilled — a wrong guess the user
        // does not notice is worse than an empty required field. Note this
        // clears blankBomHeader's sheet-name guess, which is exactly the guess
        // that shipped BOMs with a finished good called "Sheet1".
        bomHeader.finishedGoodCode = root ? root.code : '';
        bomHeader.itemName = root && root.name ? root.name : '';
        if (root && root.uom) bomHeader.measurementUnit = root.uom;
        bomHeader.autoDetected = Boolean(root);
      }

      seeded[sheetName] = {
        ...blankSheetAnswer(),
        hasBom: true,
        hasLevels: levelled,
        levelColumn: detected,
        // Pre-answered Yes rather than left blank. A sheet that reached this
        // step already has levels running 1/2/3, which IS the shape the
        // illustration describes, so Yes is the answer in nearly every case and
        // making the user re-assert it each time is friction. "No" stays as the
        // escape hatch for a sheet that is levelled but not actually a tree.
        treeConfirmed: levelled ? true : null,
        bomHeader,
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

  // Derived on demand rather than at seed time: the level column can change
  // while the user is on the first step, and re-reading a parsed workbook is
  // cheap compared with keeping a second copy of it in state.
  const structureFor = useCallback((sheetName) => {
    const levelColumn = answers[sheetName]?.levelColumn;
    if (!levelColumn || typeof getSheetRecords !== 'function') return null;
    try {
      return analyzeLevels(getSheetRecords(sheetName), levelColumn, headersFor(sheetName));
    } catch (err) {
      // The structure preview is a convenience; failing to draw it must never
      // stop the user from naming the finished good.
      return null;
    }
  }, [answers, getSheetRecords, headersFor]);

  const bomSheets = useMemo(
    () => sheetNames.filter(name => answers[name]?.hasBom),
    [sheetNames, answers]
  );
  const leveledSheets = useMemo(
    () => bomSheets.filter(name => answers[name]?.hasLevels),
    [bomSheets, answers]
  );
  // Every BOM sheet needs a level-0 finished good. A flat sheet lists components
  // but not the thing they build; a levelled sheet starts at level 1 and names
  // its assembly in a preamble that is not part of the table. THALES is the case
  // that disproved the older assumption that a confirmed tree carries its root.
  // Sheets the user said are not tree-shaped are excluded — no BOM is built.
  const sheetsNeedingRoot = useMemo(
    () => bomSheets.filter(name => answers[name]?.treeConfirmed !== false),
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

  // Sub-BOM fields are read with their default rather than seeded into state, so
  // that changing the level column mid-flow cannot leave stale entries behind
  // for assemblies that no longer exist. Only what the user actually edits is
  // stored; everything else is materialised at confirm time.
  const subBomValue = useCallback((sheetName, assembly, field) => {
    const stored = answers[sheetName]?.subBoms?.[assembly.code];
    if (stored && stored[field] !== undefined && stored[field] !== null) return stored[field];
    return blankSubBom(assembly)[field];
  }, [answers]);

  const patchSubBom = useCallback((sheetName, code, changes) => {
    setAnswers((prev) => {
      const answer = prev[sheetName] || blankSheetAnswer();
      const subBoms = { ...(answer.subBoms || {}) };
      subBoms[code] = { ...(subBoms[code] || {}), ...changes };
      return { ...prev, [sheetName]: { ...answer, subBoms } };
    });
    setError('');
  }, []);

  // Existing BOMs, fetched the first time the revision branch is chosen. The
  // list is whole rather than searched server-side, so one call covers the step
  // and Autocomplete filters it locally.
  useEffect(() => {
    if (!open || mode !== MODE_REVISE) return;
    if (bomOptions.length || bomsLoading) return;
    let cancelled = false;
    setBomsLoading(true);
    setBomsError('');
    Promise.resolve(loadReviseBoms())
      .then((res) => {
        if (cancelled) return;
        // The endpoint returns one row per REVISION. Collapsed to one entry per
        // BOM, each showing its current revision — a picker listing BOM_A,
        // BOM_A_R2 and BOM_A_R3 as three separate BOMs makes the user choose
        // between three names for the same thing (1388 rows → 1138 BOMs).
        if (res?.success) setBomOptions(collapseBomRevisions(res.boms || []));
        else setBomsError(res?.error || 'Could not load the list of BOMs.');
      })
      .catch(err => !cancelled && setBomsError(err?.message || 'Could not load the list of BOMs.'))
      .finally(() => !cancelled && setBomsLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  // The base BOM comes straight off the picked row — /bom/admin/codes/
  // serialises it. It used to be resolved with a follow-up call to the full BOM
  // detail endpoint, pulling every item of a gzipped payload to read one field.
  useEffect(() => {
    if (!open || mode !== MODE_REVISE) return;
    setBaseBomId(reviseBom?.base_bom_id || null);
    setBaseBomError(
      reviseBom && !reviseBom.base_bom_id
        ? 'This BOM has no base BOM id, so its projects cannot be looked up.'
        : ''
    );
  }, [open, mode, reviseBom]);

  // Projects that already carry that BOM — not the org-wide project search. A
  // revision can only land somewhere the BOM is, so the list is short enough to
  // fetch whole and filter in the browser.
  const projectFetchRef = useRef(0);
  useEffect(() => {
    if (!open || mode !== MODE_REVISE || reviseOnProject !== true) return;
    if (!baseBomId) {
      setProjectOptions([]);
      return;
    }
    const callId = ++projectFetchRef.current;
    setProjectsLoading(true);
    setProjectsError('');
    Promise.resolve(loadProjects({ baseBomId }))
      .then((res) => {
        // Out-of-order responses would otherwise overwrite a newer fetch.
        if (callId !== projectFetchRef.current) return;
        if (res?.success) setProjectOptions(res.projects || []);
        else {
          setProjectOptions([]);
          setProjectsError(res?.error || 'Could not load the projects holding this BOM.');
        }
        setProjectsLoading(false);
      })
      .catch((err) => {
        if (callId !== projectFetchRef.current) return;
        setProjectOptions([]);
        setProjectsError(err?.message || 'Could not load the projects holding this BOM.');
        setProjectsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, reviseOnProject, baseBomId]);

  // Changing the BOM invalidates the project beneath it — the new BOM may not
  // be on it at all. Cleared here rather than left for the fetch to contradict,
  // so a stale project cannot be carried past validation into the payload.
  //
  // Compared against a remembered id rather than keyed on `reviseBom` alone,
  // because a carried-over BOM and its carried-over project arrive together at
  // open; treating that as a change would wipe the project a line after
  // prefilling it. The seed effect primes the ref for exactly that reason.
  useEffect(() => {
    const bomId = reviseBom?.enterprise_bom_id ?? null;
    if (lastBomIdRef.current === bomId) return;
    lastBomIdRef.current = bomId;
    setReviseProject(null);
    setReviseSlots([]);
    setSlotOptions([]);
  }, [reviseBom]);

  // The slots that BOM occupies in the chosen project. Only exists once both a
  // BOM and a project are settled.
  const slotFetchRef = useRef(0);
  useEffect(() => {
    if (!open || mode !== MODE_REVISE || reviseOnProject !== true) return;
    const projectId = reviseProject?.project_id;
    if (!projectId || !baseBomId) {
      setSlotOptions([]);
      setReviseSlots([]);
      return;
    }
    const callId = ++slotFetchRef.current;
    setSlotsLoading(true);
    setSlotsError('');
    Promise.resolve(loadProjectSlots({ projectId, baseBomId }))
      .then((res) => {
        if (callId !== slotFetchRef.current) return;
        const slots = res?.success ? (res.slots || []) : [];
        setSlotOptions(slots);
        // One slot is the ordinary case with nothing to decide, so it is
        // preselected. Two or more is what this multi-select exists for, and
        // choosing there on the user's behalf would be guessing — the doc is
        // explicit that leaving a slot on its old revision is a legitimate
        // outcome, not an oversight.
        setReviseSlots(slots.length === 1 ? slots : []);
        if (!res?.success) {
          setSlotsError(res?.error || 'Could not load this BOM\'s slots in the project.');
        }
        setSlotsLoading(false);
      })
      .catch((err) => {
        if (callId !== slotFetchRef.current) return;
        setSlotOptions([]);
        setReviseSlots([]);
        setSlotsError(err?.message || 'Could not load this BOM\'s slots in the project.');
        setSlotsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, reviseOnProject, reviseProject, baseBomId]);

  // A carried-over selection is not in `options` until the fetch lands, and a
  // carried project may not be on the search's first page at all. MUI drops a
  // value it cannot find and logs a warning, so it is spliced in until the real
  // row arrives to replace it.
  const bomChoices = useMemo(() => {
    if (!reviseBom) return bomOptions;
    if (bomOptions.some(o => o.enterprise_bom_id === reviseBom.enterprise_bom_id)) return bomOptions;
    return [reviseBom, ...bomOptions];
  }, [bomOptions, reviseBom]);

  // A position in the list, so the user has something short to refer to. Stable
  // because the endpoint returns slots sorted by version ascending.
  const slotOrdinal = useCallback((slot) => {
    const index = slotOptions.findIndex(s => s.bom_module_id === slot?.bom_module_id);
    return index >= 0 ? index + 1 : '?';
  }, [slotOptions]);

  const projectChoices = useMemo(() => {
    if (!reviseProject) return projectOptions;
    if (projectOptions.some(o => o.project_id === reviseProject.project_id)) return projectOptions;
    return [reviseProject, ...projectOptions];
  }, [projectOptions, reviseProject]);

  // The later steps only exist when something needs them.
  //
  // Revising ADDS two questions, it does not replace the sheet ones. A revision
  // is still built from this workbook — choosing "revise" only changes where
  // the result lands — so the generator needs to be told which sheet holds the
  // BOM and what its finished good is exactly as it does for a new one. Sending
  // no sheet answers made the editor fail with "No sheet in this upload was
  // marked as containing a BOM", which is the backend saying precisely that.
  const steps = useMemo(() => {
    const list = [{ key: 'mode', label: 'New or revision' }];
    if (mode === MODE_REVISE) {
      list.push({ key: 'reviseBom', label: 'BOM to revise' });
      list.push({ key: 'reviseProject', label: 'Project' });
    }
    list.push({ key: 'sheets', label: 'BOM sheets' });
    if (leveledSheets.length) list.push({ key: 'tree', label: 'Structure' });
    if (sheetsNeedingRoot.length) list.push({ key: 'finishedGood', label: 'Finished good' });
    return list;
  }, [mode, leveledSheets.length, sheetsNeedingRoot.length]);

  const currentKey = steps[Math.min(step, steps.length - 1)]?.key || 'sheets';

  const validateStep = useCallback(() => {
    if (currentKey === 'reviseBom') {
      if (!reviseBom) {
        setError('Choose the BOM this file revises.');
        return false;
      }
    }
    if (currentKey === 'reviseProject') {
      if (reviseOnProject === null) {
        setError('Say whether this revision applies to a project.');
        return false;
      }
      // Only checked when the answer was Yes. Answering No and leaving a
      // previously picked project in state must not block — the project is
      // dropped from the payload in that case.
      if (reviseOnProject === true && !reviseProject) {
        setError('Choose the project this BOM is revised on.');
        return false;
      }
      // Only enforced once the list is in. An empty list is the project holding
      // no slot for this BOM, which is a dead end worth saying out loud rather
      // than a selection the user forgot to make.
      if (reviseOnProject === true && reviseProject && !reviseSlots.length) {
        setError(
          slotOptions.length
            ? 'Choose which slots in this project the revision should move.'
            : 'This project holds no slot for that BOM. Pick another project.'
        );
        return false;
      }
    }
    if (currentKey === 'reviseBom' && reviseBom && !baseBomId) {
      // Without a base BOM nothing downstream can be looked up, and the project
      // step would sit permanently empty with no stated reason.
      setError(baseBomError || 'Could not work out which BOM this revision belongs to.');
      return false;
    }
    if (currentKey === 'sheets') {
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
      for (const name of sheetsNeedingRoot) {
        const header = answers[name]?.bomHeader || {};
        if (!String(header.finishedGoodCode || '').trim()) {
          setError(`Enter a finished good code for "${name}".`);
          return false;
        }
        if (!String(header.measurementUnit || '').trim()) {
          setError(`Enter a measurement unit for the Level 0 BOM in "${name}".`);
          return false;
        }
        // A base quantity that does not parse used to be silently rewritten to 1
        // at confirm time. Typing "abc" and shipping a BOM built on a quantity
        // nobody chose is worse than being asked to correct it here.
        if (!isPositiveQuantity(header.baseQuantity)) {
          setError(`Enter a base quantity greater than zero for the Level 0 BOM in "${name}".`);
          return false;
        }
        // Sub-BOMs are held to the same rule. They start prefilled, so this only
        // fires if the user deliberately cleared or mistyped one.
        const structure = answers[name]?.hasLevels ? structureFor(name) : null;
        for (const level of structure?.levels || []) {
          for (const assembly of level.assemblies) {
            if (!String(subBomValue(name, assembly, 'measurementUnit') || '').trim()) {
              setError(`Enter a measurement unit for the Level ${level.label} BOM "${assembly.code}".`);
              return false;
            }
            if (!String(subBomValue(name, assembly, 'bomName') || '').trim()) {
              setError(`Enter a BOM name for the Level ${level.label} BOM "${assembly.code}".`);
              return false;
            }
            if (!isPositiveQuantity(subBomValue(name, assembly, 'baseQuantity'))) {
              setError(`Enter a base quantity greater than zero for the Level ${level.label} BOM "${assembly.code}".`);
              return false;
            }
          }
        }
      }
    }
    return true;
  }, [currentKey, leveledSheets, sheetsNeedingRoot, answers, structureFor, subBomValue,
      reviseBom, reviseOnProject, reviseProject, reviseSlots, slotOptions,
      baseBomId, baseBomError]);

  const handleNext = () => {
    if (!validateStep()) return;
    if (step < steps.length - 1) {
      setStep(step + 1);
      return;
    }

    // The revision target, when there is one. It rides ALONGSIDE the sheet
    // answers built below rather than replacing them: a revision's contents
    // still come from this workbook, so the generator has to be told which
    // sheet holds the BOM and what its finished good is, exactly as for a new
    // one. Sending no sheet answers is what produced "No sheet in this upload
    // was marked as containing a BOM" — the backend saying precisely that.
    let revision = null;
    if (mode === MODE_REVISE) {
      const onProject = reviseOnProject === true;
      // Handed to the export dialog at the far end of the pipeline, which asks
      // these same two questions and would otherwise default back to "create a
      // new BOM" — turning a declared revision into a duplicate.
      // One entry per slot to move. bomModuleId is the linkage id the revise
      // PUT takes; the doc is explicit that these must be issued one at a time
      // and never in parallel, so the order here is the order to run them in.
      const targets = onProject
        ? reviseSlots.map(slot => ({
          bomModuleId: slot.bom_module_id ?? null,
          baseBomModuleLinkageId: slot.base_bom_module_linkage_id ?? null,
          enterpriseBomId: slot.enterprise_bom_id ?? null,
          bomCode: slot.bom_code || '',
          version: slot.version ?? null,
          rowCount: slot.row_count ?? null,
        }))
        : [];
      revision = {
        enterpriseBomId: reviseBom?.enterprise_bom_id ?? null,
        bomCode: reviseBom?.bom_code || '',
        // The identity that survives revising. Every lookup downstream needs
        // this, not enterpriseBomId, which is stale the moment the new
        // revision is created.
        baseBomId,
        onProject,
        projectId: onProject ? (reviseProject?.project_id ?? null) : null,
        projectCode: onProject ? (reviseProject?.project_code || '') : '',
        projectName: onProject ? (reviseProject?.project_name || '') : '',
        // A list even when there is one slot, so a consumer cannot read it as
        // a single value and quietly ignore the rest.
        slots: targets,
      };
      // Handed to the export dialog at the far end of the pipeline, which asks
      // these same two questions and would otherwise default back to "create a
      // new BOM" — turning a declared revision into a duplicate.
      saveBomRevisionIntent({
        enterpriseBomId: revision.enterpriseBomId,
        bomCode: revision.bomCode,
        baseBomId,
        // Recorded only when there is exactly one, because the export dialog
        // revises a single module. It re-derives the id by matching
        // enterpriseBomId against the project's BOM list rather than reading
        // this, so a multi-slot revision carries over as the project and BOM
        // with the slots left for that dialog to ask about again.
        bomModuleId: targets.length === 1 ? targets[0].bomModuleId : null,
        projectId: onProject ? (reviseProject?.project_id ?? null) : null,
        projectCode: onProject ? (reviseProject?.project_code || '') : '',
        projectName: onProject ? (reviseProject?.project_name || '') : '',
      });
    } else {
      // "This is a new BOM" contradicts any revision target left over in this
      // tab. Not clearing it is the one genuinely dangerous case here: the
      // export dialog would open pointed at that BOM and overwrite it with a
      // file the user just said was something else.
      clearBomRevisionIntent();
    }

    // Final shape. Sheets that were never marked as BOMs are dropped, and any
    // finished-good field the user left at its prefill is materialised here so
    // downstream code never has to re-apply the defaulting chain.
    const payload = { mode, sheets: {} };
    if (revision) payload.revision = revision;
    bomSheets.forEach((name) => {
      const answer = answers[name];
      const needsHeader = sheetsNeedingRoot.includes(name);
      let bomHeader = null;
      if (needsHeader) {
        const raw = answer.bomHeader || blankBomHeader(name);
        const code = String(raw.finishedGoodCode || '').trim();
        bomHeader = {
          finishedGoodCode: code,
          itemName: String(raw.itemName || '').trim() || code,
          bomName: String(raw.bomName || '').trim() || code,
          measurementUnit: String(raw.measurementUnit || '').trim() || DEFAULT_MEASUREMENT_UNIT,
          baseQuantity: Number(raw.baseQuantity) > 0 ? Number(raw.baseQuantity) : DEFAULT_BASE_QUANTITY,
        };
      }

      // Every sub-assembly is its own BOM and carries its own header. Sending
      // only the ones the user touched would leave the backend re-deriving the
      // defaults, which is how Base quantity came to be hardcoded to 1 with no
      // way to change it — so all of them are materialised here.
      const subBoms = {};
      if (answer.hasLevels && answer.treeConfirmed !== false) {
        (structureFor(name)?.levels || []).forEach((level) => {
          level.assemblies.forEach((assembly) => {
            subBoms[assembly.code] = {
              bomName: String(subBomValue(name, assembly, 'bomName') || '').trim() || assembly.code,
              measurementUnit: String(subBomValue(name, assembly, 'measurementUnit') || '').trim()
                               || DEFAULT_MEASUREMENT_UNIT,
              baseQuantity: Number(subBomValue(name, assembly, 'baseQuantity')) > 0
                ? Number(subBomValue(name, assembly, 'baseQuantity'))
                : DEFAULT_BASE_QUANTITY,
            };
          });
        });
      }
      payload.sheets[name] = {
        hasBom: true,
        hasLevels: Boolean(answer.hasLevels),
        levelColumn: answer.hasLevels ? answer.levelColumn : null,
        treeConfirmed: answer.hasLevels ? answer.treeConfirmed : null,
        bomGenerationAvailable: answer.hasLevels ? answer.treeConfirmed !== false : true,
        // Sent explicitly rather than defaulted server-side, so an older saved
        // answer without the field keeps the previous behaviour.
        dropDocuments: answer.dropDocuments !== false,
        bomHeader,
        subBoms,
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

  // The opening question. Answered with radios rather than two buttons because
  // it is a property of the upload, not an action — the user can change their
  // mind and come back to it with Back like every other answer here.
  const renderMode = () => (
    <>
      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        Is this file a new BOM, or a new revision of a BOM that already exists?
      </Typography>
      <RadioGroup
        value={mode}
        onChange={(e) => { setMode(e.target.value); setError(''); }}
      >
        {[
          {
            value: MODE_CREATE,
            title: 'Create a new BOM',
            detail: 'Describe the structure in this file and build a BOM from it.',
          },
          {
            value: MODE_REVISE,
            title: 'Revise an existing BOM',
            detail: 'Pick the BOM this file updates. Its structure, finished good and units are inherited.',
          },
        ].map(option => (
          <Box
            key={option.value}
            sx={{
              p: 2,
              mb: 1.5,
              borderRadius: 1,
              border: theme => `1px solid ${
                mode === option.value ? theme.palette.primary.main : theme.palette.divider
              }`,
            }}
          >
            <FormControlLabel
              value={option.value}
              control={<Radio />}
              label={<Typography sx={{ fontWeight: 600 }}>{option.title}</Typography>}
              sx={{ m: 0 }}
            />
            <Typography variant="caption" sx={{ display: 'block', ml: 4, color: 'text.secondary' }}>
              {option.detail}
            </Typography>
          </Box>
        ))}
      </RadioGroup>
    </>
  );

  const renderReviseBom = () => (
    <>
      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        Which BOM does this file revise? The new revision is created from it, so
        everything this dialog would otherwise ask about structure comes from there.
      </Typography>
      <Autocomplete
        size="small"
        options={bomChoices}
        value={reviseBom}
        onChange={(_, value) => { setReviseBom(value); setPrefilled(false); setError(''); }}
        loading={bomsLoading}
        getOptionLabel={option => (option ? String(option.bom_code || option.enterprise_bom_id || '') : '')}
        isOptionEqualToValue={(option, value) => option?.enterprise_bom_id === value?.enterprise_bom_id}
        renderOption={(props, option) => (
          <li {...props} key={option.enterprise_bom_id}>
            <Box>
              <Typography variant="body2">{option.bom_code || option.enterprise_bom_id}</Typography>
              {option.version ? (
                <Typography variant="caption" color="text.secondary">
                  {`currently v${option.version}`}
                  {option.revisions?.length > 1 ? ` · ${option.revisions.length} revisions` : ''}
                </Typography>
              ) : null}
            </Box>
          </li>
        )}
        renderInput={params => (
          <TextField
            {...params}
            label="BOM to revise"
            error={Boolean(bomsError || baseBomError)}
            helperText={
              bomsError
              || baseBomError
              || (prefilled && reviseBom ? 'Carried over from your last export — change it if this file revises something else.' : '')
              || (!bomsLoading && !bomOptions.length
                ? 'No BOMs came back. Check that you are signed in to FactWise.'
                : 'One entry per BOM, showing its current revision.')
            }
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {bomsLoading ? <CircularProgress size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
      />
    </>
  );

  // Yes/No first, project picker only underneath a Yes. The dropdown is not
  // rendered disabled for a No — an empty control the user cannot use reads as
  // something broken rather than something not asked for.
  const renderReviseProject = () => (
    <>
      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        Do you want to revise this BOM on a project too?
      </Typography>
      <RadioGroup
        row
        value={reviseOnProject === null ? '' : String(reviseOnProject)}
        onChange={(e) => { setReviseOnProject(e.target.value === 'true'); setError(''); }}
        sx={{ mb: 1 }}
      >
        <FormControlLabel value="true" control={<Radio />} label="Yes" />
        <FormControlLabel value="false" control={<Radio />} label="No" />
      </RadioGroup>

      {reviseOnProject === true && (
        <Box sx={{ mt: 1 }}>
          <Autocomplete
            size="small"
            options={projectChoices}
            value={reviseProject}
            onChange={(_, value) => { setReviseProject(value); setPrefilled(false); setError(''); }}
            loading={projectsLoading}
            disabled={!reviseBom}
            getOptionLabel={(option) => {
              if (!option) return '';
              const bits = [option.project_code, option.project_name].filter(Boolean);
              return bits.join(' — ') || String(option.project_id || '');
            }}
            isOptionEqualToValue={(option, value) => option?.project_id === value?.project_id}
            renderOption={(props, option) => (
              <li {...props} key={option.project_id}>
                <Box>
                  <Typography variant="body2">{option.project_name || option.project_code}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {[
                      option.project_code,
                      // Closed projects are returned too — the API deliberately
                      // does not filter by status, so the status is shown and
                      // the call is the user's.
                      option.project_status,
                      option.bom_group_count
                        ? `${option.bom_group_count} slot${option.bom_group_count === 1 ? '' : 's'}`
                        : null,
                    ].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
              </li>
            )}
            renderInput={params => (
              <TextField
                {...params}
                label="Project"
                error={Boolean(projectsError)}
                helperText={
                  projectsError
                  || (prefilled && reviseProject ? 'Carried over from your last export.' : '')
                  || (!projectsLoading && !projectOptions.length
                    ? 'No project currently holds this BOM.'
                    : 'Only projects that already contain this BOM.')
                }
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {projectsLoading ? <CircularProgress size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />

          {/* The slots that BOM occupies in the project. Appears only once a
              project is chosen, because until then there is nothing to list. */}
          {reviseProject && (
            <Box sx={{ mt: 2 }}>
              <Autocomplete
                multiple
                disableCloseOnSelect
                size="small"
                options={slotOptions}
                value={reviseSlots}
                onChange={(_, value) => { setReviseSlots(value); setError(''); }}
                loading={slotsLoading}
                getOptionLabel={option => (option
                  ? [
                    `#${slotOrdinal(option)}`,
                    option.bom_code,
                    option.version ? `v${option.version}` : null,
                  ].filter(Boolean).join(' · ')
                  : '')}
                isOptionEqualToValue={(option, value) => option?.bom_module_id === value?.bom_module_id}
                renderOption={(props, option) => (
                  <li {...props} key={option.bom_module_id}>
                    <Box>
                      <Typography variant="body2">
                        {`#${slotOrdinal(option)}  `}
                        {option.bom_code || option.bom_module_id}
                        {option.version ? `  ·  v${option.version}` : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {[
                          option.row_count
                            ? `${option.row_count} row${option.row_count === 1 ? '' : 's'}`
                            : null,
                          (option.quantities || []).length
                            ? `qty ${option.quantities.join(', ')}`
                            : null,
                          // The only true identity. Code, version and even
                          // quantities can all coincide — nothing stops the same
                          // BOM being added twice at the same revision and the
                          // same quantity — so without this the user can face
                          // two rows they cannot tell apart.
                          shortId(option.base_bom_module_linkage_id),
                        ].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                  </li>
                )}
                renderInput={params => (
                  <TextField
                    {...params}
                    label="Slots to move onto the new revision"
                    error={Boolean(slotsError)}
                    helperText={
                      slotsError
                      || (slotsLoading ? 'Loading…' : '')
                      || (!slotOptions.length
                        ? 'This project holds no slot for that BOM.'
                        : slotOptions.length === 1
                          ? 'One slot, already selected. All its rows move together.'
                          : `This BOM sits in ${slotOptions.length} slots, each at its own revision. Slots you leave unpicked stay where they are.`)
                    }
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {slotsLoading ? <CircularProgress size={16} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />
            </Box>
          )}
        </Box>
      )}
    </>
  );

  // Sheet selection and the single/multi choice are one step: ticking a sheet
  // expands its structure question in place, so the answer sits next to the
  // sheet it is about rather than on a second screen.
  const renderSheets = () => (
    <>
      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        Which of these sheets contain a BOM, and does each one have levels? Sheets left
        unchecked are still uploaded and mapped — they are just not used to build a BOM.
      </Typography>
      {sheetNames.length === 0 && (
        <Alert severity="info">No sheets were detected in this file.</Alert>
      )}
      {sheetNames.map((name) => {
        const answer = answers[name] || blankSheetAnswer();
        const headers = headersFor(name);
        const autoDetected = detectLevelColumn(headers);
        return (
          <Box
            key={name}
            sx={{
              mb: 1.5,
              borderRadius: 1,
              border: theme => `1px solid ${theme.palette.divider}`,
              bgcolor: answer.hasBom ? 'action.hover' : 'transparent',
              px: 1.5,
              py: 0.5,
            }}
          >
            <FormControlLabel
              control={
                <Checkbox
                  checked={Boolean(answer.hasBom)}
                  onChange={e => patch(name, { hasBom: e.target.checked })}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <span>{name}</span>
                  <Chip size="small" variant="outlined" label={`${headers.length} columns`} />
                </Box>
              }
            />
            {answer.hasBom && (
              <Box sx={{ pl: 4, pb: 1 }}>
                <RadioGroup
                  row
                  value={answer.hasLevels ? 'yes' : 'no'}
                  onChange={(e) => {
                    const hasLevels = e.target.value === 'yes';
                    patch(name, {
                      hasLevels,
                      levelColumn: hasLevels ? (answer.levelColumn || autoDetected) : '',
                      // Yes by default when switching to multi level, matching
                      // the seed. Switching back to single level clears it,
                      // since the Structure step no longer applies.
                      treeConfirmed: hasLevels ? true : null,
                      // Preserved across the toggle, never nulled. Seeding puts
                      // the preamble-detected root here for a levelled sheet;
                      // discarding it on a toggle meant the confirm step fell
                      // back to blankBomHeader and shipped a code guessed from
                      // the sheet name, with the "auto-detected" chip gone and
                      // nothing telling the user it had been swapped.
                      bomHeader: answer.bomHeader || blankBomHeader(name),
                    });
                  }}
                >
                  <FormControlLabel
                    value="no"
                    control={<Radio size="small" />}
                    label="Single level — one flat list of components"
                  />
                  <FormControlLabel
                    value="yes"
                    control={<Radio size="small" />}
                    label="Multi level — has sub-assemblies"
                  />
                </RadioGroup>
                {answer.hasLevels && (
                  <>
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
                    {autoDetected && answer.levelColumn === autoDetected && (
                      <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
                        Detected “{autoDetected}” automatically — change it if that is the wrong column.
                      </Typography>
                    )}
                  </>
                )}
              </Box>
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
        Every BOM needs a finished good at Level 0. A single-level sheet lists components
        but not the thing they build; a multi-level sheet usually starts at Level 1 and
        names its assembly above the table. Either way it becomes an item in the item
        directory as well.
      </Typography>
      {sheetsNeedingRoot.map((name) => {
        const answer = answers[name] || blankSheetAnswer();
        const header = answer.bomHeader || blankBomHeader(name);
        const code = String(header.finishedGoodCode || '').trim();
        const structure = answer.hasLevels ? structureFor(name) : null;
        return (
          <Box key={name} sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{name}</Typography>

            {/* Naming a BOM is meaningless without seeing which one it is, so the
                levels found in the sheet are listed alongside the field. */}
            {structure && (
              <Box
                sx={{
                  mb: 2,
                  p: 1.5,
                  borderRadius: 1,
                  border: theme => `1px solid ${theme.palette.divider}`,
                  bgcolor: 'action.hover',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, width: 110 }}>
                    Level 0 BOM
                  </Typography>
                  <Typography variant="caption" sx={{ color: code ? 'text.primary' : 'error.main' }}>
                    {code
                      ? `${code}${header.itemName ? ` — ${header.itemName}` : ''}`
                      : 'not found in the sheet — name it below'}
                  </Typography>
                  {header.autoDetected && (
                    <Chip size="small" variant="outlined" label="auto-detected" />
                  )}
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    — set its fields below
                  </Typography>
                </Box>
                {/* Each sub-assembly is its own BOM in the FactWise import and
                    needs its own name, base quantity and unit. The sheet only
                    supplies the code, so the rest is asked for here rather than
                    assumed. The code itself is fixed: it is the string the
                    parent's Sub BOM ID points at, so renaming it would break
                    the link between the two BOMs. */}
                {structure.levels.map(level => level.assemblies.map(assembly => (
                  <Box
                    key={`${level.label}:${assembly.code}`}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 700, width: 110, flexShrink: 0 }}>
                      {`Level ${level.label} BOM`}
                    </Typography>
                    <Chip size="small" label={assembly.code} sx={{ flexShrink: 0 }} />
                    <TextField
                      size="small"
                      label="BOM name"
                      value={subBomValue(name, assembly, 'bomName')}
                      onChange={e => patchSubBom(name, assembly.code, { bomName: e.target.value })}
                      sx={{ width: 230 }}
                    />
                    <TextField
                      size="small"
                      required
                      label="Measurement unit"
                      value={subBomValue(name, assembly, 'measurementUnit')}
                      onChange={e => patchSubBom(name, assembly.code, { measurementUnit: e.target.value })}
                      sx={{ width: 150 }}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Base quantity"
                      value={subBomValue(name, assembly, 'baseQuantity')}
                      onChange={e => patchSubBom(name, assembly.code, { baseQuantity: e.target.value })}
                      sx={{ width: 130 }}
                    />
                  </Box>
                )))}
                {/* A choice, not a rule. "Consumes nothing" usually means a
                    drawing, but not always — some exports write 0 on real parts
                    — and only the user knows which this sheet is. Excluding is
                    still the default because it is right more often. */}
                {structure.documents > 0 && (
                  <Box sx={{ mt: 1 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={answer.dropDocuments !== false}
                          onChange={e => patch(name, { dropDocuments: e.target.checked })}
                        />
                      }
                      label={
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {`Exclude ${structure.documents} ${structure.documents === 1 ? 'row that consumes' : 'rows that consume'} no quantity `}
                          {'— treat them as documents rather than parts.'}
                        </Typography>
                      }
                    />
                    {answer.dropDocuments === false && (
                      <Typography variant="caption" sx={{ display: 'block', ml: 4, color: 'text.secondary' }}>
                        They will be kept as BOM lines, and their quantity flagged by validation.
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            )}

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
    mode: renderMode,
    reviseBom: renderReviseBom,
    reviseProject: renderReviseProject,
    sheets: renderSheets,
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
