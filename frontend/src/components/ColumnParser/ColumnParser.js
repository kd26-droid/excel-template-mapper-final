import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Step,
  StepLabel,
  Stepper,
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
import {
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Check as CheckIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ContentCut as ContentCutIcon,
  DeleteOutline as DeleteOutlineIcon,
} from '@mui/icons-material';

const API_BASE = process.env.REACT_APP_API_BASE_URL || '/api';
const STEPS = ['Split points', 'Outputs', 'Preview'];
const CUSTOM_GROUP_SEPARATOR = '__custom__';
const STRUCTURED_STATUS_GROUP_SEPARATOR = '__structured_status_block__';
const CUSTOM_SIMPLE_DELIMITER = '__custom__';
const GROUP_SEPARATOR_PRESETS = ['', STRUCTURED_STATUS_GROUP_SEPARATOR, '),', ',', '/', '|', ';', ' '];
const SIMPLE_DELIMITER_PRESETS = [
  { value: ',', label: 'Comma ,' },
  { value: ';', label: 'Semicolon ;' },
  { value: '|', label: 'Pipe |' },
  { value: '/', label: 'Slash /' },
  { value: ' ', label: 'Space' },
  { value: '\t', label: 'Tab' },
  { value: '\n', label: 'New line' },
];
// The repeated template groups, one entry per slot. Values are the internal
// field names (Tag_2, Specification_Value_1) that canonicalHeaderName maps back
// to their export headers; labels are the '(n)' form the app shows everywhere.
const TAG_AND_SPEC_SLOTS = [
  ...Array.from({ length: 3 }, (unused, index) => (
    { value: `Tag_${index + 1}`, label: `Tag (${index + 1})` }
  )),
  ...Array.from({ length: 3 }, (unused, index) => ([
    { value: `Specification_Name_${index + 1}`, label: `Specification name (${index + 1})` },
    { value: `Specification_Value_${index + 1}`, label: `Specification value (${index + 1})` },
    { value: `Specification_UOM_${index + 1}`, label: `Specification UOM (${index + 1})` },
  ])).flat(),
];

// Every column of the default FactWise template, in one flat list. Each one is
// written straight through: the new header is named exactly `value`. Tags and
// specs lead because they are the slots picked most often.
const FACTWISE_OUTPUT_COLUMNS = [
  ...TAG_AND_SPEC_SLOTS,

  { value: 'MPN', label: 'MPN' },
  { value: 'MFR', label: 'MFR' },
  { value: 'CPN', label: 'CPN' },
  { value: 'Description', label: 'Description' },
  { value: 'Quantity', label: 'Quantity' },
  { value: 'UOM', label: 'UOM' },
  { value: 'Reference Designator', label: 'Reference Designator' },
  { value: 'Extra', label: 'Extra' },
  { value: 'Parent / group key', label: 'Parent / group key' },

  { value: 'Item code', label: 'Item code' },
  { value: 'Item name', label: 'Item name' },
  { value: 'Item type', label: 'Item type' },
  { value: 'Measurement unit', label: 'Measurement unit' },
  { value: 'Notes', label: 'Notes' },
  { value: 'Internal notes', label: 'Internal notes' },
  { value: 'Procurement entity name', label: 'Procurement entity name' },
  { value: 'Procurement item', label: 'Procurement item' },
  { value: 'Sales item', label: 'Sales item' },
  { value: 'Preferred vendor code', label: 'Preferred vendor code' },
  { value: 'Level', label: 'Level' },
  { value: 'Base BOM Qty', label: 'Base BOM Qty' },

  { value: 'Custom_Identification_Name_1', label: 'Custom identification name (1)' },
  { value: 'Custom_Identification_Value_1', label: 'Custom identification value (1)' },
];

const numberedColumnIndex = (value, pattern, genericName) => {
  const match = String(value || '').match(pattern);
  if (match) return Number(match[1]);
  return String(value || '').toLowerCase() === genericName.toLowerCase() ? 1 : 0;
};

const escapeRegExp = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const splitStructuredStatusBlocks = (value) => {
  const text = String(value || '');
  const matches = [...text.matchAll(/\{[^}]*\}\s*\[[^\]]*\]/g)];
  if (!matches.length) return [text];

  const groups = [];
  let start = 0;
  matches.forEach((match) => {
    const end = (match.index || 0) + match[0].length;
    const group = text.slice(start, end).trim();
    if (group) groups.push(group);
    start = end;
    while (start < text.length && /\s/.test(text[start])) start += 1;
  });
  const tail = text.slice(start).trim();
  if (tail) groups.push(tail);
  return groups.length ? groups : [text];
};

const splitGroups = (value, separator) => {
  const text = String(value || '');
  if (!separator) return [text];
  if (separator === STRUCTURED_STATUS_GROUP_SEPARATOR) return splitStructuredStatusBlocks(text);
  let groups = text.split(separator);
  if (separator === '),') {
    groups = groups.map((group, index) => index < groups.length - 1 ? `${group})` : group);
  }
  return groups;
};

