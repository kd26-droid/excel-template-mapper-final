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
    example: {
      caption: 'No Manufacturer column at all. One MPN cell holds several MPNs together.',
      rows: [
        [{ text: 'MPN', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'RC0805FR / CR21-0100F-T / CRCW08050100F', role: 'mixed' }, { text: '1', role: 'plain' }],
      ],
    },
  },
  {
    value: 'mpn_only_rows',
    label: 'Only MPNs are present, each row has one MPN',
    description: 'Use this when the sheet has no manufacturer column and each row already has one MPN.',
    example: {
      caption: 'No Manufacturer column. Each row already carries exactly one MPN.',
      rows: [
        [{ text: 'MPN', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'RC0805FR-0710KL', role: 'primary' }, { text: '1', role: 'plain' }],
        [{ text: 'GRM188R71C104KA01D', role: 'primary' }, { text: '2', role: 'plain' }],
      ],
    },
  },
  {
    value: 'mfr_only_same_cell',
    label: 'Only MFRs are present, all MFRs in one cell',
    description: 'Use this when the sheet has manufacturer names but no MPN column, and one cell contains multiple manufacturers.',
    example: {
      caption: 'No MPN column. One Manufacturer cell holds several MFRs together.',
      rows: [
        [{ text: 'Manufacturer', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'YAGEO / AVX / VISHAY', role: 'mixed' }, { text: '1', role: 'plain' }],
      ],
    },
  },
  {
    value: 'mfr_only_rows',
    label: 'Only MFRs are present, each row has one MFR',
    description: 'Use this when the sheet has no MPN column and each row already has one manufacturer.',
    example: {
      caption: 'No MPN column. Each row carries exactly one Manufacturer.',
      rows: [
        [{ text: 'Manufacturer', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'YAGEO', role: 'primary' }, { text: '1', role: 'plain' }],
        [{ text: 'AVX', role: 'primary' }, { text: '2', role: 'plain' }],
      ],
    },
  },
  {
    value: 'separate_cells',
    label: 'All MPNs in one cell and all MFRs in another cell',
    description: 'Use this when one column has all MPNs together and another column has all matching manufacturers together in the same order.',
    example: {
      caption: 'MPN and Manufacturer are separate columns, but each cell holds a list. Position N in MPN pairs with position N in Manufacturer.',
      rows: [
        [{ text: 'MPN', role: 'header' }, { text: 'Manufacturer', role: 'header' }],
        [{ text: 'RC0805FR / CR21-0100F / CRCW08050100F', role: 'mixed' }, { text: 'YAGEO / AVX / VISHAY', role: 'mixed' }],
      ],
    },
  },
  {
    value: 'same_cell',
    label: 'All MPNs and MFRs are in the same cell',
    description: 'Use this for values like "YAGEO: RC0805FR AVX: CR21-0100F-T" where manufacturer and MPN pairs are written together.',
    example: {
      caption: 'One cell packs manufacturer + MPN pairs together, e.g. "MFR: MPN, MFR: MPN".',
      rows: [
        [{ text: 'MPN / Manufacturer combined', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'YAGEO: RC0805FR, AVX: CR21-0100F-T', role: 'mixed' }, { text: '1', role: 'plain' }],
      ],
    },
  },
  {
    value: 'one_per_row',
    label: 'Each row has one MPN and one MFR',
    description: 'Use this when each row already represents one MPN/manufacturer pair and only needs light cleanup.',
    example: {
      caption: 'Simple flat sheet — one MPN and one Manufacturer per row. No packed cells, no alternates.',
      rows: [
        [{ text: 'MPN', role: 'header' }, { text: 'Manufacturer', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'RC0805FR-0710KL', role: 'primary' }, { text: 'YAGEO', role: 'primary' }, { text: '1', role: 'plain' }],
        [{ text: 'GRM188R71C104', role: 'primary' }, { text: 'MURATA', role: 'primary' }, { text: '2', role: 'plain' }],
      ],
    },
  },
  {
    value: 'grouped_rows',
    label: 'Grouped rows with alternates below',
    description: 'Use this when a group row carries item details/quantity and the rows below carry primary and alternate MPN/MFR pairs.',
    example: {
      caption: 'Header row has item details + qty (no MPN). Rows below hold primary + alternate MPN/MFR pairs.',
      rows: [
        [{ text: 'CPN', role: 'header' }, { text: 'Description', role: 'header' }, { text: 'Qty', role: 'header' }, { text: 'MPN', role: 'header' }, { text: 'Manufacturer', role: 'header' }],
        [{ text: 'C0004', role: 'key' }, { text: '100nF 0805 cap', role: 'key' }, { text: '10', role: 'key' }, { text: '', role: 'plain' }, { text: '', role: 'plain' }],
        [{ text: '', role: 'plain' }, { text: '', role: 'plain' }, { text: '', role: 'plain' }, { text: 'RC0805FR-0710KL', role: 'primary' }, { text: 'YAGEO', role: 'primary' }],
        [{ text: '', role: 'plain' }, { text: '', role: 'plain' }, { text: '', role: 'plain' }, { text: 'CR21-0100F-T', role: 'alt' }, { text: 'AVX', role: 'alt' }],
      ],
    },
  },
];

