"""The setup a sheet is read with, and the words to say it in.

Until now this lived only in the browser. BomNormalizer.js derives it, shows it
in the Detected setup panel, and lets the person change any of it before a row
is read. An agent session never had any of it: its saved config held one key,
so every one of these ran on a default nobody was shown and nobody agreed to.

The VALUES are the contract - normalisation reads them, and they must match
IDENTITY_LAYOUT_OPTIONS, ROW_PLACEMENT_OPTIONS, BOM_LAYOUT_OPTIONS and
ALTERNATE_LAYOUT_OPTIONS in
frontend/src/lib/bomNormalizerAlgorithmRegistry.js exactly. The wording is the
agent's own, short enough to say in a sentence rather than read off a panel.

Mirrors identityLayoutFromRoles and structureForIdentityLayout in
frontend/src/pages/BomNormalizer.js.
"""

#: Where the part number, the maker and the internal code sit relative to
#: each other. Derived from the columns, never guessed.
IDENTITY_LAYOUTS = {
    'mpn_only': 'only a part number, no maker and no internal code',
    'mpn_mfr_same': 'the part number and the maker share one cell',
    'mpn_mfr_separate': 'the part number and the maker are in their own columns',
    'mpn_cpn_same': 'the part number and the internal code share one cell',
    'mpn_cpn_separate': 'the part number and the internal code are in their own columns',
    'mpn_mfr_cpn_same': 'the part number, the maker and the internal code all share one cell',
    'mpn_mfr_same_cpn_separate': 'the part number and the maker share one cell, the internal code has its own column',
    'mpn_cpn_same_mfr_separate': 'the part number and the internal code share one cell, the maker has its own column',
    'mfr_cpn_same_mpn_separate': 'the maker and the internal code share one cell, the part number has its own column',
    'mpn_mfr_cpn_separate': 'all three are in their own columns',
}

#: Whether one part is one row, or spread down several.
ROW_PLACEMENTS = {
    'same_row': 'one part is one row',
    'cpn_row_mpn_mfr_below': 'an internal-code row, with the part number and maker on rows beneath it',
    'mpn_row_cpn_mfr_below': 'a part-number row, with the internal code and maker on rows beneath it',
    'mfr_row_cpn_mpn_below': 'a maker row, with the internal code and part number on rows beneath it',
    'cpn_mpn_row_mfr_below': 'an internal-code and part-number row, with the maker beneath it',
    'cpn_mfr_row_mpn_below': 'an internal-code and maker row, with the part number beneath it',
    'mpn_mfr_row_cpn_below': 'a part-number and maker row, with the internal code beneath it',
    'separate_linked_rows': 'the internal code, the part number and the maker each on their own linked row',
}

#: Where a line's other approved parts are written.
ALTERNATE_LAYOUTS = {
    'inside_selected_mpn_columns': 'in the same cell as the part it stands in for',
    'separate_columns': 'in columns of their own',
    'already_separate_rows': 'there are no alternates',
    'same_group_rows': 'on other rows carrying the same group key',
    'following_rows': 'on the rows directly beneath the primary part',
    'following_item_rows': 'an item row, then the primary and its alternates on the rows beneath',
}

#: Whether the sheet is one BOM or several laid out together.
BOM_LAYOUTS = {
    'none': 'one straightforward BOM',
    'assembly_quantity_matrix': 'a matrix, with one column of quantities per assembly',
    'multi_block_assembly': 'several assemblies stacked in blocks down the sheet',
}

#: Each setting the person is asked to confirm: the key normalisation reads, the
#: question in their words, the table of what each value means, and what is used
#: when nothing has been chosen.
SETTINGS = (
    ('identityLayout',
     'Where the part number, the maker and the internal code sit',
     IDENTITY_LAYOUTS, ''),
    ('rowPlacement',
     'Whether one part is one row',
     ROW_PLACEMENTS, 'same_row'),
    ('alternateLayout',
     "Where a line's other approved parts are",
     ALTERNATE_LAYOUTS, 'inside_selected_mpn_columns'),
    ('bomLayout',
     'Whether the sheet holds one BOM or several',
     BOM_LAYOUTS, 'none'),
)


