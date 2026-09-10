import {
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
    expect(visualTeachTagsFromInterpretationSpans('ABC (MFR)', [
      { start: 0, end: 3, role: 'mpn' },
      { start: 5, end: 8, role: 'manufacturer' },
    ])).toEqual([
      'mpn', 'mpn', 'mpn', '', '',
      'manufacturer', 'manufacturer', 'manufacturer', '',
    ]);
  });

  test('only repeats explicit structural separator selections', () => {
    expect(shouldRepeatVisualTeachGroupSeparator(']')).toBe(true);
    expect(shouldRepeatVisualTeachGroupSeparator(';')).toBe(true);
    expect(shouldRepeatVisualTeachGroupSeparator('@')).toBe(false);
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