export const BOM_LAYOUT_OPTIONS = [
  {
    value: 'none',
    label: 'None',
    description: 'Use the selected MPN/MFR parser without a workbook-level BOM layout transform.',
  },
  {
    value: 'assembly_quantity_matrix',
    label: 'Assembly quantity matrix',
    description: 'Use this when assembly columns such as 001, 002, 003 contain quantities for each part row.',
  },
  {
    value: 'multi_block_assembly',
    label: 'Multi-block assembly BOM',
    description: 'Use this when one workbook contains several linked BOM tables across sheets or repeated blocks.',
  },
];

// `example.rows[].cells[]` — { text, role: 'header' | 'primary' | 'alt' | 'note' }
// `example.caption` — one-line "what to look for" note under the table.
// Rendered by BomNormalizer.js as a large monospace mini-spreadsheet inside
// the option's info tooltip. Roles drive cell background colour so the
// primary vs. alternate pattern is visible without reading the label.
export const ALTERNATE_LAYOUT_OPTIONS = [
  {
    value: 'inside_selected_mpn_columns',
    label: 'Alternates are inside the selected MPN/MFR cells',
    description: 'Use this when the selected MPN cell itself contains primary plus alternate MPNs.',
    example: {
      caption: 'One MPN cell holds primary + alternate parts, separated by "/" or ",".',
      rows: [
        [{ text: 'MPN', role: 'header' }, { text: 'Manufacturer', role: 'header' }, { text: 'Qty', role: 'header' }],
        [
          { text: 'RC0805FR-0710KL / CR21-0100F-T', role: 'mixed' },
          { text: 'YAGEO / AVX', role: 'mixed' },
          { text: '1', role: 'plain' },
        ],
      ],
    },
  },
  {
    value: 'separate_columns',
    label: 'Primary and alternate parts are separate columns',
    description: 'Use this for wide sheets with columns such as Primary MPN, Alt1 MPN, Alt2 MPN, Alt1 Qty, and Alt1 UOM.',
    example: {
      caption: 'Different COLUMNS for primary vs each alternate.',
      rows: [
        [{ text: 'Primary MPN', role: 'header' }, { text: 'Alt 1 MPN', role: 'header' }, { text: 'Alt 2 MPN', role: 'header' }],
        [
          { text: 'RC0805FR-0710KL', role: 'primary' },
          { text: 'CR21-0100F-T', role: 'alt' },
          { text: 'CRCW08050100F', role: 'alt' },
        ],
      ],
    },
  },
  {
    value: 'already_separate_rows',
    label: 'Each source row is already one BOM row',
    description: 'Use this when pipe-separated values should stay in the same row instead of becoming alternates.',
    example: {
      caption: 'Every row stays as its OWN BOM line — no alternates created.',
      rows: [
        [{ text: 'MPN', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'RC0805FR-0710KL', role: 'primary' }, { text: '1', role: 'plain' }],
        [{ text: 'CR21-0100F-T', role: 'primary' }, { text: '1', role: 'plain' }],
        [{ text: 'CRCW08050100F', role: 'primary' }, { text: '1', role: 'plain' }],
      ],
    },
  },
  {
    value: 'same_group_rows',
    label: 'Rows with the same group key are alternates',
    description: 'Use this when each row has one MPN/MFR pair, but repeated item/group details mean the later rows are alternates of the first row.',
    example: {
      caption: 'Same CPN repeated → first row is primary, rest are alternates.',
      rows: [
        [{ text: 'CPN', role: 'header' }, { text: 'MPN', role: 'header' }, { text: 'Manufacturer', role: 'header' }],
        [{ text: 'C0004', role: 'key' }, { text: 'RC0805FR-0710KL', role: 'primary' }, { text: 'YAGEO', role: 'primary' }],
        [{ text: 'C0004', role: 'key' }, { text: 'CR21-0100F-T', role: 'alt' }, { text: 'AVX', role: 'alt' }],
        [{ text: 'C0004', role: 'key' }, { text: 'CRCW08050100F', role: 'alt' }, { text: 'VISHAY', role: 'alt' }],
      ],
    },
  },
  {
    value: 'following_rows',
    label: 'Alternates are in following rows',
    description: 'Use this when alternate values appear in rows below the main BOM row, often in a different column.',
    example: {
      caption: 'Row with a Level = primary. Blank-Level rows below it = alternates of that primary.',
      rows: [
        [{ text: 'Level', role: 'header' }, { text: 'MPN', role: 'header' }, { text: 'Manufacturer', role: 'header' }],
        [{ text: '1', role: 'key' }, { text: 'RC0805FR-0710KL', role: 'primary' }, { text: 'YAGEO', role: 'primary' }],
        [{ text: '', role: 'plain' }, { text: 'CR21-0100F-T', role: 'alt' }, { text: 'AVX', role: 'alt' }],
        [{ text: '', role: 'plain' }, { text: 'CRCW08050100F', role: 'alt' }, { text: 'VISHAY', role: 'alt' }],
      ],
    },
  },
];

