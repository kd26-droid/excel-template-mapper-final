import json
import os
import re
from functools import lru_cache

from django.http import JsonResponse
from django.views.decorators.http import require_GET


def _clean(value):
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def _norm(value):
    return re.sub(r"[^a-z0-9]+", " ", _clean(value).lower()).strip()


@lru_cache(maxsize=1)
def load_manufacturer_directory():
    path = os.path.join(os.path.dirname(__file__), "data", "manufacturers.json")
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)

    entries = data.get("entries")
    names = data.get("names") or []
    aliases = data.get("aliases") or {}

    if not entries:
        entries = [{"name": name, "aliases": [name]} for name in names]

    phrase_to_canonical = {}
    for entry in entries:
        canonical = _clean(entry.get("name"))
        if not canonical:
            continue
        for alias in entry.get("aliases") or [canonical]:
            alias_text = _clean(alias)
            if alias_text:
                phrase_to_canonical[_norm(alias_text)] = canonical

    for alias, canonical in aliases.items():
        alias_text = _clean(alias)
        canonical_text = _clean(canonical)
        if alias_text and canonical_text:
            phrase_to_canonical[_norm(alias_text)] = canonical_text

    phrases = sorted(
        {phrase for phrase in phrase_to_canonical.keys() if phrase},
        key=lambda value: (-len(value), value),
    )

    return {
        "entries": entries,
        "names": names,
        "aliases": aliases,
        "phrase_to_canonical": phrase_to_canonical,
        "phrases": phrases,
        "entry_count": len(entries),
        "name_count": len(names),
        "alias_count": len(aliases),
    }


@require_GET
def manufacturer_directory(request):
    directory = load_manufacturer_directory()
    include_entries = request.GET.get("include_entries") == "1"

    payload = {
        "success": True,
        "entry_count": directory["entry_count"],
        "name_count": directory["name_count"],
        "alias_count": directory["alias_count"],
        "names": directory["names"],
        "aliases": directory["aliases"],
    }
    if include_entries:
        payload["entries"] = directory["entries"]
    return JsonResponse(payload)


@require_GET
def manufacturer_search(request):
    query = _norm(request.GET.get("q", ""))
    limit = max(1, min(100, int(request.GET.get("limit", "25") or 25)))
    directory = load_manufacturer_directory()

    if not query:
        matches = directory["entries"][:limit]
    else:
        matches = []
        seen = set()
        for entry in directory["entries"]:
            searchable = " ".join([entry.get("name", ""), *(entry.get("aliases") or [])])
            if query in _norm(searchable):
                key = _norm(entry.get("name", ""))
                if key not in seen:
                    matches.append(entry)
                    seen.add(key)
                if len(matches) >= limit:
                    break

    return JsonResponse({
        "success": True,
        "query": query,
        "count": len(matches),
        "results": matches,
    })
