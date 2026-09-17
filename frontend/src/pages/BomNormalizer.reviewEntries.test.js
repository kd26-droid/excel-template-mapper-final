import {
  canUseVisualTeachInterpretation,
  reviewEntriesWithUserEdits,
  visualTeachEntriesFromBackend,
} from './BomNormalizer';

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
