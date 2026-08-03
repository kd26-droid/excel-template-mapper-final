import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
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
import DownloadIcon from '@mui/icons-material/Download';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useThemeContext } from '../utils/ThemeContext';

const ROLE_FIELDS = [
  { key: 'cpn', label: 'CPN / customer part number' },
  { key: 'mpn', label: 'MPN column' },
  { key: 'manufacturer', label: 'Manufacturer column' },
  { key: 'description', label: 'Description / item name' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'uom', label: 'UOM' },
  { key: 'level', label: 'BOM level' },
  { key: 'parent', label: 'Parent / group key' },
];

const STRUCTURE_OPTIONS = [
  {
    value: 'mpn_only_same_cell',
    label: 'Only MPNs are present, all MPNs in one cell',
    description: 'Use this when the sheet has no manufacturer column and one MPN cell contains primary plus alternates.',
  },
  {
    value: 'mpn_only_rows',
    label: 'Only MPNs are present, each row has one MPN',
    description: 'Use this when the sheet has no manufacturer column and each row already has one MPN.',
  },
  {
    value: 'mfr_only_same_cell',
    label: 'Only MFRs are present, all MFRs in one cell',
    description: 'Use this when the sheet has manufacturer names but no MPN column, and one cell contains multiple manufacturers.',
  },
  {
    value: 'mfr_only_rows',
    label: 'Only MFRs are present, each row has one MFR',
    description: 'Use this when the sheet has no MPN column and each row already has one manufacturer.',
  },
  {
    value: 'separate_cells',
    label: 'All MPNs in one cell and all MFRs in another cell',
    description: 'Use this when one column has all MPNs together and another column has all matching manufacturers together in the same order.',
  },
  {
    value: 'same_cell',
    label: 'All MPNs and MFRs are in the same cell',
    description: 'Use this for values like "YAGEO: RC0805FR AVX: CR21-0100F-T" where manufacturer and MPN pairs are written together.',
  },
  {
    value: 'one_per_row',
    label: 'Each row has one MPN and one MFR',
    description: 'Use this when each row already represents one MPN/manufacturer pair and only needs light cleanup.',
  },
];

const ALTERNATE_LAYOUT_OPTIONS = [
  {
    value: 'inside_selected_mpn_columns',
    label: 'Alternates are inside the selected MPN/MFR cells',
    description: 'Use this when the selected MPN cell itself contains primary plus alternate MPNs.',
  },
  {
    value: 'separate_columns',
    label: 'Primary and alternate parts are separate columns',
    description: 'Use this for wide sheets with columns such as Primary MPN, Alt1 MPN, Alt2 MPN, Alt1 Qty, and Alt1 UOM.',
  },
  {
    value: 'already_separate_rows',
    label: 'Alternates are already separate rows',
    description: 'Use this when each alternate already appears as its own row in the sheet.',
  },
];

const QTY_OPTIONS = [
  { value: 'every_row', label: 'Every row has its own quantity and UOM' },
  { value: 'inherit_primary', label: 'Alternates use the primary row quantity and UOM' },
  { value: 'alternate_columns', label: 'Alternate quantity and UOM are in nearby columns' },
];

const DELIMITER_OPTIONS = [
  { value: 'auto', label: 'Auto detect' },
  { value: ';', label: 'Semicolon ;' },
  { value: ',', label: 'Comma ,' },
  { value: '|', label: 'Pipe |' },
  { value: '\\n', label: 'New line' },
  { value: 'custom', label: 'Custom delimiter' },
];

const CLEANUP_OPTIONS = [
  {
    key: 'skipTitleRows',
    label: 'Ignore category/title rows inside the BOM',
    description: 'Skips section labels that do not contain part data.',
  },
  {
    key: 'skipRepeatedHeaders',
    label: 'Ignore repeated header rows',
    description: 'Skips repeated table headers inside the sheet.',
  },
  {
    key: 'skipDoNotPopulate',
    label: 'Ignore Do Not Populate rows',
    description: 'Skips rows marked as not fitted or not populated.',
  },
];

const KNOWN_MANUFACTURERS = [
  'INFINEON TECHNOLOGIES AG',
  'ON SEMICONDUCTOR',
  'NIC COMPONENTS',
  'TEXAS INSTRUMENTS',
  'ANALOG DEVICES',
  'SAMSUNG ELECTRO-MECHANICS',
  'SAMSUNG',
  'PANASONIC',
  'VISHAY',
  'YAGEO',
  'KEMET',
  'AVX',
  'ROHM',
  'NEXPERIA',
  'NXP',
  'DIODES',
  'MURATA',
  'TDK',
  'ABRACON CORPORATION',
  'CTS CORP',
  'ECLIPTEK',
  'FOX ELECTRONICS',
  'KOA',
  'IRC',
];

const MANUFACTURER_SUFFIX_WORDS = new Set([
  'AG',
  'CO',
  'COMPONENTS',
  'CORP',
  'CORPORATION',
  'DEVICES',
  'ELECTRONIC',
  'ELECTRONICS',
  'GMBH',
  'INC',
  'INCORPORATED',
  'INDUSTRIES',
  'INSTRUMENTS',
  'LIMITED',
  'LTD',
  'MICROCHIP',
  'SEMICONDUCTOR',
  'SEMICONDUCTORS',
  'TECHNOLOGIES',
  'TECHNOLOGY',
]);

