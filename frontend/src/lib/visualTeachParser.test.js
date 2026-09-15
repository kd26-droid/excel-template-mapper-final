import {
  clearVisualTeachTagSelection,
  fieldPatternSampleKey,
  fieldPatternSampleForWorkflowStep,
  normalizeVisualTeachEntries,
  shouldRepeatVisualTeachGroupSeparator,
  visualTeachTagsFromInterpretationSpans,
} from './visualTeachParser';

describe('visual teach display helpers', () => {
  test('keeps same-row pattern occurrences independently keyed', () => {
    const first = { sourceRow: 21, sourceFragment: { id: 'occurrence-a' } };
    const second = { sourceRow: 21, sourceFragment: { id: 'occurrence-b' } };

    expect(fieldPatternSampleKey(first)).toBe('occurrence-a');
    expect(fieldPatternSampleKey(second)).toBe('occurrence-b');
    expect(fieldPatternSampleKey(first)).not.toBe(fieldPatternSampleKey(second));
    expect(fieldPatternSampleKey({ sourceRow: 21 })).toBe('21');
  });

  test('opens the exact backend workflow occurrence when one row has several fragments', () => {
    const first = { sourceRow: 21, sourceFragment: { id: 'occurrence-a', rawValue: 'FIRST' } };
    const second = { sourceRow: 21, sourceFragment: { id: 'occurrence-b', rawValue: 'SECOND' } };

    expect(fieldPatternSampleForWorkflowStep(
      { samples: [first, second] },
      {
        interpretationRef: 'occurrence-b',
        occurrences: [
          { id: 'occurrence-a', sourceRow: 21 },
          { id: 'occurrence-b', sourceRow: 21 },
        ],
      }
    )).toBe(second);
  });

  test('renders backend interpretation spans as character tags', () => {
    expect(visualTeachTagsFromInterpretationSpans('AB@C (MFR)', [
      { start: 0, end: 4, role: 'mpn' },
      { start: 2, end: 3, role: 'insertionMarker' },
      { start: 6, end: 9, role: 'manufacturer' },
    ])).toEqual([
      'mpn', 'mpn', 'insertionMarker', 'mpn', '', '',
      'manufacturer', 'manufacturer', 'manufacturer', '',
    ]);
  });

  test('does not let stale MPN highlighting cover manufacturer and metadata', () => {
    const source = 'EM-827(I) (EMCTW) {HOM} [3266379]';
    const tags = visualTeachTagsFromInterpretationSpans(source, [
      { start: 0, end: 9, role: 'mpn' },
      { start: 11, end: 16, role: 'manufacturer' },
    ]);

    expect(tags.slice(0, 9).every((role) => role === 'mpn')).toBe(true);
    expect(tags.slice(11, 16).every((role) => role === 'manufacturer')).toBe(true);
    expect(tags.slice(17).every((role) => role === '')).toBe(true);
  });

  test('only repeats explicit structural separator selections', () => {
    expect(shouldRepeatVisualTeachGroupSeparator(']')).toBe(true);
    expect(shouldRepeatVisualTeachGroupSeparator(';')).toBe(true);
    expect(shouldRepeatVisualTeachGroupSeparator('@')).toBe(false);
  });

  test('clears only the selected character tags', () => {
    const tags = ['mpn', 'mpn', 'manufacturer', 'manufacturer', 'ignore'];

    expect(clearVisualTeachTagSelection(tags, { start: 3, end: 2 })).toEqual([
      'mpn', 'mpn', '', '', 'ignore',
    ]);
    expect(tags).toEqual(['mpn', 'mpn', 'manufacturer', 'manufacturer', 'ignore']);
  });

  test('normalizes backend rows without deriving field values', () => {
    expect(normalizeVisualTeachEntries([{
      relation: 'Primary',
      fields: { mpn: 'MCT06030D4122B00', manufacturer: 'YAGEO' },
    }])).toEqual([{
      relation: 'Primary',
      fields: {
        cpn: '',
        mpn: 'MCT06030D4122B00',
        manufacturer: 'YAGEO',
        description: '',
        quantity: '',
        uom: '',
        level: '',
        parent: '',
        notes: '',
        internalNotes: '',
      },
      sourceColumns: {},
    }]);
  });
});
