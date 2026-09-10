export const ROLE_FIELDS = [
  { key: 'cpn', label: 'CPN / customer part number' },
  { key: 'mpn', label: 'MPN column' },
  { key: 'manufacturer', label: 'Manufacturer column' },
  { key: 'description', label: 'Description / item name' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'uom', label: 'UOM' },
  { key: 'notes', label: 'Notes' },
  { key: 'internalNotes', label: 'Internal notes' },
  { key: 'level', label: 'BOM level' },
  { key: 'parent', label: 'Parent / group key' },
];

export const IDENTITY_LAYOUT_OPTIONS = [
  {
    value: 'mpn_only',
    label: 'Only MPN is present',
    description: 'Use this when the source has manufacturer part numbers but no manufacturer or CPN value.',
    example: {
      caption: 'The file carries only the manufacturer part number. Manufacturer and CPN are not available in this structure.',
      rows: [
        [{ text: 'MPN', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'RC0603FR-0710KL', role: 'primary' }, { text: '12', role: 'plain' }],
        [{ text: 'GRM188R71C104KA01D', role: 'primary' }, { text: '4', role: 'plain' }],
      ],
    },
  },
  {
    value: 'mpn_mfr_same',
    label: 'MPN and MFR are in the same cell',
    description: 'Use this when one source column contains both manufacturer and MPN.',
    example: {
      caption: 'One source cell has both manufacturer and MPN together. CPN is not present.',
      rows: [
        [{ text: 'Manufacturer info', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'Yageo RC0603FR-0710KL', role: 'mixed' }, { text: '12', role: 'plain' }],
        [{ text: 'Murata GRM188R71C104KA01D', role: 'mixed' }, { text: '4', role: 'plain' }],
      ],
    },
  },
  {
    value: 'mpn_mfr_separate',
    label: 'MPN and MFR are in separate cells',
    description: 'Use this when MPN and manufacturer are in two separate source columns.',
    example: {
      caption: 'MPN and manufacturer are separate columns. CPN is not present.',
      rows: [
        [{ text: 'MFR', role: 'header' }, { text: 'MPN', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'Yageo', role: 'key' }, { text: 'RC0603FR-0710KL', role: 'primary' }, { text: '12', role: 'plain' }],
        [{ text: 'Murata', role: 'key' }, { text: 'GRM188R71C104KA01D', role: 'primary' }, { text: '4', role: 'plain' }],
      ],
    },
  },
  {
    value: 'mpn_cpn_same',
    label: 'MPN and CPN are in the same cell',
    description: 'Use this when one source column contains both customer part number and MPN, with no manufacturer value.',
    example: {
      caption: 'Customer part number and MPN are packed into one source cell. Manufacturer is not present.',
      rows: [
        [{ text: 'Part reference', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'CPN-10024 / RC0603FR-0710KL', role: 'mixed' }, { text: '12', role: 'plain' }],
        [{ text: 'CPN-10025 / GRM188R71C104KA01D', role: 'mixed' }, { text: '4', role: 'plain' }],
      ],
    },
  },
  {
    value: 'mpn_cpn_separate',
    label: 'MPN and CPN are in separate cells',
    description: 'Use this when MPN and CPN are in two separate source columns, with no manufacturer value.',
    example: {
      caption: 'CPN and MPN are separate columns. Manufacturer is not present.',
      rows: [
        [{ text: 'CPN', role: 'header' }, { text: 'MPN', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'CPN-10024', role: 'key' }, { text: 'RC0603FR-0710KL', role: 'primary' }, { text: '12', role: 'plain' }],
        [{ text: 'CPN-10025', role: 'key' }, { text: 'GRM188R71C104KA01D', role: 'primary' }, { text: '4', role: 'plain' }],
      ],
    },
  },
  {
    value: 'mpn_mfr_cpn_same',
    label: 'MPN, MFR, and CPN are all in the same cell',
    description: 'Use this when one source column contains all three identifiers.',
    example: {
      caption: 'One source cell contains customer part number, manufacturer, and MPN together.',
      rows: [
        [{ text: 'Part details', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'CPN-10024 | Yageo | RC0603FR-0710KL', role: 'mixed' }, { text: '12', role: 'plain' }],
        [{ text: 'CPN-10025 | Murata | GRM188R71C104KA01D', role: 'mixed' }, { text: '4', role: 'plain' }],
      ],
    },
  },
  {
    value: 'mpn_mfr_same_cpn_separate',
    label: 'MPN and MFR are in the same cell, CPN is separate',
    description: 'Use this when one source column contains MPN and manufacturer, and another column contains CPN.',
    example: {
      caption: 'CPN has its own column. Manufacturer and MPN are combined in another column.',
      rows: [
        [{ text: 'CPN', role: 'header' }, { text: 'Manufacturer info', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'CPN-10024', role: 'key' }, { text: 'Yageo RC0603FR-0710KL', role: 'mixed' }, { text: '12', role: 'plain' }],
        [{ text: 'CPN-10025', role: 'key' }, { text: 'Murata GRM188R71C104KA01D', role: 'mixed' }, { text: '4', role: 'plain' }],
      ],
    },
  },
  {
    value: 'mpn_cpn_same_mfr_separate',
    label: 'MPN and CPN are in the same cell, MFR is separate',
    description: 'Use this when one source column contains MPN and CPN, and another column contains manufacturer.',
    example: {
      caption: 'Manufacturer has its own column. CPN and MPN are combined in another column.',
      rows: [
        [{ text: 'MFR', role: 'header' }, { text: 'Part reference', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'Yageo', role: 'key' }, { text: 'CPN-10024 / RC0603FR-0710KL', role: 'mixed' }, { text: '12', role: 'plain' }],
        [{ text: 'Murata', role: 'key' }, { text: 'CPN-10025 / GRM188R71C104KA01D', role: 'mixed' }, { text: '4', role: 'plain' }],
      ],
    },
  },
  {
    value: 'mfr_cpn_same_mpn_separate',
    label: 'MFR and CPN are in the same cell, MPN is separate',
    description: 'Use this when one source column contains manufacturer and CPN, and another column contains MPN.',
    example: {
      caption: 'MPN has its own column. CPN and manufacturer are combined in another column.',
      rows: [
        [{ text: 'Customer/manufacturer', role: 'header' }, { text: 'MPN', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'CPN-10024 | Yageo', role: 'mixed' }, { text: 'RC0603FR-0710KL', role: 'primary' }, { text: '12', role: 'plain' }],
        [{ text: 'CPN-10025 | Murata', role: 'mixed' }, { text: 'GRM188R71C104KA01D', role: 'primary' }, { text: '4', role: 'plain' }],
      ],
    },
  },
  {
    value: 'mpn_mfr_cpn_separate',
    label: 'MPN, MFR, and CPN are all in separate cells',
    description: 'Use this when MPN, manufacturer, and CPN are each in their own source column.',
    example: {
      caption: 'CPN, manufacturer, and MPN are each in their own source column on the same row.',
      rows: [
        [{ text: 'CPN', role: 'header' }, { text: 'MFR', role: 'header' }, { text: 'MPN', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'CPN-10024', role: 'key' }, { text: 'Yageo', role: 'key' }, { text: 'RC0603FR-0710KL', role: 'primary' }, { text: '12', role: 'plain' }],
        [{ text: 'CPN-10025', role: 'key' }, { text: 'Murata', role: 'key' }, { text: 'GRM188R71C104KA01D', role: 'primary' }, { text: '4', role: 'plain' }],
      ],
    },
  },
];

