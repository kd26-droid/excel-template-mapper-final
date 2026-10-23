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
