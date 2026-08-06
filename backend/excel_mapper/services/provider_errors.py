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
