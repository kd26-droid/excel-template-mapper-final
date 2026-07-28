import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Position,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';
import * as XLSX from 'xlsx';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';

const DEMO_WORKBOOK_PATH = '/demo-bom-preview.xlsx';

const NODE_STYLES = {
  root: {
    background: '#f7f8fa',
    border: '#8f98a3',
    color: '#20242a',
  },
  bom: {
    background: '#64aef2',
    border: '#1f6fb5',
    color: '#102235',
  },
  raw: {
    background: '#ffe45c',
    border: '#b99a00',
    color: '#332a00',
  },
  alternate: {
    background: '#cfd5dc',
    border: '#838c96',
    color: '#23282f',
  },
};

const fmt = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const getRowValue = (row, headers, name) => {
  const index = headers.indexOf(name);
  return index >= 0 ? fmt(row[index]) : '';
};

const BomNode = ({ data, selected }) => {
  const style = NODE_STYLES[data.kind] || NODE_STYLES.raw;

  return (
    <Box
      sx={{
        minWidth: data.kind === 'root' ? 190 : 170,
        maxWidth: data.kind === 'root' ? 230 : 210,
        minHeight: data.kind === 'alternate' ? 58 : 76,
        px: 1.4,
        py: 1,
        border: `1.5px solid ${style.border}`,
        borderRadius: '6px',
        background: style.background,
        color: style.color,
        boxShadow: selected ? `0 0 0 3px ${style.border}33` : '0 8px 18px rgba(25, 31, 38, 0.10)',
        textAlign: 'center',
        fontFamily: 'Inter, Roboto, Arial, sans-serif',
      }}
    >
      <Typography
        sx={{
          fontSize: data.kind === 'root' ? 14 : 13,
          fontWeight: 800,
          lineHeight: 1.25,
          wordBreak: 'break-word',
        }}
      >
        {data.label}
      </Typography>
      {data.subLabel && (
        <Typography sx={{ mt: 0.6, fontSize: 12, lineHeight: 1.25, wordBreak: 'break-word' }}>
          {data.subLabel}
        </Typography>
      )}
      {data.quantity && (
        <Typography sx={{ mt: 0.5, fontSize: 12, fontWeight: 700 }}>
          {data.quantity} {data.uom || 'pcs'}
        </Typography>
      )}
    </Box>
  );
};

const nodeTypes = { bomNode: BomNode };

const parseWorkbook = (arrayBuffer) => {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => fmt(cell) === 'Finished good code') &&
    row.some((cell) => fmt(cell) === 'Raw material code')
  );

  if (headerIndex < 0) {
    throw new Error('Could not find the FactWise BOM header row.');
  }

  const headers = rows[headerIndex].map(fmt);
  const alternateCodeIndexes = headers
    .map((header, index) => (header === 'Alternate raw material code' ? index : -1))
    .filter((index) => index >= 0);

  return rows
    .slice(headerIndex + 1)
    .map((row, rowIndex) => {
      const alternates = alternateCodeIndexes
        .map((codeIndex) => ({
          code: fmt(row[codeIndex]),
          quantity: fmt(row[codeIndex + 2]),
          uom: fmt(row[codeIndex + 3]),
        }))
        .filter((alternate) => alternate.code);

      return {
        id: `bom-${rowIndex + 1}`,
        finishedGoodCode: getRowValue(row, headers, 'Finished good code'),
        bomId: getRowValue(row, headers, 'BOM ID'),
        bomName: getRowValue(row, headers, 'BOM name'),
        baseQuantity: getRowValue(row, headers, 'Base quantity'),
        bomUom: getRowValue(row, headers, 'BOM measurement unit'),
        level: getRowValue(row, headers, 'Level') || '1',
        rawMaterialCode: getRowValue(row, headers, 'Raw material code'),
        description: getRowValue(row, headers, 'Description'),
        quantity: getRowValue(row, headers, 'Quantity'),
        measurementUnit: getRowValue(row, headers, 'Measurement unit'),
        alternates,
      };
    })
    .filter((row) => row.finishedGoodCode || row.rawMaterialCode || row.bomName);
};

const makeNode = (id, kind, position, data) => ({
  id,
  type: 'bomNode',
  position,
  sourcePosition: Position.Bottom,
  targetPosition: Position.Top,
  data: { kind, ...data },
});

const makeEdge = (id, source, target) => ({
  id,
  source,
  target,
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#66717f' },
  style: { stroke: '#9aa3ad', strokeWidth: 1.6 },
});

