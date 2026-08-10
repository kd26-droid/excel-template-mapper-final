import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
} from '@mui/icons-material';

const API_BASE = process.env.REACT_APP_API_BASE_URL || '/api';
const STEPS = ['Split points', 'Outputs', 'Preview'];
const CUSTOM_GROUP_SEPARATOR = '__custom__';
const CUSTOM_SIMPLE_DELIMITER = '__custom__';
const GROUP_SEPARATOR_PRESETS = ['', '),', ',', '/', '|', ';', ' '];
const SIMPLE_DELIMITER_PRESETS = [
  { value: ',', label: 'Comma ,' },
  { value: ';', label: 'Semicolon ;' },
  { value: '|', label: 'Pipe |' },
  { value: '/', label: 'Slash /' },
  { value: ' ', label: 'Space' },
  { value: '\t', label: 'Tab' },
  { value: '\n', label: 'New line' },
];

const numberedColumnIndex = (value, pattern, genericName) => {
  const match = String(value || '').match(pattern);
  if (match) return Number(match[1]);
  return String(value || '').toLowerCase() === genericName.toLowerCase() ? 1 : 0;
};

const escapeRegExp = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    outputType: 'spec',
    specName: '',
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
      outputType: 'spec',
      specName: '',
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
    outputType: 'spec',
    specName: '',
  });

  return dropEmptyValues ? parts.filter(part => part.preview !== '') : parts;
};

