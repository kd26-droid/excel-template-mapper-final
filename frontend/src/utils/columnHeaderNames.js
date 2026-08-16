// Every repeated FactWise template column has TWO names, and mixing them up is
// how tag/spec/customer data goes missing on export.
//
//   internal field  Tag_2                     unique, addresses one grid column
//   display label   Tag (2)                   what the user reads in the app
//   export header   Tag                       what FactWise's parser groups on
//
// FactWise builds column_index_map by EXACT header text: three columns all
// named "Tag" give it [i, j, k] and all three values land in item_data.tags.
// Ship "Tag (2)" instead and it becomes a separate, unrecognised column — only
// the first Tag is read and the rest are silently dropped.
//
// Rule: the app shows display labels everywhere; anything that writes a file
// derives its headers from the FIELD via canonicalHeaderName, never from a
// label. See FactwiseBulkImportErrorGrid for the same split applied to the
// error-retry sheet, and views.py `_positional_row_keys`/`_display_header` for
// the backend's equivalent.

// Internal prefix -> the exact header text FactWise expects on export.
const TEMPLATE_GROUPS = [
  ['Tag_', 'Tag'],
  ['Specification_Name_', 'Specification name'],
  ['Specification_Value_', 'Specification value'],
  ['Specification_UOM_', 'Specification UOM'],
  // FactWise calls this 'Custom identification'. The internal field says
  // 'Customer_…' for historical reasons; the export header must not.
  ['Custom_Identification_Name_', 'Custom identification name'],
  ['Custom_Identification_Value_', 'Custom identification value'],
  // Sessions saved before the rename still carry the longer spelling.
  ['Custom_Identification_Name_', 'Custom identification name'],
  ['Custom_Identification_Value_', 'Custom identification value'],
];

// Labels the app may already be carrying, mapped back to their export text.
// One word per column: FactWise's column is 'Custom identification', and the
// key, label and export header all say so — Custom_Identification_Name_1,
// 'Custom identification name (1)', 'Custom identification name'.
const CANONICAL_BY_LABEL = new Map([
  ['tag', 'Tag'],
  ['specification name', 'Specification name'],
  ['specification value', 'Specification value'],
  ['specification uom', 'Specification UOM'],
  // Every spelling this app has used resolves to the one FactWise accepts.
  ['custom identification name', 'Custom identification name'],
  ['custom identification value', 'Custom identification value'],
]);

const DISPLAY_SUFFIX_RE = /\s*\((\d+)\)\s*$/;

/**
 * Split an internal field into its template group and 1-based slot number.
 * Returns null for columns that are not part of a repeated group.
 */
function matchTemplateGroup(field) {
  const name = String(field ?? '').trim();
  for (const [prefix, canonical] of TEMPLATE_GROUPS) {
    if (name.startsWith(prefix)) {
      const index = parseInt(name.slice(prefix.length), 10);
      if (!Number.isNaN(index)) return { canonical, index };
    }
  }
  // Already-canonical or already-labelled forms: 'Tag', 'Tag (2)'.
  const withoutSuffix = name.replace(DISPLAY_SUFFIX_RE, '');
  const canonical = CANONICAL_BY_LABEL.get(withoutSuffix.toLowerCase());
  if (canonical) {
    const suffix = name.match(DISPLAY_SUFFIX_RE);
    return { canonical, index: suffix ? parseInt(suffix[1], 10) : 0 };
  }
  return null;
}

/**
 * The header text to WRITE TO A FILE for a column — repeats collapse back to
 * the shared name FactWise groups on. Use this for every export; never export
 * a display label.
 *
 * Tag_2 -> 'Tag' · 'Tag (2)' -> 'Tag' · Specification_Name_1 -> 'Specification name'
 */
export function canonicalHeaderName(field) {
  const name = String(field ?? '').trim();
  if (!name) return name;

  const group = matchTemplateGroup(name);
  if (group) return group.canonical;

  // Generic split-generated runs ("Reference Designator_1".."_33") collapse to
  // their shared base, matching what the grid export has always done. Only the
  // underscore and parenthesised forms are stripped: a trailing bare number is
  // part of the real name ('DigiKey Canonical MPN 2') and must survive.
  const parenthesised = name.match(DISPLAY_SUFFIX_RE);
  if (parenthesised) return name.replace(DISPLAY_SUFFIX_RE, '');

  const underscored = name.match(/^(.+)_(\d+)$/);
  if (underscored) return underscored[1].replace(/_/g, ' ');

  return name;
}

/**
 * The label to SHOW IN THE APP for a column. Repeated columns carry their slot
 * number so three tag columns are tellable apart instead of all reading 'Tag'.
 *
 * Tag_2 -> 'Tag (2)' · Specification_Name_1 -> 'Specification name (1)'
 *
 * `allFields` is only consulted for generic runs, where a numeric suffix means
 * "one of a set" if siblings exist and is otherwise part of the column's name.
 */
export function displayHeaderName(field, allFields = []) {
  const name = String(field ?? '').trim();
  if (!name) return name;

  const group = matchTemplateGroup(name);
  if (group) {
    return group.index ? `${group.canonical} (${group.index})` : group.canonical;
  }

  const underscored = name.match(/^(.+)_(\d+)$/);
  if (underscored) {
    const base = underscored[1];
    let siblings = 0;
    for (const other of allFields || []) {
      const m = String(other).match(/^(.+)_(\d+)$/);
      if (m && m[1] === base) siblings += 1;
    }
    if (siblings >= 2) return `${base.replace(/_/g, ' ')} (${underscored[2]})`;
  }

  return name;
}

/**
 * True when this column belongs to a repeated FactWise group, i.e. its export
 * header is deliberately shared with other columns.
 */
export function isRepeatedTemplateColumn(field) {
  return matchTemplateGroup(field) !== null;
}
