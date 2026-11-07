"""The per-entity BOM count: when a BOM counts, and when it is the same BOM again.

Rules under test (agreed with the product owner, 2026-11-07):
- A BOM counts the first time it is exported as a sheet OR created in FactWise.
- Identity is entity + top-level BOM code, ignoring case and edge spaces.
- Exporting again, committing what was exported, or re-running with edited
  lines is the same BOM: use_count goes up, the count does not.
- Downloads that are not a BOM leaving the mapper (no count_as) never count.
"""

from datetime import datetime, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from excel_mapper.models import BomCreationRecord, BomPlan, EntityBomPlan
from excel_mapper.services import bom_creation_ledger as ledger


class RecordBomCreationTests(TestCase):

    def test_first_use_counts_and_repeats_do_not(self):
        first = ledger.record_bom_creation(entity_id='E1', bom_codes=['ABC-100'],
                                           event='sheet_export', session_id='s1')
        again = ledger.record_bom_creation(entity_id='E1', bom_codes=[' abc-100 '],
                                           event='factwise40_commit', session_id='s2')

        self.assertEqual(first, {'ABC-100': True})
        self.assertEqual(again, {'abc-100': False})
        record = BomCreationRecord.objects.get()
        self.assertEqual(record.bom_code, 'ABC-100')  # as first seen
        self.assertEqual(record.first_event, 'sheet_export')
        self.assertEqual(record.first_session_id, 's1')
        self.assertEqual(record.last_event, 'factwise40_commit')
        self.assertEqual(record.last_session_id, 's2')
        self.assertEqual(record.use_count, 2)
        self.assertEqual(ledger.entity_bom_stats('E1')['bom_count'], 1)

    def test_same_code_for_another_entity_is_that_entitys_bom(self):
        ledger.record_bom_creation(entity_id='E1', bom_codes=['ABC-100'], event='sheet_export')
        ledger.record_bom_creation(entity_id='E2', bom_codes=['ABC-100'], event='sheet_export')

        self.assertEqual(ledger.entity_bom_stats('E1')['bom_count'], 1)
        self.assertEqual(ledger.entity_bom_stats('E2')['bom_count'], 1)

    def test_different_codes_each_count(self):
        ledger.record_bom_creation(entity_id='E1', bom_codes=['ABC-100'], event='sheet_export')
        ledger.record_bom_creation(entity_id='E1', bom_codes=['ABC-200'], event='sheet_export')

        stats = ledger.entity_bom_stats('E1')
        self.assertEqual(stats['bom_count'], 2)
        self.assertEqual({b['bom_code'] for b in stats['boms']}, {'ABC-100', 'ABC-200'})

    def test_nothing_recorded_without_entity_code_or_countable_event(self):
        self.assertEqual(ledger.record_bom_creation(
            entity_id='', bom_codes=['ABC-100'], event='sheet_export'), {})
        self.assertEqual(ledger.record_bom_creation(
            entity_id='E1', bom_codes=['', '  '], event='sheet_export'), {})
        self.assertEqual(ledger.record_bom_creation(
            entity_id='E1', bom_codes=['ABC-100'], event='preview'), {})
        self.assertFalse(BomCreationRecord.objects.exists())

    def test_duplicate_codes_in_one_call_count_once(self):
        outcome = ledger.record_bom_creation(entity_id='E1', bom_codes=['ABC-100', 'abc-100'],
                                             event='sheet_export')
        self.assertEqual(outcome, {'ABC-100': True})
        self.assertEqual(BomCreationRecord.objects.get().use_count, 1)


def _fake_generated_bom(root_code):
    result = SimpleNamespace(bom_headers=['BOM ID', 'Item code'],
                             bom_rows=[{'BOM ID': root_code, 'Item code': 'P-1'}])
    return result, {'bomCode': root_code, 'finishedGoodCode': 'FG-1'}, None


@patch('excel_mapper.views.get_session_consistent', return_value={'entity_id': 'SESSION-ENTITY'})
@patch('excel_mapper.views._generate_bom_for_session',
       side_effect=lambda session_id, **kw: _fake_generated_bom('ROOT-1'))
