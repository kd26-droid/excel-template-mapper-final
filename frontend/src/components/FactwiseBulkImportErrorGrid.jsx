import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import SaveIcon from '@mui/icons-material/Save';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import {
  getBulkImportErrorFileUrl,
  uploadFileToFactwiseBulkImport,
  processFactwiseBulkImport,
} from '../services/factwiseApi';

// Reads the FactWise-generated error file for a failed bulk_import_id and
// splits it into (headers, rows, per-row per-column error map).
//
// FactWise's format (see construct_utils.construct_file_with_errors):
//   - Last column is named "errors"
//   - Its value per row is a JSON dict {"1": ["Code"], "2": ["Code1","Code2"]}
//     where keys are 1-based column indices and commas were replaced with
//     semicolons to survive CSV. Rows with errors are sorted first.
async function loadErrorWorkbook(bulkImportId) {
  const urlResp = await getBulkImportErrorFileUrl(bulkImportId);
  if (!urlResp?.success || !urlResp?.url) {
    return { ok: false, error: urlResp?.error || 'Could not fetch error file from Factwise' };
  }
  try {
    const res = await fetch(urlResp.url);
    if (!res.ok) return { ok: false, error: `Error file HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const firstSheetName = wb.SheetNames[0];
    const ws = wb.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    if (!rows.length) return { ok: false, error: 'Error file is empty' };
    const rawHeaders = rows[0].map((h) => String(h ?? '').trim());
    // Detect the "errors" column (always LAST per FW).
    const errorColIdx = rawHeaders.findIndex((h) => h.toLowerCase() === 'errors');
    const dataHeaders = errorColIdx >= 0
      ? rawHeaders.slice(0, errorColIdx)
      : rawHeaders;
    // Deduplicate + fill blank headers so DataGrid column ids are stable.
    const seen = new Map();
    const headers = dataHeaders.map((h, i) => {
      const base = h || `Column ${i + 1}`;
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      return count ? `${base} (${count + 1})` : base;
    });

    // Build the per-row per-column error map.
    // errorMap: { [rowId]: { [headerName]: string[] } }
    const errorMap = {};
    const dataRows = rows.slice(1);
    dataRows.forEach((row, idx) => {
      if (errorColIdx < 0) return;
      const raw = String(row[errorColIdx] ?? '').trim();
      if (!raw) return;
      let parsed = null;
      try {
        parsed = JSON.parse(raw.replace(/;/g, ','));
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== 'object') return;
      const perRow = {};
      Object.keys(parsed).forEach((colIndex1Based) => {
        const colIdx = parseInt(colIndex1Based, 10) - 1;
        if (Number.isNaN(colIdx) || colIdx < 0 || colIdx >= headers.length) return;
        const codes = Array.isArray(parsed[colIndex1Based]) ? parsed[colIndex1Based] : [];
        if (!codes.length) return;
        perRow[headers[colIdx]] = codes.map(String);
      });
      if (Object.keys(perRow).length) errorMap[idx] = perRow;
    });

    return {
      ok: true,
      headers,
      dataRows,
      errorMap,
      sheetName: firstSheetName,
    };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed to parse error file' };
  }
}

function rowsToXlsxFile(headers, gridRows, fileName, sheetName = 'Sheet1') {
  const aoa = [
    headers,
    ...gridRows.map((r) => headers.map((h) => r[h] ?? '')),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return new File([blob], fileName, { type: blob.type });
}

// Turn a Factwise error code into a short human label for the tooltip.
function humanizeErrorCode(code) {
  return String(code || '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^\s+/, '')
    .replace(/^./, (c) => c.toUpperCase());
}

export default function FactwiseBulkImportErrorGrid({
  bulkImportId,
  resourceType,
  additionalInformation,
  onRetrySuccess,
  onRetryFailure,
  disabled = false,
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]); // {id, __hasErrors, [h]: v}[]
  const [errorMap, setErrorMap] = useState({}); // {rowId: {header: string[]}}
  const [sheetName, setSheetName] = useState('Sheet1');
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState(null);
  const [showOnlyErrors, setShowOnlyErrors] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const result = await loadErrorWorkbook(bulkImportId);
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.error);
        setLoading(false);
        return;
      }
      const objRows = result.dataRows.map((row, idx) => {
        const obj = { id: idx, __hasErrors: Boolean(result.errorMap[idx]) };
        result.headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
        return obj;
      });
      setHeaders(result.headers);
      setRows(objRows);
      setErrorMap(result.errorMap);
      setSheetName(result.sheetName);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bulkImportId]);

  const totalErrorRows = useMemo(
    () => rows.filter((r) => r.__hasErrors).length,
    [rows]
  );

  const visibleRows = useMemo(() => {
    if (!showOnlyErrors) return rows;
    return rows.filter((r) => r.__hasErrors);
  }, [rows, showOnlyErrors]);

  const columns = useMemo(() => headers.map((h) => ({
    field: h,
    headerName: h,
    minWidth: 160,
    flex: 1,
    editable: !disabled && !retrying,
    sortable: false,
    filterable: false,
    cellClassName: (params) => {
      const rowErrors = errorMap[params.id];
      return rowErrors?.[h] ? 'fw-error-cell' : '';
    },
    renderCell: (params) => {
      const codes = errorMap[params.id]?.[h];
      const value = params.value ?? '';
      if (!codes) return value;
      return (
        <Tooltip
          title={
            <Stack spacing={0.5} sx={{ py: 0.25 }}>
              {codes.map((c, i) => (
                <Typography key={i} variant="caption" sx={{ fontWeight: 500 }}>
                  {humanizeErrorCode(c)}
                </Typography>
              ))}
            </Stack>
          }
          arrow
          placement="top"
        >
          <Box
            component="span"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '100%', overflow: 'hidden' }}
          >
            <ErrorOutlineIcon sx={{ fontSize: 14, flexShrink: 0 }} />
            <Typography
              variant="body2"
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {value}
            </Typography>
          </Box>
        </Tooltip>
      );
    },
  })), [headers, errorMap, disabled, retrying]);

  const handleCellEdit = useCallback((newRow) => {
    setRows((prev) => prev.map((r) => (r.id === newRow.id ? newRow : r)));
    return newRow;
  }, []);

  const handleSaveAndRetry = useCallback(async () => {
    setRetrying(true);
    setRetryMessage(null);
    try {
      const fileName = `bom-mapper-fixed-${bulkImportId}.xlsx`;
      // Always write ALL rows back (not just visible), so hiding non-error rows
      // in the UI never truncates the data we send to Factwise.
      const file = rowsToXlsxFile(headers, rows, fileName, sheetName);
      const uploaded = await uploadFileToFactwiseBulkImport(file, resourceType);
      if (!uploaded?.success) {
        setRetryMessage(uploaded?.error || 'Reupload failed');
        onRetryFailure?.(uploaded?.error || 'Reupload failed');
        return;
      }
      const processed = await processFactwiseBulkImport(
        uploaded.bulk_import_id,
        additionalInformation || {}
      );
      if (!processed?.success) {
        setRetryMessage(processed?.error || 'Process failed');
        onRetryFailure?.(processed?.error || 'Process failed', uploaded.bulk_import_id);
        return;
      }
      const resp = processed?.response || processed;
      const rtype = resp?.response_type;
      if (rtype && rtype !== 'Success') {
        setRetryMessage(resp?.error || `Still failing (${rtype}) — see fresh errors above`);
        onRetryFailure?.(resp?.error || rtype, uploaded.bulk_import_id, resp);
        return;
      }
      setRetryMessage('Retry succeeded.');
      onRetrySuccess?.(resp, uploaded.bulk_import_id);
    } catch (e) {
      setRetryMessage(e?.message || 'Unexpected error');
      onRetryFailure?.(e?.message || 'Unexpected error');
    } finally {
      setRetrying(false);
    }
  }, [
    bulkImportId, headers, rows, sheetName, resourceType,
    additionalInformation, onRetryFailure, onRetrySuccess,
  ]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 3 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading errored rows from Factwise…</Typography>
      </Box>
    );
  }

  if (loadError) {
    return (
      <Box sx={{
        py: 2, px: 2, borderRadius: 1.5,
        border: 1, borderColor: 'error.main',
        bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(239, 68, 68, 0.08)' : '#fef2f2',
      }}>
        <Typography variant="body2" color="error" sx={{ fontWeight: 600 }}>
          {loadError}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Factwise typically only generates the editable error file when the failure is per-row.
          Template-level failures (missing whole columns, wrong file format) skip that step —
          fix the underlying issue in the mapper and retry.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{
      '& .fw-error-cell': {
        backgroundColor: (t) => t.palette.mode === 'dark'
          ? 'rgba(239, 68, 68, 0.28)'
          : 'rgba(239, 68, 68, 0.14)',
        color: (t) => t.palette.mode === 'dark' ? '#fecaca' : '#b91c1c',
        fontWeight: 600,
      },
    }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        spacing={2}
        sx={{ mb: 1, flexWrap: 'wrap' }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Chip
            size="small"
            color="error"
            variant="outlined"
            icon={<ErrorOutlineIcon />}
            label={`${totalErrorRows} rows with errors`}
          />
          <Typography variant="caption" color="text.secondary">
            {rows.length} total · edit any red cell inline, then save &amp; retry.
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showOnlyErrors}
                onChange={(e) => setShowOnlyErrors(e.target.checked)}
              />
            }
            label={<Typography variant="caption">Show only error rows</Typography>}
            sx={{ mr: 0.5 }}
          />
          <Button
            variant="contained"
            size="small"
            startIcon={retrying ? <CircularProgress size={14} /> : <SaveIcon />}
            onClick={handleSaveAndRetry}
            disabled={disabled || retrying || !headers.length}
          >
            {retrying ? 'Retrying…' : 'Save & retry'}
          </Button>
        </Stack>
      </Stack>
      {retryMessage && (
        <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
          {retryMessage}
        </Typography>
      )}
      <Box sx={{ height: 460, width: '100%' }}>
        <DataGrid
          rows={visibleRows}
          columns={columns}
          density="compact"
          disableRowSelectionOnClick
          hideFooterSelectedRowCount
          processRowUpdate={handleCellEdit}
          onProcessRowUpdateError={(err) => setRetryMessage(err?.message || 'Edit failed')}
          initialState={{
            pagination: { paginationModel: { pageSize: 25 } },
          }}
          pageSizeOptions={[25, 50, 100]}
          getRowClassName={(params) => (params.row.__hasErrors ? 'fw-error-row' : '')}
        />
      </Box>
    </Box>
  );
}
