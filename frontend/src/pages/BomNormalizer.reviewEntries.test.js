import {
  backendReviewDisplayRows,
  canUseVisualTeachInterpretation,
  mergeInferredAlternateInheritFields,
  requiresExplicitGroupKey,
  reviewEntriesWithUserEdits,
  visualTeachEntriesFromBackend,
  visualTeachMappedFieldKeysFromBackend,
  visualTeachSeedEntries,
} from './BomNormalizer';

describe('backendReviewDisplayRows', () => {
  test('renders only the rows returned by the backend display contract', () => {
    const backendRow = {
      id: 'review-row-2:entry:0',
      reviewRowId: 'review-row-2',
      sourceRow: 2,
      relation: 'Primary',
      fields: {
        cpn: 'S141951',
        mpn: '',
        manufacturer: '',
      },
    };

    const result = backendReviewDisplayRows({ displayRows: [backendRow] });

    expect(result).toEqual([backendRow]);
    expect(result).toHaveLength(1);
  });

  test('does not synthesize rows when backend display rows are absent', () => {
    expect(backendReviewDisplayRows({})).toEqual([]);
    expect(backendReviewDisplayRows({ displayRows: null })).toEqual([]);
  });
});

const backendEntry = {
  relation: 'Primary',
  fields: { mpn: '201Y04L', manufacturer: 'NICOMATI' },
  groupId: 'pattern-1',
  occurrenceId: 'row-39-item-1',
};

describe('reviewEntriesWithUserEdits', () => {
  test('does not let a stale empty edit hide backend interpretation rows', () => {
    const result = reviewEntriesWithUserEdits(
      { entries: [backendEntry] },
      {
        'pattern-1': {
          'row-39-item-1': {
            entries: [],
            manuallyEdited: false,
          },
        },
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0].fields).toEqual(backendEntry.fields);
  });

  test('does not let an empty manual edit erase a backend interpretation', () => {
    const result = reviewEntriesWithUserEdits(
      { entries: [backendEntry] },
      {
        'pattern-1': {
          'row-39-item-1': {
            entries: [],
            manuallyEdited: true,
          },
        },
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0].fields.mpn).toBe('201Y04L');
  });

  test('keeps a non-empty manual correction visible', () => {
    const result = reviewEntriesWithUserEdits(
      { entries: [backendEntry] },
      {
        'pattern-1': {
          'row-39-item-1': {
            entries: [{
              relation: 'Primary',
              fields: { mpn: '201Y04L-CORRECTED', manufacturer: 'NICOMATI' },
            }],
            manuallyEdited: true,
          },
        },
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0].fields.mpn).toBe('201Y04L-CORRECTED');
  });

  test('preserves backend carry-forward fields in partial alternate edits', () => {
    const alternateEntry = {
      relation: 'Alternate 1',
      fields: {
        cpn: 'A1002491',
        mpn: 'CR0805F-5K1J(I)',
        manufacturer: 'WELWYN',
        description: 'RESIST PAVE_0805',
        quantity: '8',
      },
      sourceColumns: {
        cpn: 'Ref. Article',
        description: 'Libelle',
        quantity: 'Qte',
      },
      groupId: 'pattern-1',
      occurrenceId: 'row-52-item-1',
      patternEntryIndex: 1,
    };
    const result = reviewEntriesWithUserEdits(
      { entries: [alternateEntry] },
      {
        'pattern-1': {
          'row-52-item-1': {
            entries: [{
              relation: 'Alternate 1',
              fields: { mpn: 'CR0805F-5K1J-CORRECTED', manufacturer: 'WELWYN' },
            }],
            manuallyEdited: true,
          },
        },
      }
    );

    expect(result[0].fields).toEqual({
      cpn: 'A1002491',
      mpn: 'CR0805F-5K1J-CORRECTED',
      manufacturer: 'WELWYN',
      description: 'RESIST PAVE_0805',
      quantity: '8',
    });
    expect(result[0].sourceColumns.cpn).toBe('Ref. Article');
  });

  test('preserves the backend relation for a row-level alternate', () => {
    const result = reviewEntriesWithUserEdits({
      entries: [{
        ...backendEntry,
        relation: 'Alternate 4',
      }],
    });

    expect(result[0].relation).toBe('Alternate 4');
  });
});

describe('canUseVisualTeachInterpretation', () => {
  test('allows an unrecognized backend pattern without requiring an edit', () => {
    expect(canUseVisualTeachInterpretation({
      hasUserChanges: false,
      recognized: false,
    })).toBe(true);
  });

  test('requires an edit when the backend pattern is already recognized', () => {
    expect(canUseVisualTeachInterpretation({
      hasUserChanges: false,
      recognized: true,
    })).toBe(false);
    expect(canUseVisualTeachInterpretation({
      hasUserChanges: true,
      recognized: true,
    })).toBe(true);
  });
});

