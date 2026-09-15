export const VISUAL_TEACH_NO_SPLIT = '__no_split__';

const FACTWISE_PARSE_FIELD_KEYS = [
  'cpn',
  'mpn',
  'manufacturer',
  'description',
  'quantity',
  'uom',
  'level',
  'parent',
  'notes',
  'internalNotes',
];

const VISUAL_TEACH_INTERPRETATION_ROLES = new Set([
  ...FACTWISE_PARSE_FIELD_KEYS,
  'alternateList',
  'insertionMarker',
  'groupSeparator',
  'ignore',
]);

const fmt = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const emptyFactwiseFieldValues = () => FACTWISE_PARSE_FIELD_KEYS.reduce((fields, field) => {
  fields[field] = '';
  return fields;
}, {});

// UI identity comes from the backend occurrence, not merely the Excel row.
export const fieldPatternSampleKey = (sample = {}) => fmt(
  sample?.sourceFragment?.id || sample?.occurrenceId || sample?.sourceRow
);

// Workflow steps identify the exact backend occurrence to render. A source row
// can contain several independent fragments, so row number alone is ambiguous.
export const fieldPatternSampleForWorkflowStep = (group = {}, step = {}) => {
  const samples = Array.isArray(group?.samples) ? group.samples : [];
  const preferredOccurrenceId = fmt(
    step?.interpretationRef || step?.interpretation?.occurrenceId
  );
  if (preferredOccurrenceId) {
    const exact = samples.find(
      (sample) => fieldPatternSampleKey(sample) === preferredOccurrenceId
    );
    if (exact) return exact;
  }

  const occurrenceIds = new Set(
    (Array.isArray(step?.occurrences) ? step.occurrences : [])
      .map((occurrence) => fmt(occurrence?.id))
      .filter(Boolean)
  );
  if (occurrenceIds.size) {
    const exact = samples.find((sample) => occurrenceIds.has(fieldPatternSampleKey(sample)));
    if (exact) return exact;
  }

  return samples[0] || null;
};

// Visibility is backend-owned. The UI must not reinterpret this using layout
// selections or the fields it happens to have rendered locally.
export const visualTeachAllowsAlternates = (context = {}) => Boolean(
  context?.workflowStep?.hasAlternateList || context?.group?.hasAlternateList
);

// Display-only: backend source offsets become per-character colors.
export const visualTeachTagsFromInterpretationSpans = (text = '', spans = []) => {
  const tags = new Array(String(text || '').length).fill('');
  (Array.isArray(spans) ? spans : []).forEach((span) => {
    const role = fmt(span?.role);
    if (!VISUAL_TEACH_INTERPRETATION_ROLES.has(role)) return;
    const start = Math.max(0, Math.min(tags.length, Number(span?.start) || 0));
    const end = Math.max(start, Math.min(tags.length, Number(span?.end) || 0));
    for (let index = start; index < end; index += 1) tags[index] = role;
  });
  return tags;
};

// Repeating an explicitly selected separator is a selection convenience only.
export const shouldRepeatVisualTeachGroupSeparator = (selectedText = '') => {
  const text = String(selectedText || '');
  if (!text.trim()) return false;
  if (text.length > 1) return true;
  return [']', ';', '|', '\n', '\r'].includes(text);
};

export const clearVisualTeachTagSelection = (tags = [], selection = null) => {
  const next = Array.isArray(tags) ? [...tags] : [];
  if (!selection || !next.length) return next;

  const anchor = Number(selection.start);
  const focus = Number(selection.end);
  if (!Number.isFinite(anchor) || !Number.isFinite(focus)) return next;

  const start = Math.max(0, Math.min(anchor, focus));
  const end = Math.min(next.length - 1, Math.max(anchor, focus));
  for (let index = start; index <= end; index += 1) next[index] = '';
  return next;
};

// Adapt backend rows to the editable table's display shape without parsing.
export const normalizeVisualTeachEntries = (entries = []) => (
  (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({
      relation: entry?.relation || (index === 0 ? 'Primary' : `Alternate ${index}`),
      fields: {
        ...emptyFactwiseFieldValues(),
        ...(entry?.fields || {}),
      },
      sourceColumns: entry?.sourceColumns || {},
    }))
    .filter((entry) => FACTWISE_PARSE_FIELD_KEYS.some((field) => fmt(entry.fields?.[field])))
    .map((entry, index) => ({
      ...entry,
      relation: index === 0 ? 'Primary' : `Alternate ${index}`,
    }))
);
