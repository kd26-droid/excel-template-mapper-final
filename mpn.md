# DigiKey MPN Validation + EOL Status — Django Integration (End‑to‑End)

This guide shows how to build **two capabilities** in a Django backend using Digi‑Key’s Product APIs:

1. **MPN Validation** — confirm a Manufacturer Part Number is real and map it to a Digi‑Key Part Number (DKPN).
2. **EOL / Lifecycle Status** — fetch lifecycle flags (EOL, Discontinued, etc.) for that part.

It’s designed for quick copy‑paste and production‑safe defaults.

---

## 0) What you’ll build

Django endpoints:

* `POST /api/mpn/validate` → returns `{valid, canonicalMpn, manufacturer, dkpn}`
* `GET /api/parts/{dkpn}/lifecycle` → returns `{lifecycle, endOfLife, discontinued, normallyStocking, lastBuyChance}`
* (Optional combined) `POST /api/mpn/validate-and-lifecycle` → one call that does both steps.

Internals:

* OAuth 2.0 **3‑legged** flow to obtain `access_token` and rotating `refresh_token`.
* Requests wrapper that auto‑refreshes tokens on 401.

---

## 1) Prerequisites

* **Django 4+** (or 3.2 LTS)
* Python 3.10+
* Packages: `requests`, `python-dotenv` (optional), `pydantic` (optional for response models)
* A Digi‑Key **Production App** with:

  * `Client ID` and `Client Secret`
  * **Redirect URI** (e.g., `https://oauth.pstmn.io/v1/callback` for manual code exchange during development)
  * Subscribed to **Product Search** / **Product Information** APIs

> ⚠️ Tokens: Access token ≈ 30 mins, Refresh token **rotates** on every refresh call. Always persist the newest one.

---

## 2) Environment Variables

Create `.env` (or use system env vars):

```
DK_CLIENT_ID=your_client_id
DK_CLIENT_SECRET=your_client_secret
DK_SITE=IN
DK_LANG=en
DK_CUR=INR
# Storage for issued tokens (persist the latest values)
DK_ACCESS_TOKEN=
DK_REFRESH_TOKEN=
```

Add a simple loader in Django (e.g., in `settings.py`):

```python
from pathlib import Path
import os
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')
```

---

## 3) One‑time: Obtain initial tokens (3‑leg OAuth)

**Step A — Get authorization code (in browser)**

Open:

```
https://api.digikey.com/v1/oauth2/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_URLENCODED_REDIRECT
```

Login + consent → You’ll be redirected to your redirect URI with `?code=XXXX`.

**Step B — Exchange code → tokens (terminal)**

```bash
curl -sS "https://api.digikey.com/v1/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=$DK_CLIENT_ID&client_secret=$DK_CLIENT_SECRET&grant_type=authorization_code&code=$CODE&redirect_uri=$REDIRECT"
```

Save `access_token` and `refresh_token` into your secret store / DB / `.env`.

**Step C — Refresh later**

```bash
curl -sS "https://api.digikey.com/v1/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=$DK_CLIENT_ID&client_secret=$DK_CLIENT_SECRET&grant_type=refresh_token&refresh_token=$DK_REFRESH_TOKEN"
```

**Persist the new `refresh_token`** every time.

---

## 4) Django project layout (minimal)

```
project/
  settings.py
  urls.py
  core/
    __init__.py
    dk.py              # Digi-Key client (HTTP + token refresh)
    services.py        # Business logic (validate, lifecycle)
    views.py           # Django views
```

Install deps:

```bash
pip install requests python-dotenv pydantic
```

---

## 5) Digi‑Key HTTP client with auto‑refresh (`core/dk.py`)