def identity_layout_from_roles(roles=None, config=None):
    """Which of the ten identity layouts the confirmed columns describe.

    Read off the columns rather than the cells: two roles pointing at one column
    IS the statement that both live in that cell. Nothing here inspects a value,
    so it costs nothing and cannot be wrong about a sheet it has not sampled.
    """
    roles = roles or {}
    config = config or {}
    chosen = str(config.get('identityLayout') or '').strip()
    if chosen:
        return chosen

    mpn = str(roles.get('mpn') or '').strip()
    mfr = str(roles.get('manufacturer') or '').strip()
    cpn = str(roles.get('cpn') or '').strip()
    mpn_mfr_same = bool(mpn and mfr and mpn == mfr)
    mpn_cpn_same = bool(mpn and cpn and mpn == cpn)
    mfr_cpn_same = bool(mfr and cpn and mfr == cpn)

    if mpn and not mfr and not cpn:
        return 'mpn_only'
    if mpn and mfr and not cpn:
        return 'mpn_mfr_same' if mpn_mfr_same else 'mpn_mfr_separate'
    if mpn and not mfr and cpn:
        return 'mpn_cpn_same' if mpn_cpn_same else 'mpn_cpn_separate'
    if mpn and mfr and cpn:
        if mpn_mfr_same and mpn_cpn_same:
            return 'mpn_mfr_cpn_same'
        if mpn_mfr_same:
            return 'mpn_mfr_same_cpn_separate'
        if mpn_cpn_same:
            return 'mpn_cpn_same_mfr_separate'
        if mfr_cpn_same:
            return 'mfr_cpn_same_mpn_separate'
        return 'mpn_mfr_cpn_separate'
    if not mpn and mfr and cpn and mfr_cpn_same:
        return 'mfr_cpn_same_mpn_separate'
    return 'mpn_mfr_cpn_separate'


def structure_for_identity_layout(identity_layout, config=None):
    """The parser's own name for that layout once the alternates are known.

    `structure` is what normalisation actually branches on. It is not a fifth
    thing to ask about - it falls out of the identity layout and where the
    alternates are - so it is computed rather than offered.
    """
    config = config or {}
    packed = (config.get('alternateLayout')
              or 'inside_selected_mpn_columns') == 'inside_selected_mpn_columns'

    if identity_layout == 'mpn_only':
        return 'mpn_only_same_cell' if packed else 'mpn_only_rows'
    if identity_layout in ('mpn_mfr_same', 'mpn_mfr_cpn_same',
                           'mpn_mfr_same_cpn_separate'):
        return 'same_cell'
    if identity_layout == 'mpn_mfr_separate':
        return 'separate_cells' if packed else 'one_per_row'
    if identity_layout in ('mpn_cpn_same', 'mpn_cpn_separate'):
        return 'mpn_only_same_cell' if packed else 'mpn_only_rows'
    return 'separate_cells' if packed else 'one_per_row'


def detected_setup(roles=None, config=None):
    """Every setting, what it is set to, and what else it could be."""
    roles = roles or {}
    config = config or {}
    out = []
    for key, question, table, default in SETTINGS:
        if key == 'identityLayout':
            value = identity_layout_from_roles(roles, config)
        else:
            value = str(config.get(key) or default)
        out.append({
            'setting': key,
            'question': question,
            'value': value,
            'reads_as': table.get(value, value),
            # A default nobody chose reads exactly like a decision until it is
            # said which one this is.
            'chosen_by_them': bool(str(config.get(key) or '').strip()),
            'options': [{'value': option, 'reads_as': words}
                        for option, words in table.items()],
        })
    return out