class BomSheetDownloadTests(TestCase):

    def setUp(self):
        self.client = APIClient()

    def test_export_sheet_counts_the_top_level_bom(self, _gen, _info):
        response = self.client.get('/api/bom/download/s1/',
                                   {'count_as': 'sheet_export', 'entity_id': 'E1'})

        self.assertEqual(response.status_code, 200)
        record = BomCreationRecord.objects.get()
        self.assertEqual((record.entity_id, record.bom_code, record.first_event),
                         ('E1', 'ROOT-1', 'sheet_export'))

    def test_exporting_the_same_bom_twice_counts_once(self, _gen, _info):
        for _ in range(2):
            self.client.get('/api/bom/download/s1/', {'count_as': 'sheet_export', 'entity_id': 'E1'})

        self.assertEqual(BomCreationRecord.objects.count(), 1)
        self.assertEqual(BomCreationRecord.objects.get().use_count, 2)

    def test_download_without_count_as_does_not_count(self, _gen, _info):
        response = self.client.get('/api/bom/download/s1/', {'entity_id': 'E1'})

        self.assertEqual(response.status_code, 200)
        self.assertFalse(BomCreationRecord.objects.exists())

    def test_entity_falls_back_to_the_session(self, _gen, _info):
        self.client.get('/api/bom/download/s1/', {'count_as': 'factwise30_handoff'})

        record = BomCreationRecord.objects.get()
        self.assertEqual((record.entity_id, record.first_event),
                         ('SESSION-ENTITY', 'factwise30_handoff'))

    def test_stats_endpoint_reports_the_count(self, _gen, _info):
        self.client.get('/api/bom/download/s1/', {'count_as': 'sheet_export', 'entity_id': 'E1'})

        response = self.client.get('/api/bom/creation-stats/', {'entity_id': 'E1'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['bom_count'], 1)
        self.assertEqual(response.data['boms'][0]['bom_code'], 'ROOT-1')
        self.assertEqual(self.client.get('/api/bom/creation-stats/').status_code, 400)


class FactWise40CommitTests(TestCase):

    def _commit(self, entity_id='E1'):
        fake = SimpleNamespace(status_code=200, json=lambda: {'created': 3, 'updated': 0})
        data = {
            'file': SimpleUploadedFile('sheet.xlsx', b'not-read-in-this-test'),
            'action': 'commit', 'import_type': 'item', 'session_id': 's1',
            'api_url': 'http://factwise.test', 'enterprise_id': 'ENT-1', 'token': 't',
        }
        if entity_id:
            data['entity_id'] = entity_id
        with patch('excel_mapper.factwise40.requests.request', return_value=fake), \
                patch('excel_mapper.factwise40._sheet_bom_codes', return_value=['ROOT-1', 'SUB-1']), \
                patch('excel_mapper.factwise40.sub_assembly_codes', return_value={'sub-1'}), \
                patch('excel_mapper.views.get_session_consistent', return_value={}):
            return APIClient().post('/api/factwise40/validate/', data, format='multipart')

    def test_commit_counts_the_root_not_the_sub_assembly(self):
        response = self._commit()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['root_bom_codes'], ['ROOT-1'])
        record = BomCreationRecord.objects.get()
        self.assertEqual((record.entity_id, record.enterprise_id, record.bom_code, record.first_event),
                         ('E1', 'ENT-1', 'ROOT-1', 'factwise40_commit'))

    def test_commit_after_export_is_the_same_bom(self):
        ledger.record_bom_creation(entity_id='E1', bom_codes=['root-1'], event='sheet_export')

        self._commit()

        self.assertEqual(BomCreationRecord.objects.count(), 1)
        record = BomCreationRecord.objects.get()
        self.assertEqual((record.first_event, record.last_event, record.use_count),
                         ('sheet_export', 'factwise40_commit', 2))


# --- Monthly plans -----------------------------------------------------------
# Rules (2026-11-07): plans of 15 / 25 / unlimited new BOMs per IST calendar
# month, editable; at the limit a NEW BOM is refused before it leaves the
# mapper, re-using a counted BOM is always allowed; no plan = unlimited.


def _put_on_plan(entity_id, limit):
    plan = BomPlan.objects.create(name='Test plan %s' % limit, monthly_bom_limit=limit)
    EntityBomPlan.objects.create(entity_id=entity_id, plan=plan)
    return plan


