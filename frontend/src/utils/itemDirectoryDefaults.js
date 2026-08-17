import api from '../services/api';

// v2 drops every browser copy written by the old built-in defaults, which
// stored itemCodeContentType:'serial' + blankStrategy:'prefix_sequence' without
// anyone choosing them — indistinguishable from a real choice, and the reason
// blank item codes kept filling with 1, 2, 3. Starting from a clean key means a
// value exists only if the user saved it.
export const ITEM_DIRECTORY_DEFAULTS_KEY = 'factwise.itemDirectoryDefaults.v2';
export const ITEM_DIRECTORY_COLUMN_OPTIONS_KEY = 'factwise.itemDirectoryColumnOptions.v1';

// The built-in FactWise template's columns, in sheet order, as the internal
// field names a session's grid actually carries (Tag_2, Specification_Value_1).
// `displayHeaderName` turns them into the '(n)' labels shown everywhere else.
//
// 36, not 38: the workbook lists 'Preferred vendor code' and 'Alternate Item
// Name for Preferred Vendor' twice, for a second preferred vendor. Offering the
// same name twice in a dropdown is a choice nobody can make meaningfully, and
// pandas renames the repeat to `…__2` on read anyway.
//
// Settings is global — it has no session — so it offers these rather than the
// columns of whichever sheet happened to be open last.
export const FACTWISE_TEMPLATE_COLUMNS = [
  'Item code',
  'SAP Item ID',
  'CPN Code',
  'MPN Code',
  'HSN Code',
  'Item name',
  'Description',
  'Item type',
  'Measurement unit',
  'Alternate UoM 1',
  'Notes',
  'SAP Description',
  'Specification_Name_1', 'Specification_Value_1', 'Specification_UOM_1',
  'Specification_Name_2', 'Specification_Value_2', 'Specification_UOM_2',
  'Specification_Name_3', 'Specification_Value_3', 'Specification_UOM_3',
  'Custom_Identification_Name_1', 'Custom_Identification_Value_1',
  'Procurement item',
  'Procurement item price currency code',
  'Procurement item price',
  'Sales item',
  'Tag_1', 'Tag_2', 'Tag_3',
  'Level',
  'Quantity',
  'Base BOM Qty',
  'Procurement entity name',
  'Preferred vendor code',
  'Alternate Item Name for Preferred Vendor',
];

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
  },
  {
    key: 'itemCodeRowsToUpdate',
    field: 'Item code',
    label: 'Rows to update',
    type: 'text',
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
  },
  {
    key: 'itemCodeDuplicateStrategy',
    field: 'Item code',
    label: 'Duplicate item codes',
    type: 'itemCodeDuplicateStrategy',
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
  },
  {
    key: 'itemCodePadding',
    field: 'Item code',
    label: 'Number padding',
    type: 'number',
  },
  {
    key: 'itemCodeIncrement',
    field: 'Item code',
    label: 'Increment for each row',
    type: 'boolean',
  },
  {
    key: 'measurementUnit',
    field: 'Measurement unit',
    label: 'Measurement unit',
    type: 'measurementUnit',
    placeholder: 'Example: EA',
  },
  {
    // Saved Column Rules pinned to a column, replayed on every sheet that opens
    // in the editor. Entries are { ruleId, ruleName, targetColumn }.
    key: 'autoColumnRules',
    field: '',
    label: 'Auto-applied column rules',
    type: 'array',
    defaultValue: [],
  },
];

// Clearing the panel writes '' over every key, so the stored value is not
// always the array it was saved as.
//
// Empty rows are kept: this also backs the Settings list, and a row the user
// has just added has nothing chosen in it yet. Dropping the unfilled ones is
// `isFilledAutoColumnRule`'s job, at save and apply time.
export const normalizeAutoColumnRules = (defaults = {}) => (
  (Array.isArray(defaults?.autoColumnRules) ? defaults.autoColumnRules : [])
    .map(entry => ({
      ruleId: entry?.ruleId ?? '',
      ruleName: String(entry?.ruleName ?? '').trim(),
      targetColumn: String(entry?.targetColumn ?? '').trim(),
    }))
);

export const isFilledAutoColumnRule = (entry) => Boolean(entry?.ruleId || entry?.ruleName);

// Nothing here carries a working default. A value only exists once the user
// has entered and saved it, so an untouched install never rewrites a sheet.
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

// The browser copy is a cache, not the record. A new machine, a new deploy
// origin, or cleared site data all leave it empty while the entity's saved
// panel is sitting on the server — so read the server first and refresh the
// cache from it. Falls back to whatever is local when the call fails, which is
// what keeps the editor working offline of the settings API.
export const loadItemDirectoryDefaultsForEntity = async (entityName, entityId) => {
  const cleanName = String(entityName || '').trim();
  const cleanId = String(entityId || '').trim();
  const local = readItemDirectoryDefaults();
  if (!cleanName && !cleanId) return local;
  try {
    const response = await api.getEditorDefaultSettings(cleanName, cleanId);
    const settings = response?.data?.settings;
    if (!response?.data?.success || !settings?.updated_at) return local;
    const savedUi = settings.ui_defaults && typeof settings.ui_defaults === 'object'
      ? settings.ui_defaults
      : {};
    if (Object.keys(savedUi).length === 0) return local;
    const merged = { ...local, ...savedUi };
    writeItemDirectoryDefaults(merged);
    return merged;
  } catch (_) {
    return local;
  }
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
