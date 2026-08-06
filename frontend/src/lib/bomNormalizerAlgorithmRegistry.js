export const ROLE_FIELDS = [
  { key: 'cpn', label: 'CPN / customer part number' },
  { key: 'mpn', label: 'MPN column' },
  { key: 'manufacturer', label: 'Manufacturer column' },
  { key: 'description', label: 'Description / item name' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'uom', label: 'UOM' },
  { key: 'level', label: 'BOM level' },
  { key: 'parent', label: 'Parent / group key' },
];

export const STRUCTURE_OPTIONS = [
  {
    value: 'mpn_only_same_cell',
    label: 'Only MPNs are present, all MPNs in one cell',
    description: 'Use this when the sheet has no manufacturer column and one MPN cell contains primary plus alternates.',
  },
  {
    value: 'mpn_only_rows',
    label: 'Only MPNs are present, each row has one MPN',
    description: 'Use this when the sheet has no manufacturer column and each row already has one MPN.',
  },
  {
    value: 'mfr_only_same_cell',
    label: 'Only MFRs are present, all MFRs in one cell',
    description: 'Use this when the sheet has manufacturer names but no MPN column, and one cell contains multiple manufacturers.',
  },
  {
    value: 'mfr_only_rows',
    label: 'Only MFRs are present, each row has one MFR',
    description: 'Use this when the sheet has no MPN column and each row already has one manufacturer.',
  },
  {
    value: 'separate_cells',
    label: 'All MPNs in one cell and all MFRs in another cell',
    description: 'Use this when one column has all MPNs together and another column has all matching manufacturers together in the same order.',
  },
  {
    value: 'same_cell',
    label: 'All MPNs and MFRs are in the same cell',
    description: 'Use this for values like "YAGEO: RC0805FR AVX: CR21-0100F-T" where manufacturer and MPN pairs are written together.',
  },
  {
    value: 'one_per_row',
    label: 'Each row has one MPN and one MFR',
    description: 'Use this when each row already represents one MPN/manufacturer pair and only needs light cleanup.',
  },
  {
    value: 'grouped_rows',
    label: 'Grouped rows with alternates below',
    description: 'Use this when a group row carries item details/quantity and the rows below carry primary and alternate MPN/MFR pairs.',
  },
];

export const ALTERNATE_LAYOUT_OPTIONS = [
  {
    value: 'inside_selected_mpn_columns',
    label: 'Alternates are inside the selected MPN/MFR cells',
    description: 'Use this when the selected MPN cell itself contains primary plus alternate MPNs.',
  },
  {
    value: 'separate_columns',
    label: 'Primary and alternate parts are separate columns',
    description: 'Use this for wide sheets with columns such as Primary MPN, Alt1 MPN, Alt2 MPN, Alt1 Qty, and Alt1 UOM.',
  },
  {
    value: 'already_separate_rows',
    label: 'Each source row is already one BOM row',
    description: 'Use this when pipe-separated values should stay in the same row instead of becoming alternates.',
  },
  {
    value: 'same_group_rows',
    label: 'Rows with the same group key are alternates',
    description: 'Use this when each row has one MPN/MFR pair, but repeated item/group details mean the later rows are alternates of the first row.',
  },
];

export const QTY_OPTIONS = [
  { value: 'every_row', label: 'Every row has its own quantity and UOM' },
  { value: 'inherit_primary', label: 'Alternates use the primary row quantity and UOM' },
  { value: 'alternate_columns', label: 'Alternate quantity and UOM are in nearby columns' },
];

export const MANUFACTURER_INHERIT_OPTIONS = [
  { value: 'inherit_blank', label: 'Fill blank alternate manufacturer from primary' },
  { value: 'never', label: 'Do not inherit manufacturer' },
];

