"""Find alternate part-number / maker columns from what the columns contain.

A BOM can carry its alternates in columns of their own::

    Part Number | Approved Make | Alt MPN 1 | Alt Make 1 | Alt MPN 2 | Alt Make 2

The header words are not a reliable way to see that: this one sheet calls them
"Alternate Part Number & Makes 1" over a blank-headed column, and the next sheet
will say something else again. What does not change is what the cells hold, and
`build_column_profiles` has already scored every column's values against the
MPN patterns and the manufacturer directory. This reads those scores.

The browser does no detection of its own: the groups found here come back in
the infer response and are shown as they are.
"""

#: A column counts as an MPN / maker column only above this score.
MIN_COLUMN_SCORE = 0.60

#: How far ahead of the other kind a column's score has to be to be called that
#: kind. An MPN column the directory half-recognises must not become a maker.
MIN_KIND_MARGIN = 0.15

#: Roles whose column is already spoken for - never reused as an alternate.
_ASSIGNED_ROLE_KEYS = (
    "cpn", "mpn", "manufacturer", "description", "quantity", "uom",
    "level", "parent", "notes", "internalNotes",
)


def _column_kind(profile):
    """'mpn', 'mfr' or '' - what this column's values say it holds."""
    scores = profile.get("scores") or {}
    mpn = float(scores.get("mpn") or 0.0)
    mfr = float(scores.get("manufacturer") or 0.0)
    if mfr >= MIN_COLUMN_SCORE and mfr - mpn >= MIN_KIND_MARGIN:
        return "mfr"
    if mpn >= MIN_COLUMN_SCORE and mpn - mfr >= MIN_KIND_MARGIN:
        return "mpn"
    return ""


def infer_alternate_column_groups(profiles, roles):
    """Alternate groups found to the right of the primary MPN column.

    Returns ``{"layout": "separate_columns", "groups": [...]}`` when at least
    one alternate part-number column is found, otherwise ``{}``. Each group is
    ``{"slot", "mpn", "mfr"}`` with ``mfr`` empty when the part number has no
    maker column beside it. Header names are returned exactly as given.
    """
    roles = roles or {}
    by_header = {}
    for profile in profiles or []:
        by_header.setdefault(profile.get("header"), profile)
    primary_mpn = by_header.get(roles.get("mpn"))
    if not primary_mpn:
        return {}
    primary_index = primary_mpn["index"]

    assigned = {
        roles.get(key) for key in _ASSIGNED_ROLE_KEYS if roles.get(key)
    }
    # Only columns after the primary part number, nothing the sheet has
    # already assigned to a field, and nothing too empty to judge.
    candidates = {}
    for profile in profiles or []:
        if profile["index"] <= primary_index:
            continue
        if profile.get("header") in assigned:
            continue
        if not profile.get("sampleSize"):
            continue
        kind = _column_kind(profile)
        if kind:
            candidates[profile["index"]] = (kind, profile)

    groups = []
    used = set()
    for index in sorted(candidates):
        kind, profile = candidates[index]
        if kind != "mpn" or index in used:
            continue
        used.add(index)
        mfr_profile = None
        # The maker sits directly beside its part number: after it, or before
        # it when the sheet puts the maker first.
        for neighbour in (index + 1, index - 1):
            found = candidates.get(neighbour)
            if found and found[0] == "mfr" and neighbour not in used:
                used.add(neighbour)
                mfr_profile = found[1]
                break
        groups.append({
            "slot": str(len(groups) + 1),
            "mpn": profile["header"],
            "mfr": mfr_profile["header"] if mfr_profile else "",
        })

    if not groups:
        return {}
    return {"layout": "separate_columns", "groups": groups}
