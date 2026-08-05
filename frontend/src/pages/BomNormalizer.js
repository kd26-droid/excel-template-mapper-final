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
  Typography,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import api from '../services/api';
import {
  createFactwiseIds,
  createTagColumn,
  getNextTagColumn,
  getNormalizedExportColumns,
  getSerialPreviewValues,
} from '../lib/bomNormalizerAlgorithms';
import {
  ALTERNATE_LAYOUT_OPTIONS,
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
  /\bdescription\b/, /\btype\b/, /\buom\b/, /\bqty\b/, /\bquantity\b/,
  /\bmanufacturer\b/, /\bmanufacture\b/, /\bmpn\b/, /\bmfr\b/, /\bdesignator/,
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
    + keywordHits * 5
    + supportedColumns * 1.4
    + dataRowsBelow * 1.2
    + shortLabelRatio * 8
    - (longCells / count) * 40
    - (proseCells / count) * 30
    - (numericCells / count) * numericPenalty
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
  .filter((row) => row.some((cell) => fmt(cell)))
  .map((row, rowIndex) => {
    const mapped = {};
    currentHeaders.forEach((header, index) => {
      mapped[header] = fmt(row[index]);
    });
    mapped.__sourceRow = startRowNumber + rowIndex;
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

const getCellStyleInfo = (cell = {}) => {
  const style = cell?.s || {};
  const font = style.font || {};
  const red = colorLooksRed(font.color) || colorLooksRed(style.fgColor) || colorLooksRed(style.color);
  const strike = Boolean(font.strike || font.strikethrough);
  return { red, strike };
};

const worksheetToCompactRows = (worksheet) => {
  const cells = Object.keys(worksheet).filter((key) => !key.startsWith('!'));
  let maxRow = -1;
  const valuesByCell = new Map();
  const metaByRow = new Map();
  const usedColumns = new Set();
  const outlineRows = Array.isArray(worksheet?.['!rows']) ? worksheet['!rows'] : [];

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
    usedColumns.add(position.c);
    valuesByCell.set(`${position.r}:${position.c}`, value);
    const styleInfo = getCellStyleInfo(cell);
    if (styleInfo.red || styleInfo.strike) {
      const rowMeta = metaByRow.get(position.r) || { redStyle: false, strikeStyle: false, deletedStyle: false };
      rowMeta.redStyle = rowMeta.redStyle || styleInfo.red;
      rowMeta.strikeStyle = rowMeta.strikeStyle || styleInfo.strike;
      rowMeta.deletedStyle = rowMeta.deletedStyle || styleInfo.red || styleInfo.strike;
      metaByRow.set(position.r, rowMeta);
    }
  });

  if (maxRow < 0 || !usedColumns.size) return [];

  const columns = [...usedColumns].sort((a, b) => a - b);

  const rows = [];
  for (let rowIndex = 0; rowIndex <= maxRow; rowIndex += 1) {
    const row = columns.map((colIndex) => valuesByCell.get(`${rowIndex}:${colIndex}`) || '');
    row.__rowMeta = metaByRow.get(rowIndex) || null;
    rows.push(row);
  }

  return rows;
};

const detectHeaderRow = (rows) => {
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

const inferRoles = (headers) => {
  const learnedHeaders = getLearnedRoleHeaders();
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
  const strongMpnHeader = findHeader([
    /\bmpn\b/,
    /manufacturer equivalent/,
    /manufacturer part/,
    /manufacturing part/,
    /\bmfr part/,
    /\bmfg part/,
    /producer/,
  ]);
  const genericPartHeader = findHeader([/^part number$/, /^part no$/, /^part$/, /^partno$/], [/manufacturer/, /\bmpn\b/, /\bmfr\b/, /\bmfg\b/]);
  const learnedMpn = findLearnedHeader('mpn');
  const learnedCpn = findLearnedHeader('cpn');
  const mpnHeader = strongMpnHeader || learnedMpn || findHeader([/manufacturer equivalent/, /manufacturer part/, /\bmpn\b/, /producer/, /part number/]);
  const cpnHeader = learnedCpn || findHeader([/\bcpn\b/, /customer part/, /client part/, /internal part/, /part code/]) ||
    (genericPartHeader && genericPartHeader !== mpnHeader ? genericPartHeader : '');

  return {
    cpn: cpnHeader,
    mpn: mpnHeader,
    manufacturer: findLearnedHeader('manufacturer') || findHeader([/^manufacturer$/, /\bmfr\b/, /manufacturer name/, /producer/], [/equivalent/, /part/, /\bmpn\b/]) ||
      findHeader([/manufacturer/], [/equivalent/, /part/, /\bmpn\b/]),
    description: findLearnedHeader('description') || findHeader([/description/, /item name/, /\bname\b/]),
    quantity: findLearnedHeader('quantity') || findHeader([/quantity/, /\bqty\b/, /^count$/, /\bcount\b/]),
    uom: findLearnedHeader('uom') || findHeader([/\buom\b/, /measurement unit/, /\bunit\b/]),
    level: headers.find((header) => normalizeKey(header).startsWith(normalizeKey(EXCEL_OUTLINE_LEVEL_HEADER)))
      || (findLearnedHeader('level') || findHeader([/\blevel\b/])),
    parent: findLearnedHeader('parent') || findHeader([/parent/, /finished good/, /bom id/, /item code/, /assembly/]),
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

const normalizeMpnParts = (parts) => parts
  .map(stripVendorPrefix)
  .map((part) => fmt(part).replace(/^(?:and|or|and\/or)\s+/i, '').replace(/\s+(?:and|or|and\/or)$/i, '').trim())
  .filter((part) => part && !isConnectorOnlyMpnPart(part));

const splitDelimited = (value) => {
  const text = fmt(value);
  if (!text) return [];
  const parts = [];
  let current = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if ([';', '|', '\n'].includes(char)) {
      if (fmt(current)) parts.push(fmt(current).replace(/^[,;|]+|[,;|]+$/g, ''));
      current = '';
      continue;
    }
    if (char === ',') {
      const next = text.slice(index + 1).trim().split(/[;,|\n]/)[0];
      if (next && !/^\d{1,4}(\s|$)/.test(next)) {
        if (fmt(current)) parts.push(fmt(current).replace(/^[,;|]+|[,;|]+$/g, ''));
        current = '';
        continue;
      }
    }
    current += char;
  }

  if (fmt(current)) parts.push(fmt(current).replace(/^[,;|]+|[,;|]+$/g, ''));
  return parts.filter(Boolean);
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
  return text
    .split(delimiter)
    .map((part) => fmt(part).replace(/^[,;|]+|[,;|]+$/g, ''))
    .filter(Boolean);
};

const stripVendorPrefix = (value) => {
  const text = fmt(value).replace(/\s+/g, ' ');
  return text
    .replace(/^(?:[A-Za-z]{5,}|\d{5})\s*(?:-\s*|\s+)/, '')
    .replace(/^AGILE\s*(?:-\s*|:\s*|\s+)/i, '')
    .trim();
};

const splitMpnCell = (value, config = {}) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text) return [];

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

const parsePackedMpnManufacturerPairs = (value, config = {}) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text || !text.includes(':')) return [];

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

const splitManufacturerCell = (value, expectedCount, config = {}) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text) return [];
  const directory = config.manufacturerDirectory || {};
  const directoryNames = Array.isArray(directory.names) ? directory.names : [];
  const directoryAliases = directory.aliases || {};
  const canonicalForManufacturer = (name) => {
    const key = normalizeKey(name).toUpperCase();
    return directoryAliases[key] || name;
  };

  const delimiter = selectedDelimiter(config);
  const explicitParts = splitByExplicitDelimiter(text, delimiter);
  if (explicitParts.length > 1) return explicitParts.map(canonicalForManufacturer);

  const colonSegments = parseColonSegments(text);
  if (colonSegments.length > 1) return colonSegments.map((segment) => canonicalForManufacturer(segment.label));

  const delimited = splitDelimited(text);
  if (delimited.length > 1) return delimited.map(canonicalForManufacturer);

  const normalizedText = normalizeKey(text).toUpperCase();
  const knownPhrases = [
    ...directoryNames,
    ...Object.keys(directoryAliases),
    ...KNOWN_MANUFACTURERS,
  ];
  const seenPhrases = new Set();
  const knownMatches = [...new Set(knownPhrases
    .filter((name) => {
      const key = normalizeKey(name).toUpperCase();
      if (!key || seenPhrases.has(key) || !normalizedText.includes(key)) return false;
      seenPhrases.add(key);
      return true;
    })
    .sort((a, b) => normalizedText.indexOf(normalizeKey(a).toUpperCase()) - normalizedText.indexOf(normalizeKey(b).toUpperCase()))
    .map(canonicalForManufacturer))];
  if (knownMatches.length >= Math.min(expectedCount || 1, 2)) return knownMatches;

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

