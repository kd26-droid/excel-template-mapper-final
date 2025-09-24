"""
MPN OAuth + Validation endpoints
"""
import json
import logging
import re
from typing import List, Optional

from django.http import HttpResponseRedirect
from django.views.decorators.http import require_GET, require_POST
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .services.digikey_service import DigiKeyClient
from .views import get_session_consistent, save_session, apply_column_mappings

logger = logging.getLogger(__name__)


def detect_mpn_header(headers: List[str]) -> Optional[str]:
    if not headers:
        return None
    patterns = [
        r"\bmpn\b",
        r"manufacturer\s*part\s*number",
        r"\bmfr\.?\s*part\s*number",
        r"\bmfg\.?\s*part\s*number",
        r"\bmpn\s*code",
    ]
    def norm(s: str) -> str:
        s = (s or '').lower()
        s = re.sub(r"[\-_]+", " ", s)
        s = re.sub(r"\s+", " ", s).strip()
        return s
    lowered = [norm(h) for h in headers]
    for pat in patterns:
        rx = re.compile(pat, re.IGNORECASE)
        for i, h in enumerate(lowered):
            if rx.search(h):
                return headers[i]
    # fallback weak patterns
    weak = [r"\bpart\s*number\b", r"\bpn\b"]
    for pat in weak:
        rx = re.compile(pat, re.IGNORECASE)
        for i, h in enumerate(lowered):
            if rx.search(h):
                return headers[i]
    return None


@api_view(['GET'])
def mpn_auth_status(request):
    client = DigiKeyClient()
    return Response({ 'authorized': client.is_authorized() })


@require_GET
def mpn_auth_start(request):
    client = DigiKeyClient()
    # Use minimal authorize URL per working example
    url = client.get_authorize_url()
    return HttpResponseRedirect(url)