export const QTY_OPTIONS = [
  {
    value: 'every_row',
    label: 'Every row has its own quantity and UOM',
    example: {
      caption: 'Each row already has its own Qty and UOM — nothing is copied between rows.',
      rows: [
        [{ text: 'MPN', role: 'header' }, { text: 'Qty', role: 'header' }, { text: 'UOM', role: 'header' }],
        [{ text: 'RC0805FR-0710KL', role: 'primary' }, { text: '10', role: 'primary' }, { text: 'PCS', role: 'primary' }],
        [{ text: 'CR21-0100F-T', role: 'primary' }, { text: '7', role: 'primary' }, { text: 'PCS', role: 'primary' }],
        [{ text: 'CRCW08050100F', role: 'primary' }, { text: '3', role: 'primary' }, { text: 'PCS', role: 'primary' }],
      ],
    },
  },
  {
    value: 'inherit_primary',
    label: 'Alternates use the primary row quantity and UOM',
    example: {
      caption: 'Alternate rows leave Qty/UOM blank → the primary row\'s values are copied down.',
      rows: [
        [{ text: 'MPN', role: 'header' }, { text: 'Qty', role: 'header' }, { text: 'UOM', role: 'header' }],
        [{ text: 'RC0805FR-0710KL', role: 'primary' }, { text: '10', role: 'primary' }, { text: 'PCS', role: 'primary' }],
        [{ text: 'CR21-0100F-T', role: 'alt' }, { text: '(blank → uses 10)', role: 'alt' }, { text: '(blank → PCS)', role: 'alt' }],
        [{ text: 'CRCW08050100F', role: 'alt' }, { text: '(blank → uses 10)', role: 'alt' }, { text: '(blank → PCS)', role: 'alt' }],
      ],
    },
  },
  {
    value: 'alternate_columns',
    label: 'Alternate quantity and UOM are in nearby columns',
    example: {
      caption: 'Sheet has extra columns like "Alt Qty" and "Alt UOM" holding the alternate\'s values.',
      rows: [
        [
          { text: 'MPN', role: 'header' },
          { text: 'Qty', role: 'header' },
          { text: 'UOM', role: 'header' },
          { text: 'Alt MPN', role: 'header' },
          { text: 'Alt Qty', role: 'header' },
          { text: 'Alt UOM', role: 'header' },
        ],
        [
          { text: 'RC0805FR-0710KL', role: 'primary' },
          { text: '10', role: 'primary' },
          { text: 'PCS', role: 'primary' },
          { text: 'CR21-0100F-T', role: 'alt' },
          { text: '7', role: 'alt' },
          { text: 'PCS', role: 'alt' },
        ],
      ],
    },
  },
];

