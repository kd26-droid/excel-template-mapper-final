import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import SaveIcon from '@mui/icons-material/Save';
import {
  getBulkImportErrorFileUrl,
  uploadFileToFactwiseBulkImport,
  processFactwiseBulkImport,
} from '../services/factwiseApi';

// Reads the FW-generated error Excel. Cells that look like error phrases get
// flagged so the DataGrid can highlight them red.
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
    // Deduplicate + fill blanks so DataGrid columns have stable ids.
    const seen = new Map();
    const headers = rawHeaders.map((h, i) => {
      const base = h || `Column ${i + 1}`;
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      return count ? `${base} (${count + 1})` : base;
    });
    return {
      ok: true,
      headers,
      dataRows: rows.slice(1),
      sheetName: firstSheetName,
    };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed to parse error file' };
  }
}

function rowsToXlsxFile(headers, gridRows, fileName, sheetName = 'Sheet1') {
  // gridRows are {id, [header]: value, ...}. Strip the synthetic id and
  // reorder to header order before writing.
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

// Heuristic — FW error cells typically contain phrases like "invalid",
// "missing", "required", "does not exist", "duplicate", etc.
const ERROR_HINT_RE = /invalid|missing|required|does not exist|duplicate|not found|error|must be|is not/i;
function cellLooksLikeError(value) {
  if (value == null) return false;
  const s = String(value);
  if (!s.trim()) return false;
  return ERROR_HINT_RE.test(s);
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
  const [rows, setRows] = useState([]); // {id, [h]: v}[]
  const [sheetName, setSheetName] = useState('Sheet1');
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState(null);

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
        const obj = { id: idx };
        result.headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
        return obj;
      });
      setHeaders(result.headers);
      setRows(objRows);
      setSheetName(result.sheetName);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bulkImportId]);

  const columns = useMemo(() => headers.map((h) => ({
    field: h,
    headerName: h,
    minWidth: 160,
    flex: 1,
    editable: !disabled && !retrying,
    sortable: false,
    filterable: false,
    cellClassName: (params) => (cellLooksLikeError(params.value) ? 'fw-error-cell' : ''),
  })), [headers, disabled, retrying]);

  const handleCellEdit = useCallback((newRow) => {
    setRows((prev) => prev.map((r) => (r.id === newRow.id ? newRow : r)));
    return newRow;
  }, []);

  const handleSaveAndRetry = useCallback(async () => {
    setRetrying(true);
    setRetryMessage(null);
    try {
      const fileName = `bom-mapper-fixed-${bulkImportId}.xlsx`;
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
          Factwise typically only generates the editable error file when the failure is per-row
          (a DataError against specific cells). Template-level failures (missing whole columns,
          wrong file format) skip that step — fix the underlying issue in the mapper and retry.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{
      // Give the red-cell class actual color even inside dark themes.
      '& .fw-error-cell': {
        backgroundColor: (t) => t.palette.mode === 'dark'
          ? 'rgba(239, 68, 68, 0.28)'
          : 'rgba(239, 68, 68, 0.14)',
        color: (t) => t.palette.mode === 'dark' ? '#fecaca' : '#b91c1c',
        fontWeight: 600,
      },
    }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {rows.length} rows · edit any red cell inline, then save &amp; retry.
        </Typography>
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
      {retryMessage && (
        <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
          {retryMessage}
        </Typography>
      )}
      <Box sx={{ height: 420, width: '100%' }}>
        <DataGrid
          rows={rows}
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
        />
      </Box>
    </Box>
  );
}
