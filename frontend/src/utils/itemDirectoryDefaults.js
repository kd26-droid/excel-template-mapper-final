export const ITEM_DIRECTORY_DEFAULTS_KEY = 'factwise.itemDirectoryDefaults.v1';
export const ITEM_DIRECTORY_COLUMN_OPTIONS_KEY = 'factwise.itemDirectoryColumnOptions.v1';

export const DEFAULT_ITEM_DIRECTORY_COLUMN_OPTIONS = [
  'Item code',
  'SAP Item ID',
  'CPN Code',
  'MPN Code',
  'HSN Code',
  'Item name',
  'Description',
  'Item type',
  'Measurement unit',
];

export const ITEM_DIRECTORY_DEFAULTS = [
  {
    key: 'procurementEntityName',
    field: 'Procurement entity name',
    label: 'Procurement entity name',
    type: 'text',
    placeholder: 'Example: FactWise Manufacturing',
  },
  {
    key: 'itemType',
    field: 'Item type',
    label: 'Item type',
    type: 'itemType',
  },
  {
    key: 'procurementItem',
    field: 'Procurement item',
    label: 'Procurement item',
    type: 'boolean',
  },
  {
    key: 'salesItem',
    field: 'Sales item',
    label: 'Sales item',
    type: 'boolean',
  },
  {
    key: 'itemCodePrefix',
    field: 'Item code',
    label: 'Item code prefix',
    type: 'text',
    placeholder: 'Example: RM',
  },
  {
    key: 'itemCodeContentType',
    field: 'Item code',
    label: 'How to set the value',
    type: 'text',
    defaultValue: 'serial',
  },
  {
    key: 'itemCodeRowsToUpdate',
    field: 'Item code',
    label: 'Rows to update',
    type: 'text',
    defaultValue: 'fill_empty',
  },
  {
    key: 'itemCodeDefaultValue',
    field: 'Item code',
    label: 'Default value',
    type: 'text',
  },
  {
    key: 'itemCodeCopyFromColumn',
    field: 'Item code',
    label: 'Copy from',
    type: 'text',
  },
  {
    key: 'itemCodeJoinFirstColumn',
    field: 'Item code',
    label: 'First column',
    type: 'text',
  },
  {
    key: 'itemCodeJoinSecondColumn',
    field: 'Item code',
    label: 'Second column',
    type: 'text',
  },
  {
    key: 'itemCodeJoinSeparatorMode',
    field: 'Item code',
    label: 'Separator',
    type: 'text',
    defaultValue: 'space',
  },
  {
    key: 'itemCodeJoinCustomSeparator',
    field: 'Item code',
    label: 'Custom separator',
    type: 'text',
  },
  {
    key: 'itemCodeConditionSourceColumn',
    field: 'Item code',
    label: 'Condition source column',
    type: 'text',
  },
  {
    key: 'itemCodeConditionalBranches',
    field: 'Item code',
    label: 'If / else conditions',
    type: 'array',
    defaultValue: [],
  },
  {
    key: 'itemCodeConditionOperator',
    field: 'Item code',
    label: 'Condition',
    type: 'text',
    defaultValue: 'contains',
  },
  {
    key: 'itemCodeConditionText',
    field: 'Item code',
    label: 'Condition text',
    type: 'text',
  },
  {
    key: 'itemCodeConditionValueSource',
    field: 'Item code',
    label: 'Then value source',
    type: 'text',
    defaultValue: 'default',
  },
  {
    key: 'itemCodeConditionDefaultValue',
    field: 'Item code',
    label: 'Then default value',
    type: 'text',
  },
  {
    key: 'itemCodeConditionValueColumn',
    field: 'Item code',
    label: 'Then value column',
    type: 'text',
  },
  {
    key: 'itemCodeElseValueSource',
    field: 'Item code',
    label: 'Otherwise value source',
    type: 'text',
    defaultValue: 'default',
  },
  {
    key: 'itemCodeElseDefaultValue',
    field: 'Item code',
    label: 'Otherwise default value',
    type: 'text',
  },
  {
    key: 'itemCodeElseValueColumn',
    field: 'Item code',
    label: 'Otherwise value column',
    type: 'text',
  },
  {
    key: 'itemCodeBlankStrategy',
    field: 'Item code',
    label: 'Blank item codes',
    type: 'itemCodeStrategy',
    defaultValue: 'prefix_sequence',
  },
  {
    key: 'itemCodeDuplicateStrategy',
    field: 'Item code',
    label: 'Duplicate item codes',
    type: 'itemCodeDuplicateStrategy',
    defaultValue: 'leave',
  },
  {
    key: 'itemCodeSeparator',
    field: 'Item code',
    label: 'Item code separator',
    type: 'text',
    defaultValue: '-',
  },
  {
    key: 'itemCodeStart',
    field: 'Item code',
    label: 'Start number',
    type: 'number',
    defaultValue: '1',
  },
  {
    key: 'itemCodePadding',
    field: 'Item code',
    label: 'Number padding',
    type: 'number',
    defaultValue: '3',
  },
  {
    key: 'itemCodeIncrement',
    field: 'Item code',
    label: 'Increment for each row',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'measurementUnit',
    field: 'Measurement unit',
    label: 'Measurement unit',
    type: 'measurementUnit',
    placeholder: 'Example: EA',
  },
];

export const emptyItemDirectoryDefaults = ITEM_DIRECTORY_DEFAULTS.reduce((acc, item) => ({
  ...acc,
  [item.key]: item.defaultValue || '',
}), {});

export const readItemDirectoryDefaults = () => {
  if (typeof window === 'undefined') return emptyItemDirectoryDefaults;
  try {
    const saved = JSON.parse(window.localStorage.getItem(ITEM_DIRECTORY_DEFAULTS_KEY) || '{}');
    return {
      ...emptyItemDirectoryDefaults,
      ...(saved && typeof saved === 'object' ? saved : {}),
    };
  } catch {
    return emptyItemDirectoryDefaults;
  }
};

export const writeItemDirectoryDefaults = (defaults) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ITEM_DIRECTORY_DEFAULTS_KEY, JSON.stringify({
    ...emptyItemDirectoryDefaults,
    ...(defaults || {}),
  }));
};

export const normalizeItemDirectoryColumnOptions = (columns = []) => {
  const seen = new Set();
  return [...DEFAULT_ITEM_DIRECTORY_COLUMN_OPTIONS, ...(Array.isArray(columns) ? columns : [])]
    .map(value => String(value ?? '').trim())
    .filter(value => {
      if (!value || seen.has(value.toLowerCase())) return false;
      seen.add(value.toLowerCase());
      return true;
    });
};

export const readItemDirectoryColumnOptions = () => {
  if (typeof window === 'undefined') return normalizeItemDirectoryColumnOptions();
  try {
    const saved = JSON.parse(window.localStorage.getItem(ITEM_DIRECTORY_COLUMN_OPTIONS_KEY) || '[]');
    return normalizeItemDirectoryColumnOptions(saved);
  } catch {
    return normalizeItemDirectoryColumnOptions();
  }
};

export const writeItemDirectoryColumnOptions = (columns) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    ITEM_DIRECTORY_COLUMN_OPTIONS_KEY,
    JSON.stringify(normalizeItemDirectoryColumnOptions(columns))
  );
};