```python
import os, time, requests
from typing import Dict, Any

BASE = "https://api.digikey.com"
TOKEN_URL = f"{BASE}/v1/oauth2/token"
SITE = os.getenv("DK_SITE", "IN")
LANG = os.getenv("DK_LANG", "en")
CUR = os.getenv("DK_CUR", "INR")
CID = os.environ["DK_CLIENT_ID"]
CSECRET = os.environ["DK_CLIENT_SECRET"]

# Simple in-memory cache (replace with DB/redis as needed)
_access_token = os.getenv("DK_ACCESS_TOKEN", "")
_refresh_token = os.getenv("DK_REFRESH_TOKEN", "")

HEADERS_COMMON = {
    "X-DIGIKEY-Client-Id": CID,
    "X-DIGIKEY-Locale-Site": SITE,
    "X-DIGIKEY-Locale-Language": LANG,
    "X-DIGIKEY-Locale-Currency": CUR,
    "Accept": "application/json",
}

class DKAuthError(Exception):
    pass


def _save_tokens(access: str, refresh: str):
    global _access_token, _refresh_token
    _access_token = access
    _refresh_token = refresh
    # TODO: persist to DB or secret store; for demo, also write .env
    # (You may prefer a secure store instead of .env in production.)


def refresh_tokens() -> None:
    global _refresh_token
    data = {
        "client_id": CID,
        "client_secret": CSECRET,
        "grant_type": "refresh_token",
        "refresh_token": _refresh_token,
    }
    resp = requests.post(TOKEN_URL, data=data, timeout=20)
    if resp.status_code != 200:
        raise DKAuthError(f"Refresh failed: {resp.text}")
    j = resp.json()
    _save_tokens(j["access_token"], j.get("refresh_token", _refresh_token))


def dk_request(method: str, url: str, **kwargs) -> requests.Response:
    # attach headers
    headers = kwargs.pop("headers", {})
    headers.update(HEADERS_COMMON)
    headers["Authorization"] = f"Bearer {_access_token}"
    resp = requests.request(method, url, headers=headers, timeout=30, **kwargs)

    # If unauthorized, try one refresh once
    if resp.status_code == 401:
        refresh_tokens()
        headers["Authorization"] = f"Bearer {_access_token}"
        resp = requests.request(method, url, headers=headers, timeout=30, **kwargs)

    return resp


# Convenience wrappers for the two endpoints we need

def search_keyword(mpn: str, record_count: int = 5, manufacturer_id: int | None = None) -> Dict[str, Any]:
    body: Dict[str, Any] = {"Keywords": mpn, "RecordCount": record_count}
    if manufacturer_id is not None:
        body["Filters"] = {"ManufacturerIds": [manufacturer_id]}
    url = f"{BASE}/products/v4/search/keyword"
    resp = dk_request("POST", url, json=body)
    resp.raise_for_status()
    return resp.json()


def product_details(dkpn: str) -> Dict[str, Any]:
    url = f"{BASE}/products/v4/search/{dkpn}/productdetails"
    resp = dk_request("GET", url)
    resp.raise_for_status()
    return resp.json()
```

---

## 6) Business logic (`core/services.py`)

```python
from typing import Optional, Dict, Any
from .dk import search_keyword, product_details

PREF_PACK = "Cut Tape (CT)"


def validate_mpn(mpn: str, manufacturer_id: Optional[int] = None) -> Dict[str, Any]:
    s = search_keyword(mpn, record_count=5, manufacturer_id=manufacturer_id)
    item = (s.get("ExactMatches") or [None])[0] or (s.get("Products") or [None])[0]
    if not item:
        return {"valid": False}

    variants = item.get("ProductVariations") or []
    dkpn = None
    # prefer CT; else first
    for v in variants:
        if v.get("PackageType", {}).get("Name") == PREF_PACK:
            dkpn = v.get("DigiKeyProductNumber")
            break
    if not dkpn and variants:
        dkpn = variants[0].get("DigiKeyProductNumber")

    return {
        "valid": True,
        "canonicalMpn": item.get("ManufacturerProductNumber"),
        "manufacturer": (item.get("Manufacturer") or {}).get("Name"),
        "dkpn": dkpn,
        "productUrl": item.get("ProductUrl"),
        "datasheetUrl": item.get("DatasheetUrl"),
    }


def lifecycle_for_dkpn(dkpn: str) -> Dict[str, Any]:
    d = product_details(dkpn)
    p = d.get("Product") or {}
    return {
        "lifecycle": (p.get("ProductStatus") or {}).get("Status"),
        "endOfLife": bool(p.get("EndOfLife", False)),
        "discontinued": bool(p.get("Discontinued", False)),
        "normallyStocking": bool(p.get("NormallyStocking", False)),
        "lastBuyChance": p.get("DateLastBuyChance"),
        "quantityAvailable": p.get("QuantityAvailable"),
        "leadWeeks": p.get("ManufacturerLeadWeeks"),
        "productUrl": p.get("ProductUrl"),
    }


def validate_and_lifecycle(mpn: str, manufacturer_id: int | None = None) -> Dict[str, Any]:
    v = validate_mpn(mpn, manufacturer_id)
    if not v.get("valid"):
        return v
    dkpn = v.get("dkpn")
    if not dkpn:
        return {**v, "lifecycle": None}
    life = lifecycle_for_dkpn(dkpn)
    return {**v, **life}
```

---

## 7) Views / URLs (`core/views.py`, `urls.py`)

**`core/views.py`**

```python
from django.http import JsonResponse
from django.views.decorators.http import require_POST, require_GET
from django.views.decorators.csrf import csrf_exempt
import json
from .services import validate_mpn, lifecycle_for_dkpn, validate_and_lifecycle

@csrf_exempt
@require_POST
def mpn_validate(request):
    data = json.loads(request.body or '{}')
    mpn = data.get('mpn')
    manufacturer_id = data.get('manufacturerId')
    if not mpn:
        return JsonResponse({"error": "mpn is required"}, status=400)
    res = validate_mpn(mpn, manufacturer_id)
    return JsonResponse(res)

@require_GET
def part_lifecycle(request, dkpn: str):
    res = lifecycle_for_dkpn(dkpn)
    return JsonResponse(res)

@csrf_exempt
@require_POST
def mpn_validate_and_lifecycle(request):
    data = json.loads(request.body or '{}')
    mpn = data.get('mpn')
    manufacturer_id = data.get('manufacturerId')
    if not mpn:
        return JsonResponse({"error": "mpn is required"}, status=400)
    res = validate_and_lifecycle(mpn, manufacturer_id)
    return JsonResponse(res)
```

