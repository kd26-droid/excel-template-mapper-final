import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Select,
  Snackbar,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import TuneIcon from '@mui/icons-material/Tune';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import api from '../services/api';
import BomStructureDialog, { reconcileSavedBomStructure } from '../components/BomStructureDialog';
import ColumnParser from '../components/ColumnParser/ColumnParser';
import {
  createFactwiseIds,
  createTagColumn,
  getNextTagColumn,
  getNormalizedExportColumns,
  getSerialPreviewValues,
} from '../lib/bomNormalizerAlgorithms';
import {
  ALTERNATE_LAYOUT_OPTIONS,
  BOM_LAYOUT_OPTIONS,
  CLEANUP_OPTIONS,
  DELIMITER_OPTIONS,
  GROUP_HEADER_OPTIONS,
  KNOWN_MANUFACTURERS,
  MANUFACTURER_INHERIT_OPTIONS,
  MANUFACTURER_SUFFIX_WORDS,
  MPN_CONNECTOR_WORDS,
  MPN_NOISE_RE,
  QTY_OPTIONS,
  ROLE_FIELDS,
  STRUCTURE_OPTIONS,
} from '../lib/bomNormalizerAlgorithmRegistry';
import { useThemeContext } from '../utils/ThemeContext';

const emptyRoles = ROLE_FIELDS.reduce((acc, field) => {
  acc[field.key] = '';
  return acc;
}, {});

const SUPPORTED_SOURCE_EXTENSIONS = ['.xlsx', '.xls', '.xlsm', '.csv', '.pdf'];

const getFileExtension = (fileName = '') => {
  const match = String(fileName || '').toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : '';
};

const unsupportedSourceMessage = (fileName = 'Selected file') => (
  `${fileName} is not supported. Please upload .xlsx, .xls, .xlsm, .csv, or .pdf files.`
);

const EXCEL_OUTLINE_LEVEL_HEADER = 'Excel Outline Level';

const uniqueHeaderName = (baseName, existingHeaders = []) => {
  if (!existingHeaders.includes(baseName)) return baseName;
  let index = 2;
  while (existingHeaders.includes(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
};

const LEARNED_ROLE_HEADERS_KEY = 'bomNormalizer.learnedRoleHeaders.v1';
const BOM_NORMALIZER_RETURN_PREFIX = 'bomNormalizer.returnSnapshot.';
const BOM_NORMALIZER_LATEST_RESULTS_KEY = 'bomNormalizer.latestResultsSnapshot';

const fmt = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const normalizeKey = (value) => fmt(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const compactHeaderKey = (value) => normalizeKey(value).replace(/\s+/g, '');

const headerSimilarityScore = (left, right) => {
  const leftKey = compactHeaderKey(left);
  const rightKey = compactHeaderKey(right);
  if (!leftKey || !rightKey) return 0;
  if (leftKey === rightKey) return 100;
  if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) return 88;

  const leftWords = new Set(normalizeKey(left).split(/\s+/).filter(Boolean));
  const rightWords = new Set(normalizeKey(right).split(/\s+/).filter(Boolean));
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  if (overlap && (overlap / Math.max(leftWords.size, rightWords.size)) >= 0.65) return 84;

  const maxLength = Math.max(leftKey.length, rightKey.length);
  let samePrefix = 0;
  while (samePrefix < maxLength && leftKey[samePrefix] === rightKey[samePrefix]) samePrefix += 1;
  return Math.round((samePrefix / maxLength) * 70);
};

const resolveSavedHeader = (savedHeader, currentHeaders = [], threshold = 80) => {
  if (!savedHeader) return '';
  if (currentHeaders.includes(savedHeader)) return savedHeader;

  let bestHeader = '';
  let bestScore = 0;
  currentHeaders.forEach((header) => {
    const score = headerSimilarityScore(savedHeader, header);
    if (score > bestScore) {
      bestHeader = header;
      bestScore = score;
    }
  });
  return bestScore >= threshold ? bestHeader : '';
};

const resolveSavedRoleMap = (savedRoles = {}, currentHeaders = []) => (
  Object.keys(emptyRoles).reduce((acc, key) => {
    acc[key] = resolveSavedHeader(savedRoles[key], currentHeaders);
    return acc;
  }, {})
);

const resolveSavedAlternateGroups = (groups = [], currentHeaders = []) => (
  (Array.isArray(groups) ? groups : [])
    .map((group) => ({
      ...group,
      mpn: resolveSavedHeader(group?.mpn, currentHeaders),
      mfr: resolveSavedHeader(group?.mfr, currentHeaders),
      qty: resolveSavedHeader(group?.qty, currentHeaders),
      uom: resolveSavedHeader(group?.uom, currentHeaders),
    }))
    .filter((group) => group.mpn || group.mfr)
);

const getProcessingTemplateMappingId = (template = {}) => {
  const metadataId = template?.metadata?.mapping_template_id;
  if (metadataId) return metadataId;
  const stage = Array.isArray(template?.stages)
    ? template.stages.find((item) => item?.type === 'mapping_template' && item?.mapping_template_id)
    : null;
  return stage?.mapping_template_id || null;
};

const getProcessingTemplateNormalizerWorkflow = (template = {}) => {
  if (template?.metadata?.normalizer_workflow) return template.metadata.normalizer_workflow;
  const stage = Array.isArray(template?.stages)
    ? template.stages.find((item) => item?.type === 'bom_normalizer' && item?.workflow)
    : null;
  return stage?.workflow || null;
};

const getSnapshotRowCount = (snapshot) => (
  Array.isArray(snapshot?.normalizedRows) ? snapshot.normalizedRows.length : 0
);

const pickBestNormalizerSnapshot = (snapshots = []) => (
  snapshots
    .filter(Boolean)
    .sort((a, b) => getSnapshotRowCount(b) - getSnapshotRowCount(a))[0] || null
);

const getLearnedRoleHeaders = () => {
  try {
    const raw = window.localStorage.getItem(LEARNED_ROLE_HEADERS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
};

const rememberRoleHeader = (role, header) => {
  if (!role || !header) return;
  try {
    const learned = getLearnedRoleHeaders();
    const values = Array.isArray(learned[role]) ? learned[role] : [];
    const normalizedHeader = normalizeKey(header);
    const nextValues = [
      header,
      ...values.filter((value) => normalizeKey(value) !== normalizedHeader),
    ].slice(0, 20);
    window.localStorage.setItem(LEARNED_ROLE_HEADERS_KEY, JSON.stringify({
      ...learned,
      [role]: nextValues,
    }));
  } catch (err) {
    // Learning is optional; ignore storage failures.
  }
};

const makeUniqueHeaders = (row) => {
  const seen = {};
  return row.map((cell, index) => {
    const base = fmt(cell) || `Column ${index + 1}`;
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] === 1 ? base : `${base}.${seen[base] - 1}`;
  });
};

const HEADER_SCAN_ROWS = 40;
const HEADER_KEYWORDS = [
  /\boperation\b/, /\bsequence\b/, /\bcomponent\b/, /\bitem\b/, /\bpart\b/,
  /\bdescription\b/, /\btype\b/, /\buom\b/, /\bqty\b/, /\bqnty\b/, /\bquantity\b/,
  /\bmanufacturer\b/, /\bmanufacture\b/, /\bmpn\b/, /\bmfr\b/, /\bdesignator/,
  /\breference\b/, /\bvendor\b/, /\bsupplier\b/, /\bmfg\b/,
  /\brelease\b/, /\bstatus\b/, /\brevision\b/, /\bclassification\b/,
];
const METADATA_PATTERNS = [
  /part list for/, /report date/, /^description:?$/, /^required\b/, /^optional\b/,
  /generated by/, /printed on/, /page \d+/, /^plm$/, /^bom report$/,
];

const isNumericLike = (value) => {
  const text = fmt(value).replace(/,/g, '');
  return text !== '' && !Number.isNaN(Number(text));
};

const scoreHeaderCandidate = (rows, rowIndex) => {
  const row = rows[rowIndex] || [];
  const cells = row.map(fmt);
  const filled = cells.filter(Boolean);
  if (!filled.length) return Number.NEGATIVE_INFINITY;

  const count = filled.length;
  const normalized = filled.map(normalizeKey);
  const avgLength = filled.reduce((sum, cell) => sum + cell.length, 0) / count;
  const longCells = filled.filter((cell) => cell.length > 60).length;
  const proseCells = filled.filter((cell) => /[.!?](\s|$)/.test(cell) || cell.split(/\s+/).length > 8).length;
  const numericCells = filled.filter(isNumericLike).length;
  const keywordHits = normalized.filter((cell) => HEADER_KEYWORDS.some((pattern) => pattern.test(cell))).length;
  const metadataHits = normalized.filter((cell) => METADATA_PATTERNS.some((pattern) => pattern.test(cell))).length;
  const compactFilled = filled.map((cell) => cell.replace(/[^A-Za-z0-9]/g, ''));
  const longNumericIdentifiers = compactFilled.filter((cell) => /^\d{5,}$/.test(cell)).length;
  const dataRowSignals = filled.filter((cell, cellIndex) => {
    const compact = compactFilled[cellIndex] || '';
    const key = normalized[cellIndex] || '';
    if (/^\d{5,}$/.test(compact)) return true;
    if (isNumericLike(cell) && Number(String(cell).replace(/,/g, '')) <= 999 && count >= 4) return true;
    if (cell.length > 12 && /\s/.test(cell) && !HEADER_KEYWORDS.some((pattern) => pattern.test(key))) return true;
    return false;
  }).length;
  const headerKeywordRatio = keywordHits / count;
  const indexes = cells.map((cell, index) => (cell ? index : -1)).filter((index) => index >= 0);
  const nextRows = rows.slice(rowIndex + 1, rowIndex + 9).map((nextRow) => nextRow.map(fmt));
  const supportedColumns = indexes.filter((index) => nextRows.some((nextRow) => nextRow[index])).length;
  const dataRowsBelow = nextRows.filter((nextRow) => indexes.some((index) => nextRow[index])).length;
  const shortLabelRatio = filled.filter((cell) => cell.length <= 35 && cell.split(/\s+/).length <= 5).length / count;
  const uniqueRatio = new Set(normalized).size / count;
  const supportRatio = count ? supportedColumns / count : 0;
  const numericPenalty = supportRatio >= 0.5 ? 6 : 25;

  return (
    count * 2.4
    + keywordHits * 8
    + (keywordHits >= 3 ? 18 : 0)
    + headerKeywordRatio * 14
    + supportedColumns * 1.4
    + dataRowsBelow * 1.2
    + shortLabelRatio * 8
    - (longCells / count) * 40
    - (proseCells / count) * 30
    - (numericCells / count) * numericPenalty
    - longNumericIdentifiers * 18
    - Math.max(0, dataRowSignals - keywordHits) * 6
    - metadataHits * 18
    - (count <= 2 ? 20 : 0)
    - Math.max(0, avgLength - 30) * 0.6
    + uniqueRatio * 10
  );
};

const getUsableColumnDescriptors = (rows, headerIndex) => {
  const headerRow = (rows[headerIndex] || []).map(fmt);
  const dataRows = rows.slice(headerIndex + 1).map((row) => row.map(fmt));
  const maxLength = Math.max(headerRow.length, ...dataRows.map((row) => row.length), 0);
  const seen = {};
  const descriptors = [];
  for (let index = 0; index < maxLength; index += 1) {
    const rawHeader = headerRow[index] || '';
    const hasHeader = rawHeader !== '';
    const hasData = dataRows.some((row) => row[index]);
    // Keep every named column, even if it looks generic ("A", "1", "Column X")
    // or has no current data. Also keep blank-header columns if any data exists.
    // Only truly empty columns with no header and no data are hidden.
    if (!hasHeader && !hasData) continue;
    const base = rawHeader || `Column ${index + 1}`;
    seen[base] = (seen[base] || 0) + 1;
    descriptors.push({
      index,
      header: seen[base] === 1 ? base : `${base}.${seen[base] - 1}`,
      isGenerated: !rawHeader,
    });
  }
  return descriptors;
};

const rowsToObjects = (rows, currentHeaders, startRowNumber = 1) => rows
  .map((row, rowIndex) => {
    const mapped = {};
    const sourceCellStyles = {};
    currentHeaders.forEach((header, index) => {
      mapped[header] = fmt(row[index]);
      if (row.__cellMeta?.[index]) sourceCellStyles[header] = row.__cellMeta[index];
    });
    mapped.__sourceRow = startRowNumber + rowIndex;
    if (Object.keys(sourceCellStyles).length) mapped.__sourceCellStyles = sourceCellStyles;
    if (row.__rowMeta?.deletedStyle) mapped.__deletedRowStyle = true;
    if (row.__rowMeta?.redStyle) mapped.__redRowStyle = true;
    if (row.__rowMeta?.strikeStyle) mapped.__strikeRowStyle = true;
    return mapped;
  });

const filterRowsByEndRow = (rows = [], endRow = '') => {
  const limit = Number(endRow);
  if (!Number.isFinite(limit) || limit <= 0) return rows;
  return rows.filter((row) => Number(row?.__sourceRow || 0) <= limit);
};

const colorLooksRed = (color = {}) => {
  const raw = fmt(color?.rgb || color?.argb || color?.value || '').replace(/^#/, '');
  if (!raw) return false;
  const hex = raw.length === 8 ? raw.slice(2) : raw;
  if (!/^[0-9a-f]{6}$/i.test(hex)) return false;
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return red >= 180 && green <= 100 && blue <= 100;
};

const valueLooksStruck = (value) => {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return /^(?:1|true|yes)$/i.test(value.trim());
};

const objectHasStrikeStyle = (value, depth = 0) => {
  if (!value || depth > 4) return false;
  if (typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nestedValue]) => {
    const normalizedKey = normalizeKey(key);
    if (/(^| )strike(?: |$)|strikethrough|strikeout/.test(normalizedKey) && valueLooksStruck(nestedValue)) {
      return true;
    }
    return objectHasStrikeStyle(nestedValue, depth + 1);
  });
};

const htmlLooksStruck = (value) => /<(?:s|strike)\b|text-decoration(?:-line)?\s*:\s*line-through/i.test(fmt(value));

const getCellStyleInfo = (cell = {}) => {
  const style = cell?.s || {};
  const font = style.font || {};
  const red = colorLooksRed(font.color) || colorLooksRed(style.fgColor) || colorLooksRed(style.color);
  const strike = Boolean(
    cell.__styleInfo?.strike ||
    font.strike ||
    font.strikethrough ||
    font.strikeThrough ||
    font.strikeout ||
    font.strikeOut ||
    objectHasStrikeStyle(font) ||
    objectHasStrikeStyle(style) ||
    htmlLooksStruck(cell?.h) ||
    htmlLooksStruck(cell?.r)
  );
  return { red, strike };
};

const hasCellStyleInfo = (styleInfo = {}) => Boolean(styleInfo.red || styleInfo.strike);

const looksLikeStackedPartIdentifierLine = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ').trim();
  if (!text || !/[0-9]/.test(text)) return false;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 3) return false;
  return tokens.every((token) => /^[A-Z]{0,4}[A-Z0-9][A-Z0-9._/-]{2,24}$/i.test(token));
};

const cleanStackedPartIdentifierCell = (value) => {
  const lines = fmt(value)
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n+/)
    .map(fmt)
    .filter(Boolean);
  if (lines.length < 2) return fmt(value);
  if (!lines.every(looksLikeStackedPartIdentifierLine)) return fmt(value);
  return lines[lines.length - 1];
};

const applyMergedCellValues = (worksheet, valuesByCell, usedColumns, metaByRow, metaByCell) => {
  const merges = Array.isArray(worksheet?.['!merges']) ? worksheet['!merges'] : [];
  let maxMergedRow = -1;

  merges.forEach((merge) => {
    const topRow = Number(merge?.s?.r);
    const leftCol = Number(merge?.s?.c);
    const bottomRow = Number(merge?.e?.r);
    const rightCol = Number(merge?.e?.c);
    if (![topRow, leftCol, bottomRow, rightCol].every(Number.isFinite)) return;

    const topLeftKey = `${topRow}:${leftCol}`;
    const topLeftAddress = XLSX.utils.encode_cell({ r: topRow, c: leftCol });
    const topLeftCell = worksheet?.[topLeftAddress];
    const mergedValue = fmt(valuesByCell.get(topLeftKey) ?? topLeftCell?.w ?? topLeftCell?.v);
    if (!mergedValue) return;

    const styleInfo = getCellStyleInfo(topLeftCell);
    for (let rowIndex = topRow; rowIndex <= bottomRow; rowIndex += 1) {
      maxMergedRow = Math.max(maxMergedRow, rowIndex);
      if (styleInfo.red || styleInfo.strike) {
        const rowMeta = metaByRow.get(rowIndex) || { redStyle: false, strikeStyle: false, deletedStyle: false };
        rowMeta.redStyle = rowMeta.redStyle || styleInfo.red;
        rowMeta.strikeStyle = rowMeta.strikeStyle || styleInfo.strike;
        rowMeta.deletedStyle = rowMeta.deletedStyle || styleInfo.red || styleInfo.strike;
        metaByRow.set(rowIndex, rowMeta);
      }
      for (let colIndex = leftCol; colIndex <= rightCol; colIndex += 1) {
        usedColumns.add(colIndex);
        const key = `${rowIndex}:${colIndex}`;
        if (!fmt(valuesByCell.get(key))) {
          valuesByCell.set(key, mergedValue);
        }
        if (hasCellStyleInfo(styleInfo) && !metaByCell.has(key)) {
          metaByCell.set(key, styleInfo);
        }
      }
    }
  });

  return maxMergedRow;
};

const worksheetToCompactRows = (worksheet, options = {}) => {
  const { expandMergedCells = true } = options;
  const cells = Object.keys(worksheet).filter((key) => !key.startsWith('!'));
  let maxRow = -1;
  let maxColumn = -1;
  const valuesByCell = new Map();
  const metaByRow = new Map();
  const metaByCell = new Map();
  const usedColumns = new Set();
  const outlineRows = Array.isArray(worksheet?.['!rows']) ? worksheet['!rows'] : [];
  const range = worksheet?.['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null;

  if (range) {
    maxRow = Math.max(maxRow, range.e.r);
    maxColumn = Math.max(maxColumn, range.e.c);
  }

  outlineRows.forEach((rowInfo, rowIndex) => {
    const rawLevel = Number(rowInfo?.level);
    if (!Number.isFinite(rawLevel) || rawLevel <= 0) return;
    maxRow = Math.max(maxRow, rowIndex);
    const rowMeta = metaByRow.get(rowIndex) || { redStyle: false, strikeStyle: false, deletedStyle: false };
    rowMeta.outlineLevel = rawLevel + 1;
    metaByRow.set(rowIndex, rowMeta);
  });

  cells.forEach((cellAddress) => {
    const cell = worksheet[cellAddress];
    const value = fmt(cell?.w ?? cell?.v);
    if (!value) return;
    const position = XLSX.utils.decode_cell(cellAddress);
    maxRow = Math.max(maxRow, position.r);
    maxColumn = Math.max(maxColumn, position.c);
    usedColumns.add(position.c);
    valuesByCell.set(`${position.r}:${position.c}`, value);
    const styleInfo = getCellStyleInfo(cell);
    if (styleInfo.red || styleInfo.strike) {
      metaByCell.set(`${position.r}:${position.c}`, styleInfo);
      const rowMeta = metaByRow.get(position.r) || { redStyle: false, strikeStyle: false, deletedStyle: false };
      rowMeta.redStyle = rowMeta.redStyle || styleInfo.red;
      rowMeta.strikeStyle = rowMeta.strikeStyle || styleInfo.strike;
      rowMeta.deletedStyle = rowMeta.deletedStyle || styleInfo.red || styleInfo.strike;
      metaByRow.set(position.r, rowMeta);
    }
  });

  if (expandMergedCells) {
    maxRow = Math.max(maxRow, applyMergedCellValues(worksheet, valuesByCell, usedColumns, metaByRow, metaByCell));
    if (usedColumns.size) {
      maxColumn = Math.max(maxColumn, ...usedColumns);
    }
  }

  if (maxRow < 0 || maxColumn < 0) return [];

  const startColumn = 0;
  const endColumn = maxColumn;

  const rows = [];
  for (let rowIndex = 0; rowIndex <= maxRow; rowIndex += 1) {
    const row = [];
    for (let colIndex = startColumn; colIndex <= endColumn; colIndex += 1) {
      row.push(valuesByCell.get(`${rowIndex}:${colIndex}`) || '');
    }
    row.__rowMeta = metaByRow.get(rowIndex) || null;
    const cellMeta = {};
    for (let colIndex = startColumn; colIndex <= endColumn; colIndex += 1) {
      const styleInfo = metaByCell.get(`${rowIndex}:${colIndex}`);
      if (styleInfo) cellMeta[colIndex] = styleInfo;
    }
    row.__cellMeta = Object.keys(cellMeta).length ? cellMeta : null;
    rows.push(row);
  }

  return rows;
};

// One populated column means the file did not really split into a table - a CSV
// saved with the wrong delimiter, typically. Scoring rows against each other is
// then meaningless, and row 1 is the only honest answer.
const hasSingleUsableColumn = (rows = []) => {
  const populated = new Set();
  rows.slice(0, HEADER_SCAN_ROWS).forEach((row) => {
    (row || []).forEach((cell, index) => {
      if (fmt(cell) !== '') populated.add(index);
    });
  });
  return populated.size <= 1;
};

const detectHeaderRow = (rows) => {
  if (hasSingleUsableColumn(rows)) return 0;
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  rows.slice(0, HEADER_SCAN_ROWS).forEach((_row, index) => {
    const score = scoreHeaderCandidate(rows, index);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
};

// A header can lie about what a column holds. THALES exports a column called "MFR"
// that carries plant codes (F9111, F6137) rather than manufacturers, and matching on
// the name alone mapped it straight to the manufacturer role. Manufacturer names vary
// across a BOM and are words; a code column is a handful of short alphanumeric tokens
// repeated down hundreds of rows. Only used to veto a name match when the values
// clearly disagree, never to make a match on its own.
const looksLikeCodeColumn = (values) => {
  const samples = values.map(fmt).filter(Boolean);
  if (samples.length < 8) return false;      // too few to judge; trust the header
  const distinct = new Set(samples.map((value) => value.toLowerCase()));
  if (distinct.size > Math.max(4, samples.length * 0.2)) return false;
  // Short, no spaces, and carrying a digit is what a plant/site code looks like.
  const codeLike = samples.filter((value) => value.length <= 8 && !/\s/.test(value) && /\d/.test(value));
  return codeLike.length >= samples.length * 0.9;
};

const columnValues = (header, headers, dataRows) => {
  const index = headers.indexOf(header);
  if (index < 0) return [];
  return dataRows.slice(0, 60).map((row) => (Array.isArray(row) ? row[index] : row?.[header]));
};

const roleSampleValues = (values) => values.map(fmt).filter(Boolean);

const hasUsefulRoleValues = (values, minimum = 1) => roleSampleValues(values).length >= minimum;

const looksLikeHierarchyColumn = (values) => {
  const samples = roleSampleValues(values);
  if (samples.length < 4) return false;
  const hierarchyLike = samples.filter((value) => value.includes('>') || /^[-.\d\s]*>/.test(value));
  return hierarchyLike.length >= samples.length * 0.6;
};

const looksLikeDocumentHeader = (header) => (
  /\b(doc|document|lien|link|date|status|statut|revision|indice|security|securite)\b/.test(normalizeKey(header))
);

const parseStructuredMpnMfrValue = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text || text.includes('>')) return null;
  const match = text.match(/^(.*?)\s+\(([^()]*)\)\s*(?:\{[^}]*\})?\s*(?:\[[^\]]*\])?\s*$/);
  if (!match) return null;
  const mpn = fmt(match[1]);
  const manufacturer = fmt(match[2]);
  if (!mpn || !manufacturer || !/[0-9]/.test(mpn) || !/[A-Za-z]/.test(manufacturer)) return null;
  if (/^F\d{3,}$/.test(manufacturer) || /^\d+$/.test(manufacturer)) return null;
  return { mpn, manufacturer };
};

const getDiscardedPackedText = (value, pair = {}) => {
  if (pair.metadata?.discardedText) return pair.metadata.discardedText;
  const text = fmt(value).replace(/\u00a0/g, ' ');
  const trailing = text.match(/\s*((?:\{[^}]*\}|\[[^\]]*\]|\s)+)\s*$/);
  if (!trailing) return '';
  const blocks = trailing[1].match(/\{[^}]*\}|\[[^\]]*\]/g);
  return blocks ? blocks.join(' ') : '';
};

const stripTrailingMpnSeparator = (value) => fmt(value).replace(/\s+@$/, '').trim();

const cleanPreviewMpnPair = (pair = {}, source = '') => {
  const mpn = fmt(pair.mpn);
  const atIndex = mpn.indexOf('@');
  const existingDiscarded = fmt(pair.discarded || pair.metadata?.discardedText || getDiscardedPackedText(source, pair));
  if (atIndex <= 0) {
    return {
      mpn,
      manufacturer: pair.manufacturer,
      discarded: existingDiscarded,
    };
  }

  const cleanMpn = fmt(mpn.slice(0, atIndex)).replace(/\s+$/g, '');
  const suffix = fmt(mpn.slice(atIndex));
  const discardedParts = existingDiscarded.includes(suffix)
    ? [existingDiscarded]
    : [suffix, existingDiscarded].filter(Boolean);

  return {
    mpn: cleanMpn || mpn,
    manufacturer: pair.manufacturer,
    discarded: discardedParts.join(' '),
  };
};

const stripTrailingStatusRefBlocks = (value) => {
  let core = fmt(value).replace(/\u00a0/g, ' ');
  const blocks = [];
  let changed = true;
  while (changed) {
    changed = false;
    core = core.replace(/\s*(\{[^}]*\}|\[[^\]]*\])\s*$/, (_, block) => {
      blocks.unshift(block);
      changed = true;
      return '';
    }).trim();
  }
  return { core, blocks };
};

const popTrailingParenthesizedSegment = (value) => {
  const text = fmt(value);
  if (!text.endsWith(')')) return null;

  let depth = 0;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === ')') depth += 1;
    if (char === '(') {
      depth -= 1;
      if (depth === 0) {
        return {
          before: fmt(text.slice(0, index)),
          inside: fmt(text.slice(index + 1, -1)),
        };
      }
    }
  }

  return null;
};

const buildSinglePairPatternShape = (value, pair = {}) => {
  const { core, blocks } = stripTrailingStatusRefBlocks(value);
  const manufacturerSegment = popTrailingParenthesizedSegment(core);
  if (!manufacturerSegment) return '';

  let mpnSide = manufacturerSegment.before;
  let qualifierCount = 0;
  let slashSuffixQualifier = false;
  let qualifierSegment = popTrailingParenthesizedSegment(mpnSide);
  while (qualifierSegment) {
    if (qualifierCount === 0 && parseSlashSuffixVariantGroup(qualifierSegment.inside).length) {
      slashSuffixQualifier = true;
    }
    qualifierCount += 1;
    mpnSide = qualifierSegment.before;
    qualifierSegment = popTrailingParenthesizedSegment(mpnSide);
  }

  const atSeparator = /\s@$/.test(mpnSide);
  if (atSeparator) mpnSide = stripTrailingMpnSeparator(mpnSide);

  const hasAtVariant = !atSeparator && blocks.length > 0 && mpnSide.includes('@');
  const hasSlashVariant = !qualifierCount && !hasAtVariant && /(?:\s\/\s|\s\/|\/\s)/.test(mpnSide);
  let shape = '<MPN>';
  if (atSeparator) shape += ' @';
  if (hasAtVariant) shape += '@<TEXT>';
  if (slashSuffixQualifier) {
    shape += ' (/<SUFFIX> repeated)';
    if (qualifierCount > 1) shape += ` ${Array.from({ length: qualifierCount - 1 }, () => '(<QUALIFIER>)').join(' ')}`;
  } else if (qualifierCount) {
    shape += ` ${Array.from({ length: qualifierCount }, () => '(<QUALIFIER>)').join(' ')}`;
  }
  if (hasSlashVariant) shape += ' / <TEXT>';
  shape += ' (<MFR>)';

  if (blocks.some((block) => block.startsWith('{'))) shape += ' {<STATUS>}';
  if (blocks.some((block) => block.startsWith('['))) shape += ' [<REF>]';

  return shape.replace(/\s+/g, ' ').trim();
};

const cleanStatusBlockLabel = (block = '') => fmt(block).replace(/^[{[]|[}\]]$/g, '');

const joinAtQualifiedMpn = (value) => {
  const text = fmt(value);
  if (!text.includes('@')) return stripTrailingMpnSeparator(text);
  const atIndex = text.indexOf('@');
  const before = fmt(text.slice(0, atIndex)).replace(/\s+$/g, '');
  const after = fmt(text.slice(atIndex + 1)).replace(/\s+/g, ' ');
  if (!after) return before.trim();
  if (before.endsWith('-') && after.startsWith('-')) return `${before}${after.slice(1)}`.trim();
  return `${before}${after}`.trim();
};

const splitAtQualifiedMpnPieces = (value) => {
  const text = fmt(value);
  const atIndex = text.indexOf('@');
  if (atIndex < 0) {
    return {
      hasAt: false,
      before: text,
      after: '',
      base: stripTrailingMpnSeparator(text),
    };
  }

  const before = fmt(text.slice(0, atIndex)).replace(/\s+$/g, '');
  const after = fmt(text.slice(atIndex + 1)).replace(/\s+/g, ' ');
  return {
    hasAt: true,
    before,
    after,
    base: joinAtQualifiedMpn(text),
  };
};

const qualifierTokensForAtMpn = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  const slashTokens = parseSlashSuffixVariantGroup(text);
  if (slashTokens.length) return slashTokens;
  if (!text || text.includes('/') || /\s/.test(text)) return [];
  return /^[A-Z0-9._-]{1,16}$/i.test(text) ? [text] : [];
};

const insertAtQualifierBeforeText = (afterText, suffixes = []) => {
  const after = fmt(afterText).replace(/\s+/g, '');
  if (!after) return true;
  if (/^\d/.test(after)) return true;
  if (suffixes.length === 1 && /^[A-Z]+$/i.test(after)) return true;
  return false;
};

const combineAtQualifiedMpnVariant = ({ before, after }, suffix) => {
  const cleanBefore = fmt(before).replace(/\s+$/g, '');
  const cleanAfter = fmt(after).replace(/\s+/g, ' ');
  const cleanSuffix = fmt(suffix);
  const suffixBeforeText = insertAtQualifierBeforeText(cleanAfter, [cleanSuffix]);
  if (suffixBeforeText) {
    if (cleanBefore.endsWith('-') && cleanSuffix.startsWith('-')) {
      return `${cleanBefore}${cleanSuffix.slice(1)}${cleanAfter}`.trim();
    }
    return `${cleanBefore}${cleanSuffix}${cleanAfter}`.trim();
  }
  if (cleanBefore.endsWith('-') && cleanAfter.startsWith('-')) {
    return `${cleanBefore}${cleanAfter.slice(1)}${cleanSuffix}`.trim();
  }
  return `${cleanBefore}${cleanAfter}${cleanSuffix}`.trim();
};

const expandAtQualifiedMpnVariants = (mpnSide, qualifierText) => {
  const pieces = splitAtQualifiedMpnPieces(mpnSide);
  const suffixes = qualifierTokensForAtMpn(qualifierText);
  if (!pieces.hasAt || !suffixes.length) return null;

  const startsWithSlash = fmt(qualifierText).trim().startsWith('/');
  const variants = startsWithSlash
    ? [pieces.base, ...suffixes.map((suffix) => `${pieces.base}${suffix}`)]
    : suffixes.map((suffix) => combineAtQualifiedMpnVariant(pieces, suffix));

  const mpns = [...new Set(variants.map((mpn) => fmt(mpn)).filter(Boolean))];
  return mpns.length ? {
    baseMpn: pieces.base,
    suffixes,
    includeBaseMpn: startsWithSlash,
    mpns,
  } : null;
};

const isMpnDescriptorQualifier = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text || text.includes('/')) return false;
  return (
    /\b\d+(?:[.,]\d+)?\s*(?:ML|CL|L|KG|G|MG|MM|CM|M|IN|OZ|V|A|W)\b/i.test(text) ||
    /\b(?:TUBE|BOTTLE|CARTRIDGE|CARTOUCHE|KIT|PACK|BAG|ROLL|REEL|SPOOL)\b/i.test(text)
  );
};

const splitQualifiedMpnSide = (value, hasStatusRefBlocks = false) => {
  let mpnSide = fmt(value);
  const qualifiers = [];
  let qualifierSegment = popTrailingParenthesizedSegment(mpnSide);
  while (qualifierSegment) {
    qualifiers.unshift({
      inside: qualifierSegment.inside,
      text: `(${qualifierSegment.inside})`,
    });
    mpnSide = qualifierSegment.before;
    qualifierSegment = popTrailingParenthesizedSegment(mpnSide);
  }

  const hasAtQualifier = mpnSide.includes('@');
  const baseMpn = joinAtQualifiedMpn(mpnSide);
  if (hasAtQualifier && qualifiers.length) {
    const qualifierText = fmt(qualifiers[0].inside);
    const expansion = expandAtQualifiedMpnVariants(mpnSide, qualifierText);
    if (expansion?.mpns?.length) {
      debugSlashVariantParser('split qualified MPN side', {
        rawMpn: value,
        mpnSide,
        baseMpn: expansion.baseMpn,
        qualifier: qualifierText,
        suffixes: expansion.suffixes,
        includeBaseMpn: expansion.includeBaseMpn,
        mpns: expansion.mpns,
        discarded: qualifiers.slice(1).map((qualifier) => qualifier.text),
      });
      return {
        mpn: expansion.mpns[0],
        mpns: expansion.mpns,
        discarded: qualifiers.slice(1).map((qualifier) => qualifier.text),
      };
    }
  }

  const retainedQualifiers = hasAtQualifier
    ? []
    : qualifiers.filter((qualifier) => isMpnDescriptorQualifier(qualifier.inside));
  const discardedQualifiers = qualifiers.filter((qualifier) => !retainedQualifiers.includes(qualifier));
  const mpnWithDescriptors = [
    baseMpn,
    ...retainedQualifiers.map((qualifier) => qualifier.text),
  ].filter(Boolean).join(' ');

  return {
    mpn: mpnWithDescriptors,
    mpns: [mpnWithDescriptors],
    discarded: discardedQualifiers.map((qualifier) => qualifier.text),
  };
};

const normalizeAtQualifiedParsedPair = (pair = {}, source = '') => {
  const mpn = fmt(pair.mpn);
  const original = fmt(source);
  if (!mpn || !original.includes('@') || mpn.includes('@')) return pair;

  const { core } = stripTrailingStatusRefBlocks(original);
  const manufacturerSegment = popTrailingParenthesizedSegment(core);
  if (!manufacturerSegment) return pair;
  const qualifierSegment = popTrailingParenthesizedSegment(manufacturerSegment.before);
  if (!qualifierSegment || !qualifierSegment.before.includes('@')) return pair;

  const expansion = expandAtQualifiedMpnVariants(qualifierSegment.before, qualifierSegment.inside);
  if (!expansion?.mpns?.length) return pair;

  const normalizedMpn = expansion.mpns.find((candidate) => normalizeKey(candidate) === normalizeKey(mpn)) || expansion.mpns[0];
  return {
    ...pair,
    mpn: normalizedMpn,
  };
};

const cleanSlashVariantBaseMpn = (value) => fmt(value)
  .replace(/\s*@\s*$/g, '')
  .replace(/[,\s]+$/g, '')
  .trim();

const parseSlashSuffixVariantGroup = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text || !text.includes('/')) return [];
  const cleanText = text.trim();
  const parts = cleanText
    .split('/')
    .map((part) => fmt(part).replace(/^[-_]+|[-_]+$/g, ''))
    .filter(Boolean);
  const startsWithSlash = cleanText.startsWith('/');
  if (startsWithSlash ? parts.length < 1 : parts.length < 2) return [];
  if (!startsWithSlash && parts.length !== cleanText.split('/').length) return [];
  if (!parts.every((part) => /^[A-Z0-9._-]{1,16}$/i.test(part) && !/\s/.test(part))) return [];
  return parts;
};

const shouldDebugSlashVariantSource = (value = '') => {
  const text = fmt(value);
  return Boolean(text && text.includes('@') && /\([^)]*\/[^)]*\)/.test(text));
};

const debugSlashVariantParser = (stage, payload = {}) => {
  if (!shouldDebugSlashVariantSource(payload.source || payload.rawMpn || payload.value)) return;
  // Temporary targeted debug for BOM parser QA. Keep this narrow so client data does not flood the console.
  // eslint-disable-next-line no-console
  console.log(`[BOM parser][slash-variant] ${stage}`, payload);
};

const detectSlashSuffixVariantExpansion = (value) => {
  const source = fmt(value).replace(/\u00a0/g, ' ');
  if (!source || !source.includes('@') || !source.includes('/')) return null;

  const { core, blocks } = stripTrailingStatusRefBlocks(source);
  const manufacturerSegment = popTrailingParenthesizedSegment(core);
  if (!manufacturerSegment) return null;

  const manufacturer = fmt(manufacturerSegment.inside);
  if (!manufacturer || !/[A-Za-z]/.test(manufacturer)) return null;

  const variantSegment = popTrailingParenthesizedSegment(manufacturerSegment.before);
  if (!variantSegment) return null;
  if (!variantSegment.before.includes('@')) return null;

  const expansion = expandAtQualifiedMpnVariants(variantSegment.before, variantSegment.inside);
  if (!expansion?.mpns?.length) return null;

  const baseMpn = expansion.baseMpn;
  if (!baseMpn || !/[0-9]/.test(baseMpn)) return null;
  if (!looksLikeMpnToken(baseMpn) && !looksLikeParenthesizedMpn(baseMpn)) return null;

  const uniqueMpns = [...new Set(expansion.mpns.map(stripVendorPrefix).map((mpn) => fmt(mpn)).filter(Boolean))];
  if (uniqueMpns.length < 1) return null;

  debugSlashVariantParser('detected expansion', {
    source,
    baseMpn,
    manufacturer,
    qualifier: variantSegment.inside,
    suffixes: expansion.suffixes,
    mpns: uniqueMpns,
    discarded: blocks,
  });

  return {
    source,
    baseMpn,
    manufacturer,
    suffixes: expansion.suffixes,
    mpns: uniqueMpns,
    pairs: uniqueMpns.map((mpn) => ({
      mpn,
      manufacturer,
      metadata: blocks.length ? { discardedText: blocks.join(' ') } : {},
    })),
  };
};

const buildParsedPatternShape = (value, pairs = []) => {
  const source = fmt(value).replace(/\u00a0/g, ' ');
  if (!source || !pairs.length) return '';

  if (source.includes('^') && pairs.length > 1) {
    return '^<MPN>, <MFR> repeated';
  }

  if (source.includes(':')) {
    const colonIndex = source.indexOf(':');
    const left = fmt(source.slice(0, colonIndex));
    const right = fmt(source.slice(colonIndex + 1));
    const firstPair = pairs[0] || {};
    const mpnKey = fmt(firstPair.mpn).toUpperCase();
    const leftHasMpn = mpnKey && left.toUpperCase().includes(mpnKey);
    const rightHasMpn = mpnKey && right.toUpperCase().includes(mpnKey);
    if (leftHasMpn && !rightHasMpn) return '<MPN>: <MFR>';

    const labelShape = left.includes(',') || /\d/.test(left)
      ? '<MFR + TEXT>'
      : '<MFR>';
    return `${labelShape}: <MPN>${pairs.length > 1 ? ' repeated' : ''}`;
  }

  return buildSinglePairPatternShape(source, pairs[0]);
};

const splitStructuredMpnMfrEntries = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text) return [];

  const entries = [];
  let start = 0;
  let index = 0;

  const skipSpaces = (position) => {
    let cursor = position;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    return cursor;
  };

  while (index < text.length) {
    if (text[index] !== ')') {
      index += 1;
      continue;
    }

    let cursor = skipSpaces(index + 1);
    let consumedMetadataBlock = false;

    while (cursor < text.length && (text[cursor] === '{' || text[cursor] === '[')) {
      const closing = text[cursor] === '{' ? '}' : ']';
      const closeIndex = text.indexOf(closing, cursor + 1);
      if (closeIndex === -1) break;
      consumedMetadataBlock = true;
      cursor = skipSpaces(closeIndex + 1);
    }

    if (consumedMetadataBlock || cursor >= text.length) {
      const entry = fmt(text.slice(start, cursor));
      if (entry) entries.push(entry);
      start = cursor;
      index = cursor;
      continue;
    }

    index += 1;
  }

  const tail = fmt(text.slice(start));
  if (tail && !entries.includes(tail)) entries.push(tail);
  return entries.length > 1 ? entries : [];
};

const describePatternShape = (shape = '') => {
  const rules = ['Extract every <MPN> and <MFR> pair from values matching this shape.'];
  if (shape.includes(' @')) rules.push('Ignore @ as a separator before reading the manufacturer bracket.');
  if (shape.includes('@<TEXT>')) rules.push('Treat text after @ as ignored package/variant text.');
  if (shape.includes('/<SUFFIX>')) rules.push('Slash suffix variants can be expanded into primary plus alternate MPNs when selected.');
  if (shape.includes('<QUALIFIER>')) rules.push('Treat qualifier brackets before the manufacturer as ignored package/variant text.');
  if (shape.includes('^')) rules.push('Treat ^ as a repeated alternate separator.');
  if (shape.includes('<MFR>') && shape.includes(': <MPN>')) rules.push('Read text before : as Manufacturer and text after : as MPN.');
  if (shape.includes(',')) rules.push('Use comma-separated segments only when they form valid MPN/MFR pairs.');
  if (shape.includes('/ <TEXT>')) rules.push('Keep slash-separated material text on the MPN side.');
  if (shape.includes('(<MFR>)')) rules.push('Use text inside (...) as Manufacturer.');
  if (shape.includes('{<STATUS>}') || shape.includes('[<REF>]')) rules.push('Treat {...} and [...] blocks as status/reference text.');
  return rules;
};

const scoreStructuredMpnMfrColumn = (header, values) => {
  const samples = roleSampleValues(values);
  if (!samples.length || looksLikeHierarchyColumn(samples)) return 0;
  const parsed = samples.map(parseStructuredMpnMfrValue).filter(Boolean);
  if (parsed.length < 2) return 0;
  const key = normalizeKey(header);
  const headerBonus = /(manufacturer|mfr|mfg|fabricant|fab|approved|source|ref)/.test(key) ? 25 : 0;
  return (parsed.length / samples.length) * 100 + headerBonus;
};

const MFR_HEADER_PATTERNS = [
  /^mfr$/,
  /^mfg$/,
  /^mfgr$/,
  /^manufacturer$/,
  /^manufacturers$/,
  /manufacturer name/,
  /\bmfr name\b/,
  /\bmfg name\b/,
  /\bmaker\b/,
  /\bbrand\b/,
  /\bfabricant\b/,
  /\bfab\b/,
  /\bsupplier\b/,
  /\bvendor\b/,
  /\bsource\b/,
  /suggested.*mfr/,
  /corrected.*mfr/,
];

const MFR_HEADER_EXCLUDES = [/equivalent/, /part/, /\bmpn\b/, /\bpn\b/];

const isPlausibleManufacturerPhrase = (value) => {
  const text = fmt(value);
  if (text.length < 2 || text.length > 80) return false;
  const compact = text.replace(/[^A-Za-z0-9]/g, '');
  if (compact.length < 2) return false;
  const digitCount = (compact.match(/\d/g) || []).length;
  const letterCount = (compact.match(/[A-Za-z]/g) || []).length;
  if (!letterCount) return false;
  if (digitCount / compact.length > 0.45 && !/\b(3m|2j)\b/i.test(text)) return false;
  if (looksLikePartCodeValue(text) && !/\b(inc|corp|corporation|co|ltd|llc|gmbh|ag|electronics|semi|semiconductor|technologies|components)\b/i.test(text)) return false;
  return true;
};

const buildManufacturerPhraseLookup = (directory = {}) => {
  const aliases = directory.aliases || {};
  const phrases = [
    ...Object.keys(aliases),
    ...Object.values(aliases),
    ...(Array.isArray(directory.names) ? directory.names : []),
    ...KNOWN_MANUFACTURERS,
  ];
  const lookup = new Set();
  phrases.forEach((phrase) => {
    if (!isPlausibleManufacturerPhrase(phrase)) return;
    const key = normalizeKey(phrase).toUpperCase();
    if (key) lookup.add(key);
  });
  return lookup;
};

const manufacturerFragments = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  const fragments = [text];
  text.replace(/\(([^)]+)\)/g, (_, inner) => {
    fragments.push(inner);
    return '';
  });
  text.split(/[;,|/]+/).forEach((part) => fragments.push(part));
  return fragments
    .map((part) => fmt(part).replace(/^[()[\]{}]+|[()[\]{}]+$/g, ''))
    .filter(Boolean);
};

const matchesManufacturerPhrase = (value, lookup, lookupList = null) => {
  if (!lookup?.size) return false;
  const phrases = lookupList || [...lookup];
  return manufacturerFragments(value).some((fragment) => {
    if (!isPlausibleManufacturerPhrase(fragment)) return false;
    const key = normalizeKey(fragment).toUpperCase();
    if (!key) return false;
    if (lookup.has(key)) return true;
    if (key.length < 4) return false;
    return phrases.some((phrase) => phrase.length >= 4 && (key.includes(phrase) || phrase.includes(key)));
  });
};

const scoreManufacturerDirectoryColumn = (header, values, directory = {}, phraseLookup = null) => {
  if (looksLikeDocumentHeader(header) || looksLikeHierarchyColumn(values)) return 0;
  const samples = roleSampleValues(values);
  if (!samples.length) return 0;
  const key = normalizeKey(header);
  const lookup = phraseLookup || buildManufacturerPhraseLookup(directory);
  const lookupList = [...lookup];
  const matchRate = lookup.size
    ? samples.filter((value) => matchesManufacturerPhrase(value, lookup, lookupList)).length / samples.length
    : 0;
  let score = matchRate * 100;
  if (MFR_HEADER_PATTERNS.some((pattern) => pattern.test(key)) &&
      !MFR_HEADER_EXCLUDES.some((pattern) => pattern.test(key))) {
    score += 65;
  } else if (/(manufacturer|mfr|mfg|mfgr|fabricant|maker|brand|supplier|vendor)/.test(key) &&
      !/(part|mpn|pn|equivalent)/.test(key)) {
    score += 45;
  }
  if (/(mpn|part number|part no|ref article|article ref|item code|cpn|customer part)/.test(key)) score -= 50;
  if (samples.filter(looksLikePartCodeValue).length / samples.length > 0.65 && matchRate < 0.35) score -= 40;
  return Math.max(0, score);
};

const looksLikePartCodeValue = (value) => {
  const text = fmt(value);
  if (!text || text.includes('>')) return false;
  if (looksLikeDocumentHeader(text)) return false;
  const compact = text.replace(/[^A-Za-z0-9]/g, '');
  return compact.length >= 4 && /[0-9]/.test(compact) && /^[A-Za-z0-9._/#,+:\-\s]+$/.test(text);
};

const scoreCpnColumn = (header, values) => {
  if (looksLikeDocumentHeader(header) || looksLikeHierarchyColumn(values)) return 0;
  const samples = roleSampleValues(values);
  if (!samples.length) return 0;
  const key = normalizeKey(header);
  let score = 0;
  if (/\b(cpn|customer part|client part|internal part|part code|item code)\b/.test(key)) score += 70;
  if (/\b(ref article|article|article ref|reference article)\b/.test(key)) score += 65;
  if (/\b(part number|part no|part)\b/.test(key) && !/(manufacturer|mfr|mfg|fabricant)/.test(key)) score += 45;
  const partLike = samples.filter(looksLikePartCodeValue).length / samples.length;
  score += partLike * 35;
  if (score && /(manufacturer|mfr|mfg|fabricant|supplier|vendor)/.test(key)) score -= 60;
  return Math.max(0, score);
};

const bestScoredHeader = (headers, dataRows, scorer, minScore = 1) => {
  const ranked = headers
    .map((header) => ({
      header,
      score: scorer(header, columnValues(header, headers, dataRows)),
    }))
    .filter((candidate) => candidate.score >= minScore)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.header || '';
};

const inferRoles = (headers, dataRows = [], options = {}) => {
  const learnedHeaders = getLearnedRoleHeaders();
  const manufacturerDirectory = options.manufacturerDirectory || {};
  const manufacturerPhraseLookup = buildManufacturerPhraseLookup(manufacturerDirectory);
  const findLearnedHeader = (role) => {
    const learned = Array.isArray(learnedHeaders[role]) ? learnedHeaders[role] : [];
    const learnedKeys = learned.map(normalizeKey);
    return headers.find((header) => learnedKeys.includes(normalizeKey(header))) || '';
  };
  const findHeader = (patterns, excludePatterns = []) => headers.find((header) => {
    const normalized = normalizeKey(header);
    return patterns.some((pattern) => pattern.test(normalized)) &&
      !excludePatterns.some((pattern) => pattern.test(normalized));
  }) || '';
  const exactMpnHeader = findHeader([
    /^mpn$/,
    /^mfg\s*part$/,
    /^mfr\s*part$/,
    /^manufacturer\s*part(?:\s*number)?$/,
    /^manufacturer\s*pn$/,
    /^part\s*number$/,
    /^part\s*no$/,
  ]);
  const strongMpnHeader = findHeader([
    /^approved\s*manufacturer$/,
    /\bmpn\b/,
    /manufacturer equivalent/,
    /manufacturer part/,
    /manufacturing part/,
    /\bmfr part/,
    /\bmfg part/,
    /producer/,
    /^po\s*text$/,
    /^potext$/,
  ]);
  const genericPartHeader = findHeader([/^part number$/, /^part no$/, /^part$/, /^partno$/], [/manufacturer/, /\bmpn\b/, /\bmfr\b/, /\bmfg\b/]);
  const learnedMpn = findLearnedHeader('mpn');
  const learnedCpn = findLearnedHeader('cpn');
  const structuredMpnMfrHeader = bestScoredHeader(headers, dataRows, scoreStructuredMpnMfrColumn, 70);
  const scoredCpnHeader = bestScoredHeader(headers, dataRows, scoreCpnColumn, 65);
  const mpnHeader = exactMpnHeader || learnedMpn || strongMpnHeader || structuredMpnMfrHeader ||
    findHeader([/^approved\s*manufacturer$/, /manufacturer equivalent/, /manufacturer part/, /\bmpn\b/, /producer/, /^po\s*text$/, /^potext$/, /part number/]);
  const cpnHeader = scoredCpnHeader || learnedCpn || findHeader([/\bcpn\b/, /customer part/, /client part/, /internal part/, /part code/, /ref article/, /\barticle\b/]) ||
    (genericPartHeader && genericPartHeader !== mpnHeader ? genericPartHeader : '');

  // A header the user has taught us wins outright. Otherwise a name match still has to
  // survive the values: see looksLikeCodeColumn.
  const namedManufacturer = findHeader(MFR_HEADER_PATTERNS, MFR_HEADER_EXCLUDES) ||
    findHeader([/manufacturer/, /\bmfr\b/, /\bmfg\b/, /\bmfgr\b/, /fabricant/, /maker/, /brand/, /supplier/, /vendor/], [/equivalent/, /part/, /\bmpn\b/, /\bpn\b/]);
  const learnedManufacturer = findLearnedHeader('manufacturer');
  const scoredManufacturerHeader = bestScoredHeader(
    headers.filter((header) => header !== mpnHeader && header !== cpnHeader),
    dataRows,
    (header, values) => scoreManufacturerDirectoryColumn(header, values, manufacturerDirectory, manufacturerPhraseLookup),
    70
  );
  const learnedManufacturerSafe = learnedManufacturer &&
    learnedManufacturer !== mpnHeader &&
    learnedManufacturer !== cpnHeader &&
    hasUsefulRoleValues(columnValues(learnedManufacturer, headers, dataRows)) &&
    !looksLikeCodeColumn(columnValues(learnedManufacturer, headers, dataRows))
    ? learnedManufacturer
    : '';
  const namedManufacturerSafe = namedManufacturer &&
    namedManufacturer !== mpnHeader &&
    namedManufacturer !== cpnHeader &&
    hasUsefulRoleValues(columnValues(namedManufacturer, headers, dataRows)) &&
    !looksLikeCodeColumn(columnValues(namedManufacturer, headers, dataRows))
    ? namedManufacturer
    : '';
  const manufacturerHeader = namedManufacturerSafe || learnedManufacturerSafe || scoredManufacturerHeader ||
    (structuredMpnMfrHeader && structuredMpnMfrHeader === mpnHeader ? structuredMpnMfrHeader : '');
  const internalNotesHeader = findLearnedHeader('internalNotes') || findHeader([
    /^internal\s+notes?$/,
    /^internal\s+remarks?$/,
    /^internal\s+comments?$/,
    /^private\s+notes?$/,
    /^engineering\s+notes?$/,
  ]);
  const notesHeader = findLearnedHeader('notes') || findHeader([
    /^notes?$/,
    /^remarks?$/,
    /^comments?$/,
    /^comment$/,
    /customer\s+notes?/,
    /bom\s+notes?/,
  ], [/internal/, /private/]);
  const followingMfgPartsLayout = detectFollowingRowMfgPartsLayout(headers, dataRows.slice(0, 120), {
    description: findLearnedHeader('description') || findHeader([/description/, /item name/, /\bname\b/]),
  });

  return {
    cpn: cpnHeader,
    mpn: followingMfgPartsLayout ? followingMfgPartsLayout.mfgPartsHeader : mpnHeader,
    manufacturer: followingMfgPartsLayout ? followingMfgPartsLayout.mfgPartsHeader : manufacturerHeader,
    description: findLearnedHeader('description') || findHeader([/description/, /item name/, /\bname\b/]),
    quantity: findLearnedHeader('quantity') || findHeader([/quantity/, /\bqty\b/, /\bqnty\b/, /^count$/, /\bcount\b/]),
    uom: findLearnedHeader('uom') || findHeader([/\buom\b/, /measurement unit/, /\bunit\b/]),
    notes: notesHeader,
    internalNotes: internalNotesHeader,
    level: headers.find((header) => normalizeKey(header).startsWith(normalizeKey(EXCEL_OUTLINE_LEVEL_HEADER)))
      || (findLearnedHeader('level') || findHeader([/\blevel\b/])),
    // `parent` must not match this app's OWN `parentKey` column. That is the
    // grouping key for a part and its alternates — `${parent}␟${identity}` —
    // not a BOM parent, and a bare /parent/ matches it. Re-running on a
    // normalized or merged sheet then adopted it as the hierarchy parent, so
    // every assembly came back named "0043-13591␟0043-13591". Same conflation
    // the note above parentKeyFor warns about, arriving through auto-detection
    // instead of through a user's mapping.
    parent: findLearnedHeader('parent')
      || findHeader([/parent(?!\s*key)/, /finished good/, /bom id/, /item code/, /assembly/]),
  };
};

const looksLikeMpnToken = (value) => {
  const token = fmt(value).replace(/[;,|]+$/g, '');
  const compact = token.replace(/[^A-Za-z0-9]/g, '');
  if (compact.length < 3) return false;
  if (!/[0-9]/.test(compact)) return false;
  if (MPN_NOISE_RE.test(token)) return false;
  return /^[A-Za-z0-9._/#,+-]+(?:\s+[A-Za-z0-9._/#,+-]+){0,3}$/.test(token);
};

const isConnectorOnlyMpnPart = (value) => {
  const compact = fmt(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[()[\]{}.,;:|/\\_+-]+/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  return !compact || MPN_CONNECTOR_WORDS.has(compact);
};

const CIRCLED_NUMBER_RE = /[\u2460-\u2473]/g;

const circledNumberIndex = (marker) => {
  const code = String(marker || '').codePointAt(0);
  return Number.isFinite(code) && code >= 0x2460 && code <= 0x2473 ? code - 0x245f : 0;
};

const stripCircledNumberMarkers = (value) => fmt(value)
  .replace(/\u00a0/g, ' ')
  .replace(CIRCLED_NUMBER_RE, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const parseCircledNumberSegments = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  CIRCLED_NUMBER_RE.lastIndex = 0;
  if (!CIRCLED_NUMBER_RE.test(text)) {
    CIRCLED_NUMBER_RE.lastIndex = 0;
    return [];
  }
  CIRCLED_NUMBER_RE.lastIndex = 0;

  const markers = [];
  let match = CIRCLED_NUMBER_RE.exec(text);
  while (match) {
    markers.push({
      marker: match[0],
      number: circledNumberIndex(match[0]),
      start: match.index,
      valueStart: match.index + match[0].length,
    });
    match = CIRCLED_NUMBER_RE.exec(text);
  }

  const segments = [];
  markers.forEach((marker, index) => {
    const next = markers[index + 1];
    const rawValue = text.slice(marker.valueStart, next ? next.start : text.length);
    const segmentValue = stripCircledNumberMarkers(rawValue);
    if (segmentValue) {
      segments.push({
        marker: marker.marker,
        number: marker.number,
        value: segmentValue,
      });
    }
  });

  return segments;
};

const deletedCircledNumbersFromRemarks = (remarks) => {
  const text = fmt(remarks).replace(/\u00a0/g, ' ');
  if (!text) return new Set();
  const deleted = new Set();
  CIRCLED_NUMBER_RE.lastIndex = 0;
  let match = CIRCLED_NUMBER_RE.exec(text);
  while (match) {
    const markerNumber = circledNumberIndex(match[0]);
    const context = text.slice(Math.max(0, match.index - 18), Math.min(text.length, match.index + 18));
    if (/(?:delete(?:d)?|remove(?:d)?|\u524a\u9664)/i.test(context)) {
      deleted.add(markerNumber);
    }
    match = CIRCLED_NUMBER_RE.exec(text);
  }
  CIRCLED_NUMBER_RE.lastIndex = 0;
  return deleted;
};

const nonEmptyTextLines = (value) => fmt(value)
  .replace(/\u00a0/g, ' ')
  .split(/\r?\n+/)
  .map(fmt)
  .filter(Boolean);

const hasLeadingTextBeforeFirstCircledNumber = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  CIRCLED_NUMBER_RE.lastIndex = 0;
  const match = CIRCLED_NUMBER_RE.exec(text);
  CIRCLED_NUMBER_RE.lastIndex = 0;
  return Boolean(match && stripCircledNumberMarkers(text.slice(0, match.index)));
};

const removeLeadingUnnumberedLineWhenCompanionIsNumbered = (value, companionValue) => {
  if (parseCircledNumberSegments(value).length) return fmt(value);
  const companionSegments = parseCircledNumberSegments(companionValue);
  if (!companionSegments.length || !hasLeadingTextBeforeFirstCircledNumber(companionValue)) return fmt(value);

  const lines = nonEmptyTextLines(value);
  if (lines.length !== companionSegments.length + 1) return fmt(value);
  return lines.slice(1).join('\n');
};

const removeDeletedCircledSegments = (value, remarks) => {
  const segments = parseCircledNumberSegments(value);
  const deletedNumbers = deletedCircledNumbersFromRemarks(remarks);
  if (!segments.length) {
    if (!deletedNumbers.size) return fmt(value);
    const lines = nonEmptyTextLines(value);
    if (lines.length <= 1) return fmt(value);
    const keptLines = lines.filter((_, index) => !deletedNumbers.has(index + 1));
    return keptLines.length ? keptLines.join('\n') : '';
  }
  const keptSegments = segments
    .filter((segment) => !deletedNumbers.has(segment.number));
  if (!keptSegments.length) return '';
  return keptSegments.map((segment) => `${segment.marker || ''}${segment.value}`).join('\n');
};

const normalizeMpnParts = (parts) => parts
  .map(stripVendorPrefix)
  .map((part) => fmt(part).replace(/^(?:and|or|and\/or)\s+/i, '').replace(/\s+(?:and|or|and\/or)$/i, '').trim())
  .filter((part) => part && !isConnectorOnlyMpnPart(part));

const splitTopLevelDelimited = (value, delimiters = [';', '|', '\n', ',']) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text) return [];
  const delimiterSet = new Set(delimiters);
  const matchingClose = {
    '(': ')',
    '[': ']',
    '{': '}',
  };
  const openingForClose = {
    ')': '(',
    ']': '[',
    '}': '{',
  };
  const parts = [];
  let current = '';
  const stack = [];
  let quote = '';

  const pushCurrent = () => {
    const cleaned = fmt(current).replace(/^[,;|]+|[,;|]+$/g, '');
    if (cleaned) parts.push(cleaned);
    current = '';
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (matchingClose[char]) {
      const hasMatchingClose = text.indexOf(matchingClose[char], index + 1) !== -1;
      if (hasMatchingClose) stack.push(char);
      current += char;
      continue;
    }

    if (openingForClose[char]) {
      if (stack[stack.length - 1] === openingForClose[char]) {
        stack.pop();
      }
      current += char;
      continue;
    }

    if (stack.length === 0 && delimiterSet.has(char)) {
      if (char === ',') {
        const next = text.slice(index + 1).trim().split(/[;,|\n]/)[0];
        if (!next || /^\d{1,4}(\s|$)/.test(next)) {
          current += char;
          continue;
        }
      }
      pushCurrent();
      continue;
    }

    current += char;
  }

  pushCurrent();
  return parts;
};

const splitDelimited = (value) => {
  return splitTopLevelDelimited(value);
};

const selectedDelimiter = (config = {}) => {
  if (!config || config.delimiterMode === 'auto') return '';
  if (config.delimiterMode === 'custom') return fmt(config.customDelimiter);
  if (config.delimiterMode === '\\n') return '\n';
  return fmt(config.delimiterMode);
};

const splitByExplicitDelimiter = (value, delimiter) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text || !delimiter || !text.includes(delimiter)) return [];
  return splitTopLevelDelimited(text, [delimiter]);
};

const splitSpacedSlashManufacturerParts = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text || !/\s\/\s/.test(text)) return [];
  return text
    .split(/\s+\/\s+/)
    .map(fmt)
    .filter(Boolean);
};

const stripVendorPrefix = (value) => {
  const text = stripCircledNumberMarkers(value).replace(/\s+/g, ' ');
  return text
    .replace(/^(?:[A-Za-z]{5,}|\d{5})\s*(?:-\s*|\s+)/, '')
    .replace(/^AGILE\s*(?:-\s*|:\s*|\s+)/i, '')
    .trim();
};

const splitMpnCell = (value, config = {}) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text) return [];

  const circledSegments = parseCircledNumberSegments(text);
  if (circledSegments.length > 1) {
    return normalizeMpnParts(circledSegments.map((segment) => segment.value));
  }
  if (circledSegments.length === 1) {
    return normalizeMpnParts([circledSegments[0].value]);
  }

  const delimiter = selectedDelimiter(config);
  const explicitParts = splitByExplicitDelimiter(text, delimiter);
  if (explicitParts.length > 1) {
    return normalizeMpnParts(explicitParts);
  }

  const connectorParts = text.split(/\s+(?:and\/or|and|or)\s+/i);
  if (connectorParts.length > 1 && connectorParts.filter((part) => /\d/.test(part)).length >= 2) {
    return normalizeMpnParts(connectorParts);
  }

  const prefixPattern = '(?:AGILE|[A-Za-z]{5,}|\\d{5})';
  const starts = [];
  const regex = new RegExp(`(?=(?:^|\\s)${prefixPattern}\\s*(?:-| )\\s*)`, 'gi');
  let match = regex.exec(text);
  while (match) {
    let start = match.index;
    if (text[start] === ' ') start += 1;
    starts.push(start);
    regex.lastIndex = match.index + 1;
    match = regex.exec(text);
  }

  if (starts.length > 1) {
    return normalizeMpnParts([...new Set(starts)].sort((a, b) => a - b).map((start, index, sorted) => {
      const end = sorted[index + 1] || text.length;
      return text.slice(start, end);
    }));
  }

  const delimited = splitDelimited(text);
  if (delimited.length > 1 && delimited.every(looksLikeMpnToken)) {
    return normalizeMpnParts(delimited);
  }

  // Nothing split, so the whole cell is the candidate. Only keep it if it could be a
  // part number at all: a cell with no digit anywhere is a plant code, a site name or
  // a note, not an MPN. THALES exports put "ETA BDX" and "CCI VEN" in the manufacturer
  // column on document and internal-assembly rows, and returning those unchecked filled
  // the MPN column with site codes. Returning [] lets the caller record a blank MPN and
  // keep the text in discardedText.
  // Deliberately NOT gated on looksLikeMpnToken: that also caps length at four tokens
  // and bans ':' and '()', which would drop real parts like
  // "DOWSIL RTV 3140 TUBE 90 ML" and "114-RX8900SA:UB0PURESNCT-ND".
  if (!/[0-9]/.test(text)) return [];

  return normalizeMpnParts([text]);
};

const cleanMpnSegment = (value) => {
  const parts = splitDelimited(value);
  const candidates = parts.length ? parts : [fmt(value)];
  return candidates.flatMap((part) => {
    const kept = [];
    const tokens = fmt(part).split(/\s+/);
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (MPN_NOISE_RE.test(token) || /[%()[\]{}=*"]/g.test(token)) break;
      kept.push(token);
    }
    const cleaned = normalizeMpnParts([kept.join(' ')]);
    return cleaned;
  });
};

const parseColonSegments = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text.includes(':')) return [];

  const labelRegex = /(?:^|\s)([A-Za-z][A-Za-z0-9&+.,'/-]*(?:\s+[A-Za-z][A-Za-z0-9&+.,'/-]*){0,4})\s*:\s*/g;
  const labels = [];
  let match = labelRegex.exec(text);
  while (match) {
    labels.push({
      label: fmt(match[1]),
      valueStart: labelRegex.lastIndex,
      matchStart: match.index,
    });
    match = labelRegex.exec(text);
  }

  return labels.map((label, index) => {
    const next = labels[index + 1];
    const rawValue = text.slice(label.valueStart, next ? next.matchStart : text.length).trim();
    return {
      label: label.label,
      rawValue,
      mpns: cleanMpnSegment(rawValue),
    };
  }).filter((segment) => segment.label || segment.rawValue);
};

const extractPackedMetadata = (value) => {
  const metadata = {};
  const text = fmt(value).replace(/\(([^()=]+)=([^()]*)\)/g, (_, key, rawValue) => {
    const cleanKey = fmt(key);
    if (cleanKey) metadata[cleanKey] = fmt(rawValue);
    return ' ';
  });
  return {
    text: fmt(text).replace(/\s+/g, ' '),
    metadata,
  };
};

const decodeBasicHtmlEntities = (value) => fmt(value)
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&nbsp;/gi, ' ');

const cleanCaretManufacturer = (value) => decodeBasicHtmlEntities(value)
  .replace(/\([^()]*\)/g, ' ')
  .replace(/\b(?:discontinued|disc(?:ontinued)?|dis)\s+by\s+m(?:fg|fr|fgr|ft|anufacturer)\.?\b/ig, ' ')
  .replace(/\bdiscontinued\b/ig, ' ')
  .replace(/\binactive\b/ig, ' ')
  .replace(/\buse\s+up(?:\s+stock)?\b/ig, ' ')
  .replace(/\bdo\s+not\s+reorder\b/ig, ' ')
  .replace(/\bpurchase\s+on\s+spools?\b/ig, ' ')
  .replace(/\bsee\s+note\s+above\b/ig, ' ')
  .replace(/\bnew\s+rev\s+next\s+buy\b/ig, ' ')
  .replace(/\bstd\s+pkg\s+\d[\d,]*\b/ig, ' ')
  .replace(/\bnote\s*:[^,;^]*$/ig, ' ')
  .replace(/[@*]+/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/^[,;:\s]+|[,;:\s]+$/g, '')
  .trim();

const cleanCaretMpn = (value) => decodeBasicHtmlEntities(value)
  .replace(/\((?:[^()]*(?:bulk|pkg|package|pack|purchase|spool|discontinued|inactive|note)[^()]*)\)/ig, ' ')
  .replace(/[@*]+$/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const COLON_MFR_NOTE_LABEL_RE = /^(?:alt(?:ernate|ernative)?|alternatively|obsolete|obsoleted|preferred|preferable|otherwise)$/i;

const KNOWN_COLON_MANUFACTURERS = [...KNOWN_MANUFACTURERS]
  .map((name) => fmt(name))
  .filter(Boolean)
  .sort((left, right) => right.length - left.length);

const cleanColonManufacturerLabel = (value) => {
  const label = decodeBasicHtmlEntities(value)
    .replace(/\s+/g, ' ')
    .replace(/^[,;:\s]+|[,;:\s]+$/g, '')
    .trim();
  if (!label) return { manufacturer: '', discardedText: '' };

  const labelKey = normalizeKey(label).toUpperCase();
  const knownPrefix = KNOWN_COLON_MANUFACTURERS.find((manufacturer) => {
    const manufacturerKey = normalizeKey(manufacturer).toUpperCase();
    return labelKey === manufacturerKey || labelKey.startsWith(`${manufacturerKey} `);
  });
  if (!knownPrefix || normalizeKey(label).toUpperCase() === normalizeKey(knownPrefix).toUpperCase()) {
    return { manufacturer: label, discardedText: '' };
  }

  const prefixTokens = normalizeKey(knownPrefix).split(/\s+/).filter(Boolean);
  const labelTokens = label.split(/\s+/).filter(Boolean);
  const discardedText = labelTokens.slice(prefixTokens.length).join(' ').replace(/^[,;:\s]+/, '').trim();
  return {
    manufacturer: knownPrefix,
    discardedText,
  };
};

const cleanColonMpnCandidate = (value) => {
  const kept = [];
  const tokens = fmt(value).split(/\s+/);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (MPN_NOISE_RE.test(token) || /[%()[\]{}=*"]/g.test(token)) break;
    kept.push(token);
  }
  return normalizeMpnParts([kept.join(' ')]);
};

const mpnsFromColonManufacturerValue = (value) => {
  let text = decodeBasicHtmlEntities(value).replace(/\u00a0/g, ' ').trim();
  if (!text) return [];

  const noteMatch = text.match(/\s+(?:obsolete|obsoleted|alt(?:ernate|ernative)?|alternatively)\s*:\s*/i);
  if (noteMatch) text = text.slice(0, noteMatch.index);

  if (text.includes(':')) {
    text = text.slice(text.lastIndexOf(':') + 1).trim();
  }

  const connectorParts = text.split(/\s+(?:and\/or|and|or)\s+/i);
  const candidates = connectorParts.length > 1 && connectorParts.filter((part) => /\d/.test(part)).length >= 2
    ? connectorParts.flatMap(cleanColonMpnCandidate)
    : cleanColonMpnCandidate(text);

  return normalizeMpnParts(candidates)
    .filter((mpn) => (
      looksLikeMpnToken(mpn) ||
      looksLikeParenthesizedMpn(mpn) ||
      looksLikeManufacturerPartsMpn(mpn)
    ));
};

const knownManufacturerKeySet = new Set(KNOWN_COLON_MANUFACTURERS.map((name) => normalizeKey(name).toUpperCase()));

const looksLikeColonMpnSide = (value) => {
  const text = fmt(value);
  if (!text || knownManufacturerKeySet.has(normalizeKey(text).toUpperCase())) return false;
  return looksLikeMpnToken(text) || looksLikeParenthesizedMpn(text) || looksLikeManufacturerPartsMpn(text);
};

const cleanColonManufacturerValue = (value) => {
  const { text } = extractPackedMetadata(value);
  return cleanCaretManufacturer(text)
    .replace(/^[,;:\s]+|[,;:\s]+$/g, '')
    .trim();
};

const parseColonManufacturerMpnPart = (value, config = {}) => {
  const text = decodeBasicHtmlEntities(value).replace(/\u00a0/g, ' ').trim();
  const colonIndex = text.indexOf(':');
  if (colonIndex <= 0) return [];

  const rawLeft = fmt(text.slice(0, colonIndex));
  const rawValue = fmt(text.slice(colonIndex + 1));
  if (looksLikeColonMpnSide(rawLeft)) {
    const manufacturer = cleanColonManufacturerValue(rawValue);
    if (manufacturer && /[A-Za-z]/.test(manufacturer)) {
      return [{
        mpn: stripVendorPrefix(rawLeft),
        manufacturer,
        metadata: {},
      }];
    }
  }

  const { manufacturer: label, discardedText: labelDiscardedText } = cleanColonManufacturerLabel(rawLeft);
  if (!label || !rawValue) return [];

  if (COLON_MFR_NOTE_LABEL_RE.test(label)) {
    return parseColonManufacturerMpnPairs(rawValue, config);
  }

  const pairs = mpnsFromColonManufacturerValue(rawValue).map((mpn) => ({
    mpn: stripVendorPrefix(mpn),
    manufacturer: label,
    metadata: labelDiscardedText ? { discardedText: labelDiscardedText } : {},
  }));

  const noteMatch = rawValue.match(/\s+(?:obsolete|obsoleted|alt(?:ernate|ernative)?|alternatively)\s*:\s*(.+)$/i);
  if (noteMatch) {
    pairs.push(...parseColonManufacturerMpnPairs(noteMatch[1], config));
  }

  return pairs;
};

function parseColonManufacturerMpnPairs(value, config = {}) {
  const text = decodeBasicHtmlEntities(value).replace(/\u00a0/g, ' ');
  if (!text || !text.includes(':')) return [];

  const delimiter = selectedDelimiter(config);
  const repeatedParts = splitTopLevelDelimited(text, [';', '|', '\n']);
  const explicitParts = repeatedParts.length > 1 || delimiter === ','
    ? []
    : splitByExplicitDelimiter(text, delimiter);
  const parts = repeatedParts.length > 1 ? repeatedParts : explicitParts;
  const candidates = parts.length ? parts : [text];
  const parsed = candidates.flatMap((part) => parseColonManufacturerMpnPart(part, config));

  return parsed.filter((pair) => pair?.mpn && pair?.manufacturer);
}

const findTopLevelCommaIndex = (value) => {
  const text = fmt(value);
  const matchingClose = { '(': ')', '[': ']', '{': '}' };
  const openingForClose = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  let quote = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (matchingClose[char]) {
      stack.push(char);
      continue;
    }
    if (openingForClose[char]) {
      if (stack[stack.length - 1] === openingForClose[char]) stack.pop();
      continue;
    }
    if (char === ',' && stack.length === 0) return index;
  }

  return -1;
};

const parseCaretMpnManufacturerPairs = (value) => {
  const text = decodeBasicHtmlEntities(value).replace(/\u00a0/g, ' ');
  if (!text || !text.includes('^')) return [];

  const hasMaterialDescription = /\bmaterial\s*description\b/i.test(text);
  const hasApprovedManufacturer = /\bapproved\s*manufacturer\b/i.test(text);
  const segments = text
    .split('^')
    .map((part) => fmt(part).replace(/^(\*+\s*)+/, '').trim());
  const firstSupplierIndex = hasMaterialDescription
    ? segments.findIndex((part, index) => (
      index > 0 &&
      (/^[-*\s@]*$/.test(part) || /\bapproved\s*manufacturer\b/i.test(part))
    ))
    : -1;
  if (hasMaterialDescription && !hasApprovedManufacturer && firstSupplierIndex === -1) return [];

  const parsed = text
    .split('^')
    .map((part) => fmt(part).replace(/^(\*+\s*)+/, '').trim())
    .slice(firstSupplierIndex >= 0 ? firstSupplierIndex + 1 : 0)
    .map((part) => {
      const commaIndex = findTopLevelCommaIndex(part);
      if (commaIndex <= 0) return null;

      const rawMpn = cleanCaretMpn(part.slice(0, commaIndex).replace(/^(\*+\s*)+/, ''));
      const manufacturer = cleanCaretManufacturer(part.slice(commaIndex + 1));
      const validationMpn = rawMpn.replace(/\([^()]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim();
      if (!rawMpn || !manufacturer || (!looksLikeMpnToken(rawMpn) && !looksLikeMpnToken(validationMpn))) return null;

      return {
        mpn: stripVendorPrefix(rawMpn),
        manufacturer,
        metadata: {},
      };
    })
    .filter(Boolean);

  return parsed.length ? parsed : [];
};

// looksLikeMpnToken caps an MPN at four whitespace-separated tokens, which is right when
// we are guessing whether a bare string is a part number. Inside "PART (MANUFACTURER)"
// the brackets have already proved the shape, so that cap only does harm: THALES ships
// "FZ ISO7046-2 M2-5 A2-70 PASSIVE (ALCOA)" (five tokens) and
// "DOWSIL RTV 3140 TUBE 90 ML (DOW-CHEM)" (six). Both were rejected, and because the
// caller required every entry in a cell to parse, one long part discarded all of its
// alternates too. Here we only need to rule out prose and empty text.
const looksLikeParenthesizedMpn = (value) => {
  const token = fmt(value);
  const compact = token.replace(/[^A-Za-z0-9]/g, '');
  if (compact.length < 3) return false;
  if (!/[0-9]/.test(compact)) return false;
  return true;
};

const parseParenthesizedMpnManufacturerPairs = (value, config = {}) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text || !/[()]/.test(text)) return [];

  const delimiter = selectedDelimiter(config);
  const explicitParts = splitByExplicitDelimiter(text, delimiter);
  const structuredParts = explicitParts.length > 1 ? [] : splitStructuredMpnMfrEntries(text);
  const parts = explicitParts.length > 1 ? explicitParts : (structuredParts.length > 1 ? structuredParts : splitDelimited(text));
  const candidates = parts.length ? parts : [text];

  const parsed = candidates.flatMap((part) => {
    // Trailing {status} and [id] blocks are a common PLM export convention
    // ("DOWSIL RTV 3140 (DOW-CHEM) {HOM} [3157976]"). Allow them after the
    // manufacturer bracket and keep them as metadata instead of failing the match.
    const match = fmt(part).match(/^(.+?)\s*\(([^()]*)\)\s*((?:\{[^}]*\}|\[[^\]]*\]|\s)*)$/);
    if (!match) return [];

    const rawMpn = fmt(match[1]);
    const inside = fmt(match[2]);
    const trailing = fmt(match[3]);
    const statusMatch = trailing.match(/\{([^}]*)\}/);
    const idMatch = trailing.match(/\[([^\]]*)\]/);
    const trailingMeta = {};
    if (statusMatch && fmt(statusMatch[1])) trailingMeta.status = fmt(statusMatch[1]);
    if (idMatch && fmt(idMatch[1])) trailingMeta.internalId = fmt(idMatch[1]);
    const statusRefBlocks = trailing.match(/\{[^}]*\}|\[[^\]]*\]/g) || [];
    const mpnInfo = splitQualifiedMpnSide(rawMpn, statusRefBlocks.length > 0);
    const mpns = (mpnInfo.mpns?.length ? mpnInfo.mpns : [mpnInfo.mpn])
      .map(stripVendorPrefix)
      .filter(Boolean);
    if (!mpns.length || !inside || !mpns.every(looksLikeParenthesizedMpn)) return [];

    const insideParts = splitTopLevelDelimited(inside, [','])
      .map(fmt)
      .filter(Boolean);
    if (!insideParts.length) return [];

    const codeIndex = insideParts.findIndex((partValue, index) => (
      index > 0 && /^(?:mfr|manuf(?:acturer)?|vendor)?\s*(?:code|id)?\s*[:#-]?\s*[A-Z]?\d{4,}$/i.test(partValue)
    ));
    const manufacturerParts = codeIndex > 0 ? insideParts.slice(0, codeIndex) : [insideParts[0]];
    const manufacturer = manufacturerParts.join(', ').trim();
    const manufacturerCode = codeIndex > 0 ? insideParts.slice(codeIndex).join(', ').trim() : insideParts.slice(1).join(', ').trim();
    if (!manufacturer || !/[A-Za-z]/.test(manufacturer)) return [];

    return mpns.map((mpn) => normalizeAtQualifiedParsedPair({
      mpn,
      manufacturer,
      metadata: {
        ...(manufacturerCode ? { manufacturerCode } : {}),
        ...trailingMeta,
        ...((mpnInfo.discarded.length || statusRefBlocks.length) ? {
          discardedText: [
            ...mpnInfo.discarded,
            ...statusRefBlocks.map(cleanStatusBlockLabel).filter(Boolean).map((label) => (
              label === trailingMeta.status ? `{${label}}` : `[${label}]`
            )),
          ].filter(Boolean).join(' '),
        } : {}),
      },
    }, part));
  }).filter(Boolean);

  // Requiring EVERY entry to parse meant one odd line threw away its siblings: item
  // A1225407 lists five approved suppliers and lost all five. A cell is still only
  // treated as packed pairs when most of it parses, so a description that merely
  // happens to contain a bracket does not slip through — but the entries that did
  // parse are now kept.
  if (!parsed.length) return [];
  return parsed.length * 2 >= candidates.length ? parsed : [];
};

const parseTrailingParenthesizedMpnManufacturerPair = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text || !/[()]/.test(text)) return [];

  const extraMatch = text.match(/\s*(\{[^}]*\}\s*\[[^\]]*\])\s*$/);
  const extra = extraMatch ? fmt(extraMatch[1]) : '';
  const core = extraMatch ? fmt(text.slice(0, extraMatch.index)) : text;
  const match = core.match(/^(.+)\s+\(([^()]*)\)\s*$/);
  if (!match) return [];

  const rawMpn = fmt(match[1]);
  const manufacturer = fmt(match[2]);
  if (!rawMpn || !manufacturer || !/[A-Za-z]/.test(manufacturer)) return [];

  const statusRefBlocks = extra.match(/\{[^}]*\}|\[[^\]]*\]/g) || [];
  const mpnInfo = splitQualifiedMpnSide(rawMpn, statusRefBlocks.length > 0);
  const mpns = (mpnInfo.mpns?.length ? mpnInfo.mpns : [mpnInfo.mpn])
    .map(stripVendorPrefix)
    .filter(Boolean);
  const validationMpns = mpns.length ? mpns : [rawMpn.replace(/\([^()]*\)/g, '').trim()];
  if (!validationMpns.every(looksLikeParenthesizedMpn)) return [];

  const discardedText = [
    ...(mpnInfo.discarded || []),
    ...statusRefBlocks,
  ].filter(Boolean).join(' ');

  debugSlashVariantParser('trailing parenthesized pair parse', {
    source: value,
    rawMpn,
    manufacturer,
    mpns,
    discardedText,
  });

  return mpns.map((mpn) => normalizeAtQualifiedParsedPair({
    mpn,
    manufacturer,
    metadata: discardedText ? { discardedText } : {},
  }, value));
};

const parsePackedMpnManufacturerPairs = (value, config = {}) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text) return [];

  const caretPairs = parseCaretMpnManufacturerPairs(text);
  if (caretPairs.length) return caretPairs;

  const structuredEntries = splitStructuredMpnMfrEntries(text);
  if (structuredEntries.length > 1) {
    const structuredPairs = structuredEntries
      .flatMap((entry) => parseParenthesizedMpnManufacturerPairs(entry, config))
      .filter((pair) => pair?.mpn && pair?.manufacturer);
    if (structuredPairs.length) return structuredPairs;
  }

  const colonManufacturerPairs = parseColonManufacturerMpnPairs(text, config);
  if (colonManufacturerPairs.length) return colonManufacturerPairs;

  const trailingParenthesizedPair = parseTrailingParenthesizedMpnManufacturerPair(text);
  if (trailingParenthesizedPair.length) return trailingParenthesizedPair;

  const parenthesizedPairs = parseParenthesizedMpnManufacturerPairs(text, config);
  if (parenthesizedPairs.length) return parenthesizedPairs;

  if (!text.includes(':')) return [];

  const delimiter = selectedDelimiter(config);
  const candidates = splitByExplicitDelimiter(text, delimiter);
  const parts = candidates.length > 1 ? candidates : splitDelimited(text);
  if (!parts.length) return [];

  const parsed = parts.map((part) => {
    const colonIndex = part.indexOf(':');
    if (colonIndex <= 0) return null;

    const left = fmt(part.slice(0, colonIndex));
    const rightRaw = fmt(part.slice(colonIndex + 1));
    const { text: manufacturer, metadata } = extractPackedMetadata(rightRaw);
    if (!looksLikeMpnToken(left) || !manufacturer) return null;

    return {
      mpn: stripVendorPrefix(left),
      manufacturer,
      metadata,
    };
  }).filter(Boolean);

  return parsed.length >= 1 && parsed.length === parts.length ? parsed : [];
};

const slashVariantExpansionsInSource = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text) return [];
  const entries = splitStructuredMpnMfrEntries(text);
  const candidates = entries.length ? entries : [text];
  return candidates
    .map((entry) => detectSlashSuffixVariantExpansion(entry))
    .filter(Boolean);
};

const expandSlashVariantsForSource = (value, config = {}) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text) return { pairs: [], expansions: [] };
  const entries = splitStructuredMpnMfrEntries(text);
  const candidates = entries.length ? entries : [text];
  const expansions = [];
  const pairs = [];

  candidates.forEach((entry) => {
    const expansion = detectSlashSuffixVariantExpansion(entry);
    if (expansion?.pairs?.length) {
      expansions.push(expansion);
      pairs.push(...expansion.pairs);
      return;
    }
    pairs.push(...parsePackedMpnManufacturerPairs(entry, config));
  });

  return {
    pairs: pairs.filter((pair) => pair?.mpn && pair?.manufacturer),
    expansions,
  };
};

const sameParsedPair = (left = {}, right = {}) => (
  fmt(left.mpn).toUpperCase() === fmt(right.mpn).toUpperCase() &&
  fmt(left.manufacturer).toUpperCase() === fmt(right.manufacturer).toUpperCase()
);

const sourceForParsedPair = (source, pair, config = {}) => {
  const text = fmt(source).replace(/\u00a0/g, ' ');
  if (!text || !pair?.mpn || !pair?.manufacturer) return text;

  const entries = splitStructuredMpnMfrEntries(text);
  if (!entries.length) return text;

  return entries.find((entry) => (
    parsePackedMpnManufacturerPairs(entry, config).some((entryPair) => sameParsedPair(entryPair, pair))
  )) || entries[0] || text;
};

const isManufacturerPartsBlockHeader = (value) => {
  const key = normalizeKey(value);
  if (!key) return false;
  if (/^-+$/.test(fmt(value).replace(/\s+/g, ''))) return true;
  return (
    /manufacturer(?:s)?\s+manufacturer/.test(key) ||
    /manufacturer part number\s+manufacturer name/.test(key) ||
    /part numbers?\s+name\s+description/.test(key)
  );
};

const looksLikeManufacturerPartsMpn = (value) => {
  const text = fmt(value);
  const compact = text.replace(/[^A-Za-z0-9]/g, '');
  if (compact.length < 3 || compact.length > 40) return false;
  if (!/[A-Za-z0-9]/.test(compact)) return false;
  return /^[A-Za-z0-9._/#,+:-]+$/.test(text);
};

const parseManufacturerPartsBlockLine = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
  const originalText = fmt(value).replace(/\u00a0/g, ' ');
  if (!text || isManufacturerPartsBlockHeader(text)) return [];

  if (originalText.includes('||')) {
    const [left, ...rightParts] = originalText.split('||');
    const mpn = stripVendorPrefix(fmt(left));
    const manufacturer = fmt(rightParts.join('||'));
    if (!mpn || !manufacturer) return [];
    if (!looksLikeMpnToken(mpn) && !looksLikeParenthesizedMpn(mpn) && !looksLikeManufacturerPartsMpn(mpn)) return [];
    return [{ mpn, manufacturer, metadata: {} }];
  }

  const fixedParts = originalText
    .split(/\s{2,}/)
    .map(fmt)
    .filter(Boolean);
  if (fixedParts.length >= 2) {
    const [rawMpn, rawManufacturer, ...descriptionParts] = fixedParts;
    const mpn = stripVendorPrefix(rawMpn);
    const manufacturer = fmt(rawManufacturer);
    if (!mpn || !manufacturer) return [];
    if (!looksLikeMpnToken(mpn) && !looksLikeParenthesizedMpn(mpn) && !looksLikeManufacturerPartsMpn(mpn)) return [];
    return [{
      mpn,
      manufacturer,
      metadata: descriptionParts.length ? { manufacturerPartDescription: descriptionParts.join(' ') } : {},
    }];
  }

  return [];
};

const splitParserJoinedValues = (value) => {
  const text = fmt(value);
  if (!text) return [];
  return text.split(/\s+\|\s+/).map(fmt).filter(Boolean);
};

const buildManualPairList = (mpnValue, manufacturerValue, discardedValue = '') => {
  const mpns = splitParserJoinedValues(mpnValue);
  const manufacturers = splitParserJoinedValues(manufacturerValue);
  const discardedValues = splitParserJoinedValues(discardedValue);
  const count = Math.max(mpns.length, manufacturers.length, discardedValues.length);
  const pairs = [];

  for (let index = 0; index < count; index += 1) {
    const mpn = mpns[index] || '';
    const manufacturer = manufacturers[index] || manufacturers[0] || '';
    if (!mpn && !manufacturer) continue;
    const discardedText = discardedValues[index] || discardedValues[0] || '';
    pairs.push({
      mpn: stripVendorPrefix(mpn),
      manufacturer,
      metadata: discardedText ? { discardedText } : {},
    });
  }

  return pairs;
};

const getManualPatternParse = (row, sourceHeader, config = {}) => {
  const sourceRow = row?.__sourceRow;
  const overrides = Array.isArray(config.patternParserOverrides)
    ? config.patternParserOverrides
    : [];
  if (!sourceRow || !sourceHeader || !overrides.length) return null;

  const sourceKey = normalizeKey(sourceHeader);
  for (const override of overrides) {
    if (normalizeKey(override?.sourceHeader) !== sourceKey) continue;
    const parsedRow = override.rows?.[sourceRow] || override.rows?.[String(sourceRow)];
    if (!parsedRow) continue;
    return {
      found: true,
      sourceHeader: override.sourceHeader,
      patternShape: override.patternShape,
      displayExample: override.displayExample || null,
      rules: Array.isArray(override.rules) ? override.rules : [],
      pairs: Array.isArray(parsedRow.pairs) ? parsedRow.pairs : [],
    };
  }
  return null;
};

const getPatternAwarePackedPairs = (row, sourceHeader, value, config = {}) => {
  const manual = getManualPatternParse(row, sourceHeader, config);
  if (manual) return manual.pairs;
  return parsePackedMpnManufacturerPairs(value, config);
};

const MANUFACTURER_SUFFIX_ONLY_WORDS = new Set([
  'AG',
  'BV',
  'CO',
  'CORP',
  'CORPORATION',
  'GMBH',
  'INC',
  'INCORPORATED',
  'KG',
  'LIMITED',
  'LLC',
  'LLP',
  'LTD',
  'NV',
  'PLC',
  'PTE',
  'PTY',
  'PVT',
  'SA',
  'SAS',
  'SDN',
]);

const normalizeManufacturerSuffixToken = (value) => fmt(value).replace(/[^A-Za-z]/g, '').toUpperCase();

const isManufacturerSuffixOnlyPart = (value) => {
  const tokens = fmt(value)
    .split(/\s+/)
    .map(normalizeManufacturerSuffixToken)
    .filter(Boolean);
  return Boolean(tokens.length) && tokens.length <= 3 && tokens.every((token) => MANUFACTURER_SUFFIX_ONLY_WORDS.has(token));
};

const mergeManufacturerSuffixParts = (parts) => {
  const merged = [];
  parts.forEach((part) => {
    const cleanPart = fmt(part);
    if (!cleanPart) return;
    if (merged.length && isManufacturerSuffixOnlyPart(cleanPart)) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}, ${cleanPart}`;
      return;
    }
    merged.push(cleanPart);
  });
  return merged;
};

const findKnownManufacturerMatches = (text, phrases, canonicalForManufacturer) => {
  const normalizedText = normalizeKey(text).toUpperCase();
  if (!normalizedText) return [];
  const paddedText = ` ${normalizedText} `;
  const candidates = [];
  const seenKeys = new Set();

  phrases.forEach((name) => {
    const key = normalizeKey(name).toUpperCase();
    if (!key || key.length < 2 || seenKeys.has(key)) return;
    seenKeys.add(key);
    const paddedKey = ` ${key} `;
    const paddedIndex = paddedText.indexOf(paddedKey);
    if (paddedIndex === -1) return;
    candidates.push({
      name,
      key,
      start: paddedIndex,
      end: paddedIndex + paddedKey.length,
    });
  });

  const selected = [];
  candidates
    .sort((a, b) => a.start - b.start || b.key.length - a.key.length)
    .forEach((candidate) => {
      if (selected.some((match) => candidate.start < match.end && candidate.end > match.start)) return;
      selected.push(candidate);
    });

  return [...new Set(selected
    .sort((a, b) => a.start - b.start)
    .map((match) => canonicalForManufacturer(match.name)))];
};

const splitManufacturerCell = (value, expectedCount, config = {}) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text) return [];
  const keepSingleManufacturerCell = config.manufacturerCellMode === 'single_cell';
  const directory = config.manufacturerDirectory || {};
  const directoryNames = Array.isArray(directory.names) ? directory.names : [];
  const directoryAliases = directory.aliases || {};
  const canonicalForManufacturer = (name) => {
    const cleanName = stripCircledNumberMarkers(name);
    const key = normalizeKey(cleanName).toUpperCase();
    return directoryAliases[key] || cleanName;
  };

  const circledSegments = parseCircledNumberSegments(text);
  if (circledSegments.length > 1) {
    return circledSegments.map((segment) => canonicalForManufacturer(segment.value));
  }
  if (circledSegments.length === 1) {
    return [canonicalForManufacturer(circledSegments[0].value)];
  }

  const delimiter = selectedDelimiter(config);
  const explicitParts = splitByExplicitDelimiter(text, delimiter);
  if (!keepSingleManufacturerCell && explicitParts.length > 1) return mergeManufacturerSuffixParts(explicitParts).map(canonicalForManufacturer);

  const slashParts = splitSpacedSlashManufacturerParts(text);
  if (!keepSingleManufacturerCell && slashParts.length > 1) return mergeManufacturerSuffixParts(slashParts).map(canonicalForManufacturer);

  const knownPhrases = [
    ...directoryNames,
    ...Object.keys(directoryAliases),
    ...KNOWN_MANUFACTURERS,
  ];
  if (!keepSingleManufacturerCell) {
    const knownMatches = findKnownManufacturerMatches(text, knownPhrases, canonicalForManufacturer);
    if (knownMatches.length >= Math.min(expectedCount || 1, 2)) return knownMatches;
  }

  const colonSegments = parseColonSegments(text);
  if (!keepSingleManufacturerCell && colonSegments.length > 1) return colonSegments.map((segment) => canonicalForManufacturer(segment.label));

  const delimited = mergeManufacturerSuffixParts(splitDelimited(text));
  if (!keepSingleManufacturerCell && delimited.length > 1) return delimited.map(canonicalForManufacturer);

  if (keepSingleManufacturerCell) return [canonicalForManufacturer(text)];

  if (!expectedCount || expectedCount <= 1) return [text];

  const tokens = text.split(/\s+/).filter(Boolean);
  const manufacturers = [];
  let index = 0;
  while (index < tokens.length && manufacturers.length < expectedCount) {
    const remainingSlots = expectedCount - manufacturers.length;
    const remainingTokens = tokens.length - index;
    let current = tokens[index];
    index += 1;

    while (
      index < tokens.length &&
      remainingTokens > remainingSlots &&
      MANUFACTURER_SUFFIX_WORDS.has(tokens[index].toUpperCase())
    ) {
      current += ` ${tokens[index]}`;
      index += 1;
    }

    manufacturers.push(current);
  }

  if (index < tokens.length && manufacturers.length) {
    manufacturers[manufacturers.length - 1] = `${manufacturers[manufacturers.length - 1]} ${tokens.slice(index).join(' ')}`;
  }

  return manufacturers;
};

const getCell = (row, header) => (header ? fmt(row[header]) : '');

const pairMpnsWithManufacturers = (mpns = [], manufacturers = [], rawManufacturer = '') => {
  const cleanMpns = mpns.map(stripVendorPrefix).map(fmt).filter(Boolean);
  const cleanManufacturers = manufacturers.map(fmt).filter(Boolean);
  if (!cleanMpns.length && !cleanManufacturers.length) return [];

  if (cleanMpns.length === 1 && cleanManufacturers.length > 1) {
    return cleanManufacturers.map((manufacturer) => ({
      mpn: cleanMpns[0],
      manufacturer,
      metadata: {},
    }));
  }

  const count = Math.max(cleanMpns.length, cleanManufacturers.length || 0);
  return Array.from({ length: count }).map((_, index) => ({
    mpn: cleanMpns[index] || cleanMpns[0] || '',
    manufacturer: cleanManufacturers[index] || cleanManufacturers[0] || rawManufacturer || '',
    metadata: {},
  })).filter((pair) => pair.mpn || pair.manufacturer);
};

const isPlaceholderCell = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ').trim().toLowerCase();
  return !text || /^[-–—]+$/.test(text) || ['n/a', 'na', 'null', 'none'].includes(text);
};

const isGeneratedColumnHeader = (header) => /^column\s+\d+(?:\.\d+)?$/i.test(fmt(header));

const rowValues = (row, headers) => headers
  .map((header) => getCell(row, header))
  .filter(Boolean);

const rowLooksLikeRepeatedHeader = (row, headers) => {
  const values = rowValues(row, headers).map(normalizeKey).filter(Boolean);
  if (values.length < 2) return false;
  const headerKeys = new Set(headers.map(normalizeKey).filter(Boolean));
  const matchingValues = values.filter((value) => headerKeys.has(value)).length;
  return matchingValues >= Math.max(2, Math.ceil(values.length * 0.6));
};

const rowLooksLikeDoNotPopulate = (row, headers) => {
  const text = rowValues(row, headers).join(' ').toLowerCase();
  return /\b(do\s*not\s*populate|not\s*populate|dnp|dni|not\s*fitted|no\s*fit)\b/.test(text);
};

// Values a row-type column is likely to use for a document. Only ever used to
// PRE-TICK the boxes when the column is first mapped - the user sees every
// distinct value with its row count and decides. Missing a word here costs a
// tick, not a wrong BOM.
const DOCUMENT_TYPE_HINT_RE = /^(doc\.?\s*(ass|def|assembly|definition)?\.?|document|drawing|dessin|plan|spec|specification)$/i;

const suggestDocumentTypeValues = (values) => (
  (values || []).filter((value) => DOCUMENT_TYPE_HINT_RE.test(String(value).trim()))
);

// A row the user has declared to be a document rather than a consumed part.
// Both halves must be present - a mapped column and at least one ticked value -
// so this can never fire on a sheet where the question was not answered.
const isDocumentRowByType = (row, roles, config) => {
  const column = roles?.rowType;
  const flagged = config?.documentTypeValues;
  if (!column || !flagged || !flagged.length) return false;
  const value = getCell(row, column).trim();
  return Boolean(value) && flagged.includes(value);
};

const rowLooksLikeDeleted = (row, headers) => {
  if (row.__deletedRowStyle || row.__redRowStyle || row.__strikeRowStyle) return true;
  return false;
};

const rowLooksLikeSectionTitle = (row, headers, roles) => {
  const values = rowValues(row, headers);
  if (!values.length) return true;

  const mpnValue = getCell(row, roles.mpn);
  const manufacturerValue = getCell(row, roles.manufacturer);
  const quantityValue = getCell(row, roles.quantity);
  const uomValue = getCell(row, roles.uom);
  const descriptionValue = getCell(row, roles.description);

  const hasPartSignal = Boolean(mpnValue || manufacturerValue || quantityValue || uomValue);
  if (hasPartSignal) return false;

  if (values.length <= 2) {
    const text = values.join(' ').trim();
    const compact = text.replace(/[^A-Za-z0-9]/g, '');
    const mostlyLetters = /^[A-Za-z0-9&/+\-. ]+$/.test(text) && /[A-Za-z]/.test(text);
    const titleLike = text === text.toUpperCase() || compact.length <= 28;
    return mostlyLetters && titleLike && !looksLikeMpnToken(text);
  }

  return Boolean(descriptionValue) && !mpnValue && !quantityValue;
};

// --- how a row is keyed ------------------------------------------------------
//
// Two different relationships live on a BOM row, and they need two different
// columns. Conflating them is what broke parent-column sheets.
//
//   alternatesKey    identity  - rows sharing it are the SAME part offered by
//                                different manufacturers, and collapse onto one
//                                BOM line with the rest as alternates
//   hierarchyParent  structure - what this row hangs underneath in the tree
//
// `roles.parent` belongs only to the second. It used to lead the alternates key,
// and on a sheet that states its parent outright (AMAT's PARENT_PART) every
// child of an assembly carries the same value - so 36 distinct parts were read
// as one part with 35 substitute brands and the whole assembly collapsed into a
// single BOM line.
//
// The part number leads instead, because that is what identifies a part.
// Description stays as the fallback for rows with no part number, which is what
// level-only sheets already relied on - checked against a real THALES export,
// where keying on part number produces exactly the same groups.
const alternatesKey = (row, roles, sourceRow) => {
  // WHAT the part is — the CUSTOMER's part number.
  //
  // CPN, not MPN+manufacturer. The manufacturer part is precisely what an
  // alternate VARIES, so keying on it guarantees alternates can never group:
  // an AML position with three approved suppliers produces three keys, three
  // "primary" rows, and three sibling BOM lines under one assembly. FactWise
  // then rejects the file — one assembly may not list the same child twice —
  // and there is no way to fix it in the editor, because the three lines are
  // genuinely one position.
  //
  // Keying on CPN puts those three in one group: one BOM line, two alternates,
  // which is the shape the import accepts.
  //
  // The trade-off is real and documented in MPN_MFR_VS_CPN.md: a sheet that
  // reuses one CPN for parts that are NOT interchangeable will now merge them.
  // Read that before changing this back.
  //
  // MPN+manufacturer remains the fallback for rows with no CPN, then
  // description, then the row number — an assembly parent or a notes row has
  // no part number of its own.
  const mpn = getCell(row, roles.mpn);
  const manufacturer = getCell(row, roles.manufacturer);
  const identity = getCell(row, roles.cpn)
    || ((mpn || manufacturer) ? `${mpn}|${manufacturer}` : '')
    || getCell(row, roles.description)
    || `Source row ${sourceRow}`;

  // ...and WHERE it sits. A BOM line is identified by both, and keying on either
  // one alone collapses rows that are not the same line:
  //
  //   parent only    every child of an assembly reads as one part
  //                  (a 36-part assembly became 1 line + 35 "alternates")
  //   identity only  every placement of a part reads as one line
  //                  (a screw used in 159 sub-assemblies became 1 line with
  //                   159 "alternates" - alternates mean different MANUFACTURERS
  //                   of one part, so 159 was never a possible number)
  //
  // Keyed on the pair, one real customer file goes from 287 lines to 634, which
  // matches its 634 distinct (parent, part) pairs counted straight off the sheet.
  // Stated, or inferred from the level walk — either way a real parent, so a
  // part placed under two different assemblies stays two placements. That is
  // what stampInferredParents exists for: the level fallback below merged two
  // placements at the SAME level under different assemblies, because level
  // alone cannot tell them apart.
  const parent = hierarchyParent(row, roles);
  if (parent) return `${parent}␟${identity}`;

  // Reached only when there is no parent AND no usable level — a flat sheet.
  // Kept because it is still the honest answer there: with one tier, level is
  // the only thing on the row that says where it sits.
  //
  // Weaker than a real parent - two placements at the SAME level under different
  // assemblies still merge. That needs the parent inferred from row order during
  // normalization, which is the backend's job today.
  const level = rowLevel(row, roles);
  return level ? `L${level}␟${identity}` : identity;
};

// Where stampInferredParents writes the parent a row's level implies. Declared
// beside its reader rather than beside its writer: hierarchyParent runs on
// every row and this is the only thing it needs to know about the walk.
const LEVEL_PARENT_KEY = '__inferredParent';

// Where unpackParentPaths writes the plain parent code it read out of a
// breadcrumb path. Kept off the source cell on purpose: the sheet view still
// shows what the file actually says, and re-running with different roles
// re-derives from the original rather than from a value we already rewrote.
const PATH_PARENT_KEY = '__pathParent';

// A row's own trail states two more things outright, and only when the trail is
// the ROW's (takeLeaf === false). If the path names the PARENT instead, its last
// segment is the parent's code and neither of these can be read from it.
//
//   depth  — the number of segments IS the FactWise level. A root is one segment
//            and Level 1. This beats the sheet's own level column whenever that
//            column counts something else: THALES numbers a drawing with the
//            level of the part it documents, not its own position, so 97 of 345
//            rows report a level one tier too shallow.
//   code   — the last segment is the row's own PART NUMBER, and it lands in the
//            CPN role (THALES calls it Ref. Article). Not the grid's "Item code"
//            column, which is a separate field this never touches. 130 rows in
//            the same export arrive with an empty CPN cell but a complete path,
//            so the number is sitting right there.
const PATH_DEPTH_KEY = '__pathDepth';
const PATH_CODE_KEY = '__pathCode';
// Set on rows whose blank CPN cell we filled from the path, so a re-run can put
// it back rather than treating our own fill as the sheet's data.
const PATH_CODE_FILLED_KEY = '__pathCodeFilled';

// What the sheet states this row's parent to be, as a plain code. A breadcrumb
// path (">E36047BB01>F1288042") is not a code and matches nothing, so the
// stamped reading of it wins when there is one.
//
// Presence of the stamp decides, not its truth. A root's path is one segment
// long and correctly reads as "no parent" — an empty stamp — and falling back
// on empty handed the root its OWN path as its parent, which is how
// ">E36047BB01" kept appearing in the assembly list next to "E36047BB01".
const statedParent = (row, roles) => (
  row && PATH_PARENT_KEY in row ? row[PATH_PARENT_KEY] : getCell(row, roles.parent)
) || '';

// A stated parent when the sheet has one, otherwise the parent its level
// implies — stamped by stampInferredParents before any of this runs.
//
// Level-only sheets now carry a real parent through to the output, so the tree
// is built from an explicit statement rather than re-inferred from row order at
// every stage that needs it.
const hierarchyParent = (row, roles) => statedParent(row, roles) || row?.[LEVEL_PARENT_KEY] || '';

// The level this row sits at. A depth read off the row's own path outranks the
// sheet's level column, because the path counts tiers and the column may not.
const rowLevel = (row, roles) => String(row?.[PATH_DEPTH_KEY] ?? '') || getCell(row, roles.level);

// Whether this row's parent cell reads as a trail rather than a plain code.
// Only used to decide whether to OFFER the option - a separator alone does not
// prove a path, so what the option actually does is still measured against the
// sheet's codes before anything is written.
const rowHoldsParentPath = (row, roles) => {
  if (!roles?.parent) return false;
  const value = getCell(row, roles.parent);
  if (!value) return false;
  return PATH_SEPARATORS.some((separator) => value.includes(separator));
};

const hasGroupedRowContext = (row, roles) => Boolean(
  getCell(row, roles.parent) ||
  getCell(row, roles.cpn) ||
  getCell(row, roles.description) ||
  getCell(row, roles.quantity) ||
  getCell(row, roles.uom) ||
  getCell(row, roles.level)
);

const hasPreservableBomIdentity = (row, roles) => Boolean(
  getCell(row, roles.parent) ||
  getCell(row, roles.cpn) ||
  getCell(row, roles.description) ||
  getCell(row, roles.quantity) ||
  getCell(row, roles.uom) ||
  getCell(row, roles.level)
);

const shouldSkipSourceRow = (row, headers, roles, config) => {
  if (!rowValues(row, headers).length) return true;
  if (config.skipRepeatedHeaders && rowLooksLikeRepeatedHeader(row, headers)) return true;
  if (config.skipDoNotPopulate && rowLooksLikeDoNotPopulate(row, headers)) return true;
  if (config.skipDeletedRows && rowLooksLikeDeleted(row, headers)) return true;
  // Documents. Not a guess: the user named the column and ticked the values, so
  // this drops exactly what they said and nothing else. Placed before the
  // section-title guess below, which cannot tell a drawing from a heading and on
  // the THALES export deleted a real sub-assembly along with one.
  if (isDocumentRowByType(row, roles, config)) return true;
  const layoutStructure = effectiveStructure(config);
  if (layoutStructure === 'assembly_quantity_matrix') return false;
  if (layoutStructure === 'multi_block_assembly') return false;
  if (config.structure === 'grouped_rows' && hasGroupedRowContext(row, roles)) return false;
  if (config.skipTitleRows && rowLooksLikeSectionTitle(row, headers, roles)) return true;
  return false;
};

const confidenceForRow = (mpn, manufacturer, ruleId) => {
  let score = 45;
  if (mpn && looksLikeMpnToken(mpn)) score += 25;
  if (manufacturer) score += 15;
  if (ruleId.includes('colon') || ruleId.includes('separate')) score += 10;
  return Math.min(score, 98);
};

const withSourceColumns = (normalizedRow, sourceRow, config = {}) => {
  const sourceHeaders = Array.isArray(config.sourceHeaders) ? config.sourceHeaders : [];
  const roleOutputHeaders = config.roleOutputHeaders || {};
  const carried = { ...normalizedRow };
  Object.entries(roleOutputHeaders).forEach(([outputHeader, sourceHeader]) => {
    if (!outputHeader || !sourceHeader) return;
    if (Object.prototype.hasOwnProperty.call(carried, outputHeader) && fmt(carried[outputHeader])) return;
    carried[outputHeader] = sourceRow?.[sourceHeader] ?? '';
  });
  if (!sourceHeaders.length) return carried;
  const consumedSourceHeaders = config.consumedSourceHeaders instanceof Set
    ? config.consumedSourceHeaders
    : new Set((config.consumedSourceHeaders || []).map(normalizeKey));

  sourceHeaders.forEach((header) => {
    if (!header || header.startsWith('__')) return;
    if (consumedSourceHeaders.has(normalizeKey(header))) return;
    if (Object.prototype.hasOwnProperty.call(carried, header)) return;
    carried[header] = sourceRow?.[header] ?? '';
  });
  return carried;
};

const normalizeSeparateCells = (rows, roles, config) => {
  const output = [];
  rows.forEach((row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const rawMpn = getCell(row, roles.mpn);
    const rawManufacturer = getCell(row, roles.manufacturer);
    const manufacturerManualParse = getManualPatternParse(row, roles.manufacturer, config);
    const mpnManualParse = rawManufacturer ? null : getManualPatternParse(row, roles.mpn, config);
    const manufacturerPackedPairs = getPatternAwarePackedPairs(row, roles.manufacturer, rawManufacturer, config);
    const mpnPackedPairs = rawManufacturer ? [] : getPatternAwarePackedPairs(row, roles.mpn, rawMpn, config);
    const packedPairs = manufacturerPackedPairs.length ? manufacturerPackedPairs : mpnPackedPairs;
    const mpns = splitMpnCell(rawMpn, config);
    const explicitDelimiterUsed = Boolean(selectedDelimiter(config)) && mpns.length > 1;
    const manufacturers = splitManufacturerCell(rawManufacturer, mpns.length, config);
    const primaryManufacturer = manufacturers[0] || '';
    const quantity = getCell(row, roles.quantity);
    const uom = getCell(row, roles.uom);
    const description = getCell(row, roles.description);
    const parentKey = alternatesKey(row, roles, sourceRow);
    const parent = hierarchyParent(row, roles);
    const level = rowLevel(row, roles) || '1';
    const rule = explicitDelimiterUsed ? 'separate_cells_user_delimiter' : 'separate_cells_position_pairing';
    const cpn = getCell(row, roles.cpn);

    if (packedPairs.length) {
      packedPairs.forEach((pair, partIndex) => {
        output.push(withSourceColumns({
          sourceRow,
          parentKey,
          parent,
          relation: partIndex === 0 ? 'Primary' : `Alternate ${partIndex}`,
          level,
          cpn,
          description,
          mpn: pair.mpn,
          manufacturer: pair.manufacturer,
          quantity,
          uom,
          rule: 'separate_cells_parenthesized_mpn_manufacturer',
          confidence: Math.min(confidenceForRow(pair.mpn, pair.manufacturer, 'separate') + 12, 98),
          discardedText: '',
          ...pair.metadata,
        }, row, config));
      });
      return;
    }

    if ((manufacturerManualParse || mpnManualParse) && !packedPairs.length) {
      if (hasPreservableBomIdentity(row, roles)) {
        output.push(withSourceColumns({
          sourceRow,
          parentKey,
          parent,
          relation: 'Primary',
          level,
          cpn,
          description,
          mpn: '',
          manufacturer: '',
          quantity,
          uom,
          rule: 'manual_pattern_without_mpn_mfr',
          confidence: 62,
          discardedText: '',
        }, row, config));
      }
      return;
    }

    if (!mpns.length && hasPreservableBomIdentity(row, roles)) {
      output.push(withSourceColumns({
        sourceRow,
        parentKey,
        parent,
        relation: 'Primary',
        level,
        cpn,
        description,
        mpn: '',
        manufacturer: rawManufacturer,
        quantity,
        uom,
        rule: 'separate_cells_item_without_mpn_mfr',
        confidence: rawManufacturer ? 68 : 58,
        discardedText: rawMpn,
      }, row, config));
      return;
    }

    if (!packedPairs.length && /\bmaterial\s*description\b/i.test(rawMpn) && rawMpn.includes('^') && hasPreservableBomIdentity(row, roles)) {
      output.push(withSourceColumns({
        sourceRow,
        parentKey,
        parent,
        relation: 'Primary',
        level,
        cpn,
        description,
        mpn: '',
        manufacturer: '',
        quantity,
        uom,
        rule: 'separate_cells_caret_description_without_mpn_mfr',
        confidence: 58,
        discardedText: '',
      }, row, config));
      return;
    }

    const partCount = Math.max(mpns.length, manufacturers.length || 0);
    Array.from({ length: partCount }).forEach((_, partIndex) => {
      const isPrimary = partIndex === 0;
      const mpn = mpns[partIndex] || mpns[0] || '';
      const manufacturer = manufacturers[partIndex] || (!isPrimary && config.manufacturerMode === 'inherit_blank' ? primaryManufacturer : '');
      output.push(withSourceColumns({
        sourceRow,
        parentKey,
        parent,
        relation: isPrimary ? 'Primary' : `Alternate ${partIndex}`,
        level,
        cpn,
        description,
        mpn,
        manufacturer,
        quantity: config.quantityMode === 'inherit_primary' || isPrimary ? quantity : quantity,
        uom: config.quantityMode === 'inherit_primary' || isPrimary ? uom : uom,
        rule,
        confidence: Math.min(confidenceForRow(mpn, manufacturer, 'separate') + (explicitDelimiterUsed ? 25 : 0), 98),
        discardedText: '',
      }, row, config));
    });
  });
  return output;
};

const normalizeSameCell = (rows, roles, config) => {
  const output = [];
  rows.forEach((row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const rawMpn = getCell(row, roles.mpn);
    const rawManufacturer = roles.manufacturer && roles.manufacturer !== roles.mpn ? getCell(row, roles.manufacturer) : '';
    const mpnManualParse = getManualPatternParse(row, roles.mpn, config);
    const manufacturerManualParse = getManualPatternParse(row, roles.manufacturer, config);
    const mpnPackedPairs = getPatternAwarePackedPairs(row, roles.mpn, rawMpn, config);
    const manufacturerPackedPairs = getPatternAwarePackedPairs(row, roles.manufacturer, rawManufacturer, config);
    const sourceText = mpnPackedPairs.length || !manufacturerPackedPairs.length ? rawMpn : rawManufacturer;
    const packedPairs = mpnPackedPairs.length ? mpnPackedPairs : manufacturerPackedPairs;
    const segments = parseColonSegments(sourceText);
    const quantity = getCell(row, roles.quantity);
    const uom = getCell(row, roles.uom);
    const description = getCell(row, roles.description);
    const parentKey = alternatesKey(row, roles, sourceRow);
    const parent = hierarchyParent(row, roles);
    const level = rowLevel(row, roles) || '1';
    const cpn = getCell(row, roles.cpn);

    if (packedPairs.length) {
      packedPairs.forEach((pair, partIndex) => {
        output.push(withSourceColumns({
          sourceRow,
          parentKey,
          parent,
          relation: partIndex === 0 ? 'Primary' : `Alternate ${partIndex}`,
          level,
          cpn,
          description,
          mpn: pair.mpn,
          manufacturer: pair.manufacturer,
          quantity,
          uom,
          rule: 'same_cell_packed_mpn_manufacturer',
          confidence: Math.min(confidenceForRow(pair.mpn, pair.manufacturer, 'colon') + 8, 98),
          discardedText: '',
          ...pair.metadata,
        }, row, config));
      });
      return;
    }

    if ((mpnManualParse || manufacturerManualParse) && !packedPairs.length) {
      if (hasPreservableBomIdentity(row, roles)) {
        output.push(withSourceColumns({
          sourceRow,
          parentKey,
          parent,
          relation: 'Primary',
          level,
          cpn,
          description,
          mpn: '',
          manufacturer: '',
          quantity,
          uom,
          rule: 'manual_pattern_without_mpn_mfr',
          confidence: 62,
          discardedText: '',
        }, row, config));
      }
      return;
    }

    if (!segments.length) {
      if (sourceText.includes('^')) {
        if (hasPreservableBomIdentity(row, roles)) {
          output.push(withSourceColumns({
            sourceRow,
            parentKey,
            parent,
            relation: 'Primary',
            level,
            cpn,
            description,
            mpn: '',
            manufacturer: '',
            quantity,
            uom,
            rule: 'same_cell_caret_item_without_mpn_mfr',
            confidence: 58,
            discardedText: '',
          }, row, config));
        }
        return;
      }

      const fallbackMpns = splitMpnCell(sourceText, config);
      if (!fallbackMpns.length && hasPreservableBomIdentity(row, roles)) {
        output.push(withSourceColumns({
          sourceRow,
          parentKey,
          parent,
          relation: 'Primary',
          level,
          cpn,
          description,
          mpn: '',
          manufacturer: '',
          quantity,
          uom,
          rule: 'same_cell_item_without_mpn_mfr',
          confidence: 58,
          discardedText: sourceText,
        }, row, config));
        return;
      }

      fallbackMpns.forEach((mpn, partIndex) => {
        output.push(withSourceColumns({
          sourceRow,
          parentKey,
          parent,
          relation: partIndex === 0 ? 'Primary' : `Alternate ${partIndex}`,
          level,
          cpn,
          description,
          mpn,
          manufacturer: '',
          quantity,
          uom,
          rule: 'same_cell_fallback_mpn_split',
          confidence: confidenceForRow(mpn, '', 'same_cell'),
          discardedText: '',
        }, row, config));
      });
      return;
    }

    let relationIndex = 0;
    segments.forEach((segment, segmentIndex) => {
      const mpns = segment.mpns.length ? segment.mpns : [segment.rawValue].filter(Boolean);
      mpns.forEach((mpn, mpnIndex) => {
        output.push(withSourceColumns({
          sourceRow,
          parentKey,
          parent,
          relation: relationIndex === 0 ? 'Primary' : `Alternate ${relationIndex}`,
          level,
          cpn,
          description,
          mpn,
          manufacturer: segment.label,
          quantity,
          uom,
          rule: mpnIndex > 0 ? 'same_cell_colon_multi_mpn' : 'same_cell_colon_label',
          confidence: confidenceForRow(mpn, segment.label, 'colon'),
          discardedText: '',
        }, row, config));
        relationIndex += 1;
      });
      if (segmentIndex === segments.length - 1 && config.quantityMode === 'inherit_primary') {
        return null;
      }
      return null;
    });
  });
  return output;
};

const findAlternateColumnGroups = (headers) => {
  const groups = [];
  headers.forEach((header) => {
    const normalized = normalizeKey(header);
    const match = normalized.match(/(?:alt|alternate)\s*(\d*)\s*(mpn|mfr|manufacturer|qty|quantity|uom|unit)/);
    if (!match) return;
    const slot = match[1] || `${groups.length + 1}`;
    let type = match[2];
    if (type === 'manufacturer') type = 'mfr';
    if (type === 'quantity') type = 'qty';
    if (type === 'unit') type = 'uom';
    const existing = groups.find((group) => group.slot === slot);
    if (existing) {
      existing[type] = header;
    } else {
      groups.push({ slot, [type]: header });
    }
  });
  return groups.filter((group) => group.mpn);
};

const cleanAlternateColumnGroups = (groups = [], headers = []) => groups
  .map((group, index) => ({
    slot: group.slot || `${index + 1}`,
    mpn: headers.includes(group.mpn) ? group.mpn : '',
    mfr: headers.includes(group.mfr) ? group.mfr : '',
    qty: headers.includes(group.qty) ? group.qty : '',
    uom: headers.includes(group.uom) ? group.uom : '',
  }))
  .filter((group) => group.mpn);

const findMfgPartsHeader = (headers = []) => headers.find((header) => {
  const key = normalizeKey(header);
  return key === 'mfg parts' || key === 'mfg part' || key === 'manufacturer parts' || key === 'manufacturer part';
}) || '';

const detectLeadingLevelColumns = (headers = [], rows = [], roles = {}) => {
  const descriptionHeader = roles.description || headers.find((header) => normalizeKey(header) === 'description') || '';
  const descriptionIndex = headers.indexOf(descriptionHeader);
  if (descriptionIndex <= 0) return [];

  const candidates = headers.slice(0, descriptionIndex).filter(isGeneratedColumnHeader);
  if (candidates.length < 2) return [];

  const active = candidates.filter((header) => (
    rows.some((row) => {
      const value = getCell(row, header);
      return value && /[A-Za-z0-9]/.test(value) && !isPlaceholderCell(value);
    })
  ));
  return active.length >= 2 ? active : [];
};

const detectFollowingRowMfgPartsLayout = (headers = [], rows = [], roles = {}) => {
  const mfgPartsHeader = findMfgPartsHeader(headers);
  const levelColumns = detectLeadingLevelColumns(headers, rows, roles);
  if (!mfgPartsHeader || levelColumns.length < 2) return null;

  const markerCount = rows.slice(0, 120).filter((row) => (
    isManufacturerPartsBlockHeader(getCell(row, mfgPartsHeader))
  )).length;
  const parsedContinuationCount = rows.slice(0, 120).filter((row) => (
    !levelColumns.some((header) => getCell(row, header)) &&
    parseManufacturerPartsBlockLine(getCell(row, mfgPartsHeader)).length > 0
  )).length;

  if (markerCount < 1 && parsedContinuationCount < 1) return null;
  return { mfgPartsHeader, levelColumns };
};

const isAssemblyMatrixPartHeader = (header) => {
  const key = normalizeKey(header);
  if (!key || /\b(mfr|mfg|manufacturer|maker|vendor|supplier)\b/.test(key)) return false;
  return /\bpart\s*(no|num|number|nbr)\b/.test(key) || /^part$/.test(key);
};

const isAssemblyMatrixDescriptionHeader = (header) => {
  const key = normalizeKey(header);
  return /\b(desc|description|designation|item\s*name|name)\b/.test(key);
};

const isAssemblyMatrixFindHeader = (header) => {
  const key = normalizeKey(header);
  return /\b(find\s*(no|num|number|nbr)|find|serial\s*(no|number)?|item\s*no)\b/.test(key);
};

const isAssemblyMatrixHeaderCandidate = (header) => {
  const text = fmt(header);
  return /^0*\d{1,4}$/.test(text) || /^(?:a|ass(?:y|embly)?|bom)\s*[-_ ]*0*\d{1,4}$/i.test(text);
};

const isMatrixQuantityLikeValue = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ').trim();
  if (!text) return true;
  if (/^[-–—]$/.test(text)) return true;
  if (/^(?:ar|a\/r|as\s*req(?:uired)?|ref|x)$/i.test(text)) return true;
  if (/^[A-Za-z0-9./_-]{1,12}$/.test(text)) return true;
  return /^-?\d+(?:[.,]\d+)?$/.test(text);
};

const isMatrixQuantityPresent = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ').trim();
  if (!text || /^[-–—]$/.test(text)) return false;
  if (/^0+(?:[.,]0+)?$/.test(text)) return false;
  return true;
};

const isMultiBlockQuantityPresent = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ').trim();
  return Boolean(text && !/^[-–—]$/.test(text));
};

const isNumericMatrixQuantity = (value) => /^-?\d+(?:[.,]\d+)?$/.test(fmt(value).replace(/\u00a0/g, ' ').trim());

const normalizeAssemblyMatrixQuantity = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ').trim();
  if (text && !isNumericMatrixQuantity(text)) return { quantity: '0', note: '' };
  return { quantity: text, note: '' };
};

const QUANTITY_VARIANT_ALL = 'all';

const getSelectedQuantityVariant = (config = {}) => {
  const selected = fmt(config.quantityVariant || QUANTITY_VARIANT_ALL).trim();
  return selected && selected !== QUANTITY_VARIANT_ALL ? selected : '';
};

const quantityVariantMatches = (value, selectedVariant) => (
  Boolean(selectedVariant) && normalizeKey(value) === normalizeKey(selectedVariant)
);

const filterQuantityVariantHeaders = (headers = [], config = {}) => {
  const selectedVariant = getSelectedQuantityVariant(config);
  if (!selectedVariant) return headers;
  return headers.filter((header) => quantityVariantMatches(header, selectedVariant));
};

const getRowQuantityVariant = (row = {}) => row.__quantityColumn || row['Quantity variant'] || '';
const getRowQuantityVariantGroup = (row = {}) => row.__blockId || [
  row['Source sheet'],
  row['BOM block'],
  row.__blockTitle,
].map(fmt).filter(Boolean).join('::');

const filterRowsByQuantityVariant = (rows = [], config = {}) => {
  const selectedVariant = getSelectedQuantityVariant(config);
  const selectedByBlock = config.quantityVariantByBlock || {};
  if (!selectedVariant && !Object.keys(selectedByBlock).length) return rows;
  return rows.filter((row) => {
    const rowVariant = getRowQuantityVariant(row);
    if (!rowVariant) return true;
    if (row?.__multiBlockMode === '1') {
      const groupKey = getRowQuantityVariantGroup(row);
      const blockVariant = fmt(selectedByBlock[groupKey]);
      if (!blockVariant || blockVariant === QUANTITY_VARIANT_ALL) return true;
      return quantityVariantMatches(rowVariant, blockVariant);
    }
    return !selectedVariant || quantityVariantMatches(rowVariant, selectedVariant);
  });
};

const detectAssemblyQuantityMatrix = (headers = [], rows = [], roles = {}) => {
  const visibleHeaders = headers.filter((header) => header && !header.startsWith('__'));
  const partNumberColumn = visibleHeaders.find(isAssemblyMatrixPartHeader) || roles.cpn || roles.mpn || '';
  const descriptionColumn = visibleHeaders.find(isAssemblyMatrixDescriptionHeader) || roles.description || '';
  const findNumberColumn = visibleHeaders.find(isAssemblyMatrixFindHeader) || '';

  if (!partNumberColumn || !descriptionColumn) return null;

  const excluded = new Set([partNumberColumn, descriptionColumn, findNumberColumn]
    .filter(Boolean)
    .map(normalizeKey));
  Object.values(roles || {}).forEach((header) => {
    if (header) excluded.add(normalizeKey(header));
  });

  const assemblyColumns = visibleHeaders.filter((header) => {
    if (excluded.has(normalizeKey(header))) return false;
    if (!isAssemblyMatrixHeaderCandidate(header)) return false;
    const sampleValues = rows.slice(0, 80).map((row) => getCell(row, header));
    const nonBlankValues = sampleValues.filter((value) => fmt(value));
    if (!nonBlankValues.length) return false;
    const quantityLikeCount = nonBlankValues.filter(isMatrixQuantityLikeValue).length;
    const longTextCount = nonBlankValues.filter((value) => fmt(value).length > 12).length;
    return quantityLikeCount / nonBlankValues.length >= 0.75 && longTextCount <= Math.max(1, Math.floor(nonBlankValues.length * 0.15));
  });

  if (assemblyColumns.length < 2) return null;
  const partSamples = rows.slice(0, 80).filter((row) => getCell(row, partNumberColumn)).length;
  const descriptionSamples = rows.slice(0, 80).filter((row) => getCell(row, descriptionColumn)).length;
  if (partSamples < 2 || descriptionSamples < 2) return null;

  return {
    assemblyColumns,
    partNumberColumn,
    descriptionColumn,
    findNumberColumn,
  };
};

const getConsumedSourceHeaders = (roles = {}, config = {}, headers = []) => {
  const consumed = new Set();
  Object.values(roles || {}).forEach((header) => {
    if (header) consumed.add(normalizeKey(header));
  });
  const alternateGroups = [
    ...(config.alternateColumnGroups || []),
    ...(config.alternateLayout === 'separate_columns' ? findAlternateColumnGroups(headers) : []),
  ];
  alternateGroups.forEach((group) => {
    ['mpn', 'mfr', 'qty', 'uom'].forEach((field) => {
      if (group?.[field]) consumed.add(normalizeKey(group[field]));
    });
  });
  if (config.alternateLayout === 'following_rows' && config.followingRowAlternateColumn) {
    consumed.add(normalizeKey(config.followingRowAlternateColumn));
  }
  if (config.alternateLayout === 'following_item_rows') {
    [
      config.followingItemRowsContextColumn,
      config.followingItemRowsItemColumn,
      config.followingItemRowsMpnColumn,
      config.followingItemRowsManufacturerColumn,
    ].filter(Boolean).forEach((header) => consumed.add(normalizeKey(header)));
  }
  if (effectiveStructure(config) === 'assembly_quantity_matrix') {
    const matrix = detectAssemblyQuantityMatrix(headers, [], roles) || config.assemblyMatrix;
    (matrix?.assemblyColumns || []).forEach((header) => consumed.add(normalizeKey(header)));
    [matrix?.partNumberColumn, matrix?.descriptionColumn, matrix?.findNumberColumn]
      .filter(Boolean)
      .forEach((header) => consumed.add(normalizeKey(header)));
  }
  return consumed;
};

const normalizeFollowingRows = (rows, roles, config = {}) => {
  const output = [];
  const alternateColumn = config.followingRowAlternateColumn || '';
  const includeInsideCellAlternates = config.includeInsideCellAlternatesWithFollowingRows !== false;
  const followingMfgPartsLayout = detectFollowingRowMfgPartsLayout(config.sourceHeaders || [], rows, roles);
  const levelColumns = followingMfgPartsLayout?.levelColumns || [];
  const hierarchyStack = [];
  let currentGroup = null;
  const configuredMfgPartsColumn = alternateColumn && findMfgPartsHeader([alternateColumn]) === alternateColumn;
  const useMfgPartsAsFollowingSource = Boolean(
    alternateColumn &&
    (
      followingMfgPartsLayout?.mfgPartsHeader === alternateColumn ||
      configuredMfgPartsColumn ||
      (roles.mpn === alternateColumn && roles.manufacturer === alternateColumn)
    )
  );

  const looksLikeHierarchyPath = (value) => {
    const text = fmt(value);
    return Boolean(text && /(?:^|\s)\d+\s*>/.test(text));
  };

  const parseAlternateText = (row, value) => {
    if (looksLikeHierarchyPath(value)) return [];
    const mfgPartsPairs = parseManufacturerPartsBlockLine(value);
    if (mfgPartsPairs.length) return mfgPartsPairs;
    const manualParse = getManualPatternParse(row, alternateColumn, config);
    if (manualParse) return manualParse.pairs;
    const packedPairs = getPatternAwarePackedPairs(row, alternateColumn, value, config);
    if (packedPairs.length) return packedPairs;
    return splitMpnCell(value, config)
      .map(stripVendorPrefix)
      .filter((mpn) => looksLikeMpnToken(mpn))
      .map((mpn) => ({
        mpn,
        manufacturer: '',
        metadata: {},
      }));
  };

  const parseStandaloneMpnText = (value) => {
    if (looksLikeHierarchyPath(value)) return [];
    return splitMpnCell(value, config)
      .map(stripVendorPrefix)
      .filter((mpn) => looksLikeMpnToken(mpn) || looksLikeParenthesizedMpn(mpn));
  };

  const parsePrimaryPairs = (row, rawMpn, rawManufacturer) => {
    const mfgPartsPairs = parseManufacturerPartsBlockLine(rawMpn || rawManufacturer);
    if (mfgPartsPairs.length) return { packedPairs: mfgPartsPairs, mpns: [], manufacturers: [] };
    const manufacturerManualParse = getManualPatternParse(row, roles.manufacturer, config);
    const mpnManualParse = getManualPatternParse(row, roles.mpn, config);
    const manufacturerPackedPairs = getPatternAwarePackedPairs(row, roles.manufacturer, rawManufacturer, config);
    const mpnPackedPairs = getPatternAwarePackedPairs(row, roles.mpn, rawMpn, config);
    let packedPairs = manufacturerPackedPairs.length ? manufacturerPackedPairs : mpnPackedPairs;
    if (!includeInsideCellAlternates && packedPairs.length > 1) {
      packedPairs = packedPairs.slice(0, 1);
    }
    if (packedPairs.length) return { packedPairs, mpns: [], manufacturers: [] };
    if (manufacturerManualParse || mpnManualParse) return { packedPairs: [], mpns: [], manufacturers: [] };

    const mpns = parseStandaloneMpnText(rawMpn);
    const scopedMpns = includeInsideCellAlternates ? mpns : mpns.slice(0, 1);
    const manufacturers = mpns.length
      ? splitManufacturerCell(rawManufacturer, scopedMpns.length, config)
      : [];
    return { packedPairs: [], mpns: scopedMpns, manufacturers };
  };

  const getLevelItemInfo = (row) => {
    if (!levelColumns.length) return null;
    const levelIndex = levelColumns.findIndex((header) => getCell(row, header));
    if (levelIndex < 0) return null;
    const cpn = getCell(row, levelColumns[levelIndex]);
    const levelNumber = levelIndex + 1;
    const parent = levelNumber > 1 ? hierarchyStack[levelNumber - 2]?.cpn || '' : '';
    return { cpn, level: String(levelNumber), parent };
  };

  const syncHierarchy = (info) => {
    if (!info?.cpn) return;
    const levelIndex = Math.max(0, Number(info.level || 1) - 1);
    hierarchyStack[levelIndex] = { cpn: info.cpn };
    hierarchyStack.length = levelIndex + 1;
  };

  const groupValuesFromContext = (row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const levelInfo = getLevelItemInfo(row);
    if (levelInfo) syncHierarchy(levelInfo);
    const cpn = levelInfo?.cpn || getCell(row, roles.cpn);
    const level = levelInfo?.level || rowLevel(row, roles) || '1';
    const parent = levelInfo?.parent || hierarchyParent(row, roles);
    const description = getCell(row, roles.description);
    const identity = cpn || description || `Source row ${sourceRow}`;
    const parentKey = parent ? `${parent}␟${identity}` : `L${level}␟${identity}`;
    return {
      sourceRow,
      parentKey,
      parent,
      level,
      cpn,
      description,
      quantity: getCell(row, roles.quantity),
      uom: getCell(row, roles.uom),
      relationCount: 0,
    };
  };

  const hasPrimaryContextWithoutPart = (row) => {
    if (getLevelItemInfo(row)) return true;
    if (
      getCell(row, roles.parent) ||
      getCell(row, roles.cpn) ||
      getCell(row, roles.description) ||
      getCell(row, roles.quantity) ||
      getCell(row, roles.uom)
    ) {
      return true;
    }

    const ignoredHeaders = new Set([alternateColumn, roles.level].filter(Boolean).map(normalizeKey));
    return (config.sourceHeaders || []).some((header) => (
      header &&
      !header.startsWith('__') &&
      !ignoredHeaders.has(normalizeKey(header)) &&
      getCell(row, header)
    ));
  };

  const hasSameRowAlternateContext = (row) => {
    const levelInfo = getLevelItemInfo(row);
    if (levelInfo?.cpn) return true;
    return Boolean(
      getCell(row, roles.parent) ||
      getCell(row, roles.cpn) ||
      getCell(row, roles.description) ||
      getCell(row, roles.quantity) ||
      getCell(row, roles.uom)
    );
  };

  const emitContextPrimary = (row, rowIndex) => {
    const group = groupValuesFromContext(row, rowIndex);
    const shouldDeferPrimaryToMfgParts = useMfgPartsAsFollowingSource &&
      isManufacturerPartsBlockHeader(getCell(row, alternateColumn));

    if (shouldDeferPrimaryToMfgParts) {
      return { ...group, relationCount: 0 };
    }

    output.push(withSourceColumns({
      ...group,
      relation: 'Primary',
      mpn: '',
      manufacturer: '',
      rule: 'following_rows_context_without_mpn_mfr',
      confidence: 58,
      discardedText: '',
    }, row, config));

    return { ...group, relationCount: 1 };
  };

  const emitPrimaryParts = (row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const rawMpn = getCell(row, roles.mpn);
    const rawManufacturer = getCell(row, roles.manufacturer);
    const { packedPairs, mpns, manufacturers } = parsePrimaryPairs(row, rawMpn, rawManufacturer);
    const primaryManufacturer = manufacturers[0] || '';
    const context = groupValuesFromContext(row, rowIndex);
    const group = {
      ...context,
      sourceRow,
      relationCount: 0,
    };

    const pairs = packedPairs.length
      ? packedPairs
      : pairMpnsWithManufacturers(mpns, manufacturers, primaryManufacturer);

    if (!pairs.length && rawMpn && !looksLikeHierarchyPath(rawMpn)) {
      output.push(withSourceColumns({
        ...group,
        relation: 'Primary',
        mpn: stripVendorPrefix(rawMpn),
        manufacturer: rawManufacturer,
        rule: 'following_rows_primary_passthrough',
        confidence: confidenceForRow(rawMpn, rawManufacturer, 'following_rows'),
        discardedText: '',
      }, row, config));
      group.relationCount = 1;
      return group;
    }

    pairs.forEach((pair, pairIndex) => {
      output.push(withSourceColumns({
        ...group,
        relation: pairIndex === 0 ? 'Primary' : `Alternate ${pairIndex}`,
        mpn: pair.mpn,
        manufacturer: pair.manufacturer,
        rule: packedPairs.length ? 'following_rows_primary_packed_pair' : 'following_rows_primary',
        confidence: Math.min(confidenceForRow(pair.mpn, pair.manufacturer, 'following_rows') + 8, 98),
        discardedText: '',
        ...pair.metadata,
      }, row, config));
    });
    group.relationCount = Math.max(1, pairs.length);
    return group;
  };

  rows.forEach((row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const alternateText = getCell(row, alternateColumn);
    const rawMpn = useMfgPartsAsFollowingSource && roles.mpn === alternateColumn
      ? ''
      : getCell(row, roles.mpn);
    const rawManufacturer = useMfgPartsAsFollowingSource && roles.manufacturer === alternateColumn
      ? ''
      : getCell(row, roles.manufacturer);
    const primaryParts = parsePrimaryPairs(row, rawMpn, rawManufacturer);
    const rowHasNormalPart = Boolean(
      primaryParts.packedPairs.length ||
      primaryParts.mpns.length
    );
    const sameRowAlternateGroup = alternateColumn && alternateText && !rowHasNormalPart && hasSameRowAlternateContext(row)
      ? groupValuesFromContext(row, rowIndex)
      : null;
    const activeGroup = sameRowAlternateGroup || currentGroup;
    const followingAlternatePairs = alternateColumn && alternateText && !rowHasNormalPart && activeGroup
      ? parseAlternateText(row, alternateText)
      : [];
    const rowLooksLikeFollowingAlternate = followingAlternatePairs.length > 0;

    if (rowLooksLikeFollowingAlternate) {
      if (sameRowAlternateGroup) {
        currentGroup = sameRowAlternateGroup;
      }
      followingAlternatePairs.forEach((pair) => {
        const relationIndex = Number.isFinite(Number(currentGroup.relationCount))
          ? Number(currentGroup.relationCount)
          : 1;
        output.push(withSourceColumns({
          sourceRow,
          parentKey: currentGroup.parentKey,
          parent: currentGroup.parent,
          relation: relationIndex === 0 ? 'Primary' : `Alternate ${relationIndex}`,
          level: currentGroup.level,
          cpn: currentGroup.cpn,
          description: currentGroup.description,
          mpn: pair.mpn,
          manufacturer: pair.manufacturer,
          quantity: currentGroup.quantity,
          uom: currentGroup.uom,
          rule: 'following_rows_alternate',
          confidence: Math.min(confidenceForRow(pair.mpn, pair.manufacturer, 'following_rows') + 12, 98),
          discardedText: '',
          ...pair.metadata,
        }, row, config));
        currentGroup.relationCount = relationIndex + 1;
      });
      return;
    }

    if (rowHasNormalPart) {
      currentGroup = emitPrimaryParts(row, rowIndex);
      return;
    }

    if (hasPrimaryContextWithoutPart(row)) {
      currentGroup = emitContextPrimary(row, rowIndex);
    }
  });

  return output;
};

const normalizeFollowingItemRows = (rows, roles, config = {}) => {
  const output = [];
  const contextColumn = config.followingItemRowsContextColumn || '';
  const itemColumn = config.followingItemRowsItemColumn || roles.cpn || '';
  const mpnColumn = config.followingItemRowsMpnColumn || roles.mpn || '';
  const manufacturerColumn = config.followingItemRowsManufacturerColumn || roles.manufacturer || '';
  const parserConfig = { ...config, manufacturerCellMode: 'single_cell' };
  const cpnAutofillMode = config.followingItemRowsCpnMode || 'primary';
  const strictContextMarker = Boolean(contextColumn);
  let currentGroup = null;
  const emittedPartsByGroup = new WeakMap();

  const partIdentity = (pair) => {
    const mpn = fmt(pair?.mpn).replace(/\s+/g, ' ').trim().toUpperCase();
    const manufacturer = fmt(pair?.manufacturer).replace(/\s+/g, ' ').trim().toUpperCase();
    return `${mpn}␟${manufacturer}`;
  };

  const shouldEmitPartForGroup = (group, pair) => {
    const identity = partIdentity(pair);
    if (!identity || identity === '␟') return true;
    const emittedParts = emittedPartsByGroup.get(group) || new Set();
    if (emittedParts.has(identity)) return false;
    emittedParts.add(identity);
    emittedPartsByGroup.set(group, emittedParts);
    return true;
  };

  const splitParts = (row) => {
    const rawMpn = getCell(row, mpnColumn);
    const rawManufacturer = getCell(row, manufacturerColumn);
    const packedPairs = mpnColumn && mpnColumn === manufacturerColumn
      ? getPatternAwarePackedPairs(row, mpnColumn, rawMpn, config)
      : [];
    if (packedPairs.length) return packedPairs;

    const mpns = splitMpnCell(rawMpn, parserConfig);
    const manufacturers = splitManufacturerCell(rawManufacturer, mpns.length || null, parserConfig);
    if (mpns.length) return pairMpnsWithManufacturers(mpns, manufacturers, rawManufacturer);
    if (rawMpn || rawManufacturer) {
      return [{
        mpn: stripVendorPrefix(rawMpn),
        manufacturer: rawManufacturer,
        metadata: {},
      }];
    }
    return [];
  };

  const hasPrimaryContext = (row) => {
    if (strictContextMarker) {
      const contextValue = getCell(row, contextColumn);
      if (!contextValue) return false;
      const hasContextDetail = Boolean(
        getCell(row, roles.parent) ||
        getCell(row, roles.cpn) ||
        getCell(row, roles.description) ||
        getCell(row, roles.quantity) ||
        getCell(row, roles.uom)
      );
      if (normalizeKey(contextColumn) === normalizeKey(mpnColumn) && !hasContextDetail) return false;
      return true;
    }
    // A mapped parent column IS the marker, so it decides alone. It names the
    // assembly a row belongs to, and only a real item row carries one — the
    // sparse rows below it are blank there by definition.
    //
    // Letting description vote alongside it broke every sheet whose ALTERNATE
    // rows carry a description of their own: THALES' Y2 export repeats the part
    // name on each approved manufacturer, so all 2244 of them read as new items
    // rather than alternates, arriving with no parent, no quantity and the
    // manufacturer's own code as their CPN.
    if (roles.parent) return Boolean(getCell(row, roles.parent));
    return Boolean(
      getCell(row, roles.description) ||
      getCell(row, roles.quantity) ||
      getCell(row, roles.uom)
    );
  };

  const groupFromRow = (row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const level = rowLevel(row, roles) || '1';
    const cpn = getCell(row, roles.cpn) || getCell(row, itemColumn);
    const description = getCell(row, roles.description);
    const parent = hierarchyParent(row, roles);
    const contextValue = contextColumn ? getCell(row, contextColumn) : '';
    // The marker column answers "does this row start a new item?" - by being
    // filled rather than blank. It does NOT answer "which item is this?", and
    // leading with it here made it do both. A marker whose value repeats then
    // becomes one identity for every row under it: a THALES sheet marking new
    // items with the ASSEMBLY code put all 726 of its parts on a single BOM
    // line, 725 of them arriving as "alternates" of whichever came first.
    //
    // So the part number leads. The marker stays as the fallback for sheets that
    // mark items with a line number and carry no separate code - there `cpn` is
    // blank, so those read exactly as before.
    const identity = cpn || contextValue || description || `Source row ${sourceRow}`;
    return {
      sourceRow,
      parentKey: parent ? `${parent}␟${identity}` : `L${level}␟${identity}`,
      parent,
      level,
      cpn,
      description,
      quantity: getCell(row, roles.quantity),
      uom: getCell(row, roles.uom),
      relationCount: 0,
    };
  };

  // A marked row carrying no MPN/MFR of its own is normally just the header of a
  // group whose parts arrive on the rows below, so emitting it too would double
  // every line. But nothing guarantees those rows exist: a part a customer makes
  // themselves - a bare PCB, firmware, a sub-assembly - has no external
  // manufacturer to list. Discarding the header outright dropped 11 real parts
  // from one THALES BOM, the sub-assembly among them, which is why that BOM came
  // out with no second level.
  //
  // So the header is held rather than dropped, and emitted with a blank
  // manufacturer only once the next group starts (or the sheet ends) without one
  // having turned up.
  let pendingContext = null;

  const flushPendingContext = () => {
    if (!pendingContext) return;
    const { group, row, rowIndex } = pendingContext;
    pendingContext = null;
    output.push(withSourceColumns({
      ...group,
      sourceRow: row.__sourceRow || rowIndex + 1,
      relation: 'Primary',
      cpn: group.cpn || getCell(row, itemColumn),
      mpn: '',
      manufacturer: '',
      rule: 'following_item_rows_primary_without_manufacturer',
      confidence: 62,
      discardedText: '',
    }, row, config));
    group.relationCount = Math.max(1, Number(group.relationCount || 0));
  };

  rows.forEach((row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const itemValue = getCell(row, itemColumn);
    const parts = splitParts(row).filter((pair) => pair?.mpn || pair?.manufacturer);
    const isContextRow = hasPrimaryContext(row);
    const canAttachAsAlternate = Boolean(currentGroup && !isContextRow && (
      strictContextMarker ? parts.length : (itemValue || parts.length)
    ));

    if (canAttachAsAlternate) {
      // The manufacturer row this group was waiting for. It becomes the primary,
      // so the held header must not also be emitted.
      if (pendingContext && pendingContext.group === currentGroup) pendingContext = null;
      const pairs = parts.length ? parts : [{ mpn: '', manufacturer: '', metadata: {} }];
      pairs.forEach((pair) => {
        if (!shouldEmitPartForGroup(currentGroup, pair)) return;
        const relationIndex = Number(currentGroup.relationCount || 0);
        output.push(withSourceColumns({
          sourceRow,
          parentKey: currentGroup.parentKey,
          parent: currentGroup.parent,
          relation: relationIndex === 0 ? 'Primary' : `Alternate ${relationIndex}`,
          level: currentGroup.level,
          cpn: cpnAutofillMode === 'column' ? (itemValue || currentGroup.cpn) : currentGroup.cpn,
          description: currentGroup.description,
          mpn: pair.mpn,
          manufacturer: pair.manufacturer,
          quantity: currentGroup.quantity,
          uom: currentGroup.uom,
          rule: 'following_item_rows_alternate',
          confidence: Math.min(confidenceForRow(pair.mpn, pair.manufacturer, 'following_rows') + 8, 96),
          discardedText: '',
          ...pair.metadata,
        }, row, config));
        currentGroup.relationCount = relationIndex + 1;
      });
      return;
    }

    if (!isContextRow && !itemValue && !parts.length) return;

    // Any previous header still waiting has now run out of rows to be followed
    // by, so settle it before this row takes over as the current group.
    flushPendingContext();

    const group = groupFromRow(row, rowIndex);
    currentGroup = group;
    // Held, not dropped: a marked row with no MPN/MFR is usually the header of a
    // group whose parts arrive below, but nothing guarantees they will. A part
    // the customer makes themselves - a bare PCB, firmware, a sub-assembly - has
    // no external manufacturer to list, and discarding those took 11 real parts
    // out of one THALES BOM, its sub-assembly among them. flushPendingContext
    // emits it only once the next group starts without a manufacturer showing up.
    // A mapped parent column marks a real item row just as an explicit context
    // column does, and this must not depend on which of the two the sheet uses:
    // gating the hold on the marker alone meant that once that control went
    // away, every customer-made part - one with no external manufacturer to
    // list - fell through to the drop below and vanished again.
    if (isContextRow && !parts.length && (strictContextMarker || getCell(row, roles.parent))) {
      pendingContext = { group, row, rowIndex };
      return;
    }
    // Outside the marked case this stays a plain drop, as the Safran work made
    // it. A row with no marker AND no part is not a line anyone stated.
    if (!parts.length) {
      return;
    }
    const pairs = parts.length ? parts : [{ mpn: '', manufacturer: '', metadata: {} }];
    let emittedPairCount = 0;
    pairs.forEach((pair) => {
      if (!shouldEmitPartForGroup(group, pair)) return;
      output.push(withSourceColumns({
        ...group,
        relation: emittedPairCount === 0 ? 'Primary' : `Alternate ${emittedPairCount}`,
        cpn: cpnAutofillMode === 'column' ? (itemValue || group.cpn) : group.cpn,
        mpn: pair.mpn,
        manufacturer: pair.manufacturer,
        rule: 'following_item_rows_primary',
        confidence: pair.mpn || pair.manufacturer
          ? confidenceForRow(pair.mpn, pair.manufacturer, 'following_rows')
          : 62,
        discardedText: '',
        ...pair.metadata,
      }, row, config));
      emittedPairCount += 1;
    });
    currentGroup.relationCount = Math.max(1, emittedPairCount);
  });

  // The last group in the sheet has no following row to settle it.
  flushPendingContext();

  return output;
};

const normalizeAlternateColumns = (rows, headers, roles, config) => {
  const output = [];
  const manualGroups = cleanAlternateColumnGroups(config.alternateColumnGroups || [], headers);
  const alternateGroups = manualGroups.length ? manualGroups : findAlternateColumnGroups(headers);
  const useManufacturerColumns = Boolean(roles.manufacturer) && !String(config.structure || '').startsWith('mpn_only');
  rows.forEach((row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const primaryMpn = getCell(row, roles.mpn);
    const primaryManufacturer = useManufacturerColumns ? getCell(row, roles.manufacturer) : '';
    const primaryQty = getCell(row, roles.quantity);
    const primaryUom = getCell(row, roles.uom);
    const rawParentKey = getCell(row, roles.parent);
    const description = getCell(row, roles.description);
    const parentKey = alternatesKey(row, roles, sourceRow);
    const parent = hierarchyParent(row, roles);
    const level = rowLevel(row, roles) || '1';
    const cpn = getCell(row, roles.cpn);
    const hasBomIdentity = Boolean(cpn || description || rawParentKey);
    let emittedAnyPart = false;
    let relationCount = 0;

    const emitPartsFromCells = ({
      mpnValue,
      manufacturerValue,
      quantity,
      uom,
      rule,
    }) => {
      if (!mpnValue) return;
      const mpnParts = splitMpnCell(mpnValue, config);
      const partsToEmit = mpnParts.length ? mpnParts : [stripVendorPrefix(mpnValue)].filter(Boolean);
      const manufacturerParts = useManufacturerColumns
        ? splitManufacturerCell(manufacturerValue, partsToEmit.length, config)
        : [];
      const partCount = Math.max(partsToEmit.length, manufacturerParts.length || 0);
      Array.from({ length: partCount }).forEach((_, partIndex) => {
        const mpn = partsToEmit[partIndex] || partsToEmit[0] || '';
        const manufacturer = manufacturerParts[partIndex] ||
          manufacturerParts[0] ||
          stripCircledNumberMarkers(manufacturerValue);
        output.push(withSourceColumns({
          sourceRow,
          parentKey,
          parent,
          relation: relationCount === 0 ? 'Primary' : `Alternate ${relationCount}`,
          level,
          cpn,
          description,
          mpn: stripVendorPrefix(mpn),
          manufacturer,
          quantity,
          uom,
          rule,
          confidence: confidenceForRow(mpn, manufacturer, 'alternate_columns'),
          discardedText: '',
        }, row, config));
        relationCount += 1;
        emittedAnyPart = true;
      });
    };

    if (primaryMpn) {
      emitPartsFromCells({
        mpnValue: primaryMpn,
        manufacturerValue: primaryManufacturer,
        quantity: primaryQty,
        uom: primaryUom,
        rule: 'alternate_columns_primary',
      });
    }

    alternateGroups.forEach((group) => {
      const mpn = getCell(row, group.mpn);
      if (!mpn) return;
      const manufacturer = useManufacturerColumns
        ? getCell(row, group.mfr) || (config.manufacturerMode === 'inherit_blank' ? primaryManufacturer : '')
        : '';
      emitPartsFromCells({
        mpnValue: mpn,
        manufacturerValue: manufacturer,
        quantity: config.quantityMode === 'alternate_columns' ? getCell(row, group.qty) || primaryQty : primaryQty,
        uom: config.quantityMode === 'alternate_columns' ? getCell(row, group.uom) || primaryUom : primaryUom,
        rule: 'alternate_columns_unpivot',
      });
    });

    if (!emittedAnyPart && hasBomIdentity) {
      output.push(withSourceColumns({
        sourceRow,
        parentKey,
        parent,
        relation: 'Primary',
        level,
        cpn,
        description,
        mpn: '',
        manufacturer: primaryManufacturer,
        quantity: primaryQty,
        uom: primaryUom,
        rule: 'alternate_columns_item_without_mpn_mfr',
        confidence: 68,
        discardedText: '',
      }, row, config));
    }
  });
  return output;
};

const normalizeOnePerRow = (rows, roles, config = {}) => rows.map((row, rowIndex) => {
  const sourceRow = row.__sourceRow || rowIndex + 1;
  const mpn = stripVendorPrefix(getCell(row, roles.mpn));
  const manufacturer = getCell(row, roles.manufacturer);
  return withSourceColumns({
    sourceRow,
    parentKey: alternatesKey(row, roles, sourceRow),
    parent: hierarchyParent(row, roles),
    relation: 'Primary',
    level: rowLevel(row, roles) || '1',
    cpn: getCell(row, roles.cpn),
    description: getCell(row, roles.description),
    mpn,
    manufacturer,
    quantity: getCell(row, roles.quantity),
    uom: getCell(row, roles.uom),
    rule: 'one_per_row_passthrough',
    confidence: confidenceForRow(mpn, manufacturer, 'one_per_row'),
    discardedText: '',
  }, row, config);
}).filter((row) => row.mpn || row.manufacturer || row.description);

const normalizeAssemblyQuantityMatrix = (rows, headers, roles, config = {}) => {
  const matrix = detectAssemblyQuantityMatrix(headers, rows, roles) || config.assemblyMatrix;
  if (!matrix?.assemblyColumns?.length) return [];
  const assemblyColumns = filterQuantityVariantHeaders(matrix.assemblyColumns, config);
  if (!assemblyColumns.length) return [];

  const output = [];
  rows.forEach((row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const partNumber = stripCircledNumberMarkers(getCell(row, matrix.partNumberColumn));
    const description = stripCircledNumberMarkers(getCell(row, matrix.descriptionColumn));
    const findNumber = stripCircledNumberMarkers(getCell(row, matrix.findNumberColumn));
    if (!partNumber && !description) return;

    assemblyColumns.forEach((assemblyColumn) => {
      const rawQuantity = stripCircledNumberMarkers(getCell(row, assemblyColumn));
      if (!isMatrixQuantityPresent(rawQuantity)) return;
      const quantityInfo = normalizeAssemblyMatrixQuantity(rawQuantity);

      const assemblyKey = fmt(assemblyColumn);
      const assemblyCode = /^0*\d{1,4}$/.test(assemblyKey) ? `ASSY-${assemblyKey.padStart(3, '0')}` : assemblyKey;
      const enrichedDescription = quantityInfo.note
        ? `${description}${description ? ' ' : ''}(${quantityInfo.note})`
        : description;
      output.push(withSourceColumns({
        sourceRow,
        parentKey: `${assemblyKey}␟${partNumber || description || sourceRow}`,
        parent: assemblyCode,
        relation: 'Primary',
        level: '1',
        cpn: stripCircledNumberMarkers(getCell(row, roles.cpn)),
        description: enrichedDescription,
        mpn: partNumber,
        manufacturer: '',
        quantity: quantityInfo.quantity,
        uom: getCell(row, roles.uom),
        rule: 'assembly_quantity_matrix',
        confidence: 90,
        discardedText: findNumber ? `Find No: ${findNumber}` : '',
      }, row, config));
    });
  });

  return output;
};

const rowsLookLikeMultiBlockAssembly = (headers = [], rows = []) => (
  headers.includes('__multiBlockMode') &&
  rows.some((row) => row?.__multiBlockMode === '1' && row?.__blockId)
);

const selectedBomLayout = (config = {}) => (
  config.bomLayout && config.bomLayout !== 'none' ? config.bomLayout : ''
);

const effectiveStructure = (config = {}) => selectedBomLayout(config) || config.structure;

const rolesForMultiBlockAssembly = (headers = [], fallbackRoles = emptyRoles) => {
  if (!headers.includes('__multiBlockMode')) return fallbackRoles;
  return {
    ...fallbackRoles,
    cpn: headers.includes('Reference D/N') ? 'Reference D/N' : fallbackRoles.cpn,
    mpn: headers.includes('Parts Name') ? 'Parts Name' : fallbackRoles.mpn,
    manufacturer: headers.includes('Parts Maker') ? 'Parts Maker' : fallbackRoles.manufacturer,
    description: headers.includes('Description') ? 'Description' : fallbackRoles.description,
    quantity: headers.includes('Quantity') ? 'Quantity' : fallbackRoles.quantity,
    parent: headers.includes('BOM block') ? 'BOM block' : fallbackRoles.parent,
  };
};

const multiplyQuantities = (parentQuantity, childQuantity) => {
  const parent = fmt(parentQuantity);
  const child = fmt(childQuantity);
  const parse = (value) => {
    const normalized = value.replace(',', '.');
    return /^-?\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : null;
  };
  const parentNumber = parse(parent);
  const childNumber = parse(child);
  if (parentNumber === null || childNumber === null) return child || parent;
  const result = parentNumber * childNumber;
  return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(6)));
};

const buildMultiBlockAssemblyIndex = (rows = []) => {
  const blocks = new Map();
  rows.forEach((row) => {
    const blockId = row.__blockId;
    if (!blockId) return;
    if (!blocks.has(blockId)) {
      blocks.set(blockId, {
        id: blockId,
        title: row.__blockTitle || row['BOM block'] || blockId,
        name: row.__blockName || row['BOM block'] || row.__blockTitle || blockId,
        codes: fmt(row.__blockCodes).split('|').map(fmt).filter(Boolean),
        rows: [],
      });
    }
    blocks.get(blockId).rows.push(row);
  });

  const blocksByCode = new Map();
  blocks.forEach((block) => {
    block.codes.forEach((code) => {
      const key = normalizeKey(code);
      if (!key) return;
      if (!blocksByCode.has(key)) blocksByCode.set(key, []);
      blocksByCode.get(key).push(block);
    });
  });

  const references = new Map();
  const findLinkedBlock = (row, currentBlockId = '') => {
    const rowCodes = extractAssemblyCodes([
      row['Reference D/N'],
      row.Description,
      row['Parts Name'],
      row.Remarks,
    ].join(' '));
    const candidates = [];
    rowCodes.forEach((code) => {
      (blocksByCode.get(normalizeKey(code)) || []).forEach((block) => {
        if (block.id !== currentBlockId && !candidates.includes(block)) candidates.push(block);
      });
    });
    if (!candidates.length) return null;
    const descriptionKey = normalizeKey(row.Description);
    const best = candidates.find((block) => {
      const nameKey = normalizeKey(block.name);
      return nameKey && descriptionKey && (descriptionKey.includes(nameKey) || nameKey.includes(descriptionKey));
    });
    return best || candidates[0];
  };

  blocks.forEach((block) => {
    block.rows.forEach((row) => {
      const linked = findLinkedBlock(row, block.id);
      if (linked) references.set(linked.id, true);
    });
  });

  const rootBlocks = [...blocks.values()].filter((block) => !references.has(block.id));
  return {
    blocks,
    rootBlocks: rootBlocks.length ? rootBlocks : [...blocks.values()].slice(0, 1),
    findLinkedBlock,
  };
};

const normalizeMultiBlockAssembly = (rows, roles, config = {}) => {
  const filteredRows = filterRowsByQuantityVariant(rows, config);
  const index = buildMultiBlockAssemblyIndex(filteredRows);
  const output = [];
  const emittedSubtreeKeys = new Set();

  const emitMaterialRow = (row, block, level, parentName, quantityOverride = '') => {
    const sourceRow = row.__sourceRow || '';
    const rawMpn = getCell(row, roles.mpn) || row['Parts Name'];
    const rawManufacturer = getCell(row, roles.manufacturer) || row['Parts Maker'];
    const mpns = splitMpnCell(rawMpn, config);
    const manufacturers = splitManufacturerCell(rawManufacturer, mpns.length || null, config);
    const partsToEmit = mpns.length ? mpns : [''];
    const cpn = getCell(row, roles.cpn) || row['Reference D/N'];
    const description = getCell(row, roles.description) || row.Description;
    const quantity = quantityOverride || getCell(row, roles.quantity) || row.Quantity;
    const parentKey = `${block.id}::${row['Quantity variant'] || ''}::${cpn || description || sourceRow}`;

    partsToEmit.forEach((mpn, partIndex) => {
      output.push(withSourceColumns({
        sourceRow,
        parentKey,
        parent: parentName,
        relation: partIndex === 0 ? 'Primary' : `Alternate ${partIndex}`,
        level: String(level),
        cpn,
        description,
        mpn: stripVendorPrefix(mpn),
        manufacturer: manufacturers[partIndex] || manufacturers[0] || rawManufacturer,
        quantity,
        uom: getCell(row, roles.uom),
        rule: 'multi_block_assembly',
        confidence: Math.min(confidenceForRow(mpn, manufacturers[partIndex] || rawManufacturer, 'multi_block_assembly') + 15, 98),
        discardedText: [
          row['Part number'] ? `Ref designator: ${row['Part number']}` : '',
          row['Quantity variant'] ? `Variant: ${row['Quantity variant']}` : '',
        ].filter(Boolean).join(' | '),
      }, row, config));
    });
  };

  const visitBlock = (block, level, parentName, inheritedQuantity = '', path = []) => {
    if (!block || path.includes(block.id)) return;
    const nextPath = [...path, block.id];
    block.rows.forEach((row) => {
      const cpn = getCell(row, roles.cpn) || row['Reference D/N'];
      const description = getCell(row, roles.description) || row.Description;
      const rawQuantity = getCell(row, roles.quantity) || row.Quantity;
      if (!cpn && !description && !getCell(row, roles.mpn) && !getCell(row, roles.manufacturer)) return;
      const quantity = inheritedQuantity
        ? multiplyQuantities(inheritedQuantity, rawQuantity)
        : rawQuantity;
      const linkedBlock = index.findLinkedBlock(row, block.id);

      emitMaterialRow(row, block, level, parentName || block.name, quantity);

      if (linkedBlock) {
        const subtreeKey = `${block.id}::${row.__sourceRow}::${row['Quantity variant'] || ''}::${linkedBlock.id}`;
        if (!emittedSubtreeKeys.has(subtreeKey)) {
          emittedSubtreeKeys.add(subtreeKey);
          visitBlock(linkedBlock, level + 1, description || cpn || linkedBlock.name, quantity, nextPath);
        }
      }
    });
  };

  index.rootBlocks.forEach((block) => visitBlock(block, 1, block.name));
  return output;
};

const normalizeSameGroupRows = (rows, roles, config = {}) => {
  const seenByGroup = new Map();

  const getGroupKey = (row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const contextualParts = [
      getCell(row, roles.parent),
      getCell(row, roles.description),
      getCell(row, roles.quantity),
      getCell(row, roles.uom),
      getCell(row, roles.level),
    ].filter((value) => !isPlaceholderCell(value));
    const fallback = getCell(row, roles.cpn) || getCell(row, roles.mpn) || getCell(row, roles.manufacturer) || `Source row ${sourceRow}`;
    const parts = contextualParts.length ? contextualParts : [fallback];
    return parts.map(normalizeKey).filter(Boolean).join('::') || `row-${sourceRow}`;
  };

  return rows.map((row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const mpn = stripVendorPrefix(getCell(row, roles.mpn));
    const manufacturer = getCell(row, roles.manufacturer);
    const groupKey = getGroupKey(row, rowIndex);
    const groupIndex = seenByGroup.get(groupKey) || 0;
    seenByGroup.set(groupKey, groupIndex + 1);
    const parentKey = alternatesKey(row, roles, sourceRow);
    const parent = hierarchyParent(row, roles);

    return withSourceColumns({
      sourceRow,
      parentKey,
      parent,
      relation: groupIndex === 0 ? 'Primary' : `Alternate ${groupIndex}`,
      level: rowLevel(row, roles) || '1',
      cpn: getCell(row, roles.cpn),
      description: getCell(row, roles.description),
      mpn,
      manufacturer,
      quantity: getCell(row, roles.quantity),
      uom: getCell(row, roles.uom),
      rule: 'same_group_rows_rebalance',
      confidence: Math.min(confidenceForRow(mpn, manufacturer, 'same_group_rows') + (groupIndex > 0 ? 12 : 6), 98),
      discardedText: '',
    }, row, config);
  }).filter((row) => row.mpn || row.manufacturer || row.description);
};

const normalizeManufacturerOnly = (rows, roles, config, splitCells) => {
  const output = [];
  rows.forEach((row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const manufacturers = splitCells
      ? splitManufacturerCell(getCell(row, roles.manufacturer), null, config)
      : [getCell(row, roles.manufacturer)].filter(Boolean);
    const parentKey = alternatesKey(row, roles, sourceRow);
    const parent = hierarchyParent(row, roles);
    const level = rowLevel(row, roles) || '1';
    const cpn = getCell(row, roles.cpn);

    manufacturers.forEach((manufacturer, partIndex) => {
      output.push(withSourceColumns({
        sourceRow,
        parentKey,
        parent,
        relation: partIndex === 0 ? 'Primary' : `Alternate ${partIndex}`,
        level,
        cpn,
        description: getCell(row, roles.description),
        mpn: '',
        manufacturer,
        quantity: getCell(row, roles.quantity),
        uom: getCell(row, roles.uom),
        rule: splitCells ? 'manufacturer_only_user_delimiter' : 'manufacturer_only_row',
        confidence: manufacturer ? 70 : 45,
        discardedText: '',
      }, row, config));
    });
  });
  return output;
};

const normalizeGroupedRows = (rows, roles, config) => {
  const output = [];
  let currentGroup = null;

  const groupValuesFromRow = (row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const cpn = getCell(row, roles.cpn);
    const parentKey = alternatesKey(row, roles, sourceRow);
    const parent = hierarchyParent(row, roles);
    return {
      sourceRow,
      parentKey,
      parent,
      cpn,
      description: getCell(row, roles.description),
      quantity: getCell(row, roles.quantity),
      uom: getCell(row, roles.uom),
      level: rowLevel(row, roles) || '1',
      relationCount: 0,
    };
  };

  // Is this row a PART, or a section header introducing the rows below it?
  //
  // Having an MPN or a manufacturer proves it is a part - somebody sells it. But
  // the reverse does not hold, and assuming it did was costly: an in-house
  // assembly has neither, because nobody sells it. On one customer file every
  // one of its 78 assemblies was read as a header, consumed as a label and never
  // emitted, so every parent reference in the BOM pointed at a row that did not
  // exist and the tree could not be built at all.
  //
  // A part number together with a real quantity is the sheet stating that the
  // row is consumed - which a section header never is.
  const rowIsPart = (row) => {
    if (getCell(row, roles.mpn) || getCell(row, roles.manufacturer)) return true;
    const quantity = getCell(row, roles.quantity);
    return Boolean(getCell(row, roles.cpn) && quantity && !isPlaceholderCell(quantity));
  };

  const rowStartsGroup = (row) => {
    const nextParentKey = statedParent(row, roles) || getCell(row, roles.cpn) || getCell(row, roles.description);
    const hasIdentity = Boolean(getCell(row, roles.parent) || getCell(row, roles.cpn) || getCell(row, roles.description));
    const hasRealContext = Boolean(
      !isPlaceholderCell(getCell(row, roles.quantity)) ||
      !isPlaceholderCell(getCell(row, roles.uom)) ||
      !isPlaceholderCell(getCell(row, roles.level))
    );
    const hasPart = rowIsPart(row);
    if (hasPart) {
      if (!currentGroup) return hasIdentity && hasRealContext;
      return Boolean(nextParentKey && nextParentKey !== currentGroup.parentKey && hasRealContext);
    }
    return hasIdentity;
  };

  rows.forEach((row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const rawMpn = getCell(row, roles.mpn);
    const manufacturer = getCell(row, roles.manufacturer);
    // Same test as rowStartsGroup, so a row cannot be a part for one decision
    // and a header for the other.
    const rowHasPart = rowIsPart(row);
    const startsGroup = rowStartsGroup(row);

    if (startsGroup || !currentGroup) {
      const nextGroup = groupValuesFromRow(row, rowIndex);
      currentGroup = currentGroup && !startsGroup ? {
        ...currentGroup,
        ...Object.fromEntries(Object.entries(nextGroup).filter(([, value]) => value)),
      } : nextGroup;

      const contextPrimaryMpn = currentGroup.cpn || statedParent(row, roles);
      const shouldEmitHeaderPrimary = config.groupHeaderMode === 'header_primary';
      if (startsGroup && !rowHasPart && contextPrimaryMpn && shouldEmitHeaderPrimary) {
        const primaryMpn = contextPrimaryMpn;
        output.push(withSourceColumns({
          sourceRow: currentGroup.sourceRow || sourceRow,
          parentKey: currentGroup.parentKey,
          // Carried like parentKey. Dropping it left the BOM parent blank on
          // every row this strategy emits, so the backend fell back to inferring
          // structure from levels and reported orphans on a sheet that states
          // its parents outright.
          parent: currentGroup.parent,
          relation: 'Primary',
          level: currentGroup.level || '1',
          cpn: currentGroup.cpn,
          description: currentGroup.description,
          mpn: stripVendorPrefix(primaryMpn),
          manufacturer: '',
          quantity: currentGroup.quantity,
          uom: currentGroup.uom,
          rule: 'grouped_rows_context_primary',
          confidence: confidenceForRow(primaryMpn, '', 'grouped_rows'),
          discardedText: '',
        }, row, config));
        currentGroup.relationCount = 1;
      }
    }

    if (!rowHasPart) return;

    const mpns = splitMpnCell(rawMpn, config);
    const manufacturerParts = rawMpn && manufacturer
      ? splitManufacturerCell(manufacturer, mpns.length, config)
      : [manufacturer].filter(Boolean);
    const relationStart = currentGroup.relationCount;

    const partsToEmit = mpns.length ? mpns : [''];
    partsToEmit.forEach((mpn, partIndex) => {
      const relationIndex = relationStart + partIndex;
      output.push(withSourceColumns({
        sourceRow: currentGroup.sourceRow || sourceRow,
        parentKey: currentGroup.parentKey,
        parent: currentGroup.parent || hierarchyParent(row, roles),
        relation: relationIndex === 0 ? 'Primary' : `Alternate ${relationIndex}`,
        level: currentGroup.level || rowLevel(row, roles) || '1',
        cpn: currentGroup.cpn || getCell(row, roles.cpn),
        description: currentGroup.description || getCell(row, roles.description),
        mpn: stripVendorPrefix(mpn),
        manufacturer: manufacturerParts[partIndex] || manufacturerParts[0] || manufacturer,
        quantity: currentGroup.quantity || getCell(row, roles.quantity),
        uom: currentGroup.uom || getCell(row, roles.uom),
        rule: mpns.length > 1 ? 'grouped_rows_split_child_mpn' : 'grouped_rows_inherit_context',
        confidence: Math.min(confidenceForRow(mpn, manufacturerParts[partIndex] || manufacturer, 'grouped_rows') + 10, 98),
        discardedText: '',
      }, row, config));
    });

    currentGroup.relationCount += partsToEmit.length;
  });

  return output;
};

// Stamp each row with the parent its level implies, for sheets that state no
// parent of their own.
//
// The walk is the same rule the backend applies to level-only sheets — a row's
// parent is the nearest preceding row one level shallower — but done HERE, once,
// and written down. That matters for three reasons:
//
//   1. It is derived where the answer is known. The user picked the level and
//      code columns at Configure; the popup had to guess them with a regex,
//      picked `cpn`, and `cpn` was holding the parent. Deriving twice from two
//      different guesses is what produced that bug.
//   2. Row order stops mattering after this point. The walk needs tree order;
//      everything downstream reads a stored value, so a later sort cannot
//      silently reshape the tree.
//   3. Two placements of one part at the SAME level under different assemblies
//      get different parents, so they stay distinct. `parentKey`'s level
//      fallback merged them — the honeywell case in BOM_KNOWN_GAPS.
//
// Written onto the row as `__inferredParent` rather than into the parent column
// itself, so a sheet that DOES state its parent is untouched and the two can
// never be confused.
const stampInferredParents = (rows, roles) => {
  if (!rows?.length) return rows;

  // Clear before deciding whether to write. Rows are the SAME objects across
  // re-runs, so bailing out early used to leave the previous run's stamps in
  // place — map a real Parent column, re-run, and every row whose stated parent
  // cell happens to be blank still falls back to a value inferred under the old
  // configuration. One tree built from two different derivations.
  const clear = () => rows.forEach((row) => { delete row[LEVEL_PARENT_KEY]; });

  // A stated parent always wins; there is nothing to infer.
  if (!roles?.level || roles.parent) { clear(); return rows; }
  const codeRole = roles.cpn || roles.description;
  if (!codeRole) { clear(); return rows; }
  clear();

  // Index = depth. Holds the most recent code seen at each level.
  const openAt = [];
  rows.forEach((row) => {
    const rawLevel = String(getCell(row, roles.level) ?? '').trim();
    const level = Number(rawLevel);
    if (!rawLevel || !Number.isFinite(level) || !Number.isInteger(level) || level < 0) return;
    const code = getCell(row, codeRole);

    // A level JUMP (1 -> 3) leaves the skipped tier empty. The nearest open
    // ancestor is used rather than nothing: attaching the row one level too
    // high keeps it in the tree, where dropping its parent would orphan it.
    let parent = '';
    for (let depth = level - 1; depth >= 0; depth -= 1) {
      if (openAt[depth]) { parent = openAt[depth]; break; }
    }
    row[LEVEL_PARENT_KEY] = parent;

    if (code) {
      openAt[level] = code;
      // Anything deeper belonged to a branch this row just closed.
      openAt.length = level + 1;
    }
  });
  return rows;
};

// Separators a breadcrumb path might be written with. '/' and '\' are included
// because some exports use them, but a part number can legitimately contain one
// (THALES ships 'QCPF11/041'), so a separator is only ever adopted when it
// demonstrably resolves more parents than leaving the value alone.
const PATH_SEPARATORS = ['>', '::', '|', '\\', '/'];

// A candidate is rejected if it leaves more than this share of rows pointing at
// a parent that does not exist. Not zero: one malformed row should not veto a
// reading that works for the other eight hundred.
const PATH_UNRESOLVED_TOLERANCE = 0.05;

// Pull the parent's code out of one breadcrumb path.
const pathParent = (value, separator, takeLeaf) => {
  const segments = String(value).split(separator).map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return '';
  // The path names the parent, so its last segment is the parent.
  if (takeLeaf) return segments[segments.length - 1];
  // The path is the row's own trail, so the parent is the segment before the
  // row itself. A one-segment trail is the root and has no parent.
  return segments.length > 1 ? segments[segments.length - 2] : '';
};

// Read breadcrumb-path parents as plain parent codes, stamped onto each row.
//
// A sheet may answer "what is this row's parent?" with a whole path rather than
// a code, and it may write either the parent's path or the row's own path. Both
// are unusable as given: the value is matched against row codes and never
// matches, so the tree comes out as one flat tier under a root nobody can find.
// THALES' ARTDOC export does this — ">E36047BB01>F1288042" — and its 28
// assemblies came through as 28 assemblies named after their own paths.
//
// Which convention a sheet uses cannot be assumed, so it is measured. Every
// (separator, reading) pair is scored by the number of real parent-child edges
// it produces, and one is adopted only if it beats leaving the values alone.
// Scoring counts edges rather than "did it resolve" on purpose: reading a row's
// own path as its parent's makes every row its own parent, which resolves
// perfectly and yields a tree of roots that says nothing.
//
// A sheet of plain codes contains no separator, scores no candidates, and is
// left untouched. This mirrors _unpack_stated_parent_paths in the backend's
// bom_tree.py, which does the same job too late to reach the popup — by then
// the assembly list the user is asked to name has already been built.
const unpackParentPaths = (rows, roles, config = {}) => {
  if (!rows?.length) return rows;

  // Reading the parent code out of a path is always safe - the value matches
  // nothing as it stands. Reading DEPTH and OWN CODE out of it overrides columns
  // the sheet filled in, so it stays behind a switch the user can see and turn
  // off. Default on: a sheet that writes trails is stating its tree in them.
  const usePathHierarchy = config.parentPathLevels !== false;

  // Clear before deciding whether to write. Rows are the SAME objects across
  // re-runs, so a stamp from a run under different roles would otherwise
  // survive into a run that should have left the column alone. The filled code
  // cell is undone too — it is our writing, not the sheet's.
  const codeRoleForClear = roles?.cpn || roles?.description;
  rows.forEach((row) => {
    delete row[PATH_PARENT_KEY];
    delete row[PATH_DEPTH_KEY];
    delete row[PATH_CODE_KEY];
    if (row[PATH_CODE_FILLED_KEY]) {
      if (codeRoleForClear) row[codeRoleForClear] = '';
      delete row[PATH_CODE_FILLED_KEY];
    }
  });
  if (!roles?.parent) return rows;

  const codeRole = roles.cpn || roles.description;
  if (!codeRole) return rows;

  const stated = rows.filter((row) => getCell(row, roles.parent));
  if (!stated.length) return rows;

  const known = new Set();
  rows.forEach((row) => {
    const code = getCell(row, codeRole);
    if (code) known.add(code);
  });
  const tolerance = stated.length * PATH_UNRESOLVED_TOLERANCE;

  // Edge count for one reading, or null if too much of it dangles.
  const score = (derive) => {
    let edges = 0;
    let unresolved = 0;
    for (const row of stated) {
      const parent = derive(row);
      if (!parent || parent === getCell(row, codeRole)) continue; // a root
      if (!known.has(parent)) {
        unresolved += 1;
        if (unresolved > tolerance) return null;
        continue;
      }
      edges += 1;
    }
    return edges;
  };

  const baseline = score((row) => getCell(row, roles.parent));
  if (baseline !== null && baseline === stated.length) return rows; // already codes

  let best = null;
  PATH_SEPARATORS.forEach((separator) => {
    if (!stated.some((row) => getCell(row, roles.parent).includes(separator))) return;
    [false, true].forEach((takeLeaf) => {
      const edges = score((row) => pathParent(getCell(row, roles.parent), separator, takeLeaf));
      if (edges === null) return;
      if (!best || edges > best.edges) best = { edges, separator, takeLeaf };
    });
  });

  if (!best || best.edges <= (baseline || 0)) return rows;
  stated.forEach((row) => {
    row[PATH_PARENT_KEY] = pathParent(getCell(row, roles.parent), best.separator, best.takeLeaf);
  });

  // Only a row's OWN trail states its depth and its own part number. A path that
  // names the parent says nothing about either.
  if (best.takeLeaf) return rows;

  stated.forEach((row) => {
    const segments = getCell(row, roles.parent)
      .split(best.separator)
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (!segments.length) return;
    row[PATH_CODE_KEY] = segments[segments.length - 1];
    if (!usePathHierarchy) return;
    row[PATH_DEPTH_KEY] = segments.length;
    // Fill only what the sheet left empty. A code the sheet DID state stands,
    // even where it disagrees with the path — overruling it here would silently
    // re-identify parts on every sheet that writes both.
    if (!getCell(row, codeRole)) {
      row[codeRole] = row[PATH_CODE_KEY];
      row[PATH_CODE_FILLED_KEY] = true;
    }
  });
  return rows;
};

// How deep each row sits, worked out by following parent to parent.
//
// A sheet can state its tree in three ways, and only two of them were being
// read. A level column says the depth outright. A breadcrumb path says it in its
// segment count. But a plain parent column says it only IMPLICITLY: a code that
// appears as somebody's child sits one tier below whoever owns it.
//
// Left underived, every row defaults to level 1 and the tiers become
// indistinguishable — a THALES sheet whose sub-assembly is listed as a component
// of the root computed both to the same level, so the structure gate could not
// offer the sub-assembly as a BOM and 726 parts came out flat under the root.
//
// Stamped under the same key the path reading uses, since both answer the same
// question; a row that already carries one is left alone.
const stampParentChainDepth = (rows, roles) => {
  if (!rows?.length || !roles?.parent) return rows;
  // A level column already answers this, and it is the sheet's own statement.
  if (roles.level) return rows;
  const codeRole = roles.cpn || roles.description;
  if (!codeRole) return rows;

  // Whose child is each code? Read off the row that carries the code itself.
  const parentOf = new Map();
  rows.forEach((row) => {
    const code = getCell(row, codeRole);
    if (!code || parentOf.has(code)) return;
    const parent = hierarchyParent(row, roles);
    if (parent && parent !== code) parentOf.set(code, parent);
  });

  // Depth of a code: 1 when nobody owns it, otherwise one below its owner. The
  // seen-set is a cycle guard — a sheet that lists A inside B inside A would
  // otherwise recurse forever.
  const depthCache = new Map();
  const depthOf = (code) => {
    if (depthCache.has(code)) return depthCache.get(code);
    let depth = 1;
    let current = code;
    const seen = new Set([code]);
    while (parentOf.has(current)) {
      const next = parentOf.get(current);
      if (seen.has(next)) break;
      seen.add(next);
      current = next;
      depth += 1;
    }
    depthCache.set(code, depth);
    return depth;
  };

  rows.forEach((row) => {
    if (row[PATH_DEPTH_KEY]) return;
    const parent = hierarchyParent(row, roles);
    if (!parent) return;
    // The row sits one tier below the assembly holding it.
    row[PATH_DEPTH_KEY] = depthOf(parent) + 1;
  });
  return rows;
};

// Every pass below walks the WHOLE sheet to decide what it writes, so they run
// once over every row before anything is split up. `prepared` is how the chunked
// caller says it has already done that: re-running them on a 50-row slice clears
// the sheet-wide answer and replaces it with whatever that slice can see on its
// own, which for unpackParentPaths is usually nothing at all. That produced a
// half-unpacked sheet — plain codes from the chunks that happened to contain
// enough of the tree, raw paths from the ones that did not.
const normalizeRows = (rows, headers, roles, config, prepared = false) => {
  if (!prepared) {
    stampInferredParents(rows, roles);
    unpackParentPaths(rows, roles, config);
    stampParentChainDepth(rows, roles);
  }
  const layoutStructure = effectiveStructure(config);
  const assemblyMatrix = layoutStructure === 'assembly_quantity_matrix'
    ? (detectAssemblyQuantityMatrix(headers, rows, roles) || config.assemblyMatrix)
    : config.assemblyMatrix;
  const configWithSourceHeaders = {
    ...config,
    assemblyMatrix,
    sourceHeaders: headers,
    roleOutputHeaders: {
      Notes: roles.notes,
      'Internal notes': roles.internalNotes,
    },
    consumedSourceHeaders: getConsumedSourceHeaders(roles, { ...config, assemblyMatrix }, headers),
  };
  if (layoutStructure === 'assembly_quantity_matrix') {
    return normalizeAssemblyQuantityMatrix(rows, headers, roles, configWithSourceHeaders);
  }
  if (layoutStructure === 'multi_block_assembly') {
    return normalizeMultiBlockAssembly(rows, roles, configWithSourceHeaders);
  }
  if (config.alternateLayout === 'following_item_rows') return normalizeFollowingItemRows(rows, roles, configWithSourceHeaders);
  if (config.alternateLayout === 'following_rows') return normalizeFollowingRows(rows, roles, configWithSourceHeaders);
  // Every structure option describes how MPN/MFR pairs are laid out. With
  // neither column present they are all meaningless, and the default would emit
  // nothing — so pass rows through, keeping level, code, quantity, description.
  if (!roles.mpn && !roles.manufacturer) {
    return normalizeOnePerRow(rows, roles, configWithSourceHeaders);
  }
  if (config.structure === 'grouped_rows') return normalizeGroupedRows(rows, roles, configWithSourceHeaders);
  if (config.alternateLayout === 'separate_columns') return normalizeAlternateColumns(rows, headers, roles, configWithSourceHeaders);
  if (config.structure === 'mpn_only_same_cell') return normalizeSeparateCells(rows, roles, configWithSourceHeaders);
  if (config.structure === 'mpn_only_rows') return normalizeOnePerRow(rows, roles, configWithSourceHeaders);
  if (config.structure === 'mfr_only_same_cell') return normalizeManufacturerOnly(rows, roles, configWithSourceHeaders, true);
  if (config.structure === 'mfr_only_rows') return normalizeManufacturerOnly(rows, roles, configWithSourceHeaders, false);
  if (config.alternateLayout === 'same_group_rows') return normalizeSameGroupRows(rows, roles, configWithSourceHeaders);
  if (config.alternateLayout === 'already_separate_rows') return normalizeOnePerRow(rows, roles, configWithSourceHeaders);
  if (config.structure === 'same_cell') return normalizeSameCell(rows, roles, configWithSourceHeaders);
  if (config.structure === 'one_per_row') return normalizeOnePerRow(rows, roles, configWithSourceHeaders);
  return normalizeSeparateCells(rows, roles, configWithSourceHeaders);
};

const normalizeRowsChunked = async (rows, headers, roles, config, onProgress) => {
  // Before chunking, and over EVERY row. The walk carries state down the sheet,
  // so running it per 50-row chunk would restart the ancestor stack at each
  // boundary and orphan the first rows of every chunk after the first.
  stampInferredParents(rows, roles);
  // Same reason, plus one of its own: the reading is chosen by scoring derived
  // parents against every code on the sheet, and a 50-row window does not hold
  // enough of them to tell a working reading from a dangling one.
  unpackParentPaths(rows, roles, config);
  // And the same again: the chain runs the length of the sheet, so a chunk that
  // holds a child but not its parent would call that child a root.
  stampParentChainDepth(rows, roles);
  const layoutStructure = effectiveStructure(config);
  if (config.structure === 'grouped_rows' || layoutStructure === 'multi_block_assembly') {
    const dataRows = [];
    let skippedRows = 0;
    rows.forEach((row) => {
      const skip = shouldSkipSourceRow(row, headers, roles, config);
      if (skip) skippedRows += 1;
      else dataRows.push(row);
    });
    const output = normalizeRows(dataRows, headers, roles, config, true);
    if (onProgress) {
      onProgress({
        processed: rows.length,
        total: rows.length,
        outputRows: output.length,
        skippedRows,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    return output;
  }

  const chunkSize = rows.length > 1000 ? 80 : 50;
  const output = [];
  let skippedRows = 0;

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const dataChunk = [];
    for (let index = 0; index < chunk.length; index += 1) {
      const row = chunk[index];
      const skip = shouldSkipSourceRow(row, headers, roles, config);
      if (skip) skippedRows += 1;
      else dataChunk.push(row);
    }
    output.push(...normalizeRows(dataChunk, headers, roles, config, true));
    if (onProgress) {
      onProgress({
        processed: Math.min(start + chunkSize, rows.length),
        total: rows.length,
        outputRows: output.length,
        skippedRows,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return output;
};

const getRawPairingParts = (row, roles, config) => {
  const rawMpn = getCell(row, roles.mpn);
  const rawManufacturer = getCell(row, roles.manufacturer);
  const mpns = splitMpnCell(rawMpn, config);
  const manufacturers = splitManufacturerCell(rawManufacturer, null, config).filter(Boolean);
  return { mpns, manufacturers, rawMpn, rawManufacturer };
};

const analyzeMpnManufacturerPairing = (rows, headers, roles, config) => {
  if (!roles.mpn || !roles.manufacturer || roles.mpn === roles.manufacturer) {
    return { checkedRows: 0, matchedRows: 0, issueRows: [] };
  }

  const issueRows = [];
  let checkedRows = 0;
  let matchedRows = 0;
  const manualAltGroups = cleanAlternateColumnGroups(config.alternateColumnGroups || [], headers);
  const alternateGroups = manualAltGroups.length ? manualAltGroups : findAlternateColumnGroups(headers);

  const collectPairingParts = (mpnValue, manufacturerValue) => {
    const mpnParts = splitMpnCell(mpnValue, config);
    const mpns = mpnParts.length
      ? mpnParts
      : [stripVendorPrefix(mpnValue)].filter(Boolean);
    if (!mpns.length) return { mpns: [], manufacturers: [] };
    const manufacturers = splitManufacturerCell(manufacturerValue, mpns.length || null, config).filter(Boolean);
    return { mpns, manufacturers };
  };

  rows.forEach((row, rowIndex) => {
    if (shouldSkipSourceRow(row, headers, roles, config)) return;
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const base = getRawPairingParts(row, roles, config);
    const primaryManufacturer = getCell(row, roles.manufacturer);

    const scenarios = [];
    if (base.mpns.length > 1 || base.manufacturers.length > 1) {
      scenarios.push({
        key: `source-${sourceRow}`,
        sourceRow,
        parentKey: alternatesKey(row, roles, sourceRow),
        mpns: base.mpns,
        manufacturers: base.manufacturers,
        rawMpn: base.rawMpn,
        rawManufacturer: base.rawManufacturer,
      });
    }

    if (config.alternateLayout === 'separate_columns' && alternateGroups.length) {
      const mpns = [];
      const manufacturers = [];
      const primaryParts = collectPairingParts(getCell(row, roles.mpn), primaryManufacturer);
      mpns.push(...primaryParts.mpns);
      manufacturers.push(...primaryParts.manufacturers);
      alternateGroups.forEach((group) => {
        const groupMpnIsPrimary = normalizeKey(group.mpn) === normalizeKey(roles.mpn);
        const groupMfrIsPrimary = group.mfr && normalizeKey(group.mfr) === normalizeKey(roles.manufacturer);
        if (groupMpnIsPrimary || (groupMfrIsPrimary && !getCell(row, group.mpn))) return;
        const part = collectPairingParts(
          getCell(row, group.mpn),
          getCell(row, group.mfr) || (config.manufacturerMode === 'inherit_blank' ? primaryManufacturer : '')
        );
        if (!part.mpns.length) return;
        mpns.push(...part.mpns);
        manufacturers.push(...part.manufacturers);
      });
      if (mpns.length > 1) {
        scenarios.push({
          key: `alternate-columns-${sourceRow}`,
          sourceRow,
          parentKey: alternatesKey(row, roles, sourceRow),
          mpns,
          manufacturers,
          rawMpn: mpns.join(' | '),
          rawManufacturer: manufacturers.join(' | '),
        });
      }
    }

    scenarios.forEach((scenario) => {
      const mpnCount = scenario.mpns.length;
      const mfrCount = scenario.manufacturers.length;
      if (mpnCount <= 1 && mfrCount <= 1) return;
      checkedRows += 1;
      if (mpnCount === mfrCount || (mpnCount === 1 && mfrCount > 1)) {
        matchedRows += 1;
        return;
      }
      issueRows.push({
        ...scenario,
        action: 'keep',
        mpnDecisions: scenario.mpns.map((mpn, index) => ({
          mpn,
          manufacturer: scenario.manufacturers[index] || scenario.manufacturers[0] || '',
          keep: true,
        })),
        mfrDecisions: scenario.manufacturers.map((manufacturer) => ({
          manufacturer,
          keep: true,
        })),
        manualManufacturers: scenario.mpns.map((_, index) => scenario.manufacturers[index] || scenario.manufacturers[0] || '').join(' | '),
        message: `${mpnCount} MPN${mpnCount === 1 ? '' : 's'} detected, ${mfrCount} manufacturer${mfrCount === 1 ? '' : 's'} detected.`,
      });
    });
  });

  return { checkedRows, matchedRows, issueRows };
};

const splitManualManufacturers = (value) => (
  fmt(value)
    .split(/\s*(?:\||\n|;)\s*/g)
    .map(fmt)
    .filter(Boolean)
);

const applyPairingReviewDecisions = (rows, reviewRows) => {
  if (!reviewRows.length) return rows;
  const decisions = reviewRows.filter((issue) => (
    issue.action !== 'keep' ||
    (issue.mpns?.length === 1 && issue.manufacturers?.length > 1) ||
    (issue.manufacturers?.length === 1 && issue.mpns?.length > 1)
  ));
  if (!decisions.length) return rows;

  let nextRows = rows.map((row) => ({ ...row }));
  decisions.forEach((issue) => {
    const mpnKeys = issue.mpns.map((mpn) => normalizeKey(stripVendorPrefix(mpn)));
    const decisionRows = Array.isArray(issue.mpnDecisions) && issue.mpnDecisions.length
      ? issue.mpnDecisions
      : issue.mpns.map((mpn, index) => ({
          mpn,
          manufacturer: issue.manufacturers[index] || issue.manufacturers[0] || '',
          keep: true,
        }));
    const manufacturerDecisions = Array.isArray(issue.mfrDecisions) && issue.mfrDecisions.length
      ? issue.mfrDecisions
      : issue.manufacturers.map((manufacturer) => ({ manufacturer, keep: true }));
    const rowBelongsToIssue = (row) => (
      String(row.sourceRow) === String(issue.sourceRow) ||
      (issue.parentKey && normalizeKey(row.parentKey) === normalizeKey(issue.parentKey))
    );
    const manualValues = issue.action === 'manual'
      ? splitManualManufacturers(issue.manualManufacturers)
      : [];
    const firstManufacturer = issue.manufacturers[0] || manualValues[0] || '';

    if (issue.action === 'keep' || issue.action === 'manual' || issue.action === 'remove_extra') {
      const affectedRows = nextRows.filter((row) => rowBelongsToIssue(row) && mpnKeys.includes(normalizeKey(row.mpn)));
      if (!affectedRows.length) return;
      const templateRow = affectedRows[0];
      const replacementRows = [];
      const keptManufacturers = manufacturerDecisions
        .filter((decision) => decision.keep !== false)
        .map((decision) => decision.manufacturer)
        .filter(Boolean);
      const rowsToEmit = issue.action === 'keep'
        ? Array.from({ length: Math.max(issue.mpns.length, keptManufacturers.length || issue.manufacturers.length || 1) }).map((_, index) => ({
            mpn: issue.mpns[index] || issue.mpns[0] || '',
            manufacturer: issue.manufacturers[index] || issue.manufacturers[0] || '',
            keep: true,
          }))
        : decisionRows;
      rowsToEmit.forEach((decision, index) => {
        if (issue.action === 'remove_extra' && decision.keep === false) return;
        const relationIndex = replacementRows.length;
        const manualValue = manualValues[index] || '';
        const manufacturer = issue.action === 'manual'
          ? (manualValue || decision.manufacturer || manualValues[0] || '')
          : issue.action === 'keep'
            ? (decision.manufacturer || keptManufacturers[relationIndex] || keptManufacturers[0] || firstManufacturer || '')
          : (keptManufacturers[relationIndex] || keptManufacturers[0] || firstManufacturer || decision.manufacturer || '');
        replacementRows.push({
          ...templateRow,
          mpn: stripVendorPrefix(decision.mpn || issue.mpns[index] || ''),
          manufacturer,
          relation: relationIndex === 0 ? 'Primary' : `Alternate ${relationIndex}`,
          rule: `${templateRow.rule || 'normalized'}_pairing_review`,
          confidence: Math.max(templateRow.confidence || 0, manufacturer ? 88 : templateRow.confidence || 0),
        });
      });
      let inserted = false;
      nextRows = nextRows.flatMap((row) => {
        if (!rowBelongsToIssue(row) || !mpnKeys.includes(normalizeKey(row.mpn))) return [row];
        if (inserted) return [];
        inserted = true;
        return replacementRows;
      });
    }
  });
  return nextRows;
};

const downloadRowsAsCsv = (rows) => {
  if (!rows.length) return;
  const columns = getNormalizedExportColumns(rows);
  const escapeCsv = (value) => {
    const text = fmt(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const csv = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'normalized-bom-preview.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const downloadRowsAsXlsx = (rows) => {
  if (!rows.length) return;
  const columns = getNormalizedExportColumns(rows);
  const worksheetRows = rows.map((row) => {
    const output = {};
    columns.forEach((column) => {
      output[column] = row[column] || '';
    });
    return output;
  });
  const worksheet = XLSX.utils.json_to_sheet(worksheetRows, { header: columns });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Normalized BOM');
  XLSX.writeFile(workbook, 'normalized-bom-preview.xlsx');
};

const createWorkbookFileFromRows = (rows, columns, fileName, sheetName = 'Sheet1') => {
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: columns });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([output], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return new File([blob], fileName, { type: blob.type });
};

const arrayBufferToBinaryString = (buffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return binary;
};

const getWorkbookFileText = (workbook, path) => {
  const file = workbook?.files?.[path] || workbook?.files?.[`/${path}`];
  const content = file?.content ?? file;
  if (typeof content === 'string') return content;
  if (content instanceof Uint8Array) {
    return new TextDecoder('utf-8').decode(content);
  }
  if (Array.isArray(content)) {
    return new TextDecoder('utf-8').decode(new Uint8Array(content));
  }
  return '';
};

const parseXmlAttributes = (raw = '') => {
  const attrs = {};
  String(raw).replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, (_, key, value) => {
    attrs[key] = value;
    return '';
  });
  return attrs;
};

const normalizeWorkbookTargetPath = (target = '') => {
  const cleanTarget = fmt(target).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanTarget) return '';
  return cleanTarget.startsWith('xl/') ? cleanTarget : `xl/${cleanTarget}`;
};

const parseStrikeStyleIndexes = (stylesXml = '') => {
  if (!stylesXml) return new Set();
  const strikeFontIds = new Set();
  const fontsMatch = stylesXml.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/i);
  const fontsXml = fontsMatch?.[1] || '';
  const fontMatches = [...fontsXml.matchAll(/<font\b[^>]*>[\s\S]*?<\/font>|<font\b[^/]*\/>/gi)];
  fontMatches.forEach((fontMatch, fontIndex) => {
    const fontXml = fontMatch[0];
    const strikeMatch = fontXml.match(/<strike\b([^>]*)\/?>/i);
    if (!strikeMatch) return;
    const attrs = parseXmlAttributes(strikeMatch[1] || '');
    if (!/^(?:0|false)$/i.test(fmt(attrs.val))) strikeFontIds.add(fontIndex);
  });

  if (!strikeFontIds.size) return new Set();
  const strikeStyleIndexes = new Set();
  const cellXfsMatch = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i);
  const cellXfsXml = cellXfsMatch?.[1] || '';
  const xfMatches = [...cellXfsXml.matchAll(/<xf\b([^>]*)\/>|<xf\b([^>]*)>[\s\S]*?<\/xf>/gi)];
  xfMatches.forEach((xfMatch, xfIndex) => {
    const attrs = parseXmlAttributes(xfMatch[1] || xfMatch[2] || '');
    const fontId = Number(attrs.fontId || 0);
    if (strikeFontIds.has(fontId)) strikeStyleIndexes.add(xfIndex);
  });
  return strikeStyleIndexes;
};

const worksheetPathByName = (workbook) => {
  const workbookXml = getWorkbookFileText(workbook, 'xl/workbook.xml');
  const relsXml = getWorkbookFileText(workbook, 'xl/_rels/workbook.xml.rels');
  if (!workbookXml || !relsXml) return {};

  const targetByRelId = {};
  [...relsXml.matchAll(/<Relationship\b([^>]*)\/?>/gi)].forEach((match) => {
    const attrs = parseXmlAttributes(match[1]);
    if (!attrs.Id || !/\/worksheet$/i.test(attrs.Type || '')) return;
    targetByRelId[attrs.Id] = normalizeWorkbookTargetPath(attrs.Target);
  });

  const pathBySheet = {};
  [...workbookXml.matchAll(/<sheet\b([^>]*)\/?>/gi)].forEach((match) => {
    const attrs = parseXmlAttributes(match[1]);
    const sheetName = attrs.name;
    const relId = attrs['r:id'];
    if (!sheetName || !relId || !targetByRelId[relId]) return;
    pathBySheet[sheetName] = targetByRelId[relId];
  });
  return pathBySheet;
};

const attachWorkbookStrikeMetadata = (workbook) => {
  const strikeStyleIndexes = parseStrikeStyleIndexes(getWorkbookFileText(workbook, 'xl/styles.xml'));
  if (!strikeStyleIndexes.size) return workbook;
  const paths = worksheetPathByName(workbook);

  Object.entries(paths).forEach(([sheetName, path]) => {
    const worksheet = workbook?.Sheets?.[sheetName];
    const worksheetXml = getWorkbookFileText(workbook, path);
    if (!worksheet || !worksheetXml) return;
    [...worksheetXml.matchAll(/<c\b([^>]*)>/gi)].forEach((match) => {
      const attrs = parseXmlAttributes(match[1]);
      if (!attrs.r || !strikeStyleIndexes.has(Number(attrs.s || 0))) return;
      const cell = worksheet[attrs.r];
      if (!cell) return;
      cell.__styleInfo = {
        ...(cell.__styleInfo || {}),
        strike: true,
      };
    });
  });

  return workbook;
};

const readWorkbookSafely = (buffer, fileName = 'workbook') => {
  if (!XLSX || !XLSX.read || !XLSX.utils) {
    throw new Error('Spreadsheet parser is not ready. Please refresh the page and try uploading again.');
  }

  const attempts = [
    () => XLSX.read(buffer, { type: 'array', cellDates: true, raw: false, cellStyles: true, bookFiles: true, WTF: false }),
    () => XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true, raw: false, cellStyles: true, bookFiles: true, WTF: false }),
    () => XLSX.read(arrayBufferToBinaryString(buffer), { type: 'binary', cellDates: true, raw: false, cellStyles: true, bookFiles: true, WTF: false }),
  ];
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const workbook = attempt();
      if (workbook?.SheetNames?.length) return attachWorkbookStrikeMetadata(workbook);
    } catch (err) {
      lastError = err;
    }
  }

  const rawMessage = String(lastError?.message || '');
  const knownParserCrash = rawMessage.includes("reading 'utils'") || rawMessage.includes('reading "utils"');
  if (knownParserCrash) {
    throw new Error(`Could not read "${fileName}". Please re-save the file as .xlsx, .xlsm, or .csv and upload it again.`);
  }
  throw new Error(`Could not read "${fileName}". ${rawMessage || 'The workbook appears to be unsupported or corrupted.'}`);
};

// Rows-to-workbook helper shared by the delimited fallbacks below.
const workbookFromRows = (rows, sheetName = 'CSV_Source') => {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return workbook;
};

const cleanDelimitedCell = (value) => {
  let text = fmt(value).trim();
  if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
    text = text.slice(1, -1);
  }
  return text.replace(/""/g, '"');
};

// Brackets are treated as grouping so that a comma INSIDE one does not split a
// cell - THALES writes manufacturer references like "Y2552860 (B724, 26X6)".
// That only holds while the brackets balance. `groupAware` is how the function
// tells itself they did not: a line ending mid-group was never grouped, and
// re-reading it on quotes alone is the honest fallback.
const splitDelimitedLineSafely = (line, delimiter, groupAware = true) => {
  const text = String(line || '');
  const cells = [];
  let current = '';
  let inQuotes = false;
  let groupDepth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        current += '""';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (!inQuotes) {
      if (groupAware) {
        if ('([{'.includes(char)) {
          groupDepth += 1;
        } else if (')]}'.includes(char) && groupDepth > 0) {
          groupDepth -= 1;
        }
      }

      if (char === delimiter && groupDepth === 0) {
        cells.push(cleanDelimitedCell(current));
        current = '';
        continue;
      }
    }

    current += char;
  }

  // An unclosed bracket swallowed every delimiter after it, so this line came
  // back as a handful of cells instead of a full row. Left standing it does not
  // just mangle one line: rejoinWrappedLines below waits for a row to reach the
  // header's width, and a row that never can absorbs the entire rest of the
  // file. One "(B724," on line 819 of a THALES export cost 140 lines and 23 of
  // its 28 assemblies.
  if (groupAware && groupDepth > 0) return splitDelimitedLineSafely(line, delimiter, false);

  cells.push(cleanDelimitedCell(current));
  return cells;
};

const countDelimitedFieldsSafely = (line, delimiter) => splitDelimitedLineSafely(line, delimiter).length;

// Some exports (THALES ARTDOC, SAP part lists) put a newline INSIDE a cell without
// quoting it, so a plain line split shreds one record across several lines. A line
// that carries fewer separators than the header is a continuation of the row above,
// not a new row.
// How many lines one record may absorb before the wrap reading is abandoned.
// A record CAN legitimately span many lines - a manufacturer list runs to a
// dozen - but a buffer that has swallowed forty and still has not reached the
// header's width is not a wrapped record, it is a row this parser cannot count.
// Without a bound it takes the rest of the file with it.
const MAX_WRAPPED_LINES = 40;

const rejoinWrappedLines = (lines, delimiter) => {
  if (!lines.length) return [];
  const expected = countDelimitedFieldsSafely(lines[0], delimiter);
  if (expected < 2) return lines;

  const joined = [];
  let buffer = null;
  let held = 0;
  lines.forEach((line) => {
    buffer = buffer === null ? line : `${buffer}\n${line}`;
    held += 1;
    if (countDelimitedFieldsSafely(buffer, delimiter) >= expected) {
      joined.push(buffer);
      buffer = null;
      held = 0;
      return;
    }
    // Give up on this record rather than on the file. The short row that comes
    // out is one bad row; the alternative is every row after it.
    if (held >= MAX_WRAPPED_LINES) {
      joined.push(buffer);
      buffer = null;
      held = 0;
    }
  });
  if (buffer !== null) joined.push(buffer);
  return joined;
};

// Pick the separator that yields the most consistent column count. Files arrive
// semicolon-separated (French exports) and tab-separated (named .xls but actually
// text) as often as comma-separated.
const detectDelimiter = (text) => {
  const sample = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 20);
  if (!sample.length) return ',';

  let best = ',';
  let bestScore = -1;
  [',', ';', '\t', '|'].forEach((candidate) => {
    const counts = sample.map((line) => countDelimitedFieldsSafely(line, candidate));
    const first = counts[0];
    if (first < 2) return;
    // Reward width, penalise rows that disagree with the header width.
    const agree = counts.filter((count) => count === first).length;
    const score = first * 2 + agree;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  });
  return best;
};

const splitDelimitedLine = (line, delimiter) => splitDelimitedLineSafely(line, delimiter);

const workbookLooksColumnCollapsed = (rows) => {
  const headerWidth = (rows[0] || []).filter((cell) => fmt(cell)).length;
  if (headerWidth < 2) return true;

  const body = rows.slice(1).filter((row) => row.some((cell) => fmt(cell)));
  if (body.length <= 10) return false;

  const multiCellRows = body.filter((row) => row.filter((cell) => fmt(cell)).length > 1).length;
  return multiCellRows < Math.max(3, body.length * 0.15);
};

const decodeDelimitedTextBuffer = (buffer) => {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(buffer);
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(buffer);
    }
  }

  const sampleLength = Math.min(bytes.length, 2000);
  let evenNulls = 0;
  let oddNulls = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] !== 0) continue;
    if (index % 2 === 0) evenNulls += 1;
    else oddNulls += 1;
  }
  const nullThreshold = Math.max(8, sampleLength * 0.1);
  if (oddNulls > nullThreshold && oddNulls > evenNulls * 3) {
    return new TextDecoder('utf-16le').decode(buffer);
  }
  if (evenNulls > nullThreshold && evenNulls > oddNulls * 3) {
    return new TextDecoder('utf-16be').decode(buffer);
  }

  const utf8 = new TextDecoder('utf-8').decode(buffer);
  // A replacement char means the bytes were not UTF-8. These files are usually
  // latin-1, and decoding them as UTF-8 mangles accented characters.
  return /�/.test(utf8)
    ? new TextDecoder('iso-8859-1').decode(buffer)
    : utf8;
};

const readCsvWorkbookSafely = async (file) => {
  if (!XLSX || !XLSX.read || !XLSX.utils) {
    throw new Error('Spreadsheet parser is not ready. Please refresh the page and try uploading again.');
  }

  const buffer = await file.arrayBuffer();
  const text = decodeDelimitedTextBuffer(buffer);

  const attempts = [
    // Delimiter-sniffed parsing comes first because many client files are named
    // .csv but are actually UTF-16 tab-separated exports. SheetJS can accept
    // those as generic text while still leaving formatting artifacts in values.
    () => {
      const delimiter = detectDelimiter(text);
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      const rows = rejoinWrappedLines(lines, delimiter)
        .map((line) => splitDelimitedLine(line, delimiter));
      if (rows.length < 2 || rows[0].length < 2) return null;
      return workbookFromRows(rows);
    },
    () => XLSX.read(text, { type: 'string', raw: false, codepage: 65001 }),
    () => {
      const rows = text
        .split(/\r?\n/)
        .map((line) => splitDelimitedLine(line, ','));
      return workbookFromRows(rows);
    },
    // Excel re-saves a semicolon/tab export by quoting each whole record and padding
    // the row with commas, so a row parses as one populated cell still holding the
    // original delimited record. Where the record itself held a comma - a reference
    // list, a European decimal - Excel split it there too, leaving several fragments.
    // Joining a row's cells back with the comma that split them rebuilds the record
    // either way; then sniff the delimiter the record actually uses.
    () => {
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) return null;

      let singleCellLines = 0;
      const unwrapped = lines.map((line) => {
        const cells = splitDelimitedLine(line, ',');
        if (cells.filter((cell) => fmt(cell)).length <= 1) singleCellLines += 1;
        let end = cells.length;
        while (end > 0 && !fmt(cells[end - 1])) end -= 1;
        return cells.slice(0, end).join(',');
      });
      if (singleCellLines < lines.length * 0.6) return null;

      const delimiter = detectDelimiter(unwrapped.join('\n'));
      // Same separator winning again means the quoting was deliberate - a
      // one-column file of values that contain commas - so leave it alone.
      if (delimiter === ',') return null;
      const rows = rejoinWrappedLines(unwrapped, delimiter)
        .map((line) => splitDelimitedLine(line, delimiter));
      if (rows.length < 2 || rows[0].length < 2) return null;
      return workbookFromRows(rows);
    },
  ];
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const workbook = attempt();
      if (workbook?.SheetNames?.length) {
        // Reject only genuinely collapsed parses. Sparse one-cell rows can be valid
        // BOM alternate rows and must stay visible in the source preview.
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
          header: 1,
          defval: '',
        });
        if (!workbookLooksColumnCollapsed(rows)) return workbook;
      }
    } catch (err) {
      lastError = err;
    }
  }

  // Every attempt looked wrong — return the delimiter-sniffed one anyway, since a
  // best-effort sheet beats refusing the file outright.
  try {
    const delimiter = detectDelimiter(text);
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const rows = rejoinWrappedLines(lines, delimiter)
      .map((line) => splitDelimitedLine(line, delimiter));
    if (rows.length) return workbookFromRows(rows);
  } catch (err) {
    lastError = err;
  }

  throw new Error(`Could not read "${file.name}". ${lastError?.message || 'The CSV appears to be unsupported or empty.'}`);
};

const readUploadedWorkbookSafely = async (file) => {
  if (String(file?.name || '').toLowerCase().endsWith('.csv')) return readCsvWorkbookSafely(file);
  const buffer = await file.arrayBuffer();
  return readWorkbookSafely(buffer, file.name);
};

const normalizedGroupKey = (row) => `${row.sourceRow || ''}::${row.parentKey || ''}`;

const rebalanceRelations = (rows) => {
  const seenByGroup = {};

  return rows.map((row) => {
    const groupKey = normalizedGroupKey(row);
    const seenCount = seenByGroup[groupKey] || 0;
    seenByGroup[groupKey] = seenCount + 1;

    return {
      ...row,
      relation: seenCount === 0 ? 'Primary' : `Alternate ${seenCount}`,
    };
  });
};

const detectBestStructure = (headers, roles, sampleRows) => {
  if (detectFollowingRowMfgPartsLayout(headers, sampleRows, roles)) return 'grouped_rows';
  if (roles.mpn && roles.manufacturer && roles.mpn === roles.manufacturer) return 'same_cell';
  const groupedSignals = sampleRows.reduce((score, row, index) => {
    const hasGroupContext = Boolean(
      getCell(row, roles.parent) ||
      getCell(row, roles.cpn) ||
      getCell(row, roles.description) ||
      getCell(row, roles.quantity)
    );
    const hasPart = Boolean(getCell(row, roles.mpn) || getCell(row, roles.manufacturer));
    const nextRow = sampleRows[index + 1];
    const nextHasPart = Boolean(nextRow && (getCell(nextRow, roles.mpn) || getCell(nextRow, roles.manufacturer)));
    return score + (hasGroupContext && !hasPart && nextHasPart ? 1 : 0);
  }, 0);
  if (groupedSignals >= 1 && (roles.mpn || roles.manufacturer) && (roles.parent || roles.cpn || roles.description)) {
    return 'grouped_rows';
  }

  if (roles.mpn && !roles.manufacturer) {
    const mpnSamples = sampleRows.map((row) => getCell(row, roles.mpn)).filter(Boolean);
    const caretPairHeavy = mpnSamples.filter((value) => parseCaretMpnManufacturerPairs(value).length > 0).length;
    if (caretPairHeavy >= 1) return 'same_cell';
    const multiMpn = mpnSamples.filter((value) => splitMpnCell(value).length > 1).length;
    return multiMpn ? 'mpn_only_same_cell' : 'mpn_only_rows';
  }
  if (!roles.mpn && roles.manufacturer) {
    const manufacturerSamples = sampleRows.map((row) => getCell(row, roles.manufacturer)).filter(Boolean);
    const multiManufacturer = manufacturerSamples.filter((value) => splitManufacturerCell(value, 2).length > 1).length;
    return multiManufacturer ? 'mfr_only_same_cell' : 'mfr_only_rows';
  }

  const altGroups = findAlternateColumnGroups(headers);
  if (altGroups.length) return 'alternate_columns';

  const mpnSamples = sampleRows.map((row) => getCell(row, roles.mpn)).filter(Boolean);
  const mfrSamples = sampleRows.map((row) => getCell(row, roles.manufacturer)).filter(Boolean);
  const caretPairHeavy = [...mpnSamples, ...mfrSamples].filter((value) => parseCaretMpnManufacturerPairs(value).length > 0).length;
  if (caretPairHeavy >= 1) return 'same_cell';
  const colonHeavy = mpnSamples.filter((value) => parseColonSegments(value).length > 1).length;
  if (colonHeavy >= Math.max(2, Math.ceil(mpnSamples.length * 0.2))) return 'same_cell';

  const multiMpn = mpnSamples.filter((value) => splitMpnCell(value).length > 1).length;
  const multiMfr = mfrSamples.filter((value) => splitManufacturerCell(value, 2).length > 1).length;
  if (multiMpn) return 'separate_cells';
  if (!multiMpn && multiMfr) return 'one_per_row';

  return 'one_per_row';
};

const nextConfigForDetectedStructure = (previousConfig, detectedStructure, detectionContext = {}) => {
  const assemblyMatrix = detectedStructure === 'assembly_quantity_matrix'
    ? detectAssemblyQuantityMatrix(
      detectionContext.headers || [],
      detectionContext.rows || [],
      detectionContext.roles || {}
    )
    : null;
  const followingMfgPartsLayout = detectFollowingRowMfgPartsLayout(
    detectionContext.headers || [],
    detectionContext.rows || [],
    detectionContext.roles || {}
  );

  if (detectedStructure === 'alternate_columns') {
    return {
      ...previousConfig,
      structure: 'separate_cells',
      alternateLayout: 'separate_columns',
    };
  }

  if (detectedStructure === 'grouped_rows') {
    return {
      ...previousConfig,
      structure: 'grouped_rows',
      alternateLayout: followingMfgPartsLayout ? 'following_rows' : 'already_separate_rows',
      followingRowAlternateColumn: followingMfgPartsLayout?.mfgPartsHeader || previousConfig.followingRowAlternateColumn,
      manufacturerMode: followingMfgPartsLayout ? 'never' : previousConfig.manufacturerMode,
      quantityMode: followingMfgPartsLayout ? 'inherit_primary' : previousConfig.quantityMode,
      delimiterMode: followingMfgPartsLayout ? 'auto' : previousConfig.delimiterMode,
    };
  }

  if (detectedStructure === 'assembly_quantity_matrix') {
    return {
      ...previousConfig,
      structure: previousConfig.structure || 'separate_cells',
      bomLayout: 'assembly_quantity_matrix',
      alternateLayout: 'already_separate_rows',
      quantityMode: 'every_row',
      quantityVariant: QUANTITY_VARIANT_ALL,
      quantityVariantByBlock: {},
      assemblyMatrix: assemblyMatrix || previousConfig.assemblyMatrix,
    };
  }

  if (detectedStructure === 'multi_block_assembly') {
    return {
      ...previousConfig,
      structure: previousConfig.structure || 'separate_cells',
      bomLayout: 'multi_block_assembly',
      alternateLayout: 'inside_selected_mpn_columns',
      quantityMode: 'every_row',
      quantityVariant: QUANTITY_VARIANT_ALL,
      quantityVariantByBlock: {},
      delimiterMode: 'auto',
      manufacturerMode: 'inherit_blank',
    };
  }

  return {
    ...previousConfig,
    structure: detectedStructure,
    alternateLayout: ['one_per_row', 'mpn_only_rows', 'mfr_only_rows'].includes(detectedStructure)
      ? 'already_separate_rows'
      : 'inside_selected_mpn_columns',
  };
};

const guessDelimiter = (rows, roles) => {
  const candidates = [';', '|', '\n', ','];
  const sampleValues = rows.slice(0, 80).flatMap((row) => [
    getCell(row, roles.mpn),
    getCell(row, roles.manufacturer),
  ]).filter(Boolean);

  let best = { delimiter: 'auto', score: 0 };
  candidates.forEach((delimiter) => {
    const score = sampleValues.reduce((total, value) => {
      const parts = splitByExplicitDelimiter(value, delimiter);
      return total + (parts.length > 1 ? parts.length - 1 : 0);
    }, 0);
    if (score > best.score) {
      best = { delimiter: delimiter === '\n' ? '\\n' : delimiter, score };
    }
  });

  return best.score >= 2 ? best.delimiter : 'auto';
};

const getStructureOptionsForRoles = (roles, config = {}) => {
  const sameColumnFollowingBlock = roles.mpn &&
    roles.manufacturer &&
    roles.mpn === roles.manufacturer &&
    config.alternateLayout === 'following_rows' &&
    config.followingRowAlternateColumn === roles.mpn;

  if (sameColumnFollowingBlock) {
    return STRUCTURE_OPTIONS.filter((option) => ['grouped_rows', 'same_cell'].includes(option.value));
  }

  if (roles.mpn && roles.manufacturer && roles.mpn === roles.manufacturer) {
    return STRUCTURE_OPTIONS.filter((option) => ['same_cell'].includes(option.value));
  }

  if (roles.mpn && !roles.manufacturer) {
    return STRUCTURE_OPTIONS.filter((option) => ['mpn_only_same_cell', 'mpn_only_rows', 'grouped_rows'].includes(option.value));
  }

  if (!roles.mpn && roles.manufacturer) {
    return STRUCTURE_OPTIONS.filter((option) => ['mfr_only_same_cell', 'mfr_only_rows', 'grouped_rows'].includes(option.value));
  }

  if (roles.mpn && roles.manufacturer) {
    return STRUCTURE_OPTIONS.filter((option) => ['separate_cells', 'same_cell', 'one_per_row', 'grouped_rows'].includes(option.value));
  }

  return STRUCTURE_OPTIONS;
};

const findStrongMpnHeader = (headers = []) => {
  const patterns = [
    /\bmpn\b/,
    /manufacturer equivalent/,
    /\bmanufacturer part\b/,
    /\bmanufacturing part\b/,
    /\bmfr part\b/,
    /\bmfg part\b/,
    /producer/,
  ];
  return headers.find((header) => {
    const normalized = normalizeKey(header);
    if (/(?:^|\s)(?:mfg|manufacturer)\s+parts(?:\s|$)/.test(normalized)) return false;
    return patterns.some((pattern) => pattern.test(normalized));
  }) || '';
};

const isGenericPartHeader = (header) => /^part( number| no)?$/.test(normalizeKey(header));

const MULTI_BLOCK_META_HEADERS = [
  'Source sheet',
  'BOM block',
  'Block codes',
  'Quantity variant',
  'Item',
  'Reference D/N',
  'Description',
  'Specification',
  'Other specification:HKK Request',
  'Part number',
  'Parts Maker',
  'Parts Name',
  'Quantity',
  'Remarks',
  '__multiBlockMode',
  '__blockId',
  '__blockTitle',
  '__blockCodes',
  '__blockName',
  '__quantityColumn',
];

const isMultiBlockMetaHeader = (header = '') => MULTI_BLOCK_META_HEADERS.includes(header);

const extractAssemblyCodes = (value) => {
  const text = fmt(value).toUpperCase().replace(/\u00a0/g, ' ');
  const matches = text.match(/\b[A-Z]{1,4}\d{4,}[A-Z]?\b/g) || [];
  return [...new Set(matches.filter((code) => !/^C?X{4,}[A-Z]?$/.test(code)))];
};

const extractBlockName = (title = '') => {
  const text = fmt(title).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text
    .replace(/\s*\((?:DWG|DRAWING)\s*:.*$/i, '')
    .replace(/\s*\bDWG\s*:.*$/i, '')
    .trim();
};

const rowTextFromArray = (row = []) => row
  .map(fmt)
  .filter(Boolean)
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

const rowLooksLikeMultiBlockHeader = (row = []) => {
  const normalizedCells = row.map((cell) => normalizeKey(cell));
  const rowText = normalizedCells.join(' ');
  const hasItem = normalizedCells.some((cell) => cell === 'item' || cell === 'item no');
  const hasReference = rowText.includes('reference') || rowText.includes('ref d n') || rowText.includes('ref dn');
  const hasDescription = rowText.includes('description') || rowText.includes('desc');
  const hasMfr = rowText.includes('parts maker') || rowText.includes('part maker') || rowText.includes('manufacturer') || rowText.includes('mfr');
  const hasMpn = rowText.includes('parts name') || rowText.includes('part name') || rowText.includes('mpn');
  return hasItem && hasReference && hasDescription && (hasMfr || hasMpn);
};

const findMultiBlockHeaderRows = (rows = []) => rows
  .map((row, index) => (rowLooksLikeMultiBlockHeader(row) ? index : -1))
  .filter((index) => index >= 0);

const findPreviousBlockTitle = (rows = [], headerIndex = 0) => {
  for (let index = headerIndex - 1; index >= Math.max(0, headerIndex - 4); index -= 1) {
    const text = rowTextFromArray(rows[index]);
    if (!text) continue;
    if (/\b(?:dwg|drawing|assy|ass'?y|assembly|qty)\b/i.test(text) || extractAssemblyCodes(text).length) {
      return { text, rowIndex: index };
    }
  }
  return { text: '', rowIndex: Math.max(0, headerIndex - 1) };
};

const findHeaderColumn = (headerRow = [], patterns = []) => {
  const index = headerRow.findIndex((header) => {
    const key = normalizeKey(header);
    return patterns.some((pattern) => pattern.test(key));
  });
  return index >= 0 ? index : -1;
};

const getBlockColumnMap = (headerRow = []) => {
  const item = findHeaderColumn(headerRow, [/^item(?:\s+no)?$/]);
  const reference = findHeaderColumn(headerRow, [/reference/, /\bref\s*d\s*n\b/, /\bref\s*dn\b/]);
  const description = findHeaderColumn(headerRow, [/description/, /^desc$/]);
  const specification = findHeaderColumn(headerRow, [/^specification$/, /^spec$/]);
  const otherSpecification = findHeaderColumn(headerRow, [/other\s+specification/, /hkk\s+request/]);
  const partNumber = findHeaderColumn(headerRow, [/^part\s*(number|no)?$/]);
  const manufacturer = findHeaderColumn(headerRow, [/parts?\s+maker/, /manufacturer/, /\bmfr\b/]);
  const mpn = findHeaderColumn(headerRow, [/parts?\s+name/, /\bmpn\b/, /manufacturer\s+part/]);
  const remarks = findHeaderColumn(headerRow, [/remarks?/, /^note?s?$/, /comment/]);
  const firstQuantityIndex = Math.max(manufacturer, mpn, partNumber, otherSpecification, specification, description, reference, item) + 1;
  const quantityColumns = headerRow
    .map((header, index) => ({ header: fmt(header), index }))
    .filter(({ header, index }) => {
      if (!header || index < firstQuantityIndex) return false;
      if (index === remarks) return false;
      if (/^(?:remarks?|new\s+parts?|note?s?|comment)$/i.test(header.trim())) return false;
      return true;
    });
  return {
    item,
    reference,
    description,
    specification,
    otherSpecification,
    partNumber,
    manufacturer,
    mpn,
    remarks,
    quantityColumns,
  };
};

const cellAtIndex = (row = [], index = -1) => (index >= 0 ? fmt(row[index]) : '');

const buildMultiBlockRowsForSheet = (currentWorkbook, currentSheetName) => {
  const worksheet = currentWorkbook.Sheets[currentSheetName];
  const rows = worksheetToCompactRows(worksheet);
  const headerRows = findMultiBlockHeaderRows(rows);
  if (!headerRows.length) return { rows, blocks: [], dataRows: [] };

  const blocks = [];
  const dataRows = [];
  headerRows.forEach((headerIndex, blockIndex) => {
    const headerRow = rows[headerIndex] || [];
    const columnMap = getBlockColumnMap(headerRow);
    if (columnMap.reference < 0 || columnMap.description < 0) return;
    const titleInfo = findPreviousBlockTitle(rows, headerIndex);
    const nextHeaderIndex = headerRows[blockIndex + 1];
    const endIndex = Number.isFinite(nextHeaderIndex) ? Math.max(headerIndex + 1, nextHeaderIndex - 2) : rows.length - 1;
    const title = titleInfo.text || `${currentSheetName} block ${blockIndex + 1}`;
    const quantityHeaderText = columnMap.quantityColumns.map((column) => column.header).join(' ');
    const blockCodes = [...new Set([
      ...extractAssemblyCodes(currentSheetName),
      ...extractAssemblyCodes(title),
      ...extractAssemblyCodes(quantityHeaderText),
    ])];
    const blockId = `${currentSheetName}::${headerIndex + 1}::${blockIndex + 1}`;
    const block = {
      id: blockId,
      sheetName: currentSheetName,
      title,
      name: extractBlockName(title) || currentSheetName,
      codes: blockCodes,
      headerRow: headerIndex + 1,
      startRow: headerIndex + 2,
      endRow: endIndex + 1,
    };
    blocks.push(block);

    for (let rowIndex = headerIndex + 1; rowIndex <= endIndex; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      if (!row.some((cell) => fmt(cell))) continue;
      if (rowLooksLikeMultiBlockHeader(row)) continue;
      const remarks = cellAtIndex(row, columnMap.remarks);
      const rawManufacturer = cellAtIndex(row, columnMap.manufacturer);
      const rawMpn = cellAtIndex(row, columnMap.mpn);
      const alignedMpn = removeLeadingUnnumberedLineWhenCompanionIsNumbered(rawMpn, rawManufacturer);

      const baseValues = {
        'Source sheet': currentSheetName,
        'BOM block': block.name,
        'Block codes': block.codes.join(', '),
        Item: cellAtIndex(row, columnMap.item),
        'Reference D/N': stripCircledNumberMarkers(cleanStackedPartIdentifierCell(cellAtIndex(row, columnMap.reference))),
        Description: cellAtIndex(row, columnMap.description),
        Specification: cellAtIndex(row, columnMap.specification),
        'Other specification:HKK Request': cellAtIndex(row, columnMap.otherSpecification),
        'Part number': cellAtIndex(row, columnMap.partNumber),
        'Parts Maker': removeDeletedCircledSegments(rawManufacturer, remarks),
        'Parts Name': removeDeletedCircledSegments(alignedMpn, remarks),
        Remarks: remarks,
        __multiBlockMode: '1',
        __blockId: block.id,
        __blockTitle: block.title,
        __blockCodes: block.codes.join('|'),
        __blockName: block.name,
      };

      const quantityColumns = columnMap.quantityColumns.length
        ? columnMap.quantityColumns
        : [{ header: 'Quantity', index: -1 }];
      quantityColumns.forEach((quantityColumn) => {
        const quantityValue = quantityColumn.index >= 0 ? cellAtIndex(row, quantityColumn.index) : '';
        if (quantityColumn.index >= 0 && !isMultiBlockQuantityPresent(quantityValue)) return;
        dataRows.push({
          ...baseValues,
          'Quantity variant': quantityColumn.header,
          Quantity: quantityColumn.index >= 0 ? normalizeAssemblyMatrixQuantity(quantityValue).quantity : '',
          __quantityColumn: quantityColumn.header,
          __sourceRow: rowIndex + 1,
        });
      });
    }
  });

  return { rows, blocks, dataRows };
};

const prepareMultiBlockSheets = (currentWorkbook, sheetNames) => {
  const allBlocks = [];
  const allRows = [];
  const previewRows = [];

  sheetNames.forEach((currentSheetName) => {
    const prepared = buildMultiBlockRowsForSheet(currentWorkbook, currentSheetName);
    if (prepared.blocks.length) {
      allBlocks.push(...prepared.blocks);
      allRows.push(...prepared.dataRows);
    }
    if (!previewRows.length && prepared.rows.length) previewRows.push(...prepared.rows);
  });

  if (!allBlocks.length || !allRows.length) return null;

  const headers = MULTI_BLOCK_META_HEADERS.filter((header) => (
    !header.startsWith('__') || allRows.some((row) => row[header])
  ));
  const visiblePreviewHeaders = headers.filter((header) => !header.startsWith('__'));
  return {
    sheetRows: [
      visiblePreviewHeaders,
      ...allRows.slice(0, 12).map((row) => visiblePreviewHeaders.map((header) => row[header] || '')),
    ],
    headerRowIndex: 0,
    headers,
    dataRows: allRows,
    multiBlockSummary: {
      blockCount: allBlocks.length,
      sheetCount: new Set(allBlocks.map((block) => block.sheetName)).size,
      blocks: allBlocks,
    },
  };
};

const prepareSingleSheet = (currentWorkbook, currentSheetName, options = {}) => {
  const worksheet = currentWorkbook.Sheets[currentSheetName];
  const rows = worksheetToCompactRows(worksheet);
  const rawRowsForHeaderDetection = worksheetToCompactRows(worksheet, { expandMergedCells: false });
  const requestedHeaderIndex = Number(options.headerRow);
  const headerIndex = Number.isFinite(requestedHeaderIndex) && requestedHeaderIndex > 0
    ? requestedHeaderIndex - 1
    : detectHeaderRow(rawRowsForHeaderDetection);
  const columns = getUsableColumnDescriptors(rawRowsForHeaderDetection, headerIndex);
  const currentHeaders = columns.map((column) => column.header);
  const dataSheetRows = rows.slice(headerIndex + 1).filter((row) => row.some((cell) => fmt(cell)));
  const hasOutlineLevels = dataSheetRows.some((row) => Number(row.__rowMeta?.outlineLevel || 0) > 1);
  const outlineLevelHeader = hasOutlineLevels ? uniqueHeaderName(EXCEL_OUTLINE_LEVEL_HEADER, currentHeaders) : '';
  const outputHeaders = outlineLevelHeader ? [...currentHeaders, outlineLevelHeader] : currentHeaders;
  const currentRows = rows
    .slice(headerIndex + 1)
    .map((row, rowIndex) => {
      const mapped = {};
      const sourceCellStyles = {};
      columns.forEach((column) => {
        mapped[column.header] = fmt(row[column.index]);
        if (row.__cellMeta?.[column.index]) sourceCellStyles[column.header] = row.__cellMeta[column.index];
      });
      if (outlineLevelHeader) {
        mapped[outlineLevelHeader] = String(Number(row.__rowMeta?.outlineLevel || 1) || 1);
      }
      mapped.__sourceRow = headerIndex + 2 + rowIndex;
      if (Object.keys(sourceCellStyles).length) mapped.__sourceCellStyles = sourceCellStyles;
      if (row.__rowMeta?.deletedStyle) mapped.__deletedRowStyle = true;
      if (row.__rowMeta?.redStyle) mapped.__redRowStyle = true;
      if (row.__rowMeta?.strikeStyle) mapped.__strikeRowStyle = true;
      return mapped;
    });
  return {
    sheetRows: rows,
    headerRowIndex: headerIndex,
    headers: outputHeaders,
    dataRows: currentRows,
    detectedOutlineLevels: hasOutlineLevels,
  };
};

const prepareMultipleSheets = (currentWorkbook, sheetNames, options = {}) => {
  const pinnedHeaderRow = Number(options.headerRow);
  const hasPinnedHeaderRow = Number.isFinite(pinnedHeaderRow) && pinnedHeaderRow > 0;
  // A pinned header row is a direct instruction about where the table starts,
  // so block detection (which finds its own header rows) has to stand down.
  const multiBlockPrepared = hasPinnedHeaderRow ? null : prepareMultiBlockSheets(currentWorkbook, sheetNames);
  if (multiBlockPrepared?.multiBlockSummary?.blockCount > 1) {
    return multiBlockPrepared;
  }

  const unionHeaders = ['Source sheet'];
  const combinedRows = [];

  sheetNames.forEach((currentSheetName) => {
    const prepared = prepareSingleSheet(currentWorkbook, currentSheetName, {
      headerRow: hasPinnedHeaderRow ? pinnedHeaderRow : undefined,
    });
    prepared.headers.forEach((header) => {
      if (!unionHeaders.includes(header)) unionHeaders.push(header);
    });
    prepared.dataRows.forEach((row) => {
      combinedRows.push({
        ...row,
        'Source sheet': currentSheetName,
      });
    });
  });

  const previewRows = [
    unionHeaders,
    ...combinedRows.slice(0, 12).map((row) => unionHeaders.map((header) => row[header] || '')),
  ];

  return {
    sheetRows: previewRows,
    headerRowIndex: 0,
    headers: unionHeaders,
    dataRows: combinedRows,
  };
};

const createWorkbookFromObjects = (rows, currentHeaders, sheetLabel = 'Combined') => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    currentHeaders,
    ...rows.map((row) => currentHeaders.map((header) => row[header] || '')),
  ]);
  const nextWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(nextWorkbook, worksheet, sheetLabel.slice(0, 31) || 'Combined');
  return nextWorkbook;
};

const isGeneratedPdfColumnHeader = (header) => /^column(?:[_\s]*\d+|\.\d+)?$/i.test(fmt(header));

const canonicalAssemblyMatrixHeader = (header) => {
  const text = fmt(header).toUpperCase().replace(/\s+/g, '');
  if (/^[0ODQ]{1,3}\d{1,3}$/.test(text) && /[ODQ]/.test(text)) {
    const fixed = text.replace(/[ODQ]/g, '0');
    return fixed.length <= 3 ? fixed.padStart(3, '0') : fixed;
  }
  return fmt(header);
};

const joinOcrFragments = (values = []) => values
  .map(fmt)
  .filter(Boolean)
  .join(' ')
  .replace(/\s+([,.;:])/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

const isLikelyPdfGeneratedHeader = (header) => {
  const text = fmt(header);
  return !text || /^column(?:[_\s]*\d+|\.\d+)?$/i.test(text) || /^\d{1,3}$/.test(text);
};

const scorePdfHeaderRowCandidate = (row = []) => {
  const cells = row.map(fmt);
  const nonBlank = cells.filter(Boolean);
  if (nonBlank.length < 3) return 0;

  const structuralHits = cells.filter((cell) => (
    isAssemblyMatrixFindHeader(cell) ||
    isAssemblyMatrixPartHeader(cell) ||
    isAssemblyMatrixDescriptionHeader(cell)
  )).length;
  const assemblyHits = cells.filter((cell) => isAssemblyMatrixHeaderCandidate(canonicalAssemblyMatrixHeader(cell))).length;
  const labelHits = nonBlank.filter((cell) => /[A-Za-z]/.test(cell)).length;
  const quantityHits = nonBlank.filter(isMatrixQuantityLikeValue).length;
  const longTextHits = nonBlank.filter((cell) => cell.length > 40).length;

  if (structuralHits < 2 || assemblyHits < 1) return 0;

  return (
    structuralHits * 35 +
    assemblyHits * 18 +
    labelHits * 6 -
    quantityHits * 8 -
    longTextHits * 15
  );
};

const promotePdfHeaderRowFromData = (headers = [], rawRows = []) => {
  const sourceHeaders = headers.map(fmt);
  if (!Array.isArray(rawRows) || rawRows.length < 2) {
    return { headers: sourceHeaders, rows: rawRows };
  }

  const rowArrays = rawRows.map((row) => (
    Array.isArray(row)
      ? row.map(fmt)
      : sourceHeaders.map((header) => fmt(row?.[header]))
  ));
  const currentHeaderLooksWeak = sourceHeaders.length
    ? sourceHeaders.filter(isLikelyPdfGeneratedHeader).length / sourceHeaders.length >= 0.6
    : true;
  const currentHeaderScore = scorePdfHeaderRowCandidate(sourceHeaders);

  let best = { index: -1, score: 0 };
  rowArrays.slice(0, 80).forEach((row, index) => {
    const score = scorePdfHeaderRowCandidate(row);
    if (score > best.score) best = { index, score };
  });

  if (best.index < 0 || best.score < 80) {
    return { headers: sourceHeaders, rows: rawRows };
  }
  if (!currentHeaderLooksWeak && currentHeaderScore >= best.score * 0.8) {
    return { headers: sourceHeaders, rows: rawRows };
  }

  const promotedHeaders = makeUniqueHeaders(rowArrays[best.index]);
  const promotedRows = rowArrays.filter((_, index) => index !== best.index);
  return {
    headers: promotedHeaders,
    rows: promotedRows,
  };
};

const repairAssemblyMatrixPdfExtraction = (headers = [], rawRows = []) => {
  const sourceHeaders = headers.map(fmt);
  if (sourceHeaders.length < 5 || !Array.isArray(rawRows) || !rawRows.length) {
    return { headers: sourceHeaders, rows: rawRows };
  }

  const rowArrays = rawRows.map((row) => (
    sourceHeaders.map((header, index) => fmt(Array.isArray(row) ? row[index] : row?.[header]))
  ));

  const headerKeys = sourceHeaders.map(normalizeKey);
  const findIndex = sourceHeaders.findIndex(isAssemblyMatrixFindHeader);
  let partIndexes = [];
  const exactPartIndex = sourceHeaders.findIndex(isAssemblyMatrixPartHeader);
  if (exactPartIndex >= 0 && headerKeys[exactPartIndex] !== 'part') {
    partIndexes = [exactPartIndex];
  } else {
    const partOnlyIndex = headerKeys.findIndex((key) => key === 'part');
    if (
      partOnlyIndex >= 0 &&
      ['no', 'num', 'number', 'nbr'].includes(headerKeys[partOnlyIndex + 1])
    ) {
      partIndexes = [partOnlyIndex, partOnlyIndex + 1];
    } else if (exactPartIndex >= 0) {
      partIndexes = [exactPartIndex];
    }
  }

  const descriptionIndex = sourceHeaders.findIndex(isAssemblyMatrixDescriptionHeader);
  const structuralIndexes = [findIndex, ...partIndexes, descriptionIndex].filter((index) => index >= 0);
  const structuralStart = structuralIndexes.length ? Math.min(...structuralIndexes) : -1;
  if (structuralStart <= 0 || !partIndexes.length) {
    return { headers: sourceHeaders, rows: rawRows };
  }

  const assemblyIndexes = sourceHeaders
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => index < structuralStart && isAssemblyMatrixHeaderCandidate(canonicalAssemblyMatrixHeader(header)))
    .map(({ index }) => index);

  if (assemblyIndexes.length < 2) {
    return { headers: sourceHeaders, rows: rawRows };
  }

  let descriptionIndexes = [];
  if (descriptionIndex >= 0) {
    descriptionIndexes = [descriptionIndex];
    for (let index = descriptionIndex + 1; index < sourceHeaders.length; index += 1) {
      if (isGeneratedPdfColumnHeader(sourceHeaders[index])) descriptionIndexes.push(index);
    }
  } else {
    const afterPartIndex = Math.max(...partIndexes) + 1;
    descriptionIndexes = sourceHeaders
      .map((header, index) => ({ header, index }))
      .filter(({ header, index }) => index >= afterPartIndex && (isGeneratedPdfColumnHeader(header) || !isAssemblyMatrixHeaderCandidate(header)))
      .map(({ index }) => index);
  }

  if (!descriptionIndexes.length) {
    return { headers: sourceHeaders, rows: rawRows };
  }

  const nextHeaders = [
    ...assemblyIndexes.map((index) => canonicalAssemblyMatrixHeader(sourceHeaders[index])),
    ...(findIndex >= 0 ? ['FIND NO.'] : []),
    'PART NO.',
    'DESCRIPTION',
  ];

  const nextRows = rowArrays
    .map((row) => [
      ...assemblyIndexes.map((index) => row[index] || ''),
      ...(findIndex >= 0 ? [row[findIndex] || ''] : []),
      joinOcrFragments(partIndexes.map((index) => row[index])),
      joinOcrFragments(descriptionIndexes.map((index) => row[index])),
    ])
    .filter((row) => row.some((cell) => fmt(cell)));

  return {
    headers: makeUniqueHeaders(nextHeaders),
    rows: nextRows,
  };
};

const getFileType = (fileName = '') => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.csv')) return 'csv';
  return 'workbook';
};

const normalizePdfRows = (payload, sourceFile) => {
  const rawRows = Array.isArray(payload?.data) ? payload.data : [];
  const promoted = promotePdfHeaderRowFromData(payload?.headers || [], rawRows);
  const repaired = repairAssemblyMatrixPdfExtraction(promoted.headers || [], promoted.rows || rawRows);
  const pdfHeaders = makeUniqueHeaders(repaired.headers || []);
  const repairedRows = Array.isArray(repaired.rows) ? repaired.rows : rawRows;
  const decision = payload?.decision;
  const decisionLabel = typeof decision === 'string'
    ? decision
    : (decision?.winner || decision?.method || 'best extraction');
  if (!pdfHeaders.length || !repairedRows.length) {
    return { headers: [], rows: [] };
  }

  const rows = repairedRows
    .map((row, index) => {
      const mapped = {
        'Source file': sourceFile,
        'Source sheet': `PDF ${decisionLabel}`,
        __sourceRow: index + 1,
      };
      pdfHeaders.forEach((header, headerIndex) => {
        mapped[header] = fmt(Array.isArray(row) ? row[headerIndex] : row?.[header]);
      });
      return mapped;
    })
    .filter((row) => pdfHeaders.some((header) => fmt(row[header])));

  return {
    headers: ['Source file', 'Source sheet', ...pdfHeaders],
    rows,
  };
};

const normalizePdfTables = (payload, sourceFile) => {
  const decision = payload?.decision;
  const decisionLabel = typeof decision === 'string'
    ? decision
    : (decision?.winner || decision?.method || 'best extraction');
  const tables = Array.isArray(payload?.tables) ? payload.tables : [];

  return tables.map((table, tableIndex) => {
    const tableHeaders = makeUniqueHeaders(table?.headers || []);
    const rawRows = Array.isArray(table?.data) ? table.data : [];
    const pageLabel = table?.page_number ? `page ${table.page_number}` : `table ${tableIndex + 1}`;
    const sourceLabel = `PDF ${pageLabel}`;
    const rows = rawRows
      .map((row, rowIndex) => {
        const mapped = {
          'Source file': sourceFile,
          'Source sheet': sourceLabel,
          __sourceRow: rowIndex + 1,
        };
        tableHeaders.forEach((header, headerIndex) => {
          mapped[header] = fmt(Array.isArray(row) ? row[headerIndex] : row?.[header]);
        });
        return mapped;
      })
      .filter((row) => tableHeaders.some((header) => fmt(row[header])));

    return {
      id: `${table?.table_id || `table_${tableIndex + 1}`}`,
      label: `${sourceFile} / ${sourceLabel} (${rows.length} rows, ${tableHeaders.length} columns)`,
      fileName: sourceFile,
      sheetName: sourceLabel,
      decisionLabel,
      pageNumber: Number(table?.page_number) || null,
      headers: ['Source file', 'Source sheet', ...tableHeaders],
      rows,
    };
  }).filter((source) => source.headers.length > 2 && source.rows.length);
};

const parsePdfPageRange = (value) => {
  const pages = new Set();
  fmt(value).split(',').forEach((part) => {
    const text = part.trim();
    if (!text) return;
    const rangeMatch = text.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      const low = Math.min(start, end);
      const high = Math.max(start, end);
      for (let page = low; page <= high; page += 1) pages.add(page);
      return;
    }
    const page = Number(text);
    if (Number.isFinite(page) && page > 0) pages.add(page);
  });
  return pages;
};

const groupPdfSourcesByRanges = (sources, ranges, sourceFile) => {
  const validRanges = (ranges || [])
    .map((range, index) => ({
      name: fmt(range.name) || `PDF range ${index + 1}`,
      pagesText: fmt(range.pages),
      pages: parsePdfPageRange(range.pages),
    }))
    .filter((range) => range.pages.size > 0);

  if (!validRanges.length) return sources;
  const sourcesWithPages = sources.filter((source) => source.pageNumber);
  if (!sourcesWithPages.length) return sources;

  const grouped = validRanges.map((range, index) => {
    const matchingSources = sourcesWithPages.filter((source) => range.pages.has(source.pageNumber));
    const headers = [];
    matchingSources.forEach((source) => {
      source.headers.forEach((header) => {
        if (!headers.includes(header)) headers.push(header);
      });
    });
    const rows = matchingSources.flatMap((source) => source.rows.map((row) => ({
      ...row,
      'Source sheet': `${range.name} (${source.sheetName})`,
    })));
    return {
      id: `range_${index + 1}`,
      label: `${sourceFile} / ${range.name} pages ${range.pagesText} (${rows.length} rows, ${headers.length} columns)`,
      fileName: sourceFile,
      sheetName: range.name,
      pageRange: range.pagesText,
      headers,
      rows,
    };
  }).filter((source) => source.rows.length && source.headers.length);

  return grouped.length ? grouped : sources;
};

const uniqueValues = (values) => {
  const seen = new Set();
  return values
    .map(fmt)
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
};

const repeatedPairValues = (values) => values
  .map(fmt)
  .filter(Boolean);

const valuesNeedPositionalMergePairing = (matches = [], column = '', selectedColumns = []) => {
  const seen = new Map();
  for (const match of matches) {
    const value = fmt(match?.[column]);
    if (!value) continue;
    const companionSignature = selectedColumns
      .filter((selectedColumn) => selectedColumn !== column)
      .map((selectedColumn) => fmt(match?.[selectedColumn]))
      .filter(Boolean)
      .join('::');
    if (!seen.has(value)) {
      seen.set(value, new Set(companionSignature ? [companionSignature] : []));
      continue;
    }
    if (companionSignature) seen.get(value).add(companionSignature);
    if (seen.get(value).size > 1) return true;
  }
  return false;
};

const shouldPreserveRepeatedMergeValues = (column = '') => {
  const key = normalizeKey(column);
  if (!key) return false;
  if (/\bmpn\b|\bmfr\b|\bmfg\b/.test(key)) return true;
  if (/manufacturer/.test(key) && /(part|number|info|name|vendor|mfr|mfg)/.test(key)) return true;
  if (/(manufacturer|mfg|mfr).*(part|number)/.test(key)) return true;
  if (/(part|item).*(number|no|num|code)/.test(key)) return true;
  return false;
};

const makeUniqueName = (name, existing) => {
  let candidate = name || 'Column';
  let suffix = 2;
  while (existing.includes(candidate)) {
    candidate = `${name} ${suffix}`;
    suffix += 1;
  }
  return candidate;
};

const guessKeyColumn = (currentHeaders = []) => {
  const preferred = [
    /\bpart\s*number\b/i,
    /\bmpn\b/i,
    /manufacturer.*part/i,
    /\bitem\s*code\b/i,
    /\bcode\b/i,
    /\bid\b/i,
  ];
  return currentHeaders.find((header) => preferred.some((pattern) => pattern.test(header))) || currentHeaders[0] || '';
};

const defaultMergeDetailColumns = (currentHeaders = [], keyColumn = '') => (
  currentHeaders.filter((header) => header !== keyColumn).slice(0, 6)
);

const buildMergePreviewFromSources = (primarySource, secondarySource, config) => {
  if (!primarySource || !secondarySource) {
    throw new Error('Choose both primary and secondary sources.');
  }
  if (!config.primaryKey || !config.secondaryKey) {
    throw new Error('Choose common columns to match on.');
  }
  if (!primarySource.rows.length) {
    throw new Error('The selected primary source has no detected data rows. Pick another sheet or check its header row/data format.');
  }
  if (!secondarySource.rows.length) {
    throw new Error('The selected secondary source has no detected data rows. Pick another sheet or check its header row/data format.');
  }

  const selectedDetailColumns = (config.detailColumns || [])
    .filter((column) => secondarySource.headers.includes(column) && column !== config.secondaryKey);
  if (!selectedDetailColumns.length) {
    throw new Error('Choose at least one column from the secondary source.');
  }

  const normalizeMatch = (value) => fmt(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/^'/, '')
    .replace(/\.0+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const outputMode = config.outputMode || 'grouped';
  const relationshipName = fmt(config.relationshipName);
  const headers = [...primarySource.headers];
  const detailHeaderMap = {};

  selectedDetailColumns.forEach((column) => {
    const preferred = outputMode === 'grouped' && selectedDetailColumns.length === 1 && relationshipName
      ? relationshipName
      : column;
    const outputName = makeUniqueName(headers.includes(preferred) ? `${preferred} (secondary)` : preferred, headers);
    detailHeaderMap[column] = outputName;
    headers.push(outputName);
  });

  const detailLookup = new Map();
  secondarySource.rows.forEach((row) => {
    const key = normalizeMatch(row[config.secondaryKey]);
    if (!key) return;
    if (!detailLookup.has(key)) detailLookup.set(key, []);
    detailLookup.get(key).push(row);
  });

  const rows = [];
  let matchedPrimaryRows = 0;
  let unmatchedPrimaryRows = 0;
  let expandedRows = 0;

  primarySource.rows.forEach((primaryRow) => {
    const matches = detailLookup.get(normalizeMatch(primaryRow[config.primaryKey])) || [];
    if (matches.length) {
      matchedPrimaryRows += 1;
      if (outputMode === 'grouped') {
        const row = { __mergeStatus: 'matched' };
        primarySource.headers.forEach((header) => {
          row[header] = primaryRow[header] ?? '';
        });
        selectedDetailColumns.forEach((column) => {
          const values = matches.map((match) => match[column]);
          row[detailHeaderMap[column]] = (
            shouldPreserveRepeatedMergeValues(column) ||
            valuesNeedPositionalMergePairing(matches, column, selectedDetailColumns)
              ? repeatedPairValues(values)
              : uniqueValues(values)
          ).join(' | ');
        });
        rows.push(row);
        expandedRows += 1;
      } else {
        matches.forEach((match) => {
          const row = { __mergeStatus: 'matched' };
          primarySource.headers.forEach((header) => {
            row[header] = primaryRow[header] ?? '';
          });
          selectedDetailColumns.forEach((column) => {
            row[detailHeaderMap[column]] = match[column] ?? '';
          });
          rows.push(row);
          expandedRows += 1;
        });
      }
      return;
    }

    unmatchedPrimaryRows += 1;
    const row = { __mergeStatus: 'unmatched' };
    primarySource.headers.forEach((header) => {
      row[header] = primaryRow[header] ?? '';
    });
    selectedDetailColumns.forEach((column) => {
      row[detailHeaderMap[column]] = '';
    });
    rows.push(row);
  });

  const primaryKeys = new Set(primarySource.rows.map((row) => normalizeMatch(row[config.primaryKey])).filter(Boolean));
  const secondaryKeys = new Set(secondarySource.rows.map((row) => normalizeMatch(row[config.secondaryKey])).filter(Boolean));
  const secondaryOnlyKeys = [...secondaryKeys].filter((key) => !primaryKeys.has(key)).length;

  return {
    headers,
    rows,
    config: {
      ...config,
      detailColumns: selectedDetailColumns,
    },
    summary: {
      matchedPrimaryRows,
      unmatchedPrimaryRows,
      expandedRows,
      secondaryOnlyKeys,
      outputRows: rows.length,
    },
  };
};

const getMergePreviewExport = (mergePreview, visibleColumns = [], filter = 'all') => {
  if (!mergePreview) return { headers: [], rows: [] };
  const headers = visibleColumns.length ? visibleColumns : mergePreview.headers;
  const rows = (filter === 'all'
    ? mergePreview.rows
    : mergePreview.rows.filter((row) => row.__mergeStatus === filter)
  ).map((row) => {
    const cleanRow = {};
    headers.forEach((header) => {
      cleanRow[header] = row[header] ?? '';
    });
    return cleanRow;
  });
  return { headers, rows };
};

const sourceCellStyleSx = (row = {}, header = '') => {
  const styleInfo = row.__sourceCellStyles?.[header] || {};
  if (!styleInfo.red && !styleInfo.strike) return {};
  return {
    color: styleInfo.red ? '#dc2626' : undefined,
    textDecoration: styleInfo.strike ? 'line-through' : undefined,
    textDecorationThickness: styleInfo.strike ? '2px' : undefined,
  };
};

const isAssemblyMatrixQuantityColumn = (header = '', assemblyMatrix = null) => {
  if (!assemblyMatrix?.assemblyColumns?.length) return false;
  const headerKey = normalizeKey(header);
  return assemblyMatrix.assemblyColumns.some((column) => normalizeKey(column) === headerKey);
};

const displaySourceCellValue = (value, header = '', assemblyMatrix = null) => {
  const cleanedValue = stripCircledNumberMarkers(value);
  if (
    isAssemblyMatrixQuantityColumn(header, assemblyMatrix) &&
    isMatrixQuantityPresent(cleanedValue) &&
    !isNumericMatrixQuantity(cleanedValue)
  ) {
    return normalizeAssemblyMatrixQuantity(cleanedValue).quantity;
  }
  return cleanedValue;
};

const excelColumnName = (index) => {
  let columnNumber = Number(index) + 1;
  if (!Number.isFinite(columnNumber) || columnNumber <= 0) return '';
  let name = '';
  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }
  return name;
};

const SourcePreview = ({ headers, rows, getHeaderLabel = (header) => header, assemblyMatrix = null }) => {
  const { isDarkMode, tokens: themeTokens } = useThemeContext();
  const tableTone = {
    bg: themeTokens.table?.background || (isDarkMode ? 'rgba(6, 12, 24, 0.82)' : '#ffffff'),
    header: themeTokens.table?.header || (isDarkMode ? '#111827' : '#f8fafc'),
    text: themeTokens.text?.primary || (isDarkMode ? '#f8fafc' : '#0f172a'),
    border: themeTokens.table?.line || (isDarkMode ? 'rgba(255,255,255,0.08)' : '#e1e6ec'),
  };
  const previewHeaders = (headers || []).filter((header) => !fmt(header).startsWith('__'));
  return (
    <TableContainer
      sx={{
        mt: 1,
        maxHeight: 320,
        overflowX: 'auto',
        overflowY: 'auto',
        border: `1px solid ${tableTone.border}`,
        bgcolor: tableTone.bg,
        '&::-webkit-scrollbar': { height: 10, width: 10 },
        '&::-webkit-scrollbar-thumb': {
          borderRadius: 8,
          bgcolor: isDarkMode ? 'rgba(148, 163, 184, 0.42)' : 'rgba(100, 116, 139, 0.38)',
        },
        '&::-webkit-scrollbar-track': {
          bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.42)' : 'rgba(241, 245, 249, 0.8)',
        },
      }}
    >
      <Table stickyHeader size="small" sx={{ width: 'max-content', minWidth: '100%', tableLayout: 'fixed' }}>
        <TableHead>
          <TableRow>
            {previewHeaders.map((header) => (
              <TableCell
                key={header}
                sx={{
                  minWidth: 170,
                  maxWidth: 260,
                  fontWeight: 800,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  bgcolor: tableTone.header,
                  color: tableTone.text,
                  borderColor: tableTone.border,
                }}
              >
                {getHeaderLabel(header)}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={`source-${index}`}>
              {previewHeaders.map((header) => (
                <TableCell key={header} sx={{ minWidth: 170, maxWidth: 260, whiteSpace: 'pre-line', overflow: 'hidden', textOverflow: 'ellipsis', color: tableTone.text, borderColor: tableTone.border, ...sourceCellStyleSx(row, header) }}>
                  {displaySourceCellValue(row[header], header, assemblyMatrix)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

const NORMALIZED_TABLE_BASE_COLUMNS = [
  { key: 'sourceRow', label: 'Source row', editable: false, width: 86 },
  { key: 'parentKey', label: 'Parent / group', editable: true, width: 190 },
  { key: 'relation', label: 'Relation', editable: true, width: 115 },
  { key: 'level', label: 'Level', editable: true, width: 70 },
  { key: 'cpn', label: 'CPN', editable: true, width: 150 },
  { key: 'mpn', label: 'MPN', editable: true, width: 190 },
  { key: 'manufacturer', label: 'Manufacturer', editable: true, width: 180 },
  { key: 'quantity', label: 'Qty', editable: true, width: 80 },
  { key: 'uom', label: 'UOM', editable: true, width: 90 },
  { key: 'Item code', label: 'Item code', editable: true, width: 170 },
  { key: 'rule', label: 'Rule', editable: false, width: 190 },
  { key: 'confidence', label: 'Confidence', editable: false, width: 105 },
];

const CONFIDENCE_HELP_TEXT = 'Confidence is the normalizer estimate for how safely this row was parsed from the selected columns and rules. It is a review signal, not supplier validation.';

const NORMALIZED_RELATION_FILTERS = [
  { value: 'all', label: 'All relations' },
  { value: 'primary', label: 'Primary only' },
  { value: 'alternate', label: 'Alternates only' },
];

const NORMALIZED_ISSUE_FILTERS = [
  { value: 'all', label: 'All rows' },
  { value: 'missing_mpn', label: 'Missing MPN' },
  { value: 'missing_mfr', label: 'Missing manufacturer' },
  { value: 'missing_cpn', label: 'Missing CPN' },
  { value: 'missing_qty', label: 'Missing quantity' },
  { value: 'low_confidence', label: 'Low confidence' },
];

const hasManufacturerValues = (rows = []) => rows.some((row) => fmt(row?.manufacturer));

const buildBomMappingRowsFromNormalizedRows = (rows = [], baseColumns = getNormalizedExportColumns(rows)) => {
  const columns = [...baseColumns];

  const outputRows = rows.map((row) => {
    const output = {};
    baseColumns.forEach((column) => {
      output[column] = row[column] || '';
    });

    return output;
  });

  return { columns, rows: outputRows };
};

// The repeated template slots a parse can fill. Their internal names match the
// template's own columns once punctuation is ignored, which is exactly how
// ColumnMapping's findHeaderByCandidates compares - so 'Tag_2' finds 'Tag (2)'.
const DYNAMIC_TEMPLATE_COLUMN_RE = /^(Tag|Specification_Name|Specification_Value|Specification_UOM|Custom_Identification_Name|Custom_Identification_Value)_\d+$/i;

const buildNormalizerSuggestedMappings = (columns = [], rows = []) => {
  const available = new Set(columns);

  // Anything the parser routed into a template slot maps to that same slot.
  // Without this the column reaches the mapping page unconnected, and an
  // unconnected column never makes it as far as the editor.
  const dynamicCandidates = columns
    .filter((column) => DYNAMIC_TEMPLATE_COLUMN_RE.test(String(column || '')))
    .map((column) => ({ source: column, targets: [column] }));

  // Manufacturers ride along as a tag, so they must not claim a slot the parse
  // already filled - the mapping page drops the loser of a contested target.
  const filledTagSlots = new Set(
    columns
      .map((column) => String(column || '').match(/^Tag_(\d+)$/i))
      .filter(Boolean)
      .map((match) => Number(match[1]))
  );
  let manufacturerTagSlot = 1;
  while (filledTagSlots.has(manufacturerTagSlot)) manufacturerTagSlot += 1;

  const candidates = [
    { source: 'cpn', targets: ['CPN Code', 'Customer part number', 'Customer Part Number'] },
    { source: 'mpn', targets: ['MPN Code', 'Manufacturer part number', 'Manufacturer Part Number'] },
    { source: 'description', targets: ['Item name', 'Description', 'SAP Description'] },
    { source: 'quantity', targets: ['Quantity', 'Qty'] },
    { source: 'uom', targets: ['Measurement unit', 'UOM', 'Unit of measure'] },
    { source: 'level', targets: ['Level', 'BOM level'] },
    { source: 'Item code', targets: ['Item code'] },
    { source: 'parentKey', targets: ['Parent / group key', 'Parent group key', 'Sub BOM ID', 'BOM ID'] },
    ...dynamicCandidates,
    ...(hasManufacturerValues(rows)
      ? [{ source: 'manufacturer', targets: [`Tag_${manufacturerTagSlot}`, 'Tag'] }]
      : []),
  ];

  return candidates
    .filter((mapping) => available.has(mapping.source))
    .map((mapping) => ({
      ...mapping,
      sourceLabel: mapping.source,
      origin: 'bom-normalizer',
    }));
};

const normalizeMappingHeaderKey = (value) => fmt(value).toLowerCase().replace(/[^a-z0-9]+/g, '');

const findMappingHeaderByCandidates = (headers = [], candidates = []) => {
  const keyToHeader = new Map((headers || []).map((header) => [normalizeMappingHeaderKey(header), header]));
  for (const candidate of candidates || []) {
    const header = keyToHeader.get(normalizeMappingHeaderKey(candidate));
    if (header) return header;
  }
  return '';
};

const buildResolvedNormalizerMappings = (suggestedMappings = [], clientHeaders = [], templateHeaders = []) => {
  const usedSources = new Set();
  const usedTargets = new Set();
  return (suggestedMappings || []).map((mapping) => {
    const source = findMappingHeaderByCandidates(clientHeaders, [mapping.source, mapping.sourceLabel].filter(Boolean));
    const target = findMappingHeaderByCandidates(templateHeaders, mapping.targets || [mapping.target].filter(Boolean));
    if (!source || !target || usedSources.has(source) || usedTargets.has(target)) return null;
    usedSources.add(source);
    usedTargets.add(target);
    return { source, target };
  }).filter(Boolean);
};

const extractSavedMappingsArray = (payload) => {
  const mappings = payload?.data?.mappings;
  if (Array.isArray(mappings)) return mappings;
  if (Array.isArray(mappings?.mappings)) return mappings.mappings;
  if (mappings && typeof mappings === 'object') {
    return Object.entries(mappings)
      .map(([target, source]) => ({ source, target }))
      .filter((mapping) => mapping.source && mapping.target);
  }
  return [];
};

const mergeExistingMappingsWithNormalizer = (existingMappings = [], normalizerMappings = []) => {
  const byTarget = new Map();
  const addMapping = (mapping) => {
    const source = fmt(mapping?.source);
    const target = fmt(mapping?.target);
    if (!source || !target) return;
    const key = normalizeMappingHeaderKey(target);
    if (!byTarget.has(key)) byTarget.set(key, { source, target });
  };

  (existingMappings || []).forEach(addMapping);
  (normalizerMappings || []).forEach(addMapping);
  return Array.from(byTarget.values());
};

const NormalizedTable = ({ rows, onRowsChange, lowConfidenceOnly, onLowConfidenceOnlyChange }) => {
  const { isDarkMode, tokens: themeTokens } = useThemeContext();
  const tableTone = {
    bg: themeTokens.table?.background || (isDarkMode ? 'rgba(6, 12, 24, 0.82)' : '#ffffff'),
    header: themeTokens.table?.header || (isDarkMode ? '#111827' : '#f8fafc'),
    text: themeTokens.text?.primary || (isDarkMode ? '#f8fafc' : '#0f172a'),
    muted: themeTokens.text?.secondary || (isDarkMode ? '#94a3b8' : '#66717f'),
    border: themeTokens.table?.line || (isDarkMode ? 'rgba(255,255,255,0.08)' : '#e1e6ec'),
    focusBg: themeTokens.surface?.elevatedSoft || (isDarkMode ? '#0f172a' : '#ffffff'),
    warningBg: themeTokens.state?.warningBg || (isDarkMode ? 'rgba(245, 158, 11, 0.14)' : '#fff8e5'),
  };
  const buttonSx = {
    borderRadius: '999px',
    minHeight: 32,
    px: 1.6,
    fontSize: 12,
    fontWeight: 800,
    textTransform: 'none',
    transition: 'transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease',
    '&:hover': {
      transform: 'translateY(-1px)',
    },
  };
  const outlineButtonSx = {
    ...buttonSx,
    color: isDarkMode ? '#dbeafe' : '#1d4ed8',
    borderColor: isDarkMode ? 'rgba(96, 165, 250, 0.32)' : 'rgba(37, 99, 235, 0.32)',
    background: isDarkMode ? 'rgba(15, 23, 42, 0.52)' : 'rgba(255, 255, 255, 0.82)',
    '&:hover': {
      ...buttonSx['&:hover'],
      borderColor: isDarkMode ? 'rgba(96, 165, 250, 0.7)' : 'rgba(37, 99, 235, 0.72)',
      background: isDarkMode ? 'rgba(37, 99, 235, 0.14)' : 'rgba(239, 246, 255, 0.96)',
      boxShadow: isDarkMode ? '0 12px 26px -18px rgba(37, 99, 235, 0.9)' : '0 12px 24px -18px rgba(37, 99, 235, 0.42)',
    },
  };
  const containedButtonSx = {
    ...buttonSx,
    background: 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)',
    boxShadow: '0 12px 24px -14px rgba(37, 99, 235, 0.82), inset 0 1px 0 rgba(255, 255, 255, 0.28)',
    '&:hover': {
      ...buttonSx['&:hover'],
      background: 'linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)',
      boxShadow: '0 16px 30px -16px rgba(37, 99, 235, 0.95), inset 0 1px 0 rgba(255, 255, 255, 0.38)',
    },
  };
  const columns = useMemo(() => {
    const knownKeys = new Set(NORMALIZED_TABLE_BASE_COLUMNS.map((column) => column.key));
    const dynamicColumns = getNormalizedExportColumns(rows)
      .filter((key) => !knownKeys.has(key))
      .map((key) => ({
        key,
        label: key,
        editable: true,
        width: key.startsWith('Tag_') ? 130 : 160,
      }));
    return [...NORMALIZED_TABLE_BASE_COLUMNS, ...dynamicColumns];
  }, [rows]);
  const defaultVisibleColumns = ['relation', 'level', 'cpn', 'mpn', 'manufacturer', 'quantity', 'uom', 'Item code', 'confidence'];
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(defaultVisibleColumns);
  const [searchQuery, setSearchQuery] = useState('');
  const [relationFilter, setRelationFilter] = useState('all');
  const [issueFilter, setIssueFilter] = useState('all');
  const [pendingPrimaryDeleteIndex, setPendingPrimaryDeleteIndex] = useState(null);
  const [allRowsOpen, setAllRowsOpen] = useState(false);
  const [allRowsPage, setAllRowsPage] = useState(0);
  const visibleColumns = columns.filter((column) => visibleColumnKeys.includes(column.key));
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const activeRelationFilter = NORMALIZED_RELATION_FILTERS.find((option) => option.value === relationFilter);
  const activeIssueFilter = NORMALIZED_ISSUE_FILTERS.find((option) => option.value === issueFilter);
  const filteredRows = rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .filter(({ row }) => {
      if (lowConfidenceOnly && Number(row.confidence || 0) >= 70) return false;
      if (relationFilter === 'primary' && row.relation !== 'Primary') return false;
      if (relationFilter === 'alternate' && row.relation === 'Primary') return false;
      if (issueFilter === 'low_confidence' && Number(row.confidence || 0) >= 70) return false;
      if (issueFilter === 'missing_mpn' && fmt(row.mpn)) return false;
      if (issueFilter === 'missing_mfr' && fmt(row.manufacturer)) return false;
      if (issueFilter === 'missing_cpn' && fmt(row.cpn)) return false;
      if (issueFilter === 'missing_qty' && fmt(row.quantity)) return false;
      if (!normalizedSearch) return true;
      return Object.values(row).some((value) => fmt(value).toLowerCase().includes(normalizedSearch));
    });
  const allRowsPerPage = 100;
  const allRowsTotalPages = Math.max(1, Math.ceil(filteredRows.length / allRowsPerPage));
  const allRowsVisibleRows = filteredRows.slice(
    allRowsPage * allRowsPerPage,
    allRowsPage * allRowsPerPage + allRowsPerPage
  );

  useEffect(() => {
    setAllRowsPage(0);
  }, [filteredRows.length, visibleColumnKeys.join('|')]);

  const handleCellChange = (rowIndex, key, value) => {
    if (!onRowsChange) return;
    onRowsChange(rows.map((row, index) => (
      index === rowIndex ? { ...row, [key]: value } : row
    )));
  };

  const applyDeleteRow = (rowIndex) => {
    if (!onRowsChange) return;
    onRowsChange(rebalanceRelations(rows.filter((_, index) => index !== rowIndex)));
  };

  const handleDeleteRow = (rowIndex) => {
    const row = rows[rowIndex];
    if (row?.relation === 'Primary') {
      setPendingPrimaryDeleteIndex(rowIndex);
      return;
    }
    applyDeleteRow(rowIndex);
  };

  const pendingPrimaryRow = pendingPrimaryDeleteIndex === null ? null : rows[pendingPrimaryDeleteIndex];
  const pendingPrimaryGroupCount = pendingPrimaryRow
    ? rows.filter((row) => normalizedGroupKey(row) === normalizedGroupKey(pendingPrimaryRow)).length
    : 0;

  const confirmPrimaryDelete = () => {
    if (pendingPrimaryDeleteIndex !== null) applyDeleteRow(pendingPrimaryDeleteIndex);
    setPendingPrimaryDeleteIndex(null);
  };

  useEffect(() => {
    const knownKeys = new Set(NORMALIZED_TABLE_BASE_COLUMNS.map((column) => column.key));
    const usefulDynamicKeys = columns
      .map((column) => column.key)
      .filter((key) => (
        !knownKeys.has(key) &&
        key !== 'discardedText' &&
        rows.some((row) => fmt(row[key]))
      ));
    const generatedKeys = columns
      .map((column) => column.key)
      .filter((key) => (key === 'Item code' || key.startsWith('Tag_')) && rows.some((row) => fmt(row[key])));
    const nextKeys = [...new Set([...generatedKeys, ...usefulDynamicKeys])];
    if (!nextKeys.length) return;
    setVisibleColumnKeys((prev) => [...new Set([...prev, ...nextKeys])]);
  }, [columns, rows]);

  return (
    <>
    <Paper elevation={0} sx={{ mt: 1.5, p: 1.2, border: `1px solid ${tableTone.border}`, bgcolor: tableTone.focusBg }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
          <Typography sx={{ fontSize: 13, fontWeight: 800 }}>Sheet view</Typography>
          <Chip size="small" label={`${filteredRows.length} of ${rows.length} rows`} />
          {lowConfidenceOnly && (
            <Chip
              size="small"
              color="warning"
              label="Low confidence only"
              onDelete={() => onLowConfidenceOnlyChange(false)}
            />
          )}
          {relationFilter !== 'all' && (
            <Chip
              size="small"
              variant="outlined"
              label={activeRelationFilter?.label || 'Relation filter'}
              onDelete={() => setRelationFilter('all')}
            />
          )}
          {issueFilter !== 'all' && (
            <Chip
              size="small"
              variant="outlined"
              label={activeIssueFilter?.label || 'Issue filter'}
              onDelete={() => setIssueFilter('all')}
            />
          )}
        </Stack>
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap" justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            startIcon={<VisibilityIcon />}
            onClick={() => setAllRowsOpen(true)}
            disabled={!filteredRows.length}
            sx={outlineButtonSx}
          >
            View all rows
          </Button>
          <TextField
            size="small"
            label="Search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            sx={{ width: 220 }}
          />
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Relation</InputLabel>
            <Select
              value={relationFilter}
              label="Relation"
              onChange={(event) => setRelationFilter(event.target.value)}
            >
              {NORMALIZED_RELATION_FILTERS.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Data issue</InputLabel>
            <Select
              value={issueFilter}
              label="Data issue"
              onChange={(event) => setIssueFilter(event.target.value)}
            >
              {NORMALIZED_ISSUE_FILTERS.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 230 }}>
            <InputLabel>Visible columns</InputLabel>
            <Select
              multiple
              value={visibleColumnKeys}
              label="Visible columns"
              renderValue={(selected) => `${selected.length} columns selected`}
              onChange={(event) => setVisibleColumnKeys(event.target.value)}
            >
              {columns.map((column) => (
                <MenuItem key={column.key} value={column.key}>
                  <Checkbox checked={visibleColumnKeys.includes(column.key)} />
                  <ListItemText primary={column.label} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Stack>
    </Paper>
    <TableContainer sx={{ mt: 1, maxHeight: 520, border: `1px solid ${tableTone.border}`, bgcolor: tableTone.bg }}>
      <Table stickyHeader size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 800, bgcolor: tableTone.header, color: tableTone.text, borderColor: tableTone.border, width: 56 }}>Actions</TableCell>
            {visibleColumns.map((column) => (
              <TableCell key={column.key} sx={{ fontWeight: 800, bgcolor: tableTone.header, color: tableTone.text, borderColor: tableTone.border, minWidth: column.width }}>
                {column.key === 'confidence' ? (
                  <Stack direction="row" alignItems="center" gap={0.5}>
                    <span>{column.label}</span>
                    <Tooltip title={CONFIDENCE_HELP_TEXT} arrow>
                      <InfoOutlinedIcon sx={{ fontSize: 16, color: tableTone.muted }} />
                    </Tooltip>
                  </Stack>
                ) : column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 1}>
                <Typography sx={{ py: 3, textAlign: 'center', color: tableTone.muted }}>
                  Run normalization to see parsed MPNs, manufacturers, alternates, levels, and confidence.
                </Typography>
              </TableCell>
            </TableRow>
          ) : filteredRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 1}>
                <Typography sx={{ py: 3, textAlign: 'center', color: tableTone.muted }}>
                  No rows match the current filter.
                </Typography>
              </TableCell>
            </TableRow>
          ) : filteredRows.slice(0, 250).map(({ row, originalIndex }) => (
            <TableRow key={`${row.sourceRow}-${row.relation}-${originalIndex}`} sx={{ bgcolor: row.confidence < 70 ? tableTone.warningBg : 'inherit' }}>
              <TableCell>
                <IconButton size="small" color="error" onClick={() => handleDeleteRow(originalIndex)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </TableCell>
              {visibleColumns.map((column) => (
                <TableCell key={column.key} sx={{ maxWidth: column.width + 40, p: column.editable ? 0.5 : 1, color: tableTone.text, borderColor: tableTone.border }}>
                  {column.editable ? (
                    <Box
                      component="input"
                      value={row[column.key] || ''}
                      onChange={(event) => handleCellChange(originalIndex, column.key, event.target.value)}
                      sx={{
                        width: '100%',
                        minWidth: column.width,
                        border: '1px solid transparent',
                        borderRadius: '3px',
                        bgcolor: 'transparent',
                        color: tableTone.text,
                        caretColor: tableTone.text,
                        px: 0.75,
                        py: 0.55,
                        font: 'inherit',
                        '&:focus': {
                          bgcolor: tableTone.focusBg,
                          borderColor: '#1976d2',
                          outline: 'none',
                        },
                      }}
                    />
                  ) : (
                    <Typography sx={{ fontSize: 13, color: tableTone.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {column.key === 'confidence' ? `${row[column.key]}%` : row[column.key]}
                    </Typography>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > 250 && (
        <Box sx={{ p: 1, bgcolor: tableTone.header, borderTop: `1px solid ${tableTone.border}` }}>
          <Typography sx={{ fontSize: 12, color: tableTone.muted }}>Showing first 250 rows for prototype performance.</Typography>
        </Box>
      )}
    </TableContainer>
      <Dialog open={allRowsOpen} onClose={() => setAllRowsOpen(false)} maxWidth="xl" fullWidth>
        <DialogTitle>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={1}>
            <Box>
              <Typography sx={{ fontSize: 18, fontWeight: 800 }}>All normalized rows</Typography>
              <Typography sx={{ mt: 0.4, fontSize: 13, color: tableTone.muted }}>
                Showing the same rows and visible columns as the current sheet view.
              </Typography>
            </Box>
            <Stack direction="row" gap={0.75} flexWrap="wrap">
              <Chip size="small" label={`${filteredRows.length} of ${rows.length} rows`} />
              <Chip size="small" label={`${visibleColumns.length} columns`} />
              {lowConfidenceOnly && <Chip size="small" color="warning" label="Low confidence only" />}
              {relationFilter !== 'all' && <Chip size="small" variant="outlined" label={activeRelationFilter?.label || 'Relation filter'} />}
              {issueFilter !== 'all' && <Chip size="small" variant="outlined" label={activeIssueFilter?.label || 'Issue filter'} />}
              {normalizedSearch && <Chip size="small" variant="outlined" label={`Search: ${searchQuery}`} />}
            </Stack>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <TableContainer
            sx={{
              maxHeight: '64vh',
              overflow: 'auto',
              border: `1px solid ${tableTone.border}`,
              bgcolor: tableTone.bg,
              '&::-webkit-scrollbar': { height: 10, width: 10 },
              '&::-webkit-scrollbar-thumb': {
                borderRadius: 8,
                bgcolor: isDarkMode ? 'rgba(148, 163, 184, 0.42)' : 'rgba(100, 116, 139, 0.38)',
              },
            }}
          >
            <Table stickyHeader size="small" sx={{ width: 'max-content', minWidth: '100%', tableLayout: 'fixed' }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 70, fontWeight: 800, bgcolor: tableTone.header, color: tableTone.text, borderColor: tableTone.border }}>
                    #
                  </TableCell>
                  {visibleColumns.map((column) => (
                    <TableCell
                      key={column.key}
                      sx={{
                        minWidth: column.width,
                        maxWidth: column.width + 80,
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        bgcolor: tableTone.header,
                        color: tableTone.text,
                        borderColor: tableTone.border,
                      }}
                    >
                      {column.key === 'confidence' ? (
                        <Stack direction="row" alignItems="center" gap={0.5}>
                          <span>{column.label}</span>
                          <Tooltip title={CONFIDENCE_HELP_TEXT} arrow>
                            <InfoOutlinedIcon sx={{ fontSize: 16, color: tableTone.muted }} />
                          </Tooltip>
                        </Stack>
                      ) : column.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {allRowsVisibleRows.map(({ row, originalIndex }, pageIndex) => (
                  <TableRow key={`all-normalized-${originalIndex}`} sx={{ bgcolor: row.confidence < 70 ? tableTone.warningBg : 'inherit' }}>
                    <TableCell sx={{ minWidth: 70, color: tableTone.text, borderColor: tableTone.border, fontWeight: 700 }}>
                      {allRowsPage * allRowsPerPage + pageIndex + 1}
                    </TableCell>
                    {visibleColumns.map((column) => (
                      <TableCell
                        key={column.key}
                        sx={{
                          minWidth: column.width,
                          maxWidth: column.width + 80,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          color: tableTone.text,
                          borderColor: tableTone.border,
                        }}
                      >
                        {column.key === 'confidence' ? `${row[column.key]}%` : row[column.key]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: 13, color: tableTone.muted }}>
            Page {allRowsPage + 1} of {allRowsTotalPages}
          </Typography>
          <Stack direction="row" gap={1}>
            <Button
              variant="outlined"
              disabled={allRowsPage === 0}
              onClick={() => setAllRowsPage((page) => Math.max(0, page - 1))}
              sx={outlineButtonSx}
            >
              Previous
            </Button>
            <Button
              variant="outlined"
              disabled={allRowsPage >= allRowsTotalPages - 1}
              onClick={() => setAllRowsPage((page) => Math.min(allRowsTotalPages - 1, page + 1))}
              sx={outlineButtonSx}
            >
              Next
            </Button>
            <Button variant="contained" onClick={() => setAllRowsOpen(false)} sx={containedButtonSx}>Done</Button>
          </Stack>
        </DialogActions>
      </Dialog>
      <Dialog
        open={pendingPrimaryDeleteIndex !== null}
        onClose={() => setPendingPrimaryDeleteIndex(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete primary material?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, color: '#536171' }}>
            This row is marked as Primary. If you delete it, the next alternate in this group will become Primary and the remaining alternates will be renumbered.
          </Typography>
          {pendingPrimaryGroupCount <= 1 && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              This group has no alternates, so deleting this row will remove the whole material group.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingPrimaryDeleteIndex(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmPrimaryDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

// Fold one Parse Fields result onto a sheet: the parsed columns land on the
// rows the edit was scoped to, and a pattern-scoped edit also yields the manual
// MPN/MFR override that replaces the auto-detected parse for those rows.
//
// Pure and sequential so several staged edits can be replayed in order at
// normalization time, rather than each one mutating the sheet as it is made.
const applyParserResultToSheet = ({ result, scope, headers, sourceRows, headerRowIndex }) => {
  const parserHeaders = Array.isArray(result?.new_headers) ? result.new_headers : [];
  const parserData = Array.isArray(result?.new_data) ? result.new_data : [];
  if (!parserHeaders.length || !parserData.length) return null;

  const nextHeaders = [...headers];
  const parserHeaderMap = parserHeaders.map((header) => {
    if (nextHeaders.includes(header)) return header;
    const safeHeader = uniqueHeaderName(header, nextHeaders);
    nextHeaders.push(safeHeader);
    return safeHeader;
  });

  const scopedSourceRows = scope?.mode === 'pattern' && Array.isArray(scope.sourceRows)
    ? scope.sourceRows
    : null;
  const scopedDataBySourceRow = scopedSourceRows
    ? new Map(scopedSourceRows.map((sourceRow, scopedIndex) => [sourceRow, parserData[scopedIndex] || []]))
    : null;

  const nextRows = sourceRows.map((source, index) => {
    const nextRow = {
      ...source,
      __sourceRow: source.__sourceRow || index + headerRowIndex + 2,
    };
    const parserRow = scopedDataBySourceRow
      ? scopedDataBySourceRow.get(nextRow.__sourceRow)
      : (parserData[index] || []);
    // Rows outside this pattern keep whatever an earlier edit gave them.
    if (scopedDataBySourceRow && !scopedDataBySourceRow.has(nextRow.__sourceRow)) return nextRow;
    parserHeaderMap.forEach((header, columnIndex) => {
      nextRow[header] = Array.isArray(parserRow)
        ? (parserRow[columnIndex] ?? '')
        : (parserRow?.[parserHeaders[columnIndex]] ?? '');
    });
    return nextRow;
  });

  const sourceHeader = scope?.sourceHeader || '';
  const patternShape = scope?.patternShape || '';
  let override = null;

  if (scopedSourceRows && sourceHeader && patternShape) {
    const findParserIndex = (aliases) => parserHeaders.findIndex((header) => (
      aliases.some((alias) => normalizeKey(header) === normalizeKey(alias))
    ));
    const mpnIndex = findParserIndex(['MPN', 'Mfr Part Number', 'Manufacturer Part Number', 'Part Number']);
    const mfrIndex = findParserIndex(['MFR', 'Manufacturer', 'Manufacturer Name']);
    const extraIndex = findParserIndex(['Extra', 'Discard', 'Discarded Text', 'Ignore']);

    const rowsBySourceRow = {};
    scopedSourceRows.forEach((sourceRow, scopedIndex) => {
      const parserRow = parserData[scopedIndex] || [];
      const valueAt = (columnIndex) => {
        if (columnIndex < 0) return '';
        return Array.isArray(parserRow)
          ? (parserRow[columnIndex] ?? '')
          : (parserRow?.[parserHeaders[columnIndex]] ?? '');
      };
      // Every configured output, split back into one value per entry, so a
      // packed cell's 2nd entry can fill the 2nd normalized row. MPN/MFR/Extra
      // are excluded: the pair list above already owns those.
      const fields = {};
      parserHeaders.forEach((header, columnIndex) => {
        if (columnIndex === mpnIndex || columnIndex === mfrIndex || columnIndex === extraIndex) return;
        const values = splitParserJoinedValues(valueAt(columnIndex));
        if (values.length) fields[header] = values;
      });

      rowsBySourceRow[sourceRow] = {
        pairs: buildManualPairList(valueAt(mpnIndex), valueAt(mfrIndex), valueAt(extraIndex)),
        fields,
      };
    });

    const configuredOutputs = (result?.parser_preview?.items || [])
      .map((item) => String(item?.label || '').split(':')[0])
      .filter(Boolean);
    const configuredOutputSummary = configuredOutputs.length
      ? [...new Set(configuredOutputs)].join(' / ')
      : 'manual parser outputs';

    override = {
      sourceHeader,
      patternShape,
      rows: rowsBySourceRow,
      displayExample: result?.parser_preview || null,
      rules: [
        'Manual parser override applied.',
        `Configured outputs: ${configuredOutputSummary}.`,
      ],
      summary: configuredOutputSummary,
    };
  }

  return {
    nextHeaders,
    nextRows,
    override,
    scopedCount: scopedSourceRows?.length || 0,
  };
};

// Parser target column -> the normalized output field it fills. Anything not
// listed here keeps its own name and simply becomes an extra output column,
// which getNormalizedExportColumns already picks up.
const NORMALIZED_FIELD_BY_PARSER_TARGET = {
  cpn: 'cpn',
  description: 'description',
  quantity: 'quantity',
  uom: 'uom',
  'item code': 'Item code',
};

// Fields the normalizer owns outright. MPN/MFR/discarded text reach the output
// through the pair list, which also drives alternates, vendor-prefix stripping
// and manufacturer inheritance - overwriting them here would undo all of that.
const PARSER_PROTECTED_NORMALIZED_FIELDS = new Set([
  'mpn', 'manufacturer', 'discardedText',
  'sourceRow', 'parentKey', 'parent', 'relation', 'level', 'rule', 'confidence',
]);

// Write the parsed values onto the rows normalization produced. A source row
// expands into one output row per entry, in order, so entry N fills output N -
// that is what makes "the MPN column shows the parsed MPN" true for alternates
// as well as the primary.
const applyPatternOutputsToNormalizedRows = (rows, overrides = []) => {
  const fieldsBySourceRow = new Map();
  overrides.forEach((override) => {
    Object.entries(override?.rows || {}).forEach(([sourceRow, entry]) => {
      if (entry?.fields && Object.keys(entry.fields).length) {
        fieldsBySourceRow.set(String(sourceRow), entry.fields);
      }
    });
  });
  if (!fieldsBySourceRow.size) return rows;

  const positionBySourceRow = new Map();
  return rows.map((row) => {
    const key = String(row?.sourceRow ?? '');
    const fields = fieldsBySourceRow.get(key);
    if (!fields) return row;

    const position = positionBySourceRow.get(key) || 0;
    positionBySourceRow.set(key, position + 1);

    const next = { ...row };
    Object.entries(fields).forEach(([column, values]) => {
      const target = NORMALIZED_FIELD_BY_PARSER_TARGET[normalizeKey(column)] || column;
      if (PARSER_PROTECTED_NORMALIZED_FIELDS.has(target)) return;
      // Fall back to the first entry so a single-valued output (one item code
      // for the whole cell) still reaches every row it belongs to.
      const value = fmt(values[position] ?? values[0] ?? '');
      if (value) next[target] = value;
    });
    return next;
  });
};

// Replace any edit already staged for the same pattern — re-editing a shape
// supersedes the previous attempt rather than stacking on it.
const withStagedPatternEdit = (staged, edit) => ([
  ...staged.filter((entry) => !(
    normalizeKey(entry.sourceHeader) === normalizeKey(edit.sourceHeader) &&
    entry.patternShape === edit.patternShape
  )),
  edit,
]);

// Cell-role → colour map used by the option-example tooltip. Green = primary,
// orange = alternate, blue = group/key column, yellow = mixed-primary+alt
// value packed in one cell. Rendered against a dark tooltip background so
// the visual pattern reads at a glance without parsing the text.
const EXAMPLE_ROLE_STYLES = {
  header:  { bg: '#2d2d3a', color: '#ffffff', weight: 700 },
  primary: { bg: '#1f4d2b', color: '#c8f7c8', weight: 600 },
  alt:     { bg: '#4a2f1f', color: '#ffcfa8', weight: 500 },
  key:     { bg: '#2a3a4d', color: '#a8d0ff', weight: 500 },
  mixed:   { bg: '#4a3f1f', color: '#ffe89a', weight: 500 },
  plain:   { bg: 'transparent', color: '#dddddd', weight: 400 },
};

// Big, high-contrast option-example tooltip. Same shape drives every
// dropdown that carries `option.example = { caption, rows: [[{text, role}]] }`.
// Includes the option label as a heading, the mini-sheet, a "what to look
// for" caption, and a colour legend for primary vs alternate.
const OptionExampleTooltip = ({ option, children }) => {
  if (!option?.example) return children;
  return (
    <Tooltip
      arrow
      placement="right"
      enterDelay={100}
      leaveDelay={200}
      componentsProps={{
        tooltip: {
          sx: {
            bgcolor: '#1e1e28',
            color: '#ffffff',
            maxWidth: 'none',
            p: 2,
            border: '1px solid #444',
            boxShadow: 6,
          },
        },
        arrow: { sx: { color: '#1e1e28' } },
      }}
      title={
        <Box sx={{ minWidth: 380 }}>
          <Box sx={{ fontSize: 14, fontWeight: 700, mb: 0.5 }}>{option.label}</Box>
          <Box sx={{ fontSize: 12, opacity: 0.75, mb: 1.5 }}>
            Example of what your sheet looks like:
          </Box>
          <Box
            component="table"
            sx={{
              borderCollapse: 'collapse',
              fontFamily: 'monospace',
              fontSize: 13,
              width: '100%',
            }}
          >
            <tbody>
              {option.example.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => {
                    const style = EXAMPLE_ROLE_STYLES[cell.role || 'plain'] || EXAMPLE_ROLE_STYLES.plain;
                    return (
                      <Box
                        key={ci}
                        component="td"
                        sx={{
                          border: '1px solid #555',
                          px: 1.25,
                          py: 0.75,
                          fontWeight: style.weight,
                          bgcolor: style.bg,
                          color: style.color,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {cell.text || ' '}
                      </Box>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Box>
          {option.example.caption && (
            <Box sx={{ mt: 1.5, fontSize: 12.5, lineHeight: 1.5, color: '#ffe07a' }}>
              <strong>What to look for:</strong> {option.example.caption}
            </Box>
          )}
          <Box sx={{ display: 'flex', gap: 1.5, mt: 1.25, fontSize: 11, opacity: 0.85, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 12, height: 12, bgcolor: '#1f4d2b', border: '1px solid #555' }} />
              <span>= Primary</span>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 12, height: 12, bgcolor: '#4a2f1f', border: '1px solid #555' }} />
              <span>= Alternate</span>
            </Box>
          </Box>
        </Box>
      }
    >
      {children}
    </Tooltip>
  );
};

const BomNormalizer = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDarkMode, tokens: themeTokens } = useThemeContext();
  const normalizerTheme = useMemo(() => ({
    page: themeTokens.surface?.page || (isDarkMode ? '#0b0f19' : '#f8fafc'),
    header: isDarkMode ? 'rgba(11, 16, 26, 0.92)' : '#ffffff',
    paper: themeTokens.surface?.cardSolid || (isDarkMode ? '#131823' : '#ffffff'),
    paperSoft: themeTokens.surface?.elevatedSoft || (isDarkMode ? '#0f172a' : '#f8fafc'),
    table: themeTokens.table?.background || (isDarkMode ? 'rgba(6, 12, 24, 0.82)' : '#ffffff'),
    tableHeader: themeTokens.table?.header || (isDarkMode ? '#111827' : '#f8fafc'),
    hover: themeTokens.table?.hover || (isDarkMode ? 'rgba(37, 99, 235, 0.08)' : '#eff6ff'),
    text: themeTokens.text?.primary || (isDarkMode ? '#f8fafc' : '#0f172a'),
    muted: themeTokens.text?.secondary || (isDarkMode ? '#94a3b8' : '#475569'),
    disabled: themeTokens.text?.disabled || (isDarkMode ? '#64748b' : '#94a3b8'),
    border: themeTokens.border?.default || (isDarkMode ? 'rgba(255,255,255,0.14)' : 'rgba(226, 232, 240, 0.8)'),
    borderStrong: themeTokens.border?.strong || (isDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(203, 213, 225, 0.8)'),
    warningBg: themeTokens.state?.warningBg || (isDarkMode ? 'rgba(245, 158, 11, 0.14)' : '#fff8e5'),
    panelGradient: isDarkMode
      ? 'linear-gradient(145deg, rgba(20, 27, 44, 0.94) 0%, rgba(11, 16, 26, 0.98) 100%)'
      : 'linear-gradient(145deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 250, 252, 0.92) 100%)',
    panelSoftGradient: isDarkMode
      ? 'linear-gradient(145deg, rgba(15, 23, 42, 0.76) 0%, rgba(8, 13, 24, 0.86) 100%)'
      : 'linear-gradient(145deg, rgba(255, 255, 255, 0.9) 0%, rgba(241, 245, 249, 0.82) 100%)',
  }), [isDarkMode, themeTokens]);
  const [mousePos, setMousePos] = useState({ x: 72, y: 22 });
  // BOM structure gate. Asked here rather than at upload so the user answers
  // after seeing the normalized rows, when "does this have levels" is a
  // question about real output instead of raw headers.
  const [bomStructureOpen, setBomStructureOpen] = useState(false);
  const [bomStructureAnswers, setBomStructureAnswers] = useState(null);
  // Answers carried over from a reused mapping template, already checked
  // against this file. The gate opens pre-filled with whatever survived.
  const [bomStructureSeed, setBomStructureSeed] = useState(null);
  const [pendingBomAction, setPendingBomAction] = useState(null);
  const [workbook, setWorkbook] = useState(null);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [sheetScope, setSheetScope] = useState('single');
  const [selectedSheetNames, setSelectedSheetNames] = useState([]);
  const [sheetRows, setSheetRows] = useState([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  // Multi-sheet only: one header row pinned across every selected sheet. Empty
  // means each sheet keeps its own auto-detected header row.
  const [sheetHeaderRowOverride, setSheetHeaderRowOverride] = useState('');
  const [preparedHeaders, setPreparedHeaders] = useState([]);
  const [preparedDataRows, setPreparedDataRows] = useState([]);
  const [sourceEndRow, setSourceEndRow] = useState('');
  const [sourceGridOpen, setSourceGridOpen] = useState(false);
  const [sourceGridPage, setSourceGridPage] = useState(0);
  const [roles, setRoles] = useState(emptyRoles);
  const [config, setConfig] = useState({
    structure: 'separate_cells',
    bomLayout: 'none',
    alternateLayout: 'inside_selected_mpn_columns',
    delimiterMode: 'auto',
    customDelimiter: '',
    groupHeaderMode: 'auto',
    manufacturerMode: 'inherit_blank',
    quantityMode: 'inherit_primary',
    quantityVariant: QUANTITY_VARIANT_ALL,
    quantityVariantByBlock: {},
    inheritLevels: true,
    skipTitleRows: true,
    skipRepeatedHeaders: true,
    skipDoNotPopulate: false,
    skipDeletedRows: true,
    documentTypeValues: [],
    parentPathLevels: true,
    alternateColumnGroups: [],
    followingRowAlternateColumn: '',
    includeInsideCellAlternatesWithFollowingRows: true,
    followingItemRowsContextColumn: '',
    followingItemRowsItemColumn: '',
    followingItemRowsMpnColumn: '',
    followingItemRowsManufacturerColumn: '',
    followingItemRowsCpnMode: 'primary',
  });
  const [normalizedRows, setNormalizedRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
  const [delimiterTouched, setDelimiterTouched] = useState(false);
  const [parserTouched, setParserTouched] = useState(false);
  const [skipSourceSetupForMerge, setSkipSourceSetupForMerge] = useState(false);
  const [normalizationSummary, setNormalizationSummary] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summaryParserDetailsOpen, setSummaryParserDetailsOpen] = useState(false);
  const [pairingReviewOpen, setPairingReviewOpen] = useState(false);
  const [pairingReviewRows, setPairingReviewRows] = useState([]);
  const [pendingNormalization, setPendingNormalization] = useState(null);
  const [lowConfidenceOnly, setLowConfidenceOnly] = useState(false);
  const [factwiseDialogOpen, setFactwiseDialogOpen] = useState(false);
  const [factwiseConfig, setFactwiseConfig] = useState({
    mode: 'columns',
    firstColumn: 'manufacturer',
    secondColumn: 'mpn',
    separator: '_',
    prefix: 'ITEM-',
    start: 1,
    padding: 4,
    increment: true,
    applyMode: 'overwrite',
  });
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagConfig, setTagConfig] = useState({
    targetColumn: 'Tag_1',
    mode: 'rules',
    sourceColumn: 'manufacturer',
    defaultValue: '',
    rules: [
      {
        sourceColumn: 'manufacturer',
        searchText: '',
        outputValue: '',
        caseSensitive: false,
      },
    ],
    applyMode: 'overwrite',
  });
  const [deleteRowsOpen, setDeleteRowsOpen] = useState(false);
  const [deleteRowsColumn, setDeleteRowsColumn] = useState('');
  const [deleteRowsOperator, setDeleteRowsOperator] = useState('is_empty');
  const [deleteRowsCompare, setDeleteRowsCompare] = useState('');
  const [deleteRowsBusy, setDeleteRowsBusy] = useState(false);
  const [manufacturerDirectory, setManufacturerDirectory] = useState({ names: [], aliases: {}, loaded: false });
  const [manufacturerMatchOpen, setManufacturerMatchOpen] = useState(false);
  const [manufacturerMatchLoading, setManufacturerMatchLoading] = useState(false);
  const [manufacturerMatchError, setManufacturerMatchError] = useState('');
  const [selectedManufacturerMatches, setSelectedManufacturerMatches] = useState([]);
  const [downloadMenuAnchor, setDownloadMenuAnchor] = useState(null);
  const [toolsMenuAnchor, setToolsMenuAnchor] = useState(null);
  const [parsingLogicOpen, setParsingLogicOpen] = useState(false);
  const [selectedParsingPatternKey, setSelectedParsingPatternKey] = useState('');
  const [selectedParsingDetailsOpen, setSelectedParsingDetailsOpen] = useState(false);
  const [configureSplitColsOpen, setConfigureSplitColsOpen] = useState(false);
  const [configureParserSessionId, setConfigureParserSessionId] = useState('');
  const [configureParserPreparing, setConfigureParserPreparing] = useState(false);
  const [configureParserInitialColumn, setConfigureParserInitialColumn] = useState('');
  const [configureParserTitle, setConfigureParserTitle] = useState('Split into Columns');
  const [configureParserScope, setConfigureParserScope] = useState(null);
  const [patternParserOverrides, setPatternParserOverrides] = useState([]);
  // Parse Fields edits wait here until Run normalization. Applying them the
  // moment Apply is clicked rewrote the sheet before the user had walked the
  // remaining patterns, which made a review step that changes nothing on its own
  // into an edit that already happened.
  const [stagedPatternEdits, setStagedPatternEdits] = useState([]);
  const [patternApplyNotice, setPatternApplyNotice] = useState('');
  const [roleColumnLabelModes, setRoleColumnLabelModes] = useState({});
  const [combineItems, setCombineItems] = useState([]);
  const [combineBusy, setCombineBusy] = useState(false);
  const [combineError, setCombineError] = useState('');
  const [mergeChainMessage, setMergeChainMessage] = useState('');
  const [mergeSources, setMergeSources] = useState([]);
  const [mergeStage, setMergeStage] = useState('sources');
  const [mergeConfig, setMergeConfig] = useState({
    primarySourceId: '',
    secondarySourceId: '',
    primaryKey: '',
    secondaryKey: '',
    relationshipName: '',
    outputMode: 'grouped',
    detailColumns: [],
  });
  const [mergePreview, setMergePreview] = useState(null);
  const [mergePreviewFilter, setMergePreviewFilter] = useState('all');
  const [mergePreviewSearch, setMergePreviewSearch] = useState('');
  const [mergePreviewPage, setMergePreviewPage] = useState(0);
  const [mergeVisibleColumns, setMergeVisibleColumns] = useState([]);
  const [mergeColumnWidths, setMergeColumnWidths] = useState({});
  const [pdfChoiceOpen, setPdfChoiceOpen] = useState(false);
  const [pendingPdfAction, setPendingPdfAction] = useState(null);
  const [pdfRangeEnabled, setPdfRangeEnabled] = useState(false);
  const [pdfRanges, setPdfRanges] = useState([
    { name: 'Section 1', pages: '' },
    { name: 'Section 2', pages: '' },
  ]);
  const [workflowTemplates, setWorkflowTemplates] = useState([]);
  const [selectedWorkflowTemplateId, setSelectedWorkflowTemplateId] = useState('');
  const [workflowTemplateLoading, setWorkflowTemplateLoading] = useState(false);
  const [workflowTemplateSaving, setWorkflowTemplateSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [error, setError] = useState('');
  const initialFileSeededRef = useRef('');
  const restoredReturnSnapshotRef = useRef('');
  const autoReplayTemplateRef = useRef('');
  const restoreInFlightRef = useRef(false);

  useEffect(() => {
    const handleMouseMove = (event) => {
      setMousePos({
        x: (event.clientX / window.innerWidth) * 100,
        y: (event.clientY / window.innerHeight) * 100,
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const headers = useMemo(
    () => preparedHeaders.length ? preparedHeaders : makeUniqueHeaders(sheetRows[headerRowIndex] || []),
    [preparedHeaders, sheetRows, headerRowIndex]
  );
  const visibleSourceHeaders = useMemo(
    () => headers.filter((header) => !fmt(header).startsWith('__')),
    [headers]
  );

  const sourceDataRows = useMemo(() => (
    preparedDataRows.length ? preparedDataRows : rowsToObjects(sheetRows.slice(headerRowIndex + 1), headers, headerRowIndex + 2)
  ), [preparedDataRows, sheetRows, headerRowIndex, headers]);

  const sourceColumnIndexByHeader = useMemo(() => {
    const map = {};
    getUsableColumnDescriptors(sheetRows, headerRowIndex).forEach((column) => {
      if (column.header) map[column.header] = column.index;
    });
    return map;
  }, [sheetRows, headerRowIndex]);

  const dataRows = useMemo(() => (
    filterRowsByEndRow(sourceDataRows, sourceEndRow)
  ), [sourceDataRows, sourceEndRow]);

  const sourceRowsExcludedByLimit = Math.max(0, sourceDataRows.length - dataRows.length);
  const sourceLimitActive = Boolean(sourceEndRow && sourceRowsExcludedByLimit > 0);
  const sourceGridRowsPerPage = 50;
  const isSourceRowExcluded = useCallback((row) => (
    Boolean(sourceEndRow) && Number(row?.__sourceRow || 0) > Number(sourceEndRow)
  ), [sourceEndRow]);

  // Staged edits read as already-applied everywhere the app only LOOKS at the
  // parse — the review dialog's example, the pattern rules, the source preview.
  // Committing them to the sheet is still deferred to Run normalization; this
  // just stops the review step from describing the parse the edit replaced.
  const previewPatternOverrides = useMemo(() => {
    if (!stagedPatternEdits.length) return patternParserOverrides;
    let merged = patternParserOverrides;
    stagedPatternEdits.forEach((edit) => {
      if (!edit.override) return;
      merged = [
        ...merged.filter((override) => !(
          normalizeKey(override.sourceHeader) === normalizeKey(edit.override.sourceHeader) &&
          override.patternShape === edit.override.patternShape
        )),
        edit.override,
      ];
    });
    return merged;
  }, [patternParserOverrides, stagedPatternEdits]);

  const normalizerConfig = useMemo(() => ({
    ...config,
    patternParserOverrides: previewPatternOverrides,
  }), [config, previewPatternOverrides]);

  const sourcePreviewAssemblyMatrix = useMemo(() => {
    if (!headers.length || !dataRows.length) return null;
    return effectiveStructure(normalizerConfig) === 'assembly_quantity_matrix'
      ? (detectAssemblyQuantityMatrix(headers, dataRows, roles) || normalizerConfig.assemblyMatrix)
      : null;
  }, [dataRows, headers, normalizerConfig.assemblyMatrix, normalizerConfig.bomLayout, normalizerConfig.structure, roles]);

  const multiBlockSummary = useMemo(() => {
    if (!rowsLookLikeMultiBlockAssembly(headers, dataRows)) return null;
    const blockMap = new Map();
    dataRows.forEach((row) => {
      if (!row.__blockId) return;
      if (!blockMap.has(row.__blockId)) {
        blockMap.set(row.__blockId, {
          id: row.__blockId,
          sheet: row['Source sheet'] || '',
          title: row.__blockTitle || row['BOM block'] || '',
          name: row.__blockName || row['BOM block'] || '',
          rowCount: 0,
        });
      }
      blockMap.get(row.__blockId).rowCount += 1;
    });
    const blocks = [...blockMap.values()];
    return {
      blockCount: blocks.length,
      sheetCount: new Set(blocks.map((block) => block.sheet).filter(Boolean)).size,
      blocks,
    };
  }, [dataRows, headers]);

  useEffect(() => {
    setSourceGridPage(0);
  }, [fileName, sheetName, sheetScope, selectedSheetNames, headerRowIndex, sourceEndRow]);

  const quality = useMemo(() => {
    if (!normalizedRows.length) return { average: 0, lowConfidence: 0 };
    const total = normalizedRows.reduce((sum, row) => sum + row.confidence, 0);
    return {
      average: Math.round(total / normalizedRows.length),
      lowConfidence: normalizedRows.filter((row) => row.confidence < 70).length,
    };
  }, [normalizedRows]);

  const selectedStructureOption = useMemo(
    () => STRUCTURE_OPTIONS.find((option) => option.value === config.structure),
    [config.structure]
  );

  const selectedAlternateOption = useMemo(
    () => ALTERNATE_LAYOUT_OPTIONS.find((option) => option.value === config.alternateLayout),
    [config.alternateLayout]
  );

  const followingRowsInsideCellAlternateInfo = useMemo(() => {
    if (config.alternateLayout !== 'following_rows') return null;
    const sourceHeaders = [...new Set([roles.mpn, roles.manufacturer].filter(Boolean))]
      .filter((header) => normalizeKey(header) !== normalizeKey(config.followingRowAlternateColumn));
    if (!sourceHeaders.length) return null;

    let matchedRows = 0;
    let example = null;
    dataRows.forEach((row) => {
      if (matchedRows > 25) return;
      const hasInsideAlternates = sourceHeaders.some((header) => {
        const value = getCell(row, header);
        if (!value) return false;
        const packedPairs = getPatternAwarePackedPairs(row, header, value, normalizerConfig);
        if (packedPairs.length > 1) return true;
        return splitMpnCell(value, normalizerConfig).length > 1;
      });
      if (!hasInsideAlternates) return;
      matchedRows += 1;
      if (!example) {
        const header = sourceHeaders.find((candidate) => {
          const value = getCell(row, candidate);
          return value && (
            getPatternAwarePackedPairs(row, candidate, value, normalizerConfig).length > 1 ||
            splitMpnCell(value, normalizerConfig).length > 1
          );
        });
        example = {
          header,
          value: header ? getCell(row, header) : '',
        };
      }
    });

    if (!matchedRows) return null;
    return {
      matchedRows,
      example,
    };
  }, [config.alternateLayout, config.followingRowAlternateColumn, dataRows, normalizerConfig, roles.manufacturer, roles.mpn]);

  const selectedDelimiterOption = useMemo(
    () => DELIMITER_OPTIONS.find((option) => option.value === config.delimiterMode),
    [config.delimiterMode]
  );

  const selectedQuantityOption = useMemo(
    () => QTY_OPTIONS.find((option) => option.value === config.quantityMode),
    [config.quantityMode]
  );
  const selectedBomLayoutOption = useMemo(
    () => BOM_LAYOUT_OPTIONS.find((option) => option.value === (config.bomLayout || 'none')),
    [config.bomLayout]
  );
  const activeBomLayout = selectedBomLayout(config);
  const bomLayoutActive = Boolean(activeBomLayout);
  const hasMultiBlockRows = Boolean(multiBlockSummary);
  const assemblyQuantityVariantOptions = useMemo(() => (
    activeBomLayout === 'assembly_quantity_matrix'
      ? [...new Set((sourcePreviewAssemblyMatrix?.assemblyColumns || []).map(fmt).filter(Boolean))]
      : []
  ), [activeBomLayout, sourcePreviewAssemblyMatrix]);
  const multiBlockQuantityVariantGroups = useMemo(() => {
    if (!hasMultiBlockRows) return [];
    const groups = new Map();
    dataRows.forEach((row) => {
      if (row?.__multiBlockMode !== '1') return;
      const variant = fmt(getRowQuantityVariant(row));
      if (!variant) return;
      const groupKey = getRowQuantityVariantGroup(row);
      if (!groupKey) return;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          key: groupKey,
          label: [
            row['BOM block'] || row.__blockName || row.__blockTitle,
            row['Source sheet'] ? `(${row['Source sheet']})` : '',
          ].map(fmt).filter(Boolean).join(' '),
          variants: [],
        });
      }
      const group = groups.get(groupKey);
      if (!group.variants.some((existing) => quantityVariantMatches(existing, variant))) {
        group.variants.push(variant);
      }
    });
    return [...groups.values()].filter((group) => group.variants.length > 1);
  }, [dataRows, hasMultiBlockRows]);
  const showAssemblyQuantityVariantSelector = assemblyQuantityVariantOptions.length > 1;
  const showMultiBlockQuantityVariantSelectors = multiBlockQuantityVariantGroups.length > 0;
  const previewDataRows = useMemo(() => (
    hasMultiBlockRows
      ? filterRowsByQuantityVariant(dataRows, normalizerConfig)
      : dataRows
  ), [dataRows, hasMultiBlockRows, normalizerConfig]);
  const sourceGridRows = useMemo(() => (
    hasMultiBlockRows
      ? filterRowsByQuantityVariant(sourceDataRows, normalizerConfig)
      : sourceDataRows
  ), [hasMultiBlockRows, normalizerConfig, sourceDataRows]);
  const sourceGridTotalPages = Math.max(1, Math.ceil(sourceGridRows.length / sourceGridRowsPerPage));
  const sourceGridVisibleRows = useMemo(() => (
    sourceGridRows.slice(
      sourceGridPage * sourceGridRowsPerPage,
      sourceGridPage * sourceGridRowsPerPage + sourceGridRowsPerPage
    )
  ), [sourceGridRows, sourceGridPage]);
  const quantityVariantFilterActive = sourceGridRows.length !== sourceDataRows.length || previewDataRows.length !== dataRows.length;

  useEffect(() => {
    if (sourceGridPage >= sourceGridTotalPages) {
      setSourceGridPage(Math.max(0, sourceGridTotalPages - 1));
    }
  }, [sourceGridPage, sourceGridTotalPages]);

  useEffect(() => {
    if (activeBomLayout !== 'assembly_quantity_matrix') return;
    const selectedVariant = getSelectedQuantityVariant(config);
    if (!selectedVariant) return;
    const stillAvailable = assemblyQuantityVariantOptions.some((option) => quantityVariantMatches(option, selectedVariant));
    if (!stillAvailable || assemblyQuantityVariantOptions.length <= 1) {
      setConfig((prev) => ({ ...prev, quantityVariant: QUANTITY_VARIANT_ALL }));
    }
  }, [activeBomLayout, assemblyQuantityVariantOptions, config.quantityVariant]);

  useEffect(() => {
    const selectedByBlock = config.quantityVariantByBlock || {};
    if (!Object.keys(selectedByBlock).length) return;
    const validGroups = new Map(multiBlockQuantityVariantGroups.map((group) => [group.key, group]));
    const cleaned = {};
    Object.entries(selectedByBlock).forEach(([groupKey, selectedVariant]) => {
      const group = validGroups.get(groupKey);
      if (!group || !selectedVariant || selectedVariant === QUANTITY_VARIANT_ALL) return;
      if (group.variants.some((variant) => quantityVariantMatches(variant, selectedVariant))) {
        cleaned[groupKey] = selectedVariant;
      }
    });
    if (JSON.stringify(cleaned) !== JSON.stringify(selectedByBlock)) {
      setConfig((prev) => ({ ...prev, quantityVariantByBlock: cleaned }));
    }
  }, [config.quantityVariantByBlock, multiBlockQuantityVariantGroups]);

  const parserLogicRules = useMemo(() => {
    const sourceHeader = roles.mpn || roles.manufacturer || 'selected source column';
    const rules = [];
    const layout = selectedBomLayout(config);

    if (layout === 'assembly_quantity_matrix') {
      rules.push('1. Expand assembly quantity columns into BOM rows');
      rules.push('2. Use non-empty quantity cells to decide which assembly variant contains each item');
      rules.push('3. Keep selected MPN/MFR parser rules for part details where available');
      return rules;
    }

    if (layout === 'multi_block_assembly') {
      rules.push('1. Detect BOM tables from repeated header rows across selected sheets');
      rules.push('2. Link child assemblies by matching part codes between rows and block titles');
      rules.push('3. Parse Parts Name and Parts Maker as MPN/MFR values');
      return rules;
    }

    if (normalizeKey(sourceHeader) === 'approved manufacturer') {
      rules.push('1. Read Approved Manufacturer as packed MPN/MFR text');
    } else if (config.structure === 'same_cell') {
      rules.push(`1. Read ${sourceHeader} as combined MPN/MFR text`);
    } else {
      rules.push(`1. Read ${sourceHeader} for part/manufacturer values`);
    }

    if (config.alternateLayout === 'following_rows') {
      rules.push(`2. Attach values from ${config.followingRowAlternateColumn || 'the selected following-row column'} to the nearest previous primary row`);
      if (config.includeInsideCellAlternatesWithFollowingRows !== false) {
        rules.push('3. Also split multi-entry values in the selected MPN/MFR cells when detected');
      }
    } else if (config.alternateLayout === 'following_item_rows') {
      rules.push('2. Attach sparse following rows as alternates for the nearest previous item row');
      rules.push(`3. CPN values ${config.followingItemRowsCpnMode === 'column' ? 'come from the selected CPN column when available' : 'are copied from the primary item'}`);
      rules.push('4. Treat each manufacturer cell as one manufacturer value');
    } else if (config.structure === 'same_cell' || config.structure === 'separate_cells') {
      rules.push('2. Split alternates on ^, then split each pair on the first valid comma');
    } else {
      rules.push('2. Group repeated part rows as primary plus alternates');
    }

    rules.push(`${rules.length + 1}. Remove status notes from MFR names, keep only clean MPN/MFR output`);
    return rules;
  }, [config, roles.manufacturer, roles.mpn]);

  const detectedParsingLogic = useMemo(() => {
    const rowSourceNumber = (row, index) => row?.__sourceRow || index + headerRowIndex + 2;
    const activeLayout = selectedBomLayout(config);

    if (activeLayout) {
      return {
        isLayoutDriven: true,
        sourceHeader: '',
        sections: [],
        matchingRows: 0,
        rules: parserLogicRules,
      };
    }

    const buildSourceSection = ({
      id,
      title,
      sourceHeader,
      rows = dataRows,
      description = '',
      includeUnmatched = true,
    }) => {
      if (!sourceHeader) return null;
      const patternMap = new Map();
      const unmatched = { count: 0, examples: [] };

      rows.forEach((row, rowIndex) => {
        const source = getCell(row, sourceHeader);
        if (!source) return;
        const manualParse = getManualPatternParse(row, sourceHeader, normalizerConfig);
        const pairs = (manualParse ? manualParse.pairs : parsePackedMpnManufacturerPairs(source, normalizerConfig))
          .filter((pair) => pair?.mpn && pair?.manufacturer);
        const sourceRow = rowSourceNumber(row, rowIndex);
        if (!pairs.length && !manualParse) {
          if (includeUnmatched) {
            unmatched.count += 1;
            if (unmatched.examples.length < 1) {
              unmatched.examples.push({ sourceRow, source });
            }
          }
          return;
        }

        const shape = manualParse?.patternShape || buildParsedPatternShape(source, pairs);
        if (!shape) {
          if (includeUnmatched) {
            unmatched.count += 1;
            if (unmatched.examples.length < 1) {
              unmatched.examples.push({ sourceRow, source });
            }
          }
          return;
        }

        const current = patternMap.get(shape) || {
          shape,
          count: 0,
          examples: [],
          matchedRows: [],
          sourceRows: [],
          rules: manualParse?.rules?.length ? manualParse.rules : describePatternShape(shape),
        };
        current.count += 1;
        current.sourceRows.push(sourceRow);
        const sourceEntries = splitStructuredMpnMfrEntries(source);
        const sourceEntryCount = sourceEntries.length || pairs.length || 1;
        current.matchedRows.push({ sourceRow, source, entryCount: sourceEntryCount });
        if (current.examples.length < 1) {
          const firstPair = pairs[0];
          const manualExample = manualParse?.displayExample;
          const manualExampleSource = sourceEntries.find((entry) => {
            const entryKey = entry.toUpperCase();
            const mpnKey = fmt(firstPair?.mpn).toUpperCase();
            const manufacturerKey = fmt(firstPair?.manufacturer).toUpperCase();
            return (
              (mpnKey && entryKey.includes(mpnKey)) ||
              (manufacturerKey && entryKey.includes(manufacturerKey))
            );
          }) || sourceEntries[0] || '';
          const exampleSource = manualExample
            ? (manualExampleSource || manualExample?.source || source)
            : (sourceForParsedPair(source, firstPair, normalizerConfig) || source);
          const exampleEntryIndex = Math.max(0, sourceEntries.findIndex((entry) => entry === exampleSource)) + 1;
          const examplePairs = exampleSource === source
            ? pairs
            : pairs.filter((pair) => (
              parsePackedMpnManufacturerPairs(exampleSource, normalizerConfig)
                .some((entryPair) => sameParsedPair(entryPair, pair))
            ));
          const previewPairs = (examplePairs.length ? examplePairs : pairs.slice(0, 1))
            .map((pair) => cleanPreviewMpnPair(pair, exampleSource));
          debugSlashVariantParser('pattern preview example', {
            source: exampleSource,
            rawSource: source,
            sourceHeader,
            shape,
            parsedPairs: pairs,
            examplePairs,
            previewPairs,
          });
          current.examples.push(manualExample || !pairs.length ? {
            sourceRow,
            source: exampleSource,
            rawSource: source,
            entryIndex: exampleEntryIndex,
            entryCount: sourceEntryCount,
            outputs: manualExample?.items || [],
            pairs: [],
            discarded: '',
          } : {
            sourceRow,
            source: exampleSource,
            rawSource: source,
            entryIndex: exampleEntryIndex,
            entryCount: sourceEntryCount,
            pairs: previewPairs,
            discarded: firstPair?.metadata?.discardedText || getDiscardedPackedText(exampleSource, firstPair),
          });
        }
        patternMap.set(shape, current);
      });

      const patterns = [...patternMap.values()]
        .sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape));
      if (!patterns.length && !unmatched.count) return null;

      const matchingRows = patterns.reduce((total, pattern) => total + pattern.count, 0);

      return {
        id,
        title,
        description,
        sourceHeader,
        patterns,
        unmatched,
        matchingRows,
        patternCount: patterns.length,
      };
    };

    const primarySourceHeader = roles.mpn || roles.manufacturer;
    const readsCombinedPrimary = Boolean(
      primarySourceHeader &&
      roles.mpn &&
      roles.manufacturer &&
      roles.mpn === roles.manufacturer &&
      config.structure === 'same_cell'
    );

    const sections = [];
    if (readsCombinedPrimary) {
      const primarySection = buildSourceSection({
        id: 'primary',
        title: 'Primary MPN/MFR source',
        sourceHeader: primarySourceHeader,
        description: 'Values from the selected primary MPN/MFR column.',
        includeUnmatched: true,
      });
      if (primarySection?.patterns?.length) sections.push(primarySection);
    }

    if (config.alternateLayout === 'following_rows' && config.followingRowAlternateColumn) {
      const alternateRows = dataRows.filter((row) => {
        const alternateText = getCell(row, config.followingRowAlternateColumn);
        if (!alternateText) return false;
        return getPatternAwarePackedPairs(row, config.followingRowAlternateColumn, alternateText, normalizerConfig)
          .some((pair) => pair?.mpn && pair?.manufacturer);
      });
      const followingSection = buildSourceSection({
        id: 'following-row-alternates',
        title: 'Following-row alternate source',
        sourceHeader: config.followingRowAlternateColumn,
        rows: alternateRows,
        description: 'Alternate values found in following rows and attached to the nearest previous primary row.',
        includeUnmatched: false,
      });
      if (followingSection?.patterns?.length) sections.push(followingSection);
    }

    if (config.alternateLayout === 'separate_columns') {
      const groups = cleanAlternateColumnGroups(config.alternateColumnGroups || [], headers);
      groups.forEach((group, index) => {
        const section = buildSourceSection({
          id: `alternate-column-${index + 1}`,
          title: `Alternate column group ${index + 1}`,
          sourceHeader: group.mpn,
          description: group.mfr
            ? `Alternate MPN values from ${group.mpn}; manufacturer values are paired from ${group.mfr}.`
            : `Alternate MPN/MFR values from ${group.mpn}.`,
          includeUnmatched: true,
        });
        if (section?.patterns?.length) sections.push(section);
      });
    }

    if (!sections.length) return null;

    const orderedSections = [...sections].sort((a, b) => {
      if (a.id === 'primary') return 1;
      if (b.id === 'primary') return -1;
      return 0;
    });
    const patternCount = orderedSections.reduce((total, section) => total + section.patterns.length, 0);
    const matchingRows = orderedSections.reduce((total, section) => total + (section.matchingRows || 0), 0);

    return {
      sourceHeader: primarySourceHeader || orderedSections[0]?.sourceHeader || '',
      sections: orderedSections,
      matchingRows,
      rules: [
        `Detected ${patternCount} distinct parsing pattern${patternCount === 1 ? '' : 's'} across ${orderedSections.length} configured source${orderedSections.length === 1 ? '' : 's'}.`,
        `Matched ${matchingRows} source value${matchingRows === 1 ? '' : 's'} that can produce clean MPN/MFR output.`,
        'Apply the matching pattern per row, then send clean MPN/MFR values into normalization.',
      ],
    };
  }, [config, dataRows, headerRowIndex, headers, normalizerConfig, parserLogicRules, roles.manufacturer, roles.mpn]);

  const parsingPatternOptions = useMemo(() => (
    (detectedParsingLogic?.sections || []).flatMap((section) => (
      (section.patterns || []).map((pattern, index) => ({
        key: `${section.id}::${pattern.shape || index}`,
        section,
        pattern,
        label: `${section.title}: ${pattern.shape}`,
      }))
    ))
  ), [detectedParsingLogic]);

  const selectedParsingPattern = useMemo(() => (
    parsingPatternOptions.find((option) => option.key === selectedParsingPatternKey) ||
    parsingPatternOptions[0] ||
    null
  ), [parsingPatternOptions, selectedParsingPatternKey]);

  const configureParserReference = useMemo(() => {
    if (configureParserScope?.mode !== 'pattern') return null;
    const option = parsingPatternOptions.find((item) => item.key === configureParserScope.patternKey) || selectedParsingPattern;
    const example = option?.pattern?.examples?.[0];
    if (!example) return null;
    return {
      source: example.rawSource || example.source,
      entrySource: example.source,
      sourceRow: example.sourceRow,
      pairs: example.pairs || [],
    };
  }, [configureParserScope, parsingPatternOptions, selectedParsingPattern]);

  // Parse Fields shows one entry at a time, so it needs the detected MPN/MFR for
  // whichever entry is on screen — not just the one example the review dialog carried.
  const describeParserSample = useCallback((text) => {
    const source = String(text || '');
    if (!source) return [];
    return parsePackedMpnManufacturerPairs(source, normalizerConfig)
      .filter((pair) => pair?.mpn && pair?.manufacturer)
      .map((pair) => cleanPreviewMpnPair(pair, source));
  }, [normalizerConfig]);

  const stagedEditForPattern = useCallback((option) => (
    stagedPatternEdits.find((edit) => (
      normalizeKey(edit.sourceHeader) === normalizeKey(option?.section?.sourceHeader) &&
      edit.patternShape === option?.pattern?.shape
    )) || null
  ), [stagedPatternEdits]);

  const selectedPatternStagedEdit = useMemo(
    () => stagedEditForPattern(selectedParsingPattern),
    [selectedParsingPattern, stagedEditForPattern]
  );
  const selectedSlashVariantStaged = Boolean(
    selectedPatternStagedEdit && String(selectedPatternStagedEdit.summary || '').includes('slash variants')
  );

  const selectedParsingPatternIndex = useMemo(() => {
    if (!selectedParsingPattern) return -1;
    return parsingPatternOptions.findIndex((option) => option.key === selectedParsingPattern.key);
  }, [parsingPatternOptions, selectedParsingPattern]);

  const selectedParsingPatternNumber = selectedParsingPatternIndex >= 0
    ? selectedParsingPatternIndex + 1
    : 1;

  const selectedParsingPatternExample = selectedParsingPattern?.pattern?.examples?.[0] || null;

  const selectedSlashVariantExpansion = useMemo(() => {
    if (!selectedParsingPatternExample) return null;
    const detected = slashVariantExpansionsInSource(
      selectedParsingPatternExample.source || selectedParsingPatternExample.rawSource
    );
    if (!detected.length) return null;
    return {
      count: detected.length,
      example: detected[0],
    };
  }, [selectedParsingPatternExample]);
  const showSelectedSlashVariantExpansion = useMemo(() => {
    const expansionPairs = selectedSlashVariantExpansion?.example?.pairs || [];
    const previewPairs = selectedParsingPatternExample?.pairs || [];
    if (!expansionPairs.length || !previewPairs.length) return Boolean(expansionPairs.length);
    if (expansionPairs.length !== previewPairs.length) return true;
    return expansionPairs.some((pair, index) => !sameParsedPair(pair, previewPairs[index]));
  }, [selectedParsingPatternExample, selectedSlashVariantExpansion]);

  const handleStepParsingPattern = useCallback((direction) => {
    if (!parsingPatternOptions.length) return;
    const currentIndex = selectedParsingPatternIndex >= 0 ? selectedParsingPatternIndex : 0;
    const nextIndex = Math.min(
      parsingPatternOptions.length - 1,
      Math.max(0, currentIndex + direction)
    );
    setSelectedParsingPatternKey(parsingPatternOptions[nextIndex].key);
  }, [parsingPatternOptions, selectedParsingPatternIndex]);

  const handleExpandSlashVariantsForPattern = useCallback(() => {
    if (!selectedParsingPattern) return;
    if (!selectedSlashVariantExpansion?.example) {
      setError('No slash suffix variants were found in the selected example.');
      return;
    }
    const sourceHeader = selectedParsingPattern.section?.sourceHeader || '';
    const patternShape = selectedParsingPattern.pattern?.shape || '';
    const sourceRows = selectedParsingPattern.pattern?.sourceRows || [];
    if (!sourceHeader || !patternShape || !sourceRows.length) {
      setError('Could not find the selected pattern rows to expand.');
      return;
    }

    const rowSet = new Set(sourceRows.map((rowNumber) => Number(rowNumber)));
    const rowsBySourceRow = {};
    let expandedCount = 0;
    let firstExpansion = null;

    dataRows.forEach((row, index) => {
      const sourceRow = Number(row?.__sourceRow || index + headerRowIndex + 2);
      if (!rowSet.has(sourceRow)) return;
      const source = getCell(row, sourceHeader);
      const expanded = expandSlashVariantsForSource(source, normalizerConfig);
      if (!expanded.expansions.length || !expanded.pairs.length) return;
      rowsBySourceRow[sourceRow] = {
        pairs: expanded.pairs,
        fields: {},
      };
      expandedCount += 1;
      if (!firstExpansion) firstExpansion = expanded.expansions[0];
    });

    if (!expandedCount) {
      setError('No slash suffix variants were found in the selected pattern.');
      return;
    }

    const summary = firstExpansion?.suffixes?.length
      ? `slash variants: ${firstExpansion.suffixes.map((suffix) => `/${suffix}`).join(', ')}`
      : 'slash variants';
    const previewItems = firstExpansion?.pairs?.flatMap((pair, index) => ([
      {
        type: 'mpn',
        label: `${index === 0 ? 'Primary MPN' : `Alternate ${index}`}: ${pair.mpn}`,
      },
      {
        type: 'mfr',
        label: `MFR: ${pair.manufacturer}`,
      },
      ...(pair.metadata?.discardedText && index === 0 ? [{
        type: 'discard',
        label: `Ignore: ${pair.metadata.discardedText}`,
      }] : []),
    ])) || [];
    const override = {
      sourceHeader,
      patternShape,
      rows: rowsBySourceRow,
      displayExample: firstExpansion ? {
        source: firstExpansion.source,
        items: previewItems,
      } : null,
      rules: [
        'Slash suffix variant expansion applied.',
        'Base MPN stays Primary; generated suffix MPNs become alternates.',
        `Configured variants: ${summary}.`,
      ],
      summary,
    };

    setStagedPatternEdits((prev) => withStagedPatternEdit(prev, {
      patternKey: selectedParsingPattern.key,
      sourceHeader,
      patternShape,
      scopedCount: expandedCount,
      summary,
      override,
      result: null,
      scope: {
        mode: 'pattern',
        patternKey: selectedParsingPattern.key,
        sourceHeader,
        patternShape,
        sourceRows,
      },
    }));
    setSelectedParsingPatternKey(selectedParsingPattern.key);
    const message = `Slash variants staged for ${expandedCount} row${expandedCount === 1 ? '' : 's'}. They run when you start normalization.`;
    setPatternApplyNotice(message);
      setSuccessMessage(message);
  }, [dataRows, headerRowIndex, normalizerConfig, selectedParsingPattern, selectedSlashVariantExpansion]);

  useEffect(() => {
    if (!parsingLogicOpen || !parsingPatternOptions.length) return;
    if (parsingPatternOptions.some((option) => option.key === selectedParsingPatternKey)) return;
    setSelectedParsingPatternKey(parsingPatternOptions[0].key);
  }, [parsingLogicOpen, parsingPatternOptions, selectedParsingPatternKey]);

  useEffect(() => {
    if (!parsingLogicOpen) return;
    setSelectedParsingDetailsOpen(false);
  }, [parsingLogicOpen, selectedParsingPattern?.key]);

  const showManufacturerInheritanceOption = useMemo(() => (
    !String(config.structure || '').startsWith('mpn_only') &&
    (config.structure !== 'one_per_row' || config.alternateLayout !== 'already_separate_rows')
  ), [config.alternateLayout, config.structure]);

  const showAlternateManufacturerGroups = useMemo(() => (
    Boolean(roles.manufacturer) && !String(config.structure || '').startsWith('mpn_only')
  ), [config.structure, roles.manufacturer]);

  const selectedGroupHeaderOption = useMemo(
    () => GROUP_HEADER_OPTIONS.find((option) => option.value === config.groupHeaderMode),
    [config.groupHeaderMode]
  );

  const normalizedColumnOptions = useMemo(() => (
    getNormalizedExportColumns(normalizedRows)
      .filter((column) => !['sourceRow', 'rule', 'confidence', 'discardedText'].includes(column))
  ), [normalizedRows]);

  const factwiseSerialPreview = useMemo(() => (
    getSerialPreviewValues(factwiseConfig, 3)
  ), [factwiseConfig]);

  const manufacturerMatchPreview = useMemo(() => {
    const aliases = manufacturerDirectory.aliases || {};
    if (!manufacturerDirectory.loaded || !Object.keys(aliases).length) return [];
    const seen = new Set();
    return normalizedRows
      .map((row, index) => {
        const original = fmt(row.manufacturer);
        const canonical = aliases[normalizeKey(original).toUpperCase()];
        if (!original || !canonical || canonical === original) return null;
        const key = `${original}=>${canonical}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return { index, key, original, canonical };
      })
      .filter(Boolean);
  }, [manufacturerDirectory, normalizedRows]);

  const allManufacturerMatchesSelected = manufacturerMatchPreview.length > 0 &&
    manufacturerMatchPreview.every((match) => selectedManufacturerMatches.includes(match.key));

  const mergePrimarySource = useMemo(
    () => mergeSources.find((source) => source.id === mergeConfig.primarySourceId) || null,
    [mergeConfig.primarySourceId, mergeSources]
  );

  const mergeSecondarySource = useMemo(
    () => mergeSources.find((source) => source.id === mergeConfig.secondarySourceId) || null,
    [mergeConfig.secondarySourceId, mergeSources]
  );

  const mergeSecondaryLabel = useMemo(() => {
    if (mergeConfig.relationshipName.trim()) return mergeConfig.relationshipName.trim();
    const selected = mergeConfig.detailColumns || [];
    if (selected.length === 1) return selected[0];
    if (selected.some((column) => /mpn|part/i.test(column))) return 'MPNs';
    if (selected.some((column) => /mfr|manufacturer/i.test(column))) return 'manufacturers';
    return 'secondary values';
  }, [mergeConfig.detailColumns, mergeConfig.relationshipName]);

  const normalizedMergePreviewSearch = mergePreviewSearch.trim().toLowerCase();
  const mergeFilteredPreviewRows = useMemo(() => (
    mergePreview
      ? mergePreview.rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => mergePreviewFilter === 'all' || row.__mergeStatus === mergePreviewFilter)
        .filter(({ row }) => {
          if (!normalizedMergePreviewSearch) return true;
          return Object.values(row).some((value) => fmt(value).toLowerCase().includes(normalizedMergePreviewSearch));
        })
      : []
  ), [mergePreview, mergePreviewFilter, normalizedMergePreviewSearch]);

  const mergePreviewRowsPerPage = 50;
  const mergePreviewTotalPages = Math.max(1, Math.ceil(mergeFilteredPreviewRows.length / mergePreviewRowsPerPage));
  const mergePreviewStart = mergePreviewPage * mergePreviewRowsPerPage;
  const visibleMergePreviewRows = mergeFilteredPreviewRows.slice(mergePreviewStart, mergePreviewStart + mergePreviewRowsPerPage);
  const visibleMergePreviewColumns = mergePreview
    ? mergePreview.headers.filter((header) => mergeVisibleColumns.includes(header))
    : [];

  const mergeCandidateCount = useMemo(() => combineItems.reduce((total, item) => {
    if (item.type === 'pdf') {
      return total + (item.extractedSourceCount || item.pageCount || 2);
    }
    return total + (item.workbook?.SheetNames?.length || 0);
  }, 0), [combineItems]);

  const canPrepareMerge = mergeCandidateCount >= 2;
  const canUseWithoutMerge = combineItems.length === 1 && !combineItems[0]?.isMergedBase;
  const displayedStep = !workbook && mergeStage !== 'sources'
    ? 1
    : (currentStep >= 4 ? 3 : currentStep);
  const sourcePanelTitle = mergeStage === 'preview'
    ? 'Review merged source'
    : mergeStage === 'match' || mergeStage === 'options'
      ? 'Prepare merged source'
      : 'Upload source';
  const sourcePanelDescription = mergeStage === 'preview'
    ? 'Review the merged sheet once, adjust visible columns if needed, then continue directly to configuration.'
    : mergeStage === 'match' || mergeStage === 'options'
      ? 'Choose the matching columns and output shape for the merged source.'
      : 'Upload Excel, CSV, or PDF data. Continue directly, or add another source and merge before normalization.';
  const pdfRangeConfig = useMemo(() => ({
    enabled: pdfRangeEnabled,
    ranges: pdfRanges
      .map((range) => ({ name: fmt(range.name), pages: fmt(range.pages) }))
      .filter((range) => range.name || range.pages),
  }), [pdfRangeEnabled, pdfRanges]);

  const buildNormalizedResultsSnapshot = useCallback((rowsOverride = normalizedRows) => ({
    kind: 'normalized-results',
    fileName,
    sheetName,
    sheetScope,
    selectedSheetNames,
    sheetRows,
    headerRowIndex,
    sourceEndRow,
    preparedHeaders: preparedHeaders.length ? preparedHeaders : getNormalizedExportColumns(rowsOverride),
    preparedDataRows,
    roles,
    config,
    patternParserOverrides,
    normalizedRows: rowsOverride,
    currentStep: 4,
    progress,
    normalizationSummary,
    lowConfidenceOnly,
    factwiseConfig,
    tagConfig,
  }), [
    config,
    factwiseConfig,
    fileName,
    headerRowIndex,
    lowConfidenceOnly,
    normalizationSummary,
    normalizedRows,
    patternParserOverrides,
    preparedDataRows,
    preparedHeaders,
    progress,
    roles,
    selectedSheetNames,
    sheetName,
    sheetRows,
    sheetScope,
    sourceEndRow,
    tagConfig,
  ]);

  const buildNormalizerWorkflowRecipe = useCallback((kind = 'normalized-results', rowsOverride = normalizedRows) => {
    const tagTarget = tagConfig.targetColumn || getNextTagColumn(rowsOverride);
    const hasFactwiseValues = rowsOverride.some((row) => fmt(row['Item code'] || row.itemCode));
    const hasTagValues = rowsOverride.some((row) => fmt(row[tagTarget]));

    return {
      version: 1,
      kind,
      roles,
      config,
      factwiseConfig,
      tagConfig,
      actions: {
        factwiseId: hasFactwiseValues,
        tagColumn: hasTagValues,
      },
      sourceHints: {
        fileName,
        sheetName,
        sheetScope,
        selectedSheetNames,
        headerRowIndex,
        sourceEndRow,
      },
      outputColumns: buildBomMappingRowsFromNormalizedRows(rowsOverride).columns,
      ...(kind === 'merge-preview' ? {
        mergeConfig,
        mergeVisibleColumns,
        mergePreviewFilter,
      } : {}),
    };
  }, [
    config,
    factwiseConfig,
    fileName,
    headerRowIndex,
    mergeConfig,
    mergePreviewFilter,
    mergeVisibleColumns,
    normalizedRows,
    roles,
    selectedSheetNames,
    sheetName,
    sheetScope,
    sourceEndRow,
    tagConfig,
  ]);

  const saveReturnSnapshot = useCallback((kind) => {
    const key = `${BOM_NORMALIZER_RETURN_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const snapshot = kind === 'merge-preview'
      ? {
        kind,
        combineItems: combineItems.map((item) => ({
          id: item.id,
          fileName: item.fileName,
          type: item.type,
          status: item.status,
          rowCount: item.rowCount,
          pageCount: item.pageCount,
          extractedSourceCount: item.extractedSourceCount,
          isMergedBase: item.isMergedBase,
          workbook: item.workbook?.SheetNames ? { SheetNames: item.workbook.SheetNames } : null,
        })),
        mergeSources: mergeSources.map((source) => ({
          id: source.id,
          label: source.label,
          headers: source.headers || [],
          rows: source.rows || [],
        })),
        mergeStage,
        mergeConfig,
        mergePreview,
        mergePreviewFilter,
        mergePreviewPage,
        mergeVisibleColumns,
        mergeColumnWidths,
        mergeChainMessage,
      }
      : buildNormalizedResultsSnapshot();

    window.__bomNormalizerReturnSnapshots = window.__bomNormalizerReturnSnapshots || {};
    window.__bomNormalizerReturnSnapshots[key] = snapshot;

    // sessionStorage has a ~5MB cap. A normalized sheet plus its source rows can
    // exceed it, and setItem then throws — previously swallowed, so the key was
    // returned for a snapshot that had never been written and the restore came back
    // empty. Retry without the bulky source-only fields, which the results view does
    // not need, before giving up on disk.
    const writeSnapshot = (payload) => {
      window.sessionStorage.setItem(key, JSON.stringify(payload));
    };

    try {
      writeSnapshot(snapshot);
    } catch (err) {
      try {
        const { sheetRows: _sheetRows, preparedDataRows: _preparedDataRows, ...lean } = snapshot;
        writeSnapshot(lean);
      } catch (innerErr) {
        // Disk is unavailable; the in-memory copy above still serves a same-tab return.
        console.warn('Could not persist BOM normalizer return snapshot:', innerErr);
      }
    }
    return key;
  }, [
    buildNormalizedResultsSnapshot,
    combineItems,
    mergeChainMessage,
    mergeColumnWidths,
    mergeConfig,
    mergePreview,
    mergePreviewFilter,
    mergePreviewPage,
    mergeSources,
    mergeStage,
    mergeVisibleColumns,
  ]);

  useEffect(() => {
    if (currentStep !== 4 || !normalizedRows.length) return;
    const snapshot = buildNormalizedResultsSnapshot(normalizedRows);
    window.__bomNormalizerLatestResultsSnapshot = snapshot;
    try {
      window.sessionStorage.setItem(BOM_NORMALIZER_LATEST_RESULTS_KEY, JSON.stringify(snapshot));
    } catch (err) {
      // Too large for sessionStorage — drop the source-only fields and retry, so a
      // browser-back restore still finds the normalized rows on disk.
      try {
        const { sheetRows: _sheetRows, preparedDataRows: _preparedDataRows, ...lean } = snapshot;
        window.sessionStorage.setItem(BOM_NORMALIZER_LATEST_RESULTS_KEY, JSON.stringify(lean));
      } catch (innerErr) {
        console.warn('Could not persist latest BOM normalizer results:', innerErr);
      }
    }
  }, [buildNormalizedResultsSnapshot, currentStep, normalizedRows]);

  useEffect(() => {
    const state = location.state || {};
    const snapshotKey = state.bomNormalizerReturnKey;
    const routeRestoreId = snapshotKey || (state.bomNormalizerReturnSnapshot ? 'route-snapshot' : '');

    // Restore only when a navigation explicitly asked for it. An earlier version also
    // fell back to the last stored snapshot whenever the page looked empty, so that
    // browser-back would work too — but a fresh upload is also empty at mount, so it
    // hijacked new uploads and replayed the previous session's rows. Route state is
    // the only signal that reliably distinguishes "returning" from "starting over".
    const hasRouteRestore = Boolean(state.returnFromMapping && routeRestoreId);
    const restoreId = hasRouteRestore ? routeRestoreId : '';

    if (!restoreId || restoredReturnSnapshotRef.current === restoreId) return;

    restoredReturnSnapshotRef.current = restoreId;
    // Held for this tick so the "source/config changed, discard the run" effect below
    // does not fire on the state this restore is about to set.
    restoreInFlightRef.current = true;
    setTimeout(() => { restoreInFlightRef.current = false; }, 0);
    try {
      const parseSnapshot = (raw) => {
        try {
          return raw ? JSON.parse(raw) : null;
        } catch (_) {
          return null;
        }
      };
      const latestSnapshot = parseSnapshot(window.sessionStorage.getItem(BOM_NORMALIZER_LATEST_RESULTS_KEY))
        || window.__bomNormalizerLatestResultsSnapshot;
      const rawSnapshot = parseSnapshot(snapshotKey ? window.sessionStorage.getItem(snapshotKey) : '');
      const memorySnapshot = snapshotKey ? window.__bomNormalizerReturnSnapshots?.[snapshotKey] : null;
      const routeRowsSnapshot = state.bomNormalizerReturnRows?.length
        ? { ...(state.bomNormalizerReturnSnapshot || {}), kind: 'normalized-results', normalizedRows: state.bomNormalizerReturnRows }
        : null;
      const snapshotCandidates = [
        routeRowsSnapshot,
        state.bomNormalizerReturnSnapshot,
        memorySnapshot,
        rawSnapshot,
        latestSnapshot,
      ].filter(Boolean);
      const requestedKind = snapshotCandidates.find((candidate) => candidate.kind === 'merge-preview')?.kind
        || snapshotCandidates.find((candidate) => candidate.kind)?.kind;
      const snapshot = requestedKind === 'merge-preview'
        ? snapshotCandidates.find((candidate) => candidate.kind === 'merge-preview')
        : pickBestNormalizerSnapshot(snapshotCandidates.filter((candidate) => candidate.kind !== 'merge-preview'));
      if (!snapshot) throw new Error('Return snapshot was not found.');

      // A normalized snapshot with no rows restores the parser settings and an empty
      // grid, which reads as "everything was lost" while looking half-restored. Treat
      // it as a failed restore instead so the user is told, and leave the step where
      // it is rather than dropping them on an empty Results view.
      if (snapshot.kind !== 'merge-preview' && !snapshot.normalizedRows?.length) {
        throw new Error('Your normalized rows could not be restored — the saved copy was empty. Run normalization again.');
      }

      if (snapshot.kind === 'merge-preview') {
        setWorkbook(null);
        setFileName('');
        setSheetName('');
        setSheetRows([]);
        setPreparedHeaders([]);
        setPreparedDataRows([]);
        setPatternParserOverrides([]);
        setNormalizedRows([]);
        setCurrentStep(0);
        setCombineItems(snapshot.combineItems || []);
        setMergeSources(snapshot.mergeSources || []);
        setMergeStage(snapshot.mergeStage || 'preview');
        setMergeConfig((prev) => ({ ...prev, ...(snapshot.mergeConfig || {}) }));
        setMergePreview(snapshot.mergePreview || null);
        setMergePreviewFilter(snapshot.mergePreviewFilter || 'all');
        setMergePreviewPage(snapshot.mergePreviewPage || 0);
        setMergeVisibleColumns(snapshot.mergeVisibleColumns || snapshot.mergePreview?.headers || []);
        setMergeColumnWidths(snapshot.mergeColumnWidths || {});
        setMergeChainMessage(snapshot.mergeChainMessage || '');
        setCombineError('');
        setError('');
      } else {
        const restoredSheetName = snapshot.sheetName || snapshot.selectedSheetNames?.[0] || 'Restored BOM';
        setWorkbook({ SheetNames: snapshot.selectedSheetNames?.length ? snapshot.selectedSheetNames : [restoredSheetName], Sheets: {} });
        setFileName(snapshot.fileName || 'BOM Normalizer result');
        setSheetName(restoredSheetName);
        setSheetScope(snapshot.sheetScope || 'single');
        setSelectedSheetNames(snapshot.selectedSheetNames || [restoredSheetName]);
        setSheetRows(snapshot.sheetRows || []);
        setHeaderRowIndex(snapshot.headerRowIndex || 0);
        setSourceEndRow(snapshot.sourceEndRow || '');
        const restoredRows = snapshot.normalizedRows?.length
          ? snapshot.normalizedRows
          : (state.bomNormalizerReturnRows || []);
        setPreparedHeaders(snapshot.preparedHeaders || getNormalizedExportColumns(restoredRows));
        setPreparedDataRows(snapshot.preparedDataRows || []);
        setRoles((prev) => ({ ...prev, ...(snapshot.roles || {}) }));
        setConfig((prev) => ({ ...prev, ...(snapshot.config || {}) }));
        setPatternParserOverrides(snapshot.patternParserOverrides || []);
        setNormalizedRows(restoredRows);
        setCurrentStep(snapshot.currentStep || 4);
        setProgress(snapshot.progress || { processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
        setNormalizationSummary(snapshot.normalizationSummary || null);
        setLowConfidenceOnly(Boolean(snapshot.lowConfidenceOnly));
        setFactwiseConfig((prev) => ({ ...prev, ...(snapshot.factwiseConfig || {}) }));
        setTagConfig((prev) => ({ ...prev, ...(snapshot.tagConfig || {}) }));
        setSkipSourceSetupForMerge(false);
        setConfirmOpen(false);
        setError('');
      }

      // Only rewrite history when we actually consumed route state. On browser back
      // there is nothing to clear, and replacing the entry would strip the state the
      // user needs if they navigate back and forth again.
      if (hasRouteRestore) {
        // Clear only the one-shot trigger. The snapshot key and rows stay in the
        // history entry: the user can go forward to mapping and back again, and this
        // entry has to still carry what that return needs. Stripping them here is why
        // a second visit came back empty.
        const nextState = { ...state };
        delete nextState.returnFromMapping;
        navigate(location.pathname, { replace: true, state: nextState });
      }
    } catch (err) {
      setError(err.message || 'Could not restore the BOM Normalizer page.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.state, navigate]);

  const availableStructureOptions = useMemo(
    () => getStructureOptionsForRoles(roles, config),
    [config, roles]
  );

  const delimiterLabel = useMemo(() => {
    if (config.delimiterMode === 'auto') return 'auto delimiter detection';
    if (config.delimiterMode === 'custom') return config.customDelimiter ? `custom delimiter "${config.customDelimiter}"` : 'custom delimiter';
    if (config.delimiterMode === '\\n') return 'new line delimiter';
    return `"${config.delimiterMode}" delimiter`;
  }, [config.customDelimiter, config.delimiterMode]);

  const cleanupDetections = useMemo(() => {
    const detections = {
      skipTitleRows: 0,
      skipRepeatedHeaders: 0,
      skipDoNotPopulate: 0,
      skipDeletedRows: 0,
      parentPathLevels: 0,
    };
    sourceDataRows.forEach((row) => {
      if (rowLooksLikeSectionTitle(row, headers, roles)) detections.skipTitleRows += 1;
      if (rowLooksLikeRepeatedHeader(row, headers)) detections.skipRepeatedHeaders += 1;
      if (rowLooksLikeDoNotPopulate(row, headers)) detections.skipDoNotPopulate += 1;
      if (rowLooksLikeDeleted(row, headers)) detections.skipDeletedRows += 1;
      if (rowHoldsParentPath(row, roles)) detections.parentPathLevels += 1;
    });
    return detections;
  }, [headers, roles, sourceDataRows]);

  // Every distinct value in the mapped row-type column, commonest first, with
  // how many rows carry it. This is what the user ticks against - the whole
  // point of the role is that nothing is dropped they have not seen.
  const rowTypeValues = useMemo(() => {
    if (!roles.rowType) return [];
    const counts = new Map();
    sourceDataRows.forEach((row) => {
      const value = getCell(row, roles.rowType).trim();
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, count }));
  }, [roles.rowType, sourceDataRows]);

  // Pre-tick the obvious ones the first time a column is mapped, then leave the
  // list alone - re-suggesting on every render would undo the user's own ticks.
  const suggestedForColumn = useRef(null);
  useEffect(() => {
    if (!roles.rowType || !rowTypeValues.length) return;
    if (suggestedForColumn.current === roles.rowType) return;
    suggestedForColumn.current = roles.rowType;
    const suggested = suggestDocumentTypeValues(rowTypeValues.map((entry) => entry.value));
    setConfig((prev) => (
      (prev.documentTypeValues || []).length ? prev : { ...prev, documentTypeValues: suggested }
    ));
  }, [roles.rowType, rowTypeValues]);

  const documentRowCount = useMemo(() => {
    const flagged = config.documentTypeValues || [];
    if (!roles.rowType || !flagged.length) return 0;
    return rowTypeValues
      .filter((entry) => flagged.includes(entry.value))
      .reduce((total, entry) => total + entry.count, 0);
  }, [config.documentTypeValues, roles.rowType, rowTypeValues]);

  const detectedCleanupOptions = useMemo(
    () => CLEANUP_OPTIONS.filter((option) => cleanupDetections[option.key] > 0),
    [cleanupDetections]
  );

  const roleCombinationHint = useMemo(() => {
    const layout = selectedBomLayout(config);
    if (layout === 'multi_block_assembly') {
      return 'Multi-block assembly BOM layout selected. Row expansion is driven by detected BOM blocks and linked assembly codes, not by the MPN/MFR arrangement dropdown.';
    }
    if (layout === 'assembly_quantity_matrix') {
      return 'Assembly quantity matrix layout selected. Row expansion is driven by quantity matrix columns, not by the MPN/MFR arrangement dropdown.';
    }
    if (
      config.alternateLayout === 'following_rows' &&
      config.followingRowAlternateColumn &&
      roles.mpn === config.followingRowAlternateColumn &&
      roles.manufacturer === config.followingRowAlternateColumn
    ) {
      return `${config.followingRowAlternateColumn} is detected as a following-row MPN/MFR block. Values will attach to the nearest previous item row.`;
    }
    if (roles.mpn && roles.manufacturer && roles.mpn === roles.manufacturer) {
      return 'Same source column selected for MPN and MFR. The parser will treat each cell as combined MPN/MFR text.';
    }
    if (roles.mpn && !roles.manufacturer) {
      return 'No manufacturer column selected. The parser will extract MPNs and leave manufacturer blank.';
    }
    if (!roles.mpn && roles.manufacturer) {
      return 'No MPN column selected. The parser will extract manufacturers and leave MPN blank.';
    }
    if (roles.mpn && roles.manufacturer) {
      return 'Separate MPN and manufacturer columns selected. The parser will pair values by position.';
    }
    if (roles.level) {
      return 'Level column selected. Rows pass through with their level, code, quantity and description.';
    }
    return 'Select at least an MPN or BOM level column to run normalization.';
  }, [config, roles.level, roles.manufacturer, roles.mpn]);

  const alternateColumnGroups = useMemo(
    () => cleanAlternateColumnGroups(config.alternateColumnGroups || [], headers),
    [config.alternateColumnGroups, headers]
  );

  const suggestAlternateColumnGroup = useCallback(() => {
    const shouldSuggestManufacturer = Boolean(roles.manufacturer) && !String(config.structure || '').startsWith('mpn_only');
    const usedColumns = new Set([
      roles.cpn,
      roles.mpn,
      roles.manufacturer,
      roles.description,
      roles.quantity,
      roles.uom,
      roles.level,
      roles.parent,
      ...(config.alternateColumnGroups || []).flatMap((group) => [group.mpn, group.mfr, group.qty, group.uom]),
    ].filter(Boolean));
    const candidates = headers.filter((header) => !usedColumns.has(header));
    const findCandidate = (patterns) => candidates.find((header) => {
      const normalized = normalizeKey(header);
      return patterns.some((pattern) => pattern.test(normalized));
    }) || '';
    const mpn = findCandidate([/\bmpn\b/, /part/, /code/, /column/]) || candidates[0] || '';
    const afterMpn = mpn ? candidates.slice(candidates.indexOf(mpn) + 1) : candidates;
    const mfr = shouldSuggestManufacturer
      ? afterMpn.find((header) => /mfr|manufacturer|vendor|supplier|column/i.test(header)) || afterMpn[0] || ''
      : '';
    return {
      slot: `${(config.alternateColumnGroups || []).length + 1}`,
      mpn,
      mfr: mfr === mpn ? '' : mfr,
      qty: '',
      uom: '',
    };
  }, [config.alternateColumnGroups, config.structure, headers, roles]);

  const addAlternateColumnGroup = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      alternateLayout: 'separate_columns',
      alternateColumnGroups: [
        ...(prev.alternateColumnGroups || []),
        suggestAlternateColumnGroup(),
      ],
    }));
  }, [suggestAlternateColumnGroup]);

  const updateAlternateColumnGroup = useCallback((index, field, value) => {
    setConfig((prev) => ({
      ...prev,
      alternateColumnGroups: (prev.alternateColumnGroups || []).map((group, groupIndex) => (
        groupIndex === index ? { ...group, [field]: value } : group
      )),
    }));
  }, []);

  const removeAlternateColumnGroup = useCallback((index) => {
    setConfig((prev) => ({
      ...prev,
      alternateColumnGroups: (prev.alternateColumnGroups || []).filter((_, groupIndex) => groupIndex !== index),
    }));
  }, []);

  const handleWorkbookLoaded = useCallback((nextWorkbook, nextFileName, options = {}) => {
    const preferredSheet = options.sheetName && nextWorkbook.SheetNames.includes(options.sheetName)
      ? options.sheetName
      : nextWorkbook.SheetNames[0];
    // A caller-supplied multi-sheet selection (e.g. "combine these 6 sheets" set
    // on the upload screen) wins over anything detected here.
    const requestedSheets = (options.selectedSheetNames || []).filter((name) => nextWorkbook.SheetNames.includes(name));
    const useRequestedSelection = options.sheetScope && options.sheetScope !== 'single' && requestedSheets.length > 1;
    const autoMultiBlock = !useRequestedSelection && !options.sheetName && !options.headerRow
      ? prepareMultiBlockSheets(nextWorkbook, nextWorkbook.SheetNames)
      : null;
    const prepared = useRequestedSelection
      ? prepareMultipleSheets(nextWorkbook, requestedSheets, { headerRow: options.headerRow })
      : autoMultiBlock?.multiBlockSummary?.blockCount > 1
        ? autoMultiBlock
        : prepareSingleSheet(nextWorkbook, preferredSheet, { headerRow: options.headerRow });
    const nextHeaders = prepared.headers;
    const nextRoles = rolesForMultiBlockAssembly(nextHeaders, inferRoles(nextHeaders, prepared.dataRows, { manufacturerDirectory }));
    const nextStructure = detectBestStructure(nextHeaders, nextRoles, prepared.dataRows.slice(0, 40));
    const nextSheetScope = useRequestedSelection
      ? (options.sheetScope === 'all' && requestedSheets.length === nextWorkbook.SheetNames.length ? 'all' : 'selected')
      : autoMultiBlock?.multiBlockSummary?.blockCount > 1 && nextWorkbook.SheetNames.length > 1 ? 'all' : 'single';
    const nextSelectedSheets = useRequestedSelection
      ? requestedSheets
      : nextSheetScope === 'all' ? nextWorkbook.SheetNames : [preferredSheet];

    setSheetHeaderRowOverride(useRequestedSelection && options.headerRow ? String(options.headerRow) : '');
    setWorkbook(nextWorkbook);
    setFileName(nextFileName);
    setSheetName(nextSelectedSheets[0] || preferredSheet);
    setSheetScope(nextSheetScope);
    setSelectedSheetNames(nextSelectedSheets);
    setSheetRows(prepared.sheetRows);
    setHeaderRowIndex(prepared.headerRowIndex);
    setPreparedHeaders(prepared.headers);
    setPreparedDataRows(prepared.dataRows);
    setPatternParserOverrides([]);
    setSourceEndRow('');
    setRoles(nextRoles);
    setConfig((prev) => nextConfigForDetectedStructure({ ...prev, bomLayout: 'none' }, nextStructure, {
      headers: nextHeaders,
      rows: prepared.dataRows.slice(0, 120),
      roles: nextRoles,
    }));
    setNormalizedRows([]);
    setCurrentStep(1);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setDelimiterTouched(false);
    setParserTouched(false);
    setSkipSourceSetupForMerge(false);
    setNormalizationSummary(null);
    setConfirmOpen(false);
    setError('');
  }, [manufacturerDirectory]);

  useEffect(() => {
    const state = location.state || {};
    if (!state.fromPdfZone || !state.pdfSessionId) return;

    let cancelled = false;
    const loadZonedPdf = async () => {
      setBusy(true);
      setError('');
      try {
        const payload = state.pdfZonePayload || {};
        let headers = makeUniqueHeaders(payload.headers || []);
        let rows = payload.data || payload.rows || [];
        let fileLabel = payload.file_name || `PDF zone extraction ${state.pdfSessionId}`;

        if (!headers.length || !rows.length) {
          const response = await api.getPDFSession(state.pdfSessionId);
          const sessionData = response.data || {};
          const extraction = sessionData.extraction || {};
          headers = makeUniqueHeaders(extraction.headers || []);
          rows = extraction.data || [];
          fileLabel = sessionData.file_name || fileLabel;
        }

        if (!headers.length || !rows.length) {
          throw new Error('Zone mapping finished, but no extracted rows were returned.');
        }

        const normalized = normalizePdfRows({
          headers,
          data: rows,
          decision: payload.method || payload.status || 'zone mapping',
        }, fileLabel);

        if (!normalized.rows.length) {
          throw new Error('Zone mapping did not produce any usable table rows.');
        }

        if (!cancelled) {
          const nextWorkbook = createWorkbookFromObjects(normalized.rows, normalized.headers, 'PDF_Zones');
          handleWorkbookLoaded(nextWorkbook, fileLabel);
          navigate('/bom-normaliser', { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || err.message || 'Could not load the zone-mapped PDF result.');
          navigate('/bom-normaliser', { replace: true });
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    };

    loadZonedPdf();
    return () => {
      cancelled = true;
    };
  }, [handleWorkbookLoaded, location.state, navigate]);

  const parseFilesForCombine = useCallback(async (files, idPrefix = 'source') => {
    return Promise.all(files.map(async (file, index) => {
      const extension = getFileExtension(file.name);
      if (!SUPPORTED_SOURCE_EXTENSIONS.includes(extension)) {
        throw new Error(unsupportedSourceMessage(file.name));
      }
      const type = getFileType(file.name);
      const baseItem = {
        id: `${idPrefix}-${Date.now()}-${index}-${file.name}`,
        file,
        fileName: file.name,
        type,
        status: type === 'pdf' ? 'Ready to extract' : 'Ready',
        scope: 'single',
        sheetName: '',
        selectedSheetNames: [],
        headerRowIndex: 0,
        rowCount: 0,
        error: '',
      };

      if (type === 'pdf') return baseItem;

      await new Promise((resolve) => setTimeout(resolve, 0));
      const nextWorkbook = await readUploadedWorkbookSafely(file);
      const firstSheet = nextWorkbook.SheetNames[0];
      const prepared = prepareSingleSheet(nextWorkbook, firstSheet);
      return {
        ...baseItem,
        workbook: nextWorkbook,
        sheetName: firstSheet,
        selectedSheetNames: [firstSheet],
        headerRowIndex: prepared.headerRowIndex,
        rowCount: prepared.dataRows.length,
        status: `${nextWorkbook.SheetNames.length} sheet${nextWorkbook.SheetNames.length === 1 ? '' : 's'} found`,
      };
    }));
  }, []);

  useEffect(() => {
    const state = location.state || {};
    const initialFile = state.initialFile;
    const seedKey = initialFile
      ? `${initialFile.name || 'file'}-${initialFile.size || 0}-${initialFile.lastModified || 0}-${state.initialFileMode || 'source'}-${state.initialSheetName || ''}-${state.initialHeaderRow || ''}-${state.initialSheetScope || ''}-${(state.initialSelectedSheets || []).join('|')}`
      : '';
    // restoredReturnSnapshotRef, not state.returnFromMapping: the restore effect clears
    // that flag once it has consumed it, and this effect would then re-run, still see
    // initialFile in the history entry, and reseed the source — wiping the rows that
    // were just restored.
    if (!initialFile
      || initialFileSeededRef.current === seedKey
      || state.fromPdfZone
      || state.returnFromMapping
      || restoredReturnSnapshotRef.current) return;

    initialFileSeededRef.current = seedKey;

    const seedInitialFileAsSource = async () => {
      setCombineBusy(true);
      setCombineError('');
      setMergeChainMessage('');
      setMergeSources([]);
      setMergePreview(null);
      setMergeStage('sources');
      setWorkbook(null);
      setNormalizedRows([]);
      setCurrentStep(0);
      setError('');

      try {
        if (state.initialFileMode === 'workbook') {
          await new Promise((resolve) => setTimeout(resolve, 0));
          const nextWorkbook = await readUploadedWorkbookSafely(initialFile);
          const multiSheetSeed = state.initialSheetScope && state.initialSheetScope !== 'single';
          handleWorkbookLoaded(nextWorkbook, initialFile.name, {
            sheetName: state.initialSheetName,
            // The upload screen's header row is auto-detected from whichever
            // sheet it previews, so across a multi-sheet selection it is only
            // trustworthy when the user typed it themselves.
            headerRow: multiSheetSeed && !state.initialHeaderRowExplicit ? undefined : state.initialHeaderRow,
            sheetScope: state.initialSheetScope,
            selectedSheetNames: state.initialSelectedSheets,
          });
          setCombineItems([]);
          setMergeChainMessage('');
        } else {
          const parsedItems = await parseFilesForCombine([initialFile], 'upload');
          setCombineItems(parsedItems);
          setMergeChainMessage('Source loaded. Add another source to merge, or use this source without merge.');
        }

        const remainingState = { ...state };
        delete remainingState.initialFile;
        delete remainingState.initialFileMode;
        delete remainingState.initialSheetName;
        delete remainingState.initialHeaderRow;
        delete remainingState.initialSheetScope;
        delete remainingState.initialSelectedSheets;
        delete remainingState.initialHeaderRowExplicit;
        navigate(location.pathname, { replace: true, state: remainingState });
      } catch (err) {
        setCombineError(err.message || 'Unable to prepare the uploaded file for BOM Normalizer.');
      } finally {
        setCombineBusy(false);
      }
    };

    seedInitialFileAsSource();
  }, [handleWorkbookLoaded, location.pathname, location.state, navigate, parseFilesForCombine]);

  useEffect(() => {
    const state = location.state || {};
    const processingTemplate = state.autoReplayProcessingTemplate;
    const workflow = getProcessingTemplateNormalizerWorkflow(processingTemplate);
    const mappingTemplateId = state.autoReplayMappingTemplateId || getProcessingTemplateMappingId(processingTemplate);
    const replayKey = processingTemplate?.id
      ? `${processingTemplate.id}:${fileName}:${preparedHeaders.join('|')}:${preparedDataRows.length}`
      : '';

    if (!processingTemplate || !workflow || !mappingTemplateId || autoReplayTemplateRef.current === replayKey) return;
    if (!workbook || !preparedHeaders.length || !preparedDataRows.length || !replayKey) return;

    autoReplayTemplateRef.current = replayKey;

    const runTemplateReplay = async () => {
      setBusy(true);
      setError('');
      setSuccessMessage(`Applying template "${processingTemplate.name || 'selected template'}"...`);

      try {
        if (workflow.kind === 'merge-preview') {
          throw new Error('This workflow template includes a merge setup. Recreate the merge once, then save the template again after normalization.');
        }

        const resolvedRoles = resolveSavedRoleMap(workflow.roles || {}, preparedHeaders);
        const resolvedConfig = {
          ...config,
          ...(workflow.config || {}),
          alternateColumnGroups: resolveSavedAlternateGroups(workflow.config?.alternateColumnGroups || [], preparedHeaders),
        };

        if (!resolvedRoles.mpn && !resolvedRoles.manufacturer) {
          throw new Error('This template could not match the saved MPN or manufacturer columns on the uploaded file.');
        }

        setRoles(resolvedRoles);
        setConfig(resolvedConfig);
        if (workflow.factwiseConfig) setFactwiseConfig((prev) => ({ ...prev, ...workflow.factwiseConfig }));
        if (workflow.tagConfig) setTagConfig((prev) => ({ ...prev, ...workflow.tagConfig }));

        const replaySourceRows = filterRowsByEndRow(preparedDataRows, workflow.sourceHints?.sourceEndRow || '');
        if (workflow.sourceHints?.sourceEndRow) {
          setSourceEndRow(workflow.sourceHints.sourceEndRow);
        }

        let replayRows = await normalizeRowsChunked(replaySourceRows, preparedHeaders, resolvedRoles, resolvedConfig, setProgress);
        if (workflow.actions?.factwiseId) {
          replayRows = createFactwiseIds(replayRows, workflow.factwiseConfig || {});
        }
        if (workflow.actions?.tagColumn) {
          replayRows = createTagColumn(replayRows, workflow.tagConfig || {});
        }

        if (!replayRows.length) {
          throw new Error('The template ran, but no normalized rows were produced from this upload.');
        }

        const baseColumns = getNormalizedExportColumns(replayRows);
        const { columns, rows } = buildBomMappingRowsFromNormalizedRows(replayRows, baseColumns);
        const file = createWorkbookFileFromRows(rows, columns, 'template-replayed-bom.xlsx', 'Normalized BOM');
        const formData = new FormData();
        formData.append('clientFile', file);
        formData.append('sheetName', 'Normalized BOM');
        formData.append('headerRow', '1');
        // Template replay runs without the gate; answers only exist if they were
        // captured earlier and travelled in on the route state.
        if (bomStructureAnswers || location.state?.bomStructure) {
          formData.append('bomStructure', JSON.stringify(bomStructureAnswers || location.state.bomStructure));
        }

        const response = await api.uploadFilesWithTemplate(formData, mappingTemplateId);
        if (!response.data?.template_applied || !response.data?.template_success) {
          throw new Error(response.data?.message || 'The saved mapping could not be applied after normalization.');
        }

        navigate(`/editor/${response.data.session_id}`, {
          state: {
            fromUpload: true,
            templateAlreadyApplied: true,
            appliedProcessingTemplate: processingTemplate,
            uploadSource: {
              ...(state.uploadSource || {}),
              processingTemplateMode: 'use',
              selectedProcessingTemplate: processingTemplate,
              selectedProcessingTemplateId: processingTemplate.id,
              processingPath: 'normalize',
            },
          },
        });
      } catch (err) {
        setError(err.response?.data?.error || err.message || 'Could not apply the selected workflow template.');
      } finally {
        setBusy(false);
      }
    };

    runTemplateReplay();
  }, [
    config,
    fileName,
    location.state,
    navigate,
    preparedDataRows,
    preparedHeaders,
    workbook,
  ]);

  const handleCombineFilesChange = useCallback(async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const hasMergedBase = combineItems.some((item) => item.isMergedBase);

    setCombineBusy(true);
    setCombineError('');
    setMergeChainMessage('');
    setMergeSources([]);
    setMergePreview(null);
    setMergeStage('sources');
    try {
      const parsedItems = await parseFilesForCombine(files);
      setCombineItems((prev) => [...prev, ...parsedItems]);
      if (hasMergedBase) {
        setMergeChainMessage('Next source added. Click Prepare merge setup to merge it into the merged base.');
      }
    } catch (err) {
      setCombineError(err.message || 'Unable to read one of the selected files.');
    } finally {
      setCombineBusy(false);
      event.target.value = '';
    }
  }, [combineItems, parseFilesForCombine]);

  const removeCombineItem = useCallback((id) => {
    setCombineItems((prev) => prev.filter((item) => item.id !== id));
    setMergeSources([]);
    setMergePreview(null);
    setMergeStage('sources');
  }, []);

  const uploadPdfAndGetSession = useCallback(async (item) => {
    const formData = new FormData();
    formData.append('file', item.file);
    const uploadResponse = await api.uploadPDF(formData);
    const sessionId = uploadResponse.data?.session_id;
    if (!sessionId) throw new Error(`${item.fileName}: PDF upload did not return a session.`);
    return sessionId;
  }, []);

  const extractPdfSources = useCallback(async (item, processingMode = 'compare', rangeConfig = null) => {
    const sessionId = await uploadPdfAndGetSession(item);
    const response = processingMode === 'ocr'
      ? await api.processPDFOCR({
        session_id: sessionId,
        data_alignment: 'align',
      })
      : await api.processPDFCompare({
      session_id: sessionId,
      data_alignment: 'align',
    });
    const normalized = normalizePdfRows(response.data, item.fileName);
    if (!normalized.rows.length) {
      throw new Error(`${item.fileName}: no table rows were extracted from the PDF.`);
    }
    const tableSources = normalizePdfTables(response.data, item.fileName);
    const decision = response.data?.decision;
    const winner = processingMode === 'ocr' ? 'ocr' : (decision?.winner || decision || 'best');
    const flattenedSource = {
      id: 'flattened',
      label: `${item.fileName} / Combined PDF extraction (${normalized.rows.length} rows, ${normalized.headers.length} columns)`,
      fileName: item.fileName,
      sheetName: 'Combined PDF extraction',
      headers: normalized.headers,
      rows: normalized.rows,
      status: `${normalized.rows.length} PDF rows extracted (${winner})`,
    };
    const extractedSources = rangeConfig?.enabled && tableSources.length
      ? tableSources
      : (tableSources.length > 1 ? tableSources : [flattenedSource]);
    return rangeConfig?.enabled
      ? groupPdfSourcesByRanges(extractedSources, rangeConfig.ranges, item.fileName)
      : extractedSources;
  }, [uploadPdfAndGetSession]);

  const handleUseSourceWithoutMerge = useCallback(async (processingMode = null) => {
    const selectedMode = typeof processingMode === 'string' ? processingMode : null;
    const item = combineItems[0];
    if (!item) {
      setCombineError('Add a source first.');
      return;
    }
    if (item.type === 'pdf' && !selectedMode) {
      setPendingPdfAction('direct');
      setPdfChoiceOpen(true);
      return;
    }

    setCombineBusy(true);
    setCombineError('');
    setMergeChainMessage('');
    try {
      if (item.type === 'pdf') {
        const pdfSources = await extractPdfSources(item, selectedMode || 'compare', pdfRangeConfig);
        const pdfSource = pdfSources.length === 1
          ? pdfSources[0]
          : {
            headers: [...new Set(pdfSources.flatMap((source) => source.headers))],
            rows: pdfSources.flatMap((source) => source.rows),
          };
        const nextWorkbook = createWorkbookFromObjects(pdfSource.rows, pdfSource.headers, 'PDF_Source');
        handleWorkbookLoaded(nextWorkbook, item.fileName);
      } else if (item.workbook) {
        handleWorkbookLoaded(item.workbook, item.fileName);
      } else {
        throw new Error('This source is not ready yet.');
      }
      setCombineItems([]);
      setMergeSources([]);
      setMergePreview(null);
      setMergeStage('sources');
    } catch (err) {
      setCombineError(err.response?.data?.error || err.message || 'Could not continue with this source.');
    } finally {
      setCombineBusy(false);
    }
  }, [combineItems, extractPdfSources, handleWorkbookLoaded, pdfRangeConfig]);

  const handlePrepareMergeSources = useCallback(async (processingMode = null) => {
    const selectedMode = typeof processingMode === 'string' ? processingMode : null;
    if (!combineItems.length || !canPrepareMerge) {
      setCombineError('Add at least two sheets/files/PDF table sources before preparing a merge.');
      return;
    }
    if (combineItems.some((item) => item.type === 'pdf') && !selectedMode) {
      setPendingPdfAction('merge');
      setPdfChoiceOpen(true);
      return;
    }

    setCombineBusy(true);
    setCombineError('');
    setMergeChainMessage('');
    setMergePreview(null);
    const nextItems = [...combineItems];
    const nextSources = [];

    try {
      for (let index = 0; index < nextItems.length; index += 1) {
        const item = nextItems[index];
        if (item.type === 'pdf') {
          nextItems[index] = { ...item, status: 'Extracting PDF tables...', error: '' };
          setCombineItems([...nextItems]);
          const pdfSources = await extractPdfSources(item, selectedMode || 'compare', pdfRangeConfig);
          pdfSources.forEach((source, sourceIndex) => {
            nextSources.push({
              ...source,
              id: `${item.id}:pdf:${source.id || sourceIndex}`,
            });
          });
          const totalRows = pdfSources.reduce((sum, source) => sum + source.rows.length, 0);
          nextItems[index] = {
            ...nextItems[index],
            status: `${pdfSources.length} PDF source${pdfSources.length === 1 ? '' : 's'} extracted`,
            rowCount: totalRows,
            extractedSourceCount: pdfSources.length,
            error: '',
          };
          setCombineItems([...nextItems]);
          continue;
        }

        if (!item.workbook) continue;
        const sourceCountBeforeItem = nextSources.length;
        item.workbook.SheetNames.forEach((name) => {
          const prepared = prepareSingleSheet(item.workbook, name);
          nextSources.push({
            id: `${item.id}:${name}`,
            label: `${item.fileName} / ${name} (${prepared.dataRows.length} rows, ${prepared.headers.length} columns)`,
            fileName: item.fileName,
            sheetName: name,
            headers: prepared.headers,
            rows: prepared.dataRows,
            headerRowIndex: prepared.headerRowIndex,
            isMergedBase: Boolean(item.isMergedBase),
          });
        });
        const itemSources = nextSources.slice(sourceCountBeforeItem);
        const sheetsWithRows = itemSources.filter((source) => source.rows.length > 0).length;
        nextItems[index] = {
          ...item,
          status: `${item.workbook.SheetNames.length} sheet${item.workbook.SheetNames.length === 1 ? '' : 's'} ready, ${sheetsWithRows} with rows`,
          error: '',
        };
        setCombineItems([...nextItems]);
      }

      if (nextSources.length < 2) {
        setCombineError('At least two usable sources are needed for merge.');
        return;
      }

      const primary = nextSources.find((source) => source.isMergedBase && source.rows.length > 0 && source.headers.length > 0) ||
        nextSources.find((source) => source.rows.length > 0 && source.headers.length > 0) ||
        nextSources[0];
      const secondary = nextSources.find((source) => source.id !== primary.id && source.rows.length > 0 && source.headers.length > 0) ||
        nextSources.find((source) => source.id !== primary.id) ||
        nextSources[1];
      const primaryKey = guessKeyColumn(primary.headers);
      const secondaryKey = guessKeyColumn(secondary.headers);
      const detailColumns = defaultMergeDetailColumns(secondary.headers, secondaryKey);
      setMergeSources(nextSources);
      setMergeConfig({
        primarySourceId: primary.id,
        secondarySourceId: secondary.id,
        primaryKey,
        secondaryKey,
        relationshipName: '',
        outputMode: 'grouped',
        detailColumns,
      });
      setMergeStage('match');
      setMergePreviewFilter('all');
      setMergePreviewPage(0);
      setMergeVisibleColumns([]);
    } catch (err) {
      setCombineError(err.response?.data?.error || err.message || 'Could not prepare merge sources.');
    } finally {
      setCombineBusy(false);
    }
  }, [canPrepareMerge, combineItems, extractPdfSources, pdfRangeConfig]);

  const handlePdfProcessingChoice = useCallback(async (processingMode) => {
    setPdfChoiceOpen(false);
    if (processingMode === 'zonal') {
      const pdfItem = combineItems.find((item) => item.type === 'pdf');
      if (!pdfItem) {
        setCombineError('No PDF source is available for zone mapping.');
        setPendingPdfAction(null);
        return;
      }
      setCombineBusy(true);
      setCombineError('');
      try {
        const sessionId = await uploadPdfAndGetSession(pdfItem);
        navigate(`/pdf-zones/${sessionId}`, {
          state: {
            fromUpload: true,
            pdfAlignment: 'align',
            fromBomNormalizer: true,
          },
        });
      } catch (err) {
        setCombineError(err.response?.data?.error || err.message || 'Could not open PDF zone mapping.');
      } finally {
        setCombineBusy(false);
        setPendingPdfAction(null);
      }
      return;
    }

    if (pendingPdfAction === 'merge') {
      await handlePrepareMergeSources(processingMode);
    } else {
      await handleUseSourceWithoutMerge(processingMode);
    }
    setPendingPdfAction(null);
  }, [combineItems, handlePrepareMergeSources, handleUseSourceWithoutMerge, navigate, pendingPdfAction, uploadPdfAndGetSession]);

  const updatePdfRange = useCallback((index, field, value) => {
    setPdfRanges((prev) => prev.map((range, rangeIndex) => (
      rangeIndex === index ? { ...range, [field]: value } : range
    )));
  }, []);

  const addPdfRange = useCallback(() => {
    setPdfRanges((prev) => [...prev, { name: `PDF section ${prev.length + 1}`, pages: '' }]);
  }, []);

  const removePdfRange = useCallback((index) => {
    setPdfRanges((prev) => prev.length <= 1 ? prev : prev.filter((_, rangeIndex) => rangeIndex !== index));
  }, []);

  const handleBuildMergePreview = useCallback(() => {
    try {
      const preview = buildMergePreviewFromSources(mergePrimarySource, mergeSecondarySource, mergeConfig);
      setMergePreview(preview);
      setMergeConfig(preview.config);
      setMergeVisibleColumns(preview.headers);
      setMergePreviewFilter('all');
      setMergePreviewSearch('');
      setMergePreviewPage(0);
      setMergeStage('preview');
      setCombineError('');
    } catch (err) {
      setCombineError(err.message || 'Could not build merge preview.');
    }
  }, [mergeConfig, mergePrimarySource, mergeSecondarySource]);

  const handleMergePreviewCellChange = useCallback((rowIndex, header, value) => {
    setMergePreview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((row, index) => (
          index === rowIndex ? { ...row, [header]: value } : row
        )),
      };
    });
  }, []);

  const handleMergeColumnResize = useCallback((header, event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = mergeColumnWidths[header] || 180;

    const handleMove = (moveEvent) => {
      const nextWidth = Math.max(90, startWidth + moveEvent.clientX - startX);
      setMergeColumnWidths((prev) => ({ ...prev, [header]: nextWidth }));
    };

    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [mergeColumnWidths]);

  const handleUseMergePreview = useCallback(() => {
    if (!mergePreview) {
      setCombineError('Build the merge preview first.');
      return;
    }
    const { headers: outputHeaders, rows: cleanRows } = getMergePreviewExport(mergePreview, mergeVisibleColumns, mergePreviewFilter);
    const nextWorkbook = createWorkbookFromObjects(cleanRows, outputHeaders, 'Merged');
    handleWorkbookLoaded(nextWorkbook, `Merged source (${mergePrimarySource?.label || 'primary'} + ${mergeSecondarySource?.label || 'secondary'})`);
    setSkipSourceSetupForMerge(true);
    setCurrentStep(2);
    setMergeStage('preview');
    setCombineError('');
  }, [handleWorkbookLoaded, mergePreview, mergePreviewFilter, mergePrimarySource?.label, mergeSecondarySource?.label, mergeVisibleColumns]);

  const handleUseNormalizedAsBase = useCallback(() => {
    if (!normalizedRows.length) {
      setError('Run normalization before using this sheet as a merge base.');
      return;
    }

    const outputHeaders = getNormalizedExportColumns(normalizedRows);
    const cleanRows = normalizedRows.map((row) => {
      const output = {};
      outputHeaders.forEach((header) => {
        output[header] = row[header] || '';
      });
      return output;
    });
    const label = `Normalized base (${cleanRows.length} rows, ${outputHeaders.length} columns)`;
    const baseWorkbook = createWorkbookFromObjects(cleanRows, outputHeaders, 'Normalized_Base');
    const baseItem = {
      id: `normalized-base:${Date.now()}`,
      fileName: label,
      type: 'workbook',
      status: 'Normalized sheet ready as base',
      workbook: baseWorkbook,
      sheetName: 'Normalized_Base',
      selectedSheetNames: ['Normalized_Base'],
      headerRowIndex: 0,
      rowCount: cleanRows.length,
      isMergedBase: true,
    };

    setWorkbook(null);
    setFileName('');
    setSheetName('');
    setSheetScope('single');
    setSelectedSheetNames([]);
    setSheetRows([]);
    setHeaderRowIndex(0);
    setPreparedHeaders([]);
    setPreparedDataRows([]);
    setPatternParserOverrides([]);
    setRoles(emptyRoles);
    setNormalizedRows([]);
    setCurrentStep(0);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setNormalizationSummary(null);
    setParserTouched(false);
    setSkipSourceSetupForMerge(false);
    setConfirmOpen(false);
    setLowConfidenceOnly(false);
    setDownloadMenuAnchor(null);
    setToolsMenuAnchor(null);
    setParsingLogicOpen(false);
    setConfigureSplitColsOpen(false);
    setConfigureParserSessionId('');
    setConfigureParserPreparing(false);
    setConfigureParserInitialColumn('');
    setConfigureParserTitle('Split into Columns');
    setConfigureParserScope(null);
    setCombineItems([baseItem]);
    setMergeSources([]);
    setMergePreview(null);
    setMergePreviewFilter('all');
    setMergePreviewSearch('');
    setMergePreviewPage(0);
    setMergeVisibleColumns([]);
    setMergeColumnWidths({});
    setMergeConfig({
      primarySourceId: '',
      secondarySourceId: '',
      primaryKey: '',
      secondaryKey: '',
      relationshipName: '',
      outputMode: 'grouped',
      detailColumns: [],
    });
    setMergeStage('sources');
    setMergeChainMessage('Normalized sheet is ready as the base. Add another source, then click Prepare merge setup to merge it into this base.');
    setCombineError('');
    setError('');
  }, [normalizedRows]);

  const handleContinueNormalizedToBomMapping = useCallback((maybeAnswers = null) => {
    // onClick passes a MouseEvent, so accept the argument only when it
    // carries the gate's payload shape.
    const passed = (maybeAnswers && maybeAnswers.sheets) ? maybeAnswers : null;
    // Answers may already have been captured on the upload page; asking a
    // second time for the same workbook would just be noise.
    let answers = passed || bomStructureAnswers || location.state?.bomStructure || null;

    // A reused mapping template pre-answers the gate but never replaces it. Its
    // format answers always apply and its identity answers only while they
    // still describe this file, so reconciling still earns its keep — it just
    // seeds the dialog now instead of skipping it.
    //
    // The gate opens even when every saved answer survives, because it no
    // longer only describes the workbook: it also asks whether this upload is a
    // NEW BOM or a revision of an existing one. That is a property of the
    // upload, not of the customer's export format, so a template cannot know
    // it — and defaulting it to "new" without asking is how a file meant to
    // revise a BOM silently becomes a second BOM beside it.
    if (!answers) {
      const saved = location.state?.savedBomStructure;
      if (saved) {
        const reconciled = reconcileSavedBomStructure(saved, {
          sheetNames: bomStructureSheetNames,
          getSheetHeaders: bomStructureHeaderReader,
          getSheetRecords: bomStructureRecordReader,
        });
        setBomStructureSeed(reconciled.answers);
      }
    }

    if (!answers) {
      setPendingBomAction('normalized');
      setBomStructureOpen(true);
      return;
    }
    if (!normalizedRows.length) {
      setError('Run normalization before continuing to BOM Mapping.');
      return;
    }
    const baseColumns = getNormalizedExportColumns(normalizedRows);
    const { columns, rows } = buildBomMappingRowsFromNormalizedRows(normalizedRows, baseColumns);
    const suggestedMappings = buildNormalizerSuggestedMappings(columns, rows);
    const file = createWorkbookFileFromRows(rows, columns, 'normalized-bom-for-mapping.xlsx', 'Normalized BOM');
    const formData = new FormData();
    formData.append('clientFile', file);
    formData.append('sheetName', 'Normalized BOM');
    formData.append('headerRow', '1');
    // Forward the BOM structure answers captured on the upload page so the
    // session created here keeps them.
    if (answers || location.state?.bomStructure) {
      formData.append('bomStructure', JSON.stringify(answers || location.state.bomStructure));
    }
    const returnSnapshotKey = saveReturnSnapshot('normalized-results');
    const returnSnapshot = buildNormalizedResultsSnapshot(normalizedRows);

    setBusy(true);
    setError('');
    api.uploadFiles(formData)
      .then(async (response) => {
        const sessionId = response.data?.session_id;
        if (!sessionId) throw new Error('Upload response missing session id.');

        const uploadSource = location.state?.uploadSource || null;
        const workflow = buildNormalizerWorkflowRecipe('normalized-results', normalizedRows);
        const nextUploadSource = uploadSource ? {
          ...uploadSource,
          processingPath: 'normalize',
          normalizerWorkflow: workflow,
        } : null;
        const shouldOpenEditorDirectly = nextUploadSource?.processingTemplateMode === 'new' &&
          nextUploadSource?.processingPath === 'normalize';

        if (shouldOpenEditorDirectly) {
          const mappingResponse = await api.getColumnMappingSuggestions(sessionId);
          const clientHeaders = mappingResponse.data?.client_headers || mappingResponse.data?.user_columns || columns;
          const templateHeaders = mappingResponse.data?.template_headers || mappingResponse.data?.template_columns || [];
          const mappings = buildResolvedNormalizerMappings(suggestedMappings, clientHeaders, templateHeaders);

          if (!mappings.length) {
            throw new Error('Could not resolve normalized columns against the destination template. Use Modify Mappings to review this file.');
          }

          let existingMappings = [];
          let existingDefaultValues = {};
          let existingDefaultValueRules = {};
          let existingColumnCounts = null;
          const sourceMappingSessionId = location.state?.sourceMappingSessionId
            || sessionStorage.getItem('bomNormalizer.sourceMappingSessionId')
            || '';
          try {
            const existingResponse = await api.getExistingMappings(sourceMappingSessionId || sessionId);
            existingMappings = extractSavedMappingsArray(existingResponse);
            existingDefaultValues = existingResponse.data?.default_values || {};
            existingDefaultValueRules = existingResponse.data?.default_value_rules || {};
            existingColumnCounts = existingResponse.data?.session_metadata?.column_counts || null;
          } catch (_) {
            existingMappings = [];
            existingDefaultValues = {};
            existingDefaultValueRules = {};
            existingColumnCounts = null;
          }
          const mergedMappings = mergeExistingMappingsWithNormalizer(existingMappings, mappings);

          if (existingColumnCounts) {
            try {
              await api.updateColumnCounts(sessionId, existingColumnCounts);
            } catch (_) {}
          }

          await api.saveColumnMappings(sessionId, {
            mappings: mergedMappings,
            default_values: existingDefaultValues,
            default_value_rules: existingDefaultValueRules,
            apply_now: true,
            force_persist: true,
          });

          navigate(`/editor/${sessionId}`, {
            state: {
              fromUpload: true,
              fromBomNormalizer: true,
              templateAlreadyApplied: true,
              uploadSource: nextUploadSource,
              mappingBackState: {
                route: '/bom-normalizer',
                bomNormalizerReturnKey: returnSnapshotKey,
                bomNormalizerReturnRows: normalizedRows,
                bomNormalizerReturnSnapshot: returnSnapshot,
              },
            },
          });
          return;
        }

        navigate(`/mapping/${sessionId}`, {
          state: {
            fromUpload: true,
            fromBomNormalizer: true,
            normalizerSuggestedMappings: suggestedMappings,
            uploadSource: nextUploadSource,
            mappingBackState: {
              route: '/bom-normalizer',
              bomNormalizerReturnKey: returnSnapshotKey,
              bomNormalizerReturnRows: normalizedRows,
              bomNormalizerReturnSnapshot: returnSnapshot,
            },
          },
        });
      })
      .catch((err) => {
        setError(err.response?.data?.error || err.message || 'Could not continue.');
      })
      .finally(() => setBusy(false));
  }, [
    buildNormalizedResultsSnapshot,
    buildNormalizerWorkflowRecipe,
    config,
    factwiseConfig,
    fileName,
    headerRowIndex,
    location.state,
    lowConfidenceOnly,
    navigate,
    normalizationSummary,
    normalizedRows,
    progress,
    roles,
    saveReturnSnapshot,
    selectedSheetNames,
    sheetName,
    sheetScope,
    tagConfig,
  ]);

  const handleContinueMergePreviewToBomMapping = useCallback((maybeAnswers = null) => {
    // onClick passes a MouseEvent, so accept the argument only when it
    // carries the gate's payload shape.
    const passed = (maybeAnswers && maybeAnswers.sheets) ? maybeAnswers : null;
    // Answers may already have been captured on the upload page; asking a
    // second time for the same workbook would just be noise.
    let answers = passed || bomStructureAnswers || location.state?.bomStructure || null;

    // A reused mapping template pre-answers the gate but never replaces it. Its
    // format answers always apply and its identity answers only while they
    // still describe this file, so reconciling still earns its keep — it just
    // seeds the dialog now instead of skipping it.
    //
    // The gate opens even when every saved answer survives, because it no
    // longer only describes the workbook: it also asks whether this upload is a
    // NEW BOM or a revision of an existing one. That is a property of the
    // upload, not of the customer's export format, so a template cannot know
    // it — and defaulting it to "new" without asking is how a file meant to
    // revise a BOM silently becomes a second BOM beside it.
    if (!answers) {
      const saved = location.state?.savedBomStructure;
      if (saved) {
        const reconciled = reconcileSavedBomStructure(saved, {
          sheetNames: bomStructureSheetNames,
          getSheetHeaders: bomStructureHeaderReader,
          getSheetRecords: bomStructureRecordReader,
        });
        setBomStructureSeed(reconciled.answers);
      }
    }

    if (!answers) {
      setPendingBomAction('merge');
      setBomStructureOpen(true);
      return;
    }
    if (!mergePreview) {
      setCombineError('Build the merge preview first.');
      return;
    }
    const { headers, rows: mergeRows } = getMergePreviewExport(mergePreview, mergeVisibleColumns, mergePreviewFilter);
    if (!mergeRows.length) {
      setCombineError('No merged rows are available for BOM Mapping.');
      return;
    }
    const { columns, rows } = buildBomMappingRowsFromNormalizedRows(mergeRows, headers);
    const suggestedMappings = buildNormalizerSuggestedMappings(columns, rows);
    const file = createWorkbookFileFromRows(rows, columns, 'merged-bom-for-mapping.xlsx', 'Merged BOM');
    const formData = new FormData();
    formData.append('clientFile', file);
    formData.append('sheetName', 'Merged BOM');
    formData.append('headerRow', '1');
    // Forward the BOM structure answers captured on the upload page so the
    // session created here keeps them.
    if (answers || location.state?.bomStructure) {
      formData.append('bomStructure', JSON.stringify(answers || location.state.bomStructure));
    }
    const returnSnapshotKey = saveReturnSnapshot('merge-preview');

    setBusy(true);
    setCombineError('');
    api.uploadFiles(formData)
      .then((response) => {
        const sessionId = response.data?.session_id;
        if (!sessionId) throw new Error('Upload response missing session id.');
        navigate(`/mapping/${sessionId}`, {
          state: {
            fromUpload: true,
            fromBomNormalizer: true,
            normalizerSuggestedMappings: suggestedMappings,
            uploadSource: location.state?.uploadSource ? {
              ...location.state.uploadSource,
              processingPath: 'normalize',
              normalizerWorkflow: buildNormalizerWorkflowRecipe('merge-preview', rows),
            } : null,
            mappingBackState: {
              route: '/bom-normalizer',
              bomNormalizerReturnKey: returnSnapshotKey,
            },
          },
        });
      })
      .catch((err) => {
        setCombineError(err.response?.data?.error || err.message || 'Could not continue to BOM Mapping.');
      })
      .finally(() => setBusy(false));
  }, [buildNormalizerWorkflowRecipe, location.state, mergePreview, mergePreviewFilter, mergeVisibleColumns, navigate, saveReturnSnapshot]);

  // Sheets offered to the gate: whichever the user actually normalized.
  const bomStructureSheetNames = useMemo(
    () => (sheetScope === 'single'
      ? [sheetName].filter(Boolean)
      : (selectedSheetNames || []).filter(Boolean)),
    [sheetScope, sheetName, selectedSheetNames]
  );

  // Once normalization has run, the gate must describe the NORMALIZED rows,
  // because those are what BOM generation reads. Asking about the raw sheet gets
  // it wrong whenever the normalizer derived structure the customer's file did
  // not spell out: a sheet with no "Level" header at all still comes out of the
  // normalizer with levels 1/2/3, and the gate would call it flat and generate a
  // single-level BOM from a tree.
  //
  // Before normalization there is nothing else to describe, so the raw sheet
  // still answers.
  //
  // Reading the normalized table is only safe because the gate judges levels on
  // their VALUES (see hasRealLevels in BomStructureDialog). That table always
  // carries a `level` column - filled with 1 throughout for a flat sheet - so
  // detecting on the column's existence alone would call every sheet levelled.
  const bomStructureHeaderReader = useCallback(
    () => (normalizedRows.length
      ? getNormalizedExportColumns(normalizedRows)
      : (preparedHeaders || [])),
    [normalizedRows, preparedHeaders]
  );

  const bomStructureRecordReader = useCallback(
    () => (normalizedRows.length
      ? normalizedRows
      : rowsToObjects(sheetRows.slice(headerRowIndex + 1), headers, headerRowIndex + 2)),
    [normalizedRows, sheetRows, headerRowIndex, headers]
  );

  const bomStructurePreambleReader = useCallback(
    () => sheetRows.slice(0, headerRowIndex),
    [sheetRows, headerRowIndex]
  );

  const handleBomStructureConfirm = useCallback((payload) => {
    setBomStructureAnswers(payload);
    setBomStructureOpen(false);
    const pending = pendingBomAction;
    setPendingBomAction(null);
    // Answers are handed over directly rather than read back from state, which
    // has not committed yet at this point.
    if (pending === 'merge') handleContinueMergePreviewToBomMapping(payload);
    else if (pending === 'normalized') handleContinueNormalizedToBomMapping(payload);
  }, [pendingBomAction, handleContinueMergePreviewToBomMapping, handleContinueNormalizedToBomMapping]);

  const handleBackFromConfigure = useCallback(() => {
    if (skipSourceSetupForMerge && mergePreview) {
      setWorkbook(null);
      setFileName('');
      setSheetName('');
      setSheetScope('single');
      setSelectedSheetNames([]);
      setSheetRows([]);
      setHeaderRowIndex(0);
      setPreparedHeaders([]);
      setPreparedDataRows([]);
      setPatternParserOverrides([]);
      setStagedPatternEdits([]);
      setRoles(emptyRoles);
      setNormalizedRows([]);
      setCurrentStep(0);
      setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
      setDelimiterTouched(false);
      setParserTouched(false);
      setSkipSourceSetupForMerge(false);
      setNormalizationSummary(null);
      setConfirmOpen(false);
      setMergeStage('preview');
      setError('');
      return;
    }

    setCurrentStep(1);
  }, [mergePreview, skipSourceSetupForMerge]);

  const handleSheetChange = useCallback((nextSheetName) => {
    if (!workbook) return;
    const prepared = prepareSingleSheet(workbook, nextSheetName);
    const nextHeaders = prepared.headers;
    const nextRoles = rolesForMultiBlockAssembly(nextHeaders, inferRoles(nextHeaders, prepared.dataRows, { manufacturerDirectory }));

    setSheetName(nextSheetName);
    setSelectedSheetNames([nextSheetName]);
    setSheetRows(prepared.sheetRows);
    setHeaderRowIndex(prepared.headerRowIndex);
    setPreparedHeaders(prepared.headers);
    setPreparedDataRows(prepared.dataRows);
    setPatternParserOverrides([]);
    setSourceEndRow('');
    setRoles(nextRoles);
    setConfig((prev) => nextConfigForDetectedStructure({ ...prev, bomLayout: 'none' }, detectBestStructure(nextHeaders, nextRoles, prepared.dataRows.slice(0, 40)), {
      headers: nextHeaders,
      rows: prepared.dataRows.slice(0, 120),
      roles: nextRoles,
    }));
    setNormalizedRows([]);
    setCurrentStep(1);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setDelimiterTouched(false);
    setParserTouched(false);
    setSkipSourceSetupForMerge(false);
    setNormalizationSummary(null);
    setConfirmOpen(false);
  }, [manufacturerDirectory, workbook]);

  const applySheetSelection = useCallback((scope, names, options = {}) => {
    if (!workbook) return;
    const safeNames = names.filter((name) => workbook.SheetNames.includes(name));
    const nextNames = scope === 'all'
      ? workbook.SheetNames
      : (safeNames.length ? safeNames : [workbook.SheetNames[0]]);
    const pinnedHeaderRow = Number(
      options.headerRow === undefined ? sheetHeaderRowOverride : options.headerRow
    );
    const headerRow = Number.isFinite(pinnedHeaderRow) && pinnedHeaderRow > 0 ? pinnedHeaderRow : undefined;
    const prepared = scope === 'single'
      ? prepareSingleSheet(workbook, nextNames[0])
      : prepareMultipleSheets(workbook, nextNames, { headerRow });
    const nextRoles = rolesForMultiBlockAssembly(prepared.headers, inferRoles(prepared.headers, prepared.dataRows, { manufacturerDirectory }));

    setSheetScope(scope);
    setSheetHeaderRowOverride(scope === 'single' || !headerRow ? '' : String(headerRow));
    setSelectedSheetNames(nextNames);
    setSheetName(nextNames[0]);
    setSheetRows(prepared.sheetRows);
    setHeaderRowIndex(prepared.headerRowIndex);
    setPreparedHeaders(prepared.headers);
    setPreparedDataRows(prepared.dataRows);
    setPatternParserOverrides([]);
    setSourceEndRow('');
    setRoles(nextRoles);
    setConfig((prev) => nextConfigForDetectedStructure({ ...prev, bomLayout: 'none' }, detectBestStructure(prepared.headers, nextRoles, prepared.dataRows.slice(0, 40)), {
      headers: prepared.headers,
      rows: prepared.dataRows.slice(0, 120),
      roles: nextRoles,
    }));
    setNormalizedRows([]);
    setCurrentStep(1);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setDelimiterTouched(false);
    setParserTouched(false);
    setSkipSourceSetupForMerge(false);
    setNormalizationSummary(null);
    setConfirmOpen(false);
  }, [manufacturerDirectory, sheetHeaderRowOverride, workbook]);

  const handleSheetScopeChange = useCallback((nextScope) => {
    if (!workbook) return;
    const nextNames = nextScope === 'all'
      ? workbook.SheetNames
      : nextScope === 'single'
        ? [sheetName || workbook.SheetNames[0]]
        : selectedSheetNames.length
          ? selectedSheetNames
          : [sheetName || workbook.SheetNames[0]];
    applySheetSelection(nextScope, nextNames);
  }, [applySheetSelection, selectedSheetNames, sheetName, workbook]);

  const handleSelectedSheetsChange = useCallback((nextNames) => {
    const names = typeof nextNames === 'string' ? nextNames.split(',') : nextNames;
    applySheetSelection('selected', names);
  }, [applySheetSelection]);

  const handleHeaderRowChange = useCallback((value) => {
    const nextIndex = Math.max(0, Number(value) - 1);
    const activeSheetName = sheetName || workbook?.SheetNames?.[0] || '';
    // Across several sheets one header row applies to all of them; blank hands
    // each sheet back to its own auto-detection.
    if (workbook && sheetScope !== 'single') {
      applySheetSelection(sheetScope, selectedSheetNames, { headerRow: value });
      return;
    }
    if (workbook && sheetScope === 'single' && activeSheetName) {
      const prepared = prepareSingleSheet(workbook, activeSheetName, { headerRow: nextIndex + 1 });
      const nextRoles = inferRoles(prepared.headers, prepared.dataRows, { manufacturerDirectory });
      setSheetRows(prepared.sheetRows);
      setHeaderRowIndex(prepared.headerRowIndex);
      setPreparedHeaders(prepared.headers);
      setPreparedDataRows(prepared.dataRows);
      setPatternParserOverrides([]);
      setSourceEndRow('');
      setRoles(nextRoles);
      setNormalizedRows([]);
      setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
      setNormalizationSummary(null);
      setParserTouched(false);
      setSkipSourceSetupForMerge(false);
      setConfirmOpen(false);
      return;
    }

    const columns = getUsableColumnDescriptors(sheetRows, nextIndex);
    const nextHeaders = columns.length
      ? columns.map((column) => column.header)
      : makeUniqueHeaders(sheetRows[nextIndex] || []);
    const nextRoles = inferRoles(nextHeaders, sheetRows.slice(nextIndex + 1), { manufacturerDirectory });
    setHeaderRowIndex(nextIndex);
    setPreparedHeaders(nextHeaders);
    setPreparedDataRows(sheetRows
      .slice(nextIndex + 1)
      .map((row, rowIndex) => {
        const mapped = {};
        columns.forEach((column) => {
          mapped[column.header] = fmt(row[column.index]);
        });
        mapped.__sourceRow = nextIndex + 2 + rowIndex;
        return mapped;
      }));
    setPatternParserOverrides([]);
    setSourceEndRow('');
    setRoles(nextRoles);
    setNormalizedRows([]);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setNormalizationSummary(null);
    setParserTouched(false);
    setSkipSourceSetupForMerge(false);
    setConfirmOpen(false);
  }, [applySheetSelection, manufacturerDirectory, selectedSheetNames, sheetName, sheetRows, sheetScope, workbook]);

  const handleRoleChange = useCallback((role, header) => {
    setRoles((prev) => ({ ...prev, [role]: header }));
    if (header) rememberRoleHeader(role, header);
  }, []);

  const getSourceColumnName = useCallback((header, fallbackIndex = -1) => {
    const sourceIndex = Number.isFinite(sourceColumnIndexByHeader[header])
      ? sourceColumnIndexByHeader[header]
      : fallbackIndex;
    return excelColumnName(sourceIndex);
  }, [sourceColumnIndexByHeader]);

  const getSourceColumnLabel = useCallback((header, role = '') => {
    if (!header) return 'None';
    if (!roleColumnLabelModes[role]) return header;
    const columnName = getSourceColumnName(header, headers.indexOf(header));
    return columnName ? `Column ${columnName}` : header;
  }, [getSourceColumnName, headers, roleColumnLabelModes]);

  const getPreviewHeaderLabel = useCallback((header) => {
    const matchingRole = ROLE_FIELDS.find((field) => roles[field.key] === header && roleColumnLabelModes[field.key]);
    return matchingRole ? getSourceColumnLabel(header, matchingRole.key) : header;
  }, [getSourceColumnLabel, roleColumnLabelModes, roles]);

  const toggleRoleColumnLabelMode = useCallback((role, checked) => {
    setRoleColumnLabelModes((prev) => ({
      ...prev,
      [role]: checked,
    }));
  }, []);

  const refreshWorkflowTemplates = useCallback(async () => {
    setWorkflowTemplateLoading(true);
    try {
      const response = await api.getBomWorkflowTemplates();
      setWorkflowTemplates(response.data.templates || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not load workflow templates.');
    } finally {
      setWorkflowTemplateLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshWorkflowTemplates();
  }, [refreshWorkflowTemplates]);

  const resolveTemplateHeader = useCallback((savedHeader) => {
    if (!savedHeader) return '';
    if (headers.includes(savedHeader)) return savedHeader;
    const target = normalizeKey(savedHeader);
    return headers.find((header) => normalizeKey(header) === target) || '';
  }, [headers]);

  const applyWorkflowTemplate = useCallback(async () => {
    if (!selectedWorkflowTemplateId) {
      setError('Choose a workflow template first.');
      return;
    }
    if (!workbook) {
      setError('Upload a workbook before applying a workflow template.');
      return;
    }

    try {
      const response = await api.getBomWorkflowTemplate(selectedWorkflowTemplateId);
      const template = response.data.template;
      const workflow = template?.workflow || {};
      const savedRoles = workflow.roles || {};
      const nextRoles = Object.keys(emptyRoles).reduce((acc, key) => {
        acc[key] = resolveTemplateHeader(savedRoles[key]);
        return acc;
      }, {});

      setRoles(nextRoles);
      setConfig((prev) => ({ ...prev, ...(workflow.config || {}) }));
      if (workflow.factwiseConfig) setFactwiseConfig((prev) => ({ ...prev, ...workflow.factwiseConfig }));
      if (workflow.tagConfig) setTagConfig((prev) => ({ ...prev, ...workflow.tagConfig }));
      setParserTouched(true);
      setDelimiterTouched(true);
      setNormalizedRows([]);
      setNormalizationSummary(null);
      setError('');
      setSuccessMessage(`Applied workflow template "${template?.name || 'selected template'}".`);
      setCurrentStep(2);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not apply workflow template.');
    }
  }, [headers, resolveTemplateHeader, selectedWorkflowTemplateId, workbook]);

  const saveWorkflowTemplate = useCallback(async () => {
    const name = window.prompt('Name this workflow template');
    if (!name || !name.trim()) return;

    const sourceSignature = {
      fileName,
      sheetName,
      sheetScope,
      selectedSheetNames,
      headerRowIndex,
      headers,
    };
    const workflow = {
      version: 1,
      roles,
      config,
      factwiseConfig,
      tagConfig,
      sourceHints: {
        sheetName,
        sheetScope,
        selectedSheetNames,
        headerRowIndex,
      },
      outputColumns: getNormalizedExportColumns(normalizedRows),
    };

    setWorkflowTemplateSaving(true);
    try {
      const response = await api.saveBomWorkflowTemplate({
        name: name.trim(),
        description: `Saved from ${fileName || 'BOM Normalizer'}`,
        sourceSignature,
        workflow,
      });
      await refreshWorkflowTemplates();
      setSelectedWorkflowTemplateId(String(response.data.template?.id || ''));
      setError('');
      setSuccessMessage(response.data.message || `Saved workflow template "${name.trim()}".`);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not save workflow template.');
    } finally {
      setWorkflowTemplateSaving(false);
    }
  }, [
    config,
    factwiseConfig,
    fileName,
    headerRowIndex,
    headers,
    normalizedRows,
    refreshWorkflowTemplates,
    roles,
    selectedSheetNames,
    sheetName,
    sheetScope,
    tagConfig,
  ]);

  const buildNormalizationSummary = useCallback((rows, pairingCheck = null) => {
    const primaryRows = rows.filter((row) => row.relation === 'Primary').length;
    const alternateRows = rows.filter((row) => row.relation !== 'Primary').length;
    const uniqueRawMaterials = new Set(rows.map((row) => row.mpn || row.manufacturer || row.cpn).filter(Boolean)).size;
    const skippedRows = dataRows.filter((row) => shouldSkipSourceRow(row, headers, roles, config)).length;
    return {
      totalRows: rows.length,
      primaryRows,
      alternateRows,
      uniqueRawMaterials,
      skippedRows,
      pairingCheckedRows: pairingCheck?.checkedRows || 0,
      pairingMatchedRows: pairingCheck?.matchedRows || 0,
      pairingIssueRows: pairingCheck?.issueRows?.length || 0,
    };
  }, [config, dataRows, headers, roles]);

  const commitNormalizedResult = useCallback((rows, pairingCheck = null) => {
    setNormalizedRows(rows);
    setNormalizationSummary(buildNormalizationSummary(rows, pairingCheck));
    setSummaryParserDetailsOpen(false);
    setConfirmOpen(true);
    setError('');
  }, [buildNormalizationSummary]);

  const updatePairingReviewRow = useCallback((index, patch) => {
    setPairingReviewRows((prev) => prev.map((row, rowIndex) => (
      rowIndex === index ? { ...row, ...patch } : row
    )));
  }, []);

  const updatePairingManualManufacturers = useCallback((index, value) => {
    const values = splitManualManufacturers(value);
    setPairingReviewRows((prev) => prev.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const mpnDecisions = (row.mpnDecisions || row.mpns.map((mpn) => ({ mpn, manufacturer: '', keep: true })))
        .map((decision, decisionIndex) => ({
          ...decision,
          manufacturer: values[decisionIndex] || decision.manufacturer || values[0] || '',
        }));
      return { ...row, manualManufacturers: value, mpnDecisions };
    }));
  }, []);

  const updatePairingMpnDecision = useCallback((issueIndex, mpnIndex, patch) => {
    setPairingReviewRows((prev) => prev.map((row, rowIndex) => {
      if (rowIndex !== issueIndex) return row;
      const baseDecisions = row.mpnDecisions || row.mpns.map((mpn, index) => ({
        mpn,
        manufacturer: row.manufacturers[index] || row.manufacturers[0] || '',
        keep: true,
      }));
      const mpnDecisions = baseDecisions.map((decision, decisionIndex) => (
        decisionIndex === mpnIndex ? { ...decision, ...patch } : decision
      ));
      return { ...row, mpnDecisions };
    }));
  }, []);

  const updatePairingMfrDecision = useCallback((issueIndex, mfrIndex, patch) => {
    setPairingReviewRows((prev) => prev.map((row, rowIndex) => {
      if (rowIndex !== issueIndex) return row;
      const baseDecisions = row.mfrDecisions || row.manufacturers.map((manufacturer) => ({
        manufacturer,
        keep: true,
      }));
      const mfrDecisions = baseDecisions.map((decision, decisionIndex) => (
        decisionIndex === mfrIndex ? { ...decision, ...patch } : decision
      ));
      return { ...row, mfrDecisions };
    }));
  }, []);

  const handleApplyPairingReview = useCallback(() => {
    if (!pendingNormalization) {
      setPairingReviewOpen(false);
      return;
    }
    const reviewedRows = applyPairingReviewDecisions(pendingNormalization.rows, pairingReviewRows);
    const pairingCheck = {
      ...(pendingNormalization.pairingCheck || {}),
      issueRows: pairingReviewRows,
    };
    setPairingReviewOpen(false);
    setPendingNormalization(null);
    commitNormalizedResult(reviewedRows, pairingCheck);
  }, [commitNormalizedResult, pairingReviewRows, pendingNormalization]);

  const handleKeepPairingReview = useCallback(() => {
    if (!pendingNormalization) {
      setPairingReviewOpen(false);
      return;
    }
    const reviewedRows = applyPairingReviewDecisions(pendingNormalization.rows, pairingReviewRows);
    const pairingCheck = {
      ...(pendingNormalization.pairingCheck || {}),
      issueRows: pairingReviewRows,
    };
    setPairingReviewOpen(false);
    setPendingNormalization(null);
    commitNormalizedResult(reviewedRows, pairingCheck);
  }, [commitNormalizedResult, pairingReviewRows, pendingNormalization]);

  const commitStagedPatternEdits = useCallback(() => {
    const baseRows = sourceDataRows.length ? sourceDataRows : dataRows;
    if (!stagedPatternEdits.length) {
      return { headers, rows: baseRows, overrides: patternParserOverrides };
    }

    // Only the overrides are committed. The parsed COLUMNS are deliberately not
    // written onto the source sheet: they hold one ' | '-joined string per cell,
    // and normalization carries source columns onto the output, so a 'Description'
    // column of "[2225412] | [2225668" shadowed the per-entry `description` that
    // applyPatternOutputsToNormalizedRows fills. The override already carries
    // every parsed value, split per entry, so the sheet copy was pure noise.
    let nextOverrides = patternParserOverrides;

    stagedPatternEdits.forEach((edit) => {
      const applied = applyParserResultToSheet({
        result: edit.result,
        scope: edit.scope,
        headers,
        sourceRows: baseRows,
        headerRowIndex,
      });
      if (!applied?.override) return;
      nextOverrides = [
        ...nextOverrides.filter((override) => !(
          normalizeKey(override.sourceHeader) === normalizeKey(applied.override.sourceHeader) &&
          override.patternShape === applied.override.patternShape
        )),
        applied.override,
      ];
    });

    setPatternParserOverrides(nextOverrides);
    setStagedPatternEdits([]);

    return { headers, rows: baseRows, overrides: nextOverrides };
  }, [dataRows, headerRowIndex, headers, patternParserOverrides, sourceDataRows, stagedPatternEdits]);

  const runNormalization = useCallback(async () => {
    if (!dataRows.length) {
      setError('No data rows found below the selected header row.');
      return;
    }
    // A hierarchical BOM is valid input with no MPN or manufacturer column at
    // all: SAFRAN-style sheets carry internal part codes and keep manufacturers
    // in a separate AVL sheet. Requiring MPN/MFR here blocked every multi-level
    // BOM from being normalized, so nothing downstream was ever reachable.
    const layoutStructure = effectiveStructure(normalizerConfig);
    if (!roles.mpn && !roles.manufacturer && !roles.level && layoutStructure !== 'assembly_quantity_matrix' && layoutStructure !== 'multi_block_assembly') {
      setError('Select at least an MPN, Manufacturer, or BOM level column before running normalization.');
      return;
    }
    // Pattern edits are committed here, so a run always reflects every edit the
    // user staged plus the auto-detected parse for the patterns they left alone.
    const committed = commitStagedPatternEdits();
    const runHeaders = committed.headers;
    const runRows = filterRowsByEndRow(committed.rows, sourceEndRow);
    const runConfig = { ...normalizerConfig, patternParserOverrides: committed.overrides };

    setBusy(true);
    setProgress({ processed: 0, total: runRows.length, outputRows: 0, skippedRows: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const normalized = await normalizeRowsChunked(runRows, runHeaders, roles, runConfig, setProgress);
      const result = applyPatternOutputsToNormalizedRows(normalized, committed.overrides);
      const pairingCheck = layoutStructure === 'assembly_quantity_matrix' || layoutStructure === 'multi_block_assembly'
        ? { checkedRows: 0, matchedRows: 0, issueRows: [] }
        : analyzeMpnManufacturerPairing(runRows, runHeaders, roles, runConfig);
      if (pairingCheck.issueRows.length) {
        setPendingNormalization({ rows: result, pairingCheck });
        setPairingReviewRows(pairingCheck.issueRows);
        setPairingReviewOpen(true);
        setError('');
      } else {
        commitNormalizedResult(result, pairingCheck);
      }
    } catch (err) {
      setError(err.message || 'Normalization failed.');
    } finally {
      setBusy(false);
    }
  }, [commitNormalizedResult, commitStagedPatternEdits, dataRows, headers, normalizerConfig, roles, sourceEndRow]);

  const handleNormalize = useCallback(async () => {
    setParsingLogicOpen(true);
  }, []);

  const handleOpenConfigureSplitColumns = useCallback(async ({ title = 'Split into Columns', initialColumn = '', scope = null } = {}) => {
    if (!headers.length || !dataRows.length) {
      setError('No source rows are available for Split into Columns.');
      return;
    }

    setConfigureParserPreparing(true);
    setError('');
    setPatternApplyNotice('');
    setConfigureParserTitle(title);
    setConfigureParserInitialColumn(initialColumn && headers.includes(initialColumn) ? initialColumn : '');
    setConfigureParserScope(scope);
    try {
      const scopedRows = scope?.mode === 'pattern' && Array.isArray(scope.sourceRows) && scope.sourceRows.length
        ? dataRows.filter((row) => scope.sourceRows.includes(row?.__sourceRow))
        : dataRows;
      if (!scopedRows.length) {
        throw new Error('No rows matched this detected pattern.');
      }

      const rows = scopedRows.map((row) => {
        const cleanRow = {};
        headers.forEach((header) => {
          cleanRow[header] = row?.[header] ?? '';
        });
        return cleanRow;
      });
      const file = createWorkbookFileFromRows(rows, headers, 'normalizer-source-for-split.xlsx', 'Source');
      const formData = new FormData();
      formData.append('clientFile', file);
      formData.append('sheetName', 'Source');
      formData.append('headerRow', '1');

      const response = await api.uploadFiles(formData);
      const sessionId = response.data?.session_id;
      if (!sessionId) throw new Error('Upload response missing session id.');

      setConfigureParserSessionId(sessionId);
      setConfigureSplitColsOpen(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not prepare Split into Columns.');
      setConfigureParserScope(null);
    } finally {
      setConfigureParserPreparing(false);
    }
  }, [dataRows, headers]);

  const handleApplyConfigureSplitColumns = useCallback((result) => {
    const scope = configureParserScope;
    const closeParser = () => {
      setConfigureSplitColsOpen(false);
      setConfigureParserSessionId('');
      setConfigureParserInitialColumn('');
      setConfigureParserTitle('Split into Columns');
      setConfigureParserScope(null);
      setParserTouched(true);
    };

    // A pattern edit is staged against its pattern, not written to the sheet.
    // It replaces the auto-detected parse for those rows when normalization
    // runs; every pattern the user did not edit still parses normally.
    if (scope?.mode === 'pattern') {
      const preview = applyParserResultToSheet({
        result,
        scope,
        headers,
        sourceRows: sourceDataRows.length ? sourceDataRows : dataRows,
        headerRowIndex,
      });
      if (!preview) {
        setError('Split into Columns applied, but no parsed data was returned.');
        return;
      }
      setStagedPatternEdits((prev) => withStagedPatternEdit(prev, {
        patternKey: scope.patternKey || '',
        sourceHeader: scope.sourceHeader || '',
        patternShape: scope.patternShape || '',
        scopedCount: preview.scopedCount,
        summary: preview.override?.summary || 'manual parser outputs',
        // Kept so the review dialog can preview the edit without committing it.
        override: preview.override,
        result,
        scope,
      }));
      closeParser();
      if (scope.patternKey) {
        setSelectedParsingPatternKey(scope.patternKey);
        setParsingLogicOpen(true);
      }
      const message = `Pattern updated for ${preview.scopedCount} row${preview.scopedCount === 1 ? '' : 's'}. It runs when you start normalization.`;
      setPatternApplyNotice(message);
      setSuccessMessage(message);
      return;
    }

    // Plain Split into Columns has no pattern to stage against, so it still
    // writes straight to the sheet.
    const applied = applyParserResultToSheet({
      result,
      scope,
      headers,
      sourceRows: sourceDataRows.length ? sourceDataRows : dataRows,
      headerRowIndex,
    });
    if (!applied) {
      setError('Split into Columns applied, but no parsed data was returned.');
      return;
    }
    const headerSet = new Set(applied.nextHeaders);
    setPreparedHeaders(applied.nextHeaders);
    setPreparedDataRows(applied.nextRows);
    setRoles((prev) => Object.fromEntries(
      Object.entries(prev).map(([key, value]) => [key, headerSet.has(value) ? value : ''])
    ));
    closeParser();
    setSuccessMessage(`Structured split applied. Added ${result.new_headers_count || 0} columns.`);
  }, [configureParserScope, dataRows, headerRowIndex, headers, sourceDataRows]);

  // Replay every staged pattern edit onto the sheet, in the order they were
  // made. Returns the committed sheet so normalization can use it immediately
  // instead of waiting for state to settle.

  const handleOpenFactwiseDialog = useCallback(() => {
    setFactwiseConfig((prev) => ({
      ...prev,
      firstColumn: normalizedColumnOptions.includes(prev.firstColumn) ? prev.firstColumn : (normalizedColumnOptions.includes('manufacturer') ? 'manufacturer' : normalizedColumnOptions[0] || ''),
      secondColumn: normalizedColumnOptions.includes(prev.secondColumn) ? prev.secondColumn : (normalizedColumnOptions.includes('mpn') ? 'mpn' : normalizedColumnOptions[1] || normalizedColumnOptions[0] || ''),
    }));
    setFactwiseDialogOpen(true);
  }, [normalizedColumnOptions]);

  const handleCreateFactwiseForNormalizer = useCallback(() => {
    setNormalizedRows((prevRows) => createFactwiseIds(prevRows, factwiseConfig));
    setFactwiseDialogOpen(false);
  }, [factwiseConfig]);

  const handleOpenTagDialog = useCallback(() => {
    setTagConfig((prev) => ({
      ...prev,
      targetColumn: getNextTagColumn(normalizedRows),
      sourceColumn: normalizedColumnOptions.includes(prev.sourceColumn) ? prev.sourceColumn : (normalizedColumnOptions.includes('manufacturer') ? 'manufacturer' : normalizedColumnOptions[0] || ''),
      rules: (prev.rules?.length ? prev.rules : [{ sourceColumn: 'manufacturer', searchText: '', outputValue: '', caseSensitive: false }])
        .map((rule) => ({
          ...rule,
          sourceColumn: normalizedColumnOptions.includes(rule.sourceColumn)
            ? rule.sourceColumn
            : (normalizedColumnOptions.includes('manufacturer') ? 'manufacturer' : normalizedColumnOptions[0] || ''),
        })),
    }));
    setTagDialogOpen(true);
  }, [normalizedColumnOptions, normalizedRows]);

  const handleCreateTagForNormalizer = useCallback(() => {
    setNormalizedRows((prevRows) => createTagColumn(prevRows, tagConfig));
    setTagDialogOpen(false);
  }, [tagConfig]);

  const handleOpenDeleteRowsDialog = useCallback(() => {
    setDeleteRowsColumn((prev) => (
      normalizedColumnOptions.includes(prev)
        ? prev
        : (normalizedColumnOptions.includes('mpn') ? 'mpn' : normalizedColumnOptions[0] || '')
    ));
    setDeleteRowsOpen(true);
  }, [normalizedColumnOptions]);

  const rowMatchesDeleteCondition = useCallback((row) => {
    const cell = String(row?.[deleteRowsColumn] ?? '').trim();
    const normalizedCell = cell.toLowerCase();
    const compare = deleteRowsCompare.trim().toLowerCase();
    if (deleteRowsOperator === 'is_empty') return cell === '';
    if (deleteRowsOperator === 'not_empty') return cell !== '';
    if (deleteRowsOperator === 'equals') return normalizedCell === compare;
    if (deleteRowsOperator === 'not_equals') return normalizedCell !== compare;
    if (deleteRowsOperator === 'contains') return normalizedCell.includes(compare);
    return false;
  }, [deleteRowsColumn, deleteRowsCompare, deleteRowsOperator]);

  const handleDeleteRowsByCondition = useCallback(() => {
    if (!deleteRowsColumn) return;
    if (['equals', 'not_equals', 'contains'].includes(deleteRowsOperator) && !deleteRowsCompare.trim()) {
      setError('Enter the text to compare against.');
      return;
    }

    setDeleteRowsBusy(true);
    try {
      const keptRows = normalizedRows.filter((row) => !rowMatchesDeleteCondition(row));
      const removed = normalizedRows.length - keptRows.length;
      setNormalizedRows(keptRows);
      setNormalizationSummary(buildNormalizationSummary(keptRows));
      setProgress((prev) => ({
        ...prev,
        outputRows: keptRows.length,
      }));
      setDeleteRowsOpen(false);
      setError('');
      setSuccessMessage(`Deleted ${removed} row${removed === 1 ? '' : 's'} - ${keptRows.length} remaining.`);
    } catch (err) {
      setError(err.message || 'Could not delete rows.');
    } finally {
      setDeleteRowsBusy(false);
    }
  }, [buildNormalizationSummary, deleteRowsColumn, deleteRowsCompare, deleteRowsOperator, normalizedRows, rowMatchesDeleteCondition]);

  const handleOpenManufacturerMatch = useCallback(async () => {
    setManufacturerMatchOpen(true);
    setManufacturerMatchError('');
    if (manufacturerDirectory.loaded) return;

    setManufacturerMatchLoading(true);
    try {
      const response = await api.getManufacturerDirectory();
      setManufacturerDirectory({
        names: response.data?.names || [],
        aliases: response.data?.aliases || {},
        loaded: true,
        entryCount: response.data?.entry_count || 0,
        aliasCount: response.data?.alias_count || 0,
      });
    } catch (err) {
      setManufacturerMatchError('Could not load manufacturer list from backend. Restart backend and try again.');
    } finally {
      setManufacturerMatchLoading(false);
    }
  }, [manufacturerDirectory.loaded]);

  useEffect(() => {
    if (manufacturerDirectory.loaded) return undefined;
    let cancelled = false;
    const loadDirectory = async () => {
      try {
        const response = await api.getManufacturerDirectory();
        if (cancelled) return;
        setManufacturerDirectory({
          names: response.data?.names || [],
          aliases: response.data?.aliases || {},
          loaded: true,
          entryCount: response.data?.entry_count || 0,
          aliasCount: response.data?.alias_count || 0,
        });
      } catch (err) {
        // Header detection still works from synonyms if the directory is unavailable.
      }
    };
    loadDirectory();
    return () => {
      cancelled = true;
    };
  }, [manufacturerDirectory.loaded]);

  useEffect(() => {
    if (!manufacturerDirectory.loaded || currentStep > 2 || !headers.length || !dataRows.length) return;
    const nextRoles = rolesForMultiBlockAssembly(headers, inferRoles(headers, dataRows, { manufacturerDirectory }));
    setRoles((prev) => {
      const updates = {};
      const shouldReplaceManufacturer = !prev.manufacturer ||
        prev.manufacturer === prev.mpn ||
        prev.manufacturer === prev.cpn ||
        !hasUsefulRoleValues(columnValues(prev.manufacturer, headers, dataRows)) ||
        looksLikeCodeColumn(columnValues(prev.manufacturer, headers, dataRows));
      if (shouldReplaceManufacturer && nextRoles.manufacturer && nextRoles.manufacturer !== prev.manufacturer) {
        updates.manufacturer = nextRoles.manufacturer;
      }
      const shouldReplaceMpn = !prev.mpn || prev.mpn === prev.manufacturer;
      if (shouldReplaceMpn && nextRoles.mpn && nextRoles.mpn !== prev.mpn) {
        updates.mpn = nextRoles.mpn;
      }
      return Object.keys(updates).length ? { ...prev, ...updates } : prev;
    });
  }, [currentStep, dataRows, headers, manufacturerDirectory]);

  const handleApplyManufacturerMatch = useCallback(() => {
    const selectedMap = new Map(
      manufacturerMatchPreview
        .filter((match) => selectedManufacturerMatches.includes(match.key))
        .map((match) => [match.original, match.canonical])
    );
    setNormalizedRows((prevRows) => prevRows.map((row) => {
      const original = fmt(row.manufacturer);
      const canonical = selectedMap.get(original);
      return canonical && canonical !== original
        ? { ...row, manufacturer: canonical }
        : row;
    }));
    setManufacturerMatchOpen(false);
  }, [manufacturerMatchPreview, selectedManufacturerMatches]);

  const handleReset = useCallback(() => {
    setWorkbook(null);
    setFileName('');
    setSheetName('');
    setSheetScope('single');
    setSelectedSheetNames([]);
    setSheetRows([]);
    setHeaderRowIndex(0);
    setPreparedHeaders([]);
    setPreparedDataRows([]);
    setRoles(emptyRoles);
    setConfig({
      structure: 'separate_cells',
      bomLayout: 'none',
      alternateLayout: 'inside_selected_mpn_columns',
      delimiterMode: 'auto',
      customDelimiter: '',
      groupHeaderMode: 'auto',
      manufacturerMode: 'inherit_blank',
      quantityMode: 'inherit_primary',
      quantityVariant: QUANTITY_VARIANT_ALL,
      quantityVariantByBlock: {},
      inheritLevels: true,
      skipTitleRows: true,
      skipRepeatedHeaders: true,
      skipDoNotPopulate: false,
      skipDeletedRows: true,
      documentTypeValues: [],
      parentPathLevels: true,
      alternateColumnGroups: [],
      followingRowAlternateColumn: '',
      includeInsideCellAlternatesWithFollowingRows: true,
      followingItemRowsContextColumn: '',
      followingItemRowsItemColumn: '',
      followingItemRowsMpnColumn: '',
      followingItemRowsManufacturerColumn: '',
      followingItemRowsCpnMode: 'primary',
    });
    setNormalizedRows([]);
    setCurrentStep(0);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setDelimiterTouched(false);
    setParserTouched(false);
    setSkipSourceSetupForMerge(false);
    setNormalizationSummary(null);
    setConfirmOpen(false);
    setPairingReviewOpen(false);
    setPairingReviewRows([]);
    setPendingNormalization(null);
    setLowConfidenceOnly(false);
    setFactwiseDialogOpen(false);
    setTagDialogOpen(false);
    setManufacturerMatchOpen(false);
    setDownloadMenuAnchor(null);
    setToolsMenuAnchor(null);
    setParsingLogicOpen(false);
    setConfigureSplitColsOpen(false);
    setConfigureParserSessionId('');
    setConfigureParserPreparing(false);
    setConfigureParserInitialColumn('');
    setConfigureParserTitle('Split into Columns');
    setConfigureParserScope(null);
    setRoleColumnLabelModes({});
    setCombineItems([]);
    setCombineBusy(false);
    setCombineError('');
    setMergeChainMessage('');
    setMergeSources([]);
    setMergeStage('sources');
    setMergeConfig({
      primarySourceId: '',
      secondarySourceId: '',
      primaryKey: '',
      secondaryKey: '',
      relationshipName: '',
      outputMode: 'grouped',
      detailColumns: [],
    });
    setMergePreview(null);
    setMergePreviewFilter('all');
    setMergePreviewSearch('');
    setMergePreviewPage(0);
    setMergeVisibleColumns([]);
    setMergeColumnWidths({});
    setPdfChoiceOpen(false);
    setPendingPdfAction(null);
    setPdfRangeEnabled(false);
    setPdfRanges([
      { name: 'Section 1', pages: '' },
      { name: 'Section 2', pages: '' },
    ]);
    setError('');
  }, []);

  const handleBackFromSourceSetup = useCallback(() => {
    if (location.state?.uploadSource) {
      navigate('/upload');
      return;
    }

    if (!mergePreview) {
      handleReset();
      return;
    }

    setWorkbook(null);
    setFileName('');
    setSheetName('');
    setSheetScope('single');
    setSelectedSheetNames([]);
    setSheetRows([]);
    setHeaderRowIndex(0);
    setPreparedHeaders([]);
    setPreparedDataRows([]);
    setRoles(emptyRoles);
    setConfig({
      structure: 'separate_cells',
      bomLayout: 'none',
      alternateLayout: 'inside_selected_mpn_columns',
      delimiterMode: 'auto',
      customDelimiter: '',
      groupHeaderMode: 'auto',
      manufacturerMode: 'inherit_blank',
      quantityMode: 'inherit_primary',
      quantityVariant: QUANTITY_VARIANT_ALL,
      quantityVariantByBlock: {},
      inheritLevels: true,
      skipTitleRows: true,
      skipRepeatedHeaders: true,
      skipDoNotPopulate: false,
      skipDeletedRows: true,
      documentTypeValues: [],
      parentPathLevels: true,
      alternateColumnGroups: [],
      followingRowAlternateColumn: '',
      includeInsideCellAlternatesWithFollowingRows: true,
      followingItemRowsContextColumn: '',
      followingItemRowsItemColumn: '',
      followingItemRowsMpnColumn: '',
      followingItemRowsManufacturerColumn: '',
      followingItemRowsCpnMode: 'primary',
    });
    setNormalizedRows([]);
    setCurrentStep(0);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setDelimiterTouched(false);
    setParserTouched(false);
    setSkipSourceSetupForMerge(false);
    setNormalizationSummary(null);
    setConfirmOpen(false);
    setLowConfidenceOnly(false);
    setFactwiseDialogOpen(false);
    setTagDialogOpen(false);
    setManufacturerMatchOpen(false);
    setMergeStage('preview');
    setError('');
  }, [handleReset, location.state, mergePreview, navigate]);

  // Changing the source or parser settings invalidates any previous run. Skipped
  // while a restore is applying: that path sets roles/config and currentStep in the
  // same batch, so this effect would observe the new config with currentStep still
  // at 0 and wipe the rows it had just restored.
  useEffect(() => {
    if (currentStep === 4 || restoreInFlightRef.current) return;
    setNormalizedRows([]);
    setPairingReviewOpen(false);
    setPairingReviewRows([]);
    setPendingNormalization(null);
    setLowConfidenceOnly(false);
  }, [roles, config, headerRowIndex, sheetName, sheetScope, selectedSheetNames, currentStep]);

  useEffect(() => {
    if (!manufacturerMatchOpen) return;
    setSelectedManufacturerMatches(manufacturerMatchPreview.map((match) => match.key));
  }, [manufacturerMatchOpen, manufacturerMatchPreview]);

  useEffect(() => {
    if (currentStep === 4) return;
    if (parserTouched) return;
    setConfig((prev) => {
      const nextStructure = detectBestStructure(headers, roles, dataRows.slice(0, 40));
      const followingMfgPartsLayout = detectFollowingRowMfgPartsLayout(headers, dataRows.slice(0, 120), roles);
      if (
        nextStructure === prev.structure &&
        (!followingMfgPartsLayout ||
          (prev.alternateLayout === 'following_rows' && prev.followingRowAlternateColumn === followingMfgPartsLayout.mfgPartsHeader))
      ) {
        return prev;
      }
      return nextConfigForDetectedStructure(prev, nextStructure, {
        headers,
        rows: dataRows.slice(0, 120),
        roles,
      });
    });
  }, [currentStep, dataRows, headers, parserTouched, roles]);

  useEffect(() => {
    if (currentStep === 4) return;
    if (!availableStructureOptions.length) return;
    if (availableStructureOptions.some((option) => option.value === config.structure)) return;
    setConfig((prev) => ({ ...prev, structure: availableStructureOptions[0].value }));
  }, [availableStructureOptions, config.structure, currentStep]);

  useEffect(() => {
    if (currentStep === 4 || parserTouched) return;
    const followingMfgPartsLayout = detectFollowingRowMfgPartsLayout(headers, dataRows.slice(0, 120), roles);
    if (!followingMfgPartsLayout) return;
    if (
      roles.mpn === followingMfgPartsLayout.mfgPartsHeader &&
      roles.manufacturer === followingMfgPartsLayout.mfgPartsHeader &&
      config.structure === 'grouped_rows' &&
      config.alternateLayout === 'following_rows' &&
      config.followingRowAlternateColumn === followingMfgPartsLayout.mfgPartsHeader
    ) {
      return;
    }
    setRoles((prev) => ({
      ...prev,
      mpn: followingMfgPartsLayout.mfgPartsHeader,
      manufacturer: followingMfgPartsLayout.mfgPartsHeader,
    }));
    setConfig((prev) => ({
      ...prev,
      structure: 'grouped_rows',
      alternateLayout: 'following_rows',
      followingRowAlternateColumn: followingMfgPartsLayout.mfgPartsHeader,
      manufacturerMode: 'never',
      quantityMode: 'inherit_primary',
      delimiterMode: 'auto',
    }));
  }, [config.alternateLayout, config.followingRowAlternateColumn, config.structure, currentStep, dataRows, headers, parserTouched, roles]);

  useEffect(() => {
    if (combineError.includes('two') && !canPrepareMerge) {
      setCombineError('');
    }
  }, [canPrepareMerge, combineError]);

  useEffect(() => {
    if (currentStep === 4) return;
    if (detectFollowingRowMfgPartsLayout(headers, dataRows.slice(0, 120), roles)) return;
    const strongMpnHeader = findStrongMpnHeader(headers);
    if (!strongMpnHeader || roles.mpn === strongMpnHeader) return;
    if (!roles.mpn || isGenericPartHeader(roles.mpn) || roles.mpn === roles.cpn) {
      setRoles((prev) => ({ ...prev, mpn: strongMpnHeader }));
      rememberRoleHeader('mpn', strongMpnHeader);
    }
  }, [currentStep, headers, roles.cpn, roles.mpn]);

  useEffect(() => {
    if (currentStep === 4) return;
    if (detectFollowingRowMfgPartsLayout(headers, dataRows.slice(0, 120), roles)) return;
    if (delimiterTouched || (!roles.mpn && !roles.manufacturer)) return;
    const guessedDelimiter = guessDelimiter(dataRows, roles);
    setConfig((prev) => (
      prev.delimiterMode === guessedDelimiter ? prev : { ...prev, delimiterMode: guessedDelimiter }
    ));
  }, [currentStep, dataRows, delimiterTouched, headers, roles]);

  useEffect(() => {
    if (currentStep === 4) return;
    if (parserTouched) return;
    if (!roles.mpn || !dataRows.length) return;
    if (detectFollowingRowMfgPartsLayout(headers, dataRows.slice(0, 120), roles)) return;
    const sampleValues = dataRows.slice(0, 80).map((row) => getCell(row, roles.mpn)).filter(Boolean);
    const multiMpnCount = sampleValues.filter((value) => splitMpnCell(value, config).length > 1).length;
    if (!multiMpnCount) return;

    setConfig((prev) => {
      if (prev.structure === 'separate_cells' && prev.alternateLayout === 'inside_selected_mpn_columns') return prev;
      return {
        ...prev,
        structure: 'separate_cells',
        alternateLayout: 'inside_selected_mpn_columns',
      };
    });
  }, [config, currentStep, dataRows, headers, parserTouched, roles]);

  const autoReplayTemplate = location.state?.autoReplayProcessingTemplate || null;
  if (autoReplayTemplate) {
    const replayName = autoReplayTemplate.name || 'selected template';
    const progressTotal = Number(progress.total || 0);
    const progressValue = progressTotal
      ? Math.min(100, Math.round((Number(progress.processed || 0) / progressTotal) * 100))
      : 35;

    return (
      <Box
        sx={{
          minHeight: '100vh',
          bgcolor: normalizerTheme.page,
          color: normalizerTheme.text,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 2,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            width: 'min(520px, 100%)',
            p: { xs: 3, sm: 4 },
            border: `1px solid ${normalizerTheme.border}`,
            borderRadius: 3,
            bgcolor: `${normalizerTheme.paper} !important`,
            color: `${normalizerTheme.text} !important`,
            boxShadow: isDarkMode ? '0 24px 80px rgba(0,0,0,0.42)' : '0 24px 80px rgba(15,23,42,0.12)',
          }}
        >
          <Stack spacing={2.25}>
            <Box>
              <Typography variant="h5" fontWeight={900} sx={{ color: normalizerTheme.text }}>
                Applying template
              </Typography>
              <Typography sx={{ mt: 0.75, color: normalizerTheme.muted, lineHeight: 1.5 }}>
                Preparing the workbook with "{replayName}" and opening the final mapped data.
              </Typography>
            </Box>

            {error ? (
              <Alert severity="error">
                {error}
              </Alert>
            ) : (
              <>
                <LinearProgress
                  variant={progressTotal ? 'determinate' : 'indeterminate'}
                  value={progressValue}
                  sx={{
                    height: 8,
                    borderRadius: 999,
                    bgcolor: isDarkMode ? 'rgba(148, 163, 184, 0.18)' : '#e2e8f0',
                  }}
                />
                <Typography variant="body2" sx={{ color: normalizerTheme.muted }}>
                  Running saved normalization, mapping, and final-page tool rules in order.
                </Typography>
              </>
            )}

            {error && (
              <Stack direction="row" justifyContent="flex-end">
                <Button variant="contained" onClick={() => navigate('/upload')}>
                  Back to Upload
                </Button>
              </Stack>
            )}
          </Stack>
        </Paper>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        position: 'relative',
        isolation: 'isolate',
        overflow: 'hidden',
        bgcolor: normalizerTheme.page,
        color: normalizerTheme.text,
        '& .MuiPaper-root, & .MuiCard-root': {
          background: `${normalizerTheme.panelGradient} !important`,
          color: `${normalizerTheme.text} !important`,
          borderColor: `${normalizerTheme.border} !important`,
          borderRadius: '8px',
          boxShadow: isDarkMode
            ? '0 18px 48px -34px rgba(0, 0, 0, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.04)'
            : '0 18px 44px -34px rgba(15, 23, 42, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.84)',
        },
        '& .MuiTableContainer-root': {
          bgcolor: `${normalizerTheme.table} !important`,
          borderColor: `${normalizerTheme.border} !important`,
          borderRadius: '8px',
        },
        '& .MuiTableCell-root': {
          color: `${normalizerTheme.text} !important`,
          borderColor: `${normalizerTheme.border} !important`,
        },
        '& .MuiTableHead-root .MuiTableCell-root': {
          bgcolor: `${normalizerTheme.tableHeader} !important`,
        },
        '& table': {
          backgroundColor: `${normalizerTheme.table} !important`,
        },
        '& th': {
          backgroundColor: `${normalizerTheme.tableHeader} !important`,
          color: `${normalizerTheme.text} !important`,
          borderColor: `${normalizerTheme.border} !important`,
        },
        '& td': {
          color: `${normalizerTheme.text} !important`,
          borderColor: `${normalizerTheme.border} !important`,
        },
        '& table input': {
          color: `${normalizerTheme.text} !important`,
          caretColor: normalizerTheme.text,
        },
        '& table input:focus': {
          backgroundColor: `${normalizerTheme.paperSoft} !important`,
        },
        '& .MuiInputBase-root': {
          color: normalizerTheme.text,
          borderRadius: '8px',
          backgroundColor: isDarkMode ? 'rgba(15, 23, 42, 0.42)' : 'rgba(255, 255, 255, 0.8)',
        },
        '& .MuiInputLabel-root, & .MuiFormHelperText-root, & .MuiStepLabel-label': {
          color: `${normalizerTheme.muted} !important`,
        },
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: `${normalizerTheme.borderStrong} !important`,
        },
        '& .MuiButton-root': {
          borderRadius: '999px',
          minHeight: 34,
          px: 1.8,
          fontSize: 12,
          fontWeight: 800,
          textTransform: 'none',
          transition: 'transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease',
        },
        '& .MuiButton-root:hover': {
          transform: 'translateY(-1px)',
        },
        '& .MuiButton-contained': {
          background: 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%) !important',
          boxShadow: '0 12px 24px -14px rgba(37, 99, 235, 0.82), inset 0 1px 0 rgba(255, 255, 255, 0.28)',
        },
        '& .MuiButton-contained:hover': {
          background: 'linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%) !important',
          boxShadow: '0 16px 30px -16px rgba(37, 99, 235, 0.95), inset 0 1px 0 rgba(255, 255, 255, 0.38)',
        },
        '& .MuiButton-outlined': {
          color: `${isDarkMode ? '#dbeafe' : '#1d4ed8'} !important`,
          borderColor: `${isDarkMode ? 'rgba(96, 165, 250, 0.32)' : 'rgba(37, 99, 235, 0.32)'} !important`,
          background: `${isDarkMode ? 'rgba(15, 23, 42, 0.52)' : 'rgba(255, 255, 255, 0.82)'} !important`,
        },
        '& .MuiButton-outlined:hover': {
          borderColor: `${isDarkMode ? 'rgba(96, 165, 250, 0.7)' : 'rgba(37, 99, 235, 0.72)'} !important`,
          background: `${isDarkMode ? 'rgba(37, 99, 235, 0.14)' : 'rgba(239, 246, 255, 0.96)'} !important`,
          boxShadow: isDarkMode ? '0 12px 26px -18px rgba(37, 99, 235, 0.9)' : '0 12px 24px -18px rgba(37, 99, 235, 0.42)',
        },
        '& .MuiButton-root.Mui-disabled': {
          transform: 'none',
          opacity: 0.56,
          boxShadow: 'none',
        },
        '& .MuiChip-root': {
          borderRadius: '999px',
          fontWeight: 800,
        },
      }}
    >
      <Box
        sx={{
          pointerEvents: 'none',
          position: 'fixed',
          width: '62vw',
          height: '62vw',
          minWidth: 520,
          minHeight: 520,
          left: `${mousePos.x}%`,
          top: `${mousePos.y}%`,
          transform: 'translate(-50%, -50%)',
          borderRadius: '50%',
          filter: 'blur(90px)',
          opacity: isDarkMode ? 0.26 : 0.18,
          background: 'radial-gradient(circle, var(--color-brand, #2383e2) 0%, transparent 70%)',
          transition: 'left 0.7s cubic-bezier(0.16, 1, 0.3, 1), top 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
          zIndex: 0,
        }}
      />
      <Box className="auth-grid-pattern" sx={{ position: 'fixed', inset: 0, pointerEvents: 'none', opacity: isDarkMode ? 0.36 : 0.28, zIndex: 0 }} />

      <Box sx={{ position: 'relative', zIndex: 1, px: { xs: 2, lg: 4 }, py: 2.5, borderBottom: `1px solid ${normalizerTheme.border}`, bgcolor: normalizerTheme.header, backdropFilter: 'blur(18px) saturate(170%)' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'flex-start', md: 'center' }} justifyContent="space-between" gap={2}>
          <Box>
            <Typography sx={{ fontSize: 24, fontWeight: 800, color: normalizerTheme.text }}>BOM Normalizer</Typography>
            <Typography sx={{ mt: 0.4, fontSize: 13, color: normalizerTheme.muted }}>
              Prototype workbench for turning messy BOM sheets into a normalized MPN/MFR/alternate table.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ position: 'relative', zIndex: 1, px: { xs: 2, lg: 4 }, py: 3 }}>
        <Stepper activeStep={displayedStep} alternativeLabel sx={{ mb: 3 }}>
          {['Upload', 'Source', 'Configure', 'Results'].map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {busy && (
          <Paper elevation={0} sx={{ mb: 2, p: 1.5, border: `1px solid ${normalizerTheme.border}`, bgcolor: normalizerTheme.paper }}>
            <Typography sx={{ mb: 1, fontSize: 13, fontWeight: 700 }}>
              Processing workbook{progress.total ? `: ${progress.processed}/${progress.total} rows, ${progress.outputRows} output rows, ${progress.skippedRows || 0} skipped` : '...'}
            </Typography>
            <LinearProgress
              variant={progress.total ? 'determinate' : 'indeterminate'}
              value={progress.total ? Math.round((progress.processed / progress.total) * 100) : undefined}
            />
          </Paper>
        )}

        {!workbook ? (
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Paper elevation={0} sx={{ border: `1px solid ${normalizerTheme.border}`, bgcolor: normalizerTheme.paper, p: 3 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" gap={1}>
                  <Box>
                    <Typography sx={{ fontSize: 20, fontWeight: 800, color: normalizerTheme.text }}>{sourcePanelTitle}</Typography>
                    <Typography sx={{ mt: 0.8, color: normalizerTheme.muted, fontSize: 14 }}>
                      {sourcePanelDescription}
                    </Typography>
                  </Box>
                  <Button component="label" variant="outlined" startIcon={<CloudUploadIcon />} disabled={busy || combineBusy}>
                    {combineItems.length ? 'Add source' : 'Choose source'}
                    <input hidden multiple type="file" accept=".xlsx,.xls,.xlsm,.csv,.pdf" onChange={handleCombineFilesChange} />
                  </Button>
                </Stack>

                {combineError && <Alert severity="error" sx={{ mt: 2 }}>{combineError}</Alert>}
                {mergeChainMessage && <Alert severity="info" sx={{ mt: 2 }}>{mergeChainMessage}</Alert>}

                {combineItems.length > 0 ? (
                  <Stack spacing={1.25} sx={{ mt: 2 }}>
                    {mergeStage === 'sources' && (
                      <>
                        {combineItems.map((item) => (
                          <Paper key={item.id} elevation={0} sx={{ p: 1.25, border: `1px solid ${normalizerTheme.border}`, bgcolor: normalizerTheme.paperSoft }}>
                            <Stack direction="row" alignItems="center" gap={1}>
                              <Box sx={{ minWidth: 0, flex: 1 }}>
                                <Typography sx={{ fontSize: 13.5, fontWeight: 800, wordBreak: 'break-word' }}>{item.fileName}</Typography>
                                <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mt: 0.5 }}>
                                  <Chip size="small" label={item.type.toUpperCase()} />
                                  <Chip size="small" label={item.status} />
                                  {item.workbook?.SheetNames?.length > 0 && <Chip size="small" label={`${item.workbook.SheetNames.length} sheet${item.workbook.SheetNames.length === 1 ? '' : 's'}`} />}
                                  {item.rowCount > 0 && <Chip size="small" label={`${item.rowCount} rows`} />}
                                </Stack>
                              </Box>
                              <IconButton size="small" onClick={() => removeCombineItem(item.id)} disabled={combineBusy}>
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </Stack>
                            {item.error && <Alert severity="warning" sx={{ mt: 1 }}>{item.error}</Alert>}
                          </Paper>
                        ))}

                        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1} sx={{ pt: 0.5 }}>
                          <Button variant="outlined" onClick={() => {
                            setCombineItems([]);
                            setCombineError('');
                            setMergeChainMessage('');
                            setMergeSources([]);
                            setMergePreview(null);
                            setMergePreviewSearch('');
                            setMergeStage('sources');
                          }} disabled={combineBusy}>
                            Clear
                          </Button>
                          <Stack direction="row" gap={1} justifyContent="flex-end" flexWrap="wrap">
                            {canUseWithoutMerge && (
                              <Button variant="outlined" onClick={handleUseSourceWithoutMerge} disabled={combineBusy}>
                                Use without merge
                              </Button>
                            )}
                            <Button variant="contained" onClick={handlePrepareMergeSources} disabled={combineBusy || !canPrepareMerge}>
                              Prepare merge setup
                            </Button>
                          </Stack>
                        </Stack>
                        {!canPrepareMerge && (
                          <Typography sx={{ mt: 0.5, fontSize: 12.5, color: normalizerTheme.muted, textAlign: { xs: 'left', sm: 'right' } }}>
                            Add another source or use this source without merging.
                          </Typography>
                        )}
                      </>
                    )}

                    {combineBusy && <LinearProgress />}

                    {mergeStage === 'match' && (
                      <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e1e6ec', bgcolor: '#fbfcfd' }}>
                        <Typography sx={{ fontSize: 14, fontWeight: 800, mb: 1.5 }}>Match primary and secondary sources</Typography>
                        <Grid container spacing={1.5}>
                          <Grid item xs={12} md={6}>
                            <FormControl fullWidth size="small">
                              <InputLabel>Primary source</InputLabel>
                              <Select
                                label="Primary source"
                                value={mergeConfig.primarySourceId}
                                onChange={(event) => {
                                  const source = mergeSources.find((item) => item.id === event.target.value);
                                  setMergeConfig((prev) => ({
                                    ...prev,
                                    primarySourceId: event.target.value,
                                    primaryKey: source ? guessKeyColumn(source.headers) : '',
                                    secondarySourceId: prev.secondarySourceId === event.target.value ? '' : prev.secondarySourceId,
                                  }));
                                  if (source && source.id === mergeConfig.secondarySourceId) {
                                    setMergeConfig((prev) => ({ ...prev, secondarySourceId: '' }));
                                  }
                                }}
                              >
                                {mergeSources.map((source) => (
                                  <MenuItem key={source.id} value={source.id}>{source.label}</MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <FormControl fullWidth size="small">
                              <InputLabel>Secondary source</InputLabel>
                              <Select
                                label="Secondary source"
                                value={mergeConfig.secondarySourceId}
                                onChange={(event) => {
                                  const source = mergeSources.find((item) => item.id === event.target.value);
                                  const secondaryKey = source ? guessKeyColumn(source.headers) : '';
                                  setMergeConfig((prev) => ({
                                    ...prev,
                                    secondarySourceId: event.target.value,
                                    secondaryKey,
                                    detailColumns: source ? defaultMergeDetailColumns(source.headers, secondaryKey) : [],
                                  }));
                                }}
                              >
                                {mergeSources
                                  .filter((source) => source.id !== mergeConfig.primarySourceId)
                                  .map((source) => (
                                    <MenuItem key={source.id} value={source.id}>{source.label}</MenuItem>
                                  ))}
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <FormControl fullWidth size="small">
                              <InputLabel>Common column to match on</InputLabel>
                              <Select
                                label="Common column to match on"
                                value={mergeConfig.primaryKey}
                                onChange={(event) => setMergeConfig((prev) => ({ ...prev, primaryKey: event.target.value }))}
                              >
                                {(mergePrimarySource?.headers || []).map((header) => (
                                  <MenuItem key={header} value={header}>{header}</MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <FormControl fullWidth size="small">
                              <InputLabel>Matching column in secondary source</InputLabel>
                              <Select
                                label="Matching column in secondary source"
                                value={mergeConfig.secondaryKey}
                                onChange={(event) => setMergeConfig((prev) => ({
                                  ...prev,
                                  secondaryKey: event.target.value,
                                  detailColumns: prev.detailColumns.filter((column) => column !== event.target.value),
                                }))}
                              >
                                {(mergeSecondarySource?.headers || []).map((header) => (
                                  <MenuItem key={header} value={header}>{header}</MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          </Grid>
                        </Grid>
                        <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
                          <Button variant="outlined" onClick={() => setMergeStage('sources')}>Back</Button>
                          <Button
                            variant="contained"
                            onClick={() => setMergeStage('options')}
                            disabled={!mergeConfig.primaryKey || !mergeConfig.secondaryKey || !mergeConfig.primarySourceId || !mergeConfig.secondarySourceId}
                          >
                            Proceed
                          </Button>
                        </Stack>
                      </Paper>
                    )}

                    {mergeStage === 'options' && (
                      <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e1e6ec', bgcolor: '#fbfcfd' }}>
                        <Grid container spacing={1.5}>
                          <Grid item xs={12}>
                            <TextField
                              fullWidth
                              size="small"
                              label="Merged column name"
                              value={mergeConfig.relationshipName}
                              onChange={(event) => setMergeConfig((prev) => ({ ...prev, relationshipName: event.target.value }))}
                              helperText="Used when one secondary column is grouped into a single new column."
                            />
                          </Grid>
                          <Grid item xs={12}>
                            <Typography sx={{ fontSize: 13, fontWeight: 800, mb: 0.5 }}>Output format</Typography>
                            <RadioGroup
                              row
                              value={mergeConfig.outputMode}
                              onChange={(event) => setMergeConfig((prev) => ({ ...prev, outputMode: event.target.value }))}
                            >
                              <FormControlLabel value="grouped" control={<Radio size="small" />} label={`Add all related ${mergeSecondaryLabel} in the same cell`} />
                              <FormControlLabel value="expanded" control={<Radio size="small" />} label={`Create a separate row for each ${mergeSecondaryLabel}`} />
                            </RadioGroup>
                          </Grid>
                          <Grid item xs={12}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                              <Typography sx={{ fontSize: 13, fontWeight: 800 }}>Columns to bring from secondary source</Typography>
                              <Stack direction="row" gap={0.5}>
                                <Button size="small" onClick={() => setMergeConfig((prev) => ({
                                  ...prev,
                                  detailColumns: (mergeSecondarySource?.headers || []).filter((header) => header !== prev.secondaryKey),
                                }))}>
                                  Select all
                                </Button>
                                <Button size="small" onClick={() => setMergeConfig((prev) => ({ ...prev, detailColumns: [] }))}>
                                  Clear
                                </Button>
                              </Stack>
                            </Stack>
                            <FormGroup row sx={{ mt: 0.5, gap: 0.5 }}>
                              {(mergeSecondarySource?.headers || [])
                                .filter((header) => header !== mergeConfig.secondaryKey)
                                .map((header) => (
                                  <FormControlLabel
                                    key={header}
                                    control={
                                      <Checkbox
                                        size="small"
                                        checked={mergeConfig.detailColumns.includes(header)}
                                        onChange={(event) => setMergeConfig((prev) => ({
                                          ...prev,
                                          detailColumns: event.target.checked
                                            ? [...new Set([...prev.detailColumns, header])]
                                            : prev.detailColumns.filter((column) => column !== header),
                                        }))}
                                      />
                                    }
                                    label={header}
                                  />
                                ))}
                            </FormGroup>
                          </Grid>
                        </Grid>
                        <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
                          <Button variant="outlined" onClick={() => setMergeStage('match')}>Back</Button>
                          <Button variant="contained" onClick={handleBuildMergePreview} disabled={!mergeConfig.detailColumns.length}>Preview</Button>
                        </Stack>
                      </Paper>
                    )}

                    {mergeStage === 'preview' && mergePreview && (
                      <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e1e6ec', bgcolor: '#fbfcfd' }}>
                        <Grid container spacing={1} sx={{ mb: 1.5 }}>
                          <Grid item xs={6} md={3}>
                            <Chip
                              clickable
                              label={`${mergePreview.summary.outputRows} output rows`}
                              color={mergePreviewFilter === 'all' ? 'primary' : 'default'}
                              variant={mergePreviewFilter === 'all' ? 'filled' : 'outlined'}
                              onClick={() => { setMergePreviewFilter('all'); setMergePreviewPage(0); }}
                            />
                          </Grid>
                          <Grid item xs={6} md={3}>
                            <Chip
                              clickable
                              color="success"
                              label={`${mergePreview.summary.matchedPrimaryRows} matched`}
                              variant={mergePreviewFilter === 'matched' ? 'filled' : 'outlined'}
                              onClick={() => { setMergePreviewFilter('matched'); setMergePreviewPage(0); }}
                            />
                          </Grid>
                          <Grid item xs={6} md={3}>
                            <Chip
                              clickable
                              color="warning"
                              label={`${mergePreview.summary.unmatchedPrimaryRows} unmatched`}
                              variant={mergePreviewFilter === 'unmatched' ? 'filled' : 'outlined'}
                              onClick={() => { setMergePreviewFilter('unmatched'); setMergePreviewPage(0); }}
                            />
                          </Grid>
                          <Grid item xs={6} md={3}>
                            <Chip label={`${mergePreview.summary.secondaryOnlyKeys} secondary-only keys`} />
                          </Grid>
                        </Grid>
                        <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between" gap={1} sx={{ mb: 1 }}>
                          <Button size="small" variant="outlined" disabled={mergePreviewPage === 0} onClick={() => setMergePreviewPage((page) => Math.max(0, page - 1))}>
                            Previous
                          </Button>
                          <Typography sx={{ fontSize: 13, color: '#66717f' }}>
                            Showing {visibleMergePreviewRows.length ? mergePreviewStart + 1 : 0}-{Math.min(mergePreviewStart + visibleMergePreviewRows.length, mergeFilteredPreviewRows.length)} of {mergeFilteredPreviewRows.length}
                          </Typography>
                          <TextField
                            size="small"
                            value={mergePreviewSearch}
                            onChange={(event) => {
                              setMergePreviewSearch(event.target.value);
                              setMergePreviewPage(0);
                            }}
                            placeholder="Search merged rows..."
                            sx={{ minWidth: { xs: '100%', md: 260 } }}
                          />
                          <FormControl size="small" sx={{ minWidth: 230 }}>
                            <InputLabel>Columns to keep</InputLabel>
                            <Select
                              multiple
                              label="Columns to keep"
                              value={mergeVisibleColumns}
                              renderValue={(selected) => `${selected.length} columns kept`}
                              onChange={(event) => {
                                const selected = (typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value)
                                  .filter((column) => column !== '__all__');
                                setMergeVisibleColumns(selected);
                              }}
                            >
                              <MenuItem
                                value="__all__"
                                onClick={(event) => {
                                  event.preventDefault();
                                  setMergeVisibleColumns(mergePreview.headers);
                                }}
                              >
                                <Checkbox checked={mergeVisibleColumns.length === mergePreview.headers.length} />
                                <ListItemText primary="Keep all columns" />
                              </MenuItem>
                              {mergePreview.headers.map((header) => (
                                <MenuItem key={header} value={header}>
                                  <Checkbox checked={mergeVisibleColumns.includes(header)} />
                                  <ListItemText primary={header} />
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          <Button size="small" variant="outlined" disabled={mergePreviewPage >= mergePreviewTotalPages - 1} onClick={() => setMergePreviewPage((page) => Math.min(mergePreviewTotalPages - 1, page + 1))}>
                            Next
                          </Button>
                        </Stack>
                        <Box sx={{ height: { xs: 430, md: 'calc(100vh - 390px)' }, minHeight: 430, overflow: 'auto', border: `1px solid ${normalizerTheme.border}`, bgcolor: normalizerTheme.table }}>
                          <Box component="table" sx={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', bgcolor: normalizerTheme.table, '& th, & td': { borderBottom: `1px solid ${normalizerTheme.border}`, p: 0.75, color: normalizerTheme.text }, '& th': { position: 'sticky', top: 0, backgroundColor: normalizerTheme.tableHeader, zIndex: 1, textAlign: 'left' } }}>
                            <Box component="thead">
                              <Box component="tr">
                                {visibleMergePreviewColumns.map((header) => (
                                  <Box component="th" key={header} sx={{ width: mergeColumnWidths[header] || 180, minWidth: mergeColumnWidths[header] || 180, maxWidth: mergeColumnWidths[header] || 180, position: 'relative', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pr: 2, color: normalizerTheme.text, bgcolor: normalizerTheme.tableHeader }}>
                                    {header}
                                    <Box onMouseDown={(event) => handleMergeColumnResize(header, event)} sx={{ position: 'absolute', top: 0, right: 0, width: 8, height: '100%', cursor: 'col-resize', '&:hover': { borderRight: '2px solid #1976d2' } }} />
                                  </Box>
                                ))}
                              </Box>
                            </Box>
                            <Box component="tbody">
                              {visibleMergePreviewRows.map(({ row, index: rowIndex }) => (
                                <Box component="tr" key={`merge-preview-${rowIndex}`}>
                                  {visibleMergePreviewColumns.map((header) => (
                                    <Box component="td" key={`${rowIndex}-${header}`} sx={{ width: mergeColumnWidths[header] || 180, minWidth: mergeColumnWidths[header] || 180, maxWidth: mergeColumnWidths[header] || 180 }}>
                                      <Box
                                        component="input"
                                        value={row[header] ?? ''}
                                        onChange={(event) => handleMergePreviewCellChange(rowIndex, header, event.target.value)}
                                        sx={{ width: '100%', border: 'none', outline: 'none', backgroundColor: 'transparent', color: normalizerTheme.text, caretColor: normalizerTheme.text, font: 'inherit', p: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', '&:focus': { bgcolor: normalizerTheme.paperSoft } }}
                                      />
                                    </Box>
                                  ))}
                                </Box>
                              ))}
                            </Box>
                          </Box>
                        </Box>
                        <Stack direction="row" justifyContent="space-between" gap={1} sx={{ mt: 1.5 }}>
                          <Button variant="outlined" onClick={() => setMergeStage('options')}>Back</Button>
                          <Stack direction="row" gap={1} flexWrap="wrap" justifyContent="flex-end">
                            <Button variant="outlined" onClick={() => handleContinueMergePreviewToBomMapping()}>Continue</Button>
                            <Button variant="contained" onClick={handleUseMergePreview}>Continue with normalizer</Button>
                          </Stack>
                        </Stack>
                      </Paper>
                    )}
                  </Stack>
                ) : (
                  <Paper elevation={0} sx={{ mt: 2, p: 2, border: '1px dashed #c7d0da', bgcolor: '#fbfcfd' }}>
                    <Typography sx={{ fontSize: 13.5, color: '#66717f' }}>
                      Choose a source to start. After upload, you can continue directly or prepare a merge.
                    </Typography>
                  </Paper>
                )}
              </Paper>
            </Grid>
          </Grid>
        ) : (
          <Stack spacing={2.5}>
            {currentStep === 1 && (
              <Paper elevation={0} sx={{ p: 2.5, border: '1px solid #dce2e8' }}>
                <Typography sx={{ fontSize: 18, fontWeight: 800 }}>Source setup</Typography>
                <Typography sx={{ mt: 0.5, fontSize: 13, color: '#66717f', wordBreak: 'break-word' }}>{fileName}</Typography>
                {workbook.SheetNames.length > 1 && (
                  <Alert severity="info" sx={{ mt: 1.5 }}>
                    This workbook has {workbook.SheetNames.length} sheets. Choose one sheet, selected sheets, or all sheets before continuing.
                  </Alert>
                )}
                {multiBlockSummary && (
                  <Alert severity="success" sx={{ mt: 1.5 }}>
                    Detected {multiBlockSummary.blockCount} linked BOM table{multiBlockSummary.blockCount === 1 ? '' : 's'}
                    {multiBlockSummary.sheetCount ? ` across ${multiBlockSummary.sheetCount} sheet${multiBlockSummary.sheetCount === 1 ? '' : 's'}` : ''}.
                    The normalizer will connect same-sheet and cross-sheet assembly blocks by matching part codes.
                  </Alert>
                )}
                <Grid container spacing={1.5} sx={{ mt: 1 }}>
                  <Grid item xs={12} md={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Sheet selection</InputLabel>
                      <Select value={sheetScope} label="Sheet selection" onChange={(event) => handleSheetScopeChange(event.target.value)}>
                        <MenuItem value="single">Use one sheet</MenuItem>
                        <MenuItem value="selected" disabled={workbook.SheetNames.length <= 1}>Use selected sheets</MenuItem>
                        <MenuItem value="all" disabled={workbook.SheetNames.length <= 1}>Use all sheets</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>

                  {sheetScope === 'single' && (
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Sheet</InputLabel>
                        <Select value={sheetName} label="Sheet" onChange={(event) => handleSheetChange(event.target.value)}>
                          {workbook.SheetNames.map((name) => (
                            <MenuItem key={name} value={name}>{name}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  )}

                  {sheetScope === 'selected' && (
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Sheets</InputLabel>
                        <Select
                          multiple
                          value={selectedSheetNames}
                          label="Sheets"
                          renderValue={(selected) => selected.join(', ')}
                          onChange={(event) => handleSelectedSheetsChange(event.target.value)}
                        >
                        {workbook.SheetNames.map((name) => (
                            <MenuItem key={name} value={name}>
                              <Checkbox checked={selectedSheetNames.includes(name)} />
                              <ListItemText primary={name} />
                            </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  )}

                  {sheetScope === 'all' && (
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Sheets included"
                        value={selectedSheetNames.join(', ')}
                        InputProps={{ readOnly: true }}
                      />
                    </Grid>
                  )}

                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      label="Header row"
                      value={sheetScope === 'single' ? headerRowIndex + 1 : sheetHeaderRowOverride}
                      placeholder={sheetScope === 'single' ? '' : 'Auto'}
                      inputProps={sheetScope === 'single'
                        ? { min: 1, max: Math.max(sheetRows.length, 1) }
                        : { min: 1 }}
                      helperText={sheetScope === 'single'
                        ? ''
                        : sheetHeaderRowOverride
                          ? 'Applied to every selected sheet. Clear it to auto-detect each sheet.'
                          : 'Header row is auto-detected separately for each selected sheet.'}
                      onChange={(event) => handleHeaderRowChange(event.target.value)}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      label="Include data until row"
                      value={sourceEndRow}
                      inputProps={{ min: headerRowIndex + 2, max: Math.max(sheetRows.length, headerRowIndex + 2) }}
                      helperText="Optional. Leave blank to include all detected data rows."
                      onChange={(event) => {
                        setSourceEndRow(event.target.value);
                        setNormalizedRows([]);
                        setNormalizationSummary(null);
                      }}
                    />
                  </Grid>

                  {showAssemblyQuantityVariantSelector && (
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Quantity variant</InputLabel>
                        <Select
                          value={config.quantityVariant || QUANTITY_VARIANT_ALL}
                          label="Quantity variant"
                          onChange={(event) => {
                            setParserTouched(true);
                            setConfig((prev) => ({
                              ...prev,
                              quantityVariant: event.target.value,
                            }));
                            setNormalizedRows([]);
                            setNormalizationSummary(null);
                          }}
                        >
                          <MenuItem value={QUANTITY_VARIANT_ALL}>All variants</MenuItem>
                          {assemblyQuantityVariantOptions.map((variant) => (
                            <MenuItem key={variant} value={variant}>{variant}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  )}

                  {showMultiBlockQuantityVariantSelectors && multiBlockQuantityVariantGroups.map((group) => (
                    <Grid item xs={12} md={6} key={group.key}>
                      <FormControl fullWidth size="small">
                        <InputLabel>{`Quantity variant - ${group.label || 'BOM table'}`}</InputLabel>
                        <Select
                          value={(config.quantityVariantByBlock || {})[group.key] || QUANTITY_VARIANT_ALL}
                          label={`Quantity variant - ${group.label || 'BOM table'}`}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setParserTouched(true);
                            setConfig((prev) => {
                              const nextByBlock = { ...(prev.quantityVariantByBlock || {}) };
                              if (!nextValue || nextValue === QUANTITY_VARIANT_ALL) {
                                delete nextByBlock[group.key];
                              } else {
                                nextByBlock[group.key] = nextValue;
                              }
                              return {
                                ...prev,
                                quantityVariantByBlock: nextByBlock,
                              };
                            });
                            setNormalizedRows([]);
                            setNormalizationSummary(null);
                          }}
                        >
                          <MenuItem value={QUANTITY_VARIANT_ALL}>All variants</MenuItem>
                          {group.variants.map((variant) => (
                            <MenuItem key={`${group.key}-${variant}`} value={variant}>{variant}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  ))}
                </Grid>
                <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1.5 }}>
                  <Chip size="small" label={`${visibleSourceHeaders.length} columns`} />
                  <Chip
                    size="small"
                    label={quantityVariantFilterActive
                      ? `${previewDataRows.length} shown / ${dataRows.length} included rows`
                      : (sourceEndRow ? `${dataRows.length} included / ${sourceDataRows.length} detected rows` : `${dataRows.length} data rows`)}
                  />
                  {multiBlockSummary && <Chip size="small" color="success" variant="outlined" label={`${multiBlockSummary.blockCount} BOM tables`} />}
                  {sourceEndRow && <Chip size="small" color="info" variant="outlined" label={`Using rows through ${sourceEndRow}`} />}
                  {sourceLimitActive && <Chip size="small" color="warning" variant="outlined" label={`${sourceRowsExcludedByLimit} rows excluded`} />}
                  <Chip size="small" label={sheetScope === 'single' ? `Header row ${headerRowIndex + 1}` : `${selectedSheetNames.length} sheets merged`} />
                </Stack>
                <Box sx={{ mt: 2 }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
                    <Typography sx={{ fontWeight: 800 }}>Source preview</Typography>
                    <Button size="small" variant="outlined" startIcon={<VisibilityIcon />} onClick={() => setSourceGridOpen(true)} disabled={!sourceGridRows.length}>
                      View all rows
                    </Button>
                  </Stack>
                  {sourceEndRow && (
                    <Alert severity="info" sx={{ mt: 1, mb: 1.25 }}>
                      Preview is filtered to sheet rows up to {sourceEndRow}. Rows after {sourceEndRow} will be ignored during normalization.
                    </Alert>
                  )}
                  <SourcePreview headers={headers} rows={previewDataRows.slice(0, 8)} assemblyMatrix={sourcePreviewAssemblyMatrix} />
                </Box>
                <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
                  <Button variant="outlined" onClick={handleBackFromSourceSetup} disabled={busy}>Back</Button>
                  <Button variant="contained" onClick={() => setCurrentStep(2)} disabled={busy}>Next: identify columns</Button>
                </Stack>
              </Paper>
            )}

            {currentStep === 2 && (
              <Paper elevation={0} sx={{ p: 2.5, border: '1px solid #dce2e8' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'flex-start' }} gap={1.5}>
                  <Box>
                    <Typography sx={{ fontSize: 18, fontWeight: 800 }}>Configure source columns and parsing</Typography>
                    <Typography sx={{ mt: 0.5, fontSize: 13, color: '#66717f' }}>
                      Pick the important columns first. Parser assumptions update automatically from those choices.
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: { xs: 'flex-start', sm: 'flex-end' }, gap: 1, flexWrap: 'wrap' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<VisibilityIcon />}
                      onClick={() => setSourceGridOpen(true)}
                      disabled={!sourceGridRows.length}
                    >
                      View all rows
                    </Button>
                  </Box>
                </Stack>
                <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1.2 }}>
                  <Chip size="small" label={`${visibleSourceHeaders.length} columns`} />
                  <Chip
                    size="small"
                    label={quantityVariantFilterActive
                      ? `${previewDataRows.length} shown / ${dataRows.length} included rows`
                      : (sourceEndRow ? `${dataRows.length} included / ${sourceDataRows.length} detected rows` : `${dataRows.length} data rows`)}
                  />
                  {multiBlockSummary && <Chip size="small" color="success" variant="outlined" label={`${multiBlockSummary.blockCount} linked BOM tables`} />}
                  {sourceEndRow && <Chip size="small" color="info" variant="outlined" label={`Using rows through ${sourceEndRow}`} />}
                  {sourceLimitActive && <Chip size="small" color="warning" variant="outlined" label={`${sourceRowsExcludedByLimit} rows excluded`} />}
                  <Chip size="small" label={sheetScope === 'single' ? `Header row ${headerRowIndex + 1}` : `${selectedSheetNames.length} sheets merged`} />
                </Stack>
                {multiBlockSummary && (
                  <Alert severity="info" sx={{ mt: 1.25 }}>
                    {config.bomLayout === 'multi_block_assembly'
                      ? 'Multi-block assembly layout is selected. Column mapping is applied to the grouped headers, while each detected table keeps its own source row and sheet context.'
                      : 'Linked BOM tables were detected. Select Multi-block assembly BOM in BOM layout if this workbook should be expanded through those links.'}
                  </Alert>
                )}
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ fontWeight: 800 }}>Source preview</Typography>
                  <SourcePreview headers={headers} rows={previewDataRows.slice(0, 8)} getHeaderLabel={getPreviewHeaderLabel} assemblyMatrix={sourcePreviewAssemblyMatrix} />
                </Box>
                <Grid container spacing={1.5} sx={{ mt: 1 }}>
                  {ROLE_FIELDS.map((field) => {
                    const selectedHeader = roles[field.key] || '';
                    return (
                      <Grid item xs={12} md={6} key={field.key}>
                        <FormControl fullWidth size="small">
                          <InputLabel>{field.label}</InputLabel>
                          <Select
                            value={selectedHeader}
                            label={field.label}
                            renderValue={(selected) => getSourceColumnLabel(selected, field.key)}
                            onChange={(event) => handleRoleChange(field.key, event.target.value)}
                          >
                            <MenuItem value="">None</MenuItem>
                            {visibleSourceHeaders.map((header, columnIndex) => {
                              const isSelected = selectedHeader === header;
                              const columnName = getSourceColumnName(header, columnIndex);
                              const showColumnLabel = Boolean(roleColumnLabelModes[field.key] && columnName);
                              return (
                                <MenuItem key={`${header}-${columnIndex}`} value={header}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', minWidth: 0 }}>
                                    <Box sx={{ minWidth: 0, maxWidth: isSelected && columnName ? '62%' : '100%' }}>
                                      <Typography noWrap sx={{ fontSize: 14, fontWeight: isSelected ? 800 : 600 }}>
                                        {isSelected && showColumnLabel ? `Column ${columnName}` : header}
                                      </Typography>
                                      {isSelected && showColumnLabel && (
                                        <Typography noWrap sx={{ mt: 0.2, fontSize: 11.5, color: normalizerTheme.muted }}>
                                          {header}
                                        </Typography>
                                      )}
                                    </Box>
                                    {isSelected && columnName && (
                                      <Box
                                        onClick={(event) => event.stopPropagation()}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        sx={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 0.55,
                                          flexShrink: 0,
                                          px: 0.75,
                                          py: 0.25,
                                          borderRadius: 999,
                                          border: `1px solid ${normalizerTheme.borderStrong}`,
                                          bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.34)' : 'rgba(248, 250, 252, 0.92)',
                                        }}
                                      >
                                        <Typography sx={{ fontSize: 11, lineHeight: 1, fontWeight: 800, color: normalizerTheme.muted, whiteSpace: 'nowrap' }}>
                                          Column {columnName}
                                        </Typography>
                                        <Switch
                                          size="small"
                                          checked={Boolean(roleColumnLabelModes[field.key])}
                                          onChange={(event) => toggleRoleColumnLabelMode(field.key, event.target.checked)}
                                          sx={{
                                            width: 30,
                                            height: 18,
                                            p: 0,
                                            '& .MuiSwitch-switchBase': {
                                              p: '2px',
                                              '&.Mui-checked': {
                                                transform: 'translateX(12px)',
                                              },
                                            },
                                            '& .MuiSwitch-thumb': {
                                              width: 14,
                                              height: 14,
                                            },
                                            '& .MuiSwitch-track': {
                                              borderRadius: 999,
                                            },
                                          }}
                                        />
                                      </Box>
                                    )}
                                  </Box>
                                </MenuItem>
                              );
                            })}
                          </Select>
                        </FormControl>
                      </Grid>
                    );
                  })}
                </Grid>
                <Paper elevation={0} sx={{ mt: 2, p: 1.5, bgcolor: '#f8fafc', border: '1px solid #e1e6ec' }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 800 }}>Detected setup</Typography>
                  <Typography sx={{ mt: 0.4, fontSize: 13, color: '#536171' }}>{roleCombinationHint}</Typography>
                  <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
                    <Grid item xs={12} md={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Where are MPN and MFR?</InputLabel>
                        <Select
                          disabled={bomLayoutActive}
                          value={config.structure}
                          label="Where are MPN and MFR?"
                          renderValue={(selected) => {
                            const opt = STRUCTURE_OPTIONS.find((o) => o.value === selected);
                            return opt?.label || selected;
                          }}
                          onChange={(event) => {
                            setParserTouched(true);
                            setConfig((prev) => ({
                              ...prev,
                              structure: event.target.value,
                              alternateLayout: ['one_per_row', 'grouped_rows'].includes(event.target.value) ? 'already_separate_rows' : prev.alternateLayout,
                            }));
                          }}
                        >
                          {availableStructureOptions.map((option) => (
                            <MenuItem
                              key={option.value}
                              value={option.value}
                              sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                            >
                              <Box sx={{ flex: 1, minWidth: 0, whiteSpace: 'normal' }}>{option.label}</Box>
                              {option.example && (
                                <OptionExampleTooltip option={option}>
                                  <InfoOutlinedIcon
                                    fontSize="small"
                                    sx={{ color: 'text.secondary', opacity: 0.7, ml: 1, '&:hover': { opacity: 1 } }}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </OptionExampleTooltip>
                              )}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    {showManufacturerInheritanceOption && (
                      <Grid item xs={12} md={3}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Alternate manufacturer</InputLabel>
                          <Select
                            disabled={bomLayoutActive}
                            value={config.manufacturerMode || 'inherit_blank'}
                            label="Alternate manufacturer"
                            onChange={(event) => setConfig((prev) => ({ ...prev, manufacturerMode: event.target.value }))}
                          >
                            {MANUFACTURER_INHERIT_OPTIONS.map((option) => (
                              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>
                    )}
                    <Grid item xs={12} md={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Where are alternates?</InputLabel>
                        <Select
                          disabled={bomLayoutActive}
                          value={config.alternateLayout}
                          label="Where are alternates?"
                          renderValue={(selected) => {
                            const opt = ALTERNATE_LAYOUT_OPTIONS.find((o) => o.value === selected);
                            return opt?.label || selected;
                          }}
                          onChange={(event) => {
                            const nextLayout = event.target.value;
                            setParserTouched(true);
                            setConfig((prev) => ({
                              ...prev,
                              alternateLayout: nextLayout,
                              alternateColumnGroups: nextLayout === 'separate_columns' && !(prev.alternateColumnGroups || []).length
                                ? [suggestAlternateColumnGroup()]
                                : prev.alternateColumnGroups,
                              followingRowAlternateColumn: nextLayout === 'following_rows'
                                ? (prev.followingRowAlternateColumn || roles.level || '')
                                : prev.followingRowAlternateColumn,
                              followingItemRowsItemColumn: nextLayout === 'following_item_rows'
                                ? (prev.followingItemRowsItemColumn || roles.cpn || '')
                                : prev.followingItemRowsItemColumn,
                              followingItemRowsMpnColumn: nextLayout === 'following_item_rows'
                                ? (prev.followingItemRowsMpnColumn || roles.mpn || '')
                                : prev.followingItemRowsMpnColumn,
                              followingItemRowsManufacturerColumn: nextLayout === 'following_item_rows'
                                ? (prev.followingItemRowsManufacturerColumn || roles.manufacturer || '')
                                : prev.followingItemRowsManufacturerColumn,
                              followingItemRowsCpnMode: nextLayout === 'following_item_rows'
                                ? (prev.followingItemRowsCpnMode || 'primary')
                                : prev.followingItemRowsCpnMode,
                            }));
                          }}
                        >
                          {ALTERNATE_LAYOUT_OPTIONS.map((option) => (
                            <MenuItem key={option.value} value={option.value}>
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, width: '100%', minWidth: 0 }}>
                                <Typography noWrap sx={{ fontSize: 14, fontWeight: 700 }}>
                                  {option.label}
                                </Typography>
                                {/* One "i" affordance, two payloads: the worked example when the
                                    option carries one, the plain description otherwise. Both use
                                    the same circled marker so the row looks uniform either way. */}
                                {(option.example || option.description) && (() => {
                                  const marker = (
                                    <Box
                                      component="span"
                                      onClick={(event) => event.stopPropagation()}
                                      onMouseDown={(event) => event.stopPropagation()}
                                      sx={{
                                        width: 18,
                                        height: 18,
                                        borderRadius: '50%',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                        fontSize: 12,
                                        fontWeight: 900,
                                        color: normalizerTheme.muted,
                                        border: `1px solid ${normalizerTheme.borderStrong}`,
                                      }}
                                    >
                                      i
                                    </Box>
                                  );
                                  return option.example ? (
                                    <OptionExampleTooltip option={option}>{marker}</OptionExampleTooltip>
                                  ) : (
                                    <Tooltip title={option.description} placement="right" arrow>
                                      {marker}
                                    </Tooltip>
                                  );
                                })()}
                              </Box>
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    {config.alternateLayout === 'following_rows' && !bomLayoutActive && (
                      <Grid item xs={12} md={3}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Following-row alternate column</InputLabel>
                          <Select
                            value={config.followingRowAlternateColumn || ''}
                            label="Following-row alternate column"
                            onChange={(event) => {
                              setParserTouched(true);
                              setConfig((prev) => ({
                                ...prev,
                                followingRowAlternateColumn: event.target.value,
                              }));
                            }}
                          >
                            <MenuItem value="">Select column</MenuItem>
                            {visibleSourceHeaders.map((header) => (
                              <MenuItem key={header} value={header}>{header}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>
                    )}
                    {config.alternateLayout === 'following_item_rows' && !bomLayoutActive && (
                      <>
                        <Grid item xs={12} md={3}>
                          <FormControl fullWidth size="small">
                            <InputLabel>CPN autofilling rule</InputLabel>
                            <Select
                              value={config.followingItemRowsCpnMode || 'primary'}
                              label="CPN autofilling rule"
                              onChange={(event) => {
                                setParserTouched(true);
                                setConfig((prev) => ({
                                  ...prev,
                                  followingItemRowsCpnMode: event.target.value,
                                }));
                              }}
                            >
                              <MenuItem value="primary">Autofill from primary</MenuItem>
                              <MenuItem value="column">Autofill from CPN column</MenuItem>
                            </Select>
                            <Typography sx={{ mt: 0.35, fontSize: 11.5, color: normalizerTheme.muted }}>
                              Use primary for sparse alternate rows; use CPN column when alternate rows carry their own CPN.
                            </Typography>
                          </FormControl>
                        </Grid>
                        {[
                          ['followingItemRowsMpnColumn', 'MPN column for following rows', 'MPN value from the sparse rows below each main item.'],
                          ['followingItemRowsManufacturerColumn', 'MFR column for following rows', 'Manufacturer value from the sparse rows below each main item.'],
                        ].map(([key, label, helper]) => (
                          <Grid item xs={12} md={3} key={key}>
                            <FormControl fullWidth size="small">
                              <InputLabel>{label}</InputLabel>
                              <Select
                                value={config[key] || ''}
                                label={label}
                                onChange={(event) => {
                                  setParserTouched(true);
                                  setConfig((prev) => ({
                                    ...prev,
                                    [key]: event.target.value,
                                  }));
                                }}
                              >
                                <MenuItem value="">Select column</MenuItem>
                                {visibleSourceHeaders.map((header) => (
                                  <MenuItem key={`${key}-${header}`} value={header}>{header}</MenuItem>
                                ))}
                              </Select>
                              <Typography sx={{ mt: 0.35, fontSize: 11.5, color: normalizerTheme.muted }}>
                                {helper}
                              </Typography>
                            </FormControl>
                          </Grid>
                        ))}
                      </>
                    )}
                    {config.alternateLayout === 'following_rows' && followingRowsInsideCellAlternateInfo && !bomLayoutActive && (
                      <Grid item xs={12} md={3}>
                        <Box
                          sx={{
                            height: '100%',
                            minHeight: 40,
                            display: 'flex',
                            alignItems: 'center',
                            px: 0.5,
                          }}
                        >
                          <FormControlLabel
                            sx={{
                              m: 0,
                              maxWidth: '100%',
                              '& .MuiFormControlLabel-label': {
                                minWidth: 0,
                              },
                            }}
                            control={(
                              <Checkbox
                                size="small"
                                checked={config.includeInsideCellAlternatesWithFollowingRows !== false}
                                onChange={(event) => {
                                  setParserTouched(true);
                                  setConfig((prev) => ({
                                    ...prev,
                                    includeInsideCellAlternatesWithFollowingRows: event.target.checked,
                                  }));
                                }}
                              />
                            )}
                            label={(
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
                                <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 800, color: normalizerTheme.text }}>
                                  Include in-cell alternates
                                </Typography>
                                <Tooltip
                                  arrow
                                  placement="top"
                                  title={`Also split alternates already present inside the selected MPN/MFR cell, then attach alternates from following rows. Detected ${followingRowsInsideCellAlternateInfo.matchedRows} multi-entry row${followingRowsInsideCellAlternateInfo.matchedRows === 1 ? '' : 's'}.`}
                                >
                                  <Box
                                    component="span"
                                    sx={{
                                      width: 17,
                                      height: 17,
                                      borderRadius: '50%',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      flexShrink: 0,
                                      fontSize: 11,
                                      fontWeight: 900,
                                      color: normalizerTheme.muted,
                                      border: `1px solid ${normalizerTheme.borderStrong}`,
                                    }}
                                  >
                                    i
                                  </Box>
                                </Tooltip>
                              </Box>
                            )}
                          />
                        </Box>
                      </Grid>
                    )}
                    <Grid item xs={12} md={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Quantity/UOM handling</InputLabel>
                        <Select
                          disabled={bomLayoutActive}
                          value={config.quantityMode}
                          label="Quantity/UOM handling"
                          renderValue={(selected) => {
                            const opt = QTY_OPTIONS.find((o) => o.value === selected);
                            return opt?.label || selected;
                          }}
                          onChange={(event) => setConfig((prev) => ({ ...prev, quantityMode: event.target.value }))}
                        >
                          {QTY_OPTIONS.map((option) => (
                            <MenuItem
                              key={option.value}
                              value={option.value}
                              sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                            >
                              <Box sx={{ flex: 1, minWidth: 0, whiteSpace: 'normal' }}>{option.label}</Box>
                              {option.example && (
                                <OptionExampleTooltip option={option}>
                                  <InfoOutlinedIcon
                                    fontSize="small"
                                    sx={{ color: 'text.secondary', opacity: 0.7, ml: 1, '&:hover': { opacity: 1 } }}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </OptionExampleTooltip>
                              )}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>BOM layout</InputLabel>
                        <Select
                          value={config.bomLayout || 'none'}
                          label="BOM layout"
                          onChange={(event) => {
                            const nextLayout = event.target.value;
                            setParserTouched(true);
                            setConfig((prev) => ({
                              ...prev,
                              bomLayout: nextLayout,
                              assemblyMatrix: nextLayout === 'assembly_quantity_matrix'
                                ? detectAssemblyQuantityMatrix(headers, dataRows, roles)
                                : prev.assemblyMatrix,
                              quantityMode: ['assembly_quantity_matrix', 'multi_block_assembly'].includes(nextLayout)
                                ? 'every_row'
                                : prev.quantityMode,
                              quantityVariant: nextLayout === 'assembly_quantity_matrix'
                                ? QUANTITY_VARIANT_ALL
                                : prev.quantityVariant || QUANTITY_VARIANT_ALL,
                              quantityVariantByBlock: nextLayout === 'assembly_quantity_matrix'
                                ? {}
                                : prev.quantityVariantByBlock || {},
                            }));
                          }}
                        >
                          {BOM_LAYOUT_OPTIONS.map((option) => (
                            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    {showAssemblyQuantityVariantSelector && (
                      <Grid item xs={12} md={3}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Quantity variant</InputLabel>
                          <Select
                            value={config.quantityVariant || QUANTITY_VARIANT_ALL}
                            label="Quantity variant"
                            onChange={(event) => {
                              setParserTouched(true);
                              setConfig((prev) => ({
                                ...prev,
                                quantityVariant: event.target.value,
                              }));
                              setNormalizedRows([]);
                            setNormalizationSummary(null);
                          }}
                        >
                          <MenuItem value={QUANTITY_VARIANT_ALL}>All variants</MenuItem>
                            {assemblyQuantityVariantOptions.map((variant) => (
                              <MenuItem key={variant} value={variant}>{variant}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>
                    )}
                    {showMultiBlockQuantityVariantSelectors && multiBlockQuantityVariantGroups.map((group) => (
                      <Grid item xs={12} md={3} key={group.key}>
                        <FormControl fullWidth size="small">
                          <InputLabel>{`Quantity variant - ${group.label || 'BOM table'}`}</InputLabel>
                          <Select
                            value={(config.quantityVariantByBlock || {})[group.key] || QUANTITY_VARIANT_ALL}
                            label={`Quantity variant - ${group.label || 'BOM table'}`}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setParserTouched(true);
                              setConfig((prev) => {
                                const nextByBlock = { ...(prev.quantityVariantByBlock || {}) };
                                if (!nextValue || nextValue === QUANTITY_VARIANT_ALL) {
                                  delete nextByBlock[group.key];
                                } else {
                                  nextByBlock[group.key] = nextValue;
                                }
                                return {
                                  ...prev,
                                  quantityVariantByBlock: nextByBlock,
                                };
                              });
                              setNormalizedRows([]);
                              setNormalizationSummary(null);
                            }}
                          >
                            <MenuItem value={QUANTITY_VARIANT_ALL}>All variants</MenuItem>
                            {group.variants.map((variant) => (
                              <MenuItem key={`${group.key}-${variant}`} value={variant}>{variant}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>
                    ))}
                    <Grid item xs={12} md={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Known delimiter</InputLabel>
                        <Select
                          value={config.delimiterMode}
                          label="Known delimiter"
                          onChange={(event) => {
                            setDelimiterTouched(true);
                            setParserTouched(true);
                            setConfig((prev) => ({ ...prev, delimiterMode: event.target.value }));
                          }}
                        >
                          {DELIMITER_OPTIONS.map((option) => (
                            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    {config.delimiterMode === 'custom' && (
                      <Grid item xs={12} md={3}>
                        <TextField
                          fullWidth
                          size="small"
                          label="Custom delimiter"
                          value={config.customDelimiter}
                          onChange={(event) => setConfig((prev) => ({ ...prev, customDelimiter: event.target.value }))}
                        />
                      </Grid>
                    )}
                    {config.structure === 'grouped_rows' && !bomLayoutActive && (
                      <Grid item xs={12} md={3}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Group header handling</InputLabel>
                          <Select
                            value={config.groupHeaderMode || 'auto'}
                            label="Group header handling"
                            renderValue={(selected) => {
                              const opt = GROUP_HEADER_OPTIONS.find((o) => o.value === selected);
                              return opt?.label || selected;
                            }}
                            onChange={(event) => setConfig((prev) => ({ ...prev, groupHeaderMode: event.target.value }))}
                          >
                            {GROUP_HEADER_OPTIONS.map((option) => (
                              <MenuItem
                                key={option.value}
                                value={option.value}
                                sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                              >
                                <Box sx={{ flex: 1, minWidth: 0, whiteSpace: 'normal' }}>{option.label}</Box>
                                {option.example && (
                                  <OptionExampleTooltip option={option}>
                                    <InfoOutlinedIcon
                                      fontSize="small"
                                      sx={{ color: 'text.secondary', opacity: 0.7, ml: 1, '&:hover': { opacity: 1 } }}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </OptionExampleTooltip>
                                )}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>
                    )}
                  </Grid>
                  {bomLayoutActive && (
                    <Alert severity="info" sx={{ mt: 1.25 }}>
                      BOM layout is controlling row expansion. MPN/MFR arrangement, alternate layout, and quantity handling are locked because changing them would not affect this layout.
                    </Alert>
                  )}
                  {config.alternateLayout === 'separate_columns' && config.structure !== 'grouped_rows' && !bomLayoutActive && (
                    <Paper elevation={0} sx={{ mt: 1.5, p: 1.25, border: '1px solid #e1e6ec', bgcolor: '#fff' }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" gap={1}>
                        <Box>
                          <Typography sx={{ fontSize: 13, fontWeight: 800 }}>Alternate column groups</Typography>
                          <Typography sx={{ fontSize: 12.5, color: '#66717f' }}>
                            {showAlternateManufacturerGroups
                              ? 'Add one row for each alternate MPN/MFR pair that lives in separate columns.'
                              : 'Add one row for each alternate MPN column. Manufacturer is not required for this setup.'}
                          </Typography>
                        </Box>
                        <Button size="small" variant="outlined" onClick={addAlternateColumnGroup}>
                          Add alternate group
                        </Button>
                      </Stack>
                      {(config.alternateColumnGroups || []).length > 0 ? (
                        <Stack spacing={1} sx={{ mt: 1 }}>
                          {(config.alternateColumnGroups || []).map((group, groupIndex) => (
                            <Grid container spacing={1} alignItems="center" key={`alt-group-${groupIndex}`}>
                              <Grid item xs={12} sm={showAlternateManufacturerGroups ? 3 : 4}>
                                <FormControl fullWidth size="small">
                                  <InputLabel>{`Alt ${groupIndex + 1} MPN`}</InputLabel>
                                  <Select
                                    label={`Alt ${groupIndex + 1} MPN`}
                                    value={group.mpn || ''}
                                    onChange={(event) => updateAlternateColumnGroup(groupIndex, 'mpn', event.target.value)}
                                  >
                                    <MenuItem value="">None</MenuItem>
                                    {visibleSourceHeaders.map((header) => (
                                      <MenuItem key={header} value={header}>{header}</MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              </Grid>
                              {showAlternateManufacturerGroups && (
                                <Grid item xs={12} sm={3}>
                                  <FormControl fullWidth size="small">
                                    <InputLabel>{`Alt ${groupIndex + 1} MFR`}</InputLabel>
                                    <Select
                                      label={`Alt ${groupIndex + 1} MFR`}
                                      value={group.mfr || ''}
                                      onChange={(event) => updateAlternateColumnGroup(groupIndex, 'mfr', event.target.value)}
                                    >
                                      <MenuItem value="">None</MenuItem>
                                      {visibleSourceHeaders.map((header) => (
                                        <MenuItem key={header} value={header}>{header}</MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                </Grid>
                              )}
                              <Grid item xs={12} sm={showAlternateManufacturerGroups ? 2 : 3}>
                                <FormControl fullWidth size="small">
                                  <InputLabel>Alt Qty</InputLabel>
                                  <Select
                                    label="Alt Qty"
                                    value={group.qty || ''}
                                    onChange={(event) => updateAlternateColumnGroup(groupIndex, 'qty', event.target.value)}
                                  >
                                    <MenuItem value="">Use primary</MenuItem>
                                    {visibleSourceHeaders.map((header) => (
                                      <MenuItem key={header} value={header}>{header}</MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              </Grid>
                              <Grid item xs={12} sm={showAlternateManufacturerGroups ? 2 : 3}>
                                <FormControl fullWidth size="small">
                                  <InputLabel>Alt UOM</InputLabel>
                                  <Select
                                    label="Alt UOM"
                                    value={group.uom || ''}
                                    onChange={(event) => updateAlternateColumnGroup(groupIndex, 'uom', event.target.value)}
                                  >
                                    <MenuItem value="">Use primary</MenuItem>
                                    {visibleSourceHeaders.map((header) => (
                                      <MenuItem key={header} value={header}>{header}</MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              </Grid>
                              <Grid item xs={12} sm={2}>
                                <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                                  <Chip size="small" label={group.mpn ? 'Active' : 'Needs MPN'} color={group.mpn ? 'success' : 'default'} />
                                  <IconButton size="small" color="error" onClick={() => removeAlternateColumnGroup(groupIndex)}>
                                    <DeleteOutlineIcon fontSize="small" />
                                  </IconButton>
                                </Stack>
                              </Grid>
                            </Grid>
                          ))}
                        </Stack>
                      ) : (
                        <Alert severity="info" sx={{ mt: 1 }}>
                          No alternate columns selected yet. Add a group and choose the alternate MPN column{showAlternateManufacturerGroups ? ', plus manufacturer if available' : ''}.
                        </Alert>
                      )}
                      {alternateColumnGroups.length > 0 && (
                        <Typography sx={{ mt: 1, fontSize: 12.5, color: '#536171' }}>
                          {alternateColumnGroups.length} alternate group{alternateColumnGroups.length === 1 ? '' : 's'} will be parsed.
                        </Typography>
                      )}
                    </Paper>
                  )}
                  <Typography sx={{ mt: 1, fontSize: 13, color: '#536171', lineHeight: 1.45 }}>
                    <strong>Detected rule:</strong> {bomLayoutActive ? selectedBomLayoutOption?.description : selectedStructureOption?.description || '-'}
                    {!bomLayoutActive && selectedAlternateOption?.description ? ` ${selectedAlternateOption.description}` : ''}
                    {!bomLayoutActive && config.structure === 'grouped_rows' && selectedGroupHeaderOption ? ` ${selectedGroupHeaderOption.description}` : ''}
                    {' '}<strong>Delimiter:</strong> {delimiterLabel}.
                    {' '}Blank BOM levels will be treated as level 1.
                  </Typography>
                  {config.alternateLayout === 'same_group_rows' && !roles.parent && !bomLayoutActive && (
                    <Alert severity="info" sx={{ mt: 1 }}>
                      Select a Parent / group key such as Ref Designator for best results. Without it, grouping falls back to description, quantity, UOM, and level.
                    </Alert>
                  )}
                  {config.alternateLayout === 'following_rows' && !config.followingRowAlternateColumn && !bomLayoutActive && (
                    <Alert severity="warning" sx={{ mt: 1 }}>
                      Select the column where alternate values appear in the rows below the main BOM line.
                    </Alert>
                  )}
                  {config.alternateLayout === 'following_item_rows' && !bomLayoutActive && (
                    (!config.followingItemRowsMpnColumn || !config.followingItemRowsManufacturerColumn) ? (
                      <Alert severity="warning" sx={{ mt: 1 }}>
                        Select the MPN and MFR columns used by the following sparse rows.
                      </Alert>
                    ) : (
                      <Alert severity="info" sx={{ mt: 1 }}>
                        Sparse rows using {config.followingItemRowsMpnColumn} and {config.followingItemRowsManufacturerColumn} will attach to the nearest previous item. CPN will {config.followingItemRowsCpnMode === 'column' ? 'come from the mapped CPN column when available' : 'copy from the primary item'}.
                      </Alert>
                    )
                  )}
                  {roles.rowType && rowTypeValues.length > 0 && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 800 }}>
                        Which "{roles.rowType}" values are documents, not parts?
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: '#66717f', mb: 0.75 }}>
                        A document is attached to a part, not consumed by one, so it is not a BOM
                        line. Ticked values are dropped before the BOM is built
                        {documentRowCount > 0 ? ` — ${documentRowCount} rows` : ''}.
                      </Typography>
                      <Stack direction="row" flexWrap="wrap" gap={0.75}>
                        {rowTypeValues.map(({ value, count }) => {
                          const ticked = (config.documentTypeValues || []).includes(value);
                          return (
                            <Chip
                              key={value}
                              size="small"
                              label={`${value} (${count})`}
                              color={ticked ? 'warning' : 'default'}
                              variant={ticked ? 'filled' : 'outlined'}
                              onClick={() => setConfig((prev) => {
                                const current = prev.documentTypeValues || [];
                                return {
                                  ...prev,
                                  documentTypeValues: current.includes(value)
                                    ? current.filter((entry) => entry !== value)
                                    : [...current, value],
                                };
                              })}
                            />
                          );
                        })}
                      </Stack>
                    </Box>
                  )}
                  {detectedCleanupOptions.length > 0 && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 800 }}>Clean visual rows before parsing</Typography>
                      <Grid container spacing={1} sx={{ mt: 0.25 }}>
                        {detectedCleanupOptions.map((option) => (
                          <Grid item xs={12} md={4} key={option.key}>
                            <Paper elevation={0} sx={{ p: 1, border: '1px solid #e1e6ec', bgcolor: '#fff' }}>
                              <Stack direction="row" alignItems="center" gap={0.5}>
                                <Switch
                                  size="small"
                                  checked={Boolean(config[option.key])}
                                  onChange={(event) => setConfig((prev) => ({ ...prev, [option.key]: event.target.checked }))}
                                />
                                <Box>
                                  <Typography sx={{ fontSize: 12.5, fontWeight: 800 }}>{option.label}</Typography>
                                  <Typography sx={{ fontSize: 12, color: '#66717f' }}>
                                    {cleanupDetections[option.key]} detected
                                  </Typography>
                                </Box>
                              </Stack>
                            </Paper>
                          </Grid>
                        ))}
                      </Grid>
                    </Box>
                  )}
                </Paper>
                <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
                  <Button variant="outlined" onClick={handleBackFromConfigure} disabled={busy}>Back</Button>
                  <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={handleNormalize} disabled={busy}>Run normalization</Button>
                </Stack>
              </Paper>
            )}

            {currentStep === 4 && (
              <Paper elevation={0} sx={{ p: 2.5, border: '1px solid #dce2e8' }}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
                  <Box>
                    <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
                      <Typography sx={{ fontSize: 18, fontWeight: 800 }}>Normalized editable sheet</Typography>
                      {quality.lowConfidence > 0 && (
                        <Tooltip title={CONFIDENCE_HELP_TEXT} arrow>
                          <Chip
                            size="small"
                            clickable
                            color="warning"
                            variant={lowConfidenceOnly ? 'filled' : 'outlined'}
                            label={`${quality.lowConfidence} low confidence`}
                            onClick={() => setLowConfidenceOnly((prev) => !prev)}
                            sx={{
                              height: 28,
                              px: 0.5,
                              fontSize: 13,
                              fontWeight: 800,
                              borderColor: lowConfidenceOnly ? 'transparent' : '#f59e0b',
                              bgcolor: lowConfidenceOnly ? '#f59e0b' : (isDarkMode ? 'rgba(245, 158, 11, 0.16)' : '#fff7ed'),
                              color: lowConfidenceOnly ? '#111827' : (isDarkMode ? '#fbbf24' : '#92400e'),
                              '&:hover': {
                                bgcolor: lowConfidenceOnly ? '#fbbf24' : (isDarkMode ? 'rgba(245, 158, 11, 0.24)' : '#ffedd5'),
                              },
                            }}
                          />
                        </Tooltip>
                      )}
                    </Stack>
                    <Typography sx={{ mt: 0.5, fontSize: 13, color: '#66717f' }}>
                      Review the parsed output, edit cells directly, or delete rows before downloading.
                    </Typography>
                  </Box>
                  <Stack direction="row" gap={1} flexWrap="wrap" justifyContent={{ xs: 'flex-start', md: 'flex-end' }} alignItems="flex-start">
                    <Button
                      size="medium"
                      variant="outlined"
                      startIcon={<TuneIcon />}
                      endIcon={<KeyboardArrowDownIcon />}
                      disabled={!normalizedRows.length}
                      onClick={(event) => setToolsMenuAnchor(event.currentTarget)}
                      sx={{
                        minHeight: 40,
                        px: 2.2,
                        borderRadius: '999px',
                        fontSize: 13,
                        fontWeight: 850,
                        bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.68)' : '#ffffff',
                        borderColor: isDarkMode ? 'rgba(96, 165, 250, 0.38)' : '#bfdbfe',
                        boxShadow: isDarkMode ? 'none' : '0 10px 22px -18px rgba(37, 99, 235, 0.52)',
                      }}
                    >
                      Tools
                    </Button>
                    <Menu
                      anchorEl={toolsMenuAnchor}
                      open={Boolean(toolsMenuAnchor)}
                      onClose={() => setToolsMenuAnchor(null)}
                    >
                      <MenuItem
                        disabled={!normalizedRows.length || manufacturerMatchLoading}
                        onClick={() => {
                          setToolsMenuAnchor(null);
                          handleOpenManufacturerMatch();
                        }}
                      >
                        Manufacturer Match
                      </MenuItem>
                      <MenuItem
                        disabled={!normalizedRows.length}
                        onClick={() => {
                          setToolsMenuAnchor(null);
                          handleOpenFactwiseDialog();
                        }}
                      >
                        Create Item Codes
                      </MenuItem>
                      <MenuItem
                        disabled={!normalizedRows.length}
                        onClick={() => {
                          setToolsMenuAnchor(null);
                          handleOpenTagDialog();
                        }}
                      >
                        Add Tags
                      </MenuItem>
                      <MenuItem
                        disabled={!normalizedRows.length}
                        onClick={() => {
                          setToolsMenuAnchor(null);
                          handleOpenDeleteRowsDialog();
                        }}
                      >
                        Delete rows by condition
                      </MenuItem>
                      <MenuItem
                        disabled={!normalizedRows.length || workflowTemplateSaving}
                        onClick={() => {
                          setToolsMenuAnchor(null);
                          saveWorkflowTemplate();
                        }}
                      >
                        Save Workflow Template
                      </MenuItem>
                    </Menu>
                    <Button
                      size="medium"
                      variant="contained"
                      startIcon={<DownloadIcon />}
                      endIcon={<KeyboardArrowDownIcon />}
                      disabled={!normalizedRows.length}
                      onClick={(event) => setDownloadMenuAnchor(event.currentTarget)}
                      sx={{
                        minHeight: 40,
                        px: 2.4,
                        borderRadius: '999px',
                        fontSize: 13,
                        fontWeight: 850,
                        background: 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)',
                        boxShadow: '0 18px 30px -18px rgba(37, 99, 235, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.32)',
                        '&:hover': {
                          background: 'linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)',
                          boxShadow: '0 22px 36px -20px rgba(37, 99, 235, 1), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
                        },
                      }}
                    >
                      Download
                    </Button>
                    <Menu
                      anchorEl={downloadMenuAnchor}
                      open={Boolean(downloadMenuAnchor)}
                      onClose={() => setDownloadMenuAnchor(null)}
                    >
                      <MenuItem
                        onClick={() => {
                          setDownloadMenuAnchor(null);
                          downloadRowsAsXlsx(normalizedRows);
                        }}
                      >
                        Microsoft Excel (.xlsx, .xlsm)
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          setDownloadMenuAnchor(null);
                          downloadRowsAsCsv(normalizedRows);
                        }}
                      >
                        Comma-separated values (.csv)
                      </MenuItem>
                    </Menu>
                  </Stack>
                </Stack>
                {normalizedRows.length > 0 && (
                  <Box sx={{ mt: 1.5 }}>
                    <LinearProgress variant="determinate" value={quality.average} sx={{ height: 7, borderRadius: 2 }} />
                  </Box>
                )}
                <NormalizedTable
                  rows={normalizedRows}
                  onRowsChange={setNormalizedRows}
                  lowConfidenceOnly={lowConfidenceOnly}
                  onLowConfidenceOnlyChange={setLowConfidenceOnly}
                />
                <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
                  <Button variant="outlined" onClick={() => setCurrentStep(2)} disabled={busy}>Back to configure</Button>
                  <Stack direction="row" gap={1} flexWrap="wrap" justifyContent="flex-end">
                    <Button variant="outlined" onClick={handleUseNormalizedAsBase} disabled={busy || !normalizedRows.length}>Use merged sheet as base</Button>
                    <Button variant="outlined" onClick={handleNormalize} disabled={busy}>Run again</Button>
                    <Button variant="contained" onClick={() => handleContinueNormalizedToBomMapping()} disabled={busy || !normalizedRows.length}>Continue</Button>
                  </Stack>
                </Stack>
              </Paper>
            )}
          </Stack>
        )}
      </Box>
      <Dialog
        open={sourceGridOpen}
        onClose={() => setSourceGridOpen(false)}
        maxWidth="xl"
        fullWidth
      >
        <DialogTitle>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={1}>
            <Box>
              <Typography sx={{ fontSize: 18, fontWeight: 800 }}>All source rows</Typography>
              <Typography sx={{ mt: 0.4, fontSize: 13, color: normalizerTheme.muted }}>
                Showing detected source rows from the selected sheet setup.
              </Typography>
            </Box>
            <Stack direction="row" gap={0.75} flexWrap="wrap">
              <Chip size="small" label={`${sourceGridRows.length} shown / ${sourceDataRows.length} detected rows`} />
              {sourceEndRow && <Chip size="small" color="info" variant="outlined" label={`Cutoff row ${sourceEndRow}`} />}
              {sourceLimitActive && <Chip size="small" color="warning" variant="outlined" label={`${sourceRowsExcludedByLimit} excluded`} />}
            </Stack>
          </Stack>
        </DialogTitle>
        <DialogContent>
          {sourceEndRow && (
            <Alert severity="info" sx={{ mb: 1.25 }}>
              Rows after sheet row {sourceEndRow} are visible here for review, but they are excluded from normalization.
            </Alert>
          )}
          <TableContainer
            sx={{
              maxHeight: '62vh',
              overflow: 'auto',
              border: `1px solid ${normalizerTheme.border}`,
              bgcolor: normalizerTheme.table,
              '&::-webkit-scrollbar': { height: 10, width: 10 },
              '&::-webkit-scrollbar-thumb': {
                borderRadius: 8,
                bgcolor: isDarkMode ? 'rgba(148, 163, 184, 0.42)' : 'rgba(100, 116, 139, 0.38)',
              },
            }}
          >
            <Table stickyHeader size="small" sx={{ width: 'max-content', minWidth: '100%', tableLayout: 'fixed' }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 90, fontWeight: 800, bgcolor: normalizerTheme.tableHeader, color: normalizerTheme.text, borderColor: normalizerTheme.border }}>
                    Sheet row
                  </TableCell>
                  {sourceEndRow && (
                    <TableCell sx={{ minWidth: 105, fontWeight: 800, bgcolor: normalizerTheme.tableHeader, color: normalizerTheme.text, borderColor: normalizerTheme.border }}>
                      Status
                    </TableCell>
                  )}
                  {visibleSourceHeaders.map((header) => (
                    <TableCell
                      key={header}
                      sx={{
                        minWidth: 170,
                        maxWidth: 280,
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        bgcolor: normalizerTheme.tableHeader,
                        color: normalizerTheme.text,
                        borderColor: normalizerTheme.border,
                      }}
                    >
                      {header}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {sourceGridVisibleRows.map((row, index) => {
                  const excluded = isSourceRowExcluded(row);
                  return (
                    <TableRow
                      key={`source-grid-${row.__sourceRow || index}-${index}`}
                      sx={{
                        bgcolor: excluded
                          ? (isDarkMode ? 'rgba(239, 68, 68, 0.08)' : 'rgba(254, 226, 226, 0.7)')
                          : 'transparent',
                        opacity: excluded ? 0.72 : 1,
                      }}
                    >
                      <TableCell sx={{ minWidth: 90, color: normalizerTheme.text, borderColor: normalizerTheme.border, fontWeight: 700 }}>
                        {row.__sourceRow || ''}
                      </TableCell>
                      {sourceEndRow && (
                        <TableCell sx={{ minWidth: 105, color: normalizerTheme.text, borderColor: normalizerTheme.border }}>
                          <Chip
                            size="small"
                            color={excluded ? 'warning' : 'success'}
                            variant={excluded ? 'outlined' : 'filled'}
                            label={excluded ? 'Excluded' : 'Included'}
                          />
                        </TableCell>
                      )}
                      {visibleSourceHeaders.map((header) => (
                        <TableCell
                          key={header}
                          sx={{
                            minWidth: 170,
                            maxWidth: 280,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            color: normalizerTheme.text,
                            borderColor: normalizerTheme.border,
                            ...sourceCellStyleSx(row, header),
                          }}
                        >
                          {displaySourceCellValue(row[header], header, sourcePreviewAssemblyMatrix)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: 13, color: normalizerTheme.muted }}>
            Page {sourceGridPage + 1} of {sourceGridTotalPages}
          </Typography>
          <Stack direction="row" gap={1}>
            <Button
              variant="outlined"
              disabled={sourceGridPage === 0}
              onClick={() => setSourceGridPage((page) => Math.max(0, page - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outlined"
              disabled={sourceGridPage >= sourceGridTotalPages - 1}
              onClick={() => setSourceGridPage((page) => Math.min(sourceGridTotalPages - 1, page + 1))}
            >
              Next
            </Button>
            <Button variant="contained" onClick={() => setSourceGridOpen(false)}>Done</Button>
          </Stack>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={Boolean(successMessage)}
        autoHideDuration={5000}
        onClose={() => setSuccessMessage('')}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ mt: 7, maxWidth: 420, zIndex: 1600 }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setSuccessMessage('')}
          sx={{
            width: 'auto',
            maxWidth: 420,
            borderRadius: '14px',
            boxShadow: '0 18px 50px rgba(15,23,42,0.22)',
            alignItems: 'center'
          }}
        >
          {successMessage}
        </Alert>
      </Snackbar>
      <Dialog open={pdfChoiceOpen} onClose={() => {
        setPdfChoiceOpen(false);
        setPendingPdfAction(null);
      }} maxWidth="md" fullWidth>
        <DialogTitle>Choose PDF Processing Method</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, color: '#536171', mb: 2 }}>
            Pick the extraction method that best matches this PDF.
          </Typography>
          <Paper elevation={0} sx={{ p: 1.5, mb: 2, border: '1px solid #e1e6ec', bgcolor: '#fbfcfd' }}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} gap={1}>
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 800 }}>Split PDF by page ranges</Typography>
                <Typography sx={{ mt: 0.35, fontSize: 12.5, color: '#66717f' }}>
                  Use this when different page ranges should be extracted as separate sources.
                </Typography>
              </Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={pdfRangeEnabled}
                    onChange={(event) => setPdfRangeEnabled(event.target.checked)}
                  />
                }
                label={pdfRangeEnabled ? 'Enabled' : 'Off'}
              />
            </Stack>
            {pdfRangeEnabled && (
              <Stack spacing={1} sx={{ mt: 1.5 }}>
                {pdfRanges.map((range, index) => (
                  <Grid container spacing={1} key={`pdf-range-${index}`} alignItems="center">
                    <Grid item xs={12} md={5}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Section name"
                        value={range.name}
                        onChange={(event) => updatePdfRange(index, 'name', event.target.value)}
                      />
                    </Grid>
                    <Grid item xs={10} md={6}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Pages"
                        placeholder="Page range"
                        value={range.pages}
                        onChange={(event) => updatePdfRange(index, 'pages', event.target.value)}
                      />
                    </Grid>
                    <Grid item xs={2} md={1}>
                      <IconButton
                        size="small"
                        color="error"
                        disabled={pdfRanges.length <= 1}
                        onClick={() => removePdfRange(index)}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Grid>
                  </Grid>
                ))}
                <Box>
                  <Button size="small" variant="outlined" onClick={addPdfRange}>
                    Add page range
                  </Button>
                </Box>
              </Stack>
            )}
          </Paper>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Card
                elevation={0}
                onClick={() => handlePdfProcessingChoice('ocr')}
                sx={{ height: '100%', cursor: 'pointer', border: '1px solid #dce2e8', '&:hover': { borderColor: '#1976d2', bgcolor: '#f8fafc' } }}
              >
                <CardContent>
                  <Typography sx={{ fontSize: 16, fontWeight: 800 }}>Simple OCR</Typography>
                  <Typography sx={{ mt: 0.8, fontSize: 13, color: '#66717f' }}>
                    Best when the page is already a clean table — clear rows and columns, all text
                    readable, and nothing else around it. Anything outside the table comes through
                    as data too.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card
                elevation={0}
                onClick={() => handlePdfProcessingChoice('zonal')}
                sx={{ height: '100%', cursor: 'pointer', border: '1px solid #dce2e8', '&:hover': { borderColor: '#1976d2', bgcolor: '#f8fafc' } }}
              >
                <CardContent>
                  <Typography sx={{ fontSize: 16, fontWeight: 800 }}>Select Area Manually</Typography>
                  <Typography sx={{ mt: 0.8, fontSize: 13, color: '#66717f' }}>
                    You draw a box around the exact part of each page you want, and only what is
                    inside the box gets extracted. Use for irregular tables or pages with extra
                    content to leave out.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setPdfChoiceOpen(false);
            setPendingPdfAction(null);
          }}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={factwiseDialogOpen} onClose={() => setFactwiseDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Item Codes</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, color: '#536171', mb: 1.5 }}>
            Generate the Item code values from normalized rows before export.
          </Typography>
          <Grid container spacing={1.5}>
            <Grid item xs={12}>
              <FormControl fullWidth size="small">
                <InputLabel>Source</InputLabel>
                <Select
                  label="Source"
                  value={factwiseConfig.mode}
                  onChange={(event) => setFactwiseConfig((prev) => ({ ...prev, mode: event.target.value }))}
                >
                  <MenuItem value="columns">Combine two columns</MenuItem>
                  <MenuItem value="serial">Prefix + sequence</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {factwiseConfig.mode === 'columns' ? (
              <>
                <Grid item xs={12} sm={5}>
                  <FormControl fullWidth size="small">
                    <InputLabel>First column</InputLabel>
                    <Select
                      label="First column"
                      value={factwiseConfig.firstColumn}
                      onChange={(event) => setFactwiseConfig((prev) => ({ ...prev, firstColumn: event.target.value }))}
                    >
                      {normalizedColumnOptions.map((column) => (
                        <MenuItem key={column} value={column}>{column}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={2}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Join"
                    value={factwiseConfig.separator}
                    onChange={(event) => setFactwiseConfig((prev) => ({ ...prev, separator: event.target.value }))}
                  />
                </Grid>
                <Grid item xs={12} sm={5}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Second column</InputLabel>
                    <Select
                      label="Second column"
                      value={factwiseConfig.secondColumn}
                      onChange={(event) => setFactwiseConfig((prev) => ({ ...prev, secondColumn: event.target.value }))}
                    >
                      {normalizedColumnOptions.map((column) => (
                        <MenuItem key={column} value={column}>{column}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              </>
            ) : (
              <>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Prefix"
                    value={factwiseConfig.prefix}
                    onChange={(event) => setFactwiseConfig((prev) => ({ ...prev, prefix: event.target.value }))}
                  />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label="Start"
                    value={factwiseConfig.start}
                    onChange={(event) => setFactwiseConfig((prev) => ({ ...prev, start: event.target.value }))}
                  />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label="Digits"
                    value={factwiseConfig.padding}
                    onChange={(event) => setFactwiseConfig((prev) => ({ ...prev, padding: event.target.value }))}
                  />
                </Grid>
                <Grid item xs={12}>
                  <Stack direction="row" alignItems="center" gap={1}>
                    <Switch
                      checked={factwiseConfig.increment}
                      onChange={(event) => setFactwiseConfig((prev) => ({ ...prev, increment: event.target.checked }))}
                    />
                    <Typography sx={{ fontSize: 13 }}>Increase number for each row</Typography>
                  </Stack>
                </Grid>
                <Grid item xs={12}>
                  <Paper elevation={0} sx={{ p: 1.2, bgcolor: '#f8fafc', border: '1px solid #e1e6ec' }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 800 }}>Preview</Typography>
                    <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 0.8 }}>
                      {factwiseSerialPreview.map((value, index) => (
                        <Chip key={`${value}-${index}`} size="small" label={value || '(blank)'} />
                      ))}
                    </Stack>
                  </Paper>
                </Grid>
              </>
            )}
            <Grid item xs={12}>
              <FormControl fullWidth size="small">
                <InputLabel>Apply mode</InputLabel>
                <Select
                  label="Apply mode"
                  value={factwiseConfig.applyMode}
                  onChange={(event) => setFactwiseConfig((prev) => ({ ...prev, applyMode: event.target.value }))}
                >
                  <MenuItem value="overwrite">Overwrite existing Item code values</MenuItem>
                  <MenuItem value="fill_empty">Fill empty Item code values only</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFactwiseDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateFactwiseForNormalizer}
            disabled={factwiseConfig.mode === 'columns' && (!factwiseConfig.firstColumn || !factwiseConfig.secondColumn)}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={tagDialogOpen} onClose={() => setTagDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Tag Column</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, color: '#536171', mb: 1.5 }}>
            Add a numbered tag column to the normalized output. Rules are checked top to bottom.
          </Typography>
          <Grid container spacing={1.5}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Target tag column"
                value={tagConfig.targetColumn}
                onChange={(event) => setTagConfig((prev) => ({ ...prev, targetColumn: event.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Tag source</InputLabel>
                <Select
                  label="Tag source"
                  value={tagConfig.mode}
                  onChange={(event) => setTagConfig((prev) => ({ ...prev, mode: event.target.value }))}
                >
                  <MenuItem value="rules">Rule based mapping</MenuItem>
                  <MenuItem value="source">Copy from a column</MenuItem>
                  <MenuItem value="default">Use one default value</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {tagConfig.mode === 'rules' && (
              <Grid item xs={12}>
                <Stack spacing={1}>
                  {tagConfig.rules.map((rule, index) => (
                    <Paper key={`tag-rule-${index}`} elevation={0} sx={{ p: 1.2, border: '1px solid #e1e6ec', bgcolor: '#fbfcfd' }}>
                      <Grid container spacing={1}>
                        <Grid item xs={12} sm={4}>
                          <FormControl fullWidth size="small">
                            <InputLabel>Source column</InputLabel>
                            <Select
                              label="Source column"
                              value={rule.sourceColumn}
                              onChange={(event) => setTagConfig((prev) => ({
                                ...prev,
                                rules: prev.rules.map((currentRule, ruleIndex) => (
                                  ruleIndex === index ? { ...currentRule, sourceColumn: event.target.value } : currentRule
                                )),
                              }))}
                            >
                              {normalizedColumnOptions.map((column) => (
                                <MenuItem key={column} value={column}>{column}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={3}>
                          <TextField
                            fullWidth
                            size="small"
                            label="Contains"
                            value={rule.searchText}
                            onChange={(event) => setTagConfig((prev) => ({
                              ...prev,
                              rules: prev.rules.map((currentRule, ruleIndex) => (
                                ruleIndex === index ? { ...currentRule, searchText: event.target.value } : currentRule
                              )),
                            }))}
                          />
                        </Grid>
                        <Grid item xs={12} sm={3}>
                          <TextField
                            fullWidth
                            size="small"
                            label="Tag value"
                            value={rule.outputValue}
                            onChange={(event) => setTagConfig((prev) => ({
                              ...prev,
                              rules: prev.rules.map((currentRule, ruleIndex) => (
                                ruleIndex === index ? { ...currentRule, outputValue: event.target.value } : currentRule
                              )),
                            }))}
                          />
                        </Grid>
                        <Grid item xs={12} sm={2}>
                          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={0.5}>
                            <Stack direction="row" alignItems="center" gap={0.25}>
                              <Switch
                                size="small"
                                checked={Boolean(rule.caseSensitive)}
                                onChange={(event) => setTagConfig((prev) => ({
                                  ...prev,
                                  rules: prev.rules.map((currentRule, ruleIndex) => (
                                    ruleIndex === index ? { ...currentRule, caseSensitive: event.target.checked } : currentRule
                                  )),
                                }))}
                              />
                              <Typography sx={{ fontSize: 11 }}>Aa</Typography>
                            </Stack>
                            <IconButton
                              size="small"
                              color="error"
                              disabled={tagConfig.rules.length <= 1}
                              onClick={() => setTagConfig((prev) => ({
                                ...prev,
                                rules: prev.rules.filter((_, ruleIndex) => ruleIndex !== index),
                              }))}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        </Grid>
                      </Grid>
                    </Paper>
                  ))}
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setTagConfig((prev) => ({
                      ...prev,
                      rules: [
                        ...prev.rules,
                        {
                          sourceColumn: normalizedColumnOptions.includes('manufacturer') ? 'manufacturer' : normalizedColumnOptions[0] || '',
                          searchText: '',
                          outputValue: '',
                          caseSensitive: false,
                        },
                      ],
                    }))}
                  >
                    Add rule
                  </Button>
                </Stack>
              </Grid>
            )}
            {tagConfig.mode === 'source' && (
              <Grid item xs={12}>
                <FormControl fullWidth size="small">
                  <InputLabel>Source column</InputLabel>
                  <Select
                    label="Source column"
                    value={tagConfig.sourceColumn}
                    onChange={(event) => setTagConfig((prev) => ({ ...prev, sourceColumn: event.target.value }))}
                  >
                    {normalizedColumnOptions.map((column) => (
                      <MenuItem key={column} value={column}>{column}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
            {tagConfig.mode === 'default' && (
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  label="Default tag value"
                  value={tagConfig.defaultValue}
                  onChange={(event) => setTagConfig((prev) => ({ ...prev, defaultValue: event.target.value }))}
                />
              </Grid>
            )}
            <Grid item xs={12}>
              <FormControl fullWidth size="small">
                <InputLabel>Apply mode</InputLabel>
                <Select
                  label="Apply mode"
                  value={tagConfig.applyMode}
                  onChange={(event) => setTagConfig((prev) => ({ ...prev, applyMode: event.target.value }))}
                >
                  <MenuItem value="overwrite">Overwrite this tag column</MenuItem>
                  <MenuItem value="fill_empty">Fill empty tag values only</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTagDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateTagForNormalizer}
            disabled={
              !tagConfig.targetColumn ||
              (tagConfig.mode === 'source' && !tagConfig.sourceColumn) ||
              (tagConfig.mode === 'rules' && !tagConfig.rules.some((rule) => rule.sourceColumn && rule.searchText && rule.outputValue))
            }
          >
            Add Tag
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={deleteRowsOpen} onClose={() => !deleteRowsBusy && setDeleteRowsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Delete rows by condition</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Remove every row where a column matches the condition below. For example, delete rows where <strong>MPN Code</strong> is empty.
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>Delete a row when</Typography>
            <FormControl size="small" sx={{ minWidth: 180, flex: 1 }}>
              <InputLabel>Column</InputLabel>
              <Select label="Column" value={deleteRowsColumn} onChange={(event) => setDeleteRowsColumn(event.target.value)}>
                {normalizedColumnOptions.map((column) => (
                  <MenuItem key={column} value={column}>{column}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Test</InputLabel>
              <Select label="Test" value={deleteRowsOperator} onChange={(event) => setDeleteRowsOperator(event.target.value)}>
                <MenuItem value="is_empty">is empty</MenuItem>
                <MenuItem value="not_empty">is not empty</MenuItem>
                <MenuItem value="equals">equals</MenuItem>
                <MenuItem value="not_equals">does not equal</MenuItem>
                <MenuItem value="contains">contains</MenuItem>
              </Select>
            </FormControl>
            {(deleteRowsOperator === 'equals' || deleteRowsOperator === 'not_equals' || deleteRowsOperator === 'contains') && (
              <TextField
                size="small"
                label="Text"
                value={deleteRowsCompare}
                onChange={(event) => setDeleteRowsCompare(event.target.value)}
                sx={{ minWidth: 120, flex: 1 }}
              />
            )}
          </Box>
          <Alert severity="warning" sx={{ mt: 2 }}>
            This permanently removes matching rows from the working grid. You can’t undo it here — re-run the mapping if you need them back.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRowsOpen(false)} disabled={deleteRowsBusy}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDeleteRowsByCondition}
            disabled={deleteRowsBusy || !deleteRowsColumn}
            startIcon={deleteRowsBusy ? <CircularProgress size={16} sx={{ color: 'white' }} /> : <DeleteOutlineIcon />}
          >
            {deleteRowsBusy ? 'Deleting...' : 'Delete rows'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={manufacturerMatchOpen} onClose={() => setManufacturerMatchOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Manufacturer Match</DialogTitle>
        <DialogContent>
          {manufacturerMatchLoading && (
            <Box sx={{ my: 2 }}>
              <Typography sx={{ mb: 1, fontSize: 13, fontWeight: 700 }}>Loading manufacturer list...</Typography>
              <LinearProgress />
            </Box>
          )}
          {manufacturerMatchError && <Alert severity="error" sx={{ mb: 1.5 }}>{manufacturerMatchError}</Alert>}
          {manufacturerDirectory.loaded && (
            <>
              <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 1.5 }}>
                <Chip size="small" color="success" label={`${manufacturerDirectory.entryCount || manufacturerDirectory.names.length} manufacturers`} />
                <Chip size="small" label={`${manufacturerDirectory.aliasCount || Object.keys(manufacturerDirectory.aliases || {}).length} aliases`} />
                <Chip size="small" color={manufacturerMatchPreview.length ? 'warning' : 'success'} label={`${manufacturerMatchPreview.length} changes found`} />
              </Stack>
              {manufacturerMatchPreview.length ? (
                <>
                  <TableContainer sx={{ maxHeight: 260, border: '1px solid #e1e6ec' }}>
                    <Table stickyHeader size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 800, bgcolor: '#f8fafc', width: 52 }}>
                            <Checkbox
                              size="small"
                              checked={allManufacturerMatchesSelected}
                              indeterminate={selectedManufacturerMatches.length > 0 && !allManufacturerMatchesSelected}
                              onChange={(event) => {
                                setSelectedManufacturerMatches(event.target.checked
                                  ? manufacturerMatchPreview.map((match) => match.key)
                                  : []);
                              }}
                            />
                          </TableCell>
                          <TableCell sx={{ fontWeight: 800, bgcolor: '#f8fafc' }}>Current</TableCell>
                          <TableCell sx={{ fontWeight: 800, bgcolor: '#f8fafc' }}>Matched</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {manufacturerMatchPreview.map((match) => (
                          <TableRow key={`${match.original}-${match.canonical}`}>
                            <TableCell>
                              <Checkbox
                                size="small"
                                checked={selectedManufacturerMatches.includes(match.key)}
                                onChange={(event) => {
                                  setSelectedManufacturerMatches((prev) => (
                                    event.target.checked
                                      ? [...new Set([...prev, match.key])]
                                      : prev.filter((key) => key !== match.key)
                                  ));
                                }}
                              />
                            </TableCell>
                            <TableCell>{match.original}</TableCell>
                            <TableCell>{match.canonical}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              ) : (
                <Alert severity="info">No manufacturer aliases need changing in the current normalized rows.</Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManufacturerMatchOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleApplyManufacturerMatch}
            disabled={!manufacturerDirectory.loaded || !manufacturerMatchPreview.length || !selectedManufacturerMatches.length || manufacturerMatchLoading}
          >
            Apply {selectedManufacturerMatches.length || ''} Match{selectedManufacturerMatches.length === 1 ? '' : 'es'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={pairingReviewOpen} onClose={() => {}} maxWidth="md" fullWidth>
        <DialogTitle>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={1}>
            <Box>
              <Typography sx={{ fontSize: 18, fontWeight: 850 }}>Review MPN-Manufacturer Pairing</Typography>
              <Typography sx={{ mt: 0.5, fontSize: 13, color: normalizerTheme.muted }}>
                Some rows have a different count of MPNs and manufacturers. Confirm how these should be paired before opening the normalized output.
              </Typography>
            </Box>
            <Chip color="warning" label={`${pairingReviewRows.length} row${pairingReviewRows.length === 1 ? '' : 's'} need review`} />
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 1.5 }}>
            Clean rows continue automatically. These rows are shown because the pairing count did not match.
          </Alert>
          <TableContainer sx={{ maxHeight: '58vh', border: `1px solid ${normalizerTheme.border}`, bgcolor: normalizerTheme.table, overflowX: 'auto' }}>
            <Table stickyHeader size="small" sx={{ minWidth: 920 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 72, fontWeight: 850, bgcolor: normalizerTheme.tableHeader, color: normalizerTheme.text }}>Row</TableCell>
                  <TableCell sx={{ width: 250, fontWeight: 850, bgcolor: normalizerTheme.tableHeader, color: normalizerTheme.text }}>MPNs</TableCell>
                  <TableCell sx={{ width: 190, fontWeight: 850, bgcolor: normalizerTheme.tableHeader, color: normalizerTheme.text }}>Manufacturers</TableCell>
                  <TableCell sx={{ width: 210, fontWeight: 850, bgcolor: normalizerTheme.tableHeader, color: normalizerTheme.text }}>Action</TableCell>
                  <TableCell sx={{ width: 250, fontWeight: 850, bgcolor: normalizerTheme.tableHeader, color: normalizerTheme.text }}>Manual values</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pairingReviewRows.map((issue, index) => (
                  <TableRow key={`${issue.key || issue.sourceRow}-${index}`}>
                    <TableCell sx={{ color: normalizerTheme.text, borderColor: normalizerTheme.border }}>
                      <Typography sx={{ fontWeight: 800 }}>{issue.sourceRow}</Typography>
                    </TableCell>
                    <TableCell sx={{ color: normalizerTheme.text, borderColor: normalizerTheme.border }}>
                      <Chip size="small" color="warning" variant="outlined" label={issue.message} sx={{ mb: 0.75, maxWidth: '100%' }} />
                      <Stack gap={0.5}>
                        {issue.mpns.map((mpn, mpnIndex) => (
                          <Stack
                            key={`${issue.sourceRow}-mpn-${mpnIndex}`}
                            direction="row"
                            alignItems="center"
                            gap={0.75}
                            sx={{ minHeight: 28 }}
                          >
                            {issue.action === 'remove_extra' && (
                              <Checkbox
                                size="small"
                                checked={(issue.mpnDecisions?.[mpnIndex]?.keep ?? true) !== false}
                                onChange={(event) => updatePairingMpnDecision(index, mpnIndex, { keep: event.target.checked })}
                                sx={{ p: 0.25 }}
                              />
                            )}
                            <Chip
                              size="small"
                              color={issue.action === 'remove_extra' && issue.mpnDecisions?.[mpnIndex]?.keep === false ? 'default' : 'primary'}
                              variant={issue.action === 'remove_extra' && issue.mpnDecisions?.[mpnIndex]?.keep === false ? 'outlined' : 'filled'}
                              label={`${mpnIndex + 1}. ${mpn}`}
                              sx={{ opacity: issue.action === 'remove_extra' && issue.mpnDecisions?.[mpnIndex]?.keep === false ? 0.55 : 1 }}
                            />
                          </Stack>
                        ))}
                      </Stack>
                      {issue.action === 'remove_extra' && (
                        <Typography sx={{ mt: 0.75, fontSize: 12, color: normalizerTheme.muted }}>
                          Uncheck the MPN values that should be removed.
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ color: normalizerTheme.text, borderColor: normalizerTheme.border }}>
                      {issue.manufacturers.length ? (
                        <Stack gap={0.5}>
                          {issue.manufacturers.map((manufacturer, manufacturerIndex) => (
                            <Stack
                              key={`${issue.sourceRow}-mfr-${manufacturerIndex}`}
                              direction="row"
                              alignItems="center"
                              gap={0.75}
                              sx={{ minHeight: 28 }}
                            >
                              {issue.action === 'remove_extra' && (
                                <Checkbox
                                  size="small"
                                  checked={(issue.mfrDecisions?.[manufacturerIndex]?.keep ?? true) !== false}
                                  onChange={(event) => updatePairingMfrDecision(index, manufacturerIndex, { keep: event.target.checked })}
                                  sx={{ p: 0.25 }}
                                />
                              )}
                              <Chip
                                size="small"
                                variant={issue.action === 'remove_extra' && issue.mfrDecisions?.[manufacturerIndex]?.keep === false ? 'outlined' : 'filled'}
                                label={`${manufacturerIndex + 1}. ${manufacturer}`}
                                sx={{ opacity: issue.action === 'remove_extra' && issue.mfrDecisions?.[manufacturerIndex]?.keep === false ? 0.55 : 1 }}
                              />
                            </Stack>
                          ))}
                        </Stack>
                      ) : (
                        <Typography sx={{ fontSize: 13, color: normalizerTheme.muted }}>No manufacturer detected</Typography>
                      )}
                      {issue.action === 'remove_extra' && issue.manufacturers.length > 0 && (
                        <Typography sx={{ mt: 0.75, fontSize: 12, color: normalizerTheme.muted }}>
                          Uncheck the manufacturer values that should be removed.
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ color: normalizerTheme.text, borderColor: normalizerTheme.border }}>
                      <FormControl fullWidth size="small">
                        <Select
                          value={issue.action || 'keep'}
                          onChange={(event) => {
                            const nextAction = event.target.value;
                            const patch = { action: nextAction };
                            if (nextAction === 'remove_extra') {
                              const keepMpnCount = issue.mpns.length > issue.manufacturers.length
                                ? Math.max(1, issue.manufacturers.length)
                                : issue.mpns.length;
                              const keepMfrCount = issue.manufacturers.length > issue.mpns.length
                                ? Math.max(1, issue.mpns.length)
                                : issue.manufacturers.length;
                              patch.mpnDecisions = (issue.mpnDecisions || issue.mpns.map((mpn, mpnIndex) => ({
                                mpn,
                                manufacturer: issue.manufacturers[mpnIndex] || issue.manufacturers[0] || '',
                                keep: true,
                              }))).map((decision, decisionIndex) => ({
                                ...decision,
                                keep: decisionIndex < keepMpnCount,
                              }));
                              patch.mfrDecisions = (issue.mfrDecisions || issue.manufacturers.map((manufacturer) => ({
                                manufacturer,
                                keep: true,
                              }))).map((decision, decisionIndex) => ({
                                ...decision,
                                keep: decisionIndex < keepMfrCount,
                              }));
                            }
                            updatePairingReviewRow(index, patch);
                          }}
                        >
                          <MenuItem value="keep">Keep parsed output</MenuItem>
                          <MenuItem value="manual">Link Manufacturer</MenuItem>
                          <MenuItem value="remove_extra">Remove extra MPN/MFR values</MenuItem>
                        </Select>
                      </FormControl>
                    </TableCell>
                    <TableCell sx={{ color: normalizerTheme.text, borderColor: normalizerTheme.border }}>
                      <TextField
                        fullWidth
                        size="small"
                        value={issue.manualManufacturers || ''}
                        onChange={(event) => updatePairingManualManufacturers(index, event.target.value)}
                        disabled={issue.action !== 'manual'}
                        placeholder="MFR 1 | MFR 2 | MFR 3"
                        helperText="Separate manufacturers with |, semicolon, or new line."
                      />
                      {issue.action === 'manual' && (
                        <Stack gap={0.5} sx={{ mt: 1 }}>
                          {(issue.mpnDecisions || []).map((decision, decisionIndex) => (
                            <TextField
                              key={`${issue.sourceRow}-manual-${decisionIndex}`}
                              size="small"
                              label={`${decisionIndex + 1}. ${decision.mpn}`}
                              value={decision.manufacturer || ''}
                              onChange={(event) => {
                                const nextDecisions = (issue.mpnDecisions || []).map((item, itemIndex) => (
                                  itemIndex === decisionIndex ? { ...item, manufacturer: event.target.value } : item
                                ));
                                updatePairingReviewRow(index, {
                                  mpnDecisions: nextDecisions,
                                  manualManufacturers: nextDecisions.map((item) => item.manufacturer || '').join(' | '),
                                });
                              }}
                            />
                          ))}
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Button
            onClick={() => {
              setPairingReviewOpen(false);
              setPendingNormalization(null);
              setBusy(false);
            }}
          >
            Back to configure
          </Button>
          <Stack direction="row" gap={1}>
            <Button variant="outlined" onClick={handleKeepPairingReview}>
              Keep parsed output
            </Button>
            <Button variant="contained" onClick={handleApplyPairingReview}>
              Apply pairing decisions
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>

      <Dialog
        open={parsingLogicOpen}
        onClose={() => {
          setParsingLogicOpen(false);
          setPatternApplyNotice('');
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box>
            <Typography sx={{ fontSize: 19, fontWeight: 760, letterSpacing: 0 }}>Review parsing setup</Typography>
            <Typography sx={{ mt: 0.45, fontSize: 13, lineHeight: 1.45, color: normalizerTheme.muted }}>
              Review the selected columns and parser rules before normalization runs.
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          {patternApplyNotice && (
            <Alert severity="success" sx={{ mb: 1.5 }}>
              {patternApplyNotice}
            </Alert>
          )}
          <Stack direction="row" gap={0.9} flexWrap="wrap" sx={{ mb: 2 }}>
            <Chip
              size="small"
              variant="outlined"
              label={`${detectedParsingLogic?.sections?.length || 0} source column${detectedParsingLogic?.sections?.length === 1 ? '' : 's'}`}
              sx={{
                height: 28,
                px: 0.35,
                fontSize: 12.5,
                fontWeight: 800,
                color: '#1e3a8a',
                bgcolor: '#eff6ff',
                borderColor: '#bfdbfe',
                '& .MuiChip-label': { px: 1.1 },
              }}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`${parsingPatternOptions.length} MPN/MFR format${parsingPatternOptions.length === 1 ? '' : 's'}`}
              sx={{
                height: 28,
                px: 0.35,
                fontSize: 12.5,
                fontWeight: 800,
                color: '#5b21b6',
                bgcolor: '#f5f3ff',
                borderColor: '#ddd6fe',
                '& .MuiChip-label': { px: 1.1 },
              }}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`${detectedParsingLogic?.matchingRows || 0} matching values`}
              sx={{
                height: 28,
                px: 0.35,
                fontSize: 12.5,
                fontWeight: 800,
                color: '#166534',
                bgcolor: '#f0fdf4',
                borderColor: '#bbf7d0',
                '& .MuiChip-label': { px: 1.1 },
              }}
            />
            {selectedParsingPattern?.section?.unmatched?.count > 0 && (
              <Chip size="small" color="warning" variant="outlined" label={`${selectedParsingPattern.section.unmatched.count} unmatched`} sx={{ fontWeight: 650 }} />
            )}
          </Stack>
          <Paper elevation={0} sx={{ p: 1.35, border: `1px solid ${normalizerTheme.border}`, bgcolor: normalizerTheme.paperSoft }}>
            <Grid container spacing={1.5} alignItems="center">
              <Grid item xs={12} md={8}>
                <Stack direction="row" alignItems="center" gap={0.75}>
                  <Typography sx={{ fontSize: 12, color: normalizerTheme.muted }}>
                    {selectedParsingPattern
                      ? (selectedPatternStagedEdit ? 'Edited pattern' : 'Detected pattern')
                      : 'Selected setup'}
                  </Typography>
                  {selectedPatternStagedEdit && (
                    <Chip
                      size="small"
                      label="Edited"
                      sx={{ height: 19, fontSize: 10.5, fontWeight: 800, bgcolor: '#f5f3ff', color: '#5b21b6', border: '1px solid #ddd6fe' }}
                    />
                  )}
                </Stack>
                <Typography sx={{ mt: 0.2, fontSize: 15, fontWeight: 760, lineHeight: 1.35, color: normalizerTheme.text }} noWrap>
                  {selectedParsingPattern
                    ? `${selectedParsingPatternNumber}. ${selectedParsingPattern.pattern?.shape || 'No pattern detected'}`
                    : (selectedStructureOption?.label || 'Selected parser')}
                </Typography>
                {selectedParsingPattern && (
                  <Typography sx={{ mt: 0.25, fontSize: 11.5, color: normalizerTheme.muted }} noWrap>
                    {selectedParsingPattern.section.sourceHeader} - {selectedParsingPattern.pattern.count} row{selectedParsingPattern.pattern.count === 1 ? '' : 's'}
                    {selectedPatternStagedEdit ? ` - your split (${selectedPatternStagedEdit.summary}) runs at normalization` : ''}
                  </Typography>
                )}
              </Grid>
              <Grid item xs={12} md={4}>
                <Stack spacing={1} alignItems="flex-end" sx={{ maxWidth: 300, ml: 'auto' }}>
                  <Button
                    variant="contained"
                    disabled={!selectedParsingPattern || configureParserPreparing}
                    sx={{
                      width: { xs: '77%', sm: 119 },
                      minWidth: 0,
                      px: 2,
                      fontWeight: 700,
                      bgcolor: '#2563eb',
                      color: '#ffffff',
                      boxShadow: 'none',
                      '&:hover': {
                        bgcolor: '#1d4ed8',
                        boxShadow: 'none',
                      },
                      '&.Mui-disabled': {
                        bgcolor: '#2563eb',
                        color: '#ffffff',
                        opacity: 0.55,
                      },
                    }}
                    onClick={() => {
                      if (!selectedParsingPattern) return;
                      setParsingLogicOpen(false);
                      handleOpenConfigureSplitColumns({
                        title: 'Parse Fields',
                        initialColumn: selectedParsingPattern.section.sourceHeader || '',
                        scope: {
                          mode: 'pattern',
                          patternKey: selectedParsingPattern.key,
                          sourceHeader: selectedParsingPattern.section.sourceHeader || '',
                          patternShape: selectedParsingPattern.pattern.shape,
                          sourceRows: selectedParsingPattern.pattern.sourceRows || [],
                        },
                      });
                    }}
                  >
                    Edit pattern
                  </Button>
                </Stack>
              </Grid>
            </Grid>
          </Paper>

          {!selectedParsingPattern && (
            <Paper elevation={0} sx={{ mt: 1.5, p: 1.6, border: `1px solid ${normalizerTheme.border}`, bgcolor: normalizerTheme.paper }}>
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: normalizerTheme.text }}>
                Rules to apply
              </Typography>
              <Stack gap={0.85} sx={{ mt: 1 }}>
                {parserLogicRules.map((rule) => (
                  <Typography key={rule} sx={{ fontSize: 13, color: normalizerTheme.muted, lineHeight: 1.45 }}>
                    {rule}
                  </Typography>
                ))}
              </Stack>
              <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mt: 1.4 }}>
                <Chip size="small" variant="outlined" label={`Structure: ${selectedStructureOption?.label || config.structure}`} sx={{ fontWeight: 650 }} />
                <Chip size="small" variant="outlined" label={`BOM layout: ${selectedBomLayoutOption?.label || 'None'}`} sx={{ fontWeight: 650 }} />
                <Chip size="small" variant="outlined" label={`Alternates: ${selectedAlternateOption?.label || config.alternateLayout}`} sx={{ fontWeight: 650 }} />
                <Chip size="small" variant="outlined" label={`Delimiter: ${selectedDelimiterOption?.label || config.delimiterMode}`} sx={{ fontWeight: 650 }} />
                <Chip size="small" variant="outlined" label={`Quantity: ${selectedQuantityOption?.label || config.quantityMode}`} sx={{ fontWeight: 650 }} />
              </Stack>
            </Paper>
          )}

          {selectedParsingPattern && (
            <Paper elevation={0} sx={{ mt: 1.5, p: 1.6, border: `1px solid ${normalizerTheme.border}`, bgcolor: normalizerTheme.paper }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1.2} alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 400, color: normalizerTheme.text }}>
                    {selectedParsingPattern.section.title}
                  </Typography>
                  <Typography sx={{ mt: 0.35, fontSize: 12.5, color: normalizerTheme.muted }}>
                    Source column: {selectedParsingPattern.section.sourceHeader}
                  </Typography>
                </Box>
                <Stack direction="row" gap={0.75} flexWrap="wrap" alignItems="center" justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}>
                  <Chip size="small" variant="outlined" label={`${selectedParsingPattern.pattern.count} rows`} sx={{ fontWeight: 650 }} />
                </Stack>
              </Stack>

              <Stack gap={1} sx={{ mt: 1.5 }}>
                {(selectedParsingPattern.pattern.examples || []).slice(0, 1).map((example, index) => (
                  <Box
                    key={`${selectedParsingPattern.key}-${example.sourceRow || index}`}
                    sx={{
                      p: 1.15,
                      borderRadius: '8px',
                      border: `1px solid ${normalizerTheme.border}`,
                      bgcolor: normalizerTheme.paperSoft,
                    }}
                  >
                    <Typography sx={{ mb: 0.75, fontSize: 12.5, fontWeight: 780, color: normalizerTheme.text }}>
                      Example used for this pattern
                    </Typography>
                    <Typography sx={{ fontSize: 11.5, fontWeight: 650, color: normalizerTheme.muted }}>
                      {example.sourceRow
                        ? `Source row ${example.sourceRow}`
                        : `Representative entry ${index + 1}`}
                    </Typography>
                    <Typography sx={{ mt: 0.35, fontSize: 13, fontWeight: 650, lineHeight: 1.4, color: normalizerTheme.text, wordBreak: 'break-word' }}>
                      {example.source}
                    </Typography>
                    {showSelectedSlashVariantExpansion && selectedSlashVariantExpansion?.example && (
                      <Box
                        sx={{
                          mt: 0.9,
                          p: 1,
                          borderRadius: '8px',
                          border: `1px solid ${selectedSlashVariantStaged ? '#86efac' : normalizerTheme.border}`,
                          bgcolor: selectedSlashVariantStaged ? 'rgba(34, 197, 94, 0.09)' : normalizerTheme.paper,
                        }}
                      >
                        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} gap={1}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: normalizerTheme.text }}>
                              Slash variant expansion
                            </Typography>
                            <Stack direction="row" gap={0.65} flexWrap="wrap" sx={{ mt: 0.65 }}>
                              {(selectedSlashVariantExpansion.example.pairs || []).map((pair, pairIndex) => (
                                <Chip
                                  key={`${selectedParsingPattern.key}-slash-preview-${pairIndex}-${pair.mpn}`}
                                  size="small"
                                  color={pairIndex === 0 ? 'success' : undefined}
                                  variant={pairIndex === 0 ? 'filled' : 'outlined'}
                                  label={`${pairIndex === 0 ? 'Primary' : `Alt ${pairIndex}`}: ${pair.mpn}`}
                                  sx={{ fontWeight: 700 }}
                                />
                              ))}
                              <Chip
                                size="small"
                                color="info"
                                label={`MFR: ${selectedSlashVariantExpansion.example.manufacturer}`}
                                sx={{ fontWeight: 700 }}
                              />
                            </Stack>
                          </Box>
                          <Button
                            size="small"
                            variant={selectedSlashVariantStaged ? 'outlined' : 'contained'}
                            disabled={!selectedParsingPattern || configureParserPreparing}
                            onClick={handleExpandSlashVariantsForPattern}
                            sx={{ minWidth: 154, fontWeight: 800, textTransform: 'none' }}
                          >
                            {selectedSlashVariantStaged ? 'Expansion staged' : 'Use expansion'}
                          </Button>
                        </Stack>
                      </Box>
                    )}
                    <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mt: 0.85 }}>
                      {(example.outputs || []).map((item, outputIndex) => (
                        <Chip
                          key={`${selectedParsingPattern.key}-output-${outputIndex}-${item.label}`}
                          size="small"
                          color={item.type === 'mpn' ? 'success' : item.type === 'mfr' ? 'info' : undefined}
                          variant={item.type === 'discard' ? 'outlined' : 'filled'}
                          label={item.label}
                          sx={{
                            fontWeight: item.type === 'discard' ? 600 : 700,
                            color: item.type === 'discard' ? normalizerTheme.muted : undefined,
                            borderColor: item.type === 'discard' ? normalizerTheme.borderStrong : undefined,
                            bgcolor: item.type === 'tag' ? '#7c3aed' : item.type === 'spec' ? '#f59e0b' : item.type === 'custom' ? '#6366f1' : item.type === 'direct' ? '#0f766e' : undefined,
                          }}
                        />
                      ))}
                      {(example.pairs || []).map((pair, pairIndex) => (
                        <React.Fragment key={`${selectedParsingPattern.key}-${pairIndex}-${pair.mpn}-${pair.manufacturer}`}>
                          <Chip size="small" color="success" label={`MPN: ${pair.mpn}`} sx={{ fontWeight: 650 }} />
                          <Chip size="small" color="info" label={`MFR: ${pair.manufacturer}`} sx={{ fontWeight: 650 }} />
                          {pair.discarded && <Chip size="small" variant="outlined" label={`Ignore: ${pair.discarded}`} sx={{ fontWeight: 600, color: normalizerTheme.muted }} />}
                        </React.Fragment>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>

              <Box sx={{ mt: 1.25 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setSelectedParsingDetailsOpen(open => !open)}
                  endIcon={selectedParsingDetailsOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                  sx={{ minHeight: 28, fontSize: 11.5, fontWeight: 750, textTransform: 'none' }}
                >
                  {selectedParsingDetailsOpen ? 'Hide raw matched rows' : 'View raw matched rows'}
                </Button>
              </Box>

              {selectedParsingDetailsOpen && (
                <Box sx={{ mt: 1.25 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 750, color: normalizerTheme.text }}>
                    Raw matched source rows
                  </Typography>
                  <Stack
                    gap={0.85}
                    sx={{
                      mt: 0.8,
                      maxHeight: 260,
                      overflowY: 'auto',
                      pr: 0.5,
                    }}
                  >
                    {(selectedParsingPattern.pattern.matchedRows || []).map((matchedRow, rowIndex) => (
                      <Box
                        key={`${selectedParsingPattern.key}-matched-${matchedRow.sourceRow || rowIndex}-${rowIndex}`}
                        sx={{
                          p: 1,
                          borderRadius: '8px',
                          border: `1px solid ${normalizerTheme.border}`,
                          bgcolor: normalizerTheme.paperSoft,
                        }}
                      >
                        <Typography sx={{ fontSize: 11.25, fontWeight: 700, color: normalizerTheme.muted }}>
                          {matchedRow.sourceRow
                            ? `Source row ${matchedRow.sourceRow}${matchedRow.entryCount > 1 ? ` - ${matchedRow.entryCount} entries in source cell` : ''}`
                            : `Matched row ${rowIndex + 1}`}
                        </Typography>
                        <Typography sx={{ mt: 0.25, fontSize: 12.5, fontWeight: 600, lineHeight: 1.4, color: normalizerTheme.text, wordBreak: 'break-word' }}>
                          {matchedRow.source}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}
            </Paper>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            disabled={selectedParsingPatternIndex <= 0}
            onClick={() => handleStepParsingPattern(-1)}
          >
            Back
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              const hasNextPattern = selectedParsingPatternIndex >= 0 && selectedParsingPatternIndex < parsingPatternOptions.length - 1;
              if (hasNextPattern) {
                handleStepParsingPattern(1);
                return;
              }
              setParsingLogicOpen(false);
              setPatternApplyNotice('');
              runNormalization();
            }}
          >
            {selectedParsingPatternIndex >= 0 && selectedParsingPatternIndex < parsingPatternOptions.length - 1 ? 'Next' : 'Continue'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Review normalization summary</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, color: '#536171', mb: 1.5 }}>
            FactWise parsed the sheet using your selected columns and parser settings. Confirm before opening the editable output sheet.
          </Typography>
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Chip label={`${normalizationSummary?.totalRows || 0} output rows`} />
            <Chip label={`${normalizationSummary?.primaryRows || 0} primary rows`} />
            <Chip label={`${normalizationSummary?.alternateRows || 0} alternates`} />
            <Chip label={`${normalizationSummary?.uniqueRawMaterials || 0} unique values`} />
            <Chip label={`${normalizationSummary?.skippedRows || 0} skipped source rows`} />
            <Chip
              color={(normalizationSummary?.pairingIssueRows || 0) > 0 ? 'warning' : 'success'}
              label={(normalizationSummary?.pairingIssueRows || 0) > 0
                ? `${normalizationSummary?.pairingIssueRows || 0} pairing review${normalizationSummary?.pairingIssueRows === 1 ? '' : 's'} handled`
                : `${normalizationSummary?.pairingMatchedRows || 0}/${normalizationSummary?.pairingCheckedRows || 0} pairing checks passed`}
            />
          </Stack>
          <Box sx={{ mt: 1.7 }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              gap={1}
              onClick={() => setSummaryParserDetailsOpen((prev) => !prev)}
              sx={{
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <Typography sx={{ fontSize: 13, fontWeight: 750, color: normalizerTheme.text }}>
                Parser settings and rules
              </Typography>
              <IconButton
                size="small"
                aria-label={summaryParserDetailsOpen ? 'Hide parser settings and rules' : 'Show parser settings and rules'}
                sx={{
                  width: 28,
                  height: 28,
                  color: normalizerTheme.text,
                }}
              >
                {summaryParserDetailsOpen ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
              </IconButton>
            </Stack>
            {summaryParserDetailsOpen && (
              <Box sx={{ mt: 0.85 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: normalizerTheme.text }}>
                  Parser settings used
                </Typography>
                <Stack direction="row" gap={0.8} flexWrap="wrap" sx={{ mt: 0.75 }}>
                  <Chip size="small" label={selectedStructureOption?.label || 'Parser: auto'} />
                  <Chip size="small" label={`Delimiter: ${delimiterLabel}`} />
                  <Chip size="small" label={selectedAlternateOption?.label || 'Alternates: auto'} />
                  <Chip size="small" label={selectedQuantityOption?.label || 'Quantity/UOM: default'} />
                  <Chip size="small" label="Blank BOM level: 1" />
                </Stack>
                <Typography sx={{ mt: 1.1, fontSize: 12.5, fontWeight: 800, color: normalizerTheme.text }}>
                  Logic rules applied
                </Typography>
                <Stack direction="row" gap={0.8} flexWrap="wrap" sx={{ mt: 0.7 }}>
                  {parserLogicRules.map((rule) => (
                    <Chip key={rule} size="small" variant="outlined" label={rule} />
                  ))}
                </Stack>
              </Box>
            )}
          </Box>
          <Typography sx={{ mt: 2, fontSize: 13, color: '#66717f' }}>
            If these numbers look off, go back and adjust the columns, delimiter, or cleanup options.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Back</Button>
          <Button
            variant="contained"
            onClick={() => {
              setConfirmOpen(false);
              setCurrentStep(4);
            }}
          >
            Proceed
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={configureSplitColsOpen}
        onClose={() => {
          setConfigureSplitColsOpen(false);
          setConfigureParserSessionId('');
          setConfigureParserInitialColumn('');
          setConfigureParserTitle('Split into Columns');
          setConfigureParserScope(null);
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{configureParserTitle}</DialogTitle>
        <DialogContent>
          {configureParserSessionId ? (
            <ColumnParser
              sessionId={configureParserSessionId}
              availableColumns={headers}
              initialColumn={configureParserInitialColumn}
              parseReference={configureParserReference}
              sampleUnit={configureParserScope?.mode === 'pattern' ? 'group' : 'row'}
              describeSample={describeParserSample}
              onApply={handleApplyConfigureSplitColumns}
            />
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 3 }}>
              <CircularProgress size={18} />
              <Typography sx={{ fontSize: 14, color: '#66717f' }}>Preparing...</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setConfigureSplitColsOpen(false);
              setConfigureParserSessionId('');
              setConfigureParserInitialColumn('');
              setConfigureParserTitle('Split into Columns');
              setConfigureParserScope(null);
            }}
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* BOM structure gate — asked on the way to mapping, once the normalized
          rows are on screen and the questions can be answered from real output. */}
      <BomStructureDialog
        open={bomStructureOpen}
        onClose={() => { setBomStructureOpen(false); setPendingBomAction(null); }}
        sheetNames={bomStructureSheetNames}
        getSheetHeaders={bomStructureHeaderReader}
        getSheetRecords={bomStructureRecordReader}
        getSheetPreambleRows={bomStructurePreambleReader}
        initialAnswers={bomStructureSeed}
        onConfirm={handleBomStructureConfirm}
      />
    </Box>
  );
};

export default BomNormalizer;
