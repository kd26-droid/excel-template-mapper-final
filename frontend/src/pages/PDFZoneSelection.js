import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  ToggleButtonGroup,
  ToggleButton,
  Alert,
  CircularProgress,
  Chip,
  Stack,
  FormControlLabel,
  RadioGroup,
  Radio,
  Checkbox,
  TextField
} from '@mui/material';
import {
  CheckCircle as CheckIcon,
  Delete as DeleteIcon,
  ArrowForward as ArrowForwardIcon,
  CropFree as CropIcon,
  ContentCopy as ContentCopyIcon,
  TableChart as TableChartIcon
} from '@mui/icons-material';
import { Canvas, Rect, Image as FabricImage, Text } from 'fabric';
import api from '../services/api';

const ZONE_TYPES = {
  table: { label: 'Table', color: '#2196F3' }
};

export default function PDFZoneSelection() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fromBomNormalizer = Boolean(location.state?.fromBomNormalizer);
  const returnToUpload = Boolean(location.state?.returnToUpload);

  // 'columns' = a box per column (precise, needs naming)
  // 'table'   = one box around the whole table, columns read from the
  //             PDF's own ruling lines, so nothing needs naming
  const [zoneMode, setZoneMode] = useState('columns');
  const [session, setSession] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pages, setPages] = useState([]);
  const [zones, setZones] = useState([]);
  const [selectedZoneType, setSelectedZoneType] = useState('table');
  const [canvas, setCanvas] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [pageImageLoading, setPageImageLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [mergeWrapped, setMergeWrapped] = useState(false);
  const [columnNames, setColumnNames] = useState({}); // zone_id -> name
  const [skipTopRows, setSkipTopRows] = useState(0);
  const [selectedZone, setSelectedZone] = useState(null);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const selectedZoneTypeRef = useRef('table');
  // Background image mapping metrics
  const bgScaleRef = useRef(1);
  const bgWidthRef = useRef(null);
  const bgHeightRef = useRef(null);

  // Load PDF session
  useEffect(() => {
    loadSession();
  }, [sessionId]);

  // Initialize canvas when page changes
  useEffect(() => {
    if (pages.length > 0 && containerRef.current) {
      initializeCanvas();
    }
  }, [currentPage, pages]);

  const loadSession = async () => {
    try {
      setLoading(true);
      const response = await api.getPDFSession(sessionId);
      setSession(response.data);
      setPages(response.data.pages || []);
      setLoading(false);
    } catch (err) {
      console.error('Error loading session:', err);
      setError('Failed to load PDF session');
      setLoading(false);
    }
  };

  const initializeCanvas = () => {
    if (!canvasRef.current) return;

    // Clear existing canvas
    if (canvas) {
      canvas.dispose();
    }

    // Create new canvas
    const newCanvas = new Canvas(canvasRef.current, {
      selection: true,
      backgroundColor: '#f5f5f5'
    });

    // Let corner handles resize width and height independently (no locked aspect
    // ratio). The edge handles already stretch a single axis.
    newCanvas.uniformScaling = false;

    // Set canvas size - make it much larger for better visibility
    const containerWidth = containerRef.current.clientWidth;
    const canvasWidth = Math.min(containerWidth - 40, 1400);
    const canvasHeight = Math.floor(canvasWidth * 1.414); // A4 ratio

    newCanvas.setDimensions({
      width: canvasWidth,
      height: canvasHeight
    });

    // Load page image
    loadPageImage(newCanvas, canvasWidth, canvasHeight);

    // Enable drawing mode
    let isDrawing = false;
    let rect = null;
    let startX, startY;

    newCanvas.on('mouse:down', (options) => {
      if (options.target && options.target.zoneData) {
        // Clicked on existing zone - select it and show label
        setSelectedZone(options.target.zoneData);
        showLabelForZone(newCanvas, options.target.zoneData);
        return;
      }

      // Clicked on empty space - deselect and hide all labels
      setSelectedZone(null);
      hideAllLabels(newCanvas);

      // Start drawing new zone
      isDrawing = true;
      const pointer = newCanvas.getPointer(options.e);
      startX = pointer.x;
      startY = pointer.y;

      rect = new Rect({
        left: startX,
        top: startY,
        width: 0,
        height: 0,
        fill: 'transparent',
        stroke: ZONE_TYPES[selectedZoneTypeRef.current].color,
        strokeWidth: 3,
        selectable: true,
        hasControls: true
      });

      newCanvas.add(rect);
    });

    newCanvas.on('mouse:move', (options) => {
      if (!isDrawing || !rect) return;

      // Auto-scroll the page when the cursor nears the top/bottom of the window,
      // so you can drag a tall zone down (or up) past the visible area.
      const nativeEvt = options.e;
      if (nativeEvt && typeof nativeEvt.clientY === 'number') {
        const edge = 70;
        if (nativeEvt.clientY > window.innerHeight - edge) {
          window.scrollBy(0, 22);
        } else if (nativeEvt.clientY < edge) {
          window.scrollBy(0, -22);
        }
      }

      const pointer = newCanvas.getPointer(options.e);

      const width = pointer.x - startX;
      const height = pointer.y - startY;

      if (width < 0) {
        rect.set({ left: pointer.x });
      }
      if (height < 0) {
        rect.set({ top: pointer.y });
      }

      rect.set({
        width: Math.abs(width),
        height: Math.abs(height)
      });

      newCanvas.renderAll();
    });

    newCanvas.on('mouse:up', () => {
      if (isDrawing && rect) {
        // Save zone - use ref to get current zone type
        const zoneData = {
          zone_id: `zone_${Date.now()}`,
          page_number: currentPage,
          zone_type: selectedZoneTypeRef.current,
          coordinates: {
            x: Math.max(0, Math.round(rect.left * (pages[currentPage - 1]?.width / (bgWidthRef.current || canvasWidth)))),
            y: Math.max(0, Math.round(rect.top * (pages[currentPage - 1]?.height / (bgHeightRef.current || canvasHeight)))),
            width: Math.max(1, Math.round(rect.width * (pages[currentPage - 1]?.width / (bgWidthRef.current || canvasWidth)))),
            height: Math.max(1, Math.round(rect.height * (pages[currentPage - 1]?.height / (bgHeightRef.current || canvasHeight))))
          }
        };


        rect.zoneData = zoneData;

        // Disable controls initially
        rect.set({
          hasControls: false,
          hasBorders: true,
          selectable: true
        });

        // Add label (hidden by default)
        addZoneLabel(newCanvas, rect, zoneData);

        setZones(prev => [...prev, zoneData]);
      }

      isDrawing = false;
      rect = null;
    });

    // Handle selection - show controls and label
    newCanvas.on('selection:created', (e) => {
      if (e.selected && e.selected[0] && e.selected[0].zoneData) {
        const selectedObj = e.selected[0];
        selectedObj.set('hasControls', true);
        setSelectedZone(selectedObj.zoneData);
        showLabelForZone(newCanvas, selectedObj.zoneData);
        newCanvas.renderAll();
      }
    });

    newCanvas.on('selection:updated', (e) => {
      if (e.selected && e.selected[0] && e.selected[0].zoneData) {
        const selectedObj = e.selected[0];
        selectedObj.set('hasControls', true);
        setSelectedZone(selectedObj.zoneData);
        showLabelForZone(newCanvas, selectedObj.zoneData);
        newCanvas.renderAll();
      }
    });

    newCanvas.on('selection:cleared', () => {
      // Hide all controls and labels when nothing is selected
      const objects = newCanvas.getObjects();
      objects.forEach(obj => {
        if (obj.zoneData) {
          obj.set('hasControls', false);
        }
      });
      setSelectedZone(null);
      hideAllLabels(newCanvas);
      newCanvas.renderAll();
    });

    setCanvas(newCanvas);

    return () => {
      newCanvas.dispose();
    };
  };

  const loadPageImage = async (canvas, canvasWidth, canvasHeight) => {
    let objectUrl = null;
    // The first request for a page renders it server-side and can take ~13s. Without
    // this the user stares at an empty grey canvas with no indication anything is
    // happening. A warm page returns in well under a second, so this flashes by.
    setPageImageLoading(true);
    try {
      const response = await api.getPDFPageImage(sessionId, currentPage);
      objectUrl = URL.createObjectURL(response.data);

      FabricImage.fromURL(objectUrl).then((img) => {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        if (!img) {
          console.error('Failed to load image');
          setError('Failed to load PDF page image');
          return;
        }

        // Scale image to fit canvas
        const scaleX = canvasWidth / img.width;
        const scaleY = canvasHeight / img.height;
        const scale = Math.min(scaleX, scaleY);

        img.scale(scale);
        img.selectable = false;
        img.evented = false;
        img.set({ left: 0, top: 0, originX: 'left', originY: 'top' });

        // Store background image scaled dimensions for accurate coord mapping
        const bgWidth = img.width * scale;
        const bgHeight = img.height * scale;
        bgScaleRef.current = scale;
        bgWidthRef.current = bgWidth;
        bgHeightRef.current = bgHeight;

        // Fabric.js v6 API: Set backgroundImage property directly
        canvas.backgroundImage = img;
        canvas.renderAll();

        // Load existing zones for this page
        loadExistingZones(canvas, canvasWidth, canvasHeight);
        setPageImageLoading(false);
      }).catch((err) => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        console.error('Error loading PDF page image into canvas:', err);
        setError('Failed to load PDF page image');
        setPageImageLoading(false);
      });
    } catch (err) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      console.error('Error loading page image:', err);
      setError('Failed to load PDF page image');
      setPageImageLoading(false);
    }
  };

  const loadExistingZones = (canvas, canvasWidth, canvasHeight) => {
    const pageZones = zones.filter(z => z.page_number === currentPage);
    const page = pages[currentPage - 1];

    pageZones.forEach(zoneData => {
      const rect = new Rect({
        left: zoneData.coordinates.x * ((bgWidthRef.current || canvasWidth) / page.width),
        top: zoneData.coordinates.y * ((bgHeightRef.current || canvasHeight) / page.height),
        width: zoneData.coordinates.width * ((bgWidthRef.current || canvasWidth) / page.width),
        height: zoneData.coordinates.height * ((bgHeightRef.current || canvasHeight) / page.height),
        fill: 'transparent',
        stroke: ZONE_TYPES[zoneData.zone_type].color,
        strokeWidth: 3,
        selectable: true,
        hasControls: false,  // Hidden by default
        hasBorders: true
      });

      rect.zoneData = zoneData;
      canvas.add(rect);
      addZoneLabel(canvas, rect, zoneData);  // Label is hidden by default
    });

    canvas.renderAll();
  };

  const addZoneLabel = (canvas, rect, zoneData) => {
    const label = new Text(ZONE_TYPES[zoneData.zone_type].label, {
      left: rect.left + 5,
      top: rect.top + 5,
      fontSize: 14,
      fill: '#fff',
      backgroundColor: ZONE_TYPES[zoneData.zone_type].color,
      padding: 3,
      selectable: false,
      evented: false,
      visible: false  // Hidden by default
    });

    // Mark label with zoneData and isLabel flag
    label.zoneData = zoneData;
    label.isLabel = true;


    canvas.add(label);
  };

  const hideAllLabels = (canvas) => {
    if (!canvas) return;
    const objects = canvas.getObjects();
    objects.forEach(obj => {
      if (obj.isLabel) {
        obj.set('visible', false);
      }
    });
    canvas.renderAll();
  };

  const showLabelForZone = (canvas, zoneData) => {
    if (!canvas || !zoneData) return;

    // First hide all labels
    hideAllLabels(canvas);

    // Then show only the label for this zone
    const objects = canvas.getObjects();
    objects.forEach(obj => {
      if (obj.isLabel && obj.zoneData && obj.zoneData.zone_id === zoneData.zone_id) {
        obj.set('visible', true);
      }
    });
    canvas.renderAll();
  };

  // Delete a specific zone (defaults to the selected one). Taking the zone
  // explicitly avoids acting on a stale selection when deleting from the sidebar.
  const deleteSelectedZone = (zoneArg = null) => {
    const zone = zoneArg || selectedZone;
    if (!zone) return;

    setZones(prev => prev.filter(z => z.zone_id !== zone.zone_id));

    if (canvas) {
      const toRemove = canvas.getObjects().filter(
        obj => obj.zoneData && obj.zoneData.zone_id === zone.zone_id
      );
      toRemove.forEach(obj => canvas.remove(obj));
      canvas.discardActiveObject();
      canvas.renderAll();
    }

    if (!zoneArg || (selectedZone && selectedZone.zone_id === zone.zone_id)) {
      setSelectedZone(null);
    }
  };

  // Select a zone from the sidebar: highlight it on the canvas too.
  const selectZoneFromList = (zone) => {
    setSelectedZone(zone);
    if (!canvas) return;
    const obj = canvas.getObjects().find(o => o.zoneData && o.zoneData.zone_id === zone.zone_id);
    if (obj) {
      canvas.setActiveObject(obj);
      canvas.renderAll();
    }
  };

  // Press Delete or Backspace to remove the selected zone (unless typing in a field).
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return;
      if (selectedZone) {
        e.preventDefault();
        deleteSelectedZone(selectedZone);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedZone, canvas]);

  // Return the current page's zones with coordinates synced from the canvas, so
  // freshly drawn or moved rectangles are captured before we clone them.
  const currentPageZonesFromCanvas = () => {
    const page = pages[currentPage - 1];
    return zones
      .filter(z => z.page_number === currentPage)
      .map(zoneData => {
        const rectObj = canvas
          ? canvas.getObjects().find(obj => obj.zoneData && obj.zoneData.zone_id === zoneData.zone_id)
          : null;
        if (rectObj && page) {
          return {
            ...zoneData,
            coordinates: {
              x: Math.max(0, Math.round(rectObj.left * (page.width / (bgWidthRef.current || canvas.width)))),
              y: Math.max(0, Math.round(rectObj.top * (page.height / (bgHeightRef.current || canvas.height)))),
              width: Math.max(10, Math.round(rectObj.width * (rectObj.scaleX || 1) * (page.width / (bgWidthRef.current || canvas.width)))),
              height: Math.max(10, Math.round(rectObj.height * (rectObj.scaleY || 1) * (page.height / (bgHeightRef.current || canvas.height))))
            }
          };
        }
        return zoneData;
      });
  };

  // Copy the column zones drawn on this page onto every other page. BOM-style
  // PDFs repeat the same column layout on all pages, so drawing once and
  // replicating avoids redrawing the same boxes 15 more times. Other pages are
  // overwritten so the layout stays uniform and re-clicking is idempotent.
  const replicateColumnsToAllPages = () => {
    const sourceZones = currentPageZonesFromCanvas();
    if (sourceZones.length === 0) {
      setError('Draw at least one zone on this page before copying to all pages');
      return;
    }

    const sourcePage = pages[currentPage - 1];
    const clones = [];
    let stamp = Date.now();

    pages.forEach(targetPage => {
      if (targetPage.page_number === currentPage) return;
      // Scale coordinates in case a page has different dimensions (usually identical).
      const sx = sourcePage && sourcePage.width ? (targetPage.width / sourcePage.width) : 1;
      const sy = sourcePage && sourcePage.height ? (targetPage.height / sourcePage.height) : 1;
      sourceZones.forEach((z, idx) => {
        clones.push({
          zone_id: `zone_${stamp++}_p${targetPage.page_number}_${idx}`,
          page_number: targetPage.page_number,
          zone_type: z.zone_type,
          coordinates: {
            x: Math.round(z.coordinates.x * sx),
            y: Math.round(z.coordinates.y * sy),
            width: Math.round(z.coordinates.width * sx),
            height: Math.round(z.coordinates.height * sy)
          }
        });
      });
    });

    // Keep this page's zones (with synced coords), replace every other page's.
    setZones([...sourceZones, ...clones]);
    setError(null);
    setSuccessMessage(
      `Copied ${sourceZones.length} zone(s) to ${pages.length - 1} other page(s).`
    );
  };

  // Sync current-page rect positions from the canvas into the zones array,
  // then persist. Shared by both processing modes.
  const syncAndSaveZones = async () => {
    const updatedZones = zones.map(zoneData => {
      if (!canvas) return zoneData;
      const rectObj = canvas.getObjects().find(obj => obj.zoneData && obj.zoneData.zone_id === zoneData.zone_id);
      if (rectObj) {
        const page = pages[currentPage - 1];
        return {
          ...zoneData,
          coordinates: {
            x: Math.max(0, Math.round(rectObj.left * (page.width / (bgWidthRef.current || canvas.width)))),
            y: Math.max(0, Math.round(rectObj.top * (page.height / (bgHeightRef.current || canvas.height)))),
            width: Math.max(10, Math.round(rectObj.width * (rectObj.scaleX || 1) * (page.width / (bgWidthRef.current || canvas.width)))),
            height: Math.max(10, Math.round(rectObj.height * (rectObj.scaleY || 1) * (page.height / (bgHeightRef.current || canvas.height))))
          }
        };
      }
      return zoneData;
    });
    await api.createOrUpdatePDFZones(sessionId, updatedZones);
    return updatedZones;
  };

  const continueAfterProcessing = (payload = {}) => {
    if (fromBomNormalizer) {
      navigate('/bom-normaliser', {
        state: {
          fromPdfZone: true,
          pdfSessionId: sessionId,
          pdfZonePayload: payload,
        },
      });
      return;
    }
    if (returnToUpload) {
      navigate('/upload', {
        state: {
          fromPdfZoneReview: true,
          pdfSessionId: sessionId,
          pdfZonePayload: payload,
          sourceFileName: location.state?.sourceFileName || session?.filename || 'PDF source',
        },
      });
      return;
    }
    navigate(`/mapping/${sessionId}`);
  };

  const processZones = async () => {
    if (zones.length === 0) {
      setError('Please draw at least one zone');
      return;
    }

    try {
      setProcessing(true);
      setError(null);
      const updatedZones = await syncAndSaveZones();
      const response = await api.processPDFZones(sessionId, updatedZones.map(z => z.zone_id));
      continueAfterProcessing(response.data || {});
    } catch (err) {
      console.error('Error processing zones:', err);
      setError(err.response?.data?.error || 'Failed to process zones. Please try again.');
      setProcessing(false);
    }
  };

  // Treat the drawn zones as COLUMNS and extract by word position: blanks are
  // preserved, rows stay aligned, and page headers/footers outside the zones are
  // excluded. Best for text (non-scanned) PDFs with cleanly aligned columns.
  const processColumnZones = async () => {
    if (zones.length === 0) {
      setError('Draw a box around each column first');
      return;
    }
    try {
      setProcessing(true);
      setError(null);
      await syncAndSaveZones();
      // Column names in left-to-right order (from this page's boxes by x).
      const orderedPageZones = zones
        .filter(z => z.page_number === currentPage)
        .slice()
        .sort((a, b) => (a.coordinates?.x || 0) - (b.coordinates?.x || 0));
      const columnLabels = orderedPageZones.map((_, i) => (columnNames[i] || '').trim());
      const response = await api.processPDFColumnZones(sessionId, {
        mergeWrapped,
        columnLabels,
        skipTopRows: Number(skipTopRows) || 0,
        zoneMode
      });
      const d = response.data || {};
      if (d.words_outside_columns > 0) {
        setSuccessMessage(
          `Extracted ${d.row_count} rows into ${d.column_count} columns. ` +
          `${d.words_outside_columns} words fell outside your columns — widen the zones if that looks wrong.`
        );
      }
      continueAfterProcessing(d);
    } catch (err) {
      console.error('Error extracting column zones:', err);
      setError(err.response?.data?.error || 'Could not read the table. If your PDF is a scan, use "Extract with OCR (scanned PDF)" instead.');
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error && !zones.length) {
    return (
      <Box p={3}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        Mark the columns in your PDF
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Draw a box around each column of data (leave out the page title and page numbers). If your
        PDF has the same layout on every page, mark the columns once and apply them to all pages.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {successMessage && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Sidebar */}
        <Grid item xs={12} md={3}>
          <Stack spacing={2}>
            {/* Page Navigation */}
            {pages.length > 1 && (
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Pages ({pages.length})
                </Typography>
                <Stack spacing={1}>
                  {pages.map((page) => (
                    <Button
                      key={page.page_number}
                      variant={currentPage === page.page_number ? 'contained' : 'outlined'}
                      size="small"
                      onClick={() => setCurrentPage(page.page_number)}
                    >
                      Page {page.page_number}
                    </Button>
                  ))}
                </Stack>
              </Paper>
            )}

            {/* Zone List */}
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Zones ({zones.length})
              </Typography>
              <Stack spacing={1}>
                {zones.map((zone) => {
                  const isSelected = selectedZone && selectedZone.zone_id === zone.zone_id;
                  return (
                    <Chip
                      key={zone.zone_id}
                      label={`${ZONE_TYPES[zone.zone_type].label} - Page ${zone.page_number}`}
                      size="small"
                      color={zone.zone_type === 'header' ? 'success' : 'primary'}
                      variant={isSelected ? 'filled' : 'outlined'}
                      onClick={() => selectZoneFromList(zone)}
                      onDelete={() => deleteSelectedZone(zone)}
                      sx={isSelected ? { outline: '2px solid #1565c0', fontWeight: 700 } : { cursor: 'pointer' }}
                    />
                  );
                })}
              </Stack>
            </Paper>

            {/* Actions */}
            <Stack spacing={1}>
              {selectedZone && (
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => deleteSelectedZone()}
                >
                  Delete Zone
                </Button>
              )}

              {pages.length > 1 && zones.some(z => z.page_number === currentPage) && (
                <Button
                  variant="outlined"
                  color="primary"
                  startIcon={<ContentCopyIcon />}
                  onClick={replicateColumnsToAllPages}
                  disabled={processing}
                >
                  Use these columns on every page
                </Button>
              )}

              {/* What the boxes mean. Explicit, because the same drawing can be
                  read two completely different ways. */}
              <Box sx={{ border: '1px solid #e0e0e0', borderRadius: 1, p: 1.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 1 }}>
                  What are you marking?
                </Typography>
                <RadioGroup value={zoneMode} onChange={(e) => setZoneMode(e.target.value)}>
                  <FormControlLabel
                    value="table"
                    control={<Radio size="small" />}
                    label={
                      <Box>
                        <Typography variant="body2">The whole table</Typography>
                        <Typography variant="caption" color="text.secondary">
                          One box around the table. Columns are read from the PDF — no naming needed.
                        </Typography>
                      </Box>
                    }
                  />
                  <FormControlLabel
                    value="columns"
                    control={<Radio size="small" />}
                    label={
                      <Box>
                        <Typography variant="body2">Each column separately</Typography>
                        <Typography variant="caption" color="text.secondary">
                          One box per column. Use when the table has no borders.
                        </Typography>
                      </Box>
                    }
                  />
                </RadioGroup>
              </Box>

              {/* Name each column (optional), left to right, for this page. */}
              {zoneMode === 'columns' && zones.filter(z => z.page_number === currentPage).length > 0 && (
                <Box sx={{ border: '1px solid #e0e0e0', borderRadius: 1, p: 1.5 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 1 }}>
                    Name your columns (left to right) — optional
                  </Typography>
                  <Stack spacing={1}>
                    {zones
                      .filter(z => z.page_number === currentPage)
                      .slice()
                      .sort((a, b) => (a.coordinates?.x || 0) - (b.coordinates?.x || 0))
                      .map((z, i) => (
                        <TextField
                          key={z.zone_id}
                          size="small"
                          label={`Column ${i + 1}`}
                          placeholder={`e.g. ${['PartNo', 'Count', 'Description', 'Manufacturer', 'MPN', 'RoHS'][i] || 'Name'}`}
                          value={columnNames[i] || ''}
                          onChange={(e) => setColumnNames(prev => ({ ...prev, [i]: e.target.value }))}
                        />
                      ))}
                  </Stack>
                </Box>
              )}

              <FormControlLabel
                control={<Checkbox size="small" checked={mergeWrapped} onChange={(e) => setMergeWrapped(e.target.checked)} />}
                label="Join rows that wrap onto more than one line"
                sx={{ '& .MuiFormControlLabel-label': { fontSize: 13 } }}
              />

              <TextField
                size="small"
                type="number"
                label="Skip top rows (drop a captured header)"
                InputProps={{ inputProps: { min: 0 } }}
                value={skipTopRows}
                onChange={(e) => setSkipTopRows(e.target.value)}
                helperText="e.g. 2 if the page title/header got captured as data"
              />

              <Button
                variant="contained"
                color="primary"
                size="large"
                startIcon={<TableChartIcon />}
                onClick={processColumnZones}
                disabled={processing || zones.length === 0}
              >
                {processing ? 'Reading table...' : (zoneMode === 'table' ? 'Extract table (text PDF)' : 'Extract columns (text PDF)')}
              </Button>

              <Button
                variant="outlined"
                color="primary"
                startIcon={<ArrowForwardIcon />}
                onClick={processZones}
                disabled={processing || zones.length === 0}
              >
                {processing ? 'Processing...' : 'Extract with OCR (scanned PDF)'}
              </Button>
            </Stack>
          </Stack>
        </Grid>

        {/* Canvas */}
        <Grid item xs={12} md={9}>
          <Paper
            ref={containerRef}
            sx={{
              p: 2,
              backgroundColor: '#e0e0e0',
              minHeight: '600px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-start',
              position: 'relative'
            }}
          >
            {/* Rendered after the canvas, never before it: Fabric replaces the
                canvas node with its own wrapper, and a React sibling inserted ahead
                of it makes React lose track of the DOM position. */}
            <canvas ref={canvasRef} />
            {pageImageLoading && (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1.5,
                  backgroundColor: 'rgba(224,224,224,0.85)',
                  zIndex: 2,
                  pointerEvents: 'none',
                }}
              >
                <CircularProgress size={30} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Preparing page {currentPage}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Rendering at full resolution so your boxes line up accurately.
                </Typography>
              </Box>
            )}
          </Paper>

          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                <strong>How to do it:</strong>
                <br />
                1. Draw a box around each column (e.g. one for Part Number, one for Description, one for Supplier).
                <br />
                2. If every page looks the same, click "Use these columns on every page".
                <br />
                3. Click "Extract table (text PDF)". If your PDF is a scan (you can't select its text),
                use "Extract with OCR" instead.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
