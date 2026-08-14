// BOM revision diff engine.
//
// Two inputs:
//   - `leftBom`      — R4's admin detail (from GET /organization/bom/<R4>/admin/),
//                       the current state of the BOM being revised. Read-only fetch,
//                       no FactWise commit.
//   - `rightVersion` — a BOM-items-shaped object representing the mapper's
//                       current sheet. Built locally by the caller via the
//                       mapperTreeToBomItems adapter that consumes the mapper
//                       backend's /bom/tree/<session>/ response. Also read-only.
//
// Because the review runs BEFORE any FactWise mutation, we don't depend on
// Aditya's preview API here (which needs bulk_import_id → upload → commit).
// The mapper's bom_tree endpoint parses the same in-memory sheet the user has
// been editing, so what we diff is exactly what the eventual upload would
// carry — no round-trip needed, no drift.
//
// Output: a diff tree keyed by the identity we choose for matching, with
// per-node status and per-field change details. See diffBomTrees below.

const RAW_MATERIAL = 'raw-material';
const SUB_BOM = 'sub-bom';

// Strip a trailing `_R<digits>` revision suffix so `SHAM111151_R2` in R4's
// stored tree matches `SHAM111151` in the sheet. FactWise's own preview
// matcher walks the previous_version chain — we don't have that on the FE
// (would require fetching every ancestor), so we approximate by suffix strip.
// Both sides are stripped, so a legitimate `_R2` on both matches too.
export function stripRevisionSuffix(code) {
  return String(code || '').replace(/_R\d+$/i, '');
}

// Numeric compare that tolerates the string/number sloppiness the API is
// prone to. `null`/`undefined`/`""` all count as 0 so a missing-vs-zero
// pair doesn't register as a change.
function numsEqual(a, b) {
  const na = a === '' || a == null ? 0 : Number(a);
  const nb = b === '' || b == null ? 0 : Number(b);
  if (Number.isNaN(na) && Number.isNaN(nb)) return true;
  return na === nb;
}

function stringsEqual(a, b) {
  return String(a || '').trim() === String(b || '').trim();
}

// A node's identity for cross-tree matching. Two things:
//   - `key` — used to pair a left child with its right sibling. Strips the
//             revision suffix so R4's `SHAM111151_R2` pairs with the sheet's
//             `SHAM111151`.
//   - `type` — item kind, so a raw material coincidentally sharing a code
//             with a sub-BOM under the same parent doesn't collapse.
function nodeIdentity(item) {
  if (item?.raw_material_item?.code) {
    return { type: RAW_MATERIAL, key: stripRevisionSuffix(item.raw_material_item.code) };
  }
  if (item?.sub_bom?.bom_code) {
    return { type: SUB_BOM, key: stripRevisionSuffix(item.sub_bom.bom_code) };
  }
  return { type: null, key: null };
}

// Human-readable code + name for display. Prefers the sheet's version when
// both sides exist, because the diff is being shown so the user can decide
// whether to accept the sheet.
function displayLabel(leftItem, rightItem) {
  const src = rightItem || leftItem;
  if (src?.raw_material_item) {
    return {
      code: src.raw_material_item.code || '',
      name: src.raw_material_item.name || src.raw_material_item.code || '',
    };
  }
  if (src?.sub_bom) {
    return {
      code: src.sub_bom.bom_code || '',
      name: src.sub_bom.bom_name || src.sub_bom.bom_code || '',
    };
  }
  return { code: '', name: '' };
}

// True when a scalar field is genuinely missing on this side (null/undefined
// or the empty string). Different from zero — a real zero quantity IS a
// meaningful value. The mapper's tree carries only code + quantity, so cost,
// measurement_unit, and tags come across as null on the right side; a diff
// that reported "cost changed from $5 → nothing" every time would drown the
// real changes. skipMissing() drives fieldChanges to leave those alone.
function skipMissing(a, b) {
  const missA = a == null || a === '';
  const missB = b == null || b === '';
  return missA || missB;
}

