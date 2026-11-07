"""How many BOMs each entity has produced through the mapper.

FactWise cannot say: 4.0's enterprise_boms records the enterprise and the
creating user, never the entity. So the mapper writes a row here at the moment
a BOM leaves it - exported as a sheet, handed to FactWise 3.0, or committed to
FactWise 4.0 - and the count for an entity is its number of rows.

Identity is (entity, top-level BOM code), case- and edge-space-insensitive. The
first event creates the row; every later one for the same BOM only bumps
``use_count``. Sub-assemblies sit inside their parent's tree and are not
counted on their own.

Recording is bookkeeping. It never fails the export or commit it rides on: any
error here is logged and swallowed.
"""

import logging
from zoneinfo import ZoneInfo

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from ..models import BomCreationRecord, EntityBomPlan

logger = logging.getLogger(__name__)

#: The events a caller may ask to be counted. Anything else is ignored, so a
#: download that is not a BOM leaving the mapper (an editing export, a preview)
#: can never add to the count by passing a stray value.
COUNTABLE_EVENTS = {
    BomCreationRecord.EVENT_SHEET_EXPORT,
    BomCreationRecord.EVENT_FACTWISE30_HANDOFF,
    BomCreationRecord.EVENT_FACTWISE40_COMMIT,
}


def bom_key(code):
    """The identity of a BOM code: `ABC-100` and ` abc-100 ` are one BOM."""
    return str(code or '').strip().lower()


def _clean(value):
    return str(value or '').strip()


def identity_from_request(request, session_info=None):
    """(entity_id, enterprise_id) for this call.

    The page sends what FactWise resolved; a session the page carried an entity
    into is the fallback, for callers with no browser.
    """
    data = getattr(request, 'data', None) or {}
    query = getattr(request, 'GET', None) or {}
    headers = getattr(request, 'headers', None) or {}
    info = session_info or {}
    entity_id = (_clean(data.get('entity_id')) or _clean(query.get('entity_id'))
                 or _clean(headers.get('X-Entity-Id')) or _clean(info.get('entity_id')))
    enterprise_id = (_clean(data.get('enterprise_id')) or _clean(query.get('enterprise_id'))
                     or _clean(headers.get('X-Enterprise-Id')))
    return entity_id, enterprise_id


def countable_event(value):
    """The event named by a caller's ``count_as``, or '' when it should not count."""
    event = _clean(value).lower()
    return event if event in COUNTABLE_EVENTS else ''


def top_level_bom_code(bom_header):
    """The code of the BOM a generated tree is rooted at, or ''."""
    header = bom_header or {}
    return _clean(header.get('bomCode') or header.get('finishedGoodCode'))


def session_top_level_bom_code(session_id):
    """The top-level BOM code this session generates, or '' when it builds none."""
    from ..views import _generate_bom_for_session

    if not session_id:
        return ''
    try:
        result, bom_header, error = _generate_bom_for_session(session_id)
    except Exception as exc:  # pragma: no cover - a sheet with no buildable BOM
        logger.info('No top-level BOM for %s: %s', session_id, exc)
        return ''
    if error is not None or result is None:
        return ''
    return top_level_bom_code(bom_header)


def record_bom_creation(*, entity_id, bom_codes, event, enterprise_id='', session_id=''):
    """Count each top-level BOM in ``bom_codes`` for ``entity_id``.

    Returns {code: True when this call counted it, False when it was already
    counted}. Empty when nothing could be recorded - no entity, no code, or an
    event that does not count.
    """
    entity_id = _clean(entity_id)
    event = countable_event(event)
    outcome = {}
    if not entity_id or not event:
        if bom_codes:
            logger.info('BOM creation not recorded (entity=%r event=%r): %s',
                        entity_id, event, list(bom_codes))
        return outcome

    seen = set()
    for code in bom_codes or []:
        display = _clean(code)
        key = bom_key(display)
        if not key or key in seen:
            continue
        seen.add(key)
        try:
            outcome[display] = _record_one(entity_id, enterprise_id, display, key,
                                           event, _clean(session_id))
        except Exception as exc:  # never fail the export this rides on
            logger.warning('BOM creation record failed for %s/%s: %s', entity_id, display, exc)
    return outcome


