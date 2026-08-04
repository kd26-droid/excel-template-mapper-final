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
const COMPACT_CHILD_CAP = 3;
const COMPACT_ALT_CAP = 3;

function isAssembly(node) {
  return ['root', 'fg', 'sfg', 'ssfg'].includes(node?.kind);
}

function directChildCounts(children = []) {
  const rawMaterials = children.filter((child) => child.kind === 'component').length;
  const subBoms = children.filter(isAssembly).length;
  return { rawMaterials, subBoms, total: rawMaterials + subBoms };
}

function buildCompact(root) {
  function compactNode(node) {
    const children = node.children || [];
    const childCounts = isAssembly(node) ? directChildCounts(children) : node.childCounts;

    if (node.kind === 'component') {
      const alternates = children.filter((child) => child.kind === 'alternate');
      const shownAlternates = alternates.slice(0, COMPACT_ALT_CAP).map((child) => ({ ...child, children: [] }));
      if (alternates.length > COMPACT_ALT_CAP) {
        shownAlternates.push({
          id: `${node.id}-more-alts`,
          label: `+${alternates.length - COMPACT_ALT_CAP} more alternates`,
          kind: 'more',
          children: alternates.slice(COMPACT_ALT_CAP).map((child) => ({ ...child, children: [] }))
        });
      }
      return { ...node, children: shownAlternates };
    }

    const assemblies = children.filter(isAssembly).map(compactNode);
    const rawMaterials = children.filter((child) => child.kind === 'component');
    const shownRawMaterials = rawMaterials.slice(0, COMPACT_CHILD_CAP).map(compactNode);

    if (rawMaterials.length > COMPACT_CHILD_CAP) {
      shownRawMaterials.push({
        id: `${node.id}-more-raw`,
        label: `+${rawMaterials.length - COMPACT_CHILD_CAP} more raw materials`,
        kind: 'more',
        children: rawMaterials.slice(COMPACT_CHILD_CAP).map(compactNode)
      });
    }

    return { ...node, childCounts, children: [...shownRawMaterials, ...assemblies] };
  }

  return compactNode(root);
}

function describeChildCounts(counts) {
  if (!counts || !counts.total) return '';
  const parts = [];
  if (counts.rawMaterials) parts.push(`${counts.rawMaterials} RM`);
  if (counts.subBoms) parts.push(`${counts.subBoms} SB`);
  return `${parts.join(', ')} (${counts.total})`;
}

function nodeSubtitle(node) {
  const lines = [];
  if (node.level !== null && node.level !== undefined && node.level !== '') {
    lines.push(`Level ${node.level}`);
  }
  if (isAssembly(node)) {
    const counts = node.childCounts || directChildCounts(node.children || []);
    const description = describeChildCounts(counts);
    if (description) lines.push(description);
  }
  return lines.join('\n');
}

function visibleCompactIds(node, acc = new Set()) {
  acc.add(node.id);
  (node.children || []).forEach((child) => {
    if (child.kind !== 'more') visibleCompactIds(child, acc);
  });
  return acc;
}

function getTreeStats(node, depth = 0) {
  if (!node) return { totalNodes: 0, maxDepth: 0, moreGroups: 0 };
  return (node.children || []).reduce((acc, child) => {
    const childStats = getTreeStats(child, depth + 1);
    return {
      totalNodes: acc.totalNodes + childStats.totalNodes,
      maxDepth: Math.max(acc.maxDepth, childStats.maxDepth),
      moreGroups: acc.moreGroups + childStats.moreGroups,
    };
  }, {
    totalNodes: 1,
    maxDepth: depth,
    moreGroups: node.kind === 'more' ? 1 : 0,
  });
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
    const subtitleText = node.subtitle || nodeSubtitle(node);
    const subtitle = subtitleText ? `\n${subtitleText}` : '';
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

export default function BomTreePreview({ sessionId, height = 460, fullscreen = false, onRequestFullscreen }) {
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
    api.getBomTree(sessionId)
      .then((r) => {
        if (!alive) return;
        setTree(r.data?.tree || null);
        setMeta({
          file: r.data?.file,
          source: r.data?.source,
          bomCount: r.data?.bomCount,
          finishedGoods: r.data?.finishedGoods,
          truncated: r.data?.truncated
        });
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

  const treeStats = useMemo(() => getTreeStats(displayTree), [displayTree]);
  const shouldSuggestFullscreen = !fullscreen && (
    treeStats.totalNodes > 28 ||
    treeStats.maxDepth > 4 ||
    treeStats.moreGroups > 0 ||
    Number(meta.bomCount || 0) > 3
  );

  useEffect(() => {
    if (!displayTree) return;
    // Compact: show everything (it's small). Full screen: start high-level (root open).
    setExpanded(fullscreen ? new Set([displayTree.id]) : visibleCompactIds(displayTree));
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
    if (!node?.data?.hasKids) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
      return next;
    });
  }, []);

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
        {meta.bomCount ? (
          <Typography variant="caption" color="text.secondary">
            {meta.bomCount} BOM{meta.bomCount === 1 ? '' : 's'} from {meta.source === 'source' ? 'uploaded sheet' : meta.source === 'grid' ? 'current grid' : 'export sheet'}
          </Typography>
        ) : null}
      </Box>
      {shouldSuggestFullscreen ? (
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: 1,
          px: 1,
          py: 0.75,
          border: '1px solid #bfdbfe',
          borderRadius: 1,
          bgcolor: '#eff6ff'
        }}>
          <Typography variant="caption" sx={{ color: '#1d4ed8', fontWeight: 600 }}>
            Large BOM detected. Full screen is easier for this tree.
          </Typography>
          {onRequestFullscreen ? (
            <Button size="small" onClick={onRequestFullscreen} sx={{ minWidth: 0, px: 1, py: 0.25, fontSize: 11, fontWeight: 700 }}>
              Full screen
            </Button>
          ) : null}
        </Box>
      ) : null}
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