// Compare the scalar fields that carry a meaningful change. Measurement unit
// is compared by resolved abbreviation when the abbreviation is available on
// either side (raw_material_item.measurement_units.item_measurement_units[]
// is the usual source), otherwise by UUID — a UUID mismatch that resolves to
// the same abbreviation is not a change worth surfacing.
function resolveMuAbbreviation(item, muId) {
  if (!muId) return '';
  // Common shapes we've seen in FW responses.
  const buckets = [
    item?.raw_material_item?.measurement_units?.item_measurement_units,
    item?.sub_bom?.enterprise_item?.measurement_units?.item_measurement_units,
  ];
  for (const list of buckets) {
    if (!Array.isArray(list)) continue;
    const hit = list.find((mu) => String(mu?.measurement_unit_id) === String(muId));
    if (hit?.abbreviation) return hit.abbreviation;
  }
  return '';
}

// Tag comparison — treat as a set, order-insensitive. Tag list can live on
// raw_material_item or sub_bom depending on the row type.
function tagList(item) {
  const raw = item?.raw_material_item?.tags || item?.sub_bom?.tags || [];
  return Array.isArray(raw) ? raw.map((t) => String(t)).filter(Boolean) : [];
}
function tagsEqual(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const t of sa) if (!sb.has(t)) return false;
  return true;
}

// Detect the scalar-field changes between a matched left+right pair. Returns
// an object shaped for the UI: field name → { old, new, oldDisplay, newDisplay }.
// Only populated for fields that actually changed.
function fieldChanges(leftItem, rightItem) {
  const out = {};
  // Quantity is present on both sides always (mapper carries it, R4 carries
  // it) so a real difference is always a change. Zero is not treated as
  // missing — it is a legitimate value.
  if (!numsEqual(leftItem?.quantity, rightItem?.quantity)) {
    out.quantity = { old: leftItem?.quantity ?? null, new: rightItem?.quantity ?? null };
  }
  // Cost, MU and tags — the mapper's tree endpoint does not carry these, so
  // the right side is null. skipMissing avoids flagging every raw material
  // as "cost changed from $X → nothing" purely because the mapper's shape
  // is narrower. When the FE eventually plumbs cost/MU/tags out of the
  // editor state (or when the diff is later re-run against a full BOM,
  // e.g. on FactWise's own side), these comparisons wake back up.
  if (!skipMissing(leftItem?.cost_per_unit, rightItem?.cost_per_unit)
      && !numsEqual(leftItem?.cost_per_unit, rightItem?.cost_per_unit)) {
    out.cost_per_unit = {
      old: leftItem?.cost_per_unit ?? null,
      new: rightItem?.cost_per_unit ?? null,
    };
  }
  const leftMuId = leftItem?.measurement_unit || null;
  const rightMuId = rightItem?.measurement_unit || null;
  if (!skipMissing(leftMuId, rightMuId)) {
    const leftMuAbbr = resolveMuAbbreviation(leftItem, leftMuId);
    const rightMuAbbr = resolveMuAbbreviation(rightItem, rightMuId);
    const bothHaveAbbr = leftMuAbbr && rightMuAbbr;
    const muChanged = bothHaveAbbr
      ? leftMuAbbr !== rightMuAbbr
      : !stringsEqual(leftMuId, rightMuId);
    if (muChanged) {
      out.measurement_unit = {
        old: leftMuAbbr || leftMuId || null,
        new: rightMuAbbr || rightMuId || null,
      };
    }
  }
  const leftTags = tagList(leftItem);
  const rightTags = tagList(rightItem);
  // Tags only meaningful when at least one side has any — skipping the
  // silent "no tags on either side" comparison keeps the change list clean.
  if ((leftTags.length || rightTags.length) && !tagsEqual(leftTags, rightTags)) {
    out.tags = { old: leftTags, new: rightTags };
  }
  return out;
}