**`urls.py` (project root)**

```python
from django.urls import path
from core import views as v

urlpatterns = [
    path('api/mpn/validate', v.mpn_validate),
    path('api/parts/<str:dkpn>/lifecycle', v.part_lifecycle),
    path('api/mpn/validate-and-lifecycle', v.mpn_validate_and_lifecycle),
]
```

---

## 8) Request/Response examples

### A) Validate MPN

**Request**

```
POST /api/mpn/validate
Content-Type: application/json

{"mpn": "SN74HC595N"}
```

**Response**

```json
{
  "valid": true,
  "canonicalMpn": "SN74HC595N",
  "manufacturer": "Texas Instruments",
  "dkpn": "296-1600-5-ND",
  "productUrl": "https://www.digikey.com/en/products/detail/texas-instruments/SN74HC595N/277246",
  "datasheetUrl": "https://www.ti.com/lit/gpn/sn74hc595"
}
```

### B) Lifecycle by DKPN

**Request**

```
GET /api/parts/296-1600-5-ND/lifecycle
```

**Response**

```json
{
  "lifecycle": "Active",
  "endOfLife": false,
  "discontinued": false,
  "normallyStocking": true,
  "lastBuyChance": null,
  "quantityAvailable": 24387,
  "leadWeeks": "6",
  "productUrl": "https://www.digikey.com/en/products/detail/texas-instruments/SN74HC595N/277246"
}
```

### C) Combined

**Request**

```
POST /api/mpn/validate-and-lifecycle
Content-Type: application/json

{"mpn": "SN74HC595N"}
```

**Response**

```json
{
  "valid": true,
  "canonicalMpn": "SN74HC595N",
  "manufacturer": "Texas Instruments",
  "dkpn": "296-1600-5-ND",
  "productUrl": "https://www.digikey.com/en/products/detail/texas-instruments/SN74HC595N/277246",
  "datasheetUrl": "https://www.ti.com/lit/gpn/sn74hc595",
  "lifecycle": "Active",
  "endOfLife": false,
  "discontinued": false,
  "normallyStocking": true,
  "lastBuyChance": null,
  "quantityAvailable": 24387,
  "leadWeeks": "6"
}
```

---

## 9) Error handling & edge cases

* **No matches**: return `{valid:false}` and 200, or 404 (your choice). Frontend can show “MPN not found”.
* **No DKPN in variants**: treat as valid MPN but EOL unknown until you can map to a DKPN.
* **401** from Digi‑Key: auto‑refresh once; if still 401 → raise 401 to client with "Re-auth required".
* **Rate limiting**: implement exponential backoff on `429`.
* **Timeouts**: set `timeout=30s` and retry idempotent calls.

---

## 10) Security & operations

* Store `refresh_token` securely (DB with encryption at rest / secrets manager). Every refresh **rotates** it; always overwrite previous.
* Do not log tokens or full responses in production logs.
* For multi-user apps: tie tokens to a user/org table.
* Monitor failures; alert on repeated 401/429.

---

## 11) Local testing quickstart

* Put tokens into `.env` (`DK_ACCESS_TOKEN`, `DK_REFRESH_TOKEN`).
* `python manage.py runserver`
* Test with curl or Postman against the three endpoints above.

---

## 12) Reference — endpoints used

* `POST /products/v4/search/keyword` → validate MPN + get DKPN
* `GET  /products/v4/search/{DKPN}/productdetails` → lifecycle/EOL

Headers for every call:

```
Authorization: Bearer <access_token>
X-DIGIKEY-Client-Id: <client_id>
X-DIGIKEY-Locale-Site: IN
X-DIGIKEY-Locale-Language: en
X-DIGIKEY-Locale-Currency: INR
Accept: application/json
```

---

## 13) Production checklist

* [ ] Token storage is persistent; refresh path updates the **latest** refresh token
* [ ] 401 retry with refresh; circuit‑break repeated failures
* [ ] Backoff on 429; add basic caching for popular MPNs
* [ ] Structured logging (request id / correlation id if provided)
* [ ] Unit tests for: no match, multiple variants, missing DKPN, EOL flags parsing
* [ ] Observability: measure API latency and error rates

---

**That’s it.** You now have a clean, two‑endpoint Django backend to validate MPNs and fetch lifecycle/EOL with Digi‑Key.
