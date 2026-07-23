import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import LoaderOverlay, { useGlobalBlock } from '../components/LoaderOverlay';
import {
  Typography,
  Button,
  Grid,
  Alert,
  CircularProgress,
  Box,
  Card,
  CardContent,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Container,
  IconButton,
  Checkbox,
  Divider,
  FormControlLabel,
  FormGroup,
  Radio,
  RadioGroup,
  Snackbar,
} from '@mui/material';
import { useDropzone } from 'react-dropzone';
import {
  CloudUpload as CloudUploadIcon,
  LibraryBooks as LibraryBooksIcon,
  CheckCircle as CheckCircleIcon,
  TrendingUp as TrendingUpIcon,
  Schedule as ScheduleIcon,
  PlayArrow as PlayArrowIcon,
  Warning as WarningIcon,
  UploadFile as UploadFileIcon,
  Search as SearchIcon,
  Close as CloseIcon,
  Science as ScienceIcon,
  Add as AddIcon
} from '@mui/icons-material';
import * as XLSX from 'xlsx';
import api, { setGlobalLoaderCallback } from '../services/api';
// Removed unused UploadFormulaBuilder import

const UploadFiles = () => {
  const sheetJoinDraftDbName = 'excel-template-mapper-drafts';
  const sheetJoinDraftStoreName = 'files';
  const sheetJoinBomDraftKey = 'sheet-join-bom-draft';
  const [globalLoading, setGlobalLoading] = useState(false);
  useGlobalBlock(globalLoading);
  
  // Setup global loader callback
  useEffect(() => {
    setGlobalLoaderCallback(setGlobalLoading);
    return () => setGlobalLoaderCallback(null);
  }, []);
  
  const [userFile, setUserFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // Client file sheet/header state
  const [clientSheetNames, setClientSheetNames] = useState([]);
  const [selectedClientSheet, setSelectedClientSheet] = useState('');
  const [clientHeaderRow, setClientHeaderRow] = useState(1);
  const [clientWorkbook, setClientWorkbook] = useState(null);

  // Template file state
  const [templateFile, setTemplateFile] = useState(null);
  const [templateSheetNames, setTemplateSheetNames] = useState([]);
  const [selectedTemplateSheet, setSelectedTemplateSheet] = useState('');
  const [templateHeaderRow, setTemplateHeaderRow] = useState(1);

  // Template selection state
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateSearchTerm, setTemplateSearchTerm] = useState('');
  
  // Template compatibility error modal state
  const [compatibilityErrorOpen, setCompatibilityErrorOpen] = useState(false);
  const [compatibilityErrorData, setCompatibilityErrorData] = useState(null);
  const [pendingSessionId, setPendingSessionId] = useState(null);
  
  // Formula rules state (for tag templates)
  const [formulaRules, setFormulaRules] = useState([]);

  // Tag Templates state
  const [availableTagTemplates, setAvailableTagTemplates] = useState([]);
  const [selectedTagTemplate, setSelectedTagTemplate] = useState(null);
  const [tagTemplatesLoading, setTagTemplatesLoading] = useState(false);
  const [tagTemplateSearchTerm, setTagTemplateSearchTerm] = useState('');

  // PDF alignment state - Use 'align' to keep exact headers AND align rows across pages
  // 'align' = align rows from different pages to same row level + keep original headers (MFR stays MFR)
  // 'preserve' = append rows sequentially (page 1 rows, then page 2 rows, etc.) + keep original headers
  // 'flatten' = align rows across pages + rename headers (MFR → Manufacturer)
  const pdfDataAlignment = 'align';

  // PDF processing choice dialog state
  const [pdfChoiceDialogOpen, setPdfChoiceDialogOpen] = useState(false);
  const [pendingPdfSessionId, setPendingPdfSessionId] = useState(null);

  // Primary column cleanup dialog state
  const [primaryColumnDialogOpen, setPrimaryColumnDialogOpen] = useState(false);
  const [primaryColumnSessionId, setPrimaryColumnSessionId] = useState(null);
  const [primaryColumnHeaders, setPrimaryColumnHeaders] = useState([]);
  const [selectedPrimaryColumn, setSelectedPrimaryColumn] = useState('');
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState(null);
  const [pendingNavigateState, setPendingNavigateState] = useState(null);

  // Optional same-workbook sheet join state
  const [sheetJoinDialogOpen, setSheetJoinDialogOpen] = useState(false);
  const [sheetJoinSetup, setSheetJoinSetup] = useState(null);
  const [sheetJoinConfig, setSheetJoinConfig] = useState({
    baseSheet: '',
    detailSheet: '',
    baseHeaderRow: 1,
    detailHeaderRow: 1,
    baseKey: '',
    detailKey: '',
    relationshipName: '',
    outputMode: 'grouped',
    detailColumns: [],
    uniqueIdMode: 'auto',
    uniqueIdBaseColumn: '',
    uniqueIdDetailColumn: '',
    uniqueIdPattern: '',
    copiedBaseColumns: []
  });
  const [sheetJoinStage, setSheetJoinStage] = useState('match');
  const [sheetJoinPreview, setSheetJoinPreview] = useState(null);
  const [sheetJoinPreviewPage, setSheetJoinPreviewPage] = useState(0);
  const [sheetJoinColumnWidths, setSheetJoinColumnWidths] = useState({});
  const [sheetJoinVisibleColumns, setSheetJoinVisibleColumns] = useState([]);
  const [sheetJoinPreviewFilter, setSheetJoinPreviewFilter] = useState('all');
  const sheetJoinPreviewRowsPerPage = 50;
  const [sheetJoinToastOpen, setSheetJoinToastOpen] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  // Check if template or smart tag rules were pre-selected from dashboard
  useEffect(() => {
    if (location.state?.selectedTemplate) {
      setSelectedTemplate(location.state.selectedTemplate);
    }
    if (location.state?.selectedTagTemplate) {
      setSelectedTagTemplate(location.state.selectedTagTemplate);
      setFormulaRules(location.state.selectedTagTemplate.formula_rules || []);
    }
    if (location.state?.smartTagFormulaRules) {
      setFormulaRules(location.state.smartTagFormulaRules);
      // Optionally, you might want to pre-fill template name/description if passed
      // setTemplateName(location.state.smartTagTemplateName || '');
      // setTemplateDescription(location.state.smartTagTemplateDescription || '');
    }
  }, [location.state]);

  // Load available templates when component mounts
  useEffect(() => {
    loadAvailableTemplates();
    loadAvailableTagTemplates();
    
    // Clear any stale persisted info when visiting upload page
    sessionStorage.removeItem('lastUploadedFiles');
    sessionStorage.removeItem('restoreUploadFromMapping');
  }, []);

  const loadAvailableTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const response = await api.getMappingTemplates();
      setAvailableTemplates(response.data.templates || []);
    } catch (err) {
      console.error('Error loading templates:', err);
      // Don't show error for templates, just log it
    } finally {
      setTemplatesLoading(false);
    }
  };

  const loadAvailableTagTemplates = async () => {
    setTagTemplatesLoading(true);
    try {
      const response = await api.getTagTemplates();
      setAvailableTagTemplates(response.data.templates || []);
    } catch (err) {
      console.error('Error loading tag templates:', err);
      // Don't show error for tag templates, just log it
    } finally {
      setTagTemplatesLoading(false);
    }
  };

  const openSheetJoinDraftDb = useCallback(() => new Promise((resolve, reject) => {
    const request = indexedDB.open(sheetJoinDraftDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(sheetJoinDraftStoreName)) {
        db.createObjectStore(sheetJoinDraftStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }), [sheetJoinDraftDbName, sheetJoinDraftStoreName]);

  const saveSheetJoinDraft = useCallback(async (preview) => {
    if (!preview?.headers?.length) return null;
    const rows = preview.rows.map(row => {
      const cleanRow = {};
      preview.headers.forEach(header => {
        cleanRow[header] = row[header] ?? '';
      });
      return cleanRow;
    });
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: preview.headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet_Joined');
    const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([arrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const filename = `sheet_join_bom_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;

    const db = await openSheetJoinDraftDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(sheetJoinDraftStoreName, 'readwrite');
      tx.objectStore(sheetJoinDraftStoreName).put({
        blob,
        filename,
        savedAt: new Date().toISOString(),
        headers: preview.headers,
        rowCount: rows.length
      }, sheetJoinBomDraftKey);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    localStorage.setItem(sheetJoinBomDraftKey, JSON.stringify({
      filename,
      savedAt: new Date().toISOString(),
      rowCount: rows.length
    }));

    return { blob, filename, workbook };
  }, [openSheetJoinDraftDb, sheetJoinBomDraftKey, sheetJoinDraftStoreName]);

  const applySheetJoinDraftToUpload = useCallback((draft) => {
    if (!draft?.blob || !draft?.filename) return;
    const file = new File([draft.blob], draft.filename, { type: draft.blob.type });
    const reader = new FileReader();
    reader.onload = (event) => {
      const workbook = XLSX.read(event.target.result, { type: 'binary' });
      const sheets = workbook.SheetNames;
      setUserFile(file);
      setClientWorkbook(workbook);
      setClientSheetNames(sheets);
      setSelectedClientSheet(sheets[0] || 'Sheet_Joined');
      setClientHeaderRow(1);
      setSheetJoinSetup(null);
      setSheetJoinDialogOpen(false);
      setSheetJoinStage('match');
      setSheetJoinPreview(null);
      setSuccess('Related sheet data is saved as your new BOM/client file. Add the FW template when ready and continue normally.');
    };
    reader.readAsBinaryString(file);
  }, []);

  const restoreSheetJoinDraft = useCallback(async () => {
    try {
      if (userFile) return;
      const meta = localStorage.getItem(sheetJoinBomDraftKey);
      if (!meta) return;
      const db = await openSheetJoinDraftDb();
      const draft = await new Promise((resolve, reject) => {
        const tx = db.transaction(sheetJoinDraftStoreName, 'readonly');
        const request = tx.objectStore(sheetJoinDraftStoreName).get(sheetJoinBomDraftKey);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      if (draft?.blob) {
        applySheetJoinDraftToUpload(draft);
      }
    } catch (err) {
      console.warn('Failed to restore sheet comparison draft:', err);
    }
  }, [applySheetJoinDraftToUpload, openSheetJoinDraftDb, sheetJoinBomDraftKey, sheetJoinDraftStoreName, userFile]);

  useEffect(() => {
    restoreSheetJoinDraft();
  }, [restoreSheetJoinDraft]);

  const getSheetHeaders = useCallback((sheetName, headerRow = 1) => {
    if (!clientWorkbook || !sheetName || !clientWorkbook.Sheets[sheetName]) return [];
    const rows = XLSX.utils.sheet_to_json(clientWorkbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: ''
    });
    const row = rows[Math.max(0, Number(headerRow || 1) - 1)] || [];
    return row
      .map(value => String(value || '').trim())
      .filter(Boolean);
  }, [clientWorkbook]);

  const getSheetRecords = useCallback((sheetName, headerRow = 1) => {
    if (!clientWorkbook || !sheetName || !clientWorkbook.Sheets[sheetName]) return [];
    const rows = XLSX.utils.sheet_to_json(clientWorkbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: ''
    });
    const headerIndex = Math.max(0, Number(headerRow || 1) - 1);
    const headers = (rows[headerIndex] || [])
      .map(value => String(value || '').trim())
      .filter(Boolean);

    return rows.slice(headerIndex + 1)
      .filter(row => row && row.some(value => String(value || '').trim()))
      .map(row => {
        const record = {};
        headers.forEach((header, index) => {
          record[header] = row[index] ?? '';
        });
        return record;
      });
  }, [clientWorkbook]);

  const guessKeyColumn = useCallback((headers) => {
    const normalized = headers.map(header => ({
      original: header,
      key: String(header || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    }));
    const preferred = ['partnumber', 'partno', 'itemnumber', 'itemno', 'componentnumber'];
    for (const key of preferred) {
      const match = normalized.find(header => header.key === key || header.key.includes(key));
      if (match) return match.original;
    }
    return headers[0] || '';
  }, []);

  const defaultDetailColumns = useCallback((headers, keyColumn) => {
    const preferred = ['manufacturer part number', 'mpn', 'manufacturer name', 'manufacturer', 'description'];
    const lowerByHeader = new Map(headers.map(header => [header, String(header || '').toLowerCase()]));
    const picked = headers.filter(header =>
      header !== keyColumn && preferred.some(term => lowerByHeader.get(header)?.includes(term))
    );
    return picked.length > 0 ? picked : headers.filter(header => header !== keyColumn).slice(0, 4);
  }, []);

  const defaultCopiedBaseColumns = useCallback((headers) => {
    return headers.filter(Boolean);
  }, []);

  const sanitizeSheetJoinConfig = useCallback((config) => {
    const baseHeaders = getSheetHeaders(config.baseSheet, config.baseHeaderRow);
    const detailHeaders = getSheetHeaders(config.detailSheet, config.detailHeaderRow);
    const baseKey = baseHeaders.includes(config.baseKey) ? config.baseKey : guessKeyColumn(baseHeaders);
    const detailKey = detailHeaders.includes(config.detailKey) ? config.detailKey : guessKeyColumn(detailHeaders);
    const detailColumns = (config.detailColumns || []).filter(column => detailHeaders.includes(column) && column !== detailKey);
    const copiedBaseColumns = (config.copiedBaseColumns || []).filter(column => baseHeaders.includes(column));

    return {
      ...config,
      baseKey,
      detailKey,
      detailColumns: detailColumns.length ? detailColumns : defaultDetailColumns(detailHeaders, detailKey),
      copiedBaseColumns: copiedBaseColumns.length ? copiedBaseColumns : defaultCopiedBaseColumns(baseHeaders),
      uniqueIdBaseColumn: baseHeaders.includes(config.uniqueIdBaseColumn) ? config.uniqueIdBaseColumn : baseKey,
      uniqueIdDetailColumn: detailHeaders.includes(config.uniqueIdDetailColumn)
        ? config.uniqueIdDetailColumn
        : (detailColumns[0] || detailKey)
    };
  }, [defaultCopiedBaseColumns, defaultDetailColumns, getSheetHeaders, guessKeyColumn]);

  const buildSheetJoinPreview = useCallback((config) => {
    const cleanConfig = sanitizeSheetJoinConfig(config);
    const baseHeaders = getSheetHeaders(cleanConfig.baseSheet, cleanConfig.baseHeaderRow);
    const detailHeaders = getSheetHeaders(cleanConfig.detailSheet, cleanConfig.detailHeaderRow);
    const baseRows = getSheetRecords(cleanConfig.baseSheet, cleanConfig.baseHeaderRow);
    const detailRows = getSheetRecords(cleanConfig.detailSheet, cleanConfig.detailHeaderRow);
    const selectedDetailColumns = cleanConfig.detailColumns.filter(column => detailHeaders.includes(column) && column !== cleanConfig.detailKey);
    const copiedBaseColumns = cleanConfig.copiedBaseColumns.filter(column => baseHeaders.includes(column));
    const singleGroupedColumnName = cleanConfig.relationshipName.trim();

    const normalize = value => String(value || '').replace(/\u00a0/g, ' ').trim().toLowerCase();
    const clean = value => String(value ?? '').trim();
    const uniqueValues = values => {
      const seen = new Set();
      return values
        .map(clean)
        .filter(value => {
          if (!value || seen.has(value)) return false;
          seen.add(value);
          return true;
        });
    };
    const uniqueName = (name, existing) => {
      let candidate = name;
      let suffix = 2;
      while (existing.includes(candidate)) {
        candidate = `${name} ${suffix}`;
        suffix += 1;
      }
      return candidate;
    };
    const makeId = (baseRow, detailRow = {}) => {
      const baseValue = clean(baseRow[cleanConfig.uniqueIdBaseColumn]);
      const detailValue = clean(detailRow[cleanConfig.uniqueIdDetailColumn]);
      if (cleanConfig.uniqueIdMode === 'custom') {
        return cleanConfig.uniqueIdPattern.replace('{base}', baseValue).replace('{detail}', detailValue).replace(/^[_-\s]+|[_-\s]+$/g, '');
      }
      return `${baseValue}_${detailValue}`.replace(/^[_-\s]+|[_-\s]+$/g, '');
    };

    const detailLookup = new Map();
    detailRows.forEach(row => {
      const key = normalize(row[cleanConfig.detailKey]);
      if (!key) return;
      if (!detailLookup.has(key)) detailLookup.set(key, []);
      detailLookup.get(key).push(row);
    });

    const headers = [...baseHeaders];
    const detailHeaderMap = {};
    if (cleanConfig.outputMode === 'grouped') {
      selectedDetailColumns.forEach(column => {
        const preferred = selectedDetailColumns.length === 1 && singleGroupedColumnName
          ? singleGroupedColumnName
          : column;
        const outputName = uniqueName(headers.includes(preferred) ? `${preferred} (related)` : preferred, headers);
        detailHeaderMap[column] = outputName;
        headers.push(outputName);
      });
    } else {
      selectedDetailColumns.forEach(column => {
        const outputName = uniqueName(headers.includes(column) ? `${column} (detail)` : column, headers);
        detailHeaderMap[column] = outputName;
        headers.push(outputName);
      });
    }

    let generatedIdHeader = 'Generated Row ID';
    if (cleanConfig.outputMode === 'expanded') {
      generatedIdHeader = uniqueName(generatedIdHeader, headers);
      headers.unshift(generatedIdHeader);
    }

    const rows = [];
    let matchedBaseRows = 0;
    let unmatchedBaseRows = 0;
    let expandedRows = 0;

    baseRows.forEach(baseRow => {
      const matches = detailLookup.get(normalize(baseRow[cleanConfig.baseKey])) || [];
      if (matches.length) {
        matchedBaseRows += 1;
        if (cleanConfig.outputMode === 'grouped') {
          const row = {};
          row.__sheetJoinStatus = 'matched';
          baseHeaders.forEach(header => { row[header] = baseRow[header] ?? ''; });
          selectedDetailColumns.forEach(column => {
            row[detailHeaderMap[column]] = uniqueValues(matches.map(match => match[column])).join(' | ');
          });
          rows.push(row);
          expandedRows += 1;
        } else {
          matches.forEach((detailRow, matchIndex) => {
            const row = {};
            row.__sheetJoinStatus = 'matched';
            row[generatedIdHeader] = makeId(baseRow, detailRow);
            baseHeaders.forEach(header => {
              row[header] = copiedBaseColumns.includes(header) || matchIndex === 0 ? (baseRow[header] ?? '') : '';
            });
            selectedDetailColumns.forEach(column => {
              row[detailHeaderMap[column]] = detailRow[column] ?? '';
            });
            rows.push(row);
            expandedRows += 1;
          });
        }
      } else {
        unmatchedBaseRows += 1;
        const row = {};
        row.__sheetJoinStatus = 'unmatched';
        if (cleanConfig.outputMode === 'expanded') row[generatedIdHeader] = makeId(baseRow);
        baseHeaders.forEach(header => { row[header] = baseRow[header] ?? ''; });
        selectedDetailColumns.forEach(column => { row[detailHeaderMap[column]] = ''; });
        rows.push(row);
      }
    });

    const baseKeys = new Set(baseRows.map(row => normalize(row[cleanConfig.baseKey])).filter(Boolean));
    const detailKeys = new Set(detailRows.map(row => normalize(row[cleanConfig.detailKey])).filter(Boolean));
    const orphanDetailKeys = [...detailKeys].filter(key => !baseKeys.has(key)).length;

    return {
      config: cleanConfig,
      headers,
      rows,
      summary: {
        matchedBaseRows,
        unmatchedBaseRows,
        expandedRows,
        orphanDetailKeys,
        outputRows: rows.length
      }
    };
  }, [getSheetHeaders, getSheetRecords, sanitizeSheetJoinConfig]);

  const onDropUserFile = useCallback(acceptedFiles => {
    if (acceptedFiles.length > 0) {
      let file = acceptedFiles[0];
      setError(null);
      setUserFile(file);
      setSheetJoinSetup(null);
      setSheetJoinDialogOpen(false);
      
      // Read the file to extract sheet names and column headers for Excel/CSV files
      // Skip processing for PDF files as they will be handled by Azure OCR
      const reader = new FileReader();
      const isCSV = file.name.toLowerCase().endsWith('.csv');
      const isPDF = file.name.toLowerCase().endsWith('.pdf');

      if (isPDF) {
        // For PDF files, we don't need to extract sheet names or headers
        // They will be processed by Azure OCR service
        setClientWorkbook(null);
        setClientSheetNames([]);
        setSelectedClientSheet('');
        setClientHeaderRow(1);
        return;
      }

      reader.onload = (evt) => {
        try {
          const data = evt.target.result;
          let workbook;
          
          if (isCSV) {
            // For CSV files, use text reading with proper parsing options
            workbook = XLSX.read(data, { 
              type: 'string',
              codepage: 65001, // UTF-8
              raw: false,
              dateNF: 'YYYY-MM-DD',
              cellDates: true,
              cellNF: false,
              cellText: false
            });
          } else {
            // For Excel files, use binary reading
            workbook = XLSX.read(data, { type: 'binary' });
          }
          
          const sheets = workbook.SheetNames;
          setClientWorkbook(workbook);
          setClientSheetNames(sheets);
          setSelectedClientSheet(sheets[0]); // Auto-select first sheet
          
          // Extract column headers from the first sheet
          if (sheets.length > 0) {
            const firstSheet = workbook.Sheets[sheets[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { 
              header: 1,
              raw: false,
              defval: '' // Default value for empty cells
            });
            
            
            // Smart header detection: find the row with the most non-empty columns
            let bestHeaderRow = 0;
            let maxColumns = 0;
            
            // Check first 5 rows for potential headers
            for (let i = 0; i < Math.min(5, jsonData.length); i++) {
              if (jsonData[i]) {
                const nonEmptyColumns = jsonData[i].filter(header => 
                  header !== null && 
                  header !== undefined && 
                  header.toString().trim() !== ''
                ).length;
                
                
                if (nonEmptyColumns > maxColumns) {
                  maxColumns = nonEmptyColumns;
                  bestHeaderRow = i;
                }
              }
            }
            
            
            // Parse headers from the best header row
            if (jsonData.length > bestHeaderRow && jsonData[bestHeaderRow]) {
              const headers = jsonData[bestHeaderRow].filter(header => 
                header !== null && 
                header !== undefined && 
                header.toString().trim() !== ''
              );
              
              if (headers.length === 0) {
                console.warn('No valid headers found in the file');
                setError('No valid column headers found in the file. Please check the file format and ensure it has proper headers.');
                return;
              }
              
              // Update the header row setting to the detected row
              if (bestHeaderRow !== 0) {
                setClientHeaderRow(bestHeaderRow + 1);
              }
            } else {
              console.warn('No data found in the file');
              setError('The file appears to be empty or has no data.');
              return;
            }
          }
        } catch (err) {
          console.error('Error reading file:', err);
          const fileType = file.name.toLowerCase().endsWith('.csv') ? 'CSV' : 'Excel';
          
          // For CSV files, try fallback reading methods
          if (isCSV && !err.message.includes('fallback attempted')) {
            try {
              // Fallback: try reading as binary for CSV files with encoding issues
              const fallbackWorkbook = XLSX.read(evt.target.result, { 
                type: 'string',
                raw: true,
                codepage: 1252 // Windows-1252 (common alternative)
              });
              
              const fallbackSheets = fallbackWorkbook.SheetNames;
              setClientWorkbook(fallbackWorkbook);
              setClientSheetNames(fallbackSheets);
              setSelectedClientSheet(fallbackSheets[0]);
              
              if (fallbackSheets.length > 0) {
                const fallbackSheet = fallbackWorkbook.Sheets[fallbackSheets[0]];
                const fallbackJsonData = XLSX.utils.sheet_to_json(fallbackSheet, { 
                  header: 1,
                  raw: false,
                  defval: ''
                });
                
                
                if (fallbackJsonData.length > 0) {
                  // Same smart header detection for fallback
                  let bestHeaderRow = 0;
                  let maxColumns = 0;
                  
                  for (let i = 0; i < Math.min(5, fallbackJsonData.length); i++) {
                    if (fallbackJsonData[i]) {
                      const nonEmptyColumns = fallbackJsonData[i].filter(header => 
                        header !== null && 
                        header !== undefined && 
                        header.toString().trim() !== ''
                      ).length;
                      
                      if (nonEmptyColumns > maxColumns) {
                        maxColumns = nonEmptyColumns;
                        bestHeaderRow = i;
                      }
                    }
                  }
                  
                  if (maxColumns > 0) {
                    if (bestHeaderRow !== 0) {
                      setClientHeaderRow(bestHeaderRow + 1);
                    }
                    return; // Success with fallback
                  }
                }
              }
              
              throw new Error('Fallback parsing also failed');
            } catch (fallbackErr) {
              console.error('Fallback CSV reading also failed:', fallbackErr);
              setError(`Error reading ${fileType} file. Please make sure it's a valid ${fileType} file with proper formatting. Both UTF-8 and Windows-1252 encoding attempts failed.`);
              return;
            }
          }
          
          setError(`Error reading ${fileType} file. Please make sure it's a valid ${fileType} file with proper formatting.`);
        }
      };
      
      // Use different reading methods for CSV vs Excel files
      if (isCSV) {
        reader.readAsText(file, 'UTF-8'); // Read CSV as text with UTF-8 encoding
      } else {
        reader.readAsBinaryString(file); // Read Excel as binary
      }

      // Do NOT persist to sessionStorage here.
      // Persistence only happens on successful upload
      // (so files only appear when coming back from mapping).
    }
  }, []);


  const { getRootProps: getUserRootProps, getInputProps: getUserInputProps, isDragActive: isUserDragActive } =
    useDropzone({
      onDrop: onDropUserFile,
      accept: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        'application/vnd.ms-excel': ['.xls'],
        'text/csv': ['.csv'],
        'application/csv': ['.csv'],
        'text/plain': ['.csv'],
        'application/pdf': ['.pdf']
      },
      maxFiles: 1
    });

  // Template file drop handler
  const onDropTemplateFile = useCallback(acceptedFiles => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setError(null);
      setTemplateFile(file);

      const reader = new FileReader();
      const isCSV = file.name.toLowerCase().endsWith('.csv');

      reader.onload = (evt) => {
        try {
          const data = evt.target.result;
          let workbook;

          if (isCSV) {
            workbook = XLSX.read(data, {
              type: 'string',
              codepage: 65001,
              raw: false
            });
          } else {
            workbook = XLSX.read(data, { type: 'binary' });
          }

          const sheets = workbook.SheetNames;
          setTemplateSheetNames(sheets);
          setSelectedTemplateSheet(sheets[0]);
          setTemplateHeaderRow(1);
        } catch (err) {
          console.error('Error reading template file:', err);
          setError('Error reading template file. Please make sure it\'s a valid Excel or CSV file.');
        }
      };

      if (isCSV) {
        reader.readAsText(file, 'UTF-8');
      } else {
        reader.readAsBinaryString(file);
      }
    }
  }, []);

  const { getRootProps: getTemplateRootProps, getInputProps: getTemplateInputProps, isDragActive: isTemplateDragActive } =
    useDropzone({
      onDrop: onDropTemplateFile,
      accept: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        'application/vnd.ms-excel': ['.xls'],
        'text/csv': ['.csv'],
        'application/csv': ['.csv'],
        'text/plain': ['.csv']
      },
      maxFiles: 1
    });

  // Filter templates based on search term
  const filteredTemplates = availableTemplates.filter(template =>
    (template.name && template.name.toLowerCase().includes(templateSearchTerm.toLowerCase())) ||
    (template.description && template.description.toLowerCase().includes(templateSearchTerm.toLowerCase()))
  );

  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
    
    // Load formula rules from template if they exist
    if (template.formula_rules && template.formula_rules.length > 0) {
      setFormulaRules([...template.formula_rules]);
    } else {
      setFormulaRules([]);
    }
  };

  const handleRemoveTemplate = () => {
    setSelectedTemplate(null);
    setFormulaRules([]); // Clear formula rules when template is removed
  };

  // Filter tag templates based on search term
  const filteredTagTemplates = availableTagTemplates.filter(template =>
    (template.name && template.name.toLowerCase().includes(tagTemplateSearchTerm.toLowerCase())) ||
    (template.description && template.description.toLowerCase().includes(tagTemplateSearchTerm.toLowerCase()))
  );

  const handleSelectTagTemplate = (template) => {
    setSelectedTagTemplate(template);
    
    // Load formula rules from tag template
    if (template.formula_rules && template.formula_rules.length > 0) {
      setFormulaRules([...template.formula_rules]);
    } else {
      setFormulaRules([]);
    }
  };

  const handleRemoveTagTemplate = () => {
    setSelectedTagTemplate(null);
    // Don't clear formula rules as user might have manually created them
  };

  // Compatibility error modal handlers
  const handleContinueAnyway = () => {
    if (pendingSessionId) {
      setCompatibilityErrorOpen(false);
      setSuccess('Files uploaded. Proceeding to manual mapping due to template compatibility issues.');
      setTimeout(() => {
        showPrimaryColumnDialog(pendingSessionId);
      }, 1500);
    }
  };

  const handleTryDifferentTemplate = () => {
    setCompatibilityErrorOpen(false);
    setSelectedTemplate(null);
    setPendingSessionId(null);
    setCompatibilityErrorData(null);
  };

  const handleUploadWithoutTemplate = () => {
    setCompatibilityErrorOpen(false);
    setSelectedTemplate(null);
    setPendingSessionId(null);
    setCompatibilityErrorData(null);
  };

  const handleCloseCompatibilityError = () => {
    setCompatibilityErrorOpen(false);
    setPendingSessionId(null);
    setCompatibilityErrorData(null);
  };

  const handleOpenSheetJoinSetup = () => {
    if (!clientWorkbook || clientSheetNames.length < 2) return;

    const baseSheet = sheetJoinSetup?.baseSheet || selectedClientSheet || clientSheetNames[0];
    const detailSheet = sheetJoinSetup?.detailSheet || clientSheetNames.find(sheet => sheet !== baseSheet) || clientSheetNames[1] || '';
    const baseHeaderRow = sheetJoinSetup?.baseHeaderRow || clientHeaderRow || 1;
    const detailHeaderRow = sheetJoinSetup?.detailHeaderRow || 1;
    const baseHeaders = getSheetHeaders(baseSheet, baseHeaderRow);
    const detailHeaders = getSheetHeaders(detailSheet, detailHeaderRow);
    const baseKey = sheetJoinSetup?.baseKey || guessKeyColumn(baseHeaders);
    const detailKey = sheetJoinSetup?.detailKey || guessKeyColumn(detailHeaders);
    const defaultDetailColumnSelection = defaultDetailColumns(detailHeaders, detailKey);
    const defaultCopiedColumnSelection = defaultCopiedBaseColumns(baseHeaders);

    setSheetJoinConfig({
      baseSheet,
      detailSheet,
      baseHeaderRow,
      detailHeaderRow,
      baseKey,
      detailKey,
      relationshipName: sheetJoinSetup?.relationshipName || '',
      outputMode: sheetJoinSetup?.outputMode || 'grouped',
      detailColumns: sheetJoinSetup?.detailColumns || defaultDetailColumnSelection,
      uniqueIdMode: sheetJoinSetup?.uniqueIdMode || 'auto',
      uniqueIdBaseColumn: sheetJoinSetup?.uniqueIdBaseColumn || baseKey,
      uniqueIdDetailColumn: sheetJoinSetup?.uniqueIdDetailColumn || defaultDetailColumnSelection[0] || detailKey,
      uniqueIdPattern: sheetJoinSetup?.uniqueIdPattern || '{base}_{detail}',
      copiedBaseColumns: sheetJoinSetup?.copiedBaseColumns || defaultCopiedColumnSelection
    });
    setSheetJoinStage('match');
    setSheetJoinPreview(null);
    setSheetJoinDialogOpen(true);
  };

  const handleCloseSheetJoinSetup = () => {
    setSheetJoinDialogOpen(false);
  };

  const handleProceedSheetJoinOptions = () => {
    if (!sheetJoinConfig.baseKey || !sheetJoinConfig.detailKey || !sheetJoinConfig.baseSheet || !sheetJoinConfig.detailSheet) return;
    const cleanConfig = sanitizeSheetJoinConfig(sheetJoinConfig);
    setSheetJoinConfig(cleanConfig);
    setSheetJoinStage('options');
  };

  const handlePreviewSheetJoin = () => {
    const preview = buildSheetJoinPreview(sheetJoinConfig);
    setSheetJoinConfig(preview.config);
    setSheetJoinPreview(preview);
    setSheetJoinVisibleColumns(preview.headers);
    setSheetJoinPreviewFilter('all');
    setSheetJoinPreviewPage(0);
    setSheetJoinStage('preview');
  };

  const handleSheetJoinPreviewCellChange = (rowIndex, header, value) => {
    setSheetJoinPreview(prev => {
      if (!prev) return prev;
      const rows = prev.rows.map((row, index) => (
        index === rowIndex ? { ...row, [header]: value } : row
      ));
      return { ...prev, rows };
    });
  };

  const handleDownloadSheetJoinPreview = () => {
    if (!sheetJoinPreview) return;
    const exportRows = sheetJoinPreview.rows.map(row => {
      const cleanRow = {};
      sheetJoinPreview.headers.forEach(header => {
        cleanRow[header] = row[header] ?? '';
      });
      return cleanRow;
    });
    const worksheet = XLSX.utils.json_to_sheet(exportRows, { header: sheetJoinPreview.headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Compare_Preview');
    XLSX.writeFile(workbook, `${sheetJoinConfig.relationshipName || 'sheet_compare'}_preview.xlsx`);
  };

  const handleSheetJoinColumnResize = (header, event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sheetJoinColumnWidths[header] || 180;

    const handleMove = (moveEvent) => {
      const nextWidth = Math.max(90, startWidth + moveEvent.clientX - startX);
      setSheetJoinColumnWidths(prev => ({ ...prev, [header]: nextWidth }));
    };

    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  const handleSaveSheetJoinSetup = () => {
    const preview = sheetJoinPreview || buildSheetJoinPreview(sheetJoinConfig);

    const setup = {
      sourceType: 'same-workbook',
      ...preview.config,
      baseHeaderRow: Math.max(1, Number(preview.config.baseHeaderRow || 1)),
      detailHeaderRow: Math.max(1, Number(preview.config.detailHeaderRow || 1)),
      relationshipName: preview.config.relationshipName?.trim(),
      previewHeaders: preview.headers,
      previewRows: preview.rows.map(row => {
        const cleanRow = {};
        preview.headers.forEach(header => {
          cleanRow[header] = row[header] ?? '';
        });
        return cleanRow;
      }),
      previewSummary: preview.summary
    };

    setSheetJoinSetup(setup);
    setSheetJoinPreview(preview);
    setSheetJoinDialogOpen(false);
    setSheetJoinToastOpen(true);
  };

  const handleContinueWithBomMapping = async () => {
    const preview = sheetJoinPreview || buildSheetJoinPreview(sheetJoinConfig);
    try {
      const draft = await saveSheetJoinDraft(preview);
      if (draft) {
        applySheetJoinDraftToUpload(draft);
      }
    } catch (err) {
      setError('Failed to save generated BOM file: ' + (err.message || err));
    }
  };

  const continueAfterOptionalSheetJoin = async (sessionId, navState = null) => {
    if (!sheetJoinSetup) {
      showPrimaryColumnDialog(sessionId, navState);
      return;
    }

    try {
      setSuccess('Applying sheet comparison before mapping...');
      const response = await api.applySheetJoin({
        session_id: sessionId,
        base_sheet: sheetJoinSetup.baseSheet,
        detail_sheet: sheetJoinSetup.detailSheet,
        base_header_row: sheetJoinSetup.baseHeaderRow,
        detail_header_row: sheetJoinSetup.detailHeaderRow,
        base_key: sheetJoinSetup.baseKey,
        detail_key: sheetJoinSetup.detailKey,
        relationship_name: sheetJoinSetup.relationshipName,
        output_mode: sheetJoinSetup.outputMode,
        detail_columns: sheetJoinSetup.detailColumns,
        copied_base_columns: sheetJoinSetup.copiedBaseColumns,
        unique_id_mode: sheetJoinSetup.uniqueIdMode,
        unique_id_base_column: sheetJoinSetup.uniqueIdBaseColumn,
        unique_id_detail_column: sheetJoinSetup.uniqueIdDetailColumn,
        unique_id_pattern: sheetJoinSetup.uniqueIdPattern,
        preview_headers: sheetJoinSetup.previewHeaders,
        preview_rows: sheetJoinSetup.previewRows
      });
      setSuccess(`Sheet comparison applied: ${response.data.rows} rows ready for mapping.`);
      setTimeout(() => showPrimaryColumnDialog(sessionId, navState), 800);
    } catch (err) {
      setError('Failed to apply sheet comparison: ' + (err.response?.data?.error || err.message));
    }
  };

  // Primary column cleanup helpers
  const showPrimaryColumnDialog = async (sessionId, navState = null) => {
    try {
      const headersResp = await api.getHeaders(sessionId);
      const headers = headersResp.data.client_headers || [];
      if (headers.length === 0) {
        // No headers found, just navigate
        navigate(`/mapping/${sessionId}`, navState ? { state: navState } : undefined);
        return;
      }
      setPrimaryColumnHeaders(headers);
      setPrimaryColumnSessionId(sessionId);
      setPendingNavigateState(navState);
      setCleanupResult(null);
      setSelectedPrimaryColumn('');
      setCleanupLoading(false);
      setPrimaryColumnDialogOpen(true);
    } catch (err) {
      console.error('Failed to fetch headers for cleanup dialog:', err);
      // On error, just navigate normally
      navigate(`/mapping/${sessionId}`, navState ? { state: navState } : undefined);
    }
  };

  const handleSkipCleanup = () => {
    setPrimaryColumnDialogOpen(false);
    const sid = primaryColumnSessionId;
    const navState = pendingNavigateState;
    setPrimaryColumnSessionId(null);
    setPendingNavigateState(null);
    navigate(`/mapping/${sid}`, navState ? { state: navState } : undefined);
  };

  const handleCleanup = async () => {
    if (!selectedPrimaryColumn) return;
    try {
      setCleanupLoading(true);
      const result = await api.cleanupRows(primaryColumnSessionId, selectedPrimaryColumn);
      setCleanupResult(result.data);
      setCleanupLoading(false);

      // Brief delay to show result, then navigate
      setTimeout(() => {
        setPrimaryColumnDialogOpen(false);
        const sid = primaryColumnSessionId;
        const navState = pendingNavigateState;
        setPrimaryColumnSessionId(null);
        setPendingNavigateState(null);
        navigate(`/mapping/${sid}`, navState ? { state: navState } : undefined);
      }, 2000);
    } catch (err) {
      setCleanupLoading(false);
      setError('Failed to clean up rows: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleUpload = async () => {
    if (!userFile) {
      setError('Please select a client file');
      return;
    }

    const isPDF = userFile.name.toLowerCase().endsWith('.pdf');

    // Template file is required for non-PDF files
    if (!isPDF && !templateFile) {
      setError('Please select a template file');
      return;
    }

    if (!isPDF && clientSheetNames.length > 0 && !selectedClientSheet) {
      setError('Please select a sheet from your client file');
      return;
    }

    if (!isPDF && templateSheetNames.length > 0 && !selectedTemplateSheet) {
      setError('Please select a sheet from your template file');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Handle PDF files differently
      if (isPDF) {
        const formData = new FormData();
        formData.append('file', userFile);

        // Upload PDF file to PDF OCR endpoint
        const response = await api.uploadPDF(formData);
        setSuccess('PDF uploaded successfully! Choose processing method...');

        // Store session ID and show choice dialog
        setPendingPdfSessionId(response.data.session_id);
        setPdfChoiceDialogOpen(true);
        setLoading(false);

        return;
      }

      // Handle Excel/CSV files (existing logic)
      const formData = new FormData();
      formData.append('clientFile', userFile);
      formData.append('sheetName', selectedClientSheet);
      formData.append('headerRow', clientHeaderRow.toString());
      formData.append('templateFile', templateFile);
      formData.append('templateSheetName', selectedTemplateSheet);
      formData.append('templateHeaderRow', templateHeaderRow.toString());

      // Add formula rules if they exist and NO mapping template is selected
      // When a template is selected, it already contains the rules, so don't send them again
      if (!selectedTemplate && formulaRules && formulaRules.length > 0) {
        formData.append('formulaRules', JSON.stringify(formulaRules));
      }

      let response;
      
      // Use template-aware upload only when no sheet comparison needs to run first.
      if (selectedTemplate && !sheetJoinSetup) {
        response = await api.uploadFilesWithTemplate(formData, selectedTemplate.id);
        
        // Check template application results
        if (response.data.template_applied && response.data.template_success) {
          let successMessage = `Files uploaded successfully! Template "${selectedTemplate.name}" applied automatically.`;
          if (response.data.applied_formulas) {
            successMessage += ' Smart Tag formulas were also applied and new columns created.';
          }
          setSuccess(successMessage);
          
          setTimeout(() => {
            // Show primary column dialog before navigating
            continueAfterOptionalSheetJoin(response.data.session_id, {
              autoApplyTemplate: selectedTemplate,
              appliedTemplate: selectedTemplate,
              fromUpload: true,
              smartTagFormulaRules: formulaRules
            });
          }, 1500);
          
        } else {
          // Template failed to apply - show compatibility error modal
          const message = response.data.message || 'Template could not be applied to your files.';
          const appliedMappings = response.data.applied_mappings;
          const compatibilityDetails = response.data.compatibility_details;
          
          setCompatibilityErrorData({
            message,
            appliedMappings,
            compatibilityDetails,
            templateName: selectedTemplate.name
          });
          setPendingSessionId(response.data.session_id);
          setCompatibilityErrorOpen(true);
          setLoading(false);
          return;
        }
        
      } else {
        // No template selected, or sheet comparison must run before template mapping.
        response = await api.uploadFiles(formData);
        setSuccess(sheetJoinSetup ? 'Files uploaded. Preparing sheet comparison...' : 'Files uploaded successfully!');

        setTimeout(() => {
          continueAfterOptionalSheetJoin(response.data.session_id, selectedTemplate ? {
            autoApplyTemplate: selectedTemplate,
            appliedTemplate: selectedTemplate,
            fromUpload: true,
            smartTagFormulaRules: formulaRules
          } : null);
        }, 1500);
      }
      
    } catch (err) {
      console.error('Upload error:', err);
      
      // Check if this is a template compatibility error
      if (selectedTemplate && err.response?.status === 400 && err.response?.data?.compatibility_details) {
        setCompatibilityErrorData({
          message: err.response.data.error,
          compatibilityDetails: err.response.data.compatibility_details,
          templateName: selectedTemplate.name
        });
        setPendingSessionId(err.response.data.session_id);
        setCompatibilityErrorOpen(true);
      } else {
        let errorMessage = 'Error uploading files. Please try again.';
        
        if (err.response?.data?.error) {
          errorMessage = err.response.data.error;
        }
        
        if (selectedTemplate && err.response?.data?.error?.includes('template')) {
          errorMessage += ' The selected template may not be compatible with your files. Try uploading without a template to create custom mappings.';
        }
        
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle PDF processing choice
  const handlePdfProcessingChoice = async (useZonalMapping) => {
    try {
      setLoading(true);
      setPdfChoiceDialogOpen(false);

      if (useZonalMapping) {
        setSuccess('Proceeding to zone selection for optimal results...');
        setTimeout(() => {
          navigate(`/pdf-zones/${pendingPdfSessionId}`, {
            state: {
              fromUpload: true,
              pdfAlignment: pdfDataAlignment
            }
          });
        }, 1000);
      } else {
        setSuccess('Processing with standard OCR...');

        // Process the PDF with standard OCR
        const ocrResponse = await api.processPDFOCR({
          session_id: pendingPdfSessionId,
          data_alignment: pdfDataAlignment
        });
        setSuccess('PDF processed successfully! Proceeding to column mapping...');

        setTimeout(() => {
          navigate(`/mapping/${pendingPdfSessionId}`, {
            state: {
              fromPDF: true,
              ocrData: ocrResponse.data
            }
          });
        }, 1500);
      }
    } catch (err) {
      console.error('Error processing PDF:', err);
      setError('Error processing PDF. Please try again.');
    } finally {
      setLoading(false);
      setPendingPdfSessionId(null);
    }
  };

  const sheetJoinBaseHeaders = getSheetHeaders(sheetJoinConfig.baseSheet, sheetJoinConfig.baseHeaderRow);
  const sheetJoinDetailHeaders = getSheetHeaders(sheetJoinConfig.detailSheet, sheetJoinConfig.detailHeaderRow);
  const sheetJoinFilteredPreviewRows = sheetJoinPreview
    ? sheetJoinPreview.rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => sheetJoinPreviewFilter === 'all' || row.__sheetJoinStatus === sheetJoinPreviewFilter)
    : [];
  const sheetJoinPreviewTotalPages = Math.max(1, Math.ceil(sheetJoinFilteredPreviewRows.length / sheetJoinPreviewRowsPerPage));
  const sheetJoinPreviewStart = sheetJoinPreviewPage * sheetJoinPreviewRowsPerPage;
  const visibleSheetJoinPreviewRows = sheetJoinFilteredPreviewRows.slice(sheetJoinPreviewStart, sheetJoinPreviewStart + sheetJoinPreviewRowsPerPage);
  const visibleSheetJoinPreviewColumns = sheetJoinPreview
    ? sheetJoinPreview.headers.filter(header => sheetJoinVisibleColumns.includes(header))
    : [];

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, mb: 4 }}>
        Upload Files
      </Typography>
      
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mb: 3 }}>
          {success}
        </Alert>
      )}
      
      {/* STEP 1: File Upload Section */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <UploadFileIcon color="primary" fontSize="large" />
            <Typography variant="h5" fontWeight="600">
              Step 1: Upload Your Files
            </Typography>
          </Box>
          
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>
                Client File
              </Typography>
              
              <Box 
                {...getUserRootProps()} 
                sx={{
                  border: '2px dashed #ccc',
                  borderRadius: 2,
                  p: 4,
                  textAlign: 'center',
                  cursor: 'pointer',
                  backgroundColor: isUserDragActive ? '#f0f8ff' : '#fafafa',
                  transition: 'all 0.2s ease',
                  '&:hover': { backgroundColor: '#f0f8ff' }
                }}
              >
                <input {...getUserInputProps()} />
                <CloudUploadIcon fontSize="large" color="primary" />
                <Typography variant="body1" sx={{ mt: 2 }}>
                  {userFile ? userFile.name : 'Drop your Excel, CSV, or PDF file here or click to browse'}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Supported: .xlsx, .xls, .csv, .pdf
                </Typography>
              </Box>
              
              {userFile && (
                <Typography variant="body2" sx={{ mt: 2, color: 'success.main' }}>
                  ✓ Selected: {userFile.name}
                </Typography>
              )}

              {/* PDF files will automatically use flatten alignment - no user choice needed */}
              
              {clientSheetNames.length > 0 && (
                <>
                  <Grid container spacing={2} sx={{ mt: 2 }}>
                    <Grid item xs={12} sm={7}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Sheet Name</InputLabel>
                        <Select
                          value={selectedClientSheet}
                          label="Sheet Name"
                          onChange={(e) => setSelectedClientSheet(e.target.value)}
                        >
                          {clientSheetNames.map(sheet => (
                            <MenuItem key={sheet} value={sheet}>{sheet}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={5}>
                      <TextField
                        label="Header Row"
                        type="number"
                        size="small"
                        fullWidth
                        InputProps={{ inputProps: { min: 1 } }}
                        value={clientHeaderRow}
                        onChange={(e) => setClientHeaderRow(Number(e.target.value))}
                      />
                    </Grid>
                  </Grid>

                  {clientSheetNames.length > 1 && (
                    <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-start' }}>
                      <Button
                        variant="outlined"
                        startIcon={<AddIcon />}
                        onClick={handleOpenSheetJoinSetup}
                        size="small"
                      >
                        Add sheet comparison
                      </Button>
                    </Box>
                  )}

                  {sheetJoinSetup && (
                    <Alert severity="info" sx={{ mt: 2 }}>
                      <Typography variant="body2" fontWeight="600">
                        Compare setup saved{sheetJoinSetup.relationshipName ? `: ${sheetJoinSetup.relationshipName}` : ''}
                      </Typography>
                      <Typography variant="body2">
                        {sheetJoinSetup.baseSheet}.{sheetJoinSetup.baseKey} -> {sheetJoinSetup.detailSheet}.{sheetJoinSetup.detailKey}
                      </Typography>
                    </Alert>
                  )}
                </>
              )}
            </Grid>
            
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>
                Template File <span style={{ color: '#d32f2f' }}>*</span>
              </Typography>

              <Box
                {...getTemplateRootProps()}
                sx={{
                  border: '2px dashed #ccc',
                  borderRadius: 2,
                  p: 4,
                  textAlign: 'center',
                  cursor: 'pointer',
                  backgroundColor: isTemplateDragActive ? '#f0f8ff' : '#fafafa',
                  transition: 'all 0.2s ease',
                  '&:hover': { backgroundColor: '#f0f8ff' }
                }}
              >
                <input {...getTemplateInputProps()} />
                <CloudUploadIcon fontSize="large" color="primary" />
                <Typography variant="body1" sx={{ mt: 2 }}>
                  {templateFile ? templateFile.name : 'Drop your template file here or click to browse'}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Supported: .xlsx, .xls, .csv
                </Typography>
              </Box>

              {templateFile && (
                <Typography variant="body2" sx={{ mt: 2, color: 'success.main' }}>
                  ✓ Selected: {templateFile.name}
                </Typography>
              )}

              {templateSheetNames.length > 0 && (
                <Grid container spacing={2} sx={{ mt: 2 }}>
                  <Grid item xs={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Sheet Name</InputLabel>
                      <Select
                        value={selectedTemplateSheet}
                        label="Sheet Name"
                        onChange={(e) => setSelectedTemplateSheet(e.target.value)}
                      >
                        {templateSheetNames.map(sheet => (
                          <MenuItem key={sheet} value={sheet}>{sheet}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      label="Header Row"
                      type="number"
                      size="small"
                      fullWidth
                      InputProps={{ inputProps: { min: 1 } }}
                      value={templateHeaderRow}
                      onChange={(e) => setTemplateHeaderRow(Number(e.target.value))}
                    />
                  </Grid>
                </Grid>
              )}
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* STEP 2: Template Selection - Always Visible */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <LibraryBooksIcon color="primary" fontSize="large" />
            <Typography variant="h5" fontWeight="600">
              Step 2: Choose a Mapping Template (Optional)
            </Typography>
          </Box>
          
          {/* Search Bar */}
          <TextField
            fullWidth
            placeholder="Search templates..."
            value={templateSearchTerm}
            onChange={(e) => setTemplateSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: <SearchIcon color="action" sx={{ mr: 1 }} />,
            }}
            sx={{ mb: 3 }}
            size="small"
          />

          {/* Selected Template Display */}
          {selectedTemplate && (
            <Alert 
              severity="success" 
              sx={{ mb: 3 }}
              action={
                <Button color="inherit" size="small" onClick={handleRemoveTemplate}>
                  <CloseIcon />
                </Button>
              }
            >
              <Typography variant="subtitle2" fontWeight="600">
                Selected: {selectedTemplate.name}
              </Typography>
              <Typography variant="body2">
                {selectedTemplate.description || `${selectedTemplate.total_mappings} mappings • Used ${selectedTemplate.usage_count || 0} times`}
              </Typography>
            </Alert>
          )}

          {/* Templates List */}
          {templatesLoading ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Loading templates...
              </Typography>
            </Box>
          ) : filteredTemplates.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
              <LibraryBooksIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
              <Typography variant="h6">
                {templateSearchTerm ? 'No templates match your search' : 'No templates available'}
              </Typography>
              <Typography variant="body2">
                {templateSearchTerm ? 'Try a different search term' : 'Upload without a template to create custom mappings'}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
              {filteredTemplates.map((template) => (
                <Box
                  key={template.id}
                  sx={{
                    p: 2,
                    borderBottom: '1px solid #f0f0f0',
                    cursor: 'pointer',
                    backgroundColor: selectedTemplate?.id === template.id ? '#e3f2fd' : 'transparent',
                    '&:hover': { backgroundColor: selectedTemplate?.id === template.id ? '#e3f2fd' : '#f8f9fa' },
                    '&:last-child': { borderBottom: 'none' }
                  }}
                  onClick={() => handleSelectTemplate(template)}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight="600">
                        {template.name}
                      </Typography>
                      {template.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          {template.description}
                        </Typography>
                      )}
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Chip 
                          icon={<CheckCircleIcon />}
                          label={`${template.total_mappings} mappings`}
                          size="small"
                          variant="outlined"
                        />
                        <Chip 
                          icon={<TrendingUpIcon />}
                          label={`Used ${template.usage_count || 0}×`}
                          size="small"
                          variant="outlined"
                          color={template.usage_count > 0 ? 'success' : 'default'}
                        />
                        <Chip 
                          icon={<ScheduleIcon />}
                          label={new Date(template.created_at).toLocaleDateString()}
                          size="small"
                          variant="outlined"
                        />
                      </Box>
                    </Box>
                    {selectedTemplate?.id === template.id && (
                      <CheckCircleIcon color="primary" />
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {!selectedTemplate && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
              No template selected - you can proceed without one
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Tag Templates (Optional) */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <ScienceIcon color="primary" fontSize="large" />
            <Typography variant="h5" fontWeight="600">
              Step 3: Choose a Tag Template (Optional)
            </Typography>
          </Box>
          
          {/* Search Bar */}
          <TextField
            fullWidth
            placeholder="Search tag templates..."
            value={tagTemplateSearchTerm}
            onChange={(e) => setTagTemplateSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: <SearchIcon color="action" sx={{ mr: 1 }} />,
            }}
            sx={{ mb: 3 }}
            size="small"
          />

          {/* Selected Tag Template Display */}
          {selectedTagTemplate && (
            <Alert 
              severity="success" 
              sx={{ mb: 3 }}
              action={
                <Button color="inherit" size="small" onClick={handleRemoveTagTemplate}>
                  <CloseIcon />
                </Button>
              }
            >
              <Typography variant="subtitle2" fontWeight="600">
                Selected: {selectedTagTemplate.name}
              </Typography>
              <Typography variant="body2">
                {selectedTagTemplate.description || `${(selectedTagTemplate.formula_rules || []).length} rules • Used ${selectedTagTemplate.usage_count || 0} times`}
              </Typography>
            </Alert>
          )}

          {/* Tag Templates List */}
          {tagTemplatesLoading ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Loading tag templates...
              </Typography>
            </Box>
          ) : filteredTagTemplates.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
              <ScienceIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
              <Typography variant="h6">
                {tagTemplateSearchTerm ? 'No tag templates match your search' : 'No tag templates available'}
              </Typography>
              <Typography variant="body2">
                {tagTemplateSearchTerm ? 'Try a different search term' : 'Create tag templates from the dashboard'}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
              {filteredTagTemplates.map((template) => (
                <Box
                  key={template.id}
                  sx={{
                    p: 2,
                    borderBottom: '1px solid #f0f0f0',
                    cursor: 'pointer',
                    backgroundColor: selectedTagTemplate?.id === template.id ? '#e8f5e8' : 'transparent',
                    '&:hover': { backgroundColor: selectedTagTemplate?.id === template.id ? '#e8f5e8' : '#f8f9fa' },
                    '&:last-child': { borderBottom: 'none' }
                  }}
                  onClick={() => handleSelectTagTemplate(template)}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight="600">
                        {template.name}
                      </Typography>
                      {template.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          {template.description}
                        </Typography>
                      )}
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Chip 
                          icon={<ScienceIcon />}
                          label={`${(template.formula_rules || []).length} rules`}
                          size="small"
                          variant="outlined"
                        />
                        <Chip 
                          icon={<TrendingUpIcon />}
                          label={`Used ${template.usage_count || 0}×`}
                          size="small"
                          variant="outlined"
                          color={template.usage_count > 0 ? 'success' : 'default'}
                        />
                        <Chip 
                          icon={<ScheduleIcon />}
                          label={new Date(template.created_at).toLocaleDateString()}
                          size="small"
                          variant="outlined"
                        />
                      </Box>
                    </Box>
                    {selectedTagTemplate?.id === template.id && (
                      <CheckCircleIcon color="success" />
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {!selectedTagTemplate && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
              No tag template selected - template will provide smart tagging rules
            </Typography>
          )}
        </CardContent>
      </Card>

      
      {/* Upload Button */}
      <Box sx={{ textAlign: 'center' }}>
        <Button
          variant="contained"
          size="large"
          onClick={handleUpload}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={20} color="inherit" /> : (selectedTemplate ? <PlayArrowIcon /> : <CloudUploadIcon />)}
          sx={{ 
            minWidth: 200,
            py: 1.5,
            fontSize: '1.1rem',
            fontWeight: 600
          }}
        >
          {loading 
            ? 'Uploading...' 
            : (selectedTemplate 
                ? `Upload with ${selectedTemplate.name}` 
                : 'Upload File')
          }
        </Button>
        
        {selectedTemplate && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Template will be applied automatically
          </Typography>
        )}
      </Box>

      <Dialog
        open={sheetJoinDialogOpen}
        onClose={handleCloseSheetJoinSetup}
        fullScreen={sheetJoinStage === 'preview'}
        maxWidth={sheetJoinStage === 'preview' ? false : 'md'}
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight="600">
              Compare Sheets
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Build a sheet comparison before template mapping
            </Typography>
          </Box>
          <IconButton onClick={handleCloseSheetJoinSetup}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {sheetJoinStage === 'match' && (
            <Grid container spacing={2.5}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                  <InputLabel>Sheet with main item list</InputLabel>
                  <Select
                    label="Sheet with main item list"
                    value={sheetJoinConfig.baseSheet}
                    onChange={(event) => {
                      const baseSheet = event.target.value;
                      const baseHeaders = getSheetHeaders(baseSheet, sheetJoinConfig.baseHeaderRow);
                      const baseKey = guessKeyColumn(baseHeaders);
                      setSheetJoinConfig(prev => ({
                        ...prev,
                        baseSheet,
                        baseKey,
                        uniqueIdBaseColumn: baseKey,
                        copiedBaseColumns: defaultCopiedBaseColumns(baseHeaders)
                      }));
                    }}
                  >
                    {clientSheetNames.map(sheet => (
                      <MenuItem key={sheet} value={sheet}>{sheet}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                  <InputLabel>Sheet with matching details</InputLabel>
                  <Select
                    label="Sheet with matching details"
                    value={sheetJoinConfig.detailSheet}
                    onChange={(event) => {
                      const detailSheet = event.target.value;
                      const detailHeaders = getSheetHeaders(detailSheet, sheetJoinConfig.detailHeaderRow);
                      const detailKey = guessKeyColumn(detailHeaders);
                      const detailColumns = defaultDetailColumns(detailHeaders, detailKey);
                      setSheetJoinConfig(prev => ({
                        ...prev,
                        detailSheet,
                        detailKey,
                        detailColumns,
                        uniqueIdDetailColumn: detailColumns[0] || detailKey
                      }));
                    }}
                  >
                    {clientSheetNames.map(sheet => (
                      <MenuItem key={sheet} value={sheet}>{sheet}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label="Header row in main sheet"
                  value={sheetJoinConfig.baseHeaderRow}
                  onChange={(event) => {
                    const baseHeaderRow = Math.max(1, Number(event.target.value || 1));
                    const headers = getSheetHeaders(sheetJoinConfig.baseSheet, baseHeaderRow);
                    const baseKey = guessKeyColumn(headers);
                    setSheetJoinConfig(prev => ({
                      ...prev,
                      baseHeaderRow,
                      baseKey,
                      uniqueIdBaseColumn: baseKey,
                      copiedBaseColumns: defaultCopiedBaseColumns(headers)
                    }));
                  }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label="Header row in details sheet"
                  value={sheetJoinConfig.detailHeaderRow}
                  onChange={(event) => {
                    const detailHeaderRow = Math.max(1, Number(event.target.value || 1));
                    const headers = getSheetHeaders(sheetJoinConfig.detailSheet, detailHeaderRow);
                    const detailKey = guessKeyColumn(headers);
                    const detailColumns = defaultDetailColumns(headers, detailKey);
                    setSheetJoinConfig(prev => ({
                      ...prev,
                      detailHeaderRow,
                      detailKey,
                      detailColumns,
                      uniqueIdDetailColumn: detailColumns[0] || detailKey
                    }));
                  }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Main sheet column to match</InputLabel>
                  <Select
                    label="Main sheet column to match"
                    value={sheetJoinConfig.baseKey}
                    onChange={(event) => setSheetJoinConfig(prev => ({
                      ...prev,
                      baseKey: event.target.value,
                      uniqueIdBaseColumn: event.target.value
                    }))}
                  >
                    {sheetJoinBaseHeaders.map(header => (
                      <MenuItem key={header} value={header}>{header}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Details sheet column with same values</InputLabel>
                  <Select
                    label="Details sheet column with same values"
                    value={sheetJoinConfig.detailKey}
                    onChange={(event) => {
                      const detailKey = event.target.value;
                      setSheetJoinConfig(prev => ({
                        ...prev,
                        detailKey,
                        detailColumns: prev.detailColumns.filter(column => column !== detailKey),
                        uniqueIdDetailColumn: prev.uniqueIdDetailColumn || detailKey
                      }));
                    }}
                  >
                    {sheetJoinDetailHeaders.map(header => (
                      <MenuItem key={header} value={header}>{header}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  label="Name for new related-data column"
                  placeholder="Example: MPN details"
                  value={sheetJoinConfig.relationshipName}
                  onChange={(event) => setSheetJoinConfig(prev => ({ ...prev, relationshipName: event.target.value }))}
                  helperText="Used when one detail column is grouped into the same row; otherwise original detail column names are kept."
                />
              </Grid>
            </Grid>
          )}

          {sheetJoinStage === 'options' && (
            <Grid container spacing={2.5}>
              <Grid item xs={12}>
                <Typography variant="subtitle1" fontWeight="600" gutterBottom>
                  Output format
                </Typography>
                <RadioGroup
                  row
                  value={sheetJoinConfig.outputMode}
                  onChange={(event) => setSheetJoinConfig(prev => ({ ...prev, outputMode: event.target.value }))}
                >
                  <FormControlLabel value="grouped" control={<Radio size="small" />} label="Put all related values in the same row" />
                  <FormControlLabel value="expanded" control={<Radio size="small" />} label="Create a separate row for each related entry" />
                </RadioGroup>
              </Grid>

              <Grid item xs={12}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="subtitle1" fontWeight="600">
                    Columns to bring from details sheet
                  </Typography>
                  <Box>
                    <Button size="small" onClick={() => setSheetJoinConfig(prev => ({
                      ...prev,
                      detailColumns: sheetJoinDetailHeaders.filter(header => header !== prev.detailKey)
                    }))}>
                      Select all
                    </Button>
                    <Button size="small" onClick={() => setSheetJoinConfig(prev => ({ ...prev, detailColumns: [] }))}>
                      Clear
                    </Button>
                  </Box>
                </Box>
                <FormGroup row sx={{ gap: 0.5 }}>
                  {sheetJoinDetailHeaders
                    .filter(header => header !== sheetJoinConfig.detailKey)
                    .map(header => (
                      <FormControlLabel
                        key={header}
                        control={
                          <Checkbox
                            size="small"
                            checked={sheetJoinConfig.detailColumns.includes(header)}
                            onChange={(event) => {
                              setSheetJoinConfig(prev => ({
                                ...prev,
                                detailColumns: event.target.checked
                                  ? [...prev.detailColumns, header]
                                  : prev.detailColumns.filter(column => column !== header)
                              }));
                            }}
                          />
                        }
                        label={header}
                      />
                    ))}
                </FormGroup>
              </Grid>

              {sheetJoinConfig.outputMode === 'expanded' && (
                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle1" fontWeight="600" gutterBottom>
                    Row ID for expanded matches
                  </Typography>
                  <RadioGroup
                    row
                    value={sheetJoinConfig.uniqueIdMode}
                    onChange={(event) => setSheetJoinConfig(prev => ({ ...prev, uniqueIdMode: event.target.value }))}
                  >
                    <FormControlLabel value="auto" control={<Radio size="small" />} label="Merge two selected columns" />
                    <FormControlLabel value="custom" control={<Radio size="small" />} label="Use custom pattern" />
                  </RadioGroup>

                  <Grid container spacing={2} sx={{ mt: 0.5 }}>
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Main ID column</InputLabel>
                        <Select
                          label="Main ID column"
                          value={sheetJoinConfig.uniqueIdBaseColumn}
                          onChange={(event) => setSheetJoinConfig(prev => ({ ...prev, uniqueIdBaseColumn: event.target.value }))}
                        >
                          {sheetJoinBaseHeaders.map(header => (
                            <MenuItem key={header} value={header}>{header}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Detail ID column</InputLabel>
                        <Select
                          label="Detail ID column"
                          value={sheetJoinConfig.uniqueIdDetailColumn}
                          onChange={(event) => setSheetJoinConfig(prev => ({ ...prev, uniqueIdDetailColumn: event.target.value }))}
                        >
                          {sheetJoinDetailHeaders.map(header => (
                            <MenuItem key={header} value={header}>{header}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    {sheetJoinConfig.uniqueIdMode === 'custom' && (
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          size="small"
                          label="Custom ID pattern"
                          value={sheetJoinConfig.uniqueIdPattern}
                          onChange={(event) => setSheetJoinConfig(prev => ({ ...prev, uniqueIdPattern: event.target.value }))}
                          helperText="Use {base} and {detail}, for example {base}_{detail}"
                        />
                      </Grid>
                    )}
                  </Grid>
                </Grid>
              )}

              {sheetJoinConfig.outputMode === 'expanded' && (
              <Grid item xs={12}>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="subtitle1" fontWeight="600">
                    Main sheet columns to repeat on every generated row
                  </Typography>
                  <Box>
                    <Button size="small" onClick={() => setSheetJoinConfig(prev => ({ ...prev, copiedBaseColumns: sheetJoinBaseHeaders }))}>
                      Select all
                    </Button>
                    <Button size="small" onClick={() => setSheetJoinConfig(prev => ({ ...prev, copiedBaseColumns: [] }))}>
                      Clear
                    </Button>
                  </Box>
                </Box>
                <FormGroup row sx={{ gap: 0.5 }}>
                  {sheetJoinBaseHeaders.map(header => (
                    <FormControlLabel
                      key={header}
                      control={
                        <Checkbox
                          size="small"
                          checked={sheetJoinConfig.copiedBaseColumns.includes(header)}
                          onChange={(event) => {
                            setSheetJoinConfig(prev => ({
                              ...prev,
                              copiedBaseColumns: event.target.checked
                                ? [...prev.copiedBaseColumns, header]
                                : prev.copiedBaseColumns.filter(column => column !== header)
                            }));
                          }}
                        />
                      }
                      label={header}
                    />
                  ))}
                </FormGroup>
              </Grid>
              )}
            </Grid>
          )}

          {sheetJoinStage === 'preview' && sheetJoinPreview && (
            <Box>
              <Grid container spacing={1.5} sx={{ mb: 2 }}>
                <Grid item xs={6} md={3}>
                  <Chip
                    label={`${sheetJoinPreview.summary.outputRows} output rows`}
                    color={sheetJoinPreviewFilter === 'all' ? 'primary' : 'default'}
                    variant={sheetJoinPreviewFilter === 'all' ? 'filled' : 'outlined'}
                    onClick={() => {
                      setSheetJoinPreviewFilter('all');
                      setSheetJoinPreviewPage(0);
                    }}
                    clickable
                  />
                </Grid>
                <Grid item xs={6} md={3}>
                  <Chip
                    color="success"
                    label={`${sheetJoinPreview.summary.matchedBaseRows} matched`}
                    variant={sheetJoinPreviewFilter === 'matched' ? 'filled' : 'outlined'}
                    onClick={() => {
                      setSheetJoinPreviewFilter('matched');
                      setSheetJoinPreviewPage(0);
                    }}
                    clickable
                  />
                </Grid>
                <Grid item xs={6} md={3}>
                  <Chip
                    color="warning"
                    label={`${sheetJoinPreview.summary.unmatchedBaseRows} unmatched`}
                    variant={sheetJoinPreviewFilter === 'unmatched' ? 'filled' : 'outlined'}
                    onClick={() => {
                      setSheetJoinPreviewFilter('unmatched');
                      setSheetJoinPreviewPage(0);
                    }}
                    clickable
                  />
                </Grid>
                <Grid item xs={6} md={3}><Chip label={`${sheetJoinPreview.summary.orphanDetailKeys} detail-only keys`} /></Grid>
              </Grid>
              <Alert severity="info" sx={{ mb: 2 }}>
                Preview keeps the full generated data. Showing {visibleSheetJoinPreviewRows.length ? sheetJoinPreviewStart + 1 : 0}-{Math.min(sheetJoinPreviewStart + visibleSheetJoinPreviewRows.length, sheetJoinFilteredPreviewRows.length)} of {sheetJoinFilteredPreviewRows.length} rows to keep the page responsive.
              </Alert>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={sheetJoinPreviewPage === 0}
                  onClick={() => setSheetJoinPreviewPage(page => Math.max(0, page - 1))}
                >
                  Previous
                </Button>
                <Typography variant="body2" color="text.secondary">
                  Page {sheetJoinPreviewPage + 1} of {sheetJoinPreviewTotalPages}
                </Typography>
                <FormControl size="small" sx={{ minWidth: 260 }}>
                  <InputLabel>Visible columns</InputLabel>
                  <Select
                    multiple
                    label="Visible columns"
                    value={sheetJoinVisibleColumns}
                    onChange={(event) => {
                      const value = event.target.value;
                      const selected = (typeof value === 'string' ? value.split(',') : value).filter(column => column !== '__all__');
                      setSheetJoinVisibleColumns(selected);
                    }}
                    renderValue={(selected) => `${selected.length} columns shown`}
                  >
                    <MenuItem
                      value="__all__"
                      onClick={(event) => {
                        event.preventDefault();
                        setSheetJoinVisibleColumns(sheetJoinPreview.headers);
                      }}
                    >
                      <Checkbox checked={sheetJoinVisibleColumns.length === sheetJoinPreview.headers.length} />
                      Show all columns
                    </MenuItem>
                    {sheetJoinPreview.headers.map(header => (
                      <MenuItem key={header} value={header}>
                        <Checkbox checked={sheetJoinVisibleColumns.includes(header)} />
                        {header}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={sheetJoinPreviewPage >= sheetJoinPreviewTotalPages - 1}
                  onClick={() => setSheetJoinPreviewPage(page => Math.min(sheetJoinPreviewTotalPages - 1, page + 1))}
                >
                  Next
                </Button>
              </Box>
              <Box sx={{ height: 'calc(100vh - 260px)', overflow: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
                <Box component="table" sx={{ width: 'max-content', minWidth: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', '& th, & td': { borderBottom: '1px solid #eee', p: 0.75 }, '& th': { position: 'sticky', top: 0, backgroundColor: '#fafafa', zIndex: 1, textAlign: 'left' } }}>
                  <Box component="thead">
                    <Box component="tr">
                      {visibleSheetJoinPreviewColumns.map(header => (
                        <Box
                          component="th"
                          key={header}
                          sx={{
                            width: sheetJoinColumnWidths[header] || 180,
                            minWidth: sheetJoinColumnWidths[header] || 180,
                            maxWidth: sheetJoinColumnWidths[header] || 180,
                            position: 'relative',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            pr: 2
                          }}
                        >
                          {header}
                          <Box
                            onMouseDown={(event) => handleSheetJoinColumnResize(header, event)}
                            sx={{
                              position: 'absolute',
                              top: 0,
                              right: 0,
                              width: 8,
                              height: '100%',
                              cursor: 'col-resize',
                              borderRight: '2px solid transparent',
                              '&:hover': { borderRightColor: 'primary.main' }
                            }}
                          />
                        </Box>
                      ))}
                    </Box>
                  </Box>
                  <Box component="tbody">
                    {visibleSheetJoinPreviewRows.map(({ row, index: rowIndex }) => {
                      return (
                      <Box component="tr" key={`preview-row-${rowIndex}`}>
                        {visibleSheetJoinPreviewColumns.map(header => (
                          <Box
                            component="td"
                            key={`${rowIndex}-${header}`}
                            sx={{
                              width: sheetJoinColumnWidths[header] || 180,
                              minWidth: sheetJoinColumnWidths[header] || 180,
                              maxWidth: sheetJoinColumnWidths[header] || 180
                            }}
                          >
                            <Box
                              component="input"
                              value={row[header] ?? ''}
                              onChange={(event) => handleSheetJoinPreviewCellChange(rowIndex, header, event.target.value)}
                              sx={{
                                width: '100%',
                                border: 'none',
                                outline: 'none',
                                backgroundColor: 'transparent',
                                font: 'inherit',
                                p: 0,
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                            />
                          </Box>
                        ))}
                      </Box>
                    );})}
                  </Box>
                </Box>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={handleCloseSheetJoinSetup}>
            Cancel
          </Button>
          {sheetJoinStage !== 'match' && (
            <Button onClick={() => setSheetJoinStage(sheetJoinStage === 'preview' ? 'options' : 'match')}>
              Back
            </Button>
          )}
          {sheetJoinStage === 'preview' && (
            <Button onClick={handleDownloadSheetJoinPreview}>
              Download Preview
            </Button>
          )}
          {sheetJoinStage === 'preview' && (
            <Button variant="outlined" onClick={handleContinueWithBomMapping}>
              Continue with BOM mapping
            </Button>
          )}
          {sheetJoinStage === 'match' && (
            <Button
              variant="contained"
              onClick={handleProceedSheetJoinOptions}
              disabled={!sheetJoinConfig.baseKey || !sheetJoinConfig.detailKey || sheetJoinConfig.baseSheet === sheetJoinConfig.detailSheet}
            >
              Proceed
            </Button>
          )}
          {sheetJoinStage === 'options' && (
            <Button
              variant="contained"
              onClick={handlePreviewSheetJoin}
              disabled={
                sheetJoinConfig.detailColumns.length === 0 ||
                (sheetJoinConfig.outputMode === 'expanded' && (
                  !sheetJoinConfig.uniqueIdBaseColumn ||
                  !sheetJoinConfig.uniqueIdDetailColumn ||
                  (sheetJoinConfig.uniqueIdMode === 'custom' && !sheetJoinConfig.uniqueIdPattern.trim())
                ))
              }
            >
              Preview
            </Button>
          )}
          {sheetJoinStage === 'preview' && (
            <Button variant="contained" onClick={handleSaveSheetJoinSetup}>
              Save Comparison
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Snackbar
        open={sheetJoinToastOpen}
        autoHideDuration={3500}
        onClose={() => setSheetJoinToastOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSheetJoinToastOpen(false)} sx={{ width: '100%' }}>
          Step 7 completed
        </Alert>
      </Snackbar>

      {/* Template Compatibility Error Modal */}
      <Dialog 
        open={compatibilityErrorOpen} 
        onClose={handleCloseCompatibilityError}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          alignItems: 'center', 
          gap: 2,
          backgroundColor: '#fff3e0'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <WarningIcon color="warning" fontSize="large" />
            <Typography variant="h6" fontWeight="600" color="warning.main">
              Template Compatibility Issue
            </Typography>
          </Box>
          <IconButton onClick={handleCloseCompatibilityError}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        
        <DialogContent sx={{ pt: 3 }}>
          <Alert severity="warning" sx={{ mb: 3 }}>
            <Typography variant="subtitle1" fontWeight="600" gutterBottom>
              Template "{compatibilityErrorData?.templateName}" is not fully compatible with your uploaded files.
            </Typography>
            <Typography variant="body2">
              {compatibilityErrorData?.message}
            </Typography>
          </Alert>

          {compatibilityErrorData?.compatibilityDetails && (
            <Card variant="outlined" sx={{ p: 2, mb: 3, backgroundColor: '#fafafa' }}>
              <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
                Compatibility Details:
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • Template expects: <strong>{compatibilityErrorData.compatibilityDetails.total_template_columns}</strong> columns
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • Successfully matched: <strong>{compatibilityErrorData.compatibilityDetails.matched_columns}</strong> columns
              </Typography>
              <Typography variant="body2" color="text.secondary">
                • Compatibility rate: <strong>{Math.round(compatibilityErrorData.compatibilityDetails.success_rate * 100)}%</strong>
              </Typography>
            </Card>
          )}

          <Typography variant="body1" sx={{ mb: 2 }}>
            What would you like to do?
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Card 
              variant="outlined" 
              sx={{ 
                p: 3, 
                cursor: 'pointer',
                '&:hover': { backgroundColor: '#f5f5f5', borderColor: '#ff9800' }
              }}
              onClick={handleContinueAnyway}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <PlayArrowIcon color="warning" />
                <Box>
                  <Typography variant="h6" fontWeight="600">
                    Continue Anyway
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Proceed to mapping page where you can manually create the missing mappings
                  </Typography>
                </Box>
              </Box>
            </Card>
            
            <Card 
              variant="outlined" 
              sx={{ 
                p: 3, 
                cursor: 'pointer',
                '&:hover': { backgroundColor: '#f5f5f5', borderColor: '#1976d2' }
              }}
              onClick={handleTryDifferentTemplate}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <LibraryBooksIcon color="primary" />
                <Box>
                  <Typography variant="h6" fontWeight="600">
                    Try Different Template
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Go back and select a different template that might be more compatible
                  </Typography>
                </Box>
              </Box>
            </Card>

            <Card 
              variant="outlined" 
              sx={{ 
                p: 3, 
                cursor: 'pointer',
                '&:hover': { backgroundColor: '#f5f5f5', borderColor: '#4caf50' }
              }}
              onClick={handleUploadWithoutTemplate}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <CloudUploadIcon color="success" />
                <Box>
                  <Typography variant="h6" fontWeight="600">
                    Upload Without Template
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Start fresh and create custom mappings from scratch
                  </Typography>
                </Box>
              </Box>
            </Card>
          </Box>
        </DialogContent>
        
        <DialogActions sx={{ p: 3, pt: 1 }}>
          <Button onClick={handleCloseCompatibilityError}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* PDF Processing Choice Dialog */}
      <Dialog
        open={pdfChoiceDialogOpen}
        onClose={() => setPdfChoiceDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <ScienceIcon color="primary" />
            Choose PDF Processing Method
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 3 }}>
            How would you like to process your PDF? Choose the method that best fits your document:
          </Typography>

          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <Card
                sx={{
                  cursor: 'pointer',
                  border: '2px solid transparent',
                  '&:hover': {
                    border: '2px solid #1976d2',
                    bgcolor: 'primary.50'
                  }
                }}
                onClick={() => handlePdfProcessingChoice(false)}
              >
                <CardContent sx={{ textAlign: 'center', p: 3 }}>
                  <PlayArrowIcon sx={{ fontSize: 48, color: 'success.main', mb: 2 }} />
                  <Typography variant="h6" gutterBottom>
                    Simple OCR
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    For standard documents with clear, linear layout. Faster processing with automatic table detection.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6}>
              <Card
                sx={{
                  cursor: 'pointer',
                  border: '2px solid transparent',
                  '&:hover': {
                    border: '2px solid #1976d2',
                    bgcolor: 'primary.50'
                  }
                }}
                onClick={() => handlePdfProcessingChoice(true)}
              >
                <CardContent sx={{ textAlign: 'center', p: 3 }}>
                  <SearchIcon sx={{ fontSize: 48, color: 'warning.main', mb: 2 }} />
                  <Typography variant="h6" gutterBottom>
                    Zone Mapping
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    For complex BOMs or documents with irregular layouts. Manual zone selection for precise extraction.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setPdfChoiceDialogOpen(false)}
            color="secondary"
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* Primary Column Cleanup Dialog */}
      <Dialog
        open={primaryColumnDialogOpen}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ScienceIcon color="primary" />
          <Typography variant="h6" fontWeight="600">Select Primary Column</Typography>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select the column that should always have data. Rows where this column is empty
            will be removed (cleans up merged cells, notes, and junk rows).
          </Typography>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Primary Column</InputLabel>
            <Select
              value={selectedPrimaryColumn}
              label="Primary Column"
              onChange={(e) => setSelectedPrimaryColumn(e.target.value)}
            >
              {primaryColumnHeaders.map(h => (
                <MenuItem key={h} value={h}>{h}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {cleanupResult && (
            <Alert severity="success" sx={{ mt: 2 }}>
              Removed {cleanupResult.rows_deleted} empty rows ({cleanupResult.total_rows_before} → {cleanupResult.total_rows_after} rows)
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleSkipCleanup} color="inherit">
            Skip
          </Button>
          <Button
            onClick={handleCleanup}
            variant="contained"
            disabled={!selectedPrimaryColumn || cleanupLoading}
            startIcon={cleanupLoading ? <CircularProgress size={16} /> : null}
          >
            {cleanupLoading ? 'Cleaning...' : 'Clean & Continue'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Global Loader Overlay */}
      <LoaderOverlay visible={globalLoading} label="Processing..." />
    </Container>
  );
};

export default UploadFiles;