const buildGraph = (bomRows, searchTerm) => {
  const query = searchTerm.trim().toLowerCase();
  const visibleRows = query
    ? bomRows.filter((row) => {
        const text = [
          row.finishedGoodCode,
          row.bomId,
          row.bomName,
          row.rawMaterialCode,
          row.description,
          ...row.alternates.map((alternate) => alternate.code),
        ].join(' ').toLowerCase();
        return text.includes(query);
      })
    : bomRows;

  const columns = query ? 3 : 4;
  const groupWidth = 650;
  const groupHeight = 640;
  const boardWidth = Math.max(columns * groupWidth, 900);
  const rootX = boardWidth / 2 - 100;
  const nodes = [
    makeNode('root', 'root', { x: rootX, y: 20 }, {
      label: 'BOM 5 Preview',
      subLabel: `${visibleRows.length} BOM rows`,
      quantity: `${bomRows.reduce((total, row) => total + 1 + row.alternates.length, 0)} MPNs`,
      uom: '',
      details: {
        Type: 'Demo workbook',
        Rows: bomRows.length,
        Visible: visibleRows.length,
      },
    }),
  ];
  const edges = [];

  visibleRows.forEach((row, index) => {
    const lane = index % columns;
    const shelf = Math.floor(index / columns);
    const baseX = lane * groupWidth + 95;
    const baseY = 220 + shelf * groupHeight;
    const bomId = `bom-${index}`;
    const rawId = `raw-${index}`;

    nodes.push(makeNode(bomId, 'bom', { x: baseX + 140, y: baseY }, {
      label: row.finishedGoodCode || row.bomId || `BOM ${index + 1}`,
      subLabel: `Level ${row.level} | BOM ID: ${row.bomId || row.finishedGoodCode || '-'}`,
      quantity: row.baseQuantity || '1',
      uom: row.bomUom || row.measurementUnit,
      details: {
        'Finished good code': row.finishedGoodCode,
        'BOM ID': row.bomId,
        'BOM name': row.bomName,
        Level: row.level,
        'Base quantity': row.baseQuantity,
        UOM: row.bomUom || row.measurementUnit,
      },
    }));
    edges.push(makeEdge(`root-${bomId}`, 'root', bomId));

    nodes.push(makeNode(rawId, 'raw', { x: baseX + 140, y: baseY + 135 }, {
      label: row.rawMaterialCode || 'Raw material',
      subLabel: row.description,
      quantity: row.quantity,
      uom: row.measurementUnit,
      details: {
        'Raw material code': row.rawMaterialCode,
        Description: row.description,
        Quantity: row.quantity,
        UOM: row.measurementUnit,
        Alternates: row.alternates.length,
      },
    }));
    edges.push(makeEdge(`${bomId}-${rawId}`, bomId, rawId));

    row.alternates.forEach((alternate, alternateIndex) => {
      const alternateId = `alt-${index}-${alternateIndex}`;
      const altCol = alternateIndex % 3;
      const altRow = Math.floor(alternateIndex / 3);
      nodes.push(makeNode(alternateId, 'alternate', {
        x: baseX + altCol * 185,
        y: baseY + 275 + altRow * 92,
      }, {
        label: alternate.code,
        subLabel: `Alternate ${alternateIndex + 1}`,
        quantity: alternate.quantity || row.quantity,
        uom: alternate.uom || row.measurementUnit,
        details: {
          'Alternate raw material code': alternate.code,
          'Alternate quantity': alternate.quantity || row.quantity,
          'Alternate UOM': alternate.uom || row.measurementUnit,
          'Main raw material': row.rawMaterialCode,
          'BOM ID': row.bomId,
        },
      }));
      edges.push(makeEdge(`${rawId}-${alternateId}`, rawId, alternateId));
    });
  });

  return { nodes, edges, visibleRows };
};

const LegendDot = ({ color, border, label }) => (
  <Stack direction="row" alignItems="center" spacing={1}>
    <Paper
      elevation={0}
      sx={{
        width: 18,
        height: 18,
        borderRadius: '4px',
        bgcolor: color,
        border: `1px solid ${border}`,
      }}
    />
    <Typography sx={{ fontSize: 13, color: '#3d4854' }}>{label}</Typography>
  </Stack>
);

