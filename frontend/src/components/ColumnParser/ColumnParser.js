/**
 * ColumnParser - Simple & Powerful Pattern Builder
 *
 * Flow:
 * 1. Select column
 * 2. See sample, auto-detected separator shown
 * 3. Click on characters to mark split points
 * 4. Label each part
 * 5. Preview & Apply
 */

import React, { useState, useEffect, useCallback } from 'react';
import './ColumnParser.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';

const ColumnParser = ({ sessionId, onClose, onApply }) => {
  // Steps: 1=select, 2=mark boundaries, 3=label, 4=preview
  const [step, setStep] = useState(1);

  // Data
  const [columns, setColumns] = useState([]);
  const [selectedColumn, setSelectedColumn] = useState('');
  const [sampleValues, setSampleValues] = useState([]);
  const [currentSampleIdx, setCurrentSampleIdx] = useState(0);
  const [totalValues, setTotalValues] = useState(0);

  // Auto-detected
  const [suggestedSeparator, setSuggestedSeparator] = useState('');
  const [groupCount, setGroupCount] = useState(1);
  const [commonDelimiters, setCommonDelimiters] = useState(['(', ')', ',', '|', ';']);

  // User input
  const [groupSeparator, setGroupSeparator] = useState('');
  const [boundaries, setBoundaries] = useState([]);
  const [parts, setParts] = useState([]);

  // Preview
  const [previewData, setPreviewData] = useState(null);

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const currentSample = sampleValues[currentSampleIdx] || '';

  // ═══════════════════════════════════════════════════════════════════════════
  // Load columns
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/parser/columns/${sessionId}/`);
        const data = await res.json();
        if (data.success) setColumns(data.columns || []);
      } catch (err) {
        setError('Failed to load columns');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [sessionId]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Analyze column
  // ═══════════════════════════════════════════════════════════════════════════
  const analyzeColumn = async () => {
    if (!selectedColumn) return;
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`${API_BASE}/parser/analyze/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, column_name: selectedColumn })
      });
      const data = await res.json();

      if (data.success && data.sample_values?.length > 0) {
        setSampleValues(data.sample_values);
        setCurrentSampleIdx(0);
        setTotalValues(data.total_values || data.sample_values.length);
        setSuggestedSeparator(data.suggested_separator || '');
        setGroupSeparator(data.suggested_separator || '');
        setGroupCount(data.detected_groups_count || 1);
        // Use common delimiters from backend - only these appear in ALL cells
        if (data.common_delimiters && data.common_delimiters.length > 0) {
          setCommonDelimiters(data.common_delimiters);
        }
        setBoundaries([]);
        setParts([]);
        setStep(2);
      } else {
        setError(data.error || 'No data found in this column');
      }
    } catch (err) {
      setError('Failed to analyze column');
    } finally {
      setLoading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Get first group for boundary marking
  // ═══════════════════════════════════════════════════════════════════════════
  const getFirstGroup = useCallback(() => {
    if (!currentSample) return '';
    if (groupSeparator) {
      let parts = currentSample.split(groupSeparator);
      // For '),', add back the ')' to first parts
      if (groupSeparator === '),') {
        parts = parts.map((p, i) => i < parts.length - 1 ? p + ')' : p);
      }
      return parts[0]?.trim() || currentSample;
    }
    return currentSample;
  }, [currentSample, groupSeparator]);

  const firstGroup = getFirstGroup();

  // Calculate actual group count from current sample
  const actualGroupCount = groupSeparator
    ? currentSample.split(groupSeparator).length
    : 1;

  // ═══════════════════════════════════════════════════════════════════════════
  // Handle character clicks
  // ═══════════════════════════════════════════════════════════════════════════
  const handleCharClick = (char, index) => {
    const exists = boundaries.findIndex(b => b.index === index);
    if (exists !== -1) {
      setBoundaries(boundaries.filter((_, i) => i !== exists));
    } else {
      setBoundaries([...boundaries, { index, char }].sort((a, b) => a.index - b.index));
    }
  };

  // Generate parts from boundaries
  useEffect(() => {
    if (boundaries.length === 0) {
      setParts([]);
      return;
    }

    const text = firstGroup;
    const newParts = [];

    // Before first boundary
    if (boundaries[0].index > 0) {
      newParts.push({
        id: 0,
        type: 'before',
        delimiter: boundaries[0].char,
        preview: text.substring(0, boundaries[0].index).trim(),
        outputType: 'spec',
        specName: ''
      });
    }

    // Between boundaries
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i].index + 1;
      const end = boundaries[i + 1].index;
      if (end > start) {
        newParts.push({
          id: i + 1,
          type: 'between',
          startDelimiter: boundaries[i].char,
          endDelimiter: boundaries[i + 1].char,
          preview: text.substring(start, end).trim(),
          outputType: 'spec',
          specName: ''
        });
      }
    }

    // After last boundary
    const last = boundaries[boundaries.length - 1];
    if (last && last.index < text.length - 1) {
      newParts.push({
        id: boundaries.length,
        type: 'after',
        delimiter: last.char,
        preview: text.substring(last.index + 1).trim(),
        outputType: 'spec',
        specName: ''
      });
    }

    setParts(newParts);
  }, [boundaries, firstGroup]);

  // Update part
  const updatePart = (id, field, value) => {
    setParts(parts.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Preview
  // ═══════════════════════════════════════════════════════════════════════════
  const loadPreview = async () => {
    // Validate
    const specParts = parts.filter(p => p.outputType === 'spec');
    if (specParts.some(p => !p.specName.trim())) {
      setError('Please enter a name for all Spec Pair fields');
      return;
    }

    // Build config
    const config = {
      patterns: [{
        name: 'User Pattern',
        group_separator: groupSeparator,
        extractions: parts.map(part => ({
          type: part.type,
          char1: part.type === 'before' ? part.delimiter : part.startDelimiter,
          char2: part.type === 'between' ? part.endDelimiter : '',
          output_type: part.outputType,
          spec_name: part.specName || ''
        }))
      }]
    };

    try {
      setLoading(true);
      setError('');
      const res = await fetch(`${API_BASE}/parser/preview/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          source_column: selectedColumn,
          parser_config: config,
          preview_rows: 5
        })
      });
      const data = await res.json();
      if (data.success) {
        setPreviewData(data);
        setStep(4);
      } else {
        setError(data.error || 'Preview failed');
      }
    } catch (err) {
      setError('Failed to generate preview');
    } finally {
      setLoading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Apply
  // ═══════════════════════════════════════════════════════════════════════════
  const applyParser = async () => {
    const config = {
      patterns: [{
        name: 'User Pattern',
        group_separator: groupSeparator,
        extractions: parts.map(part => ({
          type: part.type,
          char1: part.type === 'before' ? part.delimiter : part.startDelimiter,
          char2: part.type === 'between' ? part.endDelimiter : '',
          output_type: part.outputType,
          spec_name: part.specName || ''
        }))
      }]
    };

    try {
      setLoading(true);
      setError('');
      const res = await fetch(`${API_BASE}/parser/apply/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          source_column: selectedColumn,
          parser_config: config
        })
      });
      const data = await res.json();
      if (data.success) {
        onApply?.(data);
        onClose?.();
      } else {
        setError(data.error || 'Failed to apply');
      }
    } catch (err) {
      setError('Failed to apply parser');
    } finally {
      setLoading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Check if character is a SAFE delimiter (appears in ALL cells)
  // ═══════════════════════════════════════════════════════════════════════════
  const isDelimiterChar = (char) => {
    // Only highlight delimiters that appear in ALL cells
    // This prevents users from clicking on characters like '_' that only appear in some values
    return commonDelimiters.includes(char);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="parser-overlay">
      <div className="parser-modal">
        {/* Header */}
        <div className="parser-header">
          <div className="parser-header-content">
            <h2>🔧 Column Parser</h2>
            <p className="parser-subtitle">Split complex data into separate columns</p>
          </div>
          <button className="parser-close" onClick={onClose}>&times;</button>
        </div>

        {/* Progress */}
        <div className="parser-progress-dots">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`parser-dot ${step >= s ? 'active' : ''} ${step === s ? 'current' : ''}`} />
          ))}
        </div>

        {error && <div className="parser-error">{error}</div>}

        <div className="parser-content">

          {/* ═══════════════════════════════════════════════════════════════════ */}
          {/* STEP 1: Select Column */}
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {step === 1 && (
            <div className="parser-step-content">
              <div className="parser-question">
                <span className="parser-question-icon">📊</span>
                <span>Which column has data to split?</span>
              </div>

              <select
                className="parser-select"
                value={selectedColumn}
                onChange={e => setSelectedColumn(e.target.value)}
              >
                <option value="">Choose a column...</option>
                {columns.map((col, i) => <option key={i} value={col}>{col}</option>)}
              </select>

              <button
                className="parser-btn-primary parser-btn-full"
                onClick={analyzeColumn}
                disabled={!selectedColumn || loading}
              >
                {loading ? 'Analyzing...' : 'Continue →'}
              </button>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════ */}
          {/* STEP 2: Mark Boundaries */}
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {step === 2 && (
            <div className="parser-step-content">
              {/* Info bar */}
              <div className="parser-info-bar">
                <span>📋 <strong>{totalValues} rows</strong> will be parsed with this pattern</span>
                {actualGroupCount > 1 && (
                  <span className="parser-info-groups">
                    🔄 {actualGroupCount} groups per row
                  </span>
                )}
              </div>

              {/* Sample navigation */}
              <div className="parser-sample-nav">
                <span>Viewing example {currentSampleIdx + 1} (browse to see more)</span>
                <div>
                  <button disabled={currentSampleIdx === 0} onClick={() => setCurrentSampleIdx(i => i - 1)}>←</button>
                  <button disabled={currentSampleIdx >= sampleValues.length - 1} onClick={() => setCurrentSampleIdx(i => i + 1)}>→</button>
                </div>
              </div>

              {/* Separator config (collapsible) */}
              {actualGroupCount > 1 && (
                <div className="parser-separator-config">
                  <label>Group separator:</label>
                  <div className="parser-separator-chips">
                    {['),', ',', '|', ';'].map(sep => (
                      <button
                        key={sep}
                        className={`parser-chip ${groupSeparator === sep ? 'active' : ''}`}
                        onClick={() => setGroupSeparator(sep)}
                      >
                        <code>{sep}</code>
                      </button>
                    ))}
                    <input
                      type="text"
                      className="parser-chip-input"
                      placeholder="Other"
                      value={groupSeparator}
                      onChange={e => setGroupSeparator(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Main instruction */}
              <div className="parser-card">
                <div className="parser-question">
                  <span className="parser-question-icon">👆</span>
                  <span>Click on characters to mark where to split</span>
                </div>
                <p className="parser-hint">
                  Only <strong>highlighted characters</strong> appear in ALL rows. Click on them to mark split points.
                </p>

                {/* Character grid - show first group only */}
                <div className="parser-char-grid">
                  {firstGroup.split('').map((char, idx) => {
                    const isBoundary = boundaries.some(b => b.index === idx);
                    const isDelimiter = isDelimiterChar(char);
                    return (
                      <span
                        key={idx}
                        className={`parser-char ${isBoundary ? 'boundary' : ''} ${isDelimiter ? 'delimiter' : ''}`}
                        onClick={() => handleCharClick(char, idx)}
                        title={isDelimiter ? `Click to mark "${char}" as split point` : ''}
                      >
                        {char === ' ' ? '␣' : char}
                      </span>
                    );
                  })}
                </div>

                {/* Show marked boundaries */}
                {boundaries.length > 0 && (
                  <div className="parser-boundaries-summary">
                    <span>Split points:</span>
                    {boundaries.map((b, i) => (
                      <span key={i} className="parser-boundary-tag">
                        "{b.char === ' ' ? 'space' : b.char}"
                        <button onClick={() => handleCharClick(b.char, b.index)}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Real-time preview of parts */}
              {parts.length > 0 && (
                <div className="parser-card parser-parts-preview">
                  <div className="parser-question">
                    <span className="parser-question-icon">✂️</span>
                    <span>This will extract {parts.length} parts:</span>
                  </div>
                  <div className="parser-extracted-parts">
                    {parts.map((part, idx) => (
                      <div key={part.id} className="parser-extracted-part">
                        <span className="parser-part-num">{idx + 1}</span>
                        <span className="parser-part-value">{part.preview || '(empty)'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="parser-actions">
                <button className="parser-btn-secondary" onClick={() => setStep(1)}>← Back</button>
                <button
                  className="parser-btn-primary"
                  onClick={() => setStep(3)}
                  disabled={parts.length === 0}
                >
                  Continue → Label Parts
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════ */}
          {/* STEP 3: Label Parts */}
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {step === 3 && (
            <div className="parser-step-content">
              <div className="parser-question">
                <span className="parser-question-icon">🏷️</span>
                <span>Label each extracted part</span>
              </div>
              <p className="parser-hint">
                Choose "Spec Pair" for named data (MPN, Manufacturer) or "Tag" for values only
              </p>

              <div className="parser-parts-list">
                {parts.map((part, idx) => (
                  <div key={part.id} className="parser-part-row">
                    <div className="parser-part-preview">
                      <span className="parser-part-num">{idx + 1}</span>
                      <span className="parser-part-value">{part.preview || '(empty)'}</span>
                    </div>
                    <div className="parser-part-config">
                      <select
                        value={part.outputType}
                        onChange={e => updatePart(part.id, 'outputType', e.target.value)}
                        className="parser-part-select"
                      >
                        <option value="spec">Spec Pair</option>
                        <option value="tag">Tag</option>
                      </select>
                      {part.outputType === 'spec' && (
                        <input
                          type="text"
                          placeholder="Name (e.g., MPN)"
                          value={part.specName}
                          onChange={e => updatePart(part.id, 'specName', e.target.value)}
                          className="parser-part-input"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="parser-actions">
                <button className="parser-btn-secondary" onClick={() => setStep(2)}>← Back</button>
                <button className="parser-btn-primary" onClick={loadPreview} disabled={loading}>
                  {loading ? 'Loading...' : 'Preview →'}
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════ */}
          {/* STEP 4: Preview & Apply */}
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {step === 4 && previewData && (
            <div className="parser-step-content">
              <div className="parser-stats-row">
                <div className="parser-stat-card">
                  <span className="parser-stat-value">{previewData.total_rows}</span>
                  <span className="parser-stat-label">Rows</span>
                </div>
                <div className="parser-stat-card">
                  <span className="parser-stat-value">{previewData.preview_headers?.length || 0}</span>
                  <span className="parser-stat-label">New Columns</span>
                </div>
                {previewData.max_counts?.tags > 0 && (
                  <div className="parser-stat-card">
                    <span className="parser-stat-value">{previewData.max_counts.tags}</span>
                    <span className="parser-stat-label">Max Tags</span>
                  </div>
                )}
              </div>

              <div className="parser-preview-table-wrap">
                <table className="parser-preview-table">
                  <thead>
                    <tr>
                      {previewData.preview_headers?.slice(0, 8).map((h, i) => (
                        <th key={i}>{h}</th>
                      ))}
                      {(previewData.preview_headers?.length || 0) > 8 && (
                        <th>+{previewData.preview_headers.length - 8} more</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.preview_data?.slice(0, 5).map((row, ri) => (
                      <tr key={ri}>
                        {row.slice(0, 8).map((cell, ci) => (
                          <td key={ci}>{cell?.toString()?.substring(0, 25) || ''}</td>
                        ))}
                        {row.length > 8 && <td>...</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="parser-actions">
                <button className="parser-btn-secondary" onClick={() => setStep(3)}>← Back</button>
                <button
                  className="parser-btn-primary parser-btn-success"
                  onClick={applyParser}
                  disabled={loading}
                >
                  {loading ? 'Applying...' : '✓ Apply to All Rows'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default ColumnParser;