const ColumnParser = ({ sessionId, onApply, initialColumn = '', availableColumns = null }) => {
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
  const [keepSourceColumn, setKeepSourceColumn] = useState(true);
  const [simpleOutputType, setSimpleOutputType] = useState('tag');
  const [simpleSpecTarget, setSimpleSpecTarget] = useState('new');
  const [simpleSpecName, setSimpleSpecName] = useState('');
  const [simpleCustomName, setSimpleCustomName] = useState('');
  const [boundaries, setBoundaries] = useState([]);
  const [parts, setParts] = useState([]);
  const [previewData, setPreviewData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  const currentSample = sampleValues[currentSampleIndex] || '';
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
    if (!currentSample || !groupSeparator) return currentSample;
    let groups = currentSample.split(groupSeparator);
    if (groupSeparator === '),') {
      groups = groups.map((group, index) => index < groups.length - 1 ? `${group})` : group);
    }
    const first = groups[0] ?? currentSample;
    return trimValues ? first.trim() : first;
  }, [currentSample, groupSeparator, trimValues]);

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
          outputType: 'spec',
          specName: '',
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
          outputType: 'spec',
          specName: '',
        });
      }
    } else {
      nextParts = buildParts(firstGroup, boundaries, trimValues, dropEmptyValues);
    }
    setParts(previous => nextParts.map((part, index) => ({
      ...part,
      outputType: previous[index]?.outputType || part.outputType,
      specName: previous[index]?.specName || '',
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
      setCurrentSampleIndex(0);
      setTotalValues(data.total_values || data.sample_values.length);
      const suggestedSeparator = data.suggested_separator || '';
      setGroupSeparator(suggestedSeparator);
      if (GROUP_SEPARATOR_PRESETS.includes(suggestedSeparator)) {
        setGroupSeparatorMode(suggestedSeparator);
      } else {
        setGroupSeparatorMode(CUSTOM_GROUP_SEPARATOR);
        setCustomGroupSeparator(suggestedSeparator);
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

  const parserConfig = useMemo(() => {
    const extractions = parts.map((part, index) => {
      const simpleSpecOutput = splitMode === 'delimiter' && simpleOutputType === 'spec';
      return {
        type: part.type,
        part_index: part.partIndex ?? index,
        char1: part.type === 'between' ? part.startDelimiter : part.delimiter,
        char2: part.type === 'between' ? part.endDelimiter : '',
        char1_index: part.type === 'between' ? part.startDelimiterIndex : part.delimiterIndex,
        char2_index: part.type === 'between' ? part.endDelimiterIndex : null,
        char1_occurrence: part.type === 'between' ? part.startDelimiterOccurrence : part.delimiterOccurrence,
        char2_occurrence: part.type === 'between' ? part.endDelimiterOccurrence : null,
        output_type: splitMode === 'delimiter' ? simpleOutputType : part.outputType,
        spec_name: simpleSpecOutput
          ? (simpleSpecTarget === 'new' ? simpleSpecName.trim() : `Specification pair ${selectedSpecPairIndex}`)
          : (part.specName || ''),
        spec_pair_index: simpleSpecOutput ? selectedSpecPairIndex : null,
        include_spec_name: simpleSpecOutput ? simpleSpecTarget === 'new' : true,
        custom_name: splitMode === 'delimiter' && simpleOutputType === 'custom'
          ? simpleCustomName.trim()
          : '',
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
  }, [chunkSize, dropEmptyValues, groupSeparator, keepSourceColumn, parts, selectedSpecPairIndex, simpleCustomName, simpleDelimiter, simpleOutputType, simpleSpecName, simpleSpecTarget, splitMode, trimValues]);

  const loadPreview = async () => {
    if (splitMode === 'delimiter' && simpleOutputType === 'spec' && simpleSpecTarget === 'new' && !simpleSpecName.trim()) {
      setError('Enter a name for the new Specification pair.');
      return;
    }
    if (splitMode === 'delimiter' && simpleOutputType === 'custom' && !simpleCustomName.trim()) {
      setError('Enter a name for the custom columns.');
      return;
    }
    if (splitMode !== 'delimiter' && parts.some(part => part.outputType === 'spec' && !part.specName.trim())) {
      setError('Enter a name for every Specification output.');
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
      onApply?.(data);
    } catch (applyError) {
      setError(applyError.message || 'Could not apply parser');
    } finally {
      setLoading(false);
    }
  };

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
                  <Typography variant="subtitle2">Sample {currentSampleIndex + 1} of {sampleValues.length}</Typography>
                  <Typography variant="caption" color="text.secondary">{totalValues} populated rows</Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <IconButton size="small" onClick={() => setCurrentSampleIndex(index => index - 1)} disabled={currentSampleIndex === 0}>
                    <ChevronLeftIcon />
                  </IconButton>
                  <IconButton size="small" onClick={() => setCurrentSampleIndex(index => index + 1)} disabled={currentSampleIndex >= sampleValues.length - 1}>
                    <ChevronRightIcon />
                  </IconButton>
                </Box>
              </Box>

              <Box sx={{ mb: 2.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
                  <Typography variant="subtitle2" sx={{ pt: 1 }}>Select split points</Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', ml: 'auto', maxWidth: '100%' }}>
                    <FormControl size="small" sx={{ width: { xs: '100%', sm: 190 }, maxWidth: '100%' }}>
                      <InputLabel>Split by</InputLabel>
                      <Select
                        label="Split by"
                        value={splitMode}
                        onChange={event => {
                          const nextMode = event.target.value;
                          setSplitMode(nextMode);
                          setBoundaries([]);
                          setSimpleDelimiter('');
                          setSimpleDelimiterMode('');
                          setPreviewData(null);
                          if (nextMode !== 'pattern') {
                            setGroupSeparator('');
                            setGroupSeparatorMode('');
                          }
                        }}
                      >
                        <MenuItem value="pattern">Pattern</MenuItem>
                        <MenuItem value="delimiter">Simple delimiter</MenuItem>
                        <MenuItem value="characters">Every N characters</MenuItem>
                      </Select>
                    </FormControl>
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
                  <FormControlLabel
                    sx={{ m: 0 }}
                    control={<Checkbox checked={dropEmptyValues} onChange={event => setDropEmptyValues(event.target.checked)} />}
                    label="Drop empty values"
                  />
                  <FormControlLabel
                    sx={{ m: 0 }}
                    control={<Checkbox checked={keepSourceColumn} onChange={event => setKeepSourceColumn(event.target.checked)} />}
                    label="Keep original column"
                  />
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
          {splitMode === 'delimiter' ? (
            <Box sx={{ display: 'grid', gap: 2.25, mb: 2.5 }}>
              <FormControl size="small" fullWidth>
                <InputLabel>Output</InputLabel>
                <Select
                  label="Output"
                  value={simpleOutputType}
                  onChange={event => {
                    setSimpleOutputType(event.target.value);
                    setError('');
                    setPreviewData(null);
                  }}
                >
                  <MenuItem value="tag">Add Tags</MenuItem>
                  <MenuItem value="spec">Add Specification Values</MenuItem>
                  <MenuItem value="custom">Custom columns</MenuItem>
                </Select>
              </FormControl>

              {simpleOutputType === 'spec' && (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(220px, 1fr) minmax(220px, 1fr)' }, gap: 1.5 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Specification pair</InputLabel>
                    <Select
                      label="Specification pair"
                      value={simpleSpecTarget}
                      onChange={event => {
                        setSimpleSpecTarget(event.target.value);
                        setError('');
                        setPreviewData(null);
                      }}
                    >
                      {existingSpecPairs.map(pairIndex => (
                        <MenuItem key={pairIndex} value={String(pairIndex)}>Specification pair ({pairIndex})</MenuItem>
                      ))}
                      <MenuItem value="new">Add specification pair ({nextSpecPairIndex})</MenuItem>
                    </Select>
                  </FormControl>
                  {simpleSpecTarget === 'new' && (
                    <TextField
                      size="small"
                      label="Specification name"
                      value={simpleSpecName}
                      onChange={event => setSimpleSpecName(event.target.value)}
                    />
                  )}
                </Box>
              )}

              {simpleOutputType === 'custom' && (
                <TextField
                  size="small"
                  fullWidth
                  label="Column name"
                  placeholder="e.g. Reference Designator"
                  value={simpleCustomName}
                  onChange={event => {
                    setSimpleCustomName(event.target.value);
                    setError('');
                    setPreviewData(null);
                  }}
                />
              )}

              <Box sx={{ display: 'grid', gap: 1 }}>
                <Typography variant="subtitle2">Columns to add</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {simpleOutputType === 'tag' ? parts.map((part, index) => (
                      <Chip key={part.id} label={`Tag (${existingTagMax + index + 1}): ${part.preview || '(empty)'}`} />
                    )) : simpleOutputType === 'spec' ? parts.map((part, index) => (
                      <Chip key={part.id} label={`Specification value (${selectedSpecPairIndex}.${index + 1}): ${part.preview || '(empty)'}`} />
                    )) : parts.map((part, index) => (
                      <Chip
                        key={part.id}
                        label={`${simpleCustomName.trim() || 'Custom column'} (${existingCustomMax + index + 1}): ${part.preview || '(empty)'}`}
                      />
                    ))}
                </Box>
              </Box>
            </Box>
          ) : (
          <Box sx={{ borderTop: '1px solid #e5e7eb', mb: 2 }}>
            {parts.map((part, index) => (
              <Box
                key={part.id}
                sx={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) 160px minmax(180px, 1fr)', gap: 1.5, alignItems: 'center', py: 1.25, borderBottom: '1px solid #e5e7eb' }}
              >
                <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {index + 1}. {part.preview || '(empty)'}
                </Typography>
                <FormControl size="small">
                  <InputLabel>Output</InputLabel>
                  <Select label="Output" value={part.outputType} onChange={event => updatePart(part.id, 'outputType', event.target.value)}>
                    <MenuItem value="spec">Specification</MenuItem>
                    <MenuItem value="tag">Tag</MenuItem>
                  </Select>
                </FormControl>
                {part.outputType === 'spec' ? (
                  <TextField
                    size="small"
                    label="Specification name"
                    value={part.specName}
                    onChange={event => updatePart(part.id, 'specName', event.target.value)}
                  />
                ) : <Box />}
              </Box>
            ))}
          </Box>
          )}
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
