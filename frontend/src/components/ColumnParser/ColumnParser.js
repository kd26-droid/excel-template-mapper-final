import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
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
const STEPS = ['Column', 'Split points', 'Outputs', 'Preview'];

const buildParts = (text, boundaries) => {
  if (!text || boundaries.length === 0) return [];
  const ordered = [...boundaries].sort((a, b) => a.index - b.index);
  const parts = [];

  if (ordered[0].index > 0) {
    parts.push({
      id: 0,
      type: 'before',
      delimiter: ordered[0].char,
      preview: text.substring(0, ordered[0].index).trim(),
      outputType: 'spec',
      specName: '',
    });
  }

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index].index + 1;
    const end = ordered[index + 1].index;
    if (end > start) {
      parts.push({
        id: index + 1,
        type: 'between',
        startDelimiter: ordered[index].char,
        endDelimiter: ordered[index + 1].char,
        preview: text.substring(start, end).trim(),
        outputType: 'spec',
        specName: '',
      });
    }
  }

  const last = ordered[ordered.length - 1];
  if (last.index < text.length - 1) {
    parts.push({
      id: ordered.length,
      type: 'after',
      delimiter: last.char,
      preview: text.substring(last.index + 1).trim(),
      outputType: 'spec',
      specName: '',
    });
  }

  return parts;
};

const ColumnParser = ({ sessionId, onApply, initialColumn = '' }) => {
  const [step, setStep] = useState(0);
  const [columns, setColumns] = useState([]);
  const [selectedColumn, setSelectedColumn] = useState(initialColumn);
  const [sampleValues, setSampleValues] = useState([]);
  const [currentSampleIndex, setCurrentSampleIndex] = useState(0);
  const [totalValues, setTotalValues] = useState(0);
  const [groupSeparator, setGroupSeparator] = useState('');
  const [commonDelimiters, setCommonDelimiters] = useState([]);
  const [boundaries, setBoundaries] = useState([]);
  const [parts, setParts] = useState([]);
  const [previewData, setPreviewData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadColumns = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${API_BASE}/parser/columns/${sessionId}/`);
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Could not load columns');
        const nextColumns = data.columns || [];
        setColumns(nextColumns);
        if (initialColumn && nextColumns.includes(initialColumn)) setSelectedColumn(initialColumn);
      } catch (loadError) {
        setError(loadError.message || 'Could not load columns');
      } finally {
        setLoading(false);
      }
    };
    loadColumns();
  }, [sessionId, initialColumn]);

  const currentSample = sampleValues[currentSampleIndex] || '';
  const firstGroup = useMemo(() => {
    if (!currentSample || !groupSeparator) return currentSample;
    let groups = currentSample.split(groupSeparator);
    if (groupSeparator === '),') {
      groups = groups.map((group, index) => index < groups.length - 1 ? `${group})` : group);
    }
    return groups[0]?.trim() || currentSample;
  }, [currentSample, groupSeparator]);

  useEffect(() => {
    const nextParts = buildParts(firstGroup, boundaries);
    setParts(previous => nextParts.map((part, index) => ({
      ...part,
      outputType: previous[index]?.outputType || part.outputType,
      specName: previous[index]?.specName || '',
    })));
  }, [firstGroup, boundaries]);

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
      setGroupSeparator(data.suggested_separator || '');
      setCommonDelimiters(data.common_delimiters || []);
      setBoundaries([]);
      setParts([]);
      setPreviewData(null);
      setStep(1);
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
      extractions: parts.map(part => ({
        type: part.type,
        char1: part.type === 'before' ? part.delimiter : part.startDelimiter,
        char2: part.type === 'between' ? part.endDelimiter : '',
        output_type: part.outputType,
        spec_name: part.specName || '',
      })),
    }],
  }), [groupSeparator, parts]);

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
      setStep(3);
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
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 260, flex: 1 }}>
            <InputLabel>Column to parse</InputLabel>
            <Select
              label="Column to parse"
              value={selectedColumn}
              onChange={event => setSelectedColumn(event.target.value)}
            >
              {columns.map(column => <MenuItem key={column} value={column}>{column}</MenuItem>)}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            endIcon={loading ? <CircularProgress size={16} /> : <ArrowForwardIcon />}
            onClick={analyzeColumn}
            disabled={!selectedColumn || loading}
          >
            Analyze
          </Button>
        </Box>
      )}

      {step === 1 && (
        <Box>
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

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            <TextField
              size="small"
              label="Group separator"
              value={groupSeparator}
              onChange={event => setGroupSeparator(event.target.value)}
              sx={{ width: 180 }}
            />
            {['),', ',', '|', ';'].map(separator => (
              <Chip
                key={separator}
                label={separator}
                variant={groupSeparator === separator ? 'filled' : 'outlined'}
                color={groupSeparator === separator ? 'primary' : 'default'}
                onClick={() => setGroupSeparator(separator)}
              />
            ))}
          </Box>

          <Box sx={{ borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', py: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Select split points</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {firstGroup.split('').map((char, index) => {
                const selected = boundaries.some(boundary => boundary.index === index);
                const common = commonDelimiters.includes(char);
                return (
                  <Tooltip key={`${char}-${index}`} title={common ? `Common delimiter: ${char === ' ' ? 'space' : char}` : ''}>
                    <Box
                      component="button"
                      type="button"
                      onClick={() => toggleBoundary(char, index)}
                      sx={{
                        width: 32,
                        height: 36,
                        border: selected ? '2px solid #15803d' : `1px solid ${common ? '#0284c7' : '#d1d5db'}`,
                        bgcolor: selected ? '#dcfce7' : '#fff',
                        color: '#111827',
                        fontFamily: 'monospace',
                        cursor: 'pointer',
                      }}
                    >
                      {char === ' ' ? 'SP' : char}
                    </Box>
                  </Tooltip>
                );
              })}
            </Box>
          </Box>

          {parts.length > 0 && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              {parts.map((part, index) => (
                <Chip key={part.id} label={`${index + 1}: ${part.preview || '(empty)'}`} />
              ))}
            </Box>
          )}

          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => setStep(0)}>Back</Button>
            <Button variant="contained" endIcon={<ArrowForwardIcon />} onClick={() => setStep(2)} disabled={!parts.length}>
              Configure outputs
            </Button>
          </Box>
        </Box>
      )}

      {step === 2 && (
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
            <Button startIcon={<ArrowBackIcon />} onClick={() => setStep(1)}>Back</Button>
            <Button variant="contained" startIcon={<ContentCutIcon />} onClick={loadPreview} disabled={loading}>
              {loading ? 'Preparing...' : 'Preview'}
            </Button>
          </Box>
        </Box>
      )}

      {step === 3 && previewData && (
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
            <Button startIcon={<ArrowBackIcon />} onClick={() => setStep(2)}>Back</Button>
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