// One packed cell can carry several MPN/MFR entries. Callers that parse a single
// detected pattern page through those entries, so a cell expands into N samples.
const expandSampleGroups = (value, separator, trimValues) => splitGroups(String(value ?? ''), separator)
  .map(group => (trimValues ? group.trim() : group))
  .filter(group => group.trim() !== '');

const buildParts = (text, boundaries, trimValues, dropEmptyValues) => {
  if (!text || boundaries.length === 0) return [];
  const ordered = [...boundaries].sort((a, b) => a.index - b.index);
  const cleanValue = value => trimValues ? value.trim() : value;
  const occurrenceForBoundary = boundary => {
    let occurrence = 0;
    for (let index = 0; index <= boundary.index; index += 1) {
      if (text[index] === boundary.char) occurrence += 1;
    }
    return occurrence || 1;
  };
  const parts = [{
    id: 0,
    type: 'before',
    delimiter: ordered[0].char,
    delimiterIndex: ordered[0].index,
    delimiterOccurrence: occurrenceForBoundary(ordered[0]),
    preview: cleanValue(text.substring(0, ordered[0].index)),
    outputType: 'direct',
    specName: '',
    customName: '',
    targetColumn: '',
  }];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index].index + 1;
    const end = ordered[index + 1].index;
    parts.push({
      id: index + 1,
      type: 'between',
      startDelimiter: ordered[index].char,
      endDelimiter: ordered[index + 1].char,
      startDelimiterIndex: ordered[index].index,
      endDelimiterIndex: ordered[index + 1].index,
      startDelimiterOccurrence: occurrenceForBoundary(ordered[index]),
      endDelimiterOccurrence: occurrenceForBoundary(ordered[index + 1]),
      preview: cleanValue(text.substring(start, end)),
      outputType: 'direct',
      specName: '',
      customName: '',
      targetColumn: '',
    });
  }

  const last = ordered[ordered.length - 1];
  parts.push({
    id: ordered.length,
    type: 'after',
    delimiter: last.char,
    delimiterIndex: last.index,
    delimiterOccurrence: occurrenceForBoundary(last),
    preview: cleanValue(text.substring(last.index + 1)),
    outputType: 'direct',
    specName: '',
    customName: '',
    targetColumn: '',
  });

  return dropEmptyValues ? parts.filter(part => part.preview !== '') : parts;
};