const DropzoneFileStackIcon = ({ color = '#3b82f6', glowColor = '#22c55e', selected = false, isHovered = false, isDarkMode = true }) => {
  const cardBg = isDarkMode ? '#0f172a' : '#ffffff';
  const backCardBg = isDarkMode ? '#1e293b' : '#f8fafc';
  const strokeColor = isDarkMode ? 'rgba(255,255,255,0.28)' : 'rgba(15,23,42,0.16)';
  const cornerFill = isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(37,99,235,0.08)';
  const lineMuted = isDarkMode ? '#94a3b8' : '#64748b';

  return (
    <Box sx={{ position: 'relative', width: 130, height: 86, mx: 'auto', mb: 1.5, display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'visible' }}>
      <Box
        sx={{
          position: 'absolute',
          width: isHovered ? 110 : 84,
          height: isHovered ? 78 : 56,
          borderRadius: '50%',
          background: selected
            ? `radial-gradient(circle, ${color}dd 0%, transparent 70%)`
            : `radial-gradient(circle, ${glowColor}bb 0%, transparent 70%)`,
          filter: isHovered ? 'blur(22px)' : 'blur(15px)',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 0,
          transition: 'all 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)'
        }}
      />
      <svg width="120" height="84" viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ position: 'relative', zIndex: 1, overflow: 'visible' }}>
        <g style={{
          transform: isHovered ? 'translate(12px, 16px) rotate(-16deg)' : 'translate(40px, 10px) rotate(0deg)',
          opacity: isHovered ? 0.95 : 0.4,
          transition: 'all 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
          transformOrigin: 'bottom center'
        }}>
          <rect x="0" y="0" width="34" height="46" rx="6" fill={backCardBg} stroke={strokeColor} strokeWidth="1.5" />
          <path d="M10 22L15 27L24 18" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g style={{
          transform: isHovered ? 'translate(68px, 18px) rotate(16deg)' : 'translate(40px, 10px) rotate(0deg)',
          opacity: isHovered ? 0.95 : 0.4,
          transition: 'all 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
          transformOrigin: 'bottom center'
        }}>
          <rect x="0" y="0" width="34" height="46" rx="6" fill={backCardBg} stroke={strokeColor} strokeWidth="1.5" />
          <line x1="8" y1="14" x2="26" y2="14" stroke={lineMuted} strokeWidth="2" strokeLinecap="round" />
          <line x1="8" y1="22" x2="22" y2="22" stroke={lineMuted} strokeWidth="2" strokeLinecap="round" />
          <line x1="8" y1="30" x2="18" y2="30" stroke={lineMuted} strokeWidth="2" strokeLinecap="round" />
        </g>
        <g style={{
          transform: isHovered ? 'translate(40px, 4px)' : 'translate(40px, 10px)',
          transition: 'all 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)'
        }}>
          <rect x="0" y="0" width="40" height="54" rx="7" fill={cardBg} stroke={selected || isHovered ? color : strokeColor} strokeWidth="2" />
          <path d="M28 0V12H40" fill={cornerFill} stroke={strokeColor} strokeWidth="1.5" />
          <circle cx="20" cy="30" r="11" fill={isDarkMode ? 'rgba(37, 99, 235, 0.25)' : 'rgba(37, 99, 235, 0.15)'} stroke={color} strokeWidth="1.5" />
          <path d="M20 35V25M20 25L16 29M20 25L24 29" stroke={isDarkMode ? '#93c5fd' : '#1d4ed8'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </Box>
  );
};

const MPN_NOISE_RE = /(%|ppm\b|ohm\b|pf\b|nf\b|uf\b|\u00b5f\b|mh\b|mm\b|hz\b|khz\b|mhz\b|vac\b|vdc\b|watt\b|rohs\b|case\b|smd\b|esd\b)/i;

const emptyRoles = ROLE_FIELDS.reduce((acc, field) => {
  acc[field.key] = '';
  return acc;
}, {});

const LEARNED_ROLE_HEADERS_KEY = 'bomNormalizer.learnedRoleHeaders.v1';