@api_view(['GET'])
def mpn_auth_callback(request):
    code = request.GET.get('code')
    state = request.GET.get('state')
    if not code:
        return Response({ 'success': False, 'error': 'Missing code' }, status=status.HTTP_400_BAD_REQUEST)
    try:
        client = DigiKeyClient()
        client.exchange_code(code)
        return Response({ 'success': True })
    except Exception as e:
        logger.error(f"OAuth callback failed: {e}")
        return Response({ 'success': False, 'error': str(e) }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def mpn_validate(request):
    """Validate MPNs for a session and persist results.
    Payload: { session_id, mpn_header?: string, manufacturer_header?: string }
    """
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({ 'success': False, 'error': 'session_id required' }, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({ 'success': False, 'error': 'Invalid session' }, status=status.HTTP_404_NOT_FOUND)

        # Build full mapped dataset (no pagination hints)
        mapping = info.get('mappings')
        if not mapping:
            return Response({ 'success': False, 'error': 'No mappings found' }, status=status.HTTP_400_BAD_REQUEST)

        result = apply_column_mappings(
            client_file=info['client_path'],
            mappings=mapping if isinstance(mapping, dict) else { 'mappings': mapping },
            sheet_name=info['sheet_name'],
            header_row=info['header_row'] - 1 if info['header_row'] > 0 else 0,
            session_id=session_id
        )
        headers = result['headers']
        rows = result['data']

        # Determine MPN header
        mpn_header = request.data.get('mpn_header')
        if not mpn_header:
            mpn_header = detect_mpn_header(headers)
        if not mpn_header or mpn_header not in headers:
            return Response({ 'success': False, 'error': 'MPN column not found' }, status=status.HTTP_400_BAD_REQUEST)

        manufacturer_header = request.data.get('manufacturer_header')
        if manufacturer_header and manufacturer_header not in headers:
            manufacturer_header = None

        # Convert to dict rows for easier handling
        dict_rows = []
        for row in rows:
            d = {}
            for i, h in enumerate(headers):
                d[h] = row[i] if i < len(row) else ''
            dict_rows.append(d)

        # Extract MPN list (deduplicate by normalized)
        client = DigiKeyClient()
        mpns: List[str] = []
        mfrs: List[Optional[str]] = []
        seen_norm = set()
        skipped_empty = 0
        for d in dict_rows:
            raw = d.get(mpn_header, '')
            norm = client.normalize_mpn(raw)
            if not norm:
                skipped_empty += 1
                continue
            if norm in seen_norm:
                continue
            seen_norm.add(norm)
            mpns.append(raw)
            mfrs.append(d.get(manufacturer_header) if manufacturer_header else None)

        # Validate via Digi‑Key (with caching)
        try:
            results_map = client.validate_mpns(mpns, mfrs)
        except Exception as e:
            # If it's specifically about credentials, provide helpful message
            if "Not authorized with Digi‑Key" in str(e):
                return Response({
                    'success': False,
                    'error': 'MPN validation failed: Unable to connect to Digi-Key API. Please check credentials.',
                    'code': 'mpn_api_error'
                }, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            else:
                # Other errors - just re-raise to be handled by outer exception handler
                raise

        # Add new columns with validation results to the data
        validation_columns = ['MPN valid', 'MPN Status', 'EOL Status', 'Discontinued', 'DKPN', 'Canonical MPN']

        # Add columns if they don't exist
        for col in validation_columns:
            if col not in headers:
                headers.append(col)

        # Update rows with validation data
        for i, d in enumerate(dict_rows):
            raw_mpn = d.get(mpn_header, '')
            norm_mpn = client.normalize_mpn(raw_mpn)
            validation_result = results_map.get(norm_mpn, {})
            lifecycle = validation_result.get('lifecycle') or {}

            # Ensure row has enough columns
            while len(rows[i]) < len(headers):
                rows[i].append('')

            # Set validation data in the corresponding columns
            mpn_valid_idx = headers.index('MPN valid')
            mpn_status_idx = headers.index('MPN Status')
            eol_status_idx = headers.index('EOL Status')
            discontinued_idx = headers.index('Discontinued')
            dkpn_idx = headers.index('DKPN')
            canonical_idx = headers.index('Canonical MPN')

            rows[i][mpn_valid_idx] = 'Yes' if validation_result.get('valid') else 'No'
            rows[i][mpn_status_idx] = lifecycle.get('status') or 'Unknown'
            rows[i][eol_status_idx] = 'Yes' if lifecycle.get('endOfLife') else 'No'
            rows[i][discontinued_idx] = 'Yes' if lifecycle.get('discontinued') else 'No'
            rows[i][dkpn_idx] = validation_result.get('dkpn') or ''
            rows[i][canonical_idx] = validation_result.get('canonical_mpn') or ''

        # Update the session with enhanced data
        enhanced_result = {
            'headers': headers,
            'data': rows
        }

        # Save enhanced data back to session
        info['enhanced_data'] = enhanced_result

        # Persist results in session
        mpn_validation = info.get('mpn_validation') or {}
        mpn_validation.update({
            'column': mpn_header,
            'site': client.site,
            'lang': client.lang,
            'currency': client.currency,
            'results': { **(mpn_validation.get('results') or {}), **results_map },
            'validation_columns_added': validation_columns
        })
        info['mpn_validation'] = mpn_validation
        save_session(session_id, info)

        # Summary
        total_unique = len(seen_norm)
        validated = len(results_map)
        cached = total_unique - validated if total_unique >= validated else 0
        invalid = sum(1 for r in results_map.values() if not r.get('valid'))
        valid = validated - invalid
        return Response({
            'success': True,
            'mpn_header': mpn_header,
            'total_unique': total_unique,
            'validated': validated,
            'cached': cached,
            'valid': valid,
            'invalid': invalid,
        })
    except Exception as e:
        logger.error(f"MPN validate failed: {e}")
        return Response({ 'success': False, 'error': str(e) }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def mpn_admin_exchange_code(request):
    """Admin helper: exchange an authorization code for tokens and persist.
    Payload: { code }
    This is a one-time bootstrap so future requests run silently.
    """
    try:
        code = request.data.get('code')
        if not code:
            return Response({'success': False, 'error': 'code is required'}, status=status.HTTP_400_BAD_REQUEST)
        client = DigiKeyClient()
        client.exchange_code(code)
        return Response({'success': True})
    except Exception as e:
        logger.error(f"Admin exchange code failed: {e}")
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
def mpn_batch_validate_eol(request):
    """Validate an ad-hoc list of MPNs and return validity + EOL/lifecycle.
    Payload: { mpns: [..], manufacturerId?: int }
    """
    try:
        data = request.data or {}
        mpns = data.get('mpns') or []
        if not isinstance(mpns, list) or len(mpns) == 0:
            return Response({'success': False, 'error': 'mpns (array) required'}, status=status.HTTP_400_BAD_REQUEST)
        manufacturer_id = data.get('manufacturerId')

        client = DigiKeyClient()
        try:
            results_map = client.validate_mpns(mpns, manufacturer_names=None, manufacturer_id=str(manufacturer_id) if manufacturer_id else None)
        except Exception as e:
            # If it's specifically about credentials, provide helpful message
            if "Not authorized with Digi‑Key" in str(e):
                return Response({
                    'success': False,
                    'error': 'MPN validation failed: Unable to connect to Digi-Key API. Please check credentials.',
                    'code': 'mpn_api_error'
                }, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            else:
                # Other errors - just re-raise to be handled by outer exception handler
                raise

        # Build results aligned to input order
        from .services.digikey_service import DigiKeyClient as DK
        norm = DK.normalize_mpn
        out = []
        for raw in mpns:
            n = norm(raw)
            r = results_map.get(n) or {'valid': False}
            out.append({
                'input': raw,
                'valid': bool(r.get('valid')),
                'canonical_mpn': r.get('canonical_mpn'),
                'dkpn': r.get('dkpn'),
                'lifecycle': (r.get('lifecycle') or {}).get('status'),
                'endOfLife': (r.get('lifecycle') or {}).get('endOfLife'),
                'discontinued': (r.get('lifecycle') or {}).get('discontinued'),
                'normallyStocking': (r.get('lifecycle') or {}).get('normallyStocking'),
                'lastBuyChance': (r.get('lifecycle') or {}).get('lastBuyChance'),
            })

        return Response({'success': True, 'results': out})
    except Exception as e:
        logger.error(f"MPN batch validate failed: {e}")
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