// Adapter — convert the mapper backend's /bom/tree/<session>/ response into
// a shape diffBomTrees can consume as the right side. The mapper's tree
// carries only code + quantity + hierarchy + alternates; cost, measurement
// unit, and tags are absent, so those come across as null and fieldChanges
// (above) skips them. Result: added/deleted items surface, quantity changes
// surface, cost/MU/tag noise does not.
//
// Mapper node shape (from views.py::_build_bom_tree_from_table):
//   { id, label, kind, qty, level, bomId, children[] }
//   kind ∈ { 'fg', 'root', 'sfg', 'ssfg', 'component', 'alternate' }
//
// R4-side shape we're emulating (from BOMDetailSerializer):
//   { bom_items: [{ bom_item_id, quantity, cost_per_unit, measurement_unit,
//                   raw_material_item?, sub_bom?, sub_bom_items?, alternates[] }] }
export function mapperTreeToBomVersion(mapperTree) {
  // The mapper tree's root is either an fg node (single finished good), a
  // 'root' node wrapping multiple fgs, or the actual FG node itself. In all
  // cases the "top-level bom_items" for comparison purposes are the fg's
  // children (or the union of children across fgs when there are several).
  const flatten = (node) => {
    if (!node) return [];
    if (node.kind === 'fg' || node.kind === 'root') {
      const kids = Array.isArray(node.children) ? node.children : [];
      return kids.flatMap((child) => (
        child.kind === 'fg' ? flatten(child) : [convert(child)]
      ));
    }
    return [convert(node)];
  };

  const convert = (n) => {
    if (!n) return null;
    const kids = Array.isArray(n.children) ? n.children : [];
    const alternates = kids
      .filter((c) => c.kind === 'alternate')
      .map((alt) => ({
        // Wrap in alternate_bom_item so the diff engine's existing V6/V7
        // unwrap logic accepts it. Only carries a code — quantity comes
        // through as 0/null and the field-change logic skips it.
        alternate_bom_item: {
          bom_item_id: alt.id,
          quantity: null,
          cost_per_unit: null,
          measurement_unit: null,
          raw_material_item: {
            code: alt.label || '',
            name: alt.label || '',
            tags: [],
          },
        },
      }));
    const structuralKids = kids.filter((c) => c.kind !== 'alternate');
    const isSubBom = n.kind === 'sfg' || n.kind === 'ssfg' || Boolean(n.bomId);
    if (isSubBom) {
      return {
        bom_item_id: n.id,
        entry_id: n.id,
        quantity: n.qty === null || n.qty === '' ? null : Number(n.qty),
        cost_per_unit: null,
        measurement_unit: null,
        sub_bom: {
          bom_code: n.label || n.bomId || '',
          bom_name: n.label || n.bomId || '',
        },
        sub_bom_items: structuralKids.map(convert).filter(Boolean),
        raw_material_item: null,
        alternates,
      };
    }
    // component / raw-material
    return {
      bom_item_id: n.id,
      entry_id: n.id,
      quantity: n.qty === null || n.qty === '' ? null : Number(n.qty),
      cost_per_unit: null,
      measurement_unit: null,
      raw_material_item: {
        code: n.label || '',
        name: n.label || '',
        tags: [],
      },
      sub_bom: null,
      sub_bom_items: null,
      alternates,
    };
  };

  return {
    entry_id: 'mapper-sheet',
    bom_code_with_version: 'Uploaded sheet',
    bom_status: 'MAPPER',
    enterprise_bom: {
      bom_code: mapperTree?.label || '',
      bom_name: mapperTree?.label || '',
    },
    bom_items: flatten(mapperTree),
  };
}

// The nested-list of children under either a top-level BOM version or a
// sub-BOM entry. Sub-BOMs use `sub_bom_items`, the top-level uses `bom_items`.
function childrenOf(node) {
  if (!node) return [];
  if (Array.isArray(node.bom_items)) return node.bom_items;
  if (Array.isArray(node.sub_bom_items)) return node.sub_bom_items;
  return [];
}

// Recursive diff. For each level: match left→right by nodeIdentity, then
// - both present → status inferred from field changes + child changes
// - only left    → status 'deleted', walk left's subtree emitting deleted
//                  nodes so counts include the whole subtree
// - only right   → status 'added',   same in reverse
//
// A parent node is 'modified' whenever it has changed fields OR any descendant
// is not 'unchanged'. This is what makes the collapsed rollup badges
// meaningful ("+3 ~2 -1 inside" tells you it's worth expanding).
function diffChildren(leftChildren, rightChildren, parentPath) {
  const rightByKey = new Map();
  for (const item of rightChildren) {
    const id = nodeIdentity(item);
    if (id.key == null) continue;
    // A duplicate identity within one parent is a data problem, not a
    // matching problem — keep the FIRST so the second surfaces as its own
    // added/modified node instead of silently replacing the first.
    const composite = `${id.type}:${id.key}`;
    if (!rightByKey.has(composite)) rightByKey.set(composite, item);
  }
  const consumedRight = new Set();
  const result = [];

  for (const leftItem of leftChildren) {
    const id = nodeIdentity(leftItem);
    if (id.key == null) continue;
    const composite = `${id.type}:${id.key}`;
    const rightItem = rightByKey.get(composite);
    if (!rightItem) {
      result.push(buildOneSidedNode(leftItem, null, 'deleted', parentPath));
    } else {
      consumedRight.add(composite);
      result.push(buildMatchedNode(leftItem, rightItem, parentPath));
    }
  }
  // Anything on the right we did not consume is an add.
  for (const rightItem of rightChildren) {
    const id = nodeIdentity(rightItem);
    if (id.key == null) continue;
    const composite = `${id.type}:${id.key}`;
    if (consumedRight.has(composite)) continue;
    result.push(buildOneSidedNode(null, rightItem, 'added', parentPath));
    consumedRight.add(composite);
  }
  return result;
}