export const GROUP_HEADER_OPTIONS = [
  {
    value: 'auto',
    label: 'Auto detect',
    description: 'Rows with MPN/MFR become materials; rows with only item details become group context.',
  },
  {
    value: 'context_only',
    label: 'Header row is only item details',
    description: 'The group header is not exported. The first MPN/MFR row below it becomes Primary.',
  },
  {
    value: 'header_primary',
    label: 'Header row is the primary material',
    description: 'The group header is exported as Primary and rows below it become alternates.',
  },
];

export const DELIMITER_OPTIONS = [
  { value: 'auto', label: 'Auto detect' },
  { value: ';', label: 'Semicolon ;' },
  { value: ',', label: 'Comma ,' },
  { value: '|', label: 'Pipe |' },
  { value: '\\n', label: 'New line' },
  { value: 'custom', label: 'Custom delimiter' },
];

export const CLEANUP_OPTIONS = [
  {
    key: 'skipTitleRows',
    label: 'Ignore category/title rows inside the BOM',
    description: 'Skips section labels that do not contain part data.',
  },
  {
    key: 'skipRepeatedHeaders',
    label: 'Ignore repeated header rows',
    description: 'Skips repeated table headers inside the sheet.',
  },
  {
    key: 'skipDoNotPopulate',
    label: 'Ignore Do Not Populate rows',
    description: 'Skips rows marked as not fitted or not populated.',
  },
  {
    key: 'skipDeletedRows',
    label: 'Ignore deleted/red rows',
    description: 'Skips rows marked Deleted, red text, or strikethrough in the source workbook.',
  },
];

export const KNOWN_MANUFACTURERS = [
  'INFINEON TECHNOLOGIES AG',
  'ON SEMICONDUCTOR',
  'NIC COMPONENTS',
  'TEXAS INSTRUMENTS',
  'ANALOG DEVICES',
  'SAMSUNG ELECTRO-MECHANICS',
  'SAMSUNG',
  'PANASONIC',
  'VISHAY',
  'YAGEO',
  'KEMET',
  'AVX',
  'ROHM',
  'NEXPERIA',
  'NXP',
  'DIODES',
  'MURATA',
  'TDK',
  'ABRACON CORPORATION',
  'CTS CORP',
  'ECLIPTEK',
  'FOX ELECTRONICS',
  'KOA',
  'IRC',
];

export const MANUFACTURER_SUFFIX_WORDS = new Set([
  'AG',
  'CO',
  'COMPONENTS',
  'CORP',
  'CORPORATION',
  'DEVICES',
  'ELECTRONIC',
  'ELECTRONICS',
  'GMBH',
  'INC',
  'INCORPORATED',
  'INDUSTRIES',
  'INSTRUMENTS',
  'LIMITED',
  'LTD',
  'MICROCHIP',
  'SEMICONDUCTOR',
  'SEMICONDUCTORS',
  'TECHNOLOGIES',
  'TECHNOLOGY',
]);

export const MPN_NOISE_RE = /(%|ppm\b|ohm\b|pf\b|nf\b|uf\b|\u00b5f\b|mh\b|mm\b|hz\b|khz\b|mhz\b|vac\b|vdc\b|watt\b|rohs\b|case\b|smd\b|esd\b)/i;

export const MPN_CONNECTOR_WORDS = new Set([
  'and',
  'or',
  'andor',
  'oror',
  'alt',
  'alternate',
  'alternates',
  'equiv',
  'equivalent',
  'option',
  'options',
]);

export const BOM_NORMALIZER_ALGORITHM_REGISTRY = {
  version: 1,
  roles: ROLE_FIELDS,
  parserScenarios: STRUCTURE_OPTIONS,
  alternateLayouts: ALTERNATE_LAYOUT_OPTIONS,
  quantityModes: QTY_OPTIONS,
  delimiters: DELIMITER_OPTIONS,
  cleanupRules: CLEANUP_OPTIONS,
  manufacturerFallbacks: KNOWN_MANUFACTURERS,
  manufacturerSuffixWords: [...MANUFACTURER_SUFFIX_WORDS],
  mpnNoisePattern: MPN_NOISE_RE.source,
  mpnConnectorWords: [...MPN_CONNECTOR_WORDS],
};
