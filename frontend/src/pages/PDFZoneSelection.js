import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  Stack
} from '@mui/material';
import {
  CheckCircle as CheckIcon,
  Delete as DeleteIcon,
  ArrowForward as ArrowForwardIcon,
  CropFree as CropIcon
} from '@mui/icons-material';
import { Canvas, Rect, Image as FabricImage, Text } from 'fabric';
import api from '../services/api';

const ZONE_TYPES = {
  table: { label: 'Table', color: '#2196F3' }
};

export default function PDFZoneSelection() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pages, setPages] = useState([]);
  const [zones, setZones] = useState([]);
  const [selectedZoneType, setSelectedZoneType] = useState('table');
  const [canvas, setCanvas] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
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
    try {
      const imageUrl = `/api/pdf/page/${sessionId}/${currentPage}/`;

      FabricImage.fromURL(imageUrl).then((img) => {
        if (!img) {
          console.error('Failed to load image');
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
      });
    } catch (err) {
      console.error('Error loading page image:', err);
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

  const deleteSelectedZone = () => {
    if (!selectedZone || !canvas) return;


    // Remove from zones array
    setZones(prev => prev.filter(z => z.zone_id !== selectedZone.zone_id));

    // Remove from canvas - collect objects to remove first
    const objects = canvas.getObjects();
    const toRemove = [];

    objects.forEach(obj => {
      if (obj.zoneData && obj.zoneData.zone_id === selectedZone.zone_id) {
        toRemove.push(obj);
      }
    });

    // Remove all collected objects
    toRemove.forEach(obj => canvas.remove(obj));


    canvas.renderAll();
    setSelectedZone(null);
  };

  const processZones = async () => {
    if (zones.length === 0) {
      setError('Please draw at least one zone');
      return;
    }

    try {
      setProcessing(true);
      setError(null);

      // Update zone coordinates from canvas objects before saving
      const updatedZones = zones.map(zoneData => {
        if (!canvas) return zoneData;

        // Find the rect object for this zone
        const objects = canvas.getObjects();
        const rectObj = objects.find(obj => obj.zoneData && obj.zoneData.zone_id === zoneData.zone_id);

        if (rectObj) {
          const page = pages[currentPage - 1];
          // Update coordinates based on current rect position/size
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


      // Save zones
      const saveResp = await api.createOrUpdatePDFZones(sessionId, updatedZones);

      // Process zones
      const response = await api.processPDFZones(sessionId, updatedZones.map(z => z.zone_id));


      // Navigate to column mapping
      navigate(`/mapping/${sessionId}`);

    } catch (err) {
      console.error('Error processing zones:', err);
      setError('Failed to process zones. Please try again.');
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
        Select Table Zones
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Draw rectangles around each table (including headers). The first row will be treated as headers.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
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
                {zones.map((zone) => (
                  <Chip
                    key={zone.zone_id}
                    label={`${ZONE_TYPES[zone.zone_type].label} - Page ${zone.page_number}`}
                    size="small"
                    color={zone.zone_type === 'header' ? 'success' : 'primary'}
                    onDelete={() => {
                      setSelectedZone(zone);
                      deleteSelectedZone();
                    }}
                  />
                ))}
              </Stack>
            </Paper>

            {/* Actions */}
            <Stack spacing={1}>
              {selectedZone && (
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={deleteSelectedZone}
                >
                  Delete Zone
                </Button>
              )}

              <Button
                variant="contained"
                color="primary"
                size="large"
                startIcon={<ArrowForwardIcon />}
                onClick={processZones}
                disabled={processing || zones.length === 0}
              >
                {processing ? 'Processing...' : 'Process Zones'}
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
              alignItems: 'flex-start'
            }}
          >
            <canvas ref={canvasRef} />
          </Paper>

          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                <strong>Instructions:</strong>
                <br />
                1. Select "Header" and draw a rectangle around the table header row
                <br />
                2. Select "Table Data" and draw rectangles around data rows (can span multiple pages)
                <br />
                3. Click "Process Zones" when ready
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