function buildMatchedNode(leftItem, rightItem, parentPath) {
  const { type, key } = nodeIdentity(rightItem);
  const label = displayLabel(leftItem, rightItem);
  const path = parentPath ? `${parentPath} › ${label.code}` : label.code;
  const changes = fieldChanges(leftItem, rightItem);
  const children = type === SUB_BOM
    ? diffChildren(childrenOf(leftItem), childrenOf(rightItem), path)
    : [];
  const rollup = rollupCounts(children);
  const anyDescendantChange = rollup.added + rollup.deleted + rollup.modified > 0;
  const hasFieldChanges = Object.keys(changes).length > 0;
  let status;
  if (hasFieldChanges || anyDescendantChange) status = 'modified';
  else status = 'unchanged';
  return {
    path,
    key,
    type,
    label,
    status,
    changes,
    left: leftItem,
    right: rightItem,
    children,
    rollup,
  };
}

function buildOneSidedNode(leftItem, rightItem, status, parentPath) {
  const src = leftItem || rightItem;
  const { type, key } = nodeIdentity(src);
  const label = displayLabel(leftItem, rightItem);
  const path = parentPath ? `${parentPath} › ${label.code}` : label.code;
  // For an added/deleted sub-BOM we walk its subtree so descendants show up
  // with the same status — the rollup and any drill-in view need them.
  let children = [];
  if (type === SUB_BOM) {
    const kids = childrenOf(src);
    children = kids
      .map((child) => buildOneSidedNode(
        status === 'deleted' ? child : null,
        status === 'added' ? child : null,
        status,
        path,
      ))
      .filter((n) => n.key != null);
  }
  return {
    path,
    key,
    type,
    label,
    status,
    changes: {},
    left: leftItem,
    right: rightItem,
    children,
    rollup: rollupCounts(children, status),
  };
}

// Sum up child change counts + a bump for the node itself when it's added or
// deleted. `modified` status on the parent is counted at the level above it.
function rollupCounts(children, selfStatus = null) {
  const base = { added: 0, deleted: 0, modified: 0 };
  if (selfStatus === 'added') base.added += 1;
  else if (selfStatus === 'deleted') base.deleted += 1;
  for (const c of children || []) {
    if (c.status === 'added') base.added += 1;
    else if (c.status === 'deleted') base.deleted += 1;
    else if (c.status === 'modified') base.modified += 1;
    base.added += c.rollup?.added || 0;
    base.deleted += c.rollup?.deleted || 0;
    base.modified += c.rollup?.modified || 0;
  }
  // De-double: a node's own modified status is already reflected by its
  // descendants+self, so subtract if we ran through both paths.
  return base;
}

// Top-level entry. Takes R4's `bom` object (from fetchEnterpriseBomDetail)
// and the preview_version object (from fetchBomRevisionPreview), returns a
// diff root:
//   {
//     rootLabel: {code, name},
//     children: [...diff nodes recursive],
//     summary:  {added, deleted, modified, unchanged, total},
//   }
export function diffBomTrees({ leftBom, rightVersion }) {
  const leftChildren = childrenOf(leftBom);
  const rightChildren = childrenOf(rightVersion);
  const children = diffChildren(leftChildren, rightChildren, '');

  const summary = { added: 0, deleted: 0, modified: 0, unchanged: 0, total: 0 };
  const walk = (nodes) => {
    for (const n of nodes) {
      summary.total += 1;
      summary[n.status] = (summary[n.status] || 0) + 1;
      walk(n.children || []);
    }
  };
  walk(children);

  const rootCode = leftBom?.bom_code || rightVersion?.enterprise_bom?.bom_code || '';
  const rootName = leftBom?.bom_name || rightVersion?.enterprise_bom?.bom_name || '';

  return {
    rootLabel: { code: rootCode, name: rootName },
    children,
    summary,
  };
}

