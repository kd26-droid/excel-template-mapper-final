import { reviewEntriesWithUserEdits } from './BomNormalizer';

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
