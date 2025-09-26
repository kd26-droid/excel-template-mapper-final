"""
Digi‑Key OAuth + Product validation service
Implements 3‑legged OAuth, token refresh, and MPN validation helpers.
"""
from __future__ import annotations

import os
import time
import json
import logging
import datetime as dt
from typing import Dict, Any, List, Optional, Tuple

import requests
from django.conf import settings
from django.utils import timezone
from django.core.cache import cache

from ..models import MpnOAuthToken

logger = logging.getLogger(__name__)


class DigiKeyClient:
    AUTH_BASE = "https://api.digikey.com/v1/oauth2"
    PROD_BASE = "https://api.digikey.com/products/v4"

    def __init__(self):
        # Best-effort load of a local .env file to ease dev setups
        self._load_local_env()
        self.client_id = os.environ.get('DIGIKEY_CLIENT_ID')
        self.client_secret = os.environ.get('DIGIKEY_CLIENT_SECRET')
        self.redirect_uri = os.environ.get('DIGIKEY_REDIRECT_URI')
        self.scope = os.environ.get('DIGIKEY_SCOPE', 'productinformation')
        # Locale headers – defaults match mpn_check.sh
        self.site = os.environ.get('DIGIKEY_SITE', 'IN')
        self.lang = os.environ.get('DIGIKEY_LANG', 'en')
        self.currency = os.environ.get('DIGIKEY_CUR', 'INR')

        if not self.client_id or not self.client_secret or not self.redirect_uri:
            logger.warning("Digi‑Key OAuth env vars missing: DIGIKEY_CLIENT_ID/SECRET/REDIRECT_URI")

    def _load_local_env(self):
        """Load key=value lines from a .env file (no external dependency).
        Looks for backend/.env relative to Django BASE_DIR.
        """
        try:
            from django.conf import settings as dj_settings
            base = getattr(dj_settings, 'BASE_DIR', None)
            if not base:
                return
            # Project BASE_DIR points to backend/excel_mapping; .env lives one level up (backend/.env)
            env_paths = [
                os.path.join(str(base), '.env'),
                os.path.join(str(base), '..', '.env'),
            ]
            for p in env_paths:
                p = os.path.abspath(p)
                if os.path.exists(p):
                    with open(p, 'r') as f:
                        for line in f:
                            s = line.strip()
                            if not s or s.startswith('#'):
                                continue
                            if '=' not in s:
                                continue
                            k, v = s.split('=', 1)
                            k = k.strip()
                            v = v.strip()
                            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                                v = v[1:-1]
                            # Don't overwrite process env if already set
                            if k not in os.environ:
                                os.environ[k] = v
                    break
        except Exception as e:
            logger.debug(f".env load skipped: {e}")

    # ---------------- OAuth helpers ----------------
    def get_authorize_url(self) -> str:
        """Build minimal authorize URL as per working example.
        Only include response_type, client_id, redirect_uri.
        """
        from urllib.parse import urlencode
        params = {
            'response_type': 'code',
            'client_id': self.client_id,
            'redirect_uri': self.redirect_uri,
        }
        return f"{self.AUTH_BASE}/authorize?{urlencode(params)}"

    def exchange_code(self, code: str) -> Dict[str, Any]:
        data = {
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'code': code,
            'grant_type': 'authorization_code',
            'redirect_uri': self.redirect_uri,
        }
        resp = requests.post(f"{self.AUTH_BASE}/token", data=data, timeout=30)
        resp.raise_for_status()
        token = resp.json()
        self._persist_token(token)
        return token

    def refresh(self) -> Dict[str, Any]:
        tok = self._get_token()
        if not tok:
            raise RuntimeError("No refresh token stored")

        # If no refresh token, fall back to client credentials
        if not tok.refresh_token:
            return self.get_client_credentials_token()

        data = {
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'grant_type': 'refresh_token',
            'refresh_token': tok.refresh_token,
        }
        resp = requests.post(f"{self.AUTH_BASE}/token", data=data, timeout=30)
        resp.raise_for_status()
        token = resp.json()
        self._persist_token(token)
        return token

    def get_client_credentials_token(self) -> Dict[str, Any]:
        """Get a new token using client credentials flow"""
        data = {
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'grant_type': 'client_credentials',
            'scope': self.scope,
        }
        resp = requests.post(f"{self.AUTH_BASE}/token", data=data, timeout=30)
        resp.raise_for_status()
        token = resp.json()
        self._persist_token(token)
        return token

    def is_authorized(self) -> bool:
        tok = self._get_token()
        if not tok:
            # Try to get a token using client credentials
            try:
                self.get_client_credentials_token()
                tok = self._get_token()
            except Exception:
                return False

        # Check if token is still valid with 60s buffer
        return tok and tok.expires_at > timezone.now() + dt.timedelta(seconds=60)

    def ensure_access_token(self) -> str:
        tok = self._get_token()

        # If no token exists, get one using client credentials
        if not tok:
            try:
                self.get_client_credentials_token()
                tok = self._get_token()
            except Exception as e:
                logger.error(f"Failed to get client credentials token: {e}")
                raise RuntimeError("Not authorized with Digi‑Key - failed to get token")

        # If token is expired or about to expire, refresh it
        if tok.expires_at <= timezone.now() + dt.timedelta(seconds=60):
            try:
                self.refresh()
                tok = self._get_token()
            except Exception as e:
                logger.warning(f"Digi‑Key refresh failed, trying client credentials: {e}")
                try:
                    self.get_client_credentials_token()
                    tok = self._get_token()
                except Exception as e2:
                    logger.error(f"Client credentials fallback failed: {e2}")
                    raise RuntimeError("Not authorized with Digi‑Key - token refresh failed")

        return tok.access_token

    def _get_token(self) -> Optional[MpnOAuthToken]:
        try:
            return MpnOAuthToken.objects.order_by('-updated_at').first()
        except Exception:
            return None

    def _persist_token(self, token: Dict[str, Any]):
        # token contains: access_token, token_type, expires_in, refresh_token, scope
        expires_in = int(token.get('expires_in', 3600))
        expires_at = timezone.now() + dt.timedelta(seconds=expires_in)
        obj = self._get_token()
        if not obj:
            obj = MpnOAuthToken()
        obj.access_token = token.get('access_token', '')
        obj.refresh_token = token.get('refresh_token', '')
        obj.token_type = token.get('token_type', 'Bearer')
        obj.scope = token.get('scope', '') or self.scope
        obj.expires_at = expires_at
        obj.site = self.site
        obj.lang = self.lang
        obj.currency = self.currency
        obj.save()

    # ---------------- HTTP helpers ----------------
    def _headers(self, access_token: str) -> Dict[str, str]:
        return {
            'Authorization': f"Bearer {access_token}",
            'X-DIGIKEY-Client-Id': self.client_id or '',
            'X-DIGIKEY-Locale-Site': self.site,
            'X-DIGIKEY-Locale-Language': self.lang,
            'X-DIGIKEY-Locale-Currency': self.currency,
            'Accept': 'application/json',
        }

    def _backoff(self, attempt: int) -> float:
        import random
        base = min(2 ** attempt, 32)
        return base + random.random()

    def _request(self, method: str, url: str, **kwargs) -> requests.Response:
        access = self.ensure_access_token()
        headers = kwargs.pop('headers', {})
        headers.update(self._headers(access))
        attempt = 0
        while True:
            resp = requests.request(method, url, headers=headers, timeout=30, **kwargs)
            if resp.status_code == 401:
                # try refresh once
                self.refresh()
                headers.update(self._headers(self._get_token().access_token))
                resp = requests.request(method, url, headers=headers, timeout=30, **kwargs)
            if resp.status_code in (429, 502, 503, 504):
                attempt += 1
                if attempt > 5:
                    resp.raise_for_status()
                # honor Retry-After
                ra = resp.headers.get('Retry-After')
                if ra:
                    try:
                        time.sleep(float(ra))
                    except Exception:
                        time.sleep(self._backoff(attempt))
                else:
                    time.sleep(self._backoff(attempt))
                continue
            resp.raise_for_status()
            return resp

    # ---------------- MPN utilities ----------------
    @staticmethod
    def normalize_mpn(mpn: str) -> str:
        if mpn is None:
            return ''
        s = str(mpn)
        s = s.replace('\u00A0', ' ').strip()
        s = s.lower()
        # remove spaces and hyphens
        s = s.replace(' ', '').replace('-', '')
        # remove common vendor suffixes at end
        suffixes = ['g4', 't1', 'tr', 'reel', 'ct']
        for suf in suffixes:
            if s.endswith(suf):
                s = s[: -len(suf)]
        return s

    def _cache_key(self, mpn_norm: str, manufacturer_id: Optional[str]) -> str:
        mid = manufacturer_id or 'any'
        return f"dk:mpn:{mpn_norm}:{mid}:{self.site}:{self.lang}:{self.currency}"

    def search_keyword(self, mpn: str, manufacturer_id: Optional[str] = None) -> Dict[str, Any]:
        body = {'Keywords': mpn, 'RecordCount': 10}
        if manufacturer_id:
            body['Filters'] = {'ManufacturerIds': [int(manufacturer_id)]}
        resp = self._request('POST', f"{self.PROD_BASE}/search/keyword", json=body,
                              headers={'Content-Type': 'application/json'})
        return resp.json()

    def product_details(self, dkpn: str) -> Dict[str, Any]:
        resp = self._request('GET', f"{self.PROD_BASE}/search/{dkpn}/productdetails")
        return resp.json()

    def pick_dkpn(self, search_json: Dict[str, Any]) -> Optional[str]:
        try:
            variations = None
            exact = search_json.get('ExactMatches') or []
            products = search_json.get('Products') or []
            if exact:
                variations = exact[0].get('ProductVariations')
            elif products:
                variations = products[0].get('ProductVariations')
            if not variations:
                return None
            # prefer Cut Tape (CT)
            for v in variations:
                try:
                    if (v.get('PackageType') or {}).get('Name') == 'Cut Tape (CT)':
                        return v.get('DigiKeyProductNumber')
                except Exception:
                    pass
            return variations[0].get('DigiKeyProductNumber')
        except Exception:
            return None

    def is_valid_match(self, search_json: Dict[str, Any], mpn_norm: str, manufacturer_name: Optional[str]) -> Tuple[bool, Optional[str], List[str]]:
        """
        Validate MPN against DigiKey search results.

        STRICT VALIDATION RULES:
        - Returns valid=True ONLY if there's an exact normalized match
        - For nonsensical MPNs like "MPN1" with no exact match: returns valid=False
        - Canonical MPNs are provided as suggestions even when invalid
        - This prevents false positives for random/test MPNs

        EXAMPLES:
        - Input: "LM358" -> Search finds "LM358N", "LM358P" -> normalized "lm358" != "lm358n" -> valid=False, suggestions provided
        - Input: "LM358N" -> Search finds "LM358N" -> normalized "lm358n" == "lm358n" -> valid=True
        - Input: "MPN1" -> Search finds random results -> no exact match -> valid=False, suggestions provided

        Returns: (valid, primary_canonical_mpn, all_canonical_mpns)
        """
        def norm(s: str) -> str:
            return self.normalize_mpn(s)

        # Package name mapping from DigiKey format to standard format
        def format_package_name(pkg_name: str) -> str:
            """Convert DigiKey package names to standard format"""
            if not pkg_name:
                return ""

            # Common package mappings
            pkg_mapping = {
                "8-SOIC (0.154\", 3.90mm Width)": "SOIC-8",
                "8-DIP (0.300\", 7.62mm)": "DIP-8",
                "14-SOIC (0.154\", 3.90mm Width)": "SOIC-14",
                "14-DIP (0.300\", 7.62mm)": "DIP-14",
                "16-SOIC (0.154\", 3.90mm Width)": "SOIC-16",
                "16-DIP (0.300\", 7.62mm)": "DIP-16",
                "8-TSSOP (0.173\", 4.40mm Width)": "TSSOP-8",
                "14-TSSOP (0.173\", 4.40mm Width)": "TSSOP-14",
                "48-UFQFPN Exposed Pad": "UFQFPN48",
                "64-LQFP (10x10)": "LQFP64",
                "100-LQFP (14x14)": "LQFP100",
                "Cut Tape (CT)": "CT",
                "Tape & Reel (TR)": "TR",
            }

            # Check for exact matches first
            if pkg_name in pkg_mapping:
                return pkg_mapping[pkg_name]

            # Extract common patterns if no exact match
            import re

            # Pattern for SOIC packages: "N-SOIC (...)" -> "SOIC-N"
            soic_match = re.search(r'(\d+)-SOIC', pkg_name)
            if soic_match:
                return f"SOIC-{soic_match.group(1)}"

            # Pattern for DIP packages: "N-DIP (...)" -> "DIP-N"
            dip_match = re.search(r'(\d+)-DIP', pkg_name)
            if dip_match:
                return f"DIP-{dip_match.group(1)}"

            # Pattern for LQFP packages: "N-LQFP (...)" -> "LQFP-N"
            lqfp_match = re.search(r'(\d+)-LQFP', pkg_name)
            if lqfp_match:
                return f"LQFP{lqfp_match.group(1)}"

            # Pattern for TSSOP packages: "N-TSSOP (...)" -> "TSSOP-N"
            tssop_match = re.search(r'(\d+)-TSSOP', pkg_name)
            if tssop_match:
                return f"TSSOP-{tssop_match.group(1)}"

            # If no pattern matches, return a simplified version
            simplified = re.sub(r'\([^)]*\)', '', pkg_name).strip()
            return simplified if simplified else pkg_name

        # Collect canonical MPNs with package information
        mpn_to_package = {}  # Map MPN -> package info
        cands = []

        for source in ('ExactMatches', 'Products'):
            for p in (search_json.get(source) or []):
                m = (p.get('ManufacturerProductNumber') or '')
                if m and m not in cands:  # Avoid duplicates
                    cands.append(m)

                    # Extract package information from ProductVariations
                    variations = p.get('ProductVariations') or []
                    if variations and len(variations) > 0:
                        # Use first variation's package info (or find Cut Tape if available)
                        pkg_info = None
                        for v in variations:
                            pkg_type = (v.get('PackageType') or {}).get('Name', '')
                            if pkg_type == 'Cut Tape (CT)':
                                pkg_info = pkg_type
                                break
                            elif not pkg_info:  # Use first available if no Cut Tape found
                                pkg_info = pkg_type

                        if pkg_info:
                            formatted_pkg = format_package_name(pkg_info)
                            if formatted_pkg and formatted_pkg != 'CT':  # Don't show CT in brackets
                                mpn_to_package[m] = formatted_pkg

        # Remove empty strings and limit to reasonable number (max 10)
        raw_mpns = [c for c in cands if c.strip()][:10]

        if not raw_mpns:
            return False, None, []

        # Format canonical MPNs with package information in brackets
        all_canonical_mpns = []
        for mpn in raw_mpns:
            if mpn in mpn_to_package:
                formatted_mpn = f"{mpn} ({mpn_to_package[mpn]})"
            else:
                formatted_mpn = mpn
            all_canonical_mpns.append(formatted_mpn)

        # CRITICAL FIX: Only return True if there's an exact normalized match
        # Find exact match by normalized comparison (using raw MPN for comparison)
        exact_match_found = False
        primary_canonical = None

        for i, raw_mpn in enumerate(raw_mpns):
            if norm(raw_mpn) == mpn_norm:
                primary_canonical = all_canonical_mpns[i]  # Use formatted version
                exact_match_found = True
                break

        if exact_match_found:
            # Valid: exact match found
            return True, primary_canonical, all_canonical_mpns
        else:
            # Invalid: no exact match, but provide canonical suggestions for reference
            # Use first candidate as suggestion, but mark as invalid
            suggestion_canonical = all_canonical_mpns[0] if all_canonical_mpns else None
            return False, suggestion_canonical, all_canonical_mpns

    def extract_category(self, search_json: Dict[str, Any]) -> Dict[str, Any]:
        """Extract category information from DigiKey keyword search response."""
        category_info = {'name': None, 'id': None, 'parent_id': None, 'path': None}

        # First try ExactMatches, then fallback to Products
        exact_matches = search_json.get('ExactMatches', [])
        if exact_matches:
            category = exact_matches[0].get('Category')
            if category:
                category_info['name'] = category.get('Name')
                category_info['id'] = category.get('Id')
                category_info['parent_id'] = category.get('ParentId')
                # Build category path if needed
                if category_info['name']:
                    category_info['path'] = category_info['name']
                return category_info

        # Fallback to Products if no ExactMatches
        products = search_json.get('Products', [])
        if products:
            category = products[0].get('Category')
            if category:
                category_info['name'] = category.get('Name')
                category_info['id'] = category.get('Id')
                category_info['parent_id'] = category.get('ParentId')
                # Build category path if needed
                if category_info['name']:
                    category_info['path'] = category_info['name']
                return category_info

        return category_info

    def validate_mpns(self, mpns: List[str], manufacturer_names: Optional[List[Optional[str]]] = None,
                       manufacturer_id: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
        """Validate list of MPNs using global persistent cache first, then API.
        Returns map mpn_norm -> result dict.
        Result: {'valid': bool, 'canonical_mpn': str|None, 'dkpn': str|None,
                 'lifecycle': {...}}
        """
        from ..models import GlobalMpnCache

        results: Dict[str, Dict[str, Any]] = {}
        uniq: Dict[str, Optional[str]] = {}
        api_calls_needed = []

        # Deduplicate MPNs
        for i, mpn in enumerate(mpns):
            mpn_norm = self.normalize_mpn(mpn)
            if not mpn_norm:
                continue
            if mpn_norm not in uniq:
                uniq[mpn_norm] = (manufacturer_names[i] if manufacturer_names and i < len(manufacturer_names) else None)

        # First pass: Check global database cache
        cache_hits = 0
        for mpn_norm, mfr_name in uniq.items():
            # Try global persistent cache first
            cached_result = GlobalMpnCache.get_cached_result(
                mpn_norm=mpn_norm,
                manufacturer_id=manufacturer_id,
                site=self.site,
                lang=self.lang,
                currency=self.currency
            )

            if cached_result:
                results[mpn_norm] = cached_result
                cache_hits += 1
                logger.debug(f"Global cache HIT for MPN: {mpn_norm}")
                continue

            # Fall back to short-term Django cache
            cache_key = self._cache_key(mpn_norm, manufacturer_id)
            django_cached = cache.get(cache_key)
            if django_cached:
                results[mpn_norm] = django_cached
                cache_hits += 1
                # Also store in global cache for future use
                GlobalMpnCache.store_result(
                    mpn_norm=mpn_norm,
                    validation_data=django_cached,
                    manufacturer_id=manufacturer_id,
                    site=self.site,
                    lang=self.lang,
                    currency=self.currency
                )
                logger.debug(f"Django cache HIT for MPN: {mpn_norm}, stored in global cache")
                continue

            # Need API call for this MPN
            api_calls_needed.append((mpn_norm, mfr_name))

        logger.info(f"MPN validation: {cache_hits} cache hits, {len(api_calls_needed)} API calls needed")

        # Second pass: Make API calls for uncached MPNs
        for mpn_norm, mfr_name in api_calls_needed:
            try:
                search_json = self.search_keyword(mpn_norm, manufacturer_id)
                valid, canon_mpn, all_canonical_mpns = self.is_valid_match(search_json, mpn_norm, mfr_name)
                dkpn = self.pick_dkpn(search_json) if valid else None

                # Log validation result for debugging
                if valid:
                    logger.debug(f"✅ MPN '{mpn_norm}' validated: exact match found")
                elif all_canonical_mpns:
                    logger.debug(f"❌ MPN '{mpn_norm}' invalid: no exact match, but found {len(all_canonical_mpns)} suggestions")
                else:
                    logger.debug(f"❌ MPN '{mpn_norm}' invalid: no matches found at all")

                # Extract category information
                category_info = self.extract_category(search_json)
                lifecycle = None

                if dkpn:
                    try:
                        pd = self.product_details(dkpn)
                        prod = (pd or {}).get('Product') or {}
                        lifecycle = {
                            'status': ((prod.get('ProductStatus') or {}).get('Status')),
                            'endOfLife': prod.get('EndOfLife'),
                            'discontinued': prod.get('Discontinued'),
                            'normallyStocking': prod.get('NormallyStocking'),
                            'lastBuyChance': prod.get('DateLastBuyChance'),
                        }
                    except Exception as e:
                        logger.warning(f"Lifecycle fetch failed for {dkpn}: {e}")

                # CRITICAL FIX: For invalid MPNs, don't populate canonical MPNs or category
                if valid:
                    # Valid MPN: provide all information
                    res = {
                        'valid': True,
                        'canonical_mpn': canon_mpn,
                        'all_canonical_mpns': all_canonical_mpns,
                        'dkpn': dkpn,
                        'lifecycle': lifecycle,
                        'category': category_info,
                        'site': self.site,
                        'lang': self.lang,
                        'currency': self.currency,
                    }
                else:
                    # Invalid MPN: provide canonical suggestions but mark as invalid
                    # This helps users see what the correct part number should be
                    res = {
                        'valid': False,
                        'canonical_mpn': canon_mpn,  # Show suggestion even if invalid
                        'all_canonical_mpns': all_canonical_mpns,  # Show all suggestions
                        'dkpn': None,  # No DKPN for invalid
                        'lifecycle': None,  # No lifecycle for invalid
                        'category': {'name': None, 'id': None, 'parent_id': None, 'path': None},  # No category for invalid
                        'site': self.site,
                        'lang': self.lang,
                        'currency': self.currency,
                    }

                results[mpn_norm] = res

                # Store in both caches
                # Short-term Django cache (12h)
                cache_key = self._cache_key(mpn_norm, manufacturer_id)
                cache.set(cache_key, res, timeout=60 * 60 * 12)

                # Persistent global cache (forever)
                GlobalMpnCache.store_result(
                    mpn_norm=mpn_norm,
                    validation_data=res,
                    manufacturer_id=manufacturer_id,
                    site=self.site,
                    lang=self.lang,
                    currency=self.currency
                )

                logger.debug(f"API call completed for MPN: {mpn_norm}, stored in both caches")

            except Exception as e:
                logger.error(f"API validation failed for MPN {mpn_norm}: {e}")
                # Store negative result to avoid repeated failures
                error_result = {
                    'valid': False,
                    'canonical_mpn': None,
                    'all_canonical_mpns': [],  # NEW: Empty list for errors
                    'dkpn': None,
                    'lifecycle': None,
                    'category': {'name': None, 'id': None, 'parent_id': None, 'path': None},  # Empty category for errors
                    'site': self.site,
                    'lang': self.lang,
                    'currency': self.currency,
                    'error': str(e)
                }
                results[mpn_norm] = error_result

                # Cache the error result briefly (don't persist errors globally)
                cache_key = self._cache_key(mpn_norm, manufacturer_id)
                cache.set(cache_key, error_result, timeout=60 * 5)  # 5 minutes for errors

        return results
