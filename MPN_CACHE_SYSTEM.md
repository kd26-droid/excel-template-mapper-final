# Global MPN Cache System

## Overview
The global MPN cache system stores MPN validation results permanently across all sessions, significantly reducing API calls to Digi-Key and improving performance.

## How It Works

### Cache Hierarchy
1. **Global Database Cache** (permanent) - Stores results forever
2. **Django Cache** (12 hours) - Fast in-memory cache
3. **Digi-Key API** (fallback) - Only called for new MPNs

### Cache Flow
```
MPN Validation Request
        ↓
Check Global DB Cache ━━━━━━━━━━━━━━━━┓
        ↓ (miss)                      ┃
Check Django Cache ━━━━━━━━━━━━━━━━━━━┫ → Return cached result
        ↓ (miss)                      ┃
Call Digi-Key API ━━━━━━━━━━━━━━━━━━━┛
        ↓
Store in both caches
```

### Benefits
- **Cross-session persistence**: Same MPNs reused between different upload sessions
- **Performance**: Instant lookup for previously validated MPNs
- **Cost efficiency**: Reduces Digi-Key API calls and rate limits
- **Reliability**: Local database storage prevents data loss

## Database Schema

### GlobalMpnCache Model
- **mpn_normalized**: Normalized MPN string (primary lookup key)
- **manufacturer_id**: Optional manufacturer filter
- **site/lang/currency**: Digi-Key locale settings
- **validation_data**: Complete JSON validation result
- **is_valid**: Quick boolean lookup
- **canonical_mpn**: Standardized MPN format
- **dkpn**: Digi-Key part number
- **status**: Lifecycle status (Active/NRND/Obsolete)
- **end_of_life**: EOL flag
- **discontinued**: Discontinued flag
- **access_count**: Usage tracking
- **last_accessed**: Freshness tracking

## API Endpoints

### Cache Statistics
```
GET /api/mpn/cache/stats/
```
Returns cache statistics including:
- Total cached entries
- Valid vs invalid count
- Recent access statistics
- Top accessed MPNs

### Cache Cleanup
```
POST /api/mpn/cache/cleanup/
Content-Type: application/json

{
  "type": "old",        # "old" or "invalid"
  "days_old": 365       # cleanup threshold
}
```

## Admin Interface
- View all cached MPNs in Django admin
- Filter by validity, status, access count
- Manual cleanup actions
- Detailed validation data inspection

## Performance Impact

### Before (Session-only cache)
- Every new session calls API for same MPNs
- 12-hour cache timeout loses data
- High API usage and costs

### After (Global cache)
- First validation caches forever
- Subsequent sessions get instant results
- ~90% reduction in API calls for repeated MPNs

## Example Usage

```python
from excel_mapper.models import GlobalMpnCache

# Check cache stats
stats = GlobalMpnCache.get_cache_stats()
print(f"Cache hit rate: {stats['cache_hit_rate']}")

# Manual cleanup
old_count = GlobalMpnCache.cleanup_old_entries(days_old=365)
invalid_count = GlobalMpnCache.cleanup_invalid_entries(days_old=30)
```

## Configuration
No additional configuration required. The system:
- Uses existing Digi-Key API credentials
- Respects current locale settings (site/lang/currency)
- Automatically migrates with `python manage.py migrate`

## Monitoring
- Track cache performance via admin interface
- Monitor API call reduction in logs
- Use cache stats endpoint for dashboards