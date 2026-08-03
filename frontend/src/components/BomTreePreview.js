// BOM tree preview for the Export BOM dialog.
//  - Compact (default): a high-level 2-level summary — the finished good, its
//    level-1 items; each sub-assembly just says "N raw materials", and a long list
//    of direct raw materials is capped with a "+N more" node. Nothing to click.
//  - Full screen: the complete, collapsible drill-down tree (click to expand).
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';
import { Box, Typography, CircularProgress, Button } from '@mui/material';
import api from '../services/api';

const KIND_STYLE = {
  root:      { background: '#1e293b', border: '1px solid #0f172a', color: '#ffffff' },
  fg:        { background: '#ffffff', border: '1px solid #9ca3af', color: '#111827' },
  sfg:       { background: '#93c5fd', border: '1px solid #3b82f6', color: '#0b3b6f' },
  ssfg:      { background: '#bbf7d0', border: '1px solid #22c55e', color: '#14532d' },
  component: { background: '#fde047', border: '1px solid #eab308', color: '#713f12' },
  alternate: { background: '#d1d5db', border: '1px solid #9ca3af', color: '#374151' },
  more:      { background: '#f1f5f9', border: '1px dashed #94a3b8', color: '#475569' },
};

const NODE_W = 200;
const H_GAP = 26;
const V_GAP = 120;
const COMPACT_LEAF_CAP = 4;

function countRaw(node) {
  if (!node.children || !node.children.length) return node.kind === 'component' ? 1 : 0;
  return node.children.reduce((s, c) => s + countRaw(c), 0);
}

// Build the trimmed 2-level tree for the compact view.
function buildCompact(root) {
  const kids = [];
  const level1 = root.children || [];
  const assemblies = level1.filter((c) => (c.children || []).some((g) => g.kind !== 'alternate'));
  const leaves = level1.filter((c) => !(c.children || []).some((g) => g.kind !== 'alternate'));
  assemblies.forEach((a) => {
    const n = countRaw(a);
    kids.push({ ...a, children: [], subtitle: `${n} raw material${n === 1 ? '' : 's'}` });
  });
  leaves.slice(0, COMPACT_LEAF_CAP).forEach((r) => kids.push({ ...r, children: [] }));
  if (leaves.length > COMPACT_LEAF_CAP) {
    kids.push({ id: `${root.id}-more`, label: `+${leaves.length - COMPACT_LEAF_CAP} more raw materials`, kind: 'more', children: [] });
  }
  return { ...root, children: kids };
}

function allIds(node, acc = new Set()) {
  acc.add(node.id);
  (node.children || []).forEach((c) => allIds(c, acc));
  return acc;
}

function layout(root, expanded) {
  const nodes = [];
  const edges = [];
  let nextLeaf = 0;

  function walk(node, depth, parentId) {
    const kids = node.children || [];
    const hasKids = kids.length > 0;
    const isOpen = expanded.has(node.id);
    const childXs = (hasKids && isOpen) ? kids.map((c) => walk(c, depth + 1, node.id)) : [];
    const x = childXs.length ? (childXs[0] + childXs[childXs.length - 1]) / 2 : (nextLeaf++) * (NODE_W + H_GAP);

    const st = KIND_STYLE[node.kind] || KIND_STYLE.component;
    const qty = (node.qty !== null && node.qty !== undefined && node.qty !== '') ? ` (${node.qty})` : '';
    const bom = node.bomId ? `\nBOM ID: ${node.bomId}` : '';
    const subtitle = node.subtitle ? `\n${node.subtitle}` : '';
    const cue = hasKids ? (isOpen ? '  ▾' : `  ▸ ${kids.length}`) : '';
    nodes.push({
      id: node.id,
      position: { x, y: depth * V_GAP },
      data: { label: `${node.label}${qty}${bom}${subtitle}${cue}`, hasKids },
      style: {
        ...st, width: NODE_W, borderRadius: 8, fontSize: 11, padding: '8px 10px',
        whiteSpace: 'pre-line', textAlign: 'center', fontWeight: 600,
        cursor: hasKids ? 'pointer' : 'default',
      },
      sourcePosition: 'bottom',
      targetPosition: 'top',
    });
    if (parentId) edges.push({ id: `${parentId}-${node.id}`, source: parentId, target: node.id, type: 'smoothstep' });
    return x;
  }
  walk(root, 0, null);
  return { nodes, edges };
}

export default function BomTreePreview({ sessionId, height = 460, fullscreen = false }) {
  const [tree, setTree] = useState(null);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const rfRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api.getDemoBomTree(sessionId)
      .then((r) => {
        if (!alive) return;
        setTree(r.data?.tree || null);
        setMeta({ file: r.data?.file, truncated: r.data?.truncated });
        setLoading(false);
      })
      .catch(() => { if (alive) { setError('No BOM preview is available for this input yet.'); setLoading(false); } });
    return () => { alive = false; };
  }, [sessionId]);

  // Compact view = trimmed 2-level tree (all shown). Full screen = full tree, drill-down.
  const displayTree = useMemo(() => {
    if (!tree) return null;
    return fullscreen ? tree : buildCompact(tree);
  }, [tree, fullscreen]);

  useEffect(() => {
    if (!displayTree) return;
    // Compact: show everything (it's small). Full screen: start high-level (root open).
    setExpanded(fullscreen ? new Set([displayTree.id]) : allIds(displayTree));
  }, [displayTree, fullscreen]);

  const { nodes, edges } = useMemo(
    () => (displayTree ? layout(displayTree, expanded) : { nodes: [], edges: [] }),
    [displayTree, expanded],
  );

  useEffect(() => {
    if (rfRef.current) {
      const id = setTimeout(() => rfRef.current && rfRef.current.fitView({ duration: 300, padding: 0.2 }), 60);
      return () => clearTimeout(id);
    }
  }, [nodes.length]);

  const onNodeClick = useCallback((_e, node) => {
    if (!fullscreen || !node?.data?.hasKids) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
      return next;
    });
  }, [fullscreen]);

  if (loading) return <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: height }}><CircularProgress /></Box>;
  if (error || !tree) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: height, color: '#94a3b8' }}>
        <Typography variant="body2">{error || 'No BOM structure to preview.'}</Typography>
      </Box>
    );
  }
  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">
          {fullscreen ? 'Click a box to expand / collapse. Scroll to zoom, drag to pan.' : 'High-level view — open full screen to drill into every raw material.'}
        </Typography>
      </Box>
      <Box sx={{ height, border: '1px solid #e5e7eb', borderRadius: 2, bgcolor: '#fafafa' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onInit={(inst) => { rfRef.current = inst; }}
          onNodeClick={onNodeClick}
          fitView
          minZoom={0.05}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} color="#e5e7eb" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </Box>
      <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {[['#ffffff', 'Finished good'], ['#93c5fd', 'Sub-assembly'], ['#bbf7d0', 'Sub-sub-assembly'], ['#fde047', 'Raw material'], ['#d1d5db', 'Alternate']].map(([c, label]) => (
          <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 12, height: 12, bgcolor: c, border: '1px solid #9ca3af', borderRadius: 0.5 }} />
            <Typography variant="caption" color="text.secondary">{label}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
