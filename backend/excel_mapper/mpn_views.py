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

        # Check cache first and only validate uncached MPNs
        from .models import GlobalMpnCache
        cached_results = {}
        api_mpns = []
        api_mfrs = []

        for i, (raw_mpn, mfr) in enumerate(zip(mpns, mfrs)):
            norm_mpn = client.normalize_mpn(raw_mpn)
            if not norm_mpn:
                continue

            # Check global cache
            cached_result = GlobalMpnCache.get_cached_result(
                mpn_norm=norm_mpn,
                manufacturer_id=None,  # TODO: Support manufacturer matching
                site=client.site,
                lang=client.lang,
                currency=client.currency
            )

            if cached_result:
                cached_results[norm_mpn] = cached_result
                logger.debug(f"Cache HIT for MPN: {norm_mpn}")
            else:
                api_mpns.append(raw_mpn)
                api_mfrs.append(mfr)
                logger.debug(f"Cache MISS for MPN: {norm_mpn} - needs API validation")

        # Validate uncached MPNs via Digi‑Key API
        api_results = {}
        if api_mpns:
            logger.info(f"Validating {len(api_mpns)} uncached MPNs via Digi-Key API")
            try:
                api_results = client.validate_mpns(api_mpns, api_mfrs)
                logger.info(f"API validation completed for {len(api_results)} MPNs")
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

        # Combine cached and API results
        results_map = {**cached_results, **api_results}

        # Add new columns with validation results to the data
        validation_columns = ['MPN valid', 'MPN Status', 'EOL Status', 'Discontinued', 'DKPN']

        # For canonical MPNs, only add one column (no multiple columns for invalid data)
        validation_columns.append('Canonical MPN')

        # Only add category if there are valid results
        has_valid_results = any(r.get('valid') for r in results_map.values())
        if has_valid_results:
            validation_columns.append('Category')

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

            is_valid = validation_result.get('valid', False)

            rows[i][mpn_valid_idx] = 'Yes' if is_valid else 'No'

            if is_valid:
                # Only populate detailed data for valid MPNs
                rows[i][mpn_status_idx] = lifecycle.get('status') or 'Unknown'
                rows[i][eol_status_idx] = 'Yes' if lifecycle.get('endOfLife') else 'No'
                rows[i][discontinued_idx] = 'Yes' if lifecycle.get('discontinued') else 'No'
                rows[i][dkpn_idx] = validation_result.get('dkpn') or ''
                rows[i][canonical_idx] = validation_result.get('canonical_mpn') or ''

                # Only add category if column exists and MPN is valid
                if 'Category' in headers:
                    category_idx = headers.index('Category')
                    category_info = validation_result.get('category', {}) or {}
                    rows[i][category_idx] = category_info.get('name') or ''
            else:
                # For invalid MPNs, show empty/unknown values
                rows[i][mpn_status_idx] = 'Unknown'
                rows[i][eol_status_idx] = 'No'
                rows[i][discontinued_idx] = 'No'
                rows[i][dkpn_idx] = ''
                rows[i][canonical_idx] = ''

                # Leave category empty for invalid MPNs
                if 'Category' in headers:
                    category_idx = headers.index('Category')
                    rows[i][category_idx] = ''

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

        # Summary with optimized cache reporting
        total_unique = len(seen_norm)
        cache_hits = len(cached_results)
        api_calls = len(api_results)
        total_results = len(results_map)

        invalid = sum(1 for r in results_map.values() if not r.get('valid'))
        valid = total_results - invalid

        return Response({
            'success': True,
            'mpn_header': mpn_header,
            'total_unique': total_unique,
            'cache_hits': cache_hits,
            'api_calls': api_calls,
            'total_validated': total_results,
            'valid': valid,
            'invalid': invalid,
            'optimization_ratio': f"{cache_hits}/{total_unique}" if total_unique > 0 else "0/0",
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


@api_view(['POST'])
def mpn_restore_from_cache(request):
    """Restore MPN validation columns from cache when applying templates.
    Payload: { session_id, mpn_header?: string, manufacturer_header?: string }
    """
    try:
        session_id = request.data.get('session_id')
        if not session_id:
            return Response({ 'success': False, 'error': 'session_id required' }, status=status.HTTP_400_BAD_REQUEST)

        info = get_session_consistent(session_id)
        if not info:
            return Response({ 'success': False, 'error': 'Invalid session' }, status=status.HTTP_404_NOT_FOUND)

        # Build full mapped dataset
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
            return Response({
                'success': False,
                'error': 'MPN column not found',
                'available_headers': headers
            }, status=status.HTTP_400_BAD_REQUEST)

        manufacturer_header = request.data.get('manufacturer_header')
        if manufacturer_header and manufacturer_header not in headers:
            manufacturer_header = None

        # Convert to dict rows
        dict_rows = []
        for row in rows:
            d = {}
            for i, h in enumerate(headers):
                d[h] = row[i] if i < len(row) else ''
            dict_rows.append(d)

        # Extract MPN list and check cache
        from .models import GlobalMpnCache
        client = DigiKeyClient()

        cached_results = {}
        uncached_mpns = []
        uncached_mfrs = []
        seen_norm = set()

        for d in dict_rows:
            raw_mpn = d.get(mpn_header, '')
            norm_mpn = client.normalize_mpn(raw_mpn)
            if not norm_mpn or norm_mpn in seen_norm:
                continue
            seen_norm.add(norm_mpn)

            # Check global cache
            cached_result = GlobalMpnCache.get_cached_result(
                mpn_norm=norm_mpn,
                manufacturer_id=None,  # TODO: Support manufacturer matching
                site=client.site,
                lang=client.lang,
                currency=client.currency
            )

            if cached_result:
                cached_results[norm_mpn] = cached_result
                logger.debug(f"Found cached result for MPN: {norm_mpn}")
            else:
                uncached_mpns.append(raw_mpn)
                uncached_mfrs.append(d.get(manufacturer_header) if manufacturer_header else None)

        # Add validation columns
        validation_columns = ['MPN valid', 'MPN Status', 'EOL Status', 'Discontinued', 'DKPN']

        # Only add one canonical MPN column (simplified approach)
        validation_columns.append('Canonical MPN')

        # Only add category column if there are valid cached results
        has_valid_cached = any(r.get('valid') for r in cached_results.values())
        if has_valid_cached:
            validation_columns.append('Category')

        # Add columns if they don't exist
        columns_added = []
        for col in validation_columns:
            if col not in headers:
                headers.append(col)
                columns_added.append(col)

        # Update rows with cached validation data
        cache_hits = 0
        for i, d in enumerate(dict_rows):
            raw_mpn = d.get(mpn_header, '')
            norm_mpn = client.normalize_mpn(raw_mpn)

            # Ensure row has enough columns
            while len(rows[i]) < len(headers):
                rows[i].append('')

            # Get validation result from cache
            validation_result = cached_results.get(norm_mpn, {})

            if validation_result:
                cache_hits += 1
                is_valid = validation_result.get('valid', False)

                # Set validation data
                if 'MPN valid' in headers:
                    rows[i][headers.index('MPN valid')] = 'Yes' if is_valid else 'No'

                if is_valid:
                    # Only populate detailed data for valid cached MPNs
                    lifecycle = validation_result.get('lifecycle') or {}
                    category_info = validation_result.get('category') or {}

                    if 'MPN Status' in headers:
                        rows[i][headers.index('MPN Status')] = lifecycle.get('status') or 'Unknown'
                    if 'EOL Status' in headers:
                        rows[i][headers.index('EOL Status')] = 'Yes' if lifecycle.get('endOfLife') else 'No'
                    if 'Discontinued' in headers:
                        rows[i][headers.index('Discontinued')] = 'Yes' if lifecycle.get('discontinued') else 'No'
                    if 'DKPN' in headers:
                        rows[i][headers.index('DKPN')] = validation_result.get('dkpn') or ''
                    if 'Canonical MPN' in headers:
                        rows[i][headers.index('Canonical MPN')] = validation_result.get('canonical_mpn') or ''
                    if 'Category' in headers:
                        rows[i][headers.index('Category')] = category_info.get('name') or ''
                else:
                    # Invalid cached MPN: set appropriate values
                    if 'MPN Status' in headers:
                        rows[i][headers.index('MPN Status')] = 'Unknown'
                    if 'EOL Status' in headers:
                        rows[i][headers.index('EOL Status')] = 'No'
                    if 'Discontinued' in headers:
                        rows[i][headers.index('Discontinued')] = 'No'
                    if 'DKPN' in headers:
                        rows[i][headers.index('DKPN')] = ''
                    if 'Canonical MPN' in headers:
                        rows[i][headers.index('Canonical MPN')] = ''
                    if 'Category' in headers:
                        rows[i][headers.index('Category')] = ''
            else:
                # Set empty values for uncached MPNs
                for col in validation_columns:
                    if col in headers:
                        rows[i][headers.index(col)] = ''

        # Update session with enhanced data
        enhanced_result = {
            'headers': headers,
            'data': rows
        }
        info['enhanced_data'] = enhanced_result
        save_session(session_id, info)

        return Response({
            'success': True,
            'mpn_header': mpn_header,
            'cache_hits': cache_hits,
            'uncached_count': len(uncached_mpns),
            'columns_added': columns_added,
            'needs_validation': len(uncached_mpns) > 0,
            'uncached_mpns': uncached_mpns[:10] if uncached_mpns else []  # Sample for debug
        })

    except Exception as e:
        logger.error(f"MPN cache restore failed: {e}")
        return Response({ 'success': False, 'error': str(e) }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
