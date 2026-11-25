"""
Simple Mouser API client for MPN validation
Mirrors DigiKey service structure
"""
import os
import logging
import requests
from django.core.cache import cache

from .provider_errors import ProviderUnavailable, classify_http_failure, format_provider_specs

logger = logging.getLogger(__name__)


class MouserClient:
    """Mouser API client - simple keyword search only"""

    API_BASE = "https://api.mouser.com/api/v1"

    def __init__(self, credentials=None, allow_env_fallback=True):
        credentials = credentials or {}
        self.api_key = credentials.get('api_key') or (os.environ.get('MOUSER_API_KEY') if allow_env_fallback else None)
        if not self.api_key:
            logger.warning("MOUSER_API_KEY not configured")

    @staticmethod
    def normalize_mpn(mpn: str) -> str:
        """Normalize MPN (same as DigiKey)"""
        if not mpn:
            return ""
        s = str(mpn).replace('\u00A0', ' ').strip().lower()
        s = s.replace(' ', '').replace('-', '')
        for suf in ['g4', 't1', 'tr', 'reel', 'ct']:
            if s.endswith(suf):
                s = s[:-len(suf)]
        return s

    def search_keyword(self, mpn: str):
        """Search Mouser by keyword"""
        if not self.api_key:
            return None

        url = f"{self.API_BASE}/search/keyword"
        params = {"apiKey": self.api_key}
        payload = {
            "SearchByKeywordRequest": {
                "keyword": mpn,
                "records": 10
            }
        }

        try:
            logger.debug(f"🌐 MOUSER_API: Calling search_keyword for MPN: {mpn}")
            resp = requests.post(url, params=params, json=payload, timeout=30)
            # A failure that means we never got an answer must not look like
            # "no match" — otherwise an exhausted key reads as a clean run.
            unavailable = classify_http_failure(
                'mouser', resp.status_code, resp.headers.get('Retry-After')
            )
            if unavailable:
                raise unavailable
            resp.raise_for_status()
            logger.debug(f"✅ MOUSER_API: Got response for MPN: {mpn}")
            return resp.json()
        except ProviderUnavailable:
            raise
        except Exception as e:
            logger.error(f"❌ MOUSER_API: Error for '{mpn}': {e}")
            return None

    def validate_mpn(self, mpn: str):
        """
        Validate single MPN - returns same structure as DigiKey
        Returns: dict with keys: valid, canonical_mpn, all_canonical_mpns, mouser_part_number, lifecycle, category
        """
        if not mpn or not self.api_key:
            return None

        mpn_norm = self.normalize_mpn(mpn)
        from ..models import ProviderMpnCache
        persistent = ProviderMpnCache.get_cached_result('mouser', mpn_norm)
            # A cached answer from before specs were collected cannot answer
            # the question now being asked, so it is a miss, not a hit. Re-fetched
            # once per MPN as each is next used, rather than wiping the cache and
            # paying for every part again at once.
        if persistent is not None and 'specs' in persistent:
            cache.set(f"mouser:mpn:{mpn_norm}", persistent, timeout=60 * 60 * 24)
            return persistent

        # Check cache first
        cache_key = f"mouser:mpn:{mpn_norm}"
        cached = cache.get(cache_key)
        if cached and 'specs' in cached:
            ProviderMpnCache.store_result('mouser', mpn_norm, cached)
            logger.debug(f"💾 MOUSER_CACHE: HIT for {mpn_norm}")
            return cached

        logger.debug(f"🔍 MOUSER_CACHE: MISS for {mpn_norm}, calling API")

        # Call API
        result = self.search_keyword(mpn)
        if not result:
            return None

        parts = result.get('SearchResults', {}).get('Parts', [])
        if not parts:
            # Invalid MPN
            res = {
                'valid': False,
                'canonical_mpn': None,
                'all_canonical_mpns': [],
                'mouser_part_number': None,
                'lifecycle': None,
                'category': None,
                'specs': '',
                'manufacturer': '',
            }
            cache.set(cache_key, res, timeout=60 * 60 * 24)
            ProviderMpnCache.store_result('mouser', mpn_norm, res)
            logger.debug(f"❌ MOUSER_VALIDATE: Invalid MPN {mpn_norm}")
            return res

        # Check for exact match
        first_part = parts[0]
        part_mpn_norm = self.normalize_mpn(first_part.get('ManufacturerPartNumber', ''))

        if part_mpn_norm == mpn_norm:
            # Valid match
            all_mpns = [p.get('ManufacturerPartNumber') for p in parts[:10] if p.get('ManufacturerPartNumber')]

            res = {
                'valid': True,
                'canonical_mpn': first_part.get('ManufacturerPartNumber'),
                'all_canonical_mpns': all_mpns,
                'mouser_part_number': first_part.get('MouserPartNumber'),
                # Mouser's own one-line description of the part.
                'description': str(first_part.get('Description') or '').strip(),
                'lifecycle': {
                    'status': first_part.get('LifecycleStatus') or 'Unknown',
                    'endOfLife': None,  # Mouser doesn't provide this
                    'discontinued': None
                },
                'category': first_part.get('Category'),
                # Mouser's ProductAttributes are packaging and pack-size
                # options, not parametric specs - it has no parametric data on
                # this endpoint. Carried anyway so the column says what Mouser
                # knows rather than staying mysteriously blank.
                'manufacturer': str(first_part.get('Manufacturer') or '').strip(),
                'specs': format_provider_specs(
                    (attribute.get('AttributeName'), attribute.get('AttributeValue'))
                    for attribute in first_part.get('ProductAttributes') or []
                ),
            }
            logger.debug(f"✅ MOUSER_VALIDATE: Valid MPN {mpn_norm} -> {res['canonical_mpn']}")
        else:
            # No exact match
            res = {
                'valid': False,
                'canonical_mpn': None,
                'all_canonical_mpns': [],
                'mouser_part_number': None,
                'lifecycle': None,
                'category': None,
                'specs': '',
                'manufacturer': '',
            }
            logger.debug(f"❌ MOUSER_VALIDATE: No match for {mpn_norm}")

        # Cache result
        cache.set(cache_key, res, timeout=60 * 60 * 24)
        ProviderMpnCache.store_result('mouser', mpn_norm, res)
        return res