def _record_one(entity_id, enterprise_id, display, key, event, session_id):
    """True when this created the entity's row for the BOM, False when it existed."""
    try:
        with transaction.atomic():
            BomCreationRecord.objects.create(
                entity_id=entity_id,
                enterprise_id=_clean(enterprise_id),
                bom_code=display,
                bom_key=key,
                first_event=event,
                first_session_id=session_id,
                last_event=event,
                last_session_id=session_id,
            )
        logger.info('BOM counted for entity %s: %s (%s)', entity_id, display, event)
        return True
    except IntegrityError:
        # Already counted - the unique (entity, bom_key) row exists. A repeat
        # use, not a new BOM. F() keeps two concurrent exports from losing one.
        BomCreationRecord.objects.filter(entity_id=entity_id, bom_key=key).update(
            use_count=F('use_count') + 1,
            last_event=event,
            last_session_id=session_id,
            last_used_at=timezone.now(),
        )
        return False


#: Plans run on the calendar month as FactWise's users see it.
PLAN_TIMEZONE = ZoneInfo('Asia/Kolkata')


def month_window(now=None):
    """(start, end, 'YYYY-MM') of the current IST calendar month, as aware datetimes."""
    local = (now or timezone.now()).astimezone(PLAN_TIMEZONE)
    start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = (start.replace(year=start.year + 1, month=1) if start.month == 12
           else start.replace(month=start.month + 1))
    return start, end, start.strftime('%Y-%m')


def monthly_usage(entity_id, now=None):
    """What the entity's plan allows this month and how much of it is used.

    ``limit`` and ``remaining`` are None for unlimited - the default for an
    entity no one has put on a plan.
    """
    entity_id = _clean(entity_id)
    start, end, month = month_window(now)
    assignment = (EntityBomPlan.objects.select_related('plan').filter(entity_id=entity_id).first()
                  if entity_id else None)
    plan = assignment.plan if assignment else None
    limit = plan.monthly_bom_limit if plan else None
    used = BomCreationRecord.objects.filter(
        entity_id=entity_id, created_at__gte=start, created_at__lt=end).count() if entity_id else 0
    return {
        'month': month,
        'resets_at': end.isoformat(),
        'plan': plan.name if plan else 'Unlimited',
        'limit': limit,
        'used': used,
        'remaining': None if limit is None else max(limit - used, 0),
    }


class BomLimitReached(Exception):
    """A new BOM would take the entity past its plan's monthly allowance."""

    def __init__(self, usage, new_codes):
        self.usage = usage
        self.new_codes = list(new_codes)
        super().__init__(
            'This entity has used all %d new BOMs its %s plan allows for %s. '
            'BOMs already made this month can still be exported again; a new one '
            'can be made after the month resets or the plan is upgraded.'
            % (usage['limit'], usage['plan'], usage['month']))

    def as_response_body(self):
        return {'success': False, 'code': 'bom_limit_reached', 'error': str(self),
                'usage': self.usage, 'new_bom_codes': self.new_codes}


def check_bom_allowance(entity_id, bom_codes, now=None):
    """Raise BomLimitReached when the NEW codes among ``bom_codes`` exceed the allowance.

    A code the entity has already been counted for is never new - re-using a
    BOM is always allowed. With no entity there is nothing to limit (and
    nothing will be recorded).
    """
    entity_id = _clean(entity_id)
    keys = {bom_key(code): _clean(code) for code in bom_codes or [] if bom_key(code)}
    if not entity_id or not keys:
        return
    usage = monthly_usage(entity_id, now)
    if usage['limit'] is None:
        return
    known = set(BomCreationRecord.objects.filter(entity_id=entity_id, bom_key__in=list(keys))
                .values_list('bom_key', flat=True))
    new = [display for key, display in keys.items() if key not in known]
    if new and usage['used'] + len(new) > usage['limit']:
        raise BomLimitReached(usage, new)


def entity_bom_stats(entity_id):
    """The all-time count, this month's plan usage, and the BOMs behind them."""
    records = BomCreationRecord.objects.filter(entity_id=_clean(entity_id))
    return {
        'entity_id': _clean(entity_id),
        'bom_count': records.count(),
        'this_month': monthly_usage(entity_id),
        'boms': [record.to_dict() for record in records.order_by('-created_at')],
    }