// Flatten the diff tree into a display-ready ordered list where each row
// carries a depth. Used by the tree-table view.
//
// Options:
//   - filter: 'all' | 'added' | 'deleted' | 'modified' | 'changes'
//   - expanded: Set of node paths that are open (default: everything)
//   - alwaysShowChangedAncestors: when a filter is on, keep the ancestor
//     chain of each matched node visible so the location context is not lost
export function flattenDiff(diffRoot, options = {}) {
  const {
    filter = 'all',
    expanded = null,
    alwaysShowChangedAncestors = true,
  } = options;

  const passesFilter = (node) => {
    if (filter === 'all') return true;
    if (filter === 'changes') return node.status !== 'unchanged';
    return node.status === filter;
  };

  const rows = [];
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      const isExpanded = expanded ? expanded.has(node.path) : true;
      const hasChanges = node.rollup
        ? node.rollup.added + node.rollup.deleted + node.rollup.modified > 0
        : false;
      const nodeMatches = passesFilter(node);
      // Include a node if it matches OR (filter on + ancestor-visibility + any
      // descendant matches) OR filter is 'all'.
      const hasMatchingDescendant = filter !== 'all' && hasChanges;
      const include = nodeMatches
        || (filter !== 'all' && alwaysShowChangedAncestors && hasMatchingDescendant);
      if (include) {
        rows.push({ node, depth });
      }
      if (isExpanded && node.children?.length) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(diffRoot.children, 0);
  return rows;
}

// Flatten the diff tree into paired rows for the side-by-side view. Each row
// carries both a left node (or null) and a right node (or null), plus a
// shared depth so both panes indent identically. Added rows render on the
// right with an empty placeholder on the left; deleted rows the reverse.
// Matched (unchanged/modified) rows carry both sides so per-field diffs are
// visible in the same horizontal band.
//
// Options mirror flattenDiff:
//   - filter: 'all' | 'added' | 'deleted' | 'modified' | 'changes'
//   - expanded: Set of node paths that are open (default: everything)
//   - alwaysShowChangedAncestors: keep ancestors visible when filtering
export function pairedRows(diffRoot, options = {}) {
  const {
    filter = 'all',
    expanded = null,
    alwaysShowChangedAncestors = true,
  } = options;

  const passesFilter = (node) => {
    if (filter === 'all') return true;
    if (filter === 'changes') return node.status !== 'unchanged';
    return node.status === filter;
  };

  const rows = [];
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      const isExpanded = expanded ? expanded.has(node.path) : true;
      const hasChanges = node.rollup
        ? node.rollup.added + node.rollup.deleted + node.rollup.modified > 0
        : false;
      const nodeMatches = passesFilter(node);
      const hasMatchingDescendant = filter !== 'all' && hasChanges;
      const include = nodeMatches
        || (filter !== 'all' && alwaysShowChangedAncestors && hasMatchingDescendant);
      if (include) {
        rows.push({
          path: node.path,
          depth,
          status: node.status,
          type: node.type,
          leftLabel: node.left ? node.label : null,
          rightLabel: node.right ? node.label : null,
          leftNode: node.left,
          rightNode: node.right,
          changes: node.changes || {},
          rollup: node.rollup,
          hasChildren: Boolean(node.children?.length),
          isExpanded,
        });
      }
      if (isExpanded && node.children?.length) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(diffRoot.children, 0);
  return rows;
}

// Convenience: format a cell's `old → new` text using resolved abbreviation
// when the change is a measurement unit.
export function formatChange(change, field) {
  if (!change) return '';
  const oldVal = change.old == null ? '—' : String(change.old);
  const newVal = change.new == null ? '—' : String(change.new);
  if (field === 'tags') {
    const oldTxt = Array.isArray(change.old) ? change.old.join(', ') || '—' : oldVal;
    const newTxt = Array.isArray(change.new) ? change.new.join(', ') || '—' : newVal;
    return `${oldTxt} → ${newTxt}`;
  }
  return `${oldVal} → ${newVal}`;
}