const fmt = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const normalizeKey = (value) => fmt(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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

const rowsToObjects = (rows, currentHeaders, startRowNumber = 1) => rows
  .filter((row) => row.some((cell) => fmt(cell)))
  .map((row, rowIndex) => {
    const mapped = {};
    currentHeaders.forEach((header, index) => {
      mapped[header] = fmt(row[index]);
    });
    mapped.__sourceRow = startRowNumber + rowIndex;
    return mapped;
  });

const worksheetToCompactRows = (worksheet) => {
  const cells = Object.keys(worksheet).filter((key) => !key.startsWith('!'));
  let maxRow = -1;
  const valuesByCell = new Map();
  const usedColumns = new Set();

  cells.forEach((cellAddress) => {
    const cell = worksheet[cellAddress];
    const value = fmt(cell?.w ?? cell?.v);
    if (!value) return;
    const position = XLSX.utils.decode_cell(cellAddress);
    maxRow = Math.max(maxRow, position.r);
    usedColumns.add(position.c);
    valuesByCell.set(`${position.r}:${position.c}`, value);
  });

  if (maxRow < 0 || !usedColumns.size) return [];

  const columns = [...usedColumns].sort((a, b) => a - b);

  const rows = [];
  for (let rowIndex = 0; rowIndex <= maxRow; rowIndex += 1) {
    rows.push(columns.map((colIndex) => valuesByCell.get(`${rowIndex}:${colIndex}`) || ''));
  }

  return rows;
};

const detectHeaderRow = (rows) => {
  let bestIndex = 0;
  let bestScore = -1;
  rows.slice(0, 25).forEach((row, index) => {
    const filled = row.filter((cell) => fmt(cell)).length;
    const labelScore = row.reduce((score, cell) => {
      const value = normalizeKey(cell);
      if (/mpn|manufacturer|mfr|qty|quantity|uom|level|description|item|part/.test(value)) {
        return score + 3;
      }
      return score;
    }, 0);
    const score = filled + labelScore;
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

  return {
    cpn: findLearnedHeader('cpn') || findHeader([/\bcpn\b/, /customer part/, /client part/, /internal part/, /part code/]),
    mpn: findLearnedHeader('mpn') || findHeader([/\bmpn\b/, /manufacturer equivalent/, /manufacturer part/, /part number/, /producer/]),
    manufacturer: findLearnedHeader('manufacturer') || findHeader([/^manufacturer$/, /\bmfr\b/, /manufacturer name/, /producer/], [/equivalent/, /part/, /\bmpn\b/]) ||
      findHeader([/manufacturer/], [/equivalent/, /part/, /\bmpn\b/]),
    description: findLearnedHeader('description') || findHeader([/description/, /item name/, /\bname\b/]),
    quantity: findLearnedHeader('quantity') || findHeader([/quantity/, /\bqty\b/]),
    uom: findLearnedHeader('uom') || findHeader([/\buom\b/, /measurement unit/, /\bunit\b/]),
    level: findLearnedHeader('level') || findHeader([/\blevel\b/]),
    parent: findLearnedHeader('parent') || findHeader([/parent/, /finished good/, /bom id/, /item code/]),
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
    return explicitParts.map(stripVendorPrefix).filter(Boolean);
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
    return [...new Set(starts)].sort((a, b) => a - b).map((start, index, sorted) => {
      const end = sorted[index + 1] || text.length;
      return stripVendorPrefix(text.slice(start, end));
    }).filter(Boolean);
  }

  const delimited = splitDelimited(text);
  if (delimited.length > 1 && delimited.every(looksLikeMpnToken)) {
    return delimited.map(stripVendorPrefix).filter(Boolean);
  }

  return [stripVendorPrefix(text)].filter(Boolean);
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
    const cleaned = stripVendorPrefix(kept.join(' '));
    return cleaned ? [cleaned] : [];
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

const splitManufacturerCell = (value, expectedCount, config = {}) => {
  const text = fmt(value).replace(/\u00a0/g, ' ');
  if (!text) return [];

  const delimiter = selectedDelimiter(config);
  const explicitParts = splitByExplicitDelimiter(text, delimiter);
  if (explicitParts.length > 1) return explicitParts;

  const colonSegments = parseColonSegments(text);
  if (colonSegments.length > 1) return colonSegments.map((segment) => segment.label);

  const delimited = splitDelimited(text);
  if (delimited.length > 1) return delimited;

  const upperText = text.toUpperCase();
  const knownMatches = KNOWN_MANUFACTURERS
    .filter((name) => upperText.includes(name))
    .sort((a, b) => upperText.indexOf(a) - upperText.indexOf(b));
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

const shouldSkipSourceRow = (row, headers, roles, config) => {
  if (!rowValues(row, headers).length) return true;
  if (config.skipRepeatedHeaders && rowLooksLikeRepeatedHeader(row, headers)) return true;
  if (config.skipDoNotPopulate && rowLooksLikeDoNotPopulate(row, headers)) return true;
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

const normalizeSeparateCells = (rows, roles, config) => {
  const output = [];
  rows.forEach((row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const mpns = splitMpnCell(getCell(row, roles.mpn), config);
    const explicitDelimiterUsed = Boolean(selectedDelimiter(config)) && mpns.length > 1;
    const manufacturers = splitManufacturerCell(getCell(row, roles.manufacturer), mpns.length, config);
    const quantity = getCell(row, roles.quantity);
    const uom = getCell(row, roles.uom);
    const parentKey = getCell(row, roles.parent) || getCell(row, roles.description) || `Source row ${sourceRow}`;
    const level = getCell(row, roles.level) || '1';
    const rule = explicitDelimiterUsed ? 'separate_cells_user_delimiter' : 'separate_cells_position_pairing';
    const cpn = getCell(row, roles.cpn);

    mpns.forEach((mpn, partIndex) => {
      const isPrimary = partIndex === 0;
      output.push({
        sourceRow,
        parentKey,
        relation: isPrimary ? 'Primary' : `Alternate ${partIndex}`,
        level,
        cpn,
        description: getCell(row, roles.description),
        mpn,
        manufacturer: manufacturers[partIndex] || '',
        quantity: config.quantityMode === 'inherit_primary' || isPrimary ? quantity : quantity,
        uom: config.quantityMode === 'inherit_primary' || isPrimary ? uom : uom,
        rule,
        confidence: Math.min(confidenceForRow(mpn, manufacturers[partIndex], 'separate') + (explicitDelimiterUsed ? 25 : 0), 98),
        discardedText: '',
      });
    });
  });
  return output;
};

const normalizeSameCell = (rows, roles, config) => {
  const output = [];
  rows.forEach((row, rowIndex) => {
    const sourceRow = row.__sourceRow || rowIndex + 1;
    const sourceText = getCell(row, roles.mpn) || getCell(row, roles.manufacturer);
    const segments = parseColonSegments(sourceText);
    const quantity = getCell(row, roles.quantity);
    const uom = getCell(row, roles.uom);
    const parentKey = getCell(row, roles.parent) || getCell(row, roles.description) || `Source row ${sourceRow}`;
    const level = getCell(row, roles.level) || '1';
    const cpn = getCell(row, roles.cpn);

    if (!segments.length) {
      splitMpnCell(sourceText, config).forEach((mpn, partIndex) => {
        output.push({
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
        });
      });
      return;
    }

    let relationIndex = 0;
    segments.forEach((segment, segmentIndex) => {
      const mpns = segment.mpns.length ? segment.mpns : [segment.rawValue].filter(Boolean);
      mpns.forEach((mpn, mpnIndex) => {
        output.push({
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
        });
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

const normalizeAlternateColumns = (rows, headers, roles, config) => {
  const output = [];
  const alternateGroups = findAlternateColumnGroups(headers);
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
      output.push({
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
      });
    }

    alternateGroups.forEach((group, groupIndex) => {
      const mpn = getCell(row, group.mpn);
      if (!mpn) return;
      const manufacturer = getCell(row, group.mfr);
      output.push({
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
      });
    });
  });
  return output;
};

const normalizeOnePerRow = (rows, roles) => rows.map((row, rowIndex) => {
  const sourceRow = row.__sourceRow || rowIndex + 1;
  const mpn = stripVendorPrefix(getCell(row, roles.mpn));
  const manufacturer = getCell(row, roles.manufacturer);
  return {
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
  };
}).filter((row) => row.mpn || row.manufacturer || row.description);

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
      output.push({
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
      });
    });
  });
  return output;
};

const normalizeRows = (rows, headers, roles, config) => {
  if (config.structure === 'mpn_only_same_cell') return normalizeSeparateCells(rows, roles, config);
  if (config.structure === 'mpn_only_rows') return normalizeOnePerRow(rows, roles);
  if (config.structure === 'mfr_only_same_cell') return normalizeManufacturerOnly(rows, roles, config, true);
  if (config.structure === 'mfr_only_rows') return normalizeManufacturerOnly(rows, roles, config, false);
  if (config.alternateLayout === 'separate_columns') return normalizeAlternateColumns(rows, headers, roles, config);
  if (config.alternateLayout === 'already_separate_rows') return normalizeOnePerRow(rows, roles);
  if (config.structure === 'same_cell') return normalizeSameCell(rows, roles, config);
  if (config.structure === 'one_per_row') return normalizeOnePerRow(rows, roles);
  return normalizeSeparateCells(rows, roles, config);
};

const normalizeRowsChunked = async (rows, headers, roles, config, onProgress) => {
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

const NORMALIZED_EXPORT_COLUMNS = [
  'sourceRow',
  'parentKey',
  'relation',
  'level',
  'cpn',
  'description',
  'mpn',
  'manufacturer',
  'quantity',
  'uom',
  'rule',
  'confidence',
  'discardedText',
];

const downloadRowsAsCsv = (rows) => {
  if (!rows.length) return;
  const escapeCsv = (value) => {
    const text = fmt(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const csv = [
    NORMALIZED_EXPORT_COLUMNS.join(','),
    ...rows.map((row) => NORMALIZED_EXPORT_COLUMNS.map((column) => escapeCsv(row[column])).join(',')),
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
  const worksheetRows = rows.map((row) => {
    const output = {};
    NORMALIZED_EXPORT_COLUMNS.forEach((column) => {
      output[column] = row[column] || '';
    });
    return output;
  });
  const worksheet = XLSX.utils.json_to_sheet(worksheetRows, { header: NORMALIZED_EXPORT_COLUMNS });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Normalized BOM');
  XLSX.writeFile(workbook, 'normalized-bom-preview.xlsx');
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
  if (multiMpn || multiMfr) return 'separate_cells';

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
    return STRUCTURE_OPTIONS.filter((option) => ['mpn_only_same_cell', 'mpn_only_rows'].includes(option.value));
  }

  if (!roles.mpn && roles.manufacturer) {
    return STRUCTURE_OPTIONS.filter((option) => ['mfr_only_same_cell', 'mfr_only_rows'].includes(option.value));
  }

  if (roles.mpn && roles.manufacturer) {
    return STRUCTURE_OPTIONS.filter((option) => ['separate_cells', 'same_cell', 'one_per_row'].includes(option.value));
  }

  return STRUCTURE_OPTIONS;
};

const prepareSingleSheet = (currentWorkbook, currentSheetName) => {
  const worksheet = currentWorkbook.Sheets[currentSheetName];
  const rows = worksheetToCompactRows(worksheet);
  const headerIndex = detectHeaderRow(rows);
  const currentHeaders = makeUniqueHeaders(rows[headerIndex] || []);
  const currentRows = rowsToObjects(rows.slice(headerIndex + 1), currentHeaders, headerIndex + 2);

  return {
    sheetRows: rows,
    headerRowIndex: headerIndex,
    headers: currentHeaders,
    dataRows: currentRows,
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

const SourcePreview = ({ headers, rows }) => {
  const { isDarkMode, tokens: t } = useThemeContext();
  return (
    <TableContainer
      sx={{
        mt: 1,
        maxHeight: 300,
        borderRadius: '8px',
        border: `1px solid ${isDarkMode ? 'rgba(125, 154, 205, 0.22)' : 'rgba(203, 213, 225, 0.9)'}`,
        backgroundColor: isDarkMode ? 'rgba(8, 13, 24, 0.78)' : '#ffffff'
      }}
    >
      <Table stickyHeader size="small">
        <TableHead>
          <TableRow>
            {headers.slice(0, 12).map((header) => (
              <TableCell
                key={header}
                sx={{
                  fontWeight: 740,
                  fontSize: 12.5,
                  bgcolor: isDarkMode ? 'rgba(24, 35, 56, 0.96)' : '#f8fafc',
                  color: t.text.heading,
                  py: 1.05
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
              {headers.slice(0, 12).map((header) => (
                <TableCell
                  key={header}
                  sx={{
                    maxWidth: 220,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontSize: 12.5,
                    py: 0.85,
                    color: t.text.primary
                  }}
                >
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

const NormalizedTable = ({ rows, onRowsChange, lowConfidenceOnly, onLowConfidenceOnlyChange }) => {
  const { isDarkMode, tokens: t } = useThemeContext();
  const columns = [
    { key: 'sourceRow', label: 'Source row', editable: false, width: 86 },
    { key: 'parentKey', label: 'Parent / group', editable: true, width: 190 },
    { key: 'relation', label: 'Relation', editable: true, width: 115 },
    { key: 'level', label: 'Level', editable: true, width: 70 },
    { key: 'cpn', label: 'CPN', editable: true, width: 150 },
    { key: 'mpn', label: 'MPN', editable: true, width: 190 },
    { key: 'manufacturer', label: 'Manufacturer', editable: true, width: 180 },
    { key: 'quantity', label: 'Qty', editable: true, width: 80 },
    { key: 'uom', label: 'UOM', editable: true, width: 90 },
    { key: 'rule', label: 'Rule', editable: false, width: 190 },
    { key: 'confidence', label: 'Confidence', editable: false, width: 105 },
  ];
  const defaultVisibleColumns = ['relation', 'level', 'cpn', 'mpn', 'manufacturer', 'quantity', 'uom', 'confidence'];
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(defaultVisibleColumns);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingPrimaryDeleteIndex, setPendingPrimaryDeleteIndex] = useState(null);
  const visibleColumns = columns.filter((column) => visibleColumnKeys.includes(column.key));
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredRows = rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .filter(({ row }) => {
      if (lowConfidenceOnly && Number(row.confidence || 0) >= 70) return false;
      if (!normalizedSearch) return true;
      return Object.values(row).some((value) => fmt(value).toLowerCase().includes(normalizedSearch));
    });

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

  return (
    <>
    <Paper elevation={0} sx={{ mt: 1.5, p: 1.2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
          <Typography sx={{ fontSize: 13, fontWeight: 740, color: t.text.heading }}>Sheet view</Typography>
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
    <TableContainer sx={{ mt: 1, maxHeight: 520, borderRadius: '8px', border: `1px solid ${isDarkMode ? 'rgba(125, 154, 205, 0.22)' : 'rgba(203, 213, 225, 0.9)'}` }}>
      <Table stickyHeader size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 740, fontSize: 12.5, bgcolor: isDarkMode ? 'rgba(24, 35, 56, 0.96)' : '#f8fafc', color: t.text.heading, width: 56 }}>Actions</TableCell>
            {visibleColumns.map((column) => (
              <TableCell key={column.key} sx={{ fontWeight: 740, fontSize: 12.5, bgcolor: isDarkMode ? 'rgba(24, 35, 56, 0.96)' : '#f8fafc', color: t.text.heading, minWidth: column.width }}>
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 1}>
                <Typography sx={{ py: 3, textAlign: 'center', color: t.text.secondary }}>
                  Run normalization to see parsed MPNs, manufacturers, alternates, levels, and confidence.
                </Typography>
              </TableCell>
            </TableRow>
          ) : filteredRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 1}>
                <Typography sx={{ py: 3, textAlign: 'center', color: t.text.secondary }}>
                  No rows match the current filter.
                </Typography>
              </TableCell>
            </TableRow>
          ) : filteredRows.slice(0, 250).map(({ row, originalIndex }) => (
            <TableRow key={`${row.sourceRow}-${row.relation}-${originalIndex}`} sx={{ bgcolor: row.confidence < 70 ? t.state.warningBg : 'inherit' }}>
              <TableCell>
                <IconButton size="small" color="error" onClick={() => handleDeleteRow(originalIndex)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </TableCell>
              {visibleColumns.map((column) => (
                <TableCell key={column.key} sx={{ maxWidth: column.width + 40, p: column.editable ? 0.5 : 1 }}>
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
                        px: 0.75,
                        py: 0.55,
                        font: 'inherit',
                        '&:focus': {
                          bgcolor: t.surface.input,
                          borderColor: t.color.primary,
                          outline: 'none',
                        },
                      }}
                    />
                  ) : (
                    <Typography sx={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
        <Box sx={{ p: 1, bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.58)' : '#f8fafc', borderTop: `1px solid ${isDarkMode ? 'rgba(125, 154, 205, 0.18)' : 'rgba(226, 232, 240, 0.9)'}` }}>
          <Typography sx={{ fontSize: 12, color: t.text.secondary }}>Showing first 250 rows for prototype performance.</Typography>
        </Box>
      )}
    </TableContainer>
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
  const { isDarkMode, tokens: t } = useThemeContext();
  const [workbook, setWorkbook] = useState(null);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [sheetScope, setSheetScope] = useState('single');
  const [selectedSheetNames, setSelectedSheetNames] = useState([]);
  const [sheetRows, setSheetRows] = useState([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [preparedHeaders, setPreparedHeaders] = useState([]);
  const [preparedDataRows, setPreparedDataRows] = useState([]);
  const [roles, setRoles] = useState(emptyRoles);
  const [config, setConfig] = useState({
    structure: 'separate_cells',
    alternateLayout: 'inside_selected_mpn_columns',
    delimiterMode: 'auto',
    customDelimiter: '',
    quantityMode: 'inherit_primary',
    inheritLevels: true,
    skipTitleRows: true,
    skipRepeatedHeaders: true,
    skipDoNotPopulate: false,
  });
  const [normalizedRows, setNormalizedRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
  const [delimiterTouched, setDelimiterTouched] = useState(false);
  const [normalizationSummary, setNormalizationSummary] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lowConfidenceOnly, setLowConfidenceOnly] = useState(false);
  const [isUploadDragging, setIsUploadDragging] = useState(false);
  const [isUploadHovered, setIsUploadHovered] = useState(false);
  const [downloadMenuAnchor, setDownloadMenuAnchor] = useState(null);
  const [error, setError] = useState('');
  const downloadMenuOpen = Boolean(downloadMenuAnchor);

  const headers = useMemo(
    () => preparedHeaders.length ? preparedHeaders : makeUniqueHeaders(sheetRows[headerRowIndex] || []),
    [preparedHeaders, sheetRows, headerRowIndex]
  );

  const dataRows = useMemo(() => (
    preparedDataRows.length ? preparedDataRows : rowsToObjects(sheetRows.slice(headerRowIndex + 1), headers, headerRowIndex + 2)
  ), [preparedDataRows, sheetRows, headerRowIndex, headers]);

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
    };
    dataRows.forEach((row) => {
      if (rowLooksLikeSectionTitle(row, headers, roles)) detections.skipTitleRows += 1;
      if (rowLooksLikeRepeatedHeader(row, headers)) detections.skipRepeatedHeaders += 1;
      if (rowLooksLikeDoNotPopulate(row, headers)) detections.skipDoNotPopulate += 1;
    });
    return detections;
  }, [dataRows, headers, roles]);

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

  const handleWorkbookLoaded = useCallback((nextWorkbook, nextFileName) => {
    const firstSheet = nextWorkbook.SheetNames[0];
    const prepared = prepareSingleSheet(nextWorkbook, firstSheet);
    const nextHeaders = prepared.headers;
    const nextRoles = inferRoles(nextHeaders);
    const nextStructure = detectBestStructure(nextHeaders, nextRoles, prepared.dataRows.slice(0, 40));

    setWorkbook(nextWorkbook);
    setFileName(nextFileName);
    setSheetName(firstSheet);
    setSheetScope('single');
    setSelectedSheetNames([firstSheet]);
    setSheetRows(prepared.sheetRows);
    setHeaderRowIndex(prepared.headerRowIndex);
    setPreparedHeaders(prepared.headers);
    setPreparedDataRows(prepared.dataRows);
    setRoles(nextRoles);
    setConfig((prev) => nextConfigForDetectedStructure(prev, nextStructure));
    setNormalizedRows([]);
    setCurrentStep(1);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setDelimiterTouched(false);
    setNormalizationSummary(null);
    setConfirmOpen(false);
    setError('');
  }, []);

  const handleWorkbookFile = useCallback(async (file) => {
    if (!file) return;

    try {
      setBusy(true);
      const buffer = await file.arrayBuffer();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const nextWorkbook = XLSX.read(buffer, { type: 'array' });
      handleWorkbookLoaded(nextWorkbook, file.name);
    } catch (err) {
      setError(err.message || 'Unable to read workbook.');
    } finally {
      setBusy(false);
      setIsUploadDragging(false);
    }
  }, [handleWorkbookLoaded]);

  const handleFileChange = useCallback(async (event) => {
    const file = event.target.files?.[0];
    try {
      await handleWorkbookFile(file);
    } finally {
      event.target.value = '';
    }
  }, [handleWorkbookFile]);

  const handleUploadDrop = useCallback((event) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    handleWorkbookFile(file);
  }, [handleWorkbookFile]);

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
    setRoles(nextRoles);
    setConfig((prev) => nextConfigForDetectedStructure(prev, detectBestStructure(nextHeaders, nextRoles, prepared.dataRows.slice(0, 40))));
    setNormalizedRows([]);
    setCurrentStep(1);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setDelimiterTouched(false);
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
    setRoles(nextRoles);
    setConfig((prev) => nextConfigForDetectedStructure(prev, detectBestStructure(prepared.headers, nextRoles, prepared.dataRows.slice(0, 40))));
    setNormalizedRows([]);
    setCurrentStep(1);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setDelimiterTouched(false);
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
    const nextHeaders = makeUniqueHeaders(sheetRows[nextIndex] || []);
    const nextRoles = inferRoles(nextHeaders);
    setHeaderRowIndex(nextIndex);
    setPreparedHeaders(nextHeaders);
    setPreparedDataRows(rowsToObjects(sheetRows.slice(nextIndex + 1), nextHeaders, nextIndex + 2));
    setRoles(nextRoles);
    setNormalizedRows([]);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setNormalizationSummary(null);
    setConfirmOpen(false);
  }, [sheetRows]);

  const handleRoleChange = useCallback((role, header) => {
    setRoles((prev) => ({ ...prev, [role]: header }));
    if (header) rememberRoleHeader(role, header);
  }, []);

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
      setNormalizedRows(result);
      const primaryRows = result.filter((row) => row.relation === 'Primary').length;
      const alternateRows = result.filter((row) => row.relation !== 'Primary').length;
      const uniqueRawMaterials = new Set(result.map((row) => row.mpn || row.manufacturer || row.cpn).filter(Boolean)).size;
      const skippedRows = dataRows.filter((row) => shouldSkipSourceRow(row, headers, roles, config)).length;
      setNormalizationSummary({
        totalRows: result.length,
        primaryRows,
        alternateRows,
        uniqueRawMaterials,
        skippedRows,
      });
      setConfirmOpen(true);
      setError('');
    } catch (err) {
      setError(err.message || 'Normalization failed.');
    } finally {
      setBusy(false);
    }
  }, [config, dataRows, headers, roles]);

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
      quantityMode: 'inherit_primary',
      inheritLevels: true,
      skipTitleRows: true,
      skipRepeatedHeaders: true,
      skipDoNotPopulate: false,
    });
    setNormalizedRows([]);
    setCurrentStep(0);
    setProgress({ processed: 0, total: 0, outputRows: 0, skippedRows: 0 });
    setDelimiterTouched(false);
    setNormalizationSummary(null);
    setConfirmOpen(false);
    setLowConfidenceOnly(false);
    setError('');
  }, []);

  useEffect(() => {
    setNormalizedRows([]);
    setLowConfidenceOnly(false);
  }, [roles, config, headerRowIndex, sheetName, sheetScope, selectedSheetNames]);

  useEffect(() => {
    setConfig((prev) => {
      const nextStructure = detectBestStructure(headers, roles, dataRows.slice(0, 40));
      if (nextStructure === prev.structure) return prev;
      return nextConfigForDetectedStructure(prev, nextStructure);
    });
  }, [dataRows, headers, roles]);

  useEffect(() => {
    if (!availableStructureOptions.length) return;
    if (availableStructureOptions.some((option) => option.value === config.structure)) return;
    setConfig((prev) => ({ ...prev, structure: availableStructureOptions[0].value }));
  }, [availableStructureOptions, config.structure]);

  useEffect(() => {
    if (delimiterTouched || (!roles.mpn && !roles.manufacturer)) return;
    const guessedDelimiter = guessDelimiter(dataRows, roles);
    setConfig((prev) => (
      prev.delimiterMode === guessedDelimiter ? prev : { ...prev, delimiterMode: guessedDelimiter }
    ));
  }, [dataRows, delimiterTouched, roles]);

  const pageSx = {
    minHeight: 'calc(100vh - 68px)',
    bgcolor: 'transparent',
    color: t.text.primary,
    px: { xs: 2, lg: 4 },
    py: { xs: 2.5, lg: 3 },
    '& .MuiPaper-root': {
      borderRadius: '8px',
      border: `1px solid ${t.border.default}`,
      background: isDarkMode
        ? 'linear-gradient(145deg, rgba(16, 24, 39, 0.86) 0%, rgba(8, 13, 24, 0.9) 100%)'
        : 'rgba(255, 255, 255, 0.88)',
      color: t.text.primary,
      boxShadow: isDarkMode
        ? '0 24px 70px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.04)'
        : '0 18px 50px rgba(15,23,42,0.08)',
      backdropFilter: 'blur(18px)'
    },
    '& .MuiTypography-root': {
      letterSpacing: 0
    },
    '& .MuiTypography-body2, & .MuiFormHelperText-root': {
      color: t.text.secondary
    },
    '& .MuiStepLabel-label': {
      color: `${t.text.secondary} !important`,
      fontWeight: '500 !important'
    },
    '& .MuiStepLabel-label.Mui-active, & .MuiStepLabel-label.Mui-completed': {
      fontWeight: '500 !important'
    },
    '& .MuiStepIcon-root': {
      color: isDarkMode ? 'rgba(148, 163, 184, 0.36)' : 'rgba(148, 163, 184, 0.55)'
    },
    '& .MuiStepIcon-root.Mui-active, & .MuiStepIcon-root.Mui-completed': {
      color: t.color.primary
    },
    '& .MuiStepConnector-line': {
      borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.2)' : 'rgba(148, 163, 184, 0.42)'
    },
    '& .MuiOutlinedInput-root, & .MuiInputBase-root': {
      borderRadius: '8px',
      color: t.text.primary,
      backgroundColor: t.surface.controlSoft
    },
    '& .MuiOutlinedInput-notchedOutline': {
      borderColor: t.border.default
    },
    '& .MuiInputLabel-root': {
      color: t.text.secondary
    },
    '& .MuiChip-root': {
      borderRadius: '999px',
      bgcolor: isDarkMode ? 'rgba(37, 99, 235, 0.12)' : 'rgba(37, 99, 235, 0.08)',
      color: isDarkMode ? '#bfdbfe' : '#1d4ed8',
      border: `1px solid ${isDarkMode ? 'rgba(96, 165, 250, 0.2)' : 'rgba(37, 99, 235, 0.14)'}`
    },
    '& .MuiTableCell-root': {
      color: t.text.primary,
      borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.14)' : 'rgba(226, 232, 240, 0.9)'
    },
    '& .MuiTableHead-root .MuiTableCell-root': {
      bgcolor: isDarkMode ? 'rgba(24, 35, 56, 0.96)' : '#f8fafc',
      color: t.text.heading,
      fontWeight: 750
    },
    '& .MuiTableBody-root .MuiTableRow-root:nth-of-type(even)': {
      bgcolor: isDarkMode ? 'rgba(15, 23, 42, 0.48)' : 'rgba(248, 250, 252, 0.72)'
    },
    '& .MuiButton-root': {
      borderRadius: '999px',
      textTransform: 'none',
      fontWeight: 650,
      minHeight: 36,
      px: 2
    },
    '& .MuiButton-contained': {
      color: '#fff',
      background: 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)',
      boxShadow: '0 14px 28px -16px rgba(37, 99, 235, 0.9)'
    },
    '& .MuiButton-contained:hover': {
      background: 'linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)',
      boxShadow: '0 18px 34px -18px rgba(37, 99, 235, 0.95)'
    },
    '& .MuiButton-outlined': {
      color: t.text.primary,
      borderColor: t.border.default,
      backgroundColor: t.surface.controlSoft
    },
    '& .MuiButton-outlined:hover': {
      borderColor: t.border.hover,
      backgroundColor: t.action.hover
    }
  };

  const heroSx = {
    mb: 2.5,
    px: { xs: 0.25, md: 0.5 },
    py: { xs: 0.5, md: 0.75 }
  };

  const primaryButtonSx = {
    borderRadius: '999px',
    px: 2.25,
    minHeight: 38,
    textTransform: 'none',
    fontWeight: 750,
    color: '#fff',
    background: 'linear-gradient(135deg, #2563eb 0%, #0284c7 100%)',
    boxShadow: '0 14px 28px -16px rgba(37, 99, 235, 0.9)',
    '&:hover': {
      background: 'linear-gradient(135deg, #1d4ed8 0%, #0369a1 100%)',
      boxShadow: '0 18px 34px -18px rgba(37, 99, 235, 0.95)'
    }
  };

  const uploadPanelSx = {
    maxWidth: 860,
    mx: 'auto',
    width: '100%',
    border: `1.5px dashed ${(isUploadDragging || isUploadHovered) ? t.color.primary : (isDarkMode ? 'rgba(37, 99, 235, 0.72)' : 'rgba(37, 99, 235, 0.58)')}`,
    borderRadius: '16px',
    minHeight: 340,
    py: 4.5,
    px: 2.5,
    textAlign: 'center',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    background: isDarkMode
      ? ((isUploadDragging || isUploadHovered)
        ? 'linear-gradient(145deg, rgba(21, 45, 82, 0.9) 0%, rgba(10, 18, 33, 0.94) 100%)'
        : 'linear-gradient(145deg, rgba(15, 32, 61, 0.78) 0%, rgba(10, 18, 33, 0.88) 100%)')
      : ((isUploadDragging || isUploadHovered)
        ? 'linear-gradient(145deg, rgba(219, 234, 254, 0.98) 0%, rgba(255, 255, 255, 0.98) 100%)'
        : 'linear-gradient(145deg, rgba(239, 246, 255, 0.9) 0%, rgba(255, 255, 255, 0.9) 100%)'),
    transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
    '&:hover': {
      borderColor: t.color.primary,
      background: isDarkMode
        ? 'linear-gradient(145deg, rgba(21, 45, 82, 0.84) 0%, rgba(10, 18, 33, 0.92) 100%)'
        : 'linear-gradient(145deg, rgba(219, 234, 254, 0.95) 0%, rgba(255, 255, 255, 0.96) 100%)'
    }
  };

  const uploadStageSx = {
    maxWidth: 860,
    mx: 'auto',
    width: '100%'
  };

  const workflowStageSx = {
    maxWidth: 1120,
    mx: 'auto',
    width: 'min(1120px, calc(100vw - 96px))',
    '@media (max-width: 900px)': {
      width: '100%'
    }
  };

  const workflowPanelSx = {
    width: '100%',
    minHeight: { xs: 520, md: 'calc(100vh - 230px)' }
  };

  return (
    <Box sx={pageSx}>
      <Box sx={{ ...heroSx, ...workflowStageSx }}>
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'flex-start', md: 'center' }} justifyContent="space-between" gap={2}>
          <Box>
            <Typography sx={{ fontSize: { xs: 23, md: 26 }, fontWeight: 760, color: t.text.heading, lineHeight: 1.15 }}>BOM Normalizer</Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ width: '100%' }}>
        <Stepper activeStep={currentStep >= 4 ? 3 : currentStep} alternativeLabel sx={{ ...workflowStageSx, mb: 3 }}>
          {['Upload', 'Source', 'Configure', 'Results'].map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {busy && (
          <Paper elevation={0} sx={{ mb: 2, p: 1.5 }}>
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
          <Box sx={uploadStageSx}>
            <Paper
              component="label"
              elevation={0}
              onDragOver={(event) => {
                event.preventDefault();
                setIsUploadDragging(true);
              }}
              onDragLeave={() => setIsUploadDragging(false)}
              onDrop={handleUploadDrop}
              onMouseEnter={() => setIsUploadHovered(true)}
              onMouseLeave={() => setIsUploadHovered(false)}
              sx={uploadPanelSx}
            >
              <DropzoneFileStackIcon
                color="#3b82f6"
                glowColor="#22c55e"
                selected={false}
                isHovered={isUploadDragging || isUploadHovered}
                isDarkMode={isDarkMode}
              />
              <Typography sx={{ fontSize: 20, fontWeight: 760, color: t.text.heading }}>
                Drag and drop or select files
              </Typography>
              <Typography sx={{ mt: 0.65, color: t.text.secondary, fontSize: 14 }}>
                Supported files: .xlsx, .xls, .csv
              </Typography>
              <Button
                component="span"
                variant="contained"
                size="small"
                sx={{
                  mt: 2,
                  ...primaryButtonSx,
                  fontWeight: 800,
                  px: 2.5,
                  py: 0.7,
                  fontSize: '0.85rem',
                  minHeight: 36
                }}
                disabled={busy}
              >
                Select files
              </Button>
              <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} />
            </Paper>
          </Box>
        ) : (
          <Box sx={workflowStageSx}>
          <Stack spacing={2}>
            {currentStep === 1 && (
              <Paper elevation={0} sx={{ ...workflowPanelSx, p: 2 }}>
                <Typography sx={{ fontSize: 16, fontWeight: 740, color: t.text.heading }}>Source setup</Typography>
                <Typography sx={{ mt: 0.35, fontSize: 12.5, color: t.text.secondary, wordBreak: 'break-word' }}>{fileName}</Typography>
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
                </Grid>
                <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1.5 }}>
                  <Chip size="small" label={`${headers.length} columns`} />
                  <Chip size="small" label={`${dataRows.length} data rows`} />
                  <Chip size="small" label={sheetScope === 'single' ? `Header row ${headerRowIndex + 1}` : `${selectedSheetNames.length} sheets merged`} />
                </Stack>
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 740, color: t.text.heading }}>Source preview</Typography>
                  <SourcePreview headers={headers} rows={dataRows.slice(0, 8)} />
                </Box>
                <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
                  <Button variant="outlined" onClick={handleReset} disabled={busy}>Back</Button>
                  <Button variant="contained" onClick={() => setCurrentStep(2)} disabled={busy}>Next: identify columns</Button>
                </Stack>
              </Paper>
            )}

            {currentStep === 2 && (
              <Paper elevation={0} sx={{ ...workflowPanelSx, p: 2 }}>
                <Typography sx={{ fontSize: 16, fontWeight: 740, color: t.text.heading }}>Configure source columns and parsing</Typography>
                <Typography sx={{ mt: 0.35, fontSize: 12.5, color: t.text.secondary }}>
                  Pick the important columns first. Parser assumptions update automatically from those choices.
                </Typography>
                <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1.2 }}>
                  <Chip size="small" label={`${headers.length} columns`} />
                  <Chip size="small" label={`${dataRows.length} data rows`} />
                  <Chip size="small" label={sheetScope === 'single' ? `Header row ${headerRowIndex + 1}` : `${selectedSheetNames.length} sheets merged`} />
                </Stack>
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 740, color: t.text.heading }}>Source preview</Typography>
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
                <Paper elevation={0} sx={{ mt: 2, p: 1.5 }}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 740, color: t.text.heading }}>Detected setup</Typography>
                  <Typography sx={{ mt: 0.35, fontSize: 12.5, color: t.text.secondary }}>{roleCombinationHint}</Typography>
                  <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
                    <Grid item xs={12} md={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Where are MPN and MFR?</InputLabel>
                        <Select
                          value={config.structure}
                          label="Where are MPN and MFR?"
                          onChange={(event) => setConfig((prev) => ({
                            ...prev,
                            structure: event.target.value,
                            alternateLayout: event.target.value === 'one_per_row' ? 'already_separate_rows' : prev.alternateLayout,
                          }))}
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
                          onChange={(event) => setConfig((prev) => ({ ...prev, alternateLayout: event.target.value }))}
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
                  </Grid>
                  <Typography sx={{ mt: 1, fontSize: 12.5, color: t.text.secondary, lineHeight: 1.45 }}>
                    <strong>Detected rule:</strong> {selectedStructureOption?.description || '-'}
                    {' '}<strong>Delimiter:</strong> {delimiterLabel}.
                    {' '}Blank BOM levels will be treated as level 1.
                  </Typography>
                  {detectedCleanupOptions.length > 0 && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 740, color: t.text.heading }}>Clean visual rows before parsing</Typography>
                      <Grid container spacing={1} sx={{ mt: 0.25 }}>
                        {detectedCleanupOptions.map((option) => (
                          <Grid item xs={12} md={4} key={option.key}>
                            <Paper elevation={0} sx={{ p: 1 }}>
                              <Stack direction="row" alignItems="center" gap={0.5}>
                                <Switch
                                  size="small"
                                  checked={Boolean(config[option.key])}
                                  onChange={(event) => setConfig((prev) => ({ ...prev, [option.key]: event.target.checked }))}
                                />
                                <Box>
                                  <Typography sx={{ fontSize: 12.5, fontWeight: 720, color: t.text.heading }}>{option.label}</Typography>
                                  <Typography sx={{ fontSize: 12, color: t.text.secondary }}>
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
                  <Button variant="outlined" onClick={() => setCurrentStep(1)} disabled={busy}>Back</Button>
                  <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={handleNormalize} disabled={busy}>Run normalization</Button>
                </Stack>
              </Paper>
            )}

            {currentStep === 4 && (
              <Paper elevation={0} sx={{ ...workflowPanelSx, p: 2 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1}>
                  <Box>
                    <Typography sx={{ fontSize: 16, fontWeight: 740, color: t.text.heading }}>Normalized editable sheet</Typography>
                    <Typography sx={{ mt: 0.35, fontSize: 12.5, color: t.text.secondary }}>
                      Review the parsed output, edit cells directly, or delete rows before downloading.
                    </Typography>
                  </Box>
                  <Stack direction="row" gap={1} flexWrap="wrap" justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<DownloadIcon />}
                      endIcon={<KeyboardArrowDownIcon />}
                      disabled={!normalizedRows.length}
                      onClick={(event) => setDownloadMenuAnchor(event.currentTarget)}
                      aria-controls={downloadMenuOpen ? 'normalizer-download-menu' : undefined}
                      aria-haspopup="true"
                      aria-expanded={downloadMenuOpen ? 'true' : undefined}
                    >
                      Download
                    </Button>
                    <Menu
                      id="normalizer-download-menu"
                      anchorEl={downloadMenuAnchor}
                      open={downloadMenuOpen}
                      onClose={() => setDownloadMenuAnchor(null)}
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                    >
                      <MenuItem
                        onClick={() => {
                          setDownloadMenuAnchor(null);
                          downloadRowsAsXlsx(normalizedRows);
                        }}
                      >
                        Download XLSX
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          setDownloadMenuAnchor(null);
                          downloadRowsAsCsv(normalizedRows);
                        }}
                      >
                        Download CSV
                      </MenuItem>
                    </Menu>
                  </Stack>
                </Stack>
                {normalizedRows.length > 0 && (
                  <Box sx={{ mt: 1.5 }}>
                    <LinearProgress variant="determinate" value={quality.average} sx={{ height: 7, borderRadius: 2 }} />
                  </Box>
                )}
                <Paper elevation={0} sx={{ mt: 1.5, p: 1.2 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 740, color: t.text.heading }}>Parser settings used</Typography>
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
                  <Button variant="contained" onClick={handleNormalize} disabled={busy}>Run again</Button>
                </Stack>
              </Paper>
            )}
          </Stack>
          </Box>
        )}
      </Box>
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
