"""Verified FactWise actor identity for BOM pattern ownership.

The mapper does not authenticate users itself.  It validates the caller's
FactWise bearer token against FactWise, verifies that the selected entity is
visible to that token, and only then reads the user identity carried by the
validated token.
"""

import base64
import hashlib
import json
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import requests
from django.core.cache import cache


ACTOR_CACHE_PREFIX = "bom-pattern-actor:v1:"
DEFAULT_ACTOR_CACHE_SECONDS = 300
FACTWISE_IDENTITY_TIMEOUT_SECONDS = 12


class BomPatternIdentityError(ValueError):
    """Raised when a BOM pattern request does not have a verified actor."""


@dataclass(frozen=True)
class BomPatternActor:
    user_id: str
    entity_id: str
    enterprise_id: str


def _clean(value):
    return str(value or "").strip()


def _bearer_token(request):
    authorization = _clean(request.headers.get("Authorization"))
    if not authorization.lower().startswith("bearer "):
        return ""
    return authorization[7:].strip()


def _decode_jwt_claims(token):
    parts = _clean(token).split(".")
    if len(parts) != 3 or parts[0] == "dev":
        return {}
    try:
        encoded = parts[1] + ("=" * (-len(parts[1]) % 4))
        return json.loads(base64.urlsafe_b64decode(encoded.encode("ascii")))
    except (ValueError, TypeError, json.JSONDecodeError):
        return {}


def _token_identity(token):
    parts = _clean(token).split(".")
    if len(parts) == 3 and parts[0] == "dev" and parts[1] and parts[2]:
        return parts[1], parts[2], None

    claims = _decode_jwt_claims(token)
    enterprise_id = _clean(claims.get("extension_EnterpriseId"))
    user_id = _clean(claims.get("extension_EnterpriseUserId"))
    expires_at = claims.get("exp")
    try:
        expires_at = int(expires_at) if expires_at is not None else None
    except (TypeError, ValueError):
        expires_at = None
    return enterprise_id, user_id, expires_at


def _validated_api_url(value):
    api_url = _clean(value).rstrip("/")
    parsed = urlparse(api_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise BomPatternIdentityError("A valid FactWise API URL is required.")
    if parsed.username or parsed.password:
        raise BomPatternIdentityError("The FactWise API URL must not contain credentials.")
    return api_url


def _entity_ids(payload):
    if isinstance(payload, dict):
        rows = payload.get("results") or payload.get("data") or payload.get("entities") or []
    else:
        rows = payload
    if not isinstance(rows, list):
        return set()
    return {
        _clean(row.get("entity_id") or row.get("entityId") or row.get("id"))
        for row in rows
        if isinstance(row, dict)
        and _clean(row.get("entity_id") or row.get("entityId") or row.get("id"))
    }


def _factwise_url_candidates(api_url):
    yield api_url
    for host in ("//localhost:", "//127.0.0.1:"):
        if host in api_url:
            yield api_url.replace(host, "//host.docker.internal:", 1)
            break


def _validate_with_factwise(*, api_url, enterprise_id, entity_id, token):
    path = (
        f"/enterprises/{enterprise_id}/entities"
        if enterprise_id
        else "/organization/entity/"
    )
    response = None
    last_error = None
    for base_url in _factwise_url_candidates(api_url):
        try:
            response = requests.get(
                base_url + path,
                headers={"Authorization": f"Bearer {token}"},
                timeout=FACTWISE_IDENTITY_TIMEOUT_SECONDS,
            )
            break
        except requests.RequestException as exc:
            last_error = exc
    if response is None:
        raise BomPatternIdentityError(
            "FactWise could not be reached to verify pattern ownership."
        ) from last_error
    if response.status_code in {401, 403}:
        raise BomPatternIdentityError(
            "The FactWise session is invalid or has expired."
        )
    if response.status_code >= 400:
        raise BomPatternIdentityError(
            f"FactWise identity verification failed ({response.status_code})."
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise BomPatternIdentityError(
            "FactWise returned an invalid identity response."
        ) from exc
    if entity_id not in _entity_ids(payload):
        raise BomPatternIdentityError(
            "The selected entity is not available to the signed-in FactWise user."
        )


def resolve_bom_pattern_actor(request, *, required=False):
    """Return a verified actor, or ``None`` for an anonymous read request."""
    token = _bearer_token(request)
    entity_id = _clean(request.headers.get("X-FactWise-Entity-Id"))
    api_url_header = _clean(request.headers.get("X-FactWise-Api-Url"))
    enterprise_header = _clean(request.headers.get("X-FactWise-Enterprise-Id"))

    supplied = any((token, entity_id, api_url_header, enterprise_header))
    if not supplied and not required:
        return None
    if not token or not entity_id or not api_url_header:
        raise BomPatternIdentityError(
            "A verified FactWise session and selected entity are required to save patterns."
        )

    api_url = _validated_api_url(api_url_header)
    token_enterprise_id, user_id, expires_at = _token_identity(token)
    enterprise_id = enterprise_header or token_enterprise_id
    if not user_id:
        raise BomPatternIdentityError(
            "The verified FactWise token does not contain a user identity."
        )
    if token_enterprise_id and enterprise_header and token_enterprise_id != enterprise_header:
        raise BomPatternIdentityError(
            "The FactWise token belongs to a different enterprise."
        )

    cache_key = ACTOR_CACHE_PREFIX + hashlib.sha256(
        "\x1f".join((api_url, enterprise_id, entity_id, token)).encode("utf-8")
    ).hexdigest()
    cached = cache.get(cache_key)
    if isinstance(cached, dict):
        return BomPatternActor(**cached)

    _validate_with_factwise(
        api_url=api_url,
        enterprise_id=enterprise_id,
        entity_id=entity_id,
        token=token,
    )

    actor = BomPatternActor(
        user_id=user_id,
        entity_id=entity_id,
        enterprise_id=enterprise_id,
    )
    timeout = DEFAULT_ACTOR_CACHE_SECONDS
    if expires_at is not None:
        timeout = max(1, expires_at - int(time.time()))
    cache.set(cache_key, actor.__dict__, timeout=timeout)
    return actor
