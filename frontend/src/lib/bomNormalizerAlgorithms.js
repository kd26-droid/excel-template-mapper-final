const fmt = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

export const BASE_NORMALIZED_EXPORT_COLUMNS = [
  'sourceRow',
  'parentKey',
  // The BOM parent, when the sheet states it outright. Distinct from parentKey,
  // which groups a part with its alternate manufacturers. Blank on sheets that
  // only indent by level, where the tree is derived from `level` instead.
  'parent',
  'relation',
  'level',
  'cpn',
  'description',
  'mpn',
  'manufacturer',
  'quantity',
  'uom',
  'Notes',
  'Internal notes',
  'Item code',
  'rule',
  'confidence',
  'discardedText',
];

export const getNormalizedExportColumns = (rows = []) => {
  const columns = [...BASE_NORMALIZED_EXPORT_COLUMNS];
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (key === 'factwiseId') return;
      if (!columns.includes(key)) columns.push(key);
    });
  });
  return columns;
};

export const getNextTagColumn = (rows = []) => {
  const tagNumbers = new Set();
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      const match = key.match(/^Tag_(\d+)$/i);
      if (match) tagNumbers.add(Number(match[1]));
    });
  });

  let next = 1;
  while (tagNumbers.has(next)) next += 1;
  return `Tag_${next}`;
};

const joinValues = (values, separator) => values
  .map(fmt)
  .filter(Boolean)
  .join(separator);

const serialValue = ({ prefix = '', start = 1, padding = 0, increment = true }, index) => {
  const base = Number(start) || 1;
  const current = increment ? base + index : base;
  const digits = Math.max(0, Number(padding) || 0);
  return `${prefix || ''}${String(current).padStart(digits, '0')}`;
};

export const createFactwiseIds = (rows = [], options = {}) => {
  const {
    mode = 'columns',
    firstColumn = '',
    secondColumn = '',
    separator = '_',
    prefix = 'ITEM-',
    start = 1,
    padding = 4,
    increment = true,
    applyMode = 'overwrite',
    targetColumn = 'Item code',
  } = options;

  return rows.map((row, index) => {
    const currentValue = fmt(row[targetColumn] || row.itemCode);
    if (applyMode === 'fill_empty' && currentValue) return row;

    const nextValue = mode === 'serial'
      ? serialValue({ prefix, start, padding, increment }, index)
      : joinValues([row[firstColumn], row[secondColumn]], separator);

    return {
      ...row,
      [targetColumn]: nextValue,
    };
  });
};

export const createTagColumn = (rows = [], options = {}) => {
  const {
    targetColumn = getNextTagColumn(rows),
    mode = 'source',
    sourceColumn = 'manufacturer',
    defaultValue = '',
    rules = [],
    applyMode = 'overwrite',
  } = options;

  return rows.map((row) => {
    const currentValue = fmt(row[targetColumn]);
    if (applyMode === 'fill_empty' && currentValue) return row;

    if (mode === 'rules') {
      const validRules = rules.filter((rule) => fmt(rule.sourceColumn || sourceColumn) && fmt(rule.searchText) && fmt(rule.outputValue));
      const matchedRule = validRules.find((rule) => {
        const sourceText = fmt(row[rule.sourceColumn || sourceColumn]);
        const searchText = fmt(rule.searchText);
        return rule.caseSensitive
          ? sourceText.includes(searchText)
          : sourceText.toLowerCase().includes(searchText.toLowerCase());
      });

      return {
        ...row,
        [targetColumn]: matchedRule ? fmt(matchedRule.outputValue) : '',
      };
    }

    return {
      ...row,
      [targetColumn]: mode === 'default' ? fmt(defaultValue) : fmt(row[sourceColumn]),
    };
  });
};

export const getSerialPreviewValues = (options = {}, count = 3) => {
  const {
    prefix = '',
    start = 1,
    padding = 0,
    increment = true,
  } = options;

  return Array.from({ length: count }, (_, index) => (
    serialValue({ prefix, start, padding, increment }, index)
  ));
};