const ColumnParser = ({ sessionId, onApply, initialColumn = '', availableColumns = null, parseReference = null, sampleUnit = 'row', describeSample = null }) => {
  const [step, setStep] = useState(0);
  const [columns, setColumns] = useState([]);
  const [selectedColumn, setSelectedColumn] = useState(initialColumn);
  const [sampleValues, setSampleValues] = useState([]);
  const [currentSampleIndex, setCurrentSampleIndex] = useState(0);
  const [totalValues, setTotalValues] = useState(0);
  const [groupSeparator, setGroupSeparator] = useState('');
  const [groupSeparatorMode, setGroupSeparatorMode] = useState('');
  const [customGroupSeparator, setCustomGroupSeparator] = useState('');
  const [commonDelimiters, setCommonDelimiters] = useState([]);
  const [splitMode, setSplitMode] = useState('pattern');
  const [simpleDelimiter, setSimpleDelimiter] = useState('');
  const [simpleDelimiterMode, setSimpleDelimiterMode] = useState('');
  const [customSimpleDelimiter, setCustomSimpleDelimiter] = useState('');
  const [chunkSize, setChunkSize] = useState(3);
  const [trimValues, setTrimValues] = useState(true);
  const [dropEmptyValues, setDropEmptyValues] = useState(true);
  // The source column is always kept — parsing adds columns, it never drops one.
  const keepSourceColumn = true;
  const [simpleOutputType, setSimpleOutputType] = useState('tag');
  const [simpleSpecTarget, setSimpleSpecTarget] = useState('new');
  const [simpleSpecName, setSimpleSpecName] = useState('');
  const [simpleCustomName, setSimpleCustomName] = useState('');
  const [boundaries, setBoundaries] = useState([]);
  const [parts, setParts] = useState([]);
  const [previewData, setPreviewData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const hasParseReference = Boolean(parseReference?.source);
  const autoAnalyzedColumn = useRef('');

  useEffect(() => {
    const loadColumns = async () => {
      try {
        setLoading(true);
        let nextColumns;
        if (Array.isArray(availableColumns) && availableColumns.length > 0) {
          nextColumns = availableColumns.map((column, index) => ({
            value: column.field || column.value || String(column),
            label: column.label || column.headerName || column.field || column.value || String(column),
            index,
          }));
        } else {
          const response = await fetch(`${API_BASE}/parser/columns/${sessionId}/`);
          const data = await response.json();
          if (!data.success) throw new Error(data.error || 'Could not load columns');
          nextColumns = (data.columns || []).map((column, index) => ({ value: column, label: column, index }));
        }
        setColumns(nextColumns);
        if (initialColumn && nextColumns.some(column => column.value === initialColumn)) {
          setSelectedColumn(initialColumn);
        }
      } catch (loadError) {
        setError(loadError.message || 'Could not load columns');
      } finally {
        setLoading(false);
      }
    };
    loadColumns();
  }, [availableColumns, sessionId, initialColumn]);

  // In 'group' mode every entry inside a packed cell counts as its own sample, so
  // the card shows one entry at a time instead of the whole cell at once.
  const sampleEntries = useMemo(() => {
    if (sampleUnit !== 'group') return sampleValues.map(value => String(value ?? ''));
    return sampleValues.flatMap(value => expandSampleGroups(value, groupSeparator, trimValues));
  }, [groupSeparator, sampleUnit, sampleValues, trimValues]);
  const currentSample = sampleEntries[currentSampleIndex] || '';
  const existingTagMax = useMemo(() => columns.reduce((maximum, column) => Math.max(
    maximum,
    numberedColumnIndex(column.value, /^Tag_(\d+)$/, 'Tag')
  ), 0), [columns]);
  const existingSpecPairs = useMemo(() => {
    const pairIndexes = new Set();
    columns.forEach(column => {
      const nameIndex = numberedColumnIndex(column.value, /^Specification_Name_(\d+)$/, 'Specification name');
      const valueIndex = numberedColumnIndex(column.value, /^Specification_Value_(\d+)(?:_\d+)?$/, 'Specification value');
      if (nameIndex) pairIndexes.add(nameIndex);
      if (valueIndex) pairIndexes.add(valueIndex);
    });
    return [...pairIndexes].sort((a, b) => a - b);
  }, [columns]);
  const nextSpecPairIndex = existingSpecPairs.length ? Math.max(...existingSpecPairs) + 1 : 1;
  const selectedSpecPairIndex = simpleSpecTarget === 'new'
    ? nextSpecPairIndex
    : Number(simpleSpecTarget);
  const existingCustomMax = useMemo(() => {
    const name = simpleCustomName.trim();
    if (!name) return 0;
    const numberedPattern = new RegExp(`^${escapeRegExp(name)}_(\\d+)$`, 'i');
    return columns.reduce((maximum, column) => {
      const value = String(column.value || '');
      const match = value.match(numberedPattern);
      if (match) return Math.max(maximum, Number(match[1]));
      return value.toLowerCase() === name.toLowerCase() ? Math.max(maximum, 1) : maximum;
    }, 0);
  }, [columns, simpleCustomName]);
  const firstGroup = useMemo(() => {
    if (!currentSample) return currentSample;
    // 'group' mode already hands us a single entry — splitting again is a no-op.
    if (sampleUnit === 'group') return trimValues ? currentSample.trim() : currentSample;
    if (!groupSeparator) return currentSample;
    const groups = splitGroups(currentSample, groupSeparator);
    const first = groups[0] ?? currentSample;
    return trimValues ? first.trim() : first;
  }, [currentSample, groupSeparator, sampleUnit, trimValues]);

  // Changing the group separator re-cuts the cell into a different number of
  // entries; keep the cursor inside the new list.
  useEffect(() => {
    setCurrentSampleIndex(index => (index < sampleEntries.length ? index : 0));
  }, [sampleEntries.length]);

  // Arrow keys page through entries, except while typing in a field.
  useEffect(() => {
    if (sampleUnit !== 'group' || step !== 0 || sampleEntries.length < 2) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const tagName = String(event.target?.tagName || '').toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || event.target?.isContentEditable) return;
      setCurrentSampleIndex(index => Math.min(
        sampleEntries.length - 1,
        Math.max(0, event.key === 'ArrowLeft' ? index - 1 : index + 1)
      ));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sampleEntries.length, sampleUnit, step]);

  useEffect(() => {
    let nextParts;
    if (splitMode === 'delimiter') {
      const values = simpleDelimiter ? firstGroup.split(simpleDelimiter) : [];
      const cleanedValues = values
        .map(value => trimValues ? value.trim() : value)
        .filter(value => !dropEmptyValues || value !== '');
      nextParts = simpleDelimiter
        ? cleanedValues.map((value, index) => ({
          id: index,
          type: 'indexed',
          partIndex: index,
          preview: value,
          outputType: 'direct',
          specName: '',
          customName: '',
          targetColumn: '',
        }))
        : [];
    } else if (splitMode === 'characters') {
      const width = Math.max(1, Number(chunkSize) || 1);
      nextParts = [];
      for (let index = 0; index < firstGroup.length; index += width) {
        const value = firstGroup.slice(index, index + width);
        const preview = trimValues ? value.trim() : value;
        if (dropEmptyValues && preview === '') continue;
        nextParts.push({
          id: nextParts.length,
          type: 'indexed',
          partIndex: nextParts.length,
          preview,
          outputType: 'direct',
          specName: '',
          customName: '',
          targetColumn: '',
        });
      }
    } else {
      nextParts = buildParts(firstGroup, boundaries, trimValues, dropEmptyValues);
    }
    setParts(previous => nextParts.map((part, index) => ({
      ...part,
      outputType: previous[index]?.outputType || part.outputType,
      specName: previous[index]?.specName || '',
      customName: previous[index]?.customName || '',
      targetColumn: previous[index]?.targetColumn || '',
    })));
  }, [boundaries, chunkSize, dropEmptyValues, firstGroup, simpleDelimiter, splitMode, trimValues]);

  const analyzeColumn = async () => {
    if (!selectedColumn) return;
    try {
      setLoading(true);
      setError('');
      const response = await fetch(`${API_BASE}/parser/analyze/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, column_name: selectedColumn }),
      });
      const data = await response.json();
      if (!data.success || !data.sample_values?.length) {
        throw new Error(data.error || 'No values found in this column');
      }
      setSampleValues(data.sample_values);
      const suggestedSeparator = data.suggested_separator || '';
      const referenceSource = String(parseReference?.source || '');
      const referenceEntrySource = String(parseReference?.entrySource || '');
      const referenceRowIndex = referenceSource
        ? data.sample_values.findIndex(value => String(value || '') === referenceSource)
        : -1;
      // In 'group' mode the flat sample list counts entries, not rows, so skip
      // past every entry contributed by the rows above the referenced one.
      const referenceRowEntries = sampleUnit === 'group' && referenceRowIndex >= 0
        ? expandSampleGroups(data.sample_values[referenceRowIndex], suggestedSeparator, trimValues)
        : [];
      const referenceEntryOffset = referenceEntrySource
        ? Math.max(0, referenceRowEntries.findIndex(entry => entry === referenceEntrySource))
        : 0;
      const referenceIndex = sampleUnit === 'group' && referenceRowIndex >= 0
        ? data.sample_values
          .slice(0, referenceRowIndex)
          .reduce((total, value) => total + expandSampleGroups(value, suggestedSeparator, trimValues).length, 0) + referenceEntryOffset
        : referenceRowIndex;
      setCurrentSampleIndex(referenceIndex > 0 ? referenceIndex : 0);
      setTotalValues(data.total_values || data.sample_values.length);
      const initialGroupSeparator = sampleUnit === 'group' ? suggestedSeparator : '';
      setGroupSeparator(initialGroupSeparator);
      if (GROUP_SEPARATOR_PRESETS.includes(initialGroupSeparator)) {
        setGroupSeparatorMode(initialGroupSeparator);
      } else {
        setGroupSeparatorMode(CUSTOM_GROUP_SEPARATOR);
        setCustomGroupSeparator(initialGroupSeparator);
      }
      setCommonDelimiters(data.common_delimiters || []);
      setBoundaries([]);
      setParts([]);
      setPreviewData(null);
      setStep(0);
    } catch (analyzeError) {
      setError(analyzeError.message || 'Could not analyze the column');
    } finally {
      setLoading(false);
    }
  };

  // The caller already picked the column (Edit pattern knows which one), so
  // analyze it straight away instead of parking on an Analyze button.
  useEffect(() => {
    if (!initialColumn || !columns.length) return;
    if (selectedColumn !== initialColumn) return;
    if (autoAnalyzedColumn.current === selectedColumn) return;
    autoAnalyzedColumn.current = selectedColumn;
    analyzeColumn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns.length, initialColumn, selectedColumn]);

  const toggleBoundary = useCallback((char, index) => {
    setBoundaries(current => {
      const exists = current.some(boundary => boundary.index === index);
      if (exists) return current.filter(boundary => boundary.index !== index);
      return [...current, { index, char }].sort((a, b) => a.index - b.index);
    });
  }, []);

  const updatePart = (id, field, value) => {
    setParts(current => current.map(part => part.id === id ? { ...part, [field]: value } : part));
  };

  const discardPartOutput = (id) => {
    setParts(current => current.map(part => (
      part.id === id
        ? {
            ...part,
            outputType: 'discard',
            specName: '',
            customName: '',
            targetColumn: '',
          }
        : part
    )));
    setError('');
    setPreviewData(null);
  };

  // Where the entry on screen sits inside the referenced row, so its detected
  // MPN/MFR pair can be looked up by position. -1 when it came from another row.
  const referenceEntryIndex = useMemo(() => {
    if (sampleUnit !== 'group' || !parseReference?.source || !currentSample) return -1;
    return expandSampleGroups(parseReference.source, groupSeparator, trimValues)
      .findIndex(entry => entry === currentSample);
  }, [currentSample, groupSeparator, parseReference?.source, sampleUnit, trimValues]);

  // What the detector reads out of the entry on screen. Parsing it live keeps
  // every sample annotated; the review dialog only ever carried one example.
  const currentSamplePairs = useMemo(() => {
    if (sampleUnit !== 'group') return parseReference?.pairs || [];
    if (!currentSample) return [];
    if (typeof describeSample === 'function') return describeSample(currentSample) || [];
    // Fall back to the example pair, matched by position within its own row —
    // never by substring, since MPNs nest (BSS84 / BSS84P).
    return [(parseReference?.pairs || [])[referenceEntryIndex]].filter(Boolean);
  }, [currentSample, describeSample, parseReference?.pairs, referenceEntryIndex, sampleUnit]);

  const outputPreviewItems = useMemo(() => {
    if (step === 0 || !parts.length) {
      return currentSamplePairs.flatMap((pair) => ([
        pair.mpn ? { type: 'mpn', label: `MPN: ${pair.mpn}` } : null,
        pair.manufacturer ? { type: 'mfr', label: `MFR: ${pair.manufacturer}` } : null,
        pair.discarded ? { type: 'discard', label: `Ignore: ${pair.discarded}` } : null,
      ].filter(Boolean)));
    }

    return parts
      .map((part) => {
        const value = part.preview || '';
        if (!value) return null;
        if (part.outputType === 'discard') return { type: 'discard', label: `Ignore: ${value}` };
        if (part.outputType === 'custom') return { type: 'custom', label: `${part.customName || 'Custom'}: ${value}` };
        if (part.outputType === 'direct') {
          const target = part.targetColumn || 'FactWise';
          const label = FACTWISE_OUTPUT_COLUMNS.find(option => option.value === target)?.label || target;
          if (target === 'MPN') return { type: 'mpn', label: `MPN: ${value}` };
          if (target === 'MFR') return { type: 'mfr', label: `MFR: ${value}` };
          if (target.startsWith('Tag_')) return { type: 'tag', label: `${label}: ${value}` };
          if (target.startsWith('Specification_')) return { type: 'spec', label: `${label}: ${value}` };
          return { type: 'direct', label: `${label}: ${value}` };
        }
        return null;
      })
      .filter(Boolean);
  }, [currentSamplePairs, parts, step]);

  const previewChipSx = (type) => {
    if (type === 'discard') return { fontWeight: 650, color: '#94a3b8', borderColor: '#334155' };
    if (type === 'tag') return { fontWeight: 700, bgcolor: '#7c3aed', color: '#fff' };
    if (type === 'spec') return { fontWeight: 700, bgcolor: '#f59e0b', color: '#111827' };
    if (type === 'custom') return { fontWeight: 700, bgcolor: '#6366f1', color: '#fff' };
    if (type === 'direct') return { fontWeight: 700, bgcolor: '#0f766e', color: '#fff' };
    return { fontWeight: 700 };
  };

  const renderParseReference = () => {
    // 'group' mode shows the one entry being cut; 'row' mode shows the whole cell.
    const referenceSample = sampleUnit === 'group' ? currentSample : (parseReference?.source || '');
    if (!parseReference?.source || !referenceSample) return null;
    return (
      <Box sx={{ p: 1.15, mb: 1.5, border: '1px solid #273244', bgcolor: '#0b1220', borderRadius: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', lineHeight: 1.4, wordBreak: 'break-word' }}>
          {referenceSample}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.9 }}>
          {outputPreviewItems.map((item, index) => (
            <Chip
              key={`${item.type}-${item.label}-${index}`}
              size="small"
              color={item.type === 'mpn' ? 'success' : item.type === 'mfr' ? 'info' : undefined}
              variant={item.type === 'discard' ? 'outlined' : 'filled'}
              label={item.label}
              sx={previewChipSx(item.type)}
            />
          ))}
        </Box>
      </Box>
    );
  };

  const parserConfig = useMemo(() => {
    const extractions = parts.map((part, index) => {
      return {
        type: part.type,
        part_index: part.partIndex ?? index,
        char1: part.type === 'between' ? part.startDelimiter : part.delimiter,
        char2: part.type === 'between' ? part.endDelimiter : '',
        char1_index: part.type === 'between' ? part.startDelimiterIndex : part.delimiterIndex,
        char2_index: part.type === 'between' ? part.endDelimiterIndex : null,
        char1_occurrence: part.type === 'between' ? part.startDelimiterOccurrence : part.delimiterOccurrence,
        char2_occurrence: part.type === 'between' ? part.endDelimiterOccurrence : null,
        output_type: part.outputType,
        spec_name: '',
        spec_pair_index: null,
        include_spec_name: true,
        custom_name: part.outputType === 'custom' ? (part.customName || '').trim() : '',
        target_column: part.outputType === 'direct' ? (part.targetColumn || '').trim() : '',
      };
    });
    return { patterns: [{
      name: 'User Pattern',
      group_separator: groupSeparator,
      split_mode: splitMode,
      delimiter: simpleDelimiter,
      chunk_size: Math.max(1, Number(chunkSize) || 1),
      trim_values: trimValues,
      drop_empty: dropEmptyValues,
      keep_source_column: keepSourceColumn,
      extractions,
    }] };
  }, [chunkSize, dropEmptyValues, groupSeparator, keepSourceColumn, parts, simpleDelimiter, splitMode, trimValues]);

  const loadPreview = async () => {
    if (parts.some(part => part.outputType === 'direct' && !part.targetColumn.trim())) {
      setError('Select a target column for every FactWise output.');
      return;
    }
    if (parts.some(part => part.outputType === 'custom' && !part.customName.trim())) {
      setError('Enter a name for every Custom column output.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const response = await fetch(`${API_BASE}/parser/preview/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          source_column: selectedColumn,
          parser_config: parserConfig,
          preview_rows: 5,
        }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Preview failed');
      setPreviewData(data);
      setStep(2);
    } catch (previewError) {
      setError(previewError.message || 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const applyParser = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetch(`${API_BASE}/parser/apply/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          source_column: selectedColumn,
          parser_config: parserConfig,
        }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Could not apply parser');
      onApply?.({
        ...data,
        parser_config: parserConfig,
        parser_parts: parts,
        parser_preview: {
          source: parseReference?.source || currentSample,
          items: outputPreviewItems,
        },
      });
    } catch (applyError) {
      setError(applyError.message || 'Could not apply parser');
    } finally {
      setLoading(false);
    }
  };

  const renderPartOutputRows = () => (
    <Box sx={{ borderTop: '1px solid #e5e7eb', mb: 2 }}>
      {parts.map((part, index) => (
        <Box
          key={part.id}
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(140px, 1fr) 190px minmax(200px, 1fr) 96px' },
            gap: 1.5,
            alignItems: 'center',
            py: 1.25,
            borderBottom: '1px solid #e5e7eb',
          }}
        >
          <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {index + 1}. {part.preview || '(empty)'}
          </Typography>
          <FormControl size="small">
            <InputLabel>Output</InputLabel>
            <Select
              label="Output"
              value={part.outputType === 'discard' ? '' : part.outputType}
              displayEmpty
              renderValue={(selected) => {
                if (!selected) return '';
                const labels = {
                  direct: 'Output field',
                  custom: 'Custom column',
                };
                return labels[selected] || selected;
              }}
              onChange={event => {
                updatePart(part.id, 'outputType', event.target.value);
                setError('');
                setPreviewData(null);
              }}
            >
              <MenuItem value="direct">Output field</MenuItem>
              <MenuItem value="custom">Custom column</MenuItem>
            </Select>
          </FormControl>
          {part.outputType === 'direct' ? (
            <FormControl size="small">
              <InputLabel>Target column</InputLabel>
              <Select
                label="Target column"
                value={part.targetColumn}
                onChange={event => {
                  updatePart(part.id, 'targetColumn', event.target.value);
                  setError('');
                  setPreviewData(null);
                }}
              >
                {FACTWISE_OUTPUT_COLUMNS.map(option => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : part.outputType === 'custom' ? (
            <TextField
              size="small"
              label="Column name"
              value={part.customName}
              onChange={event => {
                updatePart(part.id, 'customName', event.target.value);
                setError('');
                setPreviewData(null);
              }}
            />
          ) : (
            <Typography variant="caption" color="text.secondary">
              This value will not be added to the output.
            </Typography>
          )}
          <Tooltip title="Discard this text">
            <span style={{ justifySelf: 'end' }}>
              <IconButton
                size="small"
                color="error"
                onClick={() => discardPartOutput(part.id)}
                disabled={part.outputType === 'discard'}
                aria-label="Discard this text"
                sx={{
                  width: 34,
                  height: 34,
                  border: '1px solid',
                  borderColor: part.outputType === 'discard' ? '#e5e7eb' : '#fecaca',
                  bgcolor: part.outputType === 'discard' ? '#f8fafc' : '#fff5f5',
                  '&:hover': {
                    bgcolor: '#fee2e2',
                  },
                }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      ))}
    </Box>
  );

  return (
    <Box sx={{ pt: 1 }}>
      <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>
        {STEPS.map(label => (
          <Step key={label}><StepLabel>{label}</StepLabel></Step>
        ))}
      </Stepper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {step === 0 && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap', mb: sampleValues.length ? 2.5 : 0 }}>
            <FormControl size="small" sx={{ minWidth: 260, flex: 1 }}>
              <InputLabel>Column to parse</InputLabel>
              <Select
                label="Column to parse"
                value={selectedColumn}
                onChange={event => {
                  setSelectedColumn(event.target.value);
                  setSampleValues([]);
                  setBoundaries([]);
                  setParts([]);
                  setPreviewData(null);
                  setError('');
                }}
              >
                {columns.map(column => (
                  <MenuItem key={`${column.value}-${column.index}`} value={column.value}>{column.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="contained"
              endIcon={loading ? <CircularProgress size={16} /> : <ArrowForwardIcon />}
              onClick={analyzeColumn}
              disabled={!selectedColumn || loading}
            >
              {loading ? 'Analyzing...' : sampleValues.length ? 'Analyze again' : 'Analyze'}
            </Button>
          </Box>

          {sampleValues.length > 0 && (
            <>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2 }}>
                <Box>
                  <Typography variant="subtitle2">Sample {currentSampleIndex + 1} of {sampleEntries.length}</Typography>
                  <Typography variant="caption" color="text.secondary">{totalValues} populated rows</Typography>
                </Box>
                {(!hasParseReference || sampleUnit === 'group') && (
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <IconButton size="small" onClick={() => setCurrentSampleIndex(index => index - 1)} disabled={currentSampleIndex === 0}>
                      <ChevronLeftIcon />
                    </IconButton>
                    <IconButton size="small" onClick={() => setCurrentSampleIndex(index => index + 1)} disabled={currentSampleIndex >= sampleEntries.length - 1}>
                      <ChevronRightIcon />
                    </IconButton>
                  </Box>
                )}
              </Box>
              {renderParseReference()}

              <Box sx={{ mb: 2.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
                  <Typography variant="subtitle2" sx={{ pt: 1 }}>
                    {splitMode === 'delimiter' ? 'Delimiter settings' : 'Select split points'}
                  </Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', ml: 'auto', maxWidth: '100%' }}>
                    {splitMode === 'delimiter' && (
                      <FormControl size="small" sx={{ width: { xs: '100%', sm: 190 }, maxWidth: '100%' }}>
                        <InputLabel>Delimiter</InputLabel>
                        <Select
                          label="Delimiter"
                          value={simpleDelimiterMode}
                          onChange={event => {
                            const mode = event.target.value;
                            setSimpleDelimiterMode(mode);
                            setSimpleDelimiter(mode === CUSTOM_SIMPLE_DELIMITER ? customSimpleDelimiter : mode);
                            setPreviewData(null);
                          }}
                        >
                          <MenuItem value="" disabled>Select delimiter</MenuItem>
                          {SIMPLE_DELIMITER_PRESETS.map(option => (
                            <MenuItem key={option.label} value={option.value}>{option.label}</MenuItem>
                          ))}
                          <MenuItem value={CUSTOM_SIMPLE_DELIMITER}>Custom text...</MenuItem>
                        </Select>
                      </FormControl>
                    )}
                    {splitMode === 'delimiter' && simpleDelimiterMode === CUSTOM_SIMPLE_DELIMITER && (
                      <TextField
                        size="small"
                        label="Custom delimiter"
                        value={customSimpleDelimiter}
                        onChange={event => {
                          setCustomSimpleDelimiter(event.target.value);
                          setSimpleDelimiter(event.target.value);
                          setPreviewData(null);
                        }}
                        sx={{ width: { xs: '100%', sm: 190 }, maxWidth: '100%' }}
                      />
                    )}
                    {splitMode === 'characters' && (
                      <TextField
                        size="small"
                        type="number"
                        label="Characters per column"
                        value={chunkSize}
                        onChange={event => setChunkSize(Math.max(1, Number(event.target.value) || 1))}
                        InputProps={{ inputProps: { min: 1 } }}
                        sx={{ width: { xs: '100%', sm: 190 }, maxWidth: '100%' }}
                      />
                    )}
                    <FormControl size="small" sx={{ width: { xs: '100%', sm: 220 }, maxWidth: '100%' }}>
                      <InputLabel>Group separator</InputLabel>
                      <Select
                        label="Group separator"
                        value={groupSeparatorMode}
                        onChange={event => {
                          const mode = event.target.value;
                          setGroupSeparatorMode(mode);
                          setGroupSeparator(mode === CUSTOM_GROUP_SEPARATOR ? customGroupSeparator : mode);
                        }}
                      >
                        <MenuItem value="">None</MenuItem>
                        <MenuItem value={STRUCTURED_STATUS_GROUP_SEPARATOR}>Structured block&nbsp; (...) {'{...}'} [...]</MenuItem>
                        <MenuItem value="),">Closing bracket + comma&nbsp; ),</MenuItem>
                        <MenuItem value=",">Comma&nbsp; ,</MenuItem>
                        <MenuItem value="/">Slash&nbsp; /</MenuItem>
                        <MenuItem value="|">Pipe&nbsp; |</MenuItem>
                        <MenuItem value=";">Semicolon&nbsp; ;</MenuItem>
                        <MenuItem value=" ">Space</MenuItem>
                        <MenuItem value={CUSTOM_GROUP_SEPARATOR}>Custom...</MenuItem>
                      </Select>
                    </FormControl>
                    {groupSeparatorMode === CUSTOM_GROUP_SEPARATOR && (
                      <TextField
                        size="small"
                        label="Custom separator"
                        value={customGroupSeparator}
                        onChange={event => {
                          setCustomGroupSeparator(event.target.value);
                          setGroupSeparator(event.target.value);
                        }}
                        sx={{ width: { xs: '100%', sm: 190 }, maxWidth: '100%' }}
                      />
                    )}
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {firstGroup.split('').map((char, index) => {
                    const selected = splitMode === 'delimiter'
                      ? char === simpleDelimiter
                      : splitMode === 'pattern' && boundaries.some(boundary => boundary.index === index);
                    const width = Math.max(1, Number(chunkSize) || 1);
                    const fixedBoundary = splitMode === 'characters'
                      && (index + 1) % width === 0
                      && index < firstGroup.length - 1;
                    const common = commonDelimiters.includes(char);
                    return (
                      <Tooltip key={`${char}-${index}`} title={common ? `Common delimiter: ${char === ' ' ? 'space' : char}` : ''}>
                        <Box
                          component="button"
                          type="button"
                          onClick={() => {
                            if (splitMode === 'delimiter') {
                              setSimpleDelimiter(char);
                              const preset = SIMPLE_DELIMITER_PRESETS.find(option => option.value === char);
                              setSimpleDelimiterMode(preset ? preset.value : CUSTOM_SIMPLE_DELIMITER);
                              if (!preset) setCustomSimpleDelimiter(char);
                              return;
                            }
                            if (splitMode === 'pattern') toggleBoundary(char, index);
                          }}
                          sx={{
                            width: char === ' ' ? 58 : 32,
                            height: 36,
                            border: selected ? '2px solid #15803d' : `1px solid ${splitMode === 'pattern' && common ? '#0284c7' : '#d1d5db'}`,
                            borderRight: fixedBoundary ? '4px solid #15803d' : undefined,
                            bgcolor: selected ? '#dcfce7' : '#fff',
                            color: '#111827',
                            fontFamily: 'monospace',
                            cursor: splitMode === 'characters' ? 'default' : 'pointer',
                          }}
                        >
                          {char === ' ' ? 'Space' : char}
                        </Box>
                      </Tooltip>
                    );
                  })}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 4, rowGap: 0.5, flexWrap: 'wrap', mt: 2 }}>
                  <FormControlLabel
                    sx={{ m: 0 }}
                    control={<Checkbox checked={trimValues} onChange={event => setTrimValues(event.target.checked)} />}
                    label="Trim spaces"
                  />
                  {!hasParseReference && (
                    <FormControlLabel
                      sx={{ m: 0 }}
                      control={<Checkbox checked={dropEmptyValues} onChange={event => setDropEmptyValues(event.target.checked)} />}
                      label="Drop empty values"
                    />
                  )}
                </Box>
              </Box>

              {parts.length > 0 && (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                  {parts.map((part, index) => (
                    <Chip key={part.id} label={`${index + 1}: ${part.preview || '(empty)'}`} />
                  ))}
                </Box>
              )}

              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="contained" endIcon={<ArrowForwardIcon />} onClick={() => setStep(1)} disabled={!parts.length}>
                  Configure outputs
                </Button>
              </Box>
            </>
          )}
        </Box>
      )}

      {step === 1 && (
        <Box>
          {renderParseReference()}
          {renderPartOutputRows()}
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => setStep(0)}>Back</Button>
            <Button variant="contained" startIcon={<ContentCutIcon />} onClick={loadPreview} disabled={loading}>
              {loading ? 'Preparing...' : 'Preview'}
            </Button>
          </Box>
        </Box>
      )}

      {step === 2 && previewData && (
        <Box>
          {renderParseReference()}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
            <Chip label={`${previewData.total_rows || 0} rows`} />
            <Chip label={`${previewData.preview_headers?.length || 0} output columns`} />
            {previewData.max_counts?.tags > 0 && <Chip label={`${previewData.max_counts.tags} Tags`} />}
          </Box>
          <TableContainer sx={{ maxHeight: 280, border: '1px solid #e5e7eb', mb: 2 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {previewData.preview_headers?.map(header => <TableCell key={header}>{header}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {previewData.preview_data?.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {previewData.preview_headers?.map((header, columnIndex) => (
                      <TableCell key={`${header}-${columnIndex}`}>{row[columnIndex]}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => setStep(1)}>Back</Button>
            <Button variant="contained" color="success" startIcon={loading ? <CircularProgress size={16} /> : <CheckIcon />} onClick={applyParser} disabled={loading}>
              {loading ? 'Applying...' : 'Apply structured split'}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default ColumnParser;
