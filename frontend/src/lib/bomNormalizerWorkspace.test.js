import {
  bomNormalizerSourceKey,
  restoreUserRoleSelections,
  restoredConfigureState,
  selectBomNormalizerWorkspaceSnapshot,
  shouldRunBomRoleInference,
  workspaceSnapshotHasSourceRows,
} from './bomNormalizerWorkspace';

describe('BOM normalizer workspace restoration', () => {
  test('does not overwrite restored user selections with fresh inference', () => {
    expect(shouldRunBomRoleInference({
      currentStep: 2,
      parserTouched: true,
      headerCount: 97,
      rowCount: 210,
    })).toBe(false);
  });

  test('still infers mappings for a newly loaded untouched source', () => {
    expect(shouldRunBomRoleInference({
      currentStep: 2,
      parserTouched: false,
      headerCount: 97,
      rowCount: 210,
    })).toBe(true);
  });

  test('preserves an explicitly selected MPN header regardless of header wording', () => {
    const mpnHeader = 'Ref.Fab(Fabricant){Statut}[BI]';

    expect(restoreUserRoleSelections(
      { mpn: mpnHeader, manufacturer: '', cpn: 'Ref. Article' },
      ['Ref. Article', mpnHeader, 'Libelle'],
      ['mpn', 'manufacturer', 'cpn']
    )).toEqual({
      mpn: mpnHeader,
      manufacturer: '',
      cpn: 'Ref. Article',
    });
  });

  test('restores the latest detected setup draft for the same source', () => {
    const workspace = {
      fileName: 'bom.xlsx',
      sheetName: 'Repaired',
      sheetScope: 'single',
      selectedSheetNames: ['Repaired'],
      headerRowIndex: 0,
      preparedHeaders: ['Ref. Article', 'Combined'],
      config: { identityLayout: 'mpn_mfr_cpn_separate' },
    };
    const draft = {
      kind: 'configure-draft',
      sourceKey: bomNormalizerSourceKey(workspace),
      config: {
        identityLayout: 'mpn_mfr_same_cpn_separate',
        rowPlacement: 'same_row',
        alternateLayout: 'already_separate_rows',
        bomLayout: 'none',
      },
    };

    expect(restoredConfigureState(workspace, draft).config).toEqual(draft.config);
    expect(restoredConfigureState(
      workspace,
      { ...draft, sourceKey: 'another-file' }
    ).config).toEqual(workspace.config);
  });

  test('preserves where-are-alternates for a matching route-reconstructed workbook', () => {
    const reconstructedSource = {
      fileName: 'customer-bom.xlsx',
      sheetName: 'Partlist',
      sheetScope: 'single',
      selectedSheetNames: ['Partlist'],
      headerRowIndex: 3,
      preparedHeaders: ['Item', 'MFG Part #', 'Manufacturer'],
    };
    const draft = {
      kind: 'configure-draft',
      sourceKey: bomNormalizerSourceKey(reconstructedSource),
      config: { alternateLayout: 'following_item_rows' },
    };

    expect(restoredConfigureState(reconstructedSource, draft).config.alternateLayout)
      .toBe('following_item_rows');
  });

  test('does not restore where-are-alternates for another route source', () => {
    const reconstructedSource = {
      fileName: 'new-customer-bom.xlsx',
      sheetName: 'Partlist',
      sheetScope: 'single',
      selectedSheetNames: ['Partlist'],
      headerRowIndex: 3,
      preparedHeaders: ['Item', 'MFG Part #', 'Manufacturer'],
      config: { alternateLayout: 'already_separate_rows' },
    };
    const draft = {
      kind: 'configure-draft',
      sourceKey: bomNormalizerSourceKey({
        ...reconstructedSource,
        fileName: 'old-customer-bom.xlsx',
      }),
      config: { alternateLayout: 'following_item_rows' },
    };

    expect(restoredConfigureState(reconstructedSource, draft).config.alternateLayout)
      .toBe('already_separate_rows');
  });

  test('restores durable source rows when the session fallback only retained metadata', () => {
    const source = {
      kind: 'workspace',
      fileName: 'large-bom.xlsx',
      sheetName: 'BOM',
      sheetScope: 'single',
      selectedSheetNames: ['BOM'],
      headerRowIndex: 9,
      preparedHeaders: ['CPN', 'MPN', 'Manufacturer'],
    };
    const sessionSnapshot = {
      ...source,
      savedAt: 20,
      config: { alternateLayout: 'following_item_rows' },
      workbook: { SheetNames: ['BOM'], Sheets: {} },
      sheetRows: [],
      preparedDataRows: [],
    };
    const durableSnapshot = {
      ...source,
      savedAt: 10,
      config: { alternateLayout: 'none' },
      workbook: {
        SheetNames: ['BOM'],
        Sheets: { BOM: { A1: { v: 'CPN' }, A2: { v: 'C-1' }, '!ref': 'A1:C2' } },
      },
      sheetRows: [['CPN', 'MPN', 'Manufacturer'], ['C-1', 'M-1', 'Maker']],
      preparedDataRows: [{ CPN: 'C-1', MPN: 'M-1', Manufacturer: 'Maker' }],
    };

    const restored = selectBomNormalizerWorkspaceSnapshot(sessionSnapshot, durableSnapshot);

    expect(workspaceSnapshotHasSourceRows(sessionSnapshot)).toBe(false);
    expect(workspaceSnapshotHasSourceRows(restored)).toBe(true);
    expect(restored.preparedDataRows).toHaveLength(1);
    expect(restored.config.alternateLayout).toBe('following_item_rows');
  });
});
