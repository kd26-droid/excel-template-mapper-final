export const ITEM_DIRECTORY_DEFAULTS_KEY = 'factwise.itemDirectoryDefaults.v1';

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
    defaultValue: 'prefix_sequence',
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
