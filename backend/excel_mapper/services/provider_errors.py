"""Errors that mean a provider could not be asked, as opposed to answering "no".

Returning ``None`` for both cases is what let an exhausted API key look like a
clean run: every lookup failed, the columns came back blank, and the parts were
reported as simply "not checked". Distinguishing the two lets validation say
which provider was unreachable and why.
"""


class ProviderUnavailable(Exception):
    """A provider could not answer: bad credentials, quota exhausted, or down.

    ``provider`` identifies which one, ``reason`` is a short machine-readable
    category, and ``str(exc)`` is the message shown to the user.
    """

    def __init__(self, provider, message, reason='error', status_code=None):
        super().__init__(message)
        self.provider = provider
        self.reason = reason
        self.status_code = status_code


def classify_http_failure(provider, status_code, retry_after=None):
    """Turn an HTTP status into a ProviderUnavailable, or None if it is benign.

    Only failures that mean "we never got an answer" are raised. A 404 is a
    genuine "no such part" and must stay a normal negative result.
    """
    if status_code in (401, 403):
        return ProviderUnavailable(
            provider,
            f'{provider.title()} rejected the API key (HTTP {status_code}). '
            'Check the key in Settings.',
            reason='credentials',
            status_code=status_code,
        )
    if status_code == 429:
        hint = ''
        if retry_after:
            try:
                minutes = int(float(retry_after) // 60)
                if minutes > 0:
                    hint = f' Try again in ~{minutes} min.'
            except (TypeError, ValueError):
                hint = ''
        return ProviderUnavailable(
            provider,
            f'{provider.title()} rate limit or quota exceeded (HTTP 429).{hint}',
            reason='rate_limit',
            status_code=429,
        )
    if status_code and status_code >= 500:
        return ProviderUnavailable(
            provider,
            f'{provider.title()} is temporarily unavailable (HTTP {status_code}).',
            reason='upstream',
            status_code=status_code,
        )
    return None


# --- parametric specs -------------------------------------------------------
# Every provider returns its specs as a list of name/value pairs under a
# different key, so the formatting lives here rather than three times over.
#
# Element14 mixes compliance and housekeeping flags into the same array as the
# real specs, and they are not specs - they are already columns of their own, or
# noise. Dropped by name.
ELEMENT14_NON_SPEC_LABELS = {
    'tariffcode', 'eueccn', 'useccn', 'hazardous', 'iscanonical',
    'producttraceability', 'rohscompliant', 'rohsphthalatescompliant', 'svhc',
}

#: Values that mean "this parameter does not apply". Digi-Key writes a bare
#: dash for them, and a column full of "Features: -" helps nobody.
_SPEC_EMPTY_VALUES = {'', '-', '--', 'none', 'null', 'n/a', 'na'}


def format_provider_specs(pairs):
    """Render (name, value) spec pairs as one cell.

    `name: value; name: value` - semicolons because a comma appears inside
    values often enough ("CANbus, FIFO, I2C") that it cannot separate them.

    The pairs are kept in the order the provider sent them: that order is the
    provider's own idea of which spec matters most, and alphabetising it would
    bury the capacitance under "Applications".
    """
    seen = set()
    out = []
    for name, value in pairs or []:
        name = str(name or '').strip()
        value = str(value or '').strip()
        if not name or value.lower() in _SPEC_EMPTY_VALUES:
            continue
        # A provider can repeat a name with different values (Mouser lists
        # Packaging three times, once per option). Keep the first.
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append('%s: %s' % (name, value))
    return '; '.join(out)


# --- alternate comparison ---------------------------------------------------
#: Specs that decide whether a part can stand in for another. A mismatch on
#: one of these outweighs three on mounting notes or temperature grades.
_KEY_SPEC_WORDS = ('capacitance', 'resistance', 'inductance', 'voltage',
                   'tolerance', 'package', 'case', 'current', 'power', 'frequency')
#: How the part is shipped, not what it is. Mouser's specs are often only this,
#: and comparing it would score two identical resistors on their reels.
_SHIPPING_SPECS = {'packaging', 'standard pack qty', 'factory pack quantity'}


def parse_provider_specs(cell):
    """{lower-case name: (name, value)} from a `name: value; name: value` cell."""
    specs = {}
    for part in str(cell or '').split(';'):
        name, sep, value = part.partition(':')
        name, value = name.strip(), value.strip()
        if sep and name and value and name.lower() not in _SHIPPING_SPECS:
            specs.setdefault(name.lower(), (name, value))
    return specs


def compare_specs(primary_cell, alternate_cell):
    """(similarity percent or None, differences) between two parts' specs.

    Only specs both parts state are compared - one provider listing more about
    a part says nothing about the other. Key specs (value, voltage, tolerance,
    package...) count three times. Values are compared ignoring case and
    spacing, so "0.1 µF" and "0.1µF" agree.
    """
    primary = parse_provider_specs(primary_cell)
    alternate = parse_provider_specs(alternate_cell)
    shared = [key for key in primary if key in alternate]
    if not shared:
        return None, []

    def flat(value):
        return ''.join(str(value).lower().split())

    total = matched = 0
    differences = []
    for key in shared:
        weight = 3 if any(word in key for word in _KEY_SPEC_WORDS) else 1
        total += weight
        name, primary_value = primary[key]
        alternate_value = alternate[key][1]
        if flat(primary_value) == flat(alternate_value):
            matched += weight
        else:
            differences.append((weight, '%s: %s vs %s' % (name, alternate_value, primary_value)))
    differences.sort(key=lambda item: -item[0])
    return round(100 * matched / total), [text for _weight, text in differences]


# --- description matching ---------------------------------------------------
#: Words that appear in catalogue copy without saying anything about the part.
#: Scoring them rewards a provider for being wordy.
_DESCRIPTION_STOPWORDS = {
    'the', 'and', 'for', 'with', 'type', 'series', 'new', 'at', 'of', 'to',
}


def _description_tokens(text):
    """The meaningful pieces of a description, upper-cased.

    Split on anything that is not a letter or digit, because the two sides
    punctuate completely differently - a sheet writes
    "CONN/SMD/Push-in CAGE/3P/1R/Female/4mm" where Digi-Key writes
    "CONN TERM BLK 3POS 4MM PCB".
    """
    out = []
    current = []
    for character in str(text or ''):
        if character.isalnum():
            current.append(character.upper())
        elif current:
            out.append(''.join(current))
            current = []
    if current:
        out.append(''.join(current))
    return [token for token in out if token.lower() not in _DESCRIPTION_STOPWORDS]


def _tokens_agree(left, right):
    """Whether two description tokens mean the same thing.

    Exact, or one is the start of the other - "3P" against "3POS", "CONN"
    against "CONNECTOR". Two characters is the floor: below that a single
    digit would match every measurement in the string.
    """
    if left == right:
        return True
    shorter, longer = (left, right) if len(left) <= len(right) else (right, left)
    return len(shorter) >= 2 and longer.startswith(shorter)


def description_match_percent(sheet_text, provider_text):
    """How much of the sheet's description the provider's description confirms.

    Returns 0-100, or None when either side is empty - an absent description is
    not a nought percent match, and a column of zeroes for rows nobody has
    described yet would read as a fleet of bad matches.

    Measured against the SHEET's tokens, not the union: the question is "does
    the provider describe the part we have", and a provider that adds packaging
    and marketing words should not be marked down for it.
    """
    sheet_tokens = _description_tokens(sheet_text)
    provider_tokens = _description_tokens(provider_text)
    if not sheet_tokens or not provider_tokens:
        return None
    matched = sum(
        1 for token in sheet_tokens
        if any(_tokens_agree(token, other) for other in provider_tokens)
    )
    return int(round(100.0 * matched / len(sheet_tokens)))


# --- manufacturer agreement -------------------------------------------------
#: Company-form words that say nothing about which company it is. "WAGO" and
#: "WAGO Corporation" are one manufacturer.
_MANUFACTURER_SUFFIXES = {
    'CORP', 'CORPORATION', 'INC', 'INCORPORATED', 'LTD', 'LIMITED', 'LLC',
    'GMBH', 'CO', 'COMPANY', 'PLC', 'SA', 'AG', 'BV', 'NV', 'KK', 'PTE',
    'PVT', 'PRIVATE', 'HOLDINGS', 'GROUP', 'INTERNATIONAL', 'INDUSTRIES',
    # What a company does, not who it is. Left in, "MURATA MANUFACTURING CO
    # LTD" and Digi-Key's "Murata Electronics" shared no word but the name and
    # read as two manufacturers.
    'MANUFACTURING', 'ELECTRONICS', 'ELECTRONIC', 'SEMICONDUCTOR',
    'SEMICONDUCTORS', 'TECHNOLOGY', 'TECHNOLOGIES', 'COMPONENTS', 'USA',
}

#: Said in the cell when the sheet's chosen manufacturer column is empty. Not
#: "No": we were never told what to check, which is a different answer from
#: having checked and disagreed.
MANUFACTURER_NOT_PROVIDED = 'No manufacturer provided'


def _manufacturer_tokens(name):
    out = []
    current = []
    for character in str(name or ''):
        if character.isalnum():
            current.append(character.upper())
        elif current:
            out.append(''.join(current))
            current = []
    if current:
        out.append(''.join(current))
    tokens = [token for token in out if token not in _MANUFACTURER_SUFFIXES]
    # All suffix and nothing else is not a name; keep the original rather than
    # reduce it to nothing.
    return tokens or out


def manufacturer_agrees(sheet_manufacturer, provider_manufacturer):
    """'Yes', 'No', MANUFACTURER_NOT_PROVIDED, or '' when the provider is silent.

    Blank beats a guess on the provider side: a part the provider never found
    has not been judged, and writing "No" there reads as a contradiction it
    never made.

    Agreement is on words, not characters, because the same manufacturer is
    written at several lengths - "WAGO" / "WAGO Corporation", "AVX" / "KYOCERA
    AVX" after an acquisition. Either name's words being contained in the
    other's is a match, which covers both without inventing an alias table.

    One abbreviation is allowed: a single short word that begins the other's
    first word, so "ST" matches "STMicroelectronics". It can be fooled - "ST"
    would also accept "Stackpole" - but a BOM naming ST against a Stackpole
    part number is a mismatch the MPN and description columns will show.
    """
    sheet_tokens = _manufacturer_tokens(sheet_manufacturer)
    provider_tokens = _manufacturer_tokens(provider_manufacturer)
    if not sheet_tokens:
        return MANUFACTURER_NOT_PROVIDED
    if not provider_tokens:
        return ''
    sheet_set, provider_set = set(sheet_tokens), set(provider_tokens)
    if sheet_set <= provider_set or provider_set <= sheet_set:
        return 'Yes'
    # The same name first is the same company: providers add a division or
    # brand after it - "Vishay General Semiconductor - Diodes Division" for
    # VISHAY INTERTECHNOLOGY, "NXP USA Inc." for NXP SEMICONDUCTORS.
    if sheet_tokens[0] == provider_tokens[0] and len(sheet_tokens[0]) >= 3:
        return 'Yes'
    if len(sheet_tokens) == 1 and len(sheet_tokens[0]) >= 2:
        if provider_tokens[0].startswith(sheet_tokens[0]):
            return 'Yes'
    if len(provider_tokens) == 1 and len(provider_tokens[0]) >= 2:
        if sheet_tokens[0].startswith(provider_tokens[0]):
            return 'Yes'
    return 'No'
