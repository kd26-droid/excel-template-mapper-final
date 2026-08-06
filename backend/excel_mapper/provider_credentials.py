import base64
import hashlib
import json
import os

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import ProviderCredential


PROVIDER_FIELDS = {
    ProviderCredential.PROVIDER_DIGIKEY: {
        'label': 'DigiKey',
        'public': ['client_id', 'redirect_uri'],
        'secret': ['client_secret'],
        'required': ['client_id', 'client_secret'],
    },
    ProviderCredential.PROVIDER_MOUSER: {
        'label': 'Mouser',
        'public': [],
        'secret': ['api_key'],
        'required': ['api_key'],
    },
    ProviderCredential.PROVIDER_ELEMENT14: {
        'label': 'Element14',
        'public': [],
        'secret': ['api_key'],
        'required': ['api_key'],
    },
}


def _fernet():
    digest = hashlib.sha256(settings.SECRET_KEY.encode('utf-8')).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_credentials(payload):
    raw = json.dumps(payload or {}, separators=(',', ':')).encode('utf-8')
    return _fernet().encrypt(raw).decode('utf-8')


def decrypt_credentials(record):
    if not record or not record.encrypted_credentials:
        return {}
    try:
        raw = _fernet().decrypt(record.encrypted_credentials.encode('utf-8'))
        return json.loads(raw.decode('utf-8'))
    except (InvalidToken, ValueError, TypeError, json.JSONDecodeError):
        return {}


def mask_secret(value):
    text = str(value or '')
    if not text:
        return ''
    if len(text) <= 4:
        return '*' * len(text)
    return f"{'*' * max(len(text) - 4, 4)}{text[-4:]}"


def clean_scope_id(value):
    text = str(value or '').strip()
    return text[:120] or 'default'


def provider_configured(provider, credentials):
    rules = PROVIDER_FIELDS.get(provider)
    if not rules:
        return False
    return all(str(credentials.get(field) or '').strip() for field in rules['required'])


def serialize_provider(record):
    provider = record.provider
    rules = PROVIDER_FIELDS.get(provider, {})
    credentials = decrypt_credentials(record)
    has_credentials = provider_configured(provider, credentials)
    public = {
        field: credentials.get(field, '')
        for field in rules.get('public', [])
    }
    masked = {
        field: mask_secret(credentials.get(field, ''))
        for field in rules.get('secret', [])
    }
    return {
        'provider': provider,
        'label': rules.get('label', provider),
        'configured': bool(record.configured and record.last_test_success),
        'has_credentials': has_credentials,
        'public': public,
        'masked': masked,
        'last_test_success': record.last_test_success,
        'last_test_message': record.last_test_message,
        'last_tested_at': record.last_tested_at.isoformat() if record.last_tested_at else None,
        'updated_at': record.updated_at.isoformat() if record.updated_at else None,
    }


def get_saved_provider_credentials(scope_id, provider):
    """Return decrypted credentials for a configured provider scope.

    The caller must decide whether to fall back to local environment variables;
    this helper never reads env secrets.
    """
    clean_scope = clean_scope_id(scope_id)
    try:
        record = ProviderCredential.objects.get(
            scope_id=clean_scope,
            provider=provider,
            configured=True,
        )
    except ProviderCredential.DoesNotExist:
        return {}
    return decrypt_credentials(record)


def request_allows_local_env_credentials(request):
    """Allow env provider keys for localhost, or when explicitly enabled."""
    if str(os.environ.get('ALLOW_PROVIDER_ENV_CREDENTIALS') or '').lower() in {'1', 'true', 'yes', 'on'}:
        return True
    host = ''
    try:
        host = (request.get_host() or '').split(':', 1)[0].lower()
    except Exception:
        host = ''
    return host in {'localhost', '127.0.0.1', '[::1]', '::1'}