export const MANUFACTURER_INHERIT_OPTIONS = [
  { value: 'inherit_blank', label: 'Autofill empty alternate manufacturer from primary' },
  { value: 'never', label: 'Keep Manufacturer cells empty' },
];

export const GROUP_HEADER_OPTIONS = [
  {
    value: 'auto',
    label: 'Auto detect',
    description: 'Rows with MPN/MFR become materials; rows with only item details become group context.',
    example: {
      caption: 'Look at each row: if it has an MPN → it\'s a material row (primary/alt). If it only has item details, no MPN → it\'s a header/context row.',
      rows: [
        [{ text: 'CPN', role: 'header' }, { text: 'Description', role: 'header' }, { text: 'MPN', role: 'header' }, { text: 'Manufacturer', role: 'header' }],
        [{ text: 'C0004', role: 'key' }, { text: '100nF 0805 cap', role: 'key' }, { text: '', role: 'plain' }, { text: '', role: 'plain' }],
        [{ text: '', role: 'plain' }, { text: '', role: 'plain' }, { text: 'RC0805FR-0710KL', role: 'primary' }, { text: 'YAGEO', role: 'primary' }],
        [{ text: '', role: 'plain' }, { text: '', role: 'plain' }, { text: 'CR21-0100F-T', role: 'alt' }, { text: 'AVX', role: 'alt' }],
      ],
    },
  },
  {
    value: 'context_only',
    label: 'Header row is only item details',
    description: 'The group header is not exported. The first MPN/MFR row below it becomes Primary.',
    example: {
      caption: 'Group header row (CPN + description, no MPN) is DISCARDED. The first row below it with an MPN becomes Primary.',
      rows: [
        [{ text: 'CPN', role: 'header' }, { text: 'Description', role: 'header' }, { text: 'MPN', role: 'header' }, { text: 'Manufacturer', role: 'header' }],
        [{ text: 'C0004', role: 'key' }, { text: '100nF 0805 cap', role: 'key' }, { text: '(dropped)', role: 'plain' }, { text: '(dropped)', role: 'plain' }],
        [{ text: '', role: 'plain' }, { text: '', role: 'plain' }, { text: 'RC0805FR-0710KL', role: 'primary' }, { text: 'YAGEO', role: 'primary' }],
        [{ text: '', role: 'plain' }, { text: '', role: 'plain' }, { text: 'CR21-0100F-T', role: 'alt' }, { text: 'AVX', role: 'alt' }],
      ],
    },
  },
  {
    value: 'header_primary',
    label: 'Header row is the primary material',
    description: 'The group header is exported as Primary and rows below it become alternates.',
    example: {
      caption: 'The header row IS the primary part (its MPN is the primary MPN). Rows below become alternates of it.',
      rows: [
        [{ text: 'CPN', role: 'header' }, { text: 'Description', role: 'header' }, { text: 'MPN', role: 'header' }, { text: 'Manufacturer', role: 'header' }],
        [{ text: 'C0004', role: 'primary' }, { text: '100nF 0805', role: 'primary' }, { text: 'RC0805FR-0710KL', role: 'primary' }, { text: 'YAGEO', role: 'primary' }],
        [{ text: '', role: 'plain' }, { text: '', role: 'plain' }, { text: 'CR21-0100F-T', role: 'alt' }, { text: 'AVX', role: 'alt' }],
        [{ text: '', role: 'plain' }, { text: '', role: 'plain' }, { text: 'CRCW08050100F', role: 'alt' }, { text: 'VISHAY', role: 'alt' }],
      ],
    },
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
  bomLayouts: BOM_LAYOUT_OPTIONS,
  alternateLayouts: ALTERNATE_LAYOUT_OPTIONS,
  quantityModes: QTY_OPTIONS,
  delimiters: DELIMITER_OPTIONS,
  cleanupRules: CLEANUP_OPTIONS,
  manufacturerFallbacks: KNOWN_MANUFACTURERS,
  manufacturerSuffixWords: [...MANUFACTURER_SUFFIX_WORDS],
  mpnNoisePattern: MPN_NOISE_RE.source,
  mpnConnectorWords: [...MPN_CONNECTOR_WORDS],
};
