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
const GROUP_SEPARATOR_PRESETS = ['', '),', ',', '/', '|', ';', ' '];

const buildParts = (text, boundaries, trimValues, dropEmptyValues) => {
  if (!text || boundaries.length === 0) return [];
  const ordered = [...boundaries].sort((a, b) => a.index - b.index);
  const cleanValue = value => trimValues ? value.trim() : value;
  const parts = [{
    id: 0,
    type: 'before',
    delimiter: ordered[0].char,
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
  const [chunkSize, setChunkSize] = useState(3);
  const [trimValues, setTrimValues] = useState(true);
  const [dropEmptyValues, setDropEmptyValues] = useState(true);
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

  const parserConfig = useMemo(() => ({
    patterns: [{
      name: 'User Pattern',
      group_separator: groupSeparator,
      split_mode: splitMode,
      delimiter: simpleDelimiter,
      chunk_size: Math.max(1, Number(chunkSize) || 1),
      trim_values: trimValues,
      drop_empty: dropEmptyValues,
      extractions: parts.map((part, index) => ({
        type: part.type,
        part_index: part.partIndex ?? index,
        char1: part.type === 'before' ? part.delimiter : part.startDelimiter,
        char2: part.type === 'between' ? part.endDelimiter : '',
        output_type: part.outputType,
        spec_name: part.specName || '',
      })),
    }],
  }), [chunkSize, dropEmptyValues, groupSeparator, parts, simpleDelimiter, splitMode, trimValues]);

  const loadPreview = async () => {
    if (parts.some(part => part.outputType === 'spec' && !part.specName.trim())) {
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