export const ROW_PLACEMENT_OPTIONS = [
  {
    value: 'same_row',
    label: 'Same row',
    description: 'CPN, MPN, and MFR values are on the same source row.',
    example: {
      caption: 'All identifiers that belong together are found in the same row.',
      rows: [
        [{ text: 'Row', role: 'header' }, { text: 'CPN', role: 'header' }, { text: 'MFR', role: 'header' }, { text: 'MPN', role: 'header' }],
        [{ text: '1', role: 'plain' }, { text: 'CPN-10024', role: 'key' }, { text: 'Yageo', role: 'key' }, { text: 'RC0603FR-0710KL', role: 'primary' }],
        [{ text: '2', role: 'plain' }, { text: 'CPN-10025', role: 'key' }, { text: 'Murata', role: 'key' }, { text: 'GRM188R71C104KA01D', role: 'primary' }],
      ],
    },
  },
  {
    value: 'cpn_row_mpn_mfr_below',
    label: 'CPN row, MPN/MFR in rows below',
    description: 'A CPN row starts the item context. Following rows contain the related MPN/MFR values until the next CPN row.',
    example: {
      caption: 'A CPN row starts the group. The rows below carry the related manufacturer and MPN values.',
      rows: [
        [{ text: 'Row', role: 'header' }, { text: 'CPN', role: 'header' }, { text: 'MFR', role: 'header' }, { text: 'MPN', role: 'header' }],
        [{ text: '1', role: 'plain' }, { text: 'CPN-10024', role: 'key' }, { text: '', role: 'plain' }, { text: '', role: 'plain' }],
        [{ text: '2', role: 'plain' }, { text: '', role: 'plain' }, { text: 'Yageo', role: 'key' }, { text: 'RC0603FR-0710KL', role: 'primary' }],
        [{ text: '3', role: 'plain' }, { text: '', role: 'plain' }, { text: 'Vishay', role: 'key' }, { text: 'CRCW060310K0FKEA', role: 'primary' }],
      ],
    },
  },
  {
    value: 'mpn_row_cpn_mfr_below',
    label: 'MPN row, CPN/MFR in rows below',
    description: 'An MPN row starts the item context. Following rows contain the related CPN/MFR values.',
    example: {
      caption: 'An MPN row starts the group. The related CPN and manufacturer are found in following rows.',
      rows: [
        [{ text: 'Row', role: 'header' }, { text: 'CPN', role: 'header' }, { text: 'MFR', role: 'header' }, { text: 'MPN', role: 'header' }],
        [{ text: '1', role: 'plain' }, { text: '', role: 'plain' }, { text: '', role: 'plain' }, { text: 'RC0603FR-0710KL', role: 'primary' }],
        [{ text: '2', role: 'plain' }, { text: 'CPN-10024', role: 'key' }, { text: 'Yageo', role: 'key' }, { text: '', role: 'plain' }],
        [{ text: '3', role: 'plain' }, { text: 'CPN-10024', role: 'key' }, { text: 'Vishay', role: 'key' }, { text: '', role: 'plain' }],
      ],
    },
  },
  {
    value: 'mfr_row_cpn_mpn_below',
    label: 'MFR row, CPN/MPN in rows below',
    description: 'A manufacturer row starts the item context. Following rows contain the related CPN/MPN values.',
    example: {
      caption: 'A manufacturer row starts the group. The related CPN and MPN are found below it.',
      rows: [
        [{ text: 'Row', role: 'header' }, { text: 'CPN', role: 'header' }, { text: 'MFR', role: 'header' }, { text: 'MPN', role: 'header' }],
        [{ text: '1', role: 'plain' }, { text: '', role: 'plain' }, { text: 'Yageo', role: 'key' }, { text: '', role: 'plain' }],
        [{ text: '2', role: 'plain' }, { text: 'CPN-10024', role: 'key' }, { text: '', role: 'plain' }, { text: 'RC0603FR-0710KL', role: 'primary' }],
        [{ text: '3', role: 'plain' }, { text: 'CPN-10025', role: 'key' }, { text: '', role: 'plain' }, { text: 'RC0805FR-07100RL', role: 'primary' }],
      ],
    },
  },
  {
    value: 'cpn_mpn_row_mfr_below',
    label: 'CPN/MPN row, MFR in rows below',
    description: 'CPN and MPN are on the main row. Manufacturer appears on one or more following rows.',
    example: {
      caption: 'CPN and MPN are together on the main row. Manufacturer is supplied by following row context.',
      rows: [
        [{ text: 'Row', role: 'header' }, { text: 'CPN', role: 'header' }, { text: 'MFR', role: 'header' }, { text: 'MPN', role: 'header' }],
        [{ text: '1', role: 'plain' }, { text: 'CPN-10024', role: 'key' }, { text: '', role: 'plain' }, { text: 'RC0603FR-0710KL', role: 'primary' }],
        [{ text: '2', role: 'plain' }, { text: '', role: 'plain' }, { text: 'Yageo', role: 'key' }, { text: '', role: 'plain' }],
      ],
    },
  },
  {
    value: 'cpn_mfr_row_mpn_below',
    label: 'CPN/MFR row, MPN in rows below',
    description: 'CPN and manufacturer are on the main row. MPN appears on one or more following rows.',
    example: {
      caption: 'CPN and manufacturer are together on the main row. MPN is supplied by following rows.',
      rows: [
        [{ text: 'Row', role: 'header' }, { text: 'CPN', role: 'header' }, { text: 'MFR', role: 'header' }, { text: 'MPN', role: 'header' }],
        [{ text: '1', role: 'plain' }, { text: 'CPN-10024', role: 'key' }, { text: 'Yageo', role: 'key' }, { text: '', role: 'plain' }],
        [{ text: '2', role: 'plain' }, { text: '', role: 'plain' }, { text: '', role: 'plain' }, { text: 'RC0603FR-0710KL', role: 'primary' }],
        [{ text: '3', role: 'plain' }, { text: '', role: 'plain' }, { text: '', role: 'plain' }, { text: 'RC0603FR-0722KL', role: 'primary' }],
      ],
    },
  },
  {
    value: 'mpn_mfr_row_cpn_below',
    label: 'MPN/MFR row, CPN in rows below',
    description: 'MPN and manufacturer are on the main row. CPN appears on one or more following rows.',
    example: {
      caption: 'MPN and manufacturer are together on the main row. CPN is supplied by following row context.',
      rows: [
        [{ text: 'Row', role: 'header' }, { text: 'CPN', role: 'header' }, { text: 'MFR', role: 'header' }, { text: 'MPN', role: 'header' }],
        [{ text: '1', role: 'plain' }, { text: '', role: 'plain' }, { text: 'Yageo', role: 'key' }, { text: 'RC0603FR-0710KL', role: 'primary' }],
        [{ text: '2', role: 'plain' }, { text: 'CPN-10024', role: 'key' }, { text: '', role: 'plain' }, { text: '', role: 'plain' }],
      ],
    },
  },
  {
    value: 'separate_linked_rows',
    label: 'CPN, MPN, and MFR are each on separate linked rows',
    description: 'The three identifiers live on separate rows that must be linked by position or surrounding context.',
    example: {
      caption: 'Each identifier type is on a separate row. They belong together because of nearby position or shared group context.',
      rows: [
        [{ text: 'Row', role: 'header' }, { text: 'Field', role: 'header' }, { text: 'Value', role: 'header' }],
        [{ text: '1', role: 'plain' }, { text: 'Customer part', role: 'key' }, { text: 'CPN-10024', role: 'key' }],
        [{ text: '2', role: 'plain' }, { text: 'Manufacturer', role: 'key' }, { text: 'Yageo', role: 'key' }],
        [{ text: '3', role: 'plain' }, { text: 'Manufacturer part', role: 'primary' }, { text: 'RC0603FR-0710KL', role: 'primary' }],
      ],
    },
  },
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
    label: 'Alternates in the same cell',
    description: 'Use this when one selected source cell contains the primary part plus alternate parts.',
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
    label: 'Alternates in separate columns',
    description: 'Use this for wide sheets where primary and alternate parts are placed in separate columns.',
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
    label: 'No alternates',
    description: 'Every row stays as its own BOM row. Nothing collapses into alternates.',
    example: {
      caption: 'Every row is its own BOM line. No alternates are created — different rows = different parts.',
      rows: [
        [{ text: 'MPN', role: 'header' }, { text: 'Manufacturer', role: 'header' }, { text: 'Qty', role: 'header' }],
        [{ text: 'RC0805FR-0710KL', role: 'primary' }, { text: 'YAGEO', role: 'primary' }, { text: '1', role: 'plain' }],
        [{ text: 'CR21-0100F-T', role: 'primary' }, { text: 'AVX', role: 'primary' }, { text: '1', role: 'plain' }],
        [{ text: 'CRCW08050100F', role: 'primary' }, { text: 'VISHAY', role: 'primary' }, { text: '1', role: 'plain' }],
      ],
    },
  },
  {
    value: 'same_group_rows',
    label: 'Alternates are rows with the same group key',
    description: 'Rows that share the same grouping value are the same part: the first row is Primary, later rows become alternates.',
    example: {
      caption: 'Rows with the same group key are treated as one part. First row = Primary, the rest = Alternates.',
      rows: [
        [{ text: 'Group key', role: 'header' }, { text: 'MPN', role: 'header' }, { text: 'Manufacturer', role: 'header' }],
        [{ text: 'ITEM-004', role: 'key' }, { text: 'RC0805FR-0710KL', role: 'primary' }, { text: 'YAGEO', role: 'primary' }],
        [{ text: 'ITEM-004', role: 'key' }, { text: 'CR21-0100F-T', role: 'alt' }, { text: 'AVX', role: 'alt' }],
        [{ text: 'ITEM-004', role: 'key' }, { text: 'CRCW08050100F', role: 'alt' }, { text: 'VISHAY', role: 'alt' }],
      ],
    },
  },
  {
    value: 'following_rows',
    label: 'Alternates in rows below the primary',
    description: 'The primary carries MPN + MFR. Rows below with the same context but blank grouping column are alternates of the primary.',
    example: {
      caption: 'Primary row has the MPN and Manufacturer. The rows directly below (with blank Level) are its alternates.',
      rows: [
        [{ text: 'Level', role: 'header' }, { text: 'MPN', role: 'header' }, { text: 'Manufacturer', role: 'header' }],
        [{ text: '1', role: 'key' }, { text: 'RC0805FR-0710KL', role: 'primary' }, { text: 'YAGEO', role: 'primary' }],
        [{ text: '', role: 'plain' }, { text: 'CR21-0100F-T', role: 'alt' }, { text: 'AVX', role: 'alt' }],
        [{ text: '', role: 'plain' }, { text: 'CRCW08050100F', role: 'alt' }, { text: 'VISHAY', role: 'alt' }],
      ],
    },
  },
  {
    value: 'following_item_rows',
    label: 'Item row followed by primary and alternate rows',
    description: 'An item row (with its identity, no MPN/MFR yet) is followed by rows carrying the primary MPN/MFR and its alternates.',
    example: {
      caption: 'Item row on top (with item name, no MPN). The rows directly below hold the MPN/MFR pairs — first is Primary, rest are alternates.',
      rows: [
        [{ text: 'Item name', role: 'header' }, { text: 'MPN', role: 'header' }, { text: 'Manufacturer', role: 'header' }],
        [{ text: '100nF 0805 cap', role: 'key' }, { text: '', role: 'plain' }, { text: '', role: 'plain' }],
        [{ text: '', role: 'plain' }, { text: 'RC0805FR-0710KL', role: 'primary' }, { text: 'YAGEO', role: 'primary' }],
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
  // Not a skip like the others - it changes how rows are read rather than
  // whether they are read. It lives here because this is where options that the
  // sheet itself triggers are shown, and it only appears when paths are found.
  {
    key: 'parentPathLevels',
    label: 'Read levels and part numbers from the parent path',
    description: 'The parent column holds a full trail (">E36047BB01>F1288042"). Its depth is the BOM level, and its last segment is the row\'s own part number — filled into the CPN column only where that column is blank. Both are more reliable than the sheet\'s own columns, which may number documents by the part they belong to. Turn off to use the sheet\'s level and CPN columns exactly as written.',
    defaultOn: true,
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
  'ou',
  'o\u00f9',
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
  identityLayouts: IDENTITY_LAYOUT_OPTIONS,
  rowPlacements: ROW_PLACEMENT_OPTIONS,
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