# Environment variables that make a provider usable without anyone saving
# credentials in the UI. Reported so the settings screen can offer a provider
# that will actually work, instead of greying it out as "not configured".
PROVIDER_ENV_KEYS = {
    'digikey': ('DIGIKEY_CLIENT_ID', 'DIGIKEY_CLIENT_SECRET'),
    'mouser': ('MOUSER_API_KEY',),
    'element14': ('ELEMENT14_API_KEY',),
}


def provider_env_available(request, provider):
    """True when env credentials exist for this provider and may be used here."""
    keys = PROVIDER_ENV_KEYS.get(provider) or ()
    if not keys or not all(os.environ.get(k) for k in keys):
        return False
    return request_allows_local_env_credentials(request)


@api_view(['GET', 'POST'])
def provider_credentials(request):
    """List or save encrypted MPN provider credentials for a scope.

    POST accepts either:
    {
      "scope_id": "browser-or-workspace-id",
      "providers": {
        "digikey": {"client_id": "...", "client_secret": "...", "redirect_uri": "..."},
        "mouser": {"api_key": "..."},
        "element14": {"api_key": "..."}
      }
    }

    or a single provider payload:
    {"scope_id": "...", "provider": "mouser", "credentials": {"api_key": "..."}}
    """
    scope_id = clean_scope_id(request.data.get('scope_id') if request.method == 'POST' else request.query_params.get('scope_id'))

    if request.method == 'GET':
        records = {
            record.provider: record
            for record in ProviderCredential.objects.filter(scope_id=scope_id)
        }
        providers = []
        for provider, rules in PROVIDER_FIELDS.items():
            record = records.get(provider)
            env_ready = provider_env_available(request, provider)
            if record:
                payload = serialize_provider(record)
                # Saved credentials win, but env keys still make it usable.
                if env_ready and not payload['configured']:
                    payload['configured'] = True
                    payload['from_environment'] = True
                providers.append(payload)
            else:
                providers.append({
                    'provider': provider,
                    'label': rules['label'],
                    'configured': env_ready,
                    'from_environment': env_ready,
                    'public': {},
                    'masked': {},
                    'last_test_success': None,
                    'last_test_message': '',
                    'last_tested_at': None,
                    'updated_at': None,
                })
        return Response({'success': True, 'scope_id': scope_id, 'providers': providers})

    incoming = request.data.get('providers')
    if not isinstance(incoming, dict):
        provider = request.data.get('provider')
        credentials = request.data.get('credentials')
        incoming = {provider: credentials}

    if not isinstance(incoming, dict):
        return Response({'success': False, 'error': 'providers or provider/credentials required'}, status=status.HTTP_400_BAD_REQUEST)

    saved = []
    for provider, credentials in incoming.items():
        if provider not in PROVIDER_FIELDS:
            return Response({'success': False, 'error': f'Unsupported provider: {provider}'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(credentials, dict):
            return Response({'success': False, 'error': f'Credentials for {provider} must be an object'}, status=status.HTTP_400_BAD_REQUEST)

        existing_record = ProviderCredential.objects.filter(scope_id=scope_id, provider=provider).first()
        existing_credentials = decrypt_credentials(existing_record) if existing_record else {}
        allowed_fields = set(PROVIDER_FIELDS[provider]['public'] + PROVIDER_FIELDS[provider]['secret'])
        safe_credentials = {
            field: str(credentials.get(field, existing_credentials.get(field, '')) or '').strip()
            for field in allowed_fields
        }
        credentials_unchanged = bool(existing_record) and safe_credentials == existing_credentials
        keep_verified = bool(
            credentials_unchanged and
            existing_record.configured and
            existing_record.last_test_success and
            provider_configured(provider, safe_credentials)
        )
        record, _ = ProviderCredential.objects.update_or_create(
            scope_id=scope_id,
            provider=provider,
            defaults={
                'encrypted_credentials': encrypt_credentials(safe_credentials),
                'configured': keep_verified,
                'last_test_success': True if keep_verified else None,
                'last_test_message': existing_record.last_test_message if keep_verified else '',
                'last_tested_at': existing_record.last_tested_at if keep_verified else None,
            },
        )
        saved.append(serialize_provider(record))

    return Response({'success': True, 'scope_id': scope_id, 'providers': saved})


@api_view(['DELETE'])
def provider_credential_detail(request, provider):
    scope_id = clean_scope_id(request.query_params.get('scope_id') or request.data.get('scope_id'))
    if provider not in PROVIDER_FIELDS:
        return Response({'success': False, 'error': f'Unsupported provider: {provider}'}, status=status.HTTP_400_BAD_REQUEST)

    deleted, _ = ProviderCredential.objects.filter(scope_id=scope_id, provider=provider).delete()
    return Response({'success': True, 'scope_id': scope_id, 'provider': provider, 'deleted': bool(deleted)})


@api_view(['POST'])
def provider_credential_test(request, provider):
    scope_id = clean_scope_id(request.data.get('scope_id') or request.query_params.get('scope_id'))
    test_mpn = str(request.data.get('mpn') or '1N4148').strip() or '1N4148'
    if provider not in PROVIDER_FIELDS:
        return Response({'success': False, 'error': f'Unsupported provider: {provider}'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        record = ProviderCredential.objects.get(scope_id=scope_id, provider=provider)
    except ProviderCredential.DoesNotExist:
        return Response({
            'success': False,
            'scope_id': scope_id,
            'provider': provider,
            'configured': False,
            'error': 'Provider credentials are not configured',
        }, status=status.HTTP_400_BAD_REQUEST)

    credentials = decrypt_credentials(record)
    if not provider_configured(provider, credentials):
        record.configured = False
        record.last_test_success = False
        record.last_test_message = 'Required details are missing'
        record.last_tested_at = timezone.now()
        record.save(update_fields=['configured', 'last_test_success', 'last_test_message', 'last_tested_at', 'updated_at'])
        return Response({
            'success': False,
            'scope_id': scope_id,
            'provider': provider,
            'configured': False,
            'error': 'Required details are missing',
            'provider_status': serialize_provider(record),
        }, status=status.HTTP_400_BAD_REQUEST)

    success = False
    message = ''

    try:
        if provider == ProviderCredential.PROVIDER_DIGIKEY:
            from .services.digikey_service import DigiKeyClient
            client = DigiKeyClient(credentials=credentials, allow_env_fallback=False)
            token = client.get_client_credentials_token()
            success = bool(token.get('access_token'))
            message = 'Connection successful' if success else 'Details unverified. Please check the entered details.'
        elif provider == ProviderCredential.PROVIDER_MOUSER:
            from .services.mouser_service import MouserClient
            client = MouserClient(credentials=credentials, allow_env_fallback=False)
            result = client.validate_mpn(test_mpn)
            success = bool(result and result.get('valid'))
            message = 'Connection successful' if success else 'Details unverified. Please check the entered details.'
        elif provider == ProviderCredential.PROVIDER_ELEMENT14:
            from .services.element14_service import Element14Client
            client = Element14Client(credentials=credentials, allow_env_fallback=False)
            result = client.search_keyword(test_mpn)
            success = bool(client._products_from_response(result))
            message = 'Connection successful' if success else 'Details unverified. Please check the entered details.'
    except Exception as exc:
        success = False
        raw_message = str(exc)[:500]
        if any(token in raw_message.lower() for token in ['timeout', 'timed out']):
            message = 'Connection timed out. Please try again.'
        elif any(token in raw_message.lower() for token in ['401', 'unauthorized', 'forbidden', 'invalid']):
            message = 'Details unverified. Please check the entered details.'
        else:
            message = 'Details unverified. Please check the entered details.'

    record.configured = success
    record.last_test_success = success
    record.last_test_message = message[:500]
    record.last_tested_at = timezone.now()
    record.save(update_fields=['configured', 'last_test_success', 'last_test_message', 'last_tested_at', 'updated_at'])

    return Response({
        'success': success,
        'scope_id': scope_id,
        'provider': provider,
        'message': message,
        'tested_mpn': test_mpn,
        'provider_status': serialize_provider(record),
    }, status=status.HTTP_200_OK if success else status.HTTP_400_BAD_REQUEST)