const isPlaceholderCell = (value) => {
  const text = fmt(value).replace(/\u00a0/g, ' ').trim().toLowerCase();
  return !text || /^[-–—]+$/.test(text) || ['n/a', 'na', 'null', 'none'].includes(text);
};

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

const rowLooksLikeDeleted = (row, headers) => {
  if (row.__deletedRowStyle || row.__redRowStyle || row.__strikeRowStyle) return true;
  const text = rowValues(row, headers).join(' ').toLowerCase();
  return /\b(deleted|delete|removed|obsolete|cancelled|canceled)\b/.test(text);
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

const hasGroupedRowContext = (row, roles) => Boolean(
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
  if (!sourceHeaders.length) return normalizedRow;
  const consumedSourceHeaders = config.consumedSourceHeaders instanceof Set
    ? config.consumedSourceHeaders
    : new Set((config.consumedSourceHeaders || []).map(normalizeKey));

  const carried = { ...normalizedRow };
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
    const mpns = splitMpnCell(getCell(row, roles.mpn), config);
    const explicitDelimiterUsed = Boolean(selectedDelimiter(config)) && mpns.length > 1;
    const manufacturers = splitManufacturerCell(getCell(row, roles.manufacturer), mpns.length, config);
    const primaryManufacturer = manufacturers[0] || '';
    const quantity = getCell(row, roles.quantity);
    const uom = getCell(row, roles.uom);
    const parentKey = getCell(row, roles.parent) || getCell(row, roles.description) || `Source row ${sourceRow}`;
    const level = getCell(row, roles.level) || '1';
    const rule = explicitDelimiterUsed ? 'separate_cells_user_delimiter' : 'separate_cells_position_pairing';
    const cpn = getCell(row, roles.cpn);

    mpns.forEach((mpn, partIndex) => {
      const isPrimary = partIndex === 0;
      const manufacturer = manufacturers[partIndex] || (!isPrimary && config.manufacturerMode === 'inherit_blank' ? primaryManufacturer : '');
      output.push(withSourceColumns({
        sourceRow,
        parentKey,
        relation: isPrimary ? 'Primary' : `Alternate ${partIndex}`,
        level,
        cpn,
        description: getCell(row, roles.description),
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
    const sourceText = getCell(row, roles.mpn) || getCell(row, roles.manufacturer);
    const packedPairs = parsePackedMpnManufacturerPairs(sourceText, config);
    const segments = parseColonSegments(sourceText);
    const quantity = getCell(row, roles.quantity);
    const uom = getCell(row, roles.uom);
    const parentKey = getCell(row, roles.parent) || getCell(row, roles.description) || `Source row ${sourceRow}`;
    const level = getCell(row, roles.level) || '1';
    const cpn = getCell(row, roles.cpn);

    if (packedPairs.length) {
      packedPairs.forEach((pair, partIndex) => {
        output.push(withSourceColumns({
          sourceRow,
          parentKey,
          relation: partIndex === 0 ? 'Primary' : `Alternate ${partIndex}`,
          level,
          cpn,
          description: getCell(row, roles.description),
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

    if (!segments.length) {
      splitMpnCell(sourceText, config).forEach((mpn, partIndex) => {
        output.push(withSourceColumns({
          sourceRow,
          parentKey,
          relation: partIndex === 0 ? 'Primary' : `Alternate ${partIndex}`,
          level,
          cpn,
          description: getCell(row, roles.description),
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
          relation: relationIndex === 0 ? 'Primary' : `Alternate ${relationIndex}`,
          level,
          cpn,
          description: getCell(row, roles.description),
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
  return consumed;
};

const normalizeAlternateColumns = (rows, headers, roles, config) => {
  const output = [];
  const manualGroups = cleanAlternateColumnGroups(config.alternateColumnGroups || [], headers);
  const alternateGroups = manualGroups.length ? manualGroups : findAlternateColumnGroups(headers);
  rows.forEach((row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const primaryMpn = getCell(row, roles.mpn);
    const primaryManufacturer = getCell(row, roles.manufacturer);
    const primaryQty = getCell(row, roles.quantity);
    const primaryUom = getCell(row, roles.uom);
    const parentKey = getCell(row, roles.parent) || getCell(row, roles.description) || `Source row ${sourceRow}`;
    const level = getCell(row, roles.level) || '1';
    const cpn = getCell(row, roles.cpn);

    if (primaryMpn) {
      output.push(withSourceColumns({
        sourceRow,
        parentKey,
        relation: 'Primary',
        level,
        cpn,
        description: getCell(row, roles.description),
        mpn: stripVendorPrefix(primaryMpn),
        manufacturer: primaryManufacturer,
        quantity: primaryQty,
        uom: primaryUom,
        rule: 'alternate_columns_primary',
        confidence: confidenceForRow(primaryMpn, primaryManufacturer, 'alternate_columns'),
        discardedText: '',
      }, row, config));
    }

    alternateGroups.forEach((group, groupIndex) => {
      const mpn = getCell(row, group.mpn);
      if (!mpn) return;
      const manufacturer = getCell(row, group.mfr) || (config.manufacturerMode === 'inherit_blank' ? primaryManufacturer : '');
      output.push(withSourceColumns({
        sourceRow,
        parentKey,
        relation: `Alternate ${groupIndex + 1}`,
        level,
        cpn,
        description: getCell(row, roles.description),
        mpn: stripVendorPrefix(mpn),
        manufacturer,
        quantity: config.quantityMode === 'alternate_columns' ? getCell(row, group.qty) || primaryQty : primaryQty,
        uom: config.quantityMode === 'alternate_columns' ? getCell(row, group.uom) || primaryUom : primaryUom,
        rule: 'alternate_columns_unpivot',
        confidence: confidenceForRow(mpn, manufacturer, 'alternate_columns'),
        discardedText: '',
      }, row, config));
    });
  });
  return output;
};

const normalizeOnePerRow = (rows, roles, config = {}) => rows.map((row, rowIndex) => {
  const sourceRow = row.__sourceRow || rowIndex + 1;
  const mpn = stripVendorPrefix(getCell(row, roles.mpn));
  const manufacturer = getCell(row, roles.manufacturer);
  return withSourceColumns({
    sourceRow,
    parentKey: getCell(row, roles.parent) || getCell(row, roles.description) || `Source row ${sourceRow}`,
    relation: 'Primary',
    level: getCell(row, roles.level) || '1',
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
    const parentKey = getCell(row, roles.parent)
      || getCell(row, roles.description)
      || getCell(row, roles.cpn)
      || `Source row ${sourceRow}`;

    return withSourceColumns({
      sourceRow,
      parentKey,
      relation: groupIndex === 0 ? 'Primary' : `Alternate ${groupIndex}`,
      level: getCell(row, roles.level) || '1',
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
    const parentKey = getCell(row, roles.parent) || getCell(row, roles.description) || `Source row ${sourceRow}`;
    const level = getCell(row, roles.level) || '1';
    const cpn = getCell(row, roles.cpn);

    manufacturers.forEach((manufacturer, partIndex) => {
      output.push(withSourceColumns({
        sourceRow,
        parentKey,
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
    const parentKey = getCell(row, roles.parent) || cpn || getCell(row, roles.description) || `Source row ${sourceRow}`;
    return {
      sourceRow,
      parentKey,
      cpn,
      description: getCell(row, roles.description),
      quantity: getCell(row, roles.quantity),
      uom: getCell(row, roles.uom),
      level: getCell(row, roles.level) || '1',
      relationCount: 0,
    };
  };

  const rowStartsGroup = (row) => {
    const nextParentKey = getCell(row, roles.parent) || getCell(row, roles.cpn) || getCell(row, roles.description);
    const hasIdentity = Boolean(getCell(row, roles.parent) || getCell(row, roles.cpn) || getCell(row, roles.description));
    const hasRealContext = Boolean(
      !isPlaceholderCell(getCell(row, roles.quantity)) ||
      !isPlaceholderCell(getCell(row, roles.uom)) ||
      !isPlaceholderCell(getCell(row, roles.level))
    );
    const hasPart = Boolean(getCell(row, roles.mpn) || getCell(row, roles.manufacturer));
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
    const rowHasPart = Boolean(rawMpn || manufacturer);
    const startsGroup = rowStartsGroup(row);

    if (startsGroup || !currentGroup) {
      const nextGroup = groupValuesFromRow(row, rowIndex);
      currentGroup = currentGroup && !startsGroup ? {
        ...currentGroup,
        ...Object.fromEntries(Object.entries(nextGroup).filter(([, value]) => value)),
      } : nextGroup;

      const contextPrimaryMpn = currentGroup.cpn || getCell(row, roles.parent);
      const shouldEmitHeaderPrimary = config.groupHeaderMode === 'header_primary';
      if (startsGroup && !rowHasPart && contextPrimaryMpn && shouldEmitHeaderPrimary) {
        const primaryMpn = contextPrimaryMpn;
        output.push(withSourceColumns({
          sourceRow: currentGroup.sourceRow || sourceRow,
          parentKey: currentGroup.parentKey,
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
        relation: relationIndex === 0 ? 'Primary' : `Alternate ${relationIndex}`,
        level: currentGroup.level || getCell(row, roles.level) || '1',
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

const normalizeRows = (rows, headers, roles, config) => {
  const configWithSourceHeaders = {
    ...config,
    sourceHeaders: headers,
    consumedSourceHeaders: getConsumedSourceHeaders(roles, config, headers),
  };
  if (config.structure === 'grouped_rows') return normalizeGroupedRows(rows, roles, configWithSourceHeaders);
  if (config.structure === 'mpn_only_same_cell') return normalizeSeparateCells(rows, roles, configWithSourceHeaders);
  if (config.structure === 'mpn_only_rows') return normalizeOnePerRow(rows, roles, configWithSourceHeaders);
  if (config.structure === 'mfr_only_same_cell') return normalizeManufacturerOnly(rows, roles, configWithSourceHeaders, true);
  if (config.structure === 'mfr_only_rows') return normalizeManufacturerOnly(rows, roles, configWithSourceHeaders, false);
  if (config.alternateLayout === 'separate_columns') return normalizeAlternateColumns(rows, headers, roles, configWithSourceHeaders);
  if (config.alternateLayout === 'same_group_rows') return normalizeSameGroupRows(rows, roles, configWithSourceHeaders);
  if (config.alternateLayout === 'already_separate_rows') return normalizeOnePerRow(rows, roles, configWithSourceHeaders);
  if (config.structure === 'same_cell') return normalizeSameCell(rows, roles, configWithSourceHeaders);
  if (config.structure === 'one_per_row') return normalizeOnePerRow(rows, roles, configWithSourceHeaders);
  return normalizeSeparateCells(rows, roles, configWithSourceHeaders);
};

const normalizeRowsChunked = async (rows, headers, roles, config, onProgress) => {
  if (config.structure === 'grouped_rows') {
    const dataRows = [];
    let skippedRows = 0;
    rows.forEach((row) => {
      const skip = shouldSkipSourceRow(row, headers, roles, config);
      if (skip) skippedRows += 1;
      else dataRows.push(row);
    });
    const output = normalizeRows(dataRows, headers, roles, config);
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
    output.push(...normalizeRows(dataChunk, headers, roles, config));
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
        parentKey: getCell(row, roles.parent) || getCell(row, roles.description) || getCell(row, roles.cpn) || `Source row ${sourceRow}`,
        mpns: base.mpns,
        manufacturers: base.manufacturers,
        rawMpn: base.rawMpn,
        rawManufacturer: base.rawManufacturer,
      });
    }

    if (config.alternateLayout === 'separate_columns' && alternateGroups.length) {
      const mpns = [getCell(row, roles.mpn), ...alternateGroups.map((group) => getCell(row, group.mpn))]
        .map(stripVendorPrefix)
        .filter(Boolean);
      const manufacturers = [primaryManufacturer, ...alternateGroups.map((group) => getCell(row, group.mfr))]
        .filter(Boolean);
      if (mpns.length > 1) {
        scenarios.push({
          key: `alternate-columns-${sourceRow}`,
          sourceRow,
          parentKey: getCell(row, roles.parent) || getCell(row, roles.description) || getCell(row, roles.cpn) || `Source row ${sourceRow}`,
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
      if (mpnCount === mfrCount) {
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
  const decisions = reviewRows.filter((issue) => issue.action !== 'keep');
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
    const rowBelongsToIssue = (row) => (
      String(row.sourceRow) === String(issue.sourceRow) ||
      (issue.parentKey && normalizeKey(row.parentKey) === normalizeKey(issue.parentKey))
    );
    const manualValues = issue.action === 'manual'
      ? splitManualManufacturers(issue.manualManufacturers)
      : [];
    const firstManufacturer = issue.manufacturers[0] || manualValues[0] || '';

    if (issue.action === 'manual' || issue.action === 'remove_extra') {
      const affectedRows = nextRows.filter((row) => rowBelongsToIssue(row) && mpnKeys.includes(normalizeKey(row.mpn)));
      if (!affectedRows.length) return;
      const templateRow = affectedRows[0];
      const replacementRows = [];
      decisionRows.forEach((decision, index) => {
        if (issue.action === 'remove_extra' && decision.keep === false) return;
        const relationIndex = replacementRows.length;
        const manualValue = manualValues[index] || '';
        const manufacturer = issue.action === 'manual'
          ? (manualValue || decision.manufacturer || manualValues[0] || '')
          : (issue.manufacturers[index] || firstManufacturer || decision.manufacturer || '');
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

const readWorkbookSafely = (buffer, fileName = 'workbook') => {
  if (!XLSX || !XLSX.read || !XLSX.utils) {
    throw new Error('Spreadsheet parser is not ready. Please refresh the page and try uploading again.');
  }

  const attempts = [
    () => XLSX.read(buffer, { type: 'array', cellDates: true, raw: false, cellStyles: true, WTF: false }),
    () => XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true, raw: false, cellStyles: true, WTF: false }),
    () => XLSX.read(arrayBufferToBinaryString(buffer), { type: 'binary', cellDates: true, raw: false, cellStyles: true, WTF: false }),
  ];
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const workbook = attempt();
      if (workbook?.SheetNames?.length) return workbook;
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

const readCsvWorkbookSafely = async (file) => {
  if (!XLSX || !XLSX.read || !XLSX.utils) {
    throw new Error('Spreadsheet parser is not ready. Please refresh the page and try uploading again.');
  }

  const text = await file.text();
  const attempts = [
    () => XLSX.read(text, { type: 'string', raw: false, codepage: 65001 }),
    () => {
      const rows = text
        .split(/\r?\n/)
        .map((line) => line.split(',').map((cell) => fmt(cell).replace(/^"|"$/g, '').replace(/""/g, '"')));
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'CSV_Source');
      return workbook;
    },
  ];
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const workbook = attempt();
      if (workbook?.SheetNames?.length) return workbook;
    } catch (err) {
      lastError = err;
    }
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
  const colonHeavy = mpnSamples.filter((value) => parseColonSegments(value).length > 1).length;
  if (colonHeavy >= Math.max(2, Math.ceil(mpnSamples.length * 0.2))) return 'same_cell';

  const multiMpn = mpnSamples.filter((value) => splitMpnCell(value).length > 1).length;
  const multiMfr = mfrSamples.filter((value) => splitManufacturerCell(value, 2).length > 1).length;
  if (multiMpn) return 'separate_cells';
  if (!multiMpn && multiMfr) return 'one_per_row';

  return 'one_per_row';
};

const nextConfigForDetectedStructure = (previousConfig, detectedStructure) => {
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
      alternateLayout: 'already_separate_rows',
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

const getStructureOptionsForRoles = (roles) => {
  if (roles.mpn && roles.manufacturer && roles.mpn === roles.manufacturer) {
    return STRUCTURE_OPTIONS.filter((option) => option.value === 'same_cell');
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
    /manufacturer part/,
    /manufacturing part/,
    /\bmfr part/,
    /\bmfg part/,
    /producer/,
  ];
  return headers.find((header) => {
    const normalized = normalizeKey(header);
    return patterns.some((pattern) => pattern.test(normalized));
  }) || '';
};

const isGenericPartHeader = (header) => /^part( number| no)?$/.test(normalizeKey(header));

const prepareSingleSheet = (currentWorkbook, currentSheetName, options = {}) => {
  const worksheet = currentWorkbook.Sheets[currentSheetName];
  const rows = worksheetToCompactRows(worksheet);
  const requestedHeaderIndex = Number(options.headerRow);
  const headerIndex = Number.isFinite(requestedHeaderIndex) && requestedHeaderIndex > 0
    ? requestedHeaderIndex - 1
    : detectHeaderRow(rows);
  const columns = getUsableColumnDescriptors(rows, headerIndex);
  const currentHeaders = columns.map((column) => column.header);
  const dataSheetRows = rows.slice(headerIndex + 1).filter((row) => row.some((cell) => fmt(cell)));
  const hasOutlineLevels = dataSheetRows.some((row) => Number(row.__rowMeta?.outlineLevel || 0) > 1);
  const outlineLevelHeader = hasOutlineLevels ? uniqueHeaderName(EXCEL_OUTLINE_LEVEL_HEADER, currentHeaders) : '';
  const outputHeaders = outlineLevelHeader ? [...currentHeaders, outlineLevelHeader] : currentHeaders;
  const currentRows = rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => fmt(cell)))
    .map((row, rowIndex) => {
      const mapped = {};
      columns.forEach((column) => {
        mapped[column.header] = fmt(row[column.index]);
      });
      if (outlineLevelHeader) {
        mapped[outlineLevelHeader] = String(Number(row.__rowMeta?.outlineLevel || 1) || 1);
      }
      mapped.__sourceRow = headerIndex + 2 + rowIndex;
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

const prepareMultipleSheets = (currentWorkbook, sheetNames) => {
  const unionHeaders = ['Source sheet'];
  const combinedRows = [];

  sheetNames.forEach((currentSheetName) => {
    const prepared = prepareSingleSheet(currentWorkbook, currentSheetName);
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

const getFileType = (fileName = '') => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.csv')) return 'csv';
  return 'workbook';
};

const normalizePdfRows = (payload, sourceFile) => {
  const pdfHeaders = makeUniqueHeaders(payload?.headers || []);
  const rawRows = Array.isArray(payload?.data) ? payload.data : [];
  const decision = payload?.decision;
  const decisionLabel = typeof decision === 'string'
    ? decision
    : (decision?.winner || decision?.method || 'best extraction');
  if (!pdfHeaders.length || !rawRows.length) {
    return { headers: [], rows: [] };
  }

  const rows = rawRows
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
          row[detailHeaderMap[column]] = uniqueValues(matches.map((match) => match[column])).join(' | ');
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

const SourcePreview = ({ headers, rows }) => {
  const { isDarkMode, tokens: themeTokens } = useThemeContext();
  const tableTone = {
    bg: themeTokens.table?.background || (isDarkMode ? 'rgba(6, 12, 24, 0.82)' : '#ffffff'),
    header: themeTokens.table?.header || (isDarkMode ? '#111827' : '#f8fafc'),
    text: themeTokens.text?.primary || (isDarkMode ? '#f8fafc' : '#0f172a'),
    border: themeTokens.table?.line || (isDarkMode ? 'rgba(255,255,255,0.08)' : '#e1e6ec'),
  };
  const previewHeaders = headers || [];
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
                {header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={`source-${index}`}>
              {previewHeaders.map((header) => (
                <TableCell key={header} sx={{ minWidth: 170, maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: tableTone.text, borderColor: tableTone.border }}>
                  {row[header]}
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

const buildNormalizerSuggestedMappings = (columns = []) => {
  const available = new Set(columns);
  const candidates = [
    { source: 'cpn', targets: ['CPN Code', 'Customer part number', 'Customer Part Number'] },
    { source: 'mpn', targets: ['MPN Code', 'Manufacturer part number', 'Manufacturer Part Number'] },
    { source: 'description', targets: ['Item name', 'Description', 'SAP Description'] },
    { source: 'quantity', targets: ['Quantity', 'Qty'] },
    { source: 'uom', targets: ['Measurement unit', 'UOM', 'Unit of measure'] },
    { source: 'level', targets: ['Level', 'BOM level'] },
    { source: 'parentKey', targets: ['Parent / group key', 'Parent group key', 'Sub BOM ID', 'BOM ID'] },
    { source: 'manufacturer', targets: ['Manufacturer', 'Preferred vendor code', 'Procurement entity name'] },
  ];

  return candidates
    .filter((mapping) => available.has(mapping.source))
    .map((mapping) => ({
      ...mapping,
      sourceLabel: mapping.source,
      origin: 'bom-normalizer',
    }));
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
  const [pendingPrimaryDeleteIndex, setPendingPrimaryDeleteIndex] = useState(null);
  const [allRowsOpen, setAllRowsOpen] = useState(false);
  const [allRowsPage, setAllRowsPage] = useState(0);
  const visibleColumns = columns.filter((column) => visibleColumnKeys.includes(column.key));
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredRows = rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .filter(({ row }) => {
      if (lowConfidenceOnly && Number(row.confidence || 0) >= 70) return false;
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
        </Stack>
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap" justifyContent="flex-end">
          <Button size="small" variant="outlined" onClick={() => setAllRowsOpen(true)} disabled={!filteredRows.length}>
            View all rows
          </Button>
          <TextField
            size="small"
            label="Search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            sx={{ width: 220 }}
          />
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
                {column.label}
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
                      {column.label}
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
            >
              Previous
            </Button>
            <Button
              variant="outlined"
              disabled={allRowsPage >= allRowsTotalPages - 1}
              onClick={() => setAllRowsPage((page) => Math.min(allRowsTotalPages - 1, page + 1))}
            >
              Next
            </Button>
            <Button variant="contained" onClick={() => setAllRowsOpen(false)}>Done</Button>
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
  }), [isDarkMode, themeTokens]);
  const [workbook, setWorkbook] = useState(null);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [sheetScope, setSheetScope] = useState('single');
  const [selectedSheetNames, setSelectedSheetNames] = useState([]);
  const [sheetRows, setSheetRows] = useState([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [preparedHeaders, setPreparedHeaders] = useState([]);
  const [preparedDataRows, setPreparedDataRows] = useState([]);
  const [sourceEndRow, setSourceEndRow] = useState('');
  const [sourceGridOpen, setSourceGridOpen] = useState(false);
  const [sourceGridPage, setSourceGridPage] = useState(0);
  const [roles, setRoles] = useState(emptyRoles);
  const [config, setConfig] = useState({
    structure: 'separate_cells',
    alternateLayout: 'inside_selected_mpn_columns',
    delimiterMode: 'auto',
    customDelimiter: '',
    groupHeaderMode: 'auto',
    manufacturerMode: 'inherit_blank',
    quantityMode: 'inherit_primary',
    inheritLevels: true,
    skipTitleRows: true,
    skipRepeatedHeaders: true,
    skipDoNotPopulate: false,
    skipDeletedRows: true,
    alternateColumnGroups: [],
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
  const [manufacturerDirectory, setManufacturerDirectory] = useState({ names: [], aliases: {}, loaded: false });
  const [manufacturerMatchOpen, setManufacturerMatchOpen] = useState(false);
  const [manufacturerMatchLoading, setManufacturerMatchLoading] = useState(false);
  const [manufacturerMatchError, setManufacturerMatchError] = useState('');
  const [selectedManufacturerMatches, setSelectedManufacturerMatches] = useState([]);
  const [downloadMenuAnchor, setDownloadMenuAnchor] = useState(null);
  const [toolsMenuAnchor, setToolsMenuAnchor] = useState(null);
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

  const headers = useMemo(
    () => preparedHeaders.length ? preparedHeaders : makeUniqueHeaders(sheetRows[headerRowIndex] || []),
    [preparedHeaders, sheetRows, headerRowIndex]
  );

  const sourceDataRows = useMemo(() => (
    preparedDataRows.length ? preparedDataRows : rowsToObjects(sheetRows.slice(headerRowIndex + 1), headers, headerRowIndex + 2)
  ), [preparedDataRows, sheetRows, headerRowIndex, headers]);

  const dataRows = useMemo(() => (
    filterRowsByEndRow(sourceDataRows, sourceEndRow)
  ), [sourceDataRows, sourceEndRow]);

  const sourceRowsExcludedByLimit = Math.max(0, sourceDataRows.length - dataRows.length);
  const sourceLimitActive = Boolean(sourceEndRow && sourceRowsExcludedByLimit > 0);
  const sourceGridRowsPerPage = 50;
  const sourceGridTotalPages = Math.max(1, Math.ceil(sourceDataRows.length / sourceGridRowsPerPage));
  const sourceGridVisibleRows = useMemo(() => (
    sourceDataRows.slice(
      sourceGridPage * sourceGridRowsPerPage,
      sourceGridPage * sourceGridRowsPerPage + sourceGridRowsPerPage
    )
  ), [sourceDataRows, sourceGridPage]);
  const isSourceRowExcluded = useCallback((row) => (
    Boolean(sourceEndRow) && Number(row?.__sourceRow || 0) > Number(sourceEndRow)
  ), [sourceEndRow]);

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

  const selectedQuantityOption = useMemo(
    () => QTY_OPTIONS.find((option) => option.value === config.quantityMode),
    [config.quantityMode]
  );

  const showManufacturerInheritanceOption = useMemo(() => (
    config.structure !== 'one_per_row' ||
    config.alternateLayout !== 'already_separate_rows'
  ), [config.alternateLayout, config.structure]);

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

  const mergeFilteredPreviewRows = useMemo(() => (
    mergePreview
      ? mergePreview.rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => mergePreviewFilter === 'all' || row.__mergeStatus === mergePreviewFilter)
      : []
  ), [mergePreview, mergePreviewFilter]);

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
      outputColumns: getNormalizedExportColumns(rowsOverride),
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
    () => getStructureOptionsForRoles(roles),
    [roles]
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
    };
    sourceDataRows.forEach((row) => {
      if (rowLooksLikeSectionTitle(row, headers, roles)) detections.skipTitleRows += 1;
      if (rowLooksLikeRepeatedHeader(row, headers)) detections.skipRepeatedHeaders += 1;
      if (rowLooksLikeDoNotPopulate(row, headers)) detections.skipDoNotPopulate += 1;
      if (rowLooksLikeDeleted(row, headers)) detections.skipDeletedRows += 1;
    });
    return detections;
  }, [headers, roles, sourceDataRows]);

  const detectedCleanupOptions = useMemo(
    () => CLEANUP_OPTIONS.filter((option) => cleanupDetections[option.key] > 0),
    [cleanupDetections]
  );

  const roleCombinationHint = useMemo(() => {
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
    return 'Select at least an MPN column to run normalization.';
  }, [roles.manufacturer, roles.mpn]);

  const alternateColumnGroups = useMemo(
    () => cleanAlternateColumnGroups(config.alternateColumnGroups || [], headers),
    [config.alternateColumnGroups, headers]
  );

  const suggestAlternateColumnGroup = useCallback(() => {
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
    const mfr = afterMpn.find((header) => /mfr|manufacturer|vendor|supplier|column/i.test(header)) || afterMpn[0] || '';
    return {
      slot: `${(config.alternateColumnGroups || []).length + 1}`,
      mpn,
      mfr: mfr === mpn ? '' : mfr,
      qty: '',
      uom: '',
    };
  }, [config.alternateColumnGroups, headers, roles]);

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
    const prepared = prepareSingleSheet(nextWorkbook, preferredSheet, { headerRow: options.headerRow });
    const nextHeaders = prepared.headers;
    const nextRoles = inferRoles(nextHeaders);
    const nextStructure = detectBestStructure(nextHeaders, nextRoles, prepared.dataRows.slice(0, 40));

    setWorkbook(nextWorkbook);
    setFileName(nextFileName);
    setSheetName(preferredSheet);
    setSheetScope('single');
    setSelectedSheetNames([preferredSheet]);
    setSheetRows(prepared.sheetRows);
    setHeaderRowIndex(prepared.headerRowIndex);
    setPreparedHeaders(prepared.headers);
    setPreparedDataRows(prepared.dataRows);
    setSourceEndRow('');
    setRoles(nextRoles);
    setConfig((prev) => nextConfigForDetectedStructure(prev, nextStructure));
    setNormalizedRows([]);
    setCurrentStep(1);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setDelimiterTouched(false);
    setParserTouched(false);
    setSkipSourceSetupForMerge(false);
    setNormalizationSummary(null);
    setConfirmOpen(false);
    setError('');
  }, []);

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
      ? `${initialFile.name || 'file'}-${initialFile.size || 0}-${initialFile.lastModified || 0}-${state.initialFileMode || 'source'}-${state.initialSheetName || ''}-${state.initialHeaderRow || ''}`
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
          handleWorkbookLoaded(nextWorkbook, initialFile.name, {
            sheetName: state.initialSheetName,
            headerRow: state.initialHeaderRow,
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

        const columns = getNormalizedExportColumns(replayRows);
        const rows = replayRows.map((row) => {
          const output = {};
          columns.forEach((column) => {
            output[column] = row[column] || '';
          });
          return output;
        });
        const file = createWorkbookFileFromRows(rows, columns, 'template-replayed-bom.xlsx', 'Normalized BOM');
        const formData = new FormData();
        formData.append('clientFile', file);
        formData.append('sheetName', 'Normalized BOM');
        formData.append('headerRow', '1');
        // Forward the BOM structure answers captured on the upload page so the
        // session created here keeps them.
        if (location.state?.bomStructure) {
          formData.append('bomStructure', JSON.stringify(location.state.bomStructure));
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
    setCombineItems([baseItem]);
    setMergeSources([]);
    setMergePreview(null);
    setMergePreviewFilter('all');
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

  const handleContinueNormalizedToBomMapping = useCallback(() => {
    if (!normalizedRows.length) {
      setError('Run normalization before continuing to BOM Mapping.');
      return;
    }
    const columns = getNormalizedExportColumns(normalizedRows);
    const suggestedMappings = buildNormalizerSuggestedMappings(columns);
    const rows = normalizedRows.map((row) => {
      const output = {};
      columns.forEach((column) => {
        output[column] = row[column] || '';
      });
      return output;
    });
    const file = createWorkbookFileFromRows(rows, columns, 'normalized-bom-for-mapping.xlsx', 'Normalized BOM');
    const formData = new FormData();
    formData.append('clientFile', file);
    formData.append('sheetName', 'Normalized BOM');
    formData.append('headerRow', '1');
    // Forward the BOM structure answers captured on the upload page so the
    // session created here keeps them.
    if (location.state?.bomStructure) {
      formData.append('bomStructure', JSON.stringify(location.state.bomStructure));
    }
    const returnSnapshotKey = saveReturnSnapshot('normalized-results');
    const returnSnapshot = buildNormalizedResultsSnapshot(normalizedRows);

    setBusy(true);
    setError('');
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
              normalizerWorkflow: buildNormalizerWorkflowRecipe('normalized-results', normalizedRows),
            } : null,
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
        setError(err.response?.data?.error || err.message || 'Could not continue to BOM Mapping.');
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

  const handleContinueMergePreviewToBomMapping = useCallback(() => {
    if (!mergePreview) {
      setCombineError('Build the merge preview first.');
      return;
    }
    const { headers, rows } = getMergePreviewExport(mergePreview, mergeVisibleColumns, mergePreviewFilter);
    if (!rows.length) {
      setCombineError('No merged rows are available for BOM Mapping.');
      return;
    }
    const suggestedMappings = buildNormalizerSuggestedMappings(headers);
    const file = createWorkbookFileFromRows(rows, headers, 'merged-bom-for-mapping.xlsx', 'Merged BOM');
    const formData = new FormData();
    formData.append('clientFile', file);
    formData.append('sheetName', 'Merged BOM');
    formData.append('headerRow', '1');
    // Forward the BOM structure answers captured on the upload page so the
    // session created here keeps them.
    if (location.state?.bomStructure) {
      formData.append('bomStructure', JSON.stringify(location.state.bomStructure));
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
    const nextRoles = inferRoles(nextHeaders);

    setSheetName(nextSheetName);
    setSelectedSheetNames([nextSheetName]);
    setSheetRows(prepared.sheetRows);
    setHeaderRowIndex(prepared.headerRowIndex);
    setPreparedHeaders(prepared.headers);
    setPreparedDataRows(prepared.dataRows);
    setSourceEndRow('');
    setRoles(nextRoles);
    setConfig((prev) => nextConfigForDetectedStructure(prev, detectBestStructure(nextHeaders, nextRoles, prepared.dataRows.slice(0, 40))));
    setNormalizedRows([]);
    setCurrentStep(1);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setDelimiterTouched(false);
    setParserTouched(false);
    setSkipSourceSetupForMerge(false);
    setNormalizationSummary(null);
    setConfirmOpen(false);
  }, [workbook]);

  const applySheetSelection = useCallback((scope, names) => {
    if (!workbook) return;
    const safeNames = names.filter((name) => workbook.SheetNames.includes(name));
    const nextNames = scope === 'all'
      ? workbook.SheetNames
      : (safeNames.length ? safeNames : [workbook.SheetNames[0]]);
    const prepared = scope === 'single'
      ? prepareSingleSheet(workbook, nextNames[0])
      : prepareMultipleSheets(workbook, nextNames);
    const nextRoles = inferRoles(prepared.headers);

    setSheetScope(scope);
    setSelectedSheetNames(nextNames);
    setSheetName(nextNames[0]);
    setSheetRows(prepared.sheetRows);
    setHeaderRowIndex(prepared.headerRowIndex);
    setPreparedHeaders(prepared.headers);
    setPreparedDataRows(prepared.dataRows);
    setSourceEndRow('');
    setRoles(nextRoles);
    setConfig((prev) => nextConfigForDetectedStructure(prev, detectBestStructure(prepared.headers, nextRoles, prepared.dataRows.slice(0, 40))));
    setNormalizedRows([]);
    setCurrentStep(1);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setDelimiterTouched(false);
    setParserTouched(false);
    setSkipSourceSetupForMerge(false);
    setNormalizationSummary(null);
    setConfirmOpen(false);
  }, [workbook]);

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
    const columns = getUsableColumnDescriptors(sheetRows, nextIndex);
    const nextHeaders = columns.length
      ? columns.map((column) => column.header)
      : makeUniqueHeaders(sheetRows[nextIndex] || []);
    const nextRoles = inferRoles(nextHeaders);
    setHeaderRowIndex(nextIndex);
    setPreparedHeaders(nextHeaders);
    setPreparedDataRows(sheetRows
      .slice(nextIndex + 1)
      .filter((row) => row.some((cell) => fmt(cell)))
      .map((row, rowIndex) => {
        const mapped = {};
        columns.forEach((column) => {
          mapped[column.header] = fmt(row[column.index]);
        });
        mapped.__sourceRow = nextIndex + 2 + rowIndex;
        return mapped;
      }));
    setSourceEndRow('');
    setRoles(nextRoles);
    setNormalizedRows([]);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setNormalizationSummary(null);
    setParserTouched(false);
    setSkipSourceSetupForMerge(false);
    setConfirmOpen(false);
  }, [sheetRows]);

  const handleRoleChange = useCallback((role, header) => {
    setRoles((prev) => ({ ...prev, [role]: header }));
    if (header) rememberRoleHeader(role, header);
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
    setPairingReviewOpen(false);
    setPendingNormalization(null);
    commitNormalizedResult(pendingNormalization.rows, pendingNormalization.pairingCheck);
  }, [commitNormalizedResult, pendingNormalization]);

  const handleNormalize = useCallback(async () => {
    if (!dataRows.length) {
      setError('No data rows found below the selected header row.');
      return;
    }
    if (!roles.mpn && !roles.manufacturer) {
      setError('Select at least an MPN or Manufacturer column before running normalization.');
      return;
    }
    setBusy(true);
    setProgress({ processed: 0, total: dataRows.length, outputRows: 0, skippedRows: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const result = await normalizeRowsChunked(dataRows, headers, roles, config, setProgress);
      const pairingCheck = analyzeMpnManufacturerPairing(dataRows, headers, roles, config);
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
  }, [commitNormalizedResult, config, dataRows, headers, roles]);

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
      alternateLayout: 'inside_selected_mpn_columns',
      delimiterMode: 'auto',
      customDelimiter: '',
      groupHeaderMode: 'auto',
      manufacturerMode: 'inherit_blank',
      quantityMode: 'inherit_primary',
      inheritLevels: true,
      skipTitleRows: true,
      skipRepeatedHeaders: true,
      skipDoNotPopulate: false,
      skipDeletedRows: true,
      alternateColumnGroups: [],
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
      alternateLayout: 'inside_selected_mpn_columns',
      delimiterMode: 'auto',
      customDelimiter: '',
      groupHeaderMode: 'auto',
      manufacturerMode: 'inherit_blank',
      quantityMode: 'inherit_primary',
      inheritLevels: true,
      skipTitleRows: true,
      skipRepeatedHeaders: true,
      skipDoNotPopulate: false,
      skipDeletedRows: true,
      alternateColumnGroups: [],
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
      if (nextStructure === prev.structure) return prev;
      return nextConfigForDetectedStructure(prev, nextStructure);
    });
  }, [currentStep, dataRows, headers, parserTouched, roles]);

  useEffect(() => {
    if (currentStep === 4) return;
    if (!availableStructureOptions.length) return;
    if (availableStructureOptions.some((option) => option.value === config.structure)) return;
    setConfig((prev) => ({ ...prev, structure: availableStructureOptions[0].value }));
  }, [availableStructureOptions, config.structure, currentStep]);

  useEffect(() => {
    if (combineError.includes('two') && !canPrepareMerge) {
      setCombineError('');
    }
  }, [canPrepareMerge, combineError]);

  useEffect(() => {
    if (currentStep === 4) return;
    const strongMpnHeader = findStrongMpnHeader(headers);
    if (!strongMpnHeader || roles.mpn === strongMpnHeader) return;
    if (!roles.mpn || isGenericPartHeader(roles.mpn) || roles.mpn === roles.cpn) {
      setRoles((prev) => ({ ...prev, mpn: strongMpnHeader }));
      rememberRoleHeader('mpn', strongMpnHeader);
    }
  }, [currentStep, headers, roles.cpn, roles.mpn]);

  useEffect(() => {
    if (currentStep === 4) return;
    if (delimiterTouched || (!roles.mpn && !roles.manufacturer)) return;
    const guessedDelimiter = guessDelimiter(dataRows, roles);
    setConfig((prev) => (
      prev.delimiterMode === guessedDelimiter ? prev : { ...prev, delimiterMode: guessedDelimiter }
    ));
  }, [currentStep, dataRows, delimiterTouched, roles]);

  useEffect(() => {
    if (currentStep === 4) return;
    if (parserTouched) return;
    if (!roles.mpn || !dataRows.length) return;
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
  }, [config, currentStep, dataRows, parserTouched, roles.mpn]);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: normalizerTheme.page,
        color: normalizerTheme.text,
        '& .MuiPaper-root, & .MuiCard-root': {
          bgcolor: `${normalizerTheme.paper} !important`,
          color: `${normalizerTheme.text} !important`,
          borderColor: `${normalizerTheme.border} !important`,
        },
        '& .MuiTableContainer-root': {
          bgcolor: `${normalizerTheme.table} !important`,
          borderColor: `${normalizerTheme.border} !important`,
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
        },
        '& .MuiInputLabel-root, & .MuiFormHelperText-root, & .MuiStepLabel-label': {
          color: `${normalizerTheme.muted} !important`,
        },
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: `${normalizerTheme.borderStrong} !important`,
        },
      }}
    >
      <Box sx={{ px: { xs: 2, lg: 4 }, py: 2.5, borderBottom: `1px solid ${normalizerTheme.border}`, bgcolor: normalizerTheme.header }}>
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'flex-start', md: 'center' }} justifyContent="space-between" gap={2}>
          <Box>
            <Typography sx={{ fontSize: 24, fontWeight: 800, color: normalizerTheme.text }}>BOM Normalizer</Typography>
            <Typography sx={{ mt: 0.4, fontSize: 13, color: normalizerTheme.muted }}>
              Prototype workbench for turning messy BOM sheets into a normalized MPN/MFR/alternate table.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 2, lg: 4 }, py: 3, bgcolor: normalizerTheme.page }}>
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
                            <Button variant="outlined" onClick={handleContinueMergePreviewToBomMapping}>Continue to BOM Mapping</Button>
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
                      value={headerRowIndex + 1}
                      inputProps={{ min: 1, max: Math.max(sheetRows.length, 1) }}
                      disabled={sheetScope !== 'single'}
                      helperText={sheetScope === 'single' ? '' : 'Header row is auto-detected separately for each selected sheet.'}
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
                </Grid>
                <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1.5 }}>
                  <Chip size="small" label={`${headers.length} columns`} />
                  <Chip
                    size="small"
                    label={sourceEndRow ? `${dataRows.length} included / ${sourceDataRows.length} detected rows` : `${dataRows.length} data rows`}
                  />
                  {sourceEndRow && <Chip size="small" color="info" variant="outlined" label={`Using rows through ${sourceEndRow}`} />}
                  {sourceLimitActive && <Chip size="small" color="warning" variant="outlined" label={`${sourceRowsExcludedByLimit} rows excluded`} />}
                  <Chip size="small" label={sheetScope === 'single' ? `Header row ${headerRowIndex + 1}` : `${selectedSheetNames.length} sheets merged`} />
                </Stack>
                <Box sx={{ mt: 2 }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
                    <Typography sx={{ fontWeight: 800 }}>Source preview</Typography>
                    <Button size="small" variant="outlined" onClick={() => setSourceGridOpen(true)} disabled={!sourceDataRows.length}>
                      View all rows
                    </Button>
                  </Stack>
                  {sourceEndRow && (
                    <Alert severity="info" sx={{ mt: 1, mb: 1.25 }}>
                      Preview is filtered to sheet rows up to {sourceEndRow}. Rows after {sourceEndRow} will be ignored during normalization.
                    </Alert>
                  )}
                  <SourcePreview headers={headers} rows={dataRows.slice(0, 8)} />
                </Box>
                <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
                  <Button variant="outlined" onClick={handleBackFromSourceSetup} disabled={busy}>Back</Button>
                  <Button variant="contained" onClick={() => setCurrentStep(2)} disabled={busy}>Next: identify columns</Button>
                </Stack>
              </Paper>
            )}

            {currentStep === 2 && (
              <Paper elevation={0} sx={{ p: 2.5, border: '1px solid #dce2e8' }}>
                <Typography sx={{ fontSize: 18, fontWeight: 800 }}>Configure source columns and parsing</Typography>
                <Typography sx={{ mt: 0.5, fontSize: 13, color: '#66717f' }}>
                  Pick the important columns first. Parser assumptions update automatically from those choices.
                </Typography>
                <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1.2 }}>
                  <Chip size="small" label={`${headers.length} columns`} />
                  <Chip
                    size="small"
                    label={sourceEndRow ? `${dataRows.length} included / ${sourceDataRows.length} detected rows` : `${dataRows.length} data rows`}
                  />
                  {sourceEndRow && <Chip size="small" color="info" variant="outlined" label={`Using rows through ${sourceEndRow}`} />}
                  {sourceLimitActive && <Chip size="small" color="warning" variant="outlined" label={`${sourceRowsExcludedByLimit} rows excluded`} />}
                  <Chip size="small" label={sheetScope === 'single' ? `Header row ${headerRowIndex + 1}` : `${selectedSheetNames.length} sheets merged`} />
                </Stack>
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ fontWeight: 800 }}>Source preview</Typography>
                  <SourcePreview headers={headers} rows={dataRows.slice(0, 8)} />
                </Box>
                <Grid container spacing={1.5} sx={{ mt: 1 }}>
                  {ROLE_FIELDS.map((field) => (
                    <Grid item xs={12} md={6} key={field.key}>
                      <FormControl fullWidth size="small">
                        <InputLabel>{field.label}</InputLabel>
                        <Select
                          value={roles[field.key] || ''}
                          label={field.label}
                          onChange={(event) => handleRoleChange(field.key, event.target.value)}
                        >
                          <MenuItem value="">None</MenuItem>
                          {headers.map((header) => (
                            <MenuItem key={header} value={header}>{header}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  ))}
                </Grid>
                <Paper elevation={0} sx={{ mt: 2, p: 1.5, bgcolor: '#f8fafc', border: '1px solid #e1e6ec' }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 800 }}>Detected setup</Typography>
                  <Typography sx={{ mt: 0.4, fontSize: 13, color: '#536171' }}>{roleCombinationHint}</Typography>
                  <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
                    <Grid item xs={12} md={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Where are MPN and MFR?</InputLabel>
                        <Select
                          value={config.structure}
                          label="Where are MPN and MFR?"
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
                            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Known delimiter</InputLabel>
                        <Select
                          value={config.delimiterMode}
                          label="Known delimiter"
                          onChange={(event) => {
                            setDelimiterTouched(true);
                            setConfig((prev) => ({ ...prev, delimiterMode: event.target.value }));
                          }}
                        >
                          {DELIMITER_OPTIONS.map((option) => (
                            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Where are alternates?</InputLabel>
                        <Select
                          value={config.alternateLayout}
                          label="Where are alternates?"
                          onChange={(event) => {
                            const nextLayout = event.target.value;
                            setConfig((prev) => ({
                              ...prev,
                              alternateLayout: nextLayout,
                              alternateColumnGroups: nextLayout === 'separate_columns' && !(prev.alternateColumnGroups || []).length
                                ? [suggestAlternateColumnGroup()]
                                : prev.alternateColumnGroups,
                            }));
                          }}
                        >
                          {ALTERNATE_LAYOUT_OPTIONS.map((option) => (
                            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Quantity/UOM handling</InputLabel>
                        <Select
                          value={config.quantityMode}
                          label="Quantity/UOM handling"
                          onChange={(event) => setConfig((prev) => ({ ...prev, quantityMode: event.target.value }))}
                        >
                          {QTY_OPTIONS.map((option) => (
                            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    {showManufacturerInheritanceOption && (
                      <Grid item xs={12} md={3}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Alternate manufacturer</InputLabel>
                          <Select
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
                    {config.structure === 'grouped_rows' && (
                      <Grid item xs={12} md={3}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Group header handling</InputLabel>
                          <Select
                            value={config.groupHeaderMode || 'auto'}
                            label="Group header handling"
                            onChange={(event) => setConfig((prev) => ({ ...prev, groupHeaderMode: event.target.value }))}
                          >
                            {GROUP_HEADER_OPTIONS.map((option) => (
                              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>
                    )}
                  </Grid>
                  {config.alternateLayout === 'separate_columns' && config.structure !== 'grouped_rows' && (
                    <Paper elevation={0} sx={{ mt: 1.5, p: 1.25, border: '1px solid #e1e6ec', bgcolor: '#fff' }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" gap={1}>
                        <Box>
                          <Typography sx={{ fontSize: 13, fontWeight: 800 }}>Alternate column groups</Typography>
                          <Typography sx={{ fontSize: 12.5, color: '#66717f' }}>
                            Add one row for each alternate MPN/MFR pair that lives in separate columns.
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
                              <Grid item xs={12} sm={3}>
                                <FormControl fullWidth size="small">
                                  <InputLabel>{`Alt ${groupIndex + 1} MPN`}</InputLabel>
                                  <Select
                                    label={`Alt ${groupIndex + 1} MPN`}
                                    value={group.mpn || ''}
                                    onChange={(event) => updateAlternateColumnGroup(groupIndex, 'mpn', event.target.value)}
                                  >
                                    <MenuItem value="">None</MenuItem>
                                    {headers.map((header) => (
                                      <MenuItem key={header} value={header}>{header}</MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              </Grid>
                              <Grid item xs={12} sm={3}>
                                <FormControl fullWidth size="small">
                                  <InputLabel>{`Alt ${groupIndex + 1} MFR`}</InputLabel>
                                  <Select
                                    label={`Alt ${groupIndex + 1} MFR`}
                                    value={group.mfr || ''}
                                    onChange={(event) => updateAlternateColumnGroup(groupIndex, 'mfr', event.target.value)}
                                  >
                                    <MenuItem value="">None</MenuItem>
                                    {headers.map((header) => (
                                      <MenuItem key={header} value={header}>{header}</MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              </Grid>
                              <Grid item xs={12} sm={2}>
                                <FormControl fullWidth size="small">
                                  <InputLabel>Alt Qty</InputLabel>
                                  <Select
                                    label="Alt Qty"
                                    value={group.qty || ''}
                                    onChange={(event) => updateAlternateColumnGroup(groupIndex, 'qty', event.target.value)}
                                  >
                                    <MenuItem value="">Use primary</MenuItem>
                                    {headers.map((header) => (
                                      <MenuItem key={header} value={header}>{header}</MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              </Grid>
                              <Grid item xs={12} sm={2}>
                                <FormControl fullWidth size="small">
                                  <InputLabel>Alt UOM</InputLabel>
                                  <Select
                                    label="Alt UOM"
                                    value={group.uom || ''}
                                    onChange={(event) => updateAlternateColumnGroup(groupIndex, 'uom', event.target.value)}
                                  >
                                    <MenuItem value="">Use primary</MenuItem>
                                    {headers.map((header) => (
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
                          No alternate columns selected yet. Add a group and choose the alternate MPN column, plus manufacturer if available.
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
                    <strong>Detected rule:</strong> {selectedStructureOption?.description || '-'}
                    {selectedAlternateOption?.description ? ` ${selectedAlternateOption.description}` : ''}
                    {config.structure === 'grouped_rows' && selectedGroupHeaderOption ? ` ${selectedGroupHeaderOption.description}` : ''}
                    {' '}<strong>Delimiter:</strong> {delimiterLabel}.
                    {' '}Blank BOM levels will be treated as level 1.
                  </Typography>
                  {config.alternateLayout === 'same_group_rows' && !roles.parent && (
                    <Alert severity="info" sx={{ mt: 1 }}>
                      Select a Parent / group key such as Ref Designator for best results. Without it, grouping falls back to description, quantity, UOM, and level.
                    </Alert>
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
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1}>
                  <Box>
                    <Typography sx={{ fontSize: 18, fontWeight: 800 }}>Normalized editable sheet</Typography>
                    <Typography sx={{ mt: 0.5, fontSize: 13, color: '#66717f' }}>
                      Review the parsed output, edit cells directly, or delete rows before downloading.
                    </Typography>
                  </Box>
                  <Stack direction="row" gap={1} flexWrap="wrap" justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!normalizedRows.length}
                      onClick={(event) => setToolsMenuAnchor(event.currentTarget)}
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
                      size="small"
                      variant="contained"
                      startIcon={<DownloadIcon />}
                      disabled={!normalizedRows.length}
                      onClick={(event) => setDownloadMenuAnchor(event.currentTarget)}
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
                    {quality.lowConfidence > 0 && (
                      <Chip
                        size="small"
                        clickable
                        color="warning"
                        variant={lowConfidenceOnly ? 'filled' : 'outlined'}
                        label={`${quality.lowConfidence} low confidence`}
                        onClick={() => setLowConfidenceOnly((prev) => !prev)}
                      />
                    )}
                  </Stack>
                </Stack>
                {normalizedRows.length > 0 && (
                  <Box sx={{ mt: 1.5 }}>
                    <LinearProgress variant="determinate" value={quality.average} sx={{ height: 7, borderRadius: 2 }} />
                  </Box>
                )}
                <Paper elevation={0} sx={{ mt: 1.5, p: 1.2, bgcolor: '#f8fafc', border: '1px solid #e1e6ec' }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 800 }}>Parser settings used</Typography>
                  <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 0.8 }}>
                    <Chip size="small" label={selectedStructureOption?.label || 'Parser: auto'} />
                    <Chip size="small" label={`Delimiter: ${delimiterLabel}`} />
                    <Chip size="small" label={selectedAlternateOption?.label || 'Alternates: auto'} />
                    <Chip size="small" label={selectedQuantityOption?.label || 'Quantity/UOM: default'} />
                    <Chip size="small" label="Blank BOM level: 1" />
                  </Stack>
                </Paper>
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
                    <Button variant="outlined" onClick={handleContinueNormalizedToBomMapping} disabled={busy || !normalizedRows.length}>Continue to BOM Mapping</Button>
                    <Button variant="contained" onClick={handleNormalize} disabled={busy}>Run again</Button>
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
              <Chip size="small" label={`${sourceDataRows.length} detected rows`} />
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
                  {headers.map((header) => (
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
                      {headers.map((header) => (
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
                          }}
                        >
                          {row[header]}
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
            <Grid item xs={12} md={4}>
              <Card
                elevation={0}
                onClick={() => handlePdfProcessingChoice('ocr')}
                sx={{ height: '100%', cursor: 'pointer', border: '1px solid #dce2e8', '&:hover': { borderColor: '#1976d2', bgcolor: '#f8fafc' } }}
              >
                <CardContent>
                  <Typography sx={{ fontSize: 16, fontWeight: 800 }}>Simple OCR</Typography>
                  <Typography sx={{ mt: 0.8, fontSize: 13, color: '#66717f' }}>
                    Use Azure OCR directly for clear table PDFs.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={4}>
              <Card
                elevation={0}
                onClick={() => handlePdfProcessingChoice('compare')}
                sx={{ height: '100%', cursor: 'pointer', border: '1px solid #dce2e8', '&:hover': { borderColor: '#1976d2', bgcolor: '#f8fafc' } }}
              >
                <CardContent>
                  <Typography sx={{ fontSize: 16, fontWeight: 800 }}>Compare</Typography>
                  <Typography sx={{ mt: 0.8, fontSize: 13, color: '#66717f' }}>
                    Run native extraction and OCR, then use the cleaner result.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={4}>
              <Card
                elevation={0}
                onClick={() => handlePdfProcessingChoice('zonal')}
                sx={{ height: '100%', cursor: 'pointer', border: '1px solid #dce2e8', '&:hover': { borderColor: '#1976d2', bgcolor: '#f8fafc' } }}
              >
                <CardContent>
                  <Typography sx={{ fontSize: 16, fontWeight: 800 }}>Zone Mapping</Typography>
                  <Typography sx={{ mt: 0.8, fontSize: 13, color: '#66717f' }}>
                    Use manual zones for PDFs with irregular tables or mixed layouts.
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
                          Uncheck the MPN rows that should be removed.
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ color: normalizerTheme.text, borderColor: normalizerTheme.border }}>
                      {issue.manufacturers.length ? (
                        <Stack gap={0.5}>
                          {issue.manufacturers.map((manufacturer, manufacturerIndex) => (
                            <Chip key={`${issue.sourceRow}-mfr-${manufacturerIndex}`} size="small" label={`${manufacturerIndex + 1}. ${manufacturer}`} />
                          ))}
                        </Stack>
                      ) : (
                        <Typography sx={{ fontSize: 13, color: normalizerTheme.muted }}>No manufacturer detected</Typography>
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
                              patch.mpnDecisions = (issue.mpnDecisions || issue.mpns.map((mpn, mpnIndex) => ({
                                mpn,
                                manufacturer: issue.manufacturers[mpnIndex] || issue.manufacturers[0] || '',
                                keep: true,
                              }))).map((decision, decisionIndex) => ({
                                ...decision,
                                keep: decisionIndex < Math.max(1, issue.manufacturers.length),
                              }));
                            }
                            updatePairingReviewRow(index, patch);
                          }}
                        >
                          <MenuItem value="keep">Keep parsed output</MenuItem>
                          <MenuItem value="manual">Use manual manufacturer list</MenuItem>
                          <MenuItem value="remove_extra">Remove extra MPN rows</MenuItem>
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
    </Box>
  );
};

export default BomNormalizer;