class MonthlyPlanTests(TestCase):

    def test_seeded_plans_exist(self):
        limits = dict(BomPlan.objects.values_list('name', 'monthly_bom_limit'))
        self.assertEqual(limits, {'15 BOMs / month': 15, '25 BOMs / month': 25, 'Unlimited': None})

    def test_entity_without_a_plan_is_unlimited(self):
        for index in range(30):
            ledger.check_bom_allowance('E1', ['BOM-%d' % index])
            ledger.record_bom_creation(entity_id='E1', bom_codes=['BOM-%d' % index], event='sheet_export')
        usage = ledger.monthly_usage('E1')
        self.assertEqual((usage['plan'], usage['limit'], usage['used'], usage['remaining']),
                         ('Unlimited', None, 30, None))

    def test_new_bom_refused_at_the_limit_but_reuse_allowed(self):
        _put_on_plan('E1', 2)
        for code in ('A', 'B'):
            ledger.record_bom_creation(entity_id='E1', bom_codes=[code], event='sheet_export')

        with self.assertRaises(ledger.BomLimitReached) as caught:
            ledger.check_bom_allowance('E1', ['C'])
        self.assertEqual(caught.exception.usage['remaining'], 0)
        ledger.check_bom_allowance('E1', [' a '])  # already counted: always allowed

    def test_only_this_ist_month_counts(self):
        _put_on_plan('E1', 1)
        ledger.record_bom_creation(entity_id='E1', bom_codes=['OLD'], event='sheet_export')
        # 31 Oct 19:00 UTC is 1 Nov 00:30 IST - already November in India.
        BomCreationRecord.objects.update(created_at=datetime(2026, 10, 31, 18, 0, tzinfo=dt_timezone.utc))

        november = datetime(2026, 11, 7, 12, 0, tzinfo=dt_timezone.utc)
        self.assertEqual(ledger.monthly_usage('E1', november)['used'], 0)
        ledger.check_bom_allowance('E1', ['NEW'], november)

        BomCreationRecord.objects.update(created_at=datetime(2026, 10, 31, 19, 0, tzinfo=dt_timezone.utc))
        self.assertEqual(ledger.monthly_usage('E1', november)['used'], 1)
        with self.assertRaises(ledger.BomLimitReached):
            ledger.check_bom_allowance('E1', ['NEW'], november)

    def test_month_window_is_ist(self):
        start, end, month = ledger.month_window(datetime(2026, 12, 31, 20, 0, tzinfo=dt_timezone.utc))
        self.assertEqual(month, '2027-01')  # 1 Jan 01:30 IST
        self.assertEqual(start.isoformat(), '2027-01-01T00:00:00+05:30')
        self.assertEqual(end.isoformat(), '2027-02-01T00:00:00+05:30')

    def test_stats_report_this_month(self):
        _put_on_plan('E1', 15)
        ledger.record_bom_creation(entity_id='E1', bom_codes=['A'], event='sheet_export')
        month = ledger.entity_bom_stats('E1')['this_month']
        self.assertEqual((month['limit'], month['used'], month['remaining']), (15, 1, 14))


@patch('excel_mapper.views.get_session_consistent', return_value={})
@patch('excel_mapper.views._generate_bom_for_session',
       side_effect=lambda session_id, **kw: _fake_generated_bom('ROOT-NEW'))
class PlanEnforcementOnDownloadTests(TestCase):

    def test_new_bom_over_limit_is_refused_and_not_counted(self, _gen, _info):
        _put_on_plan('E1', 1)
        ledger.record_bom_creation(entity_id='E1', bom_codes=['ROOT-OLD'], event='sheet_export')

        response = APIClient().get('/api/bom/download/s1/',
                                   {'count_as': 'sheet_export', 'entity_id': 'E1'})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'bom_limit_reached')
        self.assertEqual(response.data['new_bom_codes'], ['ROOT-NEW'])
        self.assertFalse(BomCreationRecord.objects.filter(bom_code='ROOT-NEW').exists())

    def test_counted_bom_still_exports_at_the_limit(self, _gen, _info):
        _put_on_plan('E1', 1)
        ledger.record_bom_creation(entity_id='E1', bom_codes=['ROOT-NEW'], event='sheet_export')

        response = APIClient().get('/api/bom/download/s1/',
                                   {'count_as': 'sheet_export', 'entity_id': 'E1'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(BomCreationRecord.objects.get().use_count, 2)

    def test_download_that_is_not_a_bom_export_is_never_limited(self, _gen, _info):
        _put_on_plan('E1', 0)
        response = APIClient().get('/api/bom/download/s1/', {'entity_id': 'E1'})
        self.assertEqual(response.status_code, 200)


class PlanEnforcementOnCommitTests(TestCase):

    def test_commit_over_limit_is_refused_before_factwise_is_called(self):
        _put_on_plan('E1', 0)
        data = {
            'file': SimpleUploadedFile('sheet.xlsx', b'x'), 'action': 'commit',
            'import_type': 'item', 'session_id': 's1', 'entity_id': 'E1',
            'api_url': 'http://factwise.test', 'enterprise_id': 'ENT-1', 'token': 't',
        }
        with patch('excel_mapper.factwise40.requests.request') as factwise, \
                patch('excel_mapper.factwise40._sheet_bom_codes', return_value=['ROOT-1']), \
                patch('excel_mapper.factwise40.sub_assembly_codes', return_value=set()), \
                patch('excel_mapper.views.get_session_consistent', return_value={}):
            response = APIClient().post('/api/factwise40/validate/', data, format='multipart')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'bom_limit_reached')
        factwise.assert_not_called()
        self.assertFalse(BomCreationRecord.objects.exists())
