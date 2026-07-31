"""
Element14 / Farnell / Newark API client for MPN validation.
"""
import logging
import os

import requests
from django.core.cache import cache

logger = logging.getLogger(__name__)


class Element14Client:
    """Element14 Product Search client."""

    API_BASE = "https://api.element14.com/catalog/products"

    def __init__(self, credentials=None, allow_env_fallback=True):
        credentials = credentials or {}
        self.api_key = credentials.get('api_key') or (os.environ.get('ELEMENT14_API_KEY') if allow_env_fallback else None)
        self.store_id = os.environ.get('ELEMENT14_STORE_ID', 'in.element14.com')
        if not self.api_key:
            logger.warning("ELEMENT14_API_KEY not configured")

    @staticmethod
    def normalize_mpn(mpn: str) -> str:
        if not mpn:
            return ""
        s = str(mpn).replace('\u00A0', ' ').strip().lower()
        s = s.replace(' ', '').replace('-', '')
        for suf in ['g4', 't1', 'tr', 'reel', 'ct']:
            if s.endswith(suf):
                s = s[:-len(suf)]
        return s

    def search_keyword(self, mpn: str):
        if not self.api_key:
            return None

        params = {
            'term': f'manuPartNum:{mpn}',
            'storeInfo.id': self.store_id,
            'resultsSettings.offset': 0,
            'resultsSettings.numberOfResults': 10,
            'resultsSettings.responseGroup': 'medium',
            'callInfo.responseDataFormat': 'json',
            'callInfo.apiKey': self.api_key,
        }

        try:
            logger.debug("ELEMENT14_API: searching MPN %s", mpn)
            resp = requests.get(self.API_BASE, params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            logger.error("ELEMENT14_API: error for '%s': %s", mpn, exc)
            return None

    def _products_from_response(self, result):
        if not isinstance(result, dict):
            return []
        products = result.get('products')
        if isinstance(products, list):
            return products
        product = result.get('product')
        if isinstance(product, list):
            return product
        if isinstance(product, dict):
            return [product]
        return []

    def validate_mpn(self, mpn: str):
        if not mpn or not self.api_key:
            return None

        mpn_norm = self.normalize_mpn(mpn)
        cache_key = f"element14:mpn:{self.store_id}:{mpn_norm}"
        cached = cache.get(cache_key)
        if cached:
            return cached

        result = self.search_keyword(mpn)
        if not result:
            return None

        products = self._products_from_response(result)
        if not products:
            res = {
                'valid': False,
                'canonical_mpn': None,
                'all_canonical_mpns': [],
                'element14_part_number': None,
                'lifecycle': None,
                'category': None,
            }
            cache.set(cache_key, res, timeout=60 * 60 * 12)
            return res

        first = products[0]
        candidates = []
        for product in products[:10]:
            candidate = product.get('translatedManufacturerPartNumber') or product.get('manufacturerPartNumber') or product.get('sku')
            if candidate:
                candidates.append(candidate)

        canonical = candidates[0] if candidates else None
        valid = self.normalize_mpn(canonical) == mpn_norm if canonical else False
        category = (
            first.get('categoryName')
            or first.get('displayName')
            or first.get('productStatus')
            or None
        )

        res = {
            'valid': valid,
            'canonical_mpn': canonical if valid else None,
            'all_canonical_mpns': candidates if valid else [],
            'element14_part_number': first.get('sku') or first.get('id'),
            'lifecycle': {
                'status': first.get('productStatus') or 'Unknown',
                'endOfLife': None,
                'discontinued': None,
            } if valid else None,
            'category': category if valid else None,
        }
        cache.set(cache_key, res, timeout=60 * 60 * 12)
        return res