def setup_config(roles=None, config=None):
    """The config these settings amount to, with `structure` worked out."""
    config = dict(config or {})
    identity_layout = identity_layout_from_roles(roles, config)
    applied = {
        'identityLayout': identity_layout,
        'structure': structure_for_identity_layout(identity_layout, config),
    }
    for key, _question, _table, default in SETTINGS:
        if key == 'identityLayout':
            continue
        applied[key] = str(config.get(key) or default)
    return applied


def setting_table(setting):
    """The options for one setting, or None when there is no such setting."""
    for key, _question, table, _default in SETTINGS:
        if key == setting:
            return table
    return None

#: Which of a primary part's values its alternates copy when the sheet leaves
#: them blank. Mirrors ALTERNATE_INHERIT_FIELD_OPTIONS in
#: frontend/src/pages/BomNormalizer.js. Nothing is copied unless it is chosen -
#: an alternate that inherits a quantity nobody asked it to inherit is a
#: quantity the sheet never stated.
ALTERNATE_INHERIT_FIELDS = {
    'cpn': 'the internal part number',
    'description': 'the description',
    'quantity': 'the quantity',
    'uom': 'the unit of measure',
    'level': 'the BOM level',
    'parent': 'the parent or group key',
    'notes': 'the notes',
    'internalNotes': 'the internal notes',
}

#: Rows the parser can be told to ignore, and the one reading rule that is not
#: about ignoring anything. Mirrors CLEANUP_OPTIONS in
#: frontend/src/lib/bomNormalizerAlgorithmRegistry.js.
#:
#: These are the settings that differ from sheet to sheet, and that is not a
#: quirk: the page only offers the ones the backend actually found, counted in
#: `cleanupDetections`. A sheet with no title rows is never asked about title
#: rows. Offering all six every time would ask people about rows their file
#: does not contain.
CLEANUP_TOGGLES = {
    'skipTitleRows': 'ignore the category and title rows inside the BOM',
    'skipRepeatedHeaders': 'ignore header rows repeated further down',
    'skipDoNotPopulate': 'ignore the rows marked Do Not Populate',
    'skipDeletedRows': 'ignore the deleted and struck-through rows',
    'skipSummaryRows': 'ignore the summary and total rows',
    'parentPathLevels': ('read the BOM level and the part number out of the '
                         'parent trail rather than their own columns'),
}

#: What each toggle does when nobody has said otherwise. Mirrors the defaults in
#: BomNormalizer.js; skipDoNotPopulate is off because an unfitted part is still
#: a part somebody may want on the BOM.
CLEANUP_DEFAULTS = {
    'skipTitleRows': True,
    'skipRepeatedHeaders': True,
    'skipDoNotPopulate': False,
    'skipDeletedRows': True,
    'skipSummaryRows': True,
    'parentPathLevels': True,
}


def inherit_fields(config=None):
    """Which values the alternates copy, with anything unrecognised dropped."""
    config = config or {}
    chosen = config.get('alternateInheritFields')
    if not isinstance(chosen, (list, tuple)):
        return []
    return [field for field in chosen if field in ALTERNATE_INHERIT_FIELDS]


def detected_toggles(config=None, cleanup_detections=None):
    """The row rules worth asking about, and how many rows each one found.

    Only what was detected. `cleanup_detections` is the backend's own count per
    rule, and a count of zero means this sheet has no such rows.
    """
    config = config or {}
    counts = cleanup_detections or {}
    out = []
    for key, words in CLEANUP_TOGGLES.items():
        found = int(counts.get(key) or 0)
        if found <= 0:
            continue
        stated = config.get(key)
        out.append({
            'setting': key,
            'reads_as': words,
            'on': bool(CLEANUP_DEFAULTS.get(key, False)
                       if stated is None else stated),
            'rows_found': found,
            'chosen_by_them': stated is not None,
        })
    return out