const BomPreviewInner = () => {
  const [bomRows, setBomRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);

  useEffect(() => {
    let mounted = true;

    const loadWorkbook = async () => {
      try {
        const response = await fetch(DEMO_WORKBOOK_PATH);
        if (!response.ok) {
          throw new Error(`Preview workbook could not be loaded (${response.status}).`);
        }
        const buffer = await response.arrayBuffer();
        const parsedRows = parseWorkbook(buffer);
        if (mounted) {
          setBomRows(parsedRows);
          setSelectedNode(null);
        }
      } catch (err) {
        if (mounted) setError(err.message || 'Failed to load BOM preview.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadWorkbook();
    return () => {
      mounted = false;
    };
  }, []);

  const { nodes, edges, visibleRows } = useMemo(
    () => buildGraph(bomRows, searchTerm),
    [bomRows, searchTerm]
  );

  const totalMpns = useMemo(
    () => bomRows.reduce((total, row) => total + 1 + row.alternates.length, 0),
    [bomRows]
  );

  const maxAlternates = useMemo(
    () => bomRows.reduce((max, row) => Math.max(max, row.alternates.length), 0),
    [bomRows]
  );

  const handleNodeClick = useCallback((_, node) => {
    setSelectedNode(node);
  }, []);

  const handleNodeHover = useCallback((_, node) => {
    setSelectedNode(node);
  }, []);

  return (
    <Box sx={{ height: '100vh', width: '100vw', bgcolor: '#eef1f4', display: 'flex', overflow: 'hidden' }}>
      <Box sx={{ width: 330, bgcolor: '#ffffff', borderRight: '1px solid #d8dde3', p: 2.2, overflowY: 'auto' }}>
        <Typography sx={{ fontSize: 22, fontWeight: 800, color: '#1f2933' }}>
          BOM Preview
        </Typography>
        <Typography sx={{ mt: 0.5, fontSize: 13, color: '#65717d', lineHeight: 1.45 }}>
          Interactive demo view generated from the current FactWise BOM workbook.
        </Typography>

        <TextField
          fullWidth
          size="small"
          placeholder="Search BOM, MPN, description"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          sx={{ mt: 2 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />

        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 2 }}>
          <Chip label={`${bomRows.length} BOM rows`} size="small" />
          <Chip label={`${totalMpns} MPNs`} size="small" />
          <Chip label={`${maxAlternates} max alternates`} size="small" />
          {searchTerm && <Chip label={`${visibleRows.length} visible`} color="primary" size="small" />}
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Stack spacing={1}>
          <LegendDot color={NODE_STYLES.root.background} border={NODE_STYLES.root.border} label="Preview root" />
          <LegendDot color={NODE_STYLES.bom.background} border={NODE_STYLES.bom.border} label="Finished good / BOM row" />
          <LegendDot color={NODE_STYLES.raw.background} border={NODE_STYLES.raw.border} label="Main raw material" />
          <LegendDot color={NODE_STYLES.alternate.background} border={NODE_STYLES.alternate.border} label="Alternate raw material" />
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#27313c' }}>
          Selected details
        </Typography>
        {selectedNode ? (
          <Stack spacing={1} sx={{ mt: 1.2 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 800, wordBreak: 'break-word' }}>
              {selectedNode.data.label}
            </Typography>
            {selectedNode.data.subLabel && (
              <Typography sx={{ fontSize: 12.5, color: '#586472', lineHeight: 1.45 }}>
                {selectedNode.data.subLabel}
              </Typography>
            )}
            {Object.entries(selectedNode.data.details || {}).map(([key, value]) => (
              <Box key={key}>
                <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: '#7b8794', textTransform: 'uppercase' }}>
                  {key}
                </Typography>
                <Typography sx={{ fontSize: 13, color: '#1f2933', wordBreak: 'break-word' }}>
                  {fmt(value) || '-'}
                </Typography>
              </Box>
            ))}
          </Stack>
        ) : (
          <Typography sx={{ mt: 1.2, fontSize: 13, color: '#65717d', lineHeight: 1.45 }}>
            Click any node on the board to inspect its BOM, quantity, UOM, and alternate details.
          </Typography>
        )}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {loading && (
          <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
            <Stack alignItems="center" spacing={1.5}>
              <CircularProgress size={28} />
              <Typography sx={{ color: '#65717d' }}>Loading preview workbook...</Typography>
            </Stack>
          </Box>
        )}

        {!loading && error && (
          <Box sx={{ p: 3 }}>
            <Alert severity="error">{error}</Alert>
          </Box>
        )}

        {!loading && !error && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            onNodeMouseEnter={handleNodeHover}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.08}
            maxZoom={1.8}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
          >
            <Background color="#aeb6bf" gap={48} size={1.5} />
            <MiniMap
              nodeStrokeWidth={2}
              pannable
              zoomable
              style={{ width: 170, height: 110, borderRadius: 6, overflow: 'hidden' }}
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </Box>
    </Box>
  );
};

const BomPreview = () => (
  <ReactFlowProvider>
    <BomPreviewInner />
  </ReactFlowProvider>
);

export default BomPreview;