describe('mergeInferredAlternateInheritFields', () => {
  test('hydrates backend autofill fields after unrelated parser changes', () => {
    expect(mergeInferredAlternateInheritFields(
      { alternateInheritFields: [] },
      { alternateInheritFields: ['cpn', 'manufacturer', 'quantity', 'uom'] },
      false
    ).alternateInheritFields).toEqual(['cpn', 'manufacturer', 'quantity', 'uom']);
  });

  test('preserves an explicit user selection', () => {
    expect(mergeInferredAlternateInheritFields(
      { alternateInheritFields: ['description'] },
      { alternateInheritFields: ['cpn', 'quantity'] },
      true
    ).alternateInheritFields).toEqual(['description']);
  });
});

describe('requiresExplicitGroupKey', () => {
  test('requires a valid, separately selected group-key column', () => {
    expect(requiresExplicitGroupKey(
      { alternateLayout: 'same_group_rows', bomLayout: 'none' },
      ['Ref Des', 'Parent']
    )).toBe(true);
    expect(requiresExplicitGroupKey(
      {
        alternateLayout: 'same_group_rows',
        bomLayout: 'none',
        sameGroupKeyColumn: 'Ref Des',
      },
      ['Ref Des', 'Parent']
    )).toBe(false);
    expect(requiresExplicitGroupKey(
      {
        alternateLayout: 'same_group_rows',
        bomLayout: 'none',
        sameGroupKeyColumn: 'Missing',
      },
      ['Ref Des', 'Parent']
    )).toBe(true);
  });
});

describe('visualTeachEntriesFromBackend', () => {
  const fields = [
    { key: 'mpn' },
    { key: 'manufacturer' },
  ];

  test('does not synthesize a primary row when backend entries are empty', () => {
    expect(visualTeachEntriesFromBackend([], fields)).toEqual([]);
    expect(visualTeachEntriesFromBackend(undefined, fields)).toEqual([]);
  });

  test('preserves every backend-returned interpretation row', () => {
    const result = visualTeachEntriesFromBackend([
      {
        relation: 'Primary',
        fields: {
          mpn: { value: 'IRLML6402PBF', sourceColumn: 'Combined' },
          manufacturer: { value: 'INFINEON', sourceColumn: 'Combined' },
        },
      },
      {
        relation: 'Alternate 1',
        fields: {
          mpn: { value: 'IRLML6402TR', sourceColumn: 'Combined' },
          manufacturer: { value: 'INFINEON', sourceColumn: 'Combined' },
        },
      },
    ], fields);

    expect(result).toEqual([
      {
        relation: 'Primary',
        fields: { mpn: 'IRLML6402PBF', manufacturer: 'INFINEON' },
        sourceColumns: { mpn: 'Combined', manufacturer: 'Combined' },
      },
      {
        relation: 'Alternate 1',
        fields: { mpn: 'IRLML6402TR', manufacturer: 'INFINEON' },
        sourceColumns: { mpn: 'Combined', manufacturer: 'Combined' },
      },
    ]);
  });
});

describe('visualTeachSeedEntries', () => {
  const interpretedEntries = [{ relation: 'Primary', fields: { mpn: 'C0603X103K2RAC' } }];
  const staleReviewEntries = [{ relation: 'Primary', fields: { mpn: 'C0603X103K2RAC@ (/TU/7411)' } }];

  test('does not replace backend pattern entries with unedited review-row state', () => {
    expect(visualTeachSeedEntries({
      backendEntries: interpretedEntries,
      sampleEdit: { entries: staleReviewEntries, manuallyEdited: false },
    })).toEqual(interpretedEntries);
  });

  test('preserves an explicit manual edit', () => {
    expect(visualTeachSeedEntries({
      backendEntries: interpretedEntries,
      sampleEdit: { entries: staleReviewEntries, manuallyEdited: true },
    })).toEqual(staleReviewEntries);
  });
});

describe('visualTeachMappedFieldKeysFromBackend', () => {
  test('uses backend pattern fields when the workflow step has no fields', () => {
    expect(visualTeachMappedFieldKeysFromBackend({
      workflowFields: [],
      patternFields: ['mpn', 'manufacturer'],
      roleFields: [],
    })).toEqual(['mpn', 'manufacturer']);
  });

  test('keeps workflow fields authoritative when supplied', () => {
    expect(visualTeachMappedFieldKeysFromBackend({
      workflowFields: ['quantity', 'uom'],
      patternFields: ['mpn', 'manufacturer'],
    })).toEqual(['quantity', 'uom']);
  });
});
