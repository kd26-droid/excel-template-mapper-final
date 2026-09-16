import json
from unittest.mock import patch

from django.db import OperationalError
from django.test import SimpleTestCase, TestCase

from excel_mapper.models import (
    BomStructurePattern,
    ColumnRule,
    DirectoryLearningEvent,
    ManufacturerDirectoryEntry,
    MpnDirectoryEntry,
    MpnManufacturerPair,
    MpnPatternEntry,
)
from excel_mapper.services.bom_directory_store import (
    DatabaseMpnLookup,
    database_mpn_lookup,
    manufacturer_lookup_rows,
    upsert_directory_pairs,
)
from excel_mapper.services.bom_directory_learning import learn_confirmed_bom_field_patterns
from excel_mapper.services.mpn_pattern_library import (
    _looks_like_manufacturer_code_only,
)

from excel_mapper.services.bom_role_inference import (
    build_bom_field_pattern_groups,
    build_bom_field_pattern_teach_result,
    derive_visual_pattern_from_tagged_spans,
    _infer_field_entries_for_row,
    _infer_marker_alternate_visual_rule,
    _interpretation_spans_by_column,
    _mpn_only_marker_alternate_pattern,
    _mpn_position_prefix_layout,
    _mpn_position_prefix_rule,
    _mpn_source_fragment_pattern,
    _pattern_shape_for_row,
    _same_cell_parenthesized_patterns_from_entries,
    _same_cell_parenthesized_mpn_manufacturer_pairs,
    _semantic_interpretation_coverage,
    _semantic_identity_fragments,
    _semantic_pattern_key,
    _build_split_field_review_step,
    _build_pattern_review_summary,
    _build_bom_field_review_workflow,
    _bom_pattern_structure_scope,
    _split_field_preview,
    _visual_pattern_identity_pairs,
    _visual_pattern_interpretation_spans,
    derive_bom_field_pattern_rule_from_correction,
    infer_bom_roles,
    normalize_bom_rows,
    refresh_bom_field_pattern_review_after_teach,
    save_bom_field_pattern_rule,
)
from excel_mapper.views import _retry_sqlite_locked_write


class SqliteWriteRetryTests(SimpleTestCase):
    @patch('excel_mapper.views.time.sleep')
    def test_retries_transient_database_lock(self, sleep):
        attempts = []

        def operation():
            attempts.append(True)
            if len(attempts) == 1:
                raise OperationalError('database is locked')
            return 'saved'

        self.assertEqual(_retry_sqlite_locked_write(operation), 'saved')
        self.assertEqual(len(attempts), 2)
        sleep.assert_called_once_with(0.25)


class BomRoleInferenceCleanupConfigTests(TestCase):
    def test_infer_api_returns_all_backend_cleanup_detection_counts(self):
        headers = ["Parent", "Description", "MPN", "Manufacturer"]
        rows = [
            {
                "Parent": "Parent",
                "Description": "Description",
                "MPN": "MPN",
                "Manufacturer": "Manufacturer",
                "__sourceRow": 10,
            },
            {
                "Parent": "Added Components",
                "Description": "Added Components",
                "MPN": "Added Components",
                "Manufacturer": "Added Components",
                "__sourceRow": 11,
            },
            {
                "Parent": "",
                "Description": "DO NOT POPULATE",
                "MPN": "ABC123",
                "Manufacturer": "KEMET",
                "__sourceRow": 12,
            },
            {
                "Parent": "",
                "Description": "Resistor",
                "MPN": "RC0402FR-0710KL",
                "Manufacturer": "YAGEO",
                "__sourceRow": 13,
                "__redRowStyle": True,
            },
            {
                "Parent": ">ROOT>CHILD",
                "Description": "Capacitor",
                "MPN": "C0402C101J5GAC",
                "Manufacturer": "KEMET",
                "__sourceRow": 14,
            },
        ]

        response = self.client.post(
            "/api/bom/roles/infer/",
            {
                "headers": headers,
                "rows": rows,
                "config": {
                    "skipTitleRows": True,
                    "skipRepeatedHeaders": True,
                    "skipDoNotPopulate": True,
                    "skipDeletedRows": True,
                    "parentPathLevels": True,
                },
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["cleanupDetections"], {
            "skipTitleRows": 1,
            "skipRepeatedHeaders": 1,
            "skipDoNotPopulate": 1,
            "skipDeletedRows": 1,
            "skipSummaryRows": 0,
            "parentPathLevels": 1,
        })
        self.assertEqual(payload["blockStructure"]["dataRowCount"], 1)

    def test_endpoint_honors_top_level_title_cleanup_selection(self):
        headers = ["MPN", "Manufacturer", "Quantity"]
        rows = [
            {
                "MPN": "Added Components",
                "Manufacturer": "Added Components",
                "Quantity": "Added Components",
                "__sourceRow": 10,
            },
            {
                "MPN": "RC0402FR-0710KL",
                "Manufacturer": "YAGEO",
                "Quantity": "1",
                "__sourceRow": 11,
            },
        ]

        kept = self.client.post(
            "/api/bom/roles/infer/",
            {
                "headers": headers,
                "rows": rows,
                "config": {
                    "skipTitleRows": False,
                    "skipRepeatedHeaders": True,
                },
            },
            content_type="application/json",
        )
        skipped = self.client.post(
            "/api/bom/roles/infer/",
            {
                "headers": headers,
                "rows": rows,
                "config": {
                    "skipTitleRows": True,
                    "skipRepeatedHeaders": True,
                },
            },
            content_type="application/json",
        )

        self.assertEqual(kept.status_code, 200)
        self.assertEqual(skipped.status_code, 200)
        self.assertEqual(kept.json()["blockStructure"]["dataRowCount"], 2)
        self.assertEqual(skipped.json()["blockStructure"]["dataRowCount"], 1)
        self.assertEqual(skipped.json()["blockStructure"]["sectionTitleRows"], [10])

    def test_endpoint_honors_top_level_repeated_header_cleanup_selection(self):
        headers = ["MPN", "Manufacturer", "Quantity"]
        rows = [
            {
                "MPN": "MPN",
                "Manufacturer": "Manufacturer",
                "Quantity": "Quantity",
                "__sourceRow": 20,
            },
            {
                "MPN": "RC0402FR-0710KL",
                "Manufacturer": "YAGEO",
                "Quantity": "1",
                "__sourceRow": 21,
            },
        ]

        kept = self.client.post(
            "/api/bom/roles/infer/",
            {
                "headers": headers,
                "rows": rows,
                "config": {
                    "skipTitleRows": True,
                    "skipRepeatedHeaders": False,
                },
            },
            content_type="application/json",
        )
        skipped = self.client.post(
            "/api/bom/roles/infer/",
            {
                "headers": headers,
                "rows": rows,
                "config": {
                    "skipTitleRows": True,
                    "skipRepeatedHeaders": True,
                },
            },
            content_type="application/json",
        )

        self.assertEqual(kept.status_code, 200)
        self.assertEqual(skipped.status_code, 200)
        self.assertEqual(kept.json()["blockStructure"]["dataRowCount"], 2)
        self.assertEqual(skipped.json()["blockStructure"]["dataRowCount"], 1)
        self.assertEqual(skipped.json()["blockStructure"]["repeatedHeaderRows"], [20])

    def test_summary_cleanup_detects_labeled_total_and_honors_toggle(self):
        headers = ["CPN", "Description", "Quantity"]
        rows = [
            {
                "CPN": "ITEM-001",
                "Description": "Capacitor",
                "Quantity": "2",
                "__sourceRow": 30,
            },
            {
                "CPN": "",
                "Description": "Total Count = 238",
                "Quantity": "",
                "__sourceRow": 31,
            },
        ]

        kept = self.client.post(
            "/api/bom/roles/infer/",
            {
                "headers": headers,
                "rows": rows,
                "config": {"skipSummaryRows": False},
            },
            content_type="application/json",
        )
        skipped = self.client.post(
            "/api/bom/roles/infer/",
            {
                "headers": headers,
                "rows": rows,
                "config": {
                    "skipSummaryRows": True,
                    "skipTitleRows": False,
                },
            },
            content_type="application/json",
        )

        self.assertEqual(kept.status_code, 200)
        self.assertEqual(skipped.status_code, 200)
        self.assertEqual(kept.json()["cleanupDetections"]["skipSummaryRows"], 1)
        self.assertEqual(kept.json()["blockStructure"]["dataRowCount"], 2)
        self.assertEqual(skipped.json()["blockStructure"]["summaryRows"], [31])
        self.assertEqual(skipped.json()["blockStructure"]["dataRowCount"], 1)

    def test_summary_cleanup_detects_isolated_numeric_footer(self):
        headers = ["Description", "Quantity"]
        rows = [
            {
                "Description": "Capacitor",
                "Quantity": "2",
                "__sourceRow": 40,
            },
            {
                "Description": "13",
                "Quantity": "",
                "__sourceRow": 41,
            },
        ]

        response = self.client.post(
            "/api/bom/roles/infer/",
            {
                "headers": headers,
                "rows": rows,
                "config": {
                    "skipSummaryRows": True,
                    "skipTitleRows": False,
                },
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["cleanupDetections"]["skipSummaryRows"], 1)
        self.assertEqual(response.json()["blockStructure"]["summaryRows"], [41])
        self.assertEqual(response.json()["blockStructure"]["dataRowCount"], 1)

    def test_summary_cleanup_preserves_numeric_cpn_item(self):
        headers = ["CPN", "Description"]
        rows = [
            {
                "CPN": "10012",
                "Description": "Capacitor",
                "__sourceRow": 50,
            },
            {
                "CPN": "10013",
                "Description": "",
                "__sourceRow": 51,
            },
        ]

        response = self.client.post(
            "/api/bom/roles/infer/",
            {
                "headers": headers,
                "rows": rows,
                "config": {
                    "skipSummaryRows": True,
                    "skipTitleRows": False,
                },
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["cleanupDetections"]["skipSummaryRows"], 0)
        self.assertEqual(response.json()["blockStructure"]["dataRowCount"], 2)


class BomFieldPatternTeachApiTests(TestCase):
    def test_missing_alternate_separator_stays_empty(self):
        response = self.client.post(
            "/api/bom/field-patterns/teach/",
            {
                "headers": ["Combined part"],
                "row": {"Combined part": "BASE (A/B) (YAGEO)"},
                "roles": {
                    "mpn": "Combined part",
                    "manufacturer": "Combined part",
                },
                "group": {"shape": "no-separator", "patternKey": "no-separator"},
                "tagged_spans": [
                    {"start": 0, "end": 4, "role": "mpn"},
                    {"start": 6, "end": 9, "role": "alternateList"},
                    {"start": 12, "end": 17, "role": "manufacturer"},
                ],
                "source_header": "Combined part",
                "persist": False,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["visualPattern"]["alternateDelimiter"], "")


class VisualPatternMpnExtractionTests(SimpleTestCase):
    def setUp(self):
        self.value = "SOLDER MASK ALKALINE DEV. FINEDEL DSR-330C10-11M (TAMURA)"
        self.visual_pattern = {
            "type": "bracket_manufacturer",
            "sourceHeader": "Combined part",
        }

    def test_missing_alternate_delimiter_does_not_fall_back_to_slash(self):
        value = "BASE (A/B) (YAGEO)"
        tagged_spans = [
            {"start": 0, "end": 4, "role": "mpn"},
            {"start": 6, "end": 9, "role": "alternateList"},
            {"start": 12, "end": 17, "role": "manufacturer"},
        ]

        result = build_bom_field_pattern_teach_result(
            headers=["Combined part"],
            row={"Combined part": value},
            roles={"mpn": "Combined part", "manufacturer": "Combined part"},
            group={"shape": "no-separator"},
            tagged_spans=tagged_spans,
            source_header="Combined part",
        )

        self.assertEqual(result["visualPattern"]["alternateDelimiter"], "")
        self.assertEqual(
            [entry["fields"]["mpn"]["value"] for entry in result["entries"]],
            ["BASE"],
        )

    def test_saved_visual_pattern_without_delimiter_does_not_assume_slash(self):
        value = "BASE (A/B) (YAGEO)"
        visual_pattern = {
            "type": "bracket_alternate_manufacturer",
            "sourceHeader": "Combined part",
            "alternateMode": "append",
            "segments": [
                {"role": "mpn", "before": "", "after": " (", "wrapper": None},
                {
                    "role": "alternateList",
                    "before": " (",
                    "after": ") (",
                    "wrapper": {"open": "(", "close": ")"},
                },
                {"role": "manufacturer", "before": ") (", "after": ")", "wrapper": None},
            ],
        }

        pairs = _visual_pattern_identity_pairs(
            {"Combined part": value},
            ["Combined part"],
            {"mpn": "Combined part", "manufacturer": "Combined part"},
            {"_activeFieldPatternRule": {"visualPattern": visual_pattern}},
        )

        self.assertEqual(
            [(pair["mpn"], pair["manufacturer"]) for pair in pairs],
            [("BASE", "YAGEO")],
        )

    def test_taught_insertion_marker_is_removed_when_row_has_no_alternate_list(self):
        visual_pattern = {
            "type": "bracket_alternate_manufacturer",
            "sourceHeader": "Combined part",
            "alternateDelimiter": "/",
            "alternateMode": "insert_at_marker",
            "segments": [
                {"role": "mpn", "before": "", "after": " (", "wrapper": None},
                {
                    "role": "alternateList",
                    "before": " (",
                    "after": ") (",
                    "wrapper": {"open": "(", "close": ")"},
                },
                {"role": "manufacturer", "before": ") (", "after": ")", "wrapper": None},
            ],
            "mpnComposition": {
                "operation": "insert_alternate_at_marker",
                "marker": "@",
                "markerSequence": "@",
                "markerOccurrence": 1,
                "prefixSource": "mpn_before_marker",
                "suffixSource": "mpn_after_marker",
                "alternateSource": "alternateList",
                "listSuppliesPrimary": True,
            },
        }

        values = [
            ("VJ0603Y102KXCA@ (VISH/VIT){HOM}[1911348]", "VJ0603Y102KXCA", "VISH/VIT"),
            ("WF06U1503B@L (WTC){HOM}[]", "WF06U1503BL", "WTC"),
        ]
        for value, expected_mpn, expected_manufacturer in values:
            pairs = _visual_pattern_identity_pairs(
                {"Combined part": value},
                ["Combined part"],
                {"mpn": "Combined part", "manufacturer": "Combined part"},
                {"_activeFieldPatternRule": {"visualPattern": visual_pattern}},
            )
            self.assertEqual(
                [(pair["mpn"], pair["manufacturer"]) for pair in pairs],
                [(expected_mpn, expected_manufacturer)],
            )

    def test_at_is_preserved_without_a_taught_marker_rule(self):
        value = "REAL@MPN1 (YAGEO)"

        pairs = _same_cell_parenthesized_mpn_manufacturer_pairs(value)

        self.assertEqual(
            [(pair["mpn"], pair["manufacturer"]) for pair in pairs],
            [("REAL@MPN1", "YAGEO")],
        )

    def test_no_alternate_marker_pattern_can_be_taught_and_applied(self):
        value = 'WF06U1503B@L(WTC){HOM}[]"'
        marker_start = value.index("@")
        manufacturer_start = value.index("WTC")
        visual_pattern = derive_visual_pattern_from_tagged_spans(
            source_value=value,
            source_header="Combined part",
            tagged_spans=[
                {"start": 0, "end": marker_start, "role": "mpn"},
                {"start": marker_start, "end": marker_start + 1, "role": "insertionMarker"},
                {"start": marker_start + 1, "end": value.index("("), "role": "mpn"},
                {
                    "start": manufacturer_start,
                    "end": manufacturer_start + len("WTC"),
                    "role": "manufacturer",
                },
            ],
        )

        self.assertEqual(visual_pattern["type"], "bracket_manufacturer")
        self.assertEqual(
            visual_pattern["mpnComposition"]["operation"],
            "insert_alternate_at_marker",
        )
        self.assertNotIn("alternateSource", visual_pattern["mpnComposition"])
        self.assertEqual(
            visual_pattern["displayPattern"],
            "<MPN_PREFIX><INSERTION_MARKER><MPN_SUFFIX> (<MFR>) {<STATUS>} [<REF>]",
        )

        pairs = _visual_pattern_identity_pairs(
            {"Combined part": value},
            ["Combined part"],
            {"mpn": "Combined part", "manufacturer": "Combined part"},
            {"_activeFieldPatternRule": {"visualPattern": visual_pattern}},
        )

        self.assertEqual(
            [(pair["mpn"], pair["manufacturer"]) for pair in pairs],
            [("WF06U1503BL", "WTC")],
        )

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference._looks_like_parenthesized_manufacturer_alias",
        return_value=True,
    )
    def test_apply_api_uses_taught_no_alternate_marker_pattern(
        self,
        _manufacturer_alias,
        _saved_rules,
        _saved_interpretations,
    ):
        value = 'WF06U1503B@L(WTC){HOM}[]"'
        marker_start = value.index("@")
        manufacturer_start = value.index("WTC")
        visual_pattern = derive_visual_pattern_from_tagged_spans(
            source_value=value,
            source_header="Combined part",
            tagged_spans=[
                {"start": 0, "end": marker_start, "role": "mpn"},
                {"start": marker_start, "end": marker_start + 1, "role": "insertionMarker"},
                {"start": marker_start + 1, "end": value.index("("), "role": "mpn"},
                {
                    "start": manufacturer_start,
                    "end": manufacturer_start + len("WTC"),
                    "role": "manufacturer",
                },
            ],
        )
        grammar = _semantic_identity_fragments(
            value,
            ["mpn", "manufacturer"],
        )[0]["grammar"]
        pattern_key = _semantic_pattern_key(
            "Combined part",
            ["mpn", "manufacturer"],
            grammar,
        )
        rule = {
            "shape": pattern_key,
            "patternKey": pattern_key,
            "fields": {},
            "visualPattern": visual_pattern,
        }

        response = self.client.post(
            "/api/bom/field-patterns/apply/",
            {
                "headers": ["Combined part"],
                "rows": [{"Combined part": value, "__sourceRow": 2}],
                "roles": {
                    "mpn": "Combined part",
                    "manufacturer": "Combined part",
                },
                "config": {"alternateLayout": "inside_selected_mpn_columns"},
                "rules": {pattern_key: rule},
                "corrections": [],
                "persist": False,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [
                (row["mpn"], row["manufacturer"])
                for row in response.json()["normalizedRows"]
            ],
            [("WF06U1503BL", "WTC")],
        )

    def test_visual_pattern_excludes_description_before_embedded_mpn(self):
        pairs = _visual_pattern_identity_pairs(
            {"Combined part": self.value},
            ["Combined part"],
            {"mpn": "Combined part", "manufacturer": "Combined part"},
            {"_activeFieldPatternRule": {"visualPattern": self.visual_pattern}},
        )

        self.assertEqual(
            [(pair["mpn"], pair["manufacturer"]) for pair in pairs],
            [("DSR-330C10-11M", "TAMURA")],
        )
    def test_visual_pattern_mpn_span_excludes_description_prefix(self):
        spans = _visual_pattern_interpretation_spans(self.value, self.visual_pattern)
        mpn_span = next(span for span in spans if span["role"] == "mpn")

        self.assertEqual(self.value[mpn_span["start"]:mpn_span["end"]], "DSR-330C10-11M")

    def test_adjacent_wrapped_alternate_does_not_expand_mpn_highlight_to_end(self):
        value = "EM-827(I) (EMCTW) {HOM} [3266379]"
        visual_pattern = {
            "type": "bracket_alternate_manufacturer",
            "sourceHeader": "Devanshi",
            "alternateDelimiter": "/",
            "alternateMode": "append",
            "segments": [
                {"role": "mpn", "before": "", "after": "", "wrapper": None},
                {
                    "role": "alternateList",
                    "before": "",
                    "after": " (",
                    "wrapper": {"open": "(", "close": ")"},
                },
                {"role": "manufacturer", "before": " (", "after": ")", "wrapper": None},
            ],
            "preserveOuterBrackets": {"alternateList": True},
        }

        pairs = _visual_pattern_identity_pairs(
            {"Devanshi": value},
            ["Devanshi"],
            {"mpn": "Devanshi", "manufacturer": "Devanshi"},
            {"_activeFieldPatternRule": {"visualPattern": visual_pattern}},
        )
        spans = _visual_pattern_interpretation_spans(value, visual_pattern)

        self.assertEqual(
            [(pair["mpn"], pair["manufacturer"]) for pair in pairs],
            [("EM-827", "EMCTW"), ("EM-827(I)", "EMCTW")],
        )
        self.assertEqual(
            [(value[span["start"]:span["end"]], span["role"]) for span in spans],
            [("EM-827", "mpn"), ("(I)", "alternateList"), ("EMCTW", "manufacturer")],
        )

    def test_visual_pattern_decodes_newline_alternate_delimiter(self):
        value = "BASE\nALT-1\nALT-2"
        visual_pattern = {
            "type": "tagged_fields",
            "sourceHeader": "Combined part",
            "alternateDelimiter": "\\n",
            "alternateMode": "complete",
            "segments": [
                {"role": "mpn", "before": "", "after": "\n", "wrapper": None},
                {"role": "alternateList", "before": "\n", "after": "", "wrapper": None},
            ],
        }

        pairs = _visual_pattern_identity_pairs(
            {"Combined part": value},
            ["Combined part"],
            {"mpn": "Combined part"},
            {"_activeFieldPatternRule": {"visualPattern": visual_pattern}},
        )

        self.assertEqual(
            [pair["mpn"] for pair in pairs],
            ["BASE", "ALT-1", "ALT-2"],
        )

    def test_visual_pattern_preserves_explicit_no_split(self):
        value = "BASE\nALT-1/ALT-2"
        visual_pattern = {
            "type": "tagged_fields",
            "sourceHeader": "Combined part",
            "alternateDelimiter": "",
            "alternateMode": "complete",
            "segments": [
                {"role": "mpn", "before": "", "after": "\n", "wrapper": None},
                {"role": "alternateList", "before": "\n", "after": "", "wrapper": None},
            ],
        }

        pairs = _visual_pattern_identity_pairs(
            {"Combined part": value},
            ["Combined part"],
            {"mpn": "Combined part"},
            {"_activeFieldPatternRule": {"visualPattern": visual_pattern}},
        )

        self.assertEqual([pair["mpn"] for pair in pairs], ["BASE"])

    def test_saved_visual_pattern_ignores_optional_separator_spaces(self):
        value = "IRLML6402@PBF(/TR)(INFINEON) {HOM} [2225412]"
        visual_pattern = {
            "type": "bracket_alternate_manufacturer",
            "sourceHeader": "Ref Statut",
            "alternateDelimiter": "/",
            "alternateMode": "insert_at_marker",
            "segments": [
                {"role": "mpn", "before": "", "after": " (", "wrapper": None},
                {"role": "alternateList", "before": " (", "after": ") (", "wrapper": None},
                {"role": "manufacturer", "before": ") (", "after": ")", "wrapper": None},
            ],
            "mpnComposition": {
                "operation": "insert_alternate_at_marker",
                "markerSequence": "@",
                "markerOccurrence": 1,
                "listSuppliesPrimary": True,
            },
        }

        pairs = _visual_pattern_identity_pairs(
            {"Ref Statut": value},
            ["Ref Statut"],
            {"mpn": "Ref Statut", "manufacturer": "Ref Statut"},
            {"_activeFieldPatternRule": {"visualPattern": visual_pattern}},
        )
        spans = _visual_pattern_interpretation_spans(value, visual_pattern)

        self.assertEqual(
            [(pair["mpn"], pair["manufacturer"]) for pair in pairs],
            [("IRLML6402PBF", "INFINEON"), ("IRLML6402TRPBF", "INFINEON")],
        )
        manufacturer_span = next(span for span in spans if span["role"] == "manufacturer")
        self.assertEqual(value[manufacturer_span["start"]:manufacturer_span["end"]], "INFINEON")

    def test_auto_marker_detection_keeps_distinct_adjacent_delimiters(self):
        value = "LTC2936IUF#@@PBF (/TR) (LTC) {HOM} [3489945]"
        rule = _infer_marker_alternate_visual_rule(
            value,
            "Ref Statut",
            ["mpn", "manufacturer"],
        )
        visual_pattern = rule["visualPattern"]
        pairs = _visual_pattern_identity_pairs(
            {"Ref Statut": value},
            ["Ref Statut"],
            {"mpn": "Ref Statut", "manufacturer": "Ref Statut"},
            {"_activeFieldPatternRule": rule},
        )

        self.assertEqual(visual_pattern["mpnComposition"]["markerSequence"], "@@")
        self.assertEqual(
            [(pair["mpn"], pair["manufacturer"]) for pair in pairs],
            [("LTC2936IUF#PBF", "LTC"), ("LTC2936IUF#TRPBF", "LTC")],
        )

    def test_saved_insertion_rule_is_not_overridden_by_equal_length_values(self):
        value = "WR04X000 P@L (A/B/D/H/T) (WTC) {HOM} [3078936]"
        visual_pattern = {
            "type": "bracket_alternate_manufacturer",
            "sourceHeader": "Ref Statut",
            "alternateDelimiter": "/",
            "alternateMode": "insert_at_marker",
            "segments": [
                {"role": "mpn", "before": "", "after": " (", "wrapper": None},
                {"role": "alternateList", "before": " (", "after": ") (", "wrapper": None},
                {"role": "manufacturer", "before": ") (", "after": ")", "wrapper": None},
            ],
            "mpnComposition": {
                "operation": "insert_alternate_at_marker",
                "markerSequence": "@",
                "markerOccurrence": 1,
                "listSuppliesPrimary": True,
            },
        }

        pairs = _visual_pattern_identity_pairs(
            {"Ref Statut": value},
            ["Ref Statut"],
            {"mpn": "Ref Statut", "manufacturer": "Ref Statut"},
            {"_activeFieldPatternRule": {"visualPattern": visual_pattern}},
        )

        self.assertEqual(
            [(pair["mpn"], pair["manufacturer"]) for pair in pairs],
            [
                ("WR04X000 PAL", "WTC"),
                ("WR04X000 PBL", "WTC"),
                ("WR04X000 PDL", "WTC"),
                ("WR04X000 PHL", "WTC"),
                ("WR04X000 PTL", "WTC"),
            ],
        )

    @patch(
        "excel_mapper.services.bom_role_inference._best_mpn_from_text",
        side_effect=lambda value: (
            (value[6:], 1.0, "known MPN found inside cell")
            if value.startswith(("01525-", "28384-"))
            else (value, 1.0, "known MPN")
        ),
    )
    def test_backend_derives_prefix_length_from_recognized_mpn_positions(self, _best_mpn):
        value = "01525-22-03-2061\n28384-69173-406HLF"

        rule = _mpn_position_prefix_rule(value)
        result = build_bom_field_pattern_teach_result(
            headers=["Part"],
            row={"Part": value},
            roles={"mpn": "Part"},
            group={"shape": "position-derived", "patternKey": "position-derived"},
            source_header="Part",
            base_rule=rule,
            field_rules=rule["fields"],
            prefer_field_rules=True,
        )

        self.assertEqual(
            result["rule"]["fields"]["mpn"],
            {
                "delimiter": "\\n",
                "stripPrefix": "6",
                "prefixMode": "first_n_chars",
                "detectionSource": "recognized_mpn_position",
                "customerConfirmed": True,
            },
        )
        self.assertEqual(
            [entry["fields"]["mpn"]["value"] for entry in result["entries"]],
            ["22-03-2061", "69173-406HLF"],
        )

    def test_append_mode_can_add_a_separator_only_to_alternate_mpns(self):
        value = "LTC1625IS#@ (/TR) (ANALOGDV) {LBO} [1771248]"

        def span(text, role):
            index = value.index(text)
            return {"start": index, "end": index + len(text), "role": role}

        result = build_bom_field_pattern_teach_result(
            headers=["Combined part"],
            row={"Combined part": value},
            roles={"mpn": "Combined part", "manufacturer": "Combined part"},
            group={"shape": "alternate-only-separator"},
            tagged_spans=[
                span("LTC1625IS#@", "mpn"),
                span("/TR", "alternateList"),
                span("ANALOGDV", "manufacturer"),
            ],
            source_header="Combined part",
            alternate_delimiter="/",
            alternate_mode="append",
            alternate_joiner="#",
        )

        self.assertEqual(result["visualPattern"]["alternateJoiner"], "#")
        self.assertEqual(result["rule"]["visualPattern"]["alternateJoiner"], "#")
        self.assertEqual(
            [entry["fields"]["mpn"]["value"] for entry in result["entries"]],
            ["LTC1625IS", "LTC1625IS#TR"],
        )

        replayed_pairs = _visual_pattern_identity_pairs(
            {"Combined part": value},
            ["Combined part"],
            {"mpn": "Combined part", "manufacturer": "Combined part"},
            {"_activeFieldPatternRule": result["rule"]},
        )
        self.assertEqual(
            [(pair["mpn"], pair["manufacturer"]) for pair in replayed_pairs],
            [("LTC1625IS", "ANALOGDV"), ("LTC1625IS#TR", "ANALOGDV")],
        )

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_plain_confirmed_values_are_rescored_by_backend_directories(
        self, _saved_rules, _saved_interpretations
    ):
        result = normalize_bom_rows(
            ["MPN", "MFR"],
            [{"MPN": "22-03-2061", "MFR": "MOLEX", "__sourceRow": 2}],
            roles={"mpn": "MPN", "manufacturer": "MFR"},
            config={
                "fieldPatternOverrides": {
                    "rows": {
                        "2": {
                            "entries": [{
                                "relation": "Primary",
                                "fields": {
                                    "mpn": "22-03-2061",
                                    "manufacturer": "MOLEX",
                                },
                            }],
                        },
                    },
                },
            },
        )

        normalized = result["normalizedRows"][0]
        self.assertEqual(normalized["mpn"], "22-03-2061")
        self.assertEqual(normalized["manufacturer"], "MOLEX")
        self.assertEqual(normalized["confidence"], 100.0)

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_repeated_header_block_can_swap_mpn_and_manufacturer_columns(
        self, _saved_rules, _saved_interpretations
    ):
        headers = [
            "Sr.no.", "Description", "MPN", "Manufacturer", "QTY",
            "Ref Designator", "Remarks",
        ]
        rows = [
            {
                "Sr.no.": "1",
                "Description": "CAP-4.7uF,100V,1210,10%,X7R",
                "MPN": "12101C475K4T2A",
                "Manufacturer": "KYOCERA AVX",
                "QTY": "2",
                "Ref Designator": "C5,C6",
                "Remarks": "",
                "__sourceRow": 7,
            },
            {
                "Sr.no.": "",
                "Description": "",
                "MPN": "",
                "Manufacturer": "",
                "QTY": "13",
                "Ref Designator": "",
                "Remarks": "",
                "__sourceRow": 16,
            },
            {
                "Sr.no.": "Added Components",
                "Description": "Added Components",
                "MPN": "Added Components",
                "Manufacturer": "Added Components",
                "QTY": "",
                "Ref Designator": "",
                "Remarks": "",
                "__sourceRow": 18,
            },
            {
                "Sr.no.": "Sr.no.",
                "Description": "Description",
                "MPN": "Manufacturer",
                "Manufacturer": "MPN",
                "QTY": "QTY",
                "Ref Designator": "Ref Designator",
                "Remarks": "Remarks",
                "__sourceRow": 19,
            },
            {
                "Sr.no.": "1",
                "Description": "CAP-47nF,0402,50V,X7R,10%",
                "MPN": "TDK",
                "Manufacturer": "CGA2B3X7R1H473K050BB",
                "QTY": "1",
                "Ref Designator": "C1",
                "Remarks": "",
                "__sourceRow": 20,
            },
        ]

        inferred = infer_bom_roles(headers, rows)
        self.assertEqual(inferred["roles"]["mpn"], "MPN")
        self.assertEqual(inferred["roles"]["manufacturer"], "Manufacturer")
        self.assertEqual(inferred["blockStructure"]["blockCount"], 2)

        normalized = normalize_bom_rows(
            headers,
            rows,
            roles={
                "mpn": "Manufacturer",
                "manufacturer": "MPN",
                "description": "Description",
                "quantity": "QTY",
            },
            config={
                "skipTitleRows": True,
                "skipRepeatedHeaders": True,
                "alternateLayout": "already_separate_rows",
            },
        )

        output = normalized["normalizedRows"]
        self.assertEqual(len(output), 2)
        self.assertEqual(
            [(row["mpn"], row["manufacturer"], row["relation"]) for row in output],
            [
                ("12101C475K4T2A", "KYOCERA AVX", "Primary"),
                ("CGA2B3X7R1H473K050BB", "TDK", "Primary"),
            ],
        )
        self.assertEqual(normalized["blockStructure"]["repeatedHeaderRows"], [19])
        self.assertEqual(normalized["blockStructure"]["sectionTitleRows"], [18])
        self.assertEqual(normalized["blockStructure"]["summaryRows"], [16])
        self.assertEqual(normalized["progress"]["skippedRows"], 3)

        review = build_bom_field_pattern_groups(
            headers,
            rows,
            roles={
                "mpn": "Manufacturer",
                "manufacturer": "MPN",
                "description": "Description",
                "quantity": "QTY",
            },
            config={"skipTitleRows": True, "skipRepeatedHeaders": True},
            options={"includeAllRows": True},
        )
        second_sample = next(
            sample for sample in review["reviewRows"] if sample["sourceRow"] == 20
        )
        original_cells = {item["column"]: item["value"] for item in second_sample["left"]}
        self.assertEqual(original_cells["MPN"], "TDK")
        self.assertEqual(original_cells["Manufacturer"], "CGA2B3X7R1H473K050BB")

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_report_control_rows_are_excluded_from_review_and_normalization(
        self, _saved_rules, _saved_interpretations
    ):
        headers = [
            "Sr.no.", "Description", "Manufacturer", "MPN", "QTY",
            "Ref Designator", "Remarks",
        ]
        roles = {
            "description": "Description",
            "manufacturer": "Manufacturer",
            "mpn": "MPN",
            "quantity": "QTY",
            "level": "Remarks",
        }
        rows = [
            {
                **{header: "Total Count = 238" for header in headers},
                "__sourceRow": 10,
            },
            {
                **{header: "Existing Components" for header in headers[:-1]},
                "Remarks": "03-09-2026",
                "__sourceRow": 11,
            },
            {
                **{header: "Added Components" for header in headers[:-1]},
                "Remarks": "03-09-2026",
                "__sourceRow": 12,
            },
            {
                "Sr.no.": "Sr.no.",
                "Description": "Description",
                "Manufacturer": "Manufacturer",
                "MPN": "MPN",
                "QTY": "QTY",
                "Ref Designator": "Ref Designator",
                "Remarks": "Remarks",
                "__sourceRow": 13,
            },
            {
                "Sr.no.": "1",
                "Description": "Precision resistor",
                "Manufacturer": "YAGEO",
                "MPN": "RC0402FR-0710KL",
                "QTY": "4",
                "Ref Designator": "R1,R2,R3,R4",
                "Remarks": "",
                "__sourceRow": 14,
            },
        ]
        config = {
            "skipTitleRows": True,
            "skipRepeatedHeaders": True,
            "structure": "multi_block_assembly",
        }

        review = build_bom_field_pattern_groups(
            headers,
            rows,
            roles=roles,
            config=config,
            options={"includeAllRows": True},
        )
        self.assertEqual(
            [row["sourceRow"] for row in review["reviewRows"]],
            [14],
        )
        self.assertEqual(review["blockStructure"]["sectionTitleRows"], [10, 11, 12])
        self.assertEqual(review["blockStructure"]["repeatedHeaderRows"], [13])

        normalized = normalize_bom_rows(headers, rows, roles=roles, config=config)
        self.assertEqual(
            [row["mpn"] for row in normalized["normalizedRows"]],
            ["RC0402FR-0710KL"],
        )

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_ignored_semantic_pattern_is_removed_from_item_count_and_output(
        self, _saved_rules, _saved_interpretations
    ):
        headers = ["MPN"]
        roles = {"mpn": "MPN"}
        ignored_pattern_key = _semantic_pattern_key(
            "MPN",
            ["mpn"],
            "<UNCLASSIFIED_TEXT>",
        )
        ignored_rule = {
            "patternKey": ignored_pattern_key,
            "visualPattern": {
                "type": "ignore_fields",
                "sourceHeader": "MPN",
                "ignoredFields": ["mpn"],
            },
        }
        rules = {ignored_pattern_key: ignored_rule}
        rows = [
            {"MPN": "Added Components", "__sourceRow": source_row}
            for source_row in range(1, 4)
        ] + [
            {"MPN": f"PART-{index:04d}", "__sourceRow": index + 3}
            for index in range(1, 110)
        ]
        config = {
            "skipTitleRows": False,
            "fieldPatternRules": rules,
        }

        review = build_bom_field_pattern_groups(
            headers,
            rows,
            roles=roles,
            config=config,
            options={
                "includeAllRows": True,
                "maxRows": 200,
                "fieldPatternRules": rules,
            },
        )
        self.assertEqual(review["reviewSummary"]["itemCount"], 109)
        self.assertEqual(review["reviewSummary"]["sourceRowCount"], 109)
        self.assertEqual(review["reviewSummary"]["patternCount"], 0)
        self.assertTrue(all(row["sourceRow"] > 3 for row in review["reviewRows"]))

        normalized = normalize_bom_rows(headers, rows, roles=roles, config=config)
        self.assertEqual(len(normalized["normalizedRows"]), 109)
        self.assertTrue(all(row["sourceRow"] > 3 for row in normalized["normalizedRows"]))


    def test_taught_at_boundary_is_replayed_by_backend_segments(self):
        value = "LABEL@ REAL123 (P/R) (KEMET)] OTHER@ NEXT456 (A/B) (YAGEO)]"
        visual_pattern = {
            "type": "bracket_alternate_manufacturer",
            "sourceHeader": "Combined part",
            "groupSeparator": "]",
            "alternateDelimiter": "/",
            "alternateMode": "append",
            "segments": [
                {"role": "mpn", "before": "@ ", "after": " (", "wrapper": None},
                {"role": "alternateList", "before": " (", "after": ") (", "wrapper": None},
                {"role": "manufacturer", "before": " (", "after": ")", "wrapper": None},
            ],
        }

        pairs = _visual_pattern_identity_pairs(
            {"Combined part": value},
            ["Combined part"],
            {"mpn": "Combined part", "manufacturer": "Combined part"},
            {"_activeFieldPatternRule": {"visualPattern": visual_pattern}},
        )

        self.assertEqual(
            [(pair["mpn"], pair["manufacturer"]) for pair in pairs],
            [
                ("REAL123", "KEMET"),
                ("REAL123P", "KEMET"),
                ("REAL123R", "KEMET"),
                ("NEXT456", "YAGEO"),
                ("NEXT456A", "YAGEO"),
                ("NEXT456B", "YAGEO"),
            ],
        )

    def test_manual_interpretation_is_returned_after_backend_refresh(self):
        headers = ["Combined part"]
        row = {"Combined part": "ABC123 (KEMET)"}
        roles = {"mpn": "Combined part", "manufacturer": "Combined part"}
        rule = derive_bom_field_pattern_rule_from_correction(
            headers,
            row,
            roles=roles,
            entries=[{
                "relation": "Primary",
                "fields": {"mpn": "ABC123-MANUAL", "manufacturer": "KEMET MANUAL"},
            }],
            group={"shape": "manual-test"},
            visual_pattern={
                "type": "bracket_manufacturer",
                "sourceHeader": "Combined part",
                "groupSeparator": "",
            },
            has_manual_edits=True,
        )

        entries = _infer_field_entries_for_row(
            row,
            headers,
            roles,
            headers,
            {"_activeFieldPatternRule": rule},
        )

        self.assertEqual(entries[0]["fields"]["mpn"]["value"], "ABC123-MANUAL")
        self.assertEqual(entries[0]["fields"]["manufacturer"]["value"], "KEMET MANUAL")

    def test_automatic_preview_is_not_persisted_as_a_manual_correction(self):
        rule = derive_bom_field_pattern_rule_from_correction(
            ["Combined part"],
            {"Combined part": self.value},
            roles={"mpn": "Combined part", "manufacturer": "Combined part"},
            entries=[{
                "relation": "Primary",
                "fields": {
                    "mpn": "SOLDER MASK ALKALINE DEV. FINEDEL DSR-330C10-11M",
                    "manufacturer": "TAMURA",
                },
            }],
            group={"shape": "automatic-preview"},
            visual_pattern={
                "type": "bracket_manufacturer",
                "sourceHeader": "Combined part",
                "segments": [
                    {"role": "mpn", "before": "", "after": " (", "wrapper": None},
                    {"role": "manufacturer", "before": "(", "after": ")", "wrapper": None},
                ],
            },
            has_manual_edits=False,
        )

        self.assertNotIn("manualCorrections", rule["visualPattern"])

    def test_repeated_plain_pattern_uses_embedded_mpn_for_rows_and_highlights(self):
        value = (
            "PSR-4000 CCSE01 (TAIYO YU) {APPROVED} [1001]; "
            "SOLDER MASK ALKALINE DEV. FINEDEL DSR-330C10-11M (TAMURA) {APPROVED} [1002]"
        )
        headers = ["Combined part"]
        roles = {"mpn": "Combined part", "manufacturer": "Combined part"}
        visual_pattern = {
            "type": "bracket_manufacturer",
            "sourceHeader": "Combined part",
            "groupSeparator": ";",
            "segments": [
                {"role": "mpn", "before": "", "after": " (", "wrapper": None},
                {"role": "manufacturer", "before": "(", "after": ")", "wrapper": None},
            ],
        }
        rule = {"visualPattern": visual_pattern}
        entries = _infer_field_entries_for_row(
            {"Combined part": value},
            headers,
            roles,
            headers,
            {"_activeFieldPatternRule": rule},
        )
        pairs = [
            (entry["fields"]["mpn"]["value"], entry["fields"]["manufacturer"]["value"])
            for entry in entries
        ]
        self.assertIn(("DSR-330C10-11M", "TAMURA"), pairs)
        self.assertNotIn(
            "SOLDER MASK ALKALINE DEV. FINEDEL DSR-330C10-11M",
            [mpn for mpn, _manufacturer in pairs],
        )

        spans = _interpretation_spans_by_column(
            {"Combined part": value},
            headers,
            headers,
            rule,
            entries,
        )["Combined part"]
        mpn_values = [
            value[span["start"]:span["end"]]
            for span in spans
            if span["role"] == "mpn"
        ]
        self.assertIn("DSR-330C10-11M", mpn_values)
        self.assertNotIn("SOLDER MASK ALKALINE DEV. FINEDEL DSR-330C10-11M", mpn_values)

    def test_preview_preserves_parenthesized_mpn_suffix_and_highlights_source_text(self):
        value = "VIA FILLING THP-100 DX1 VF (HV) (TAIYO YU) {HOM} [738238]"
        headers = ["Combined part"]
        roles = {"mpn": "Combined part", "manufacturer": "Combined part"}

        entries = _infer_field_entries_for_row(
            {"Combined part": value},
            headers,
            roles,
            headers,
        )

        self.assertEqual(entries[0]["fields"]["mpn"]["value"], "THP-100 DX1 VF (HV)")
        self.assertEqual(entries[0]["fields"]["manufacturer"]["value"], "TAIYO YU")

        spans = _interpretation_spans_by_column(
            {"Combined part": value},
            headers,
            headers,
            {},
            entries,
        )["Combined part"]
        mpn_span = next(item for item in spans if item["role"] == "mpn")
        manufacturer_span = next(item for item in spans if item["role"] == "manufacturer")
        self.assertEqual(value[mpn_span["start"]:mpn_span["end"]], "THP-100 DX1 VF (HV)")
        self.assertEqual(value[manufacturer_span["start"]:manufacturer_span["end"]], "TAIYO YU")

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_backend_owns_at_marker_suffix_replacement_preview(self, _saved_rules):
        first = "MCT06030D4122B@00 (P1/P5/PW) (YAGEO) {HOM} [2006975]"
        second = "PCF0603-R-41K2B@00 (I/T1) (WELWYN) {HOM} [2252768]"
        value = f"{first} {second}"

        def span(text, role, start=0):
            index = value.index(text, start)
            return {"start": index, "end": index + len(text), "role": role}

        tagged_spans = [
            span("MCT06030D4122B@00", "mpn"),
            span("P1/P5/PW", "alternateList"),
            span("YAGEO", "manufacturer"),
            *[
                {"start": index, "end": index + 1, "role": "groupSeparator"}
                for index, character in enumerate(value)
                if character == "]"
            ],
        ]
        visual_pattern = derive_visual_pattern_from_tagged_spans(
            value,
            "Combined part",
            tagged_spans,
            alternate_delimiter="/",
        )

        self.assertEqual(visual_pattern["groupSeparator"], "]")
        self.assertEqual(visual_pattern["alternateMode"], "replace_suffix_at_marker")
        self.assertEqual(
            visual_pattern["mpnComposition"],
            {
                "operation": "replace_suffix_at_marker",
                "marker": "@",
                "markerSequence": "@",
                "prefixSource": "mpn_before_marker",
                "primarySuffixSource": "mpn_after_marker",
                "alternateSuffixSource": "alternateList",
            },
        )

        result = build_bom_field_pattern_teach_result(
            headers=["Combined part"],
            row={"Combined part": value},
            roles={"mpn": "Combined part", "manufacturer": "Combined part"},
            group={"shape": "at-marker-replacement"},
            tagged_spans=tagged_spans,
            source_header="Combined part",
            alternate_delimiter="/",
        )
        pairs = [
            (entry["fields"]["mpn"]["value"], entry["fields"]["manufacturer"]["value"])
            for entry in result["entries"]
        ]
        self.assertEqual(
            pairs[:4],
            [
                ("MCT06030D4122B00", "YAGEO"),
                ("MCT06030D4122BP1", "YAGEO"),
                ("MCT06030D4122BP5", "YAGEO"),
                ("MCT06030D4122BPW", "YAGEO"),
            ],
        )
        self.assertIn("<MPN_PREFIX>@<PRIMARY_SUFFIX>", result["pattern"])
        self.assertIn("repeated by ]", result["pattern"])
        self.assertEqual(result["title"], "Confirm patterns for MPN and Manufacturer")

        shape = _pattern_shape_for_row(
            {"Combined part": value},
            ["Combined part"],
            {"mpn": "Combined part", "manufacturer": "Combined part"},
            ["Combined part"],
            config={"alternateLayout": "inside_selected_mpn_columns"},
        )
        normalized = normalize_bom_rows(
            ["Combined part"],
            [{"Combined part": value, "__sourceRow": 84}],
            roles={"mpn": "Combined part", "manufacturer": "Combined part"},
            config={
                "alternateLayout": "inside_selected_mpn_columns",
                "fieldPatternRules": {shape: result["rule"]},
            },
        )
        self.assertEqual(
            [row["mpn"] for row in normalized["normalizedRows"][:4]],
            [
                "MCT06030D4122B00",
                "MCT06030D4122BP1",
                "MCT06030D4122BP5",
                "MCT06030D4122BPW",
            ],
        )

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_explicit_insertion_marker_builds_primary_and_alternates_with_suffix(self, _saved_rules):
        value = "RC0402JR-@0RL (07/10/13) (YAGEO)"

        def span(text, role, start=0):
            index = value.index(text, start)
            return {"start": index, "end": index + len(text), "role": role}

        tagged_spans = [
            span("RC0402JR-", "mpn"),
            span("@", "insertionMarker"),
            span("0RL", "mpn"),
            span("07/10/13", "alternateList"),
            span("YAGEO", "manufacturer"),
        ]
        result = build_bom_field_pattern_teach_result(
            headers=["Combined"],
            row={"Combined": value},
            roles={"mpn": "Combined", "manufacturer": "Combined"},
            group={"shape": "insertion-marker-with-suffix"},
            tagged_spans=tagged_spans,
            source_header="Combined",
            alternate_delimiter="/",
        )

        visual_pattern = result["visualPattern"]
        self.assertEqual(visual_pattern["alternateMode"], "insert_at_marker")
        self.assertEqual(
            visual_pattern["mpnComposition"],
            {
                "operation": "insert_alternate_at_marker",
                "marker": "@",
                "markerSequence": "@",
                "markerOccurrence": 1,
                "prefixSource": "mpn_before_marker",
                "suffixSource": "mpn_after_marker",
                "alternateSource": "alternateList",
                "listSuppliesPrimary": True,
            },
        )
        self.assertEqual(
            result["pattern"],
            "<MPN_PREFIX><INSERTION_MARKER><MPN_SUFFIX> (<ALTERNATE_VALUES>) (<MFR>)",
        )
        self.assertEqual(
            [
                (entry["fields"]["mpn"]["value"], entry["fields"]["manufacturer"]["value"])
                for entry in result["entries"]
            ],
            [
                ("RC0402JR-070RL", "YAGEO"),
                ("RC0402JR-100RL", "YAGEO"),
                ("RC0402JR-130RL", "YAGEO"),
            ],
        )
        marker_span = next(
            item
            for item in result["interpretationSpansByColumn"]["Combined"]
            if item["role"] == "insertionMarker"
        )
        self.assertEqual(value[marker_span["start"]:marker_span["end"]], "@")

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_explicit_insertion_marker_supports_an_empty_mpn_suffix(self, _saved_rules):
        value = "RG1005P-753-B-@ (T5/T10) (SUSUMU)"

        def span(text, role):
            index = value.index(text)
            return {"start": index, "end": index + len(text), "role": role}

        result = build_bom_field_pattern_teach_result(
            headers=["Combined"],
            row={"Combined": value},
            roles={"mpn": "Combined", "manufacturer": "Combined"},
            group={"shape": "insertion-marker-without-suffix"},
            tagged_spans=[
                span("RG1005P-753-B-", "mpn"),
                span("@", "insertionMarker"),
                span("T5/T10", "alternateList"),
                span("SUSUMU", "manufacturer"),
            ],
            source_header="Combined",
            alternate_delimiter="/",
        )

        self.assertEqual(
            [entry["fields"]["mpn"]["value"] for entry in result["entries"]],
            ["RG1005P-753-B-T5", "RG1005P-753-B-T10"],
        )

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_normalize_api_returns_backend_owned_rows(self, _saved_rules):
        response = self.client.post(
            "/api/bom/normalize/",
            {
                "headers": ["MPN", "MFR", "Qty", "UOM"],
                "rows": [{
                    "MPN": "ABC123",
                    "MFR": "KEMET",
                    "Qty": "2",
                    "UOM": "EA",
                    "__sourceRow": 7,
                }],
                "roles": {
                    "mpn": "MPN",
                    "manufacturer": "MFR",
                    "quantity": "Qty",
                    "uom": "UOM",
                },
                "config": {"alternateLayout": "already_separate_rows"},
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["source"], "backend")
        self.assertEqual(payload["normalizedRows"][0]["mpn"], "ABC123")
        self.assertEqual(payload["normalizedRows"][0]["manufacturer"], "KEMET")

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_apply_api_returns_combined_backend_preview(self, _saved_rules, _saved_interpretations):
        response = self.client.post(
            "/api/bom/field-patterns/apply/",
            {
                "headers": ["MPN", "MFR"],
                "rows": [{"MPN": "ABC123", "MFR": "KEMET", "__sourceRow": 2}],
                "roles": {"mpn": "MPN", "manufacturer": "MFR"},
                "config": {"alternateLayout": "already_separate_rows"},
                "groups": [],
                "persist": False,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["source"], "backend")
        self.assertEqual(payload["normalizedRows"][0]["mpn"], "ABC123")
        self.assertIn("learning", payload)

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_apply_api_builds_learning_groups_and_row_overrides_from_user_corrections(
        self, _saved_rules, _saved_interpretations
    ):
        response = self.client.post(
            "/api/bom/field-patterns/apply/",
            {
                "headers": ["MPN", "MFR"],
                "rows": [{"MPN": "ABC123", "MFR": "KEMET", "__sourceRow": 2}],
                "roles": {"mpn": "MPN", "manufacturer": "MFR"},
                "config": {"alternateLayout": "already_separate_rows"},
                "rules": {
                    "direct-pattern": {
                        "shape": "direct-pattern",
                        "fields": {"mpn": {"delimiter": "none"}},
                    },
                },
                "corrections": [{
                    "patternKey": "direct-pattern",
                    "sourceRow": 2,
                    "occurrenceId": "2",
                    "entries": [{
                        "relation": "Primary",
                        "fields": {"mpn": "XYZ789", "manufacturer": "YAGEO"},
                    }],
                }],
                "persist": False,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["normalizedRows"][0]["mpn"], "XYZ789")
        self.assertEqual(payload["normalizedRows"][0]["manufacturer"], "YAGEO")
        self.assertIn("direct-pattern", payload["appliedConfig"]["fieldPatternRules"])
        self.assertNotIn("fieldPatternOverrides", payload["appliedConfig"])

    def test_slash_manufacturer_alias_does_not_merge_three_records_into_one_pattern(self):
        value = (
            "KGM05AR71H102K@ (H/N) (AVX/KYOC) {HOM} [1807868] "
            "VJ0402Y102KXAA@ (C/P) (VISH/VIT) {HOM} [1807867] "
            "0402B102K500C@ (T/G) (WTC) {HOM} [ ]"
        )

        patterns = _same_cell_parenthesized_patterns_from_entries(value, [], "Combined part")

        self.assertEqual(patterns, ["<MPN>@ (<ALTERNATE_SUFFIXES>) (<MFR>) {<STATUS>} [<REF>] repeated"])

    def test_pattern_shape_distinguishes_replacement_suffix_from_empty_at_marker(self):
        headers = ["Combined part"]
        roles = {"mpn": "Combined part", "manufacturer": "Combined part"}
        config = {"alternateLayout": "inside_selected_mpn_columns"}

        replacement_shape = _pattern_shape_for_row(
            {"Combined part": "MCT06030D4122B@00 (P1/P5/PW) (YAGEO) {HOM} [2006975]"},
            headers,
            roles,
            headers,
            config,
        )
        empty_marker_shape = _pattern_shape_for_row(
            {"Combined part": "KGM05AR71H102K@ (H/N) (AVX/KYOC) {HOM} [1807868]"},
            headers,
            roles,
            headers,
            config,
        )

        self.assertIn("at_primary_suffix", replacement_shape)
        self.assertIn("at_empty_suffix", empty_marker_shape)
        self.assertNotEqual(replacement_shape, empty_marker_shape)

    def test_at_after_first_parenthesized_group_does_not_break_pattern_display(self):
        pattern = _mpn_source_fragment_pattern("ABC123 (ALT) note @ later")

        self.assertEqual(pattern, "<MPN> (<SUFFIX>)")

    def test_split_field_preview_uses_selected_delimiter(self):
        previews = _split_field_preview(["A2017729,A2018417,A2019302"], "cpn", ",")

        self.assertEqual(
            previews[0]["values"],
            ["A2017729", "A2018417", "A2019302"],
        )

    def test_split_review_returns_cleanup_rules_and_backend_shape_targets(self):
        groups = [{
            "id": "pattern-1",
            "shape": "row-shape-1",
            "samples": [{
                "left": [
                    {"column": "CPN", "value": "C-100,C-101"},
                    {"column": "Combined", "value": "ABC123:KEMET"},
                ],
            }],
            "suggestedRule": {
                "fields": {
                    "cpn": {"delimiter": ","},
                },
                "identityGroups": [{
                    "header": "Combined",
                    "roles": ["mpn", "manufacturer"],
                    "delimiter": ":",
                    "order": ["mpn", "manufacturer"],
                }],
            },
        }]

        step = _build_split_field_review_step(
            [{
                "sourceColumn": "CPN",
                "mappedFields": ["cpn"],
                "relationship": "one_to_one",
            }],
            groups,
            case="2a",
            shared_identity_units=[{
                "sourceColumn": "Combined",
                "mappedFields": ["mpn", "manufacturer"],
                "relationship": "shared",
            }],
        )

        self.assertEqual(step["fields"][0]["targetGroups"], [{
            "id": "pattern-1",
            "shape": "row-shape-1",
        }])
        self.assertEqual(step["identityGroups"][0]["roles"], ["mpn", "manufacturer"])
        self.assertEqual(
            step["identityGroups"][0]["candidateRules"][0]["rule"]["delimiter"],
            ":",
        )

    @patch(
        "excel_mapper.services.bom_role_inference._build_semantic_review_patterns",
        return_value=[],
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_case_1b_without_patterns_opens_backend_preview(
        self, _saved_rules, _semantic_patterns
    ):
        result = build_bom_field_pattern_groups(
            ["Combined identity", "Description"],
            [{
                "Combined identity": "ABC123 KEMET",
                "Description": "Chip resistor",
                "__sourceRow": 2,
            }],
            roles={
                "mpn": "Combined identity",
                "manufacturer": "Combined identity",
                "description": "Description",
            },
            config={"alternateLayout": "following_rows"},
            options={"includeAllRows": True},
        )

        workflow = result["reviewWorkflow"]
        self.assertEqual(result["patternCount"], 0)
        self.assertEqual(workflow["branch"], "b")
        self.assertEqual(workflow["cases"], ["1b", "2b"])
        self.assertEqual([step["type"] for step in workflow["steps"]], ["preview"])
        self.assertEqual(workflow["nextStep"]["type"], "preview")
        self.assertTrue(workflow["directPreview"])
        self.assertFalse(workflow["directNormalize"])

    @patch(
        "excel_mapper.services.bom_role_inference._build_semantic_review_patterns",
        return_value=[],
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_branch_b_without_patterns_reviews_all_one_to_one_fields(
        self, _saved_rules, _semantic_patterns
    ):
        result = build_bom_field_pattern_groups(
            ["CPN", "MPN", "MFR", "Description", "Qty", "UOM"],
            [{
                "CPN": "C-100",
                "MPN": "ABC123",
                "MFR": "KEMET",
                "Description": "Chip capacitor",
                "Qty": "4",
                "UOM": "EA",
                "__sourceRow": 2,
            }],
            roles={
                "cpn": "CPN",
                "mpn": "MPN",
                "manufacturer": "MFR",
                "description": "Description",
                "quantity": "Qty",
                "uom": "UOM",
            },
            config={"alternateLayout": "following_item_rows"},
            options={"includeAllRows": True},
        )

        workflow = result["reviewWorkflow"]
        self.assertEqual(result["patternCount"], 0)
        self.assertEqual(workflow["branch"], "b")
        self.assertEqual(workflow["cases"], ["2b"])
        self.assertEqual(workflow["nextStep"]["type"], "preview")
        self.assertEqual(workflow["nextStep"]["case"], "preview")
        self.assertTrue(workflow["directPreview"])
        self.assertFalse(workflow["directNormalize"])
        self.assertEqual(
            workflow["nextStep"]["mappedFields"],
            ["cpn", "mpn", "manufacturer", "description", "quantity", "uom"],
        )
        self.assertEqual(len(result["reviewRows"]), 1)

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_following_item_rows_inherit_primary_context_and_number_alternates(
        self, _saved_rules, _saved_interpretations
    ):
        headers = ["Item", "Description", "MPN", "MFR", "Qty", "UOM"]
        rows = [
            {
                "Item": "CPN-100",
                "Description": "Chip capacitor",
                "MPN": "",
                "MFR": "",
                "Qty": "4",
                "UOM": "EA",
                "__sourceRow": 2,
            },
            {
                "Item": "",
                "Description": "Customer MPN description",
                "MPN": "ABC123",
                "MFR": "KEMET",
                "Qty": "",
                "UOM": "",
                "__sourceRow": 3,
            },
            {
                "Item": "",
                "Description": "",
                "MPN": "XYZ987",
                "MFR": "AVX",
                "Qty": "",
                "UOM": "",
                "__sourceRow": 4,
            },
            {
                "Item": "",
                "Description": "Supplementary text only",
                "MPN": "",
                "MFR": "",
                "Qty": "",
                "UOM": "",
                "__sourceRow": 5,
            },
        ]
        result = normalize_bom_rows(
            headers,
            rows,
            roles={
                "cpn": "Item",
                "mpn": "MPN",
                "manufacturer": "MFR",
                "description": "Description",
                "quantity": "Qty",
                "uom": "UOM",
            },
            config={
                "alternateLayout": "following_item_rows",
                "followingItemRowsItemColumn": "Item",
                "followingItemRowsMpnColumn": "MPN",
                "followingItemRowsManufacturerColumn": "MFR",
                "followingItemRowsCpnMode": "primary",
                "alternateInheritFields": ["cpn", "description", "quantity", "uom"],
            },
        )

        normalized = result["normalizedRows"]
        self.assertEqual(len(normalized), 2)
        self.assertEqual(
            [row["relation"] for row in normalized],
            ["Primary", "Alternate 1"],
        )
        self.assertEqual([row["mpn"] for row in normalized], ["ABC123", "XYZ987"])
        self.assertEqual([row["manufacturer"] for row in normalized], ["KEMET", "AVX"])
        self.assertTrue(all(row["cpn"] == "CPN-100" for row in normalized))
        self.assertTrue(all(row["description"] == "Chip capacitor" for row in normalized))
        self.assertTrue(all(row["quantity"] == "4" for row in normalized))
        self.assertTrue(all(row["uom"] == "EA" for row in normalized))

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_separate_column_alternate_can_reuse_primary_manufacturer(
        self, _saved_rules, _saved_interpretations
    ):
        headers = ["Manufacturer Part Number", "Manufacturer Name", "Alternative Part Number"]
        rows = [{
            "Manufacturer Part Number": "IS43QR16512A-083TBL",
            "Manufacturer Name": "ISSI (INTEGR.SILICON SOLUT.INC)",
            "Alternative Part Number": "IS43QR16512A-075VBL",
            "__sourceRow": 2,
        }]
        result = normalize_bom_rows(
            headers,
            rows,
            roles={
                "mpn": "Manufacturer Part Number",
                "manufacturer": "Manufacturer Name",
            },
            config={
                "alternateLayout": "separate_columns",
                "alternateColumnGroups": [{
                    "mpn": "Alternative Part Number",
                    "mfr": "Manufacturer Name",
                }],
            },
        )

        normalized = result["normalizedRows"]
        self.assertEqual([row["relation"] for row in normalized], ["Primary", "Alternate 1"])
        self.assertEqual(
            [row["mpn"] for row in normalized],
            ["IS43QR16512A-083TBL", "IS43QR16512A-075VBL"],
        )
        self.assertEqual(
            [row["manufacturer"] for row in normalized],
            ["ISSI (INTEGR.SILICON SOLUT.INC)", "ISSI (INTEGR.SILICON SOLUT.INC)"],
        )

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_review_contract_deduplicates_fragment_patterns_globally(self, _saved_rules, _saved_interpretations):
        headers = ["Combined part", "CPN"]
        roles = {
            "mpn": "Combined part",
            "manufacturer": "Combined part",
            "cpn": "CPN",
        }
        rows = [
            {
                "Combined part": (
                    "MCT06030D4122B@00 (P1/P5/PW) (KEMET) {HOM} [2006975] / "
                    "PCF0603-R-41K2B@ (I/T1) (WELWYN) {HOM} [2252768] / "
                    "RT0603BRD07-41K2L (Tape & Reel)"
                ),
                "CPN": "C-100",
                "__sourceRow": 2,
            },
            {
                "Combined part": (
                    "ABT06030D4122B#00 (P1/P5/PW) (YAGEO) {HOM} [2006975] / "
                    "HDK0603-R-41K2B@ (I/T1) (WELWYN) {HOM} [2252768]"
                ),
                "CPN": "C-101",
                "__sourceRow": 3,
            },
        ]

        result = build_bom_field_pattern_groups(
            headers,
            rows,
            roles=roles,
            config={"alternateLayout": "inside_selected_mpn_columns"},
            selected_columns=headers,
            options={"includeAllRows": True},
        )

        grammars = [pattern["grammar"] for pattern in result["patterns"]]
        self.assertEqual(len(grammars), 4)
        self.assertIn("<MPN_PREFIX>@<PRIMARY_SUFFIX> (<ALTERNATE_SUFFIXES>) (<MFR>) {<STATUS>} [<REF>]", grammars)
        self.assertIn("<MPN>@ (<ALTERNATE_SUFFIXES>) (<MFR>) {<STATUS>} [<REF>]", grammars)
        self.assertIn("<MPN> (<UNCLASSIFIED_TEXT>)", grammars)
        self.assertIn("<MPN_PREFIX>#<PRIMARY_SUFFIX> (<ALTERNATE_SUFFIXES>) (<MFR>) {<STATUS>} [<REF>]", grammars)
        self.assertEqual(len(result["reviewWorkflow"]["steps"]), 5)  # four patterns plus preview
        self.assertTrue(all("patternKey" in pattern for pattern in result["patterns"]))
        self.assertTrue(all(
            {"sourceColumn", "start", "end", "rawValue", "patternKey", "occurrenceId"}
            <= set(occurrence)
            for row in result["reviewRows"]
            for occurrence in row["occurrences"]
        ))
        self.assertFalse(any(pattern["sourceColumn"] == "CPN" for pattern in result["patterns"]))

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_same_semantic_pattern_is_one_step_with_multiple_occurrences(self, _saved_rules, _saved_interpretations):
        rows = [
            {"Combined": "ABC123@ (A/B) (KEMET)", "__sourceRow": 2},
            {"Combined": "XYZ987@ (C/D) (YAGEO)", "__sourceRow": 3},
        ]
        result = build_bom_field_pattern_groups(
            ["Combined"],
            rows,
            roles={"mpn": "Combined", "manufacturer": "Combined"},
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True},
        )

        self.assertEqual(result["patternCount"], 1)
        self.assertEqual(result["patterns"][0]["occurrenceCount"], 2)
        step = result["reviewWorkflow"]["steps"][0]
        self.assertEqual(step["occurrenceCount"], 2)
        self.assertEqual(len(step["interpretationRefs"]), 2)
        self.assertEqual(step["interpretation"]["rawValue"], "ABC123@ (A/B) (KEMET)")
        self.assertIn("entries", step["interpretation"])
        self.assertIn("interpretationSpans", step["interpretation"])
        span_roles = {span["role"] for span in step["interpretation"]["interpretationSpans"]}
        self.assertIn("mpn", span_roles)
        self.assertIn("manufacturer", span_roles)
        self.assertIn("storedInterpretation", step)
        self.assertEqual(
            sum(len(row["occurrences"]) for row in result["reviewRows"]),
            2,
        )
        self.assertNotIn("interpretations", result["patterns"][0])

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_same_cell_setup_enables_alternate_teaching_without_saved_rule(
        self, _saved_rules, _saved_interpretations
    ):
        source_header = "Ref.Fab(Fabricant){Statut}[BI]"
        result = build_bom_field_pattern_groups(
            [source_header],
            [{
                source_header: "EM-827(I) (EMCTW) {HOM} [3266379]",
                "__sourceRow": 1,
            }],
            roles={"mpn": source_header, "manufacturer": source_header},
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True},
        )

        pattern = result["patterns"][0]
        self.assertTrue(pattern["hasAlternateList"])
        self.assertTrue(result["reviewWorkflow"]["steps"][0]["hasAlternateList"])

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_long_marker_suffix_list_is_auto_interpreted_without_saved_rule(
        self, _saved_rules, _saved_interpretations
    ):
        value = (
            "P0402E1501BN@ (W/T/TA/TB/TC/TD/TE/TF/PT/PA/PB/PC) "
            "(VISH/SFE) {HOM} [3523976]"
        )

        result = build_bom_field_pattern_groups(
            ["Combined"],
            [{"Combined": value, "__sourceRow": 224}],
            roles={"mpn": "Combined", "manufacturer": "Combined"},
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True},
        )

        step = next(item for item in result["reviewWorkflow"]["steps"] if item["type"] == "teach_visual")
        self.assertEqual(
            step["pattern"],
            "<MPN>@ (<ALTERNATE_SUFFIXES>) (<MFR>) {<STATUS>} [<REF>]",
        )
        self.assertEqual(step["occurrenceCount"], 1)
        self.assertEqual(
            {span["role"] for span in step["interpretation"]["interpretationSpans"]},
            {"mpn", "insertionMarker", "alternateList", "manufacturer"},
        )
        entries = step["interpretation"]["entries"]
        self.assertEqual(len(entries), 12)
        self.assertEqual(entries[0]["fields"]["mpn"]["value"], "P0402E1501BNW")
        self.assertEqual(entries[-1]["fields"]["mpn"]["value"], "P0402E1501BNPC")
        self.assertTrue(all(
            entry["fields"]["manufacturer"]["value"] == "VISH/SFE"
            for entry in entries
        ))

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_marker_inside_mpn_with_leading_delimiter_keeps_base_and_inserts_alternate(
        self, _saved_rules, _saved_interpretations
    ):
        value = "IRLML6402@PBF (/TR) (INFINEON) {HOM} [2225412]"

        result = build_bom_field_pattern_groups(
            ["Combined"],
            [{"Combined": value, "__sourceRow": 21}],
            roles={"mpn": "Combined", "manufacturer": "Combined"},
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True},
        )

        step = next(item for item in result["reviewWorkflow"]["steps"] if item["type"] == "teach_visual")
        self.assertEqual(
            result["patterns"][0]["suggestedRule"]["visualPattern"]["displayPattern"],
            "<MPN_PREFIX><INSERTION_MARKER><MPN_SUFFIX> (<ALTERNATE_VALUES>) (<MFR>) {<STATUS>} [<REF>]",
        )
        self.assertEqual(
            {span["role"] for span in step["interpretation"]["interpretationSpans"]},
            {"mpn", "insertionMarker", "alternateList", "manufacturer"},
        )
        self.assertEqual(
            [
                (entry["fields"]["mpn"]["value"], entry["fields"]["manufacturer"]["value"])
                for entry in step["interpretation"]["entries"]
            ],
            [
                ("IRLML6402PBF", "INFINEON"),
                ("IRLML6402TRPBF", "INFINEON"),
            ],
        )

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_pattern_combinations_ignore_repetition_count_and_return_all_entries(
        self, _saved_rules, _saved_interpretations
    ):
        rows = [
            {
                "Combined": "ABC123@ (1/2) (KEMET) / XYZ987 (YAGEO)",
                "__sourceRow": 2,
            },
            {
                "Combined": "DEF456@ (3/4) (KEMET) / UVW654 (YAGEO)",
                "__sourceRow": 3,
            },
            {
                "Combined": "LMN321 (VISHAY)",
                "__sourceRow": 4,
            },
            {
                "Combined": (
                    "GHI789@ (5/6) (KEMET) / "
                    "JKL012@ (7/8) (KEMET) / QRS543 (YAGEO)"
                ),
                "__sourceRow": 5,
            },
        ]

        result = build_bom_field_pattern_groups(
            ["Combined"],
            rows,
            roles={"mpn": "Combined", "manufacturer": "Combined"},
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True},
        )

        self.assertEqual(result["combinationCount"], 2)
        repeated = next(item for item in result["patternCombinations"] if item["matchingRowCount"] == 3)
        self.assertEqual(len(repeated["patternKeys"]), 2)
        self.assertEqual(len(repeated["patterns"]), 2)
        self.assertNotIn("samples", repeated)
        repeated_rows = [
            row for row in result["reviewRows"]
            if row["sourceRow"] in repeated["sourceRows"]
        ]
        first_row_entries = [
            entry
            for occurrence in repeated_rows[0]["occurrences"]
            for entry in occurrence["entries"]
        ]
        last_row_entries = [
            entry
            for occurrence in repeated_rows[2]["occurrences"]
            for entry in occurrence["entries"]
        ]
        self.assertEqual(len(repeated_rows), 3)
        self.assertEqual(len(first_row_entries), 3)
        self.assertEqual(len(first_row_entries), 3)
        self.assertEqual(len(last_row_entries), 5)
        self.assertTrue(repeated["patterns"][0]["countVaries"])
        self.assertTrue(repeated["patterns"][0]["hasAlternateList"])
        plain = next(item for item in result["patterns"] if item["grammar"] == "<MPN> (<MFR>)")
        self.assertFalse(plain["hasAlternateList"])
        self.assertEqual(result["reviewSummary"]["patternCount"], 2)
        self.assertEqual(result["reviewSummary"]["recognizedPatternCount"], 0)
        self.assertEqual(result["reviewSummary"]["unrecognizedPatternCount"], 2)
        self.assertEqual(len(result["reviewSummary"]["unrecognizedPatterns"]), 2)
        self.assertEqual(result["reviewRowCount"], 4)
        self.assertEqual(
            [row["sourceRow"] for row in result["reviewRows"]],
            [2, 3, 4, 5],
        )
        self.assertTrue(result["reviewRows"][0]["patterns"])

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_one_to_one_mapping_returns_direct_preview_without_semantic_patterns(
        self, _saved_rules, _saved_interpretations
    ):
        result = build_bom_field_pattern_groups(
            ["Name", "Manufacturer Equivalent Part", "Manufacturer"],
            [{
                "Name": "CPN-1",
                "Manufacturer Equivalent Part": "PREFIX-ABC123",
                "Manufacturer": "KEMET",
                "__sourceRow": 2,
            }],
            roles={
                "cpn": "Name",
                "mpn": "Manufacturer Equivalent Part",
                "manufacturer": "Manufacturer",
            },
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True},
        )

        self.assertEqual(result["patternCount"], 0)
        self.assertGreater(result["combinationCount"], 0)
        combination = result["patternCombinations"][0]
        self.assertTrue(combination["directPreview"])
        self.assertEqual(combination["matchingRowCount"], 1)
        self.assertNotIn("samples", combination)
        self.assertEqual(result["reviewRows"][0]["sourceRow"], 2)
        review_entries = [
            entry
            for occurrence in result["reviewRows"][0]["occurrences"]
            for entry in occurrence["entries"]
        ]
        self.assertTrue(review_entries)
        self.assertEqual(result["reviewSummary"]["patternCount"], 0)
        self.assertEqual(result["reviewSummary"]["recognizedPatternCount"], 0)
        self.assertEqual(result["reviewSummary"]["unrecognizedPatternCount"], 0)
        self.assertEqual(
            result["reviewSummary"]["itemCount"],
            len(review_entries),
        )
        self.assertEqual(result["reviewRowCount"], 1)
        self.assertEqual(result["reviewRows"][0]["sourceRow"], 2)

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_v3_review_contract_is_presentation_ready_and_omits_legacy_duplicates(
        self, _saved_rules, _saved_interpretations
    ):
        result = build_bom_field_pattern_groups(
            ["Combined"],
            [{"Combined": "ABC123@ (1/2) (KEMET)", "__sourceRow": 2}],
            roles={"mpn": "Combined", "manufacturer": "Combined"},
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True, "reviewContractVersion": 3},
        )

        self.assertNotIn("reviewRows", result)
        self.assertNotIn("patterns", result)
        review = result["review"]
        self.assertEqual(review["contractVersion"], 3)
        self.assertEqual(len(review["patterns"]), 1)
        self.assertEqual(review["patterns"][0]["status"], "unrecognized")
        self.assertTrue(review["patterns"][0]["teachContext"])
        self.assertEqual(review["patternsByField"]["mpn"], review["patterns"])
        self.assertEqual(review["display"]["reviewModeLabel"], "Shared-column interpretation")
        self.assertTrue(review["rows"][0]["entries"])
        self.assertIn("mpn", review["rows"][0]["visibleFieldKeys"])
        self.assertEqual(
            [option["key"] for option in review["mappedFieldOptions"]],
            ["mpn", "manufacturer"],
        )

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_one_to_one_mpn_with_customer_text_returns_semantic_pattern(
        self, _saved_rules, _saved_interpretations
    ):
        result = build_bom_field_pattern_groups(
            ["Manufacturer Code"],
            [
                {"Manufacturer Code": "CC0402 C0G 150 PF J 50V SNNI 1C ROHS", "__sourceRow": 8},
                {"Manufacturer Code": "TNPW04021K98BE@(ED/EI/EP)", "__sourceRow": 12},
                {"Manufacturer Code": "MAX3245EEAI+@ (/T)", "__sourceRow": 15},
                {"Manufacturer Code": "MURS240", "__sourceRow": 16},
            ],
            roles={"mpn": "Manufacturer Code"},
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True},
        )

        patterns = {
            pattern["grammar"]: pattern["occurrenceCount"]
            for pattern in result["patterns"]
        }
        self.assertEqual(result["patternCount"], 2)
        self.assertEqual(patterns["<MPN> <UNCLASSIFIED_TEXT>"], 1)
        self.assertEqual(patterns["<MPN>@ (<ALTERNATE_SUFFIXES>)"], 2)
        self.assertEqual(result["reviewSummary"]["unrecognizedPatternCount"], 2)
        self.assertEqual(result["reviewSummary"]["itemCount"], 7)
        self.assertEqual([row["sourceRow"] for row in result["reviewRows"]], [8, 12, 15, 16])

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_large_matching_pattern_response_stays_linear_and_compact(self, _saved_rules, _saved_interpretations):
        rows = [
            {
                "Combined": f"PART{index:04d}@ (A/B/C) (KEMET) {{HOM}} [{2000000 + index}]",
                "__sourceRow": index + 2,
            }
            for index in range(220)
        ]

        result = build_bom_field_pattern_groups(
            ["Combined"],
            rows,
            roles={"mpn": "Combined", "manufacturer": "Combined"},
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True, "maxRows": 500},
        )

        self.assertEqual(result["patternCount"], 1)
        pattern = result["patterns"][0]
        self.assertNotIn("occurrences", pattern)
        self.assertNotIn("interpretations", pattern)
        self.assertNotIn("rowEntries", pattern)
        self.assertEqual(len(pattern["samples"]), 1)
        self.assertEqual(len(result["reviewRows"]), 220)
        self.assertTrue(all("occurrences" not in row for sample in pattern["samples"] for row in sample["patternRows"]))
        self.assertLess(len(json.dumps(result)), 2_000_000)


class SemanticIdentityFragmentTests(SimpleTestCase):
    @patch(
        "excel_mapper.services.bom_role_inference._looks_like_parenthesized_manufacturer_alias",
        return_value=True,
    )
    def test_marker_without_alternate_list_has_distinct_semantic_grammar(self, _manufacturer_alias):
        values = {
            "PLAIN123(WTC){HOM}[]": "<MPN> (<MFR>) {<STATUS>} [<REF>]",
            "VJ0603Y102KXCA@(VISH/VIT){HOM}[1911348]": (
                "<MPN>@ (<MFR>) {<STATUS>} [<REF>]"
            ),
            'WF06U1503B@L(WTC){HOM}[]"': (
                '<MPN_PREFIX>@<MPN_SUFFIX> (<MFR>) {<STATUS>} [<REF>] "'
            ),
            "ABC123@L(A/B)(WTC){HOM}[]": (
                "<MPN_PREFIX>@<PRIMARY_SUFFIX> (<ALTERNATE_SUFFIXES>) "
                "(<MFR>) {<STATUS>} [<REF>]"
            ),
        }

        grammars = {}
        for value, expected in values.items():
            fragments = _semantic_identity_fragments(value, ["mpn", "manufacturer"])
            self.assertEqual(len(fragments), 1)
            grammars[value] = fragments[0]["grammar"]
            self.assertEqual(fragments[0]["grammar"], expected)

        keys = {
            _semantic_pattern_key("Combined", ["mpn", "manufacturer"], grammar)
            for grammar in grammars.values()
        }
        self.assertEqual(len(keys), len(values))

    @patch(
        "excel_mapper.services.bom_role_inference._best_mpn_from_text",
        side_effect=lambda value: (
            (value[6:], 1.0, "known MPN found inside cell")
            if len(value) > 6
            else (value, 0.2, "")
        ),
    )
    def test_mpn_position_groups_variable_prefix_values_by_detected_offset(self, _best_mpn):
        values = [
            "01525-22-03-2061\n28384-69173-406HLF",
            "27146-02015A180FAT\n11962-CC0201FRNP09BN180",
            "00078-CR1206FX1002ELF\n18981-CRCW120610K0FKE",
        ]

        grammars = [
            _semantic_identity_fragments(value, ["mpn"])[0]["grammar"]
            for value in values
        ]

        self.assertEqual(
            grammars,
            ["<PREFIX:6><MPN> repeated by <NEW_LINE>"] * 3,
        )

    def test_mpn_lookup_returns_loaded_match_while_caching_unknown_keys(self):
        lookup = DatabaseMpnLookup.__new__(DatabaseMpnLookup)
        lookup._known = {"KNOWN123": (1, "KNOWN-123")}
        lookup._entries = {
            "KNOWN123": {
                "mpn": "KNOWN-123",
                "normalized_mpn": "KNOWN123",
                "manufacturers": [],
                "counts": {},
            },
        }
        lookup._loaded = {"KNOWN123"}
        lookup._value_matches = {}

        result = lookup.get_many(["KNOWN123", "UNKNOWN999"], normalized=True)

        self.assertEqual(result["KNOWN123"]["mpn"], "KNOWN-123")
        self.assertIn("UNKNOWN999", lookup._loaded)

    def test_detected_mpn_position_rule_strips_each_newline_record(self):
        value = "01525-22-03-2061\n28384-69173-406HLF"
        rule = {
            "fields": {
                "mpn": {
                    "delimiter": "\\n",
                    "stripPrefix": "6",
                    "prefixMode": "first_n_chars",
                },
            },
        }

        entries = _infer_field_entries_for_row(
            {"Part": value},
            ["Part"],
            {"mpn": "Part"},
            ["Part"],
            config={"_activeFieldPatternRule": rule},
        )

        self.assertEqual(
            [entry["fields"]["mpn"]["value"] for entry in entries],
            ["22-03-2061", "69173-406HLF"],
        )

    def test_position_rule_returns_backend_newline_control(self):
        with patch(
            "excel_mapper.services.bom_role_inference._best_mpn_from_text",
            side_effect=lambda value: (value[6:], 1.0, "known MPN"),
        ):
            rule = _mpn_position_prefix_rule(
                "00037-GC2400009\n20038-278LF-24-65",
                source_column="Manufacturer Equivalent Part",
            )

        self.assertEqual(rule["fields"]["mpn"]["delimiter"], "\\n")
        self.assertEqual(rule["visualPattern"]["alternateDelimiter"], "\n")
        self.assertEqual(rule["visualPattern"]["alternateMode"], "complete")

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_repeated_supplier_prefixes_share_one_structural_pattern(
        self,
        _saved_rules,
        _saved_interpretations,
    ):
        values = [
            "18889-SMBT2222AE6327HTSA1 18846-MMBT2222ALT1G 18889-SMBT 2222A E6327 02254-SST2222AT116 28604-PMBT2222A",
            "11962-RC0603FR-0725K5L 05498-MC06032552FTW 18981-CRCW060325K5FKE 10302-RMCF1/16-25.5K-1% 02254 MCR03EZPFX2552",
        ]

        for value in values:
            self.assertEqual(
                _mpn_position_prefix_layout(value),
                {
                    "prefixLength": 6,
                    "recordDelimiter": "repeated_prefix",
                    "lineCount": 1,
                    "evidenceCount": 5,
                },
            )

        inferred = build_bom_field_pattern_groups(
            ["Manufacturer Equivalent part"],
            [
                {"Manufacturer Equivalent part": value, "__sourceRow": index + 2}
                for index, value in enumerate(values)
            ],
            roles={"mpn": "Manufacturer Equivalent part"},
            config={},
            options={"includeAllRows": True, "reviewContractVersion": 3},
        )

        self.assertEqual(len(inferred["review"]["patterns"]), 1)
        self.assertEqual(inferred["review"]["patterns"][0]["pattern"], "<PREFIX:6><MPN>")
        rule = _mpn_position_prefix_rule(values[1])
        self.assertEqual(rule["fields"]["mpn"]["delimiter"], "repeated_prefix")
        self.assertTrue(rule["fields"]["mpn"]["preserveOriginalValue"])
        entries = _infer_field_entries_for_row(
            {"Manufacturer Equivalent part": values[1]},
            ["Manufacturer Equivalent part"],
            {"mpn": "Manufacturer Equivalent part"},
            ["Manufacturer Equivalent part"],
            config={"_activeFieldPatternRule": rule},
        )
        self.assertEqual(
            [entry["fields"]["mpn"]["value"] for entry in entries],
            [
                "RC0603FR-0725K5L",
                "MC06032552FTW",
                "CRCW060325K5FKE",
                "RMCF1/16-25.5K-1%",
                "MCR03EZPFX2552",
            ],
        )

    def test_taught_repeated_prefix_rule_replays_on_other_supplier_prefix_rows(self):
        source_header = "Manufacturer Equivalent part"
        headers = [source_header, "Manufacturer"]
        roles = {"mpn": source_header, "manufacturer": "Manufacturer"}
        taught_value = (
            "AGILE-CC0805KKX7R8BB225 AGILE-C0805C225K3RAC "
            "AGILE-NMC0805X7R225K25TRPF AGILE-08053C225KAT"
        )
        first_end = taught_value.index(" AGILE-")
        taught = build_bom_field_pattern_teach_result(
            headers=headers,
            row={
                source_header: taught_value,
                "Manufacturer": "YAGEO KEMET NIC COMPONENTS AVX",
            },
            roles=roles,
            config={},
            group={"shape": "repeated-prefix", "patternKey": "repeated-prefix"},
            tagged_spans=[
                {"start": 6, "end": first_end, "role": "mpn"},
                {"start": first_end + 1, "end": len(taught_value), "role": "alternateList"},
            ],
            source_header=source_header,
            alternate_delimiter="/",
            alternate_mode="append",
            field_rules={
                "mpn": {
                    "stripPrefix": "6",
                    "prefixMode": "first_n_chars",
                },
            },
            prefer_field_rules=True,
        )

        self.assertNotIn("visualPattern", taught["rule"])
        self.assertEqual(taught["rule"]["fields"]["mpn"]["delimiter"], "repeated_prefix")
        self.assertEqual(
            [entry["fields"]["mpn"]["value"] for entry in taught["entries"]],
            [
                "CC0805KKX7R8BB225",
                "C0805C225K3RAC",
                "NMC0805X7R225K25TRPF",
                "08053C225KAT",
            ],
        )

        replayed = _infer_field_entries_for_row(
            {
                source_header: (
                    "18889-SMBT2222AE6327HTSA1 18846-MMBT2222ALT1G "
                    "18889-SMBT 2222A E6327 02254-SST2222AT116 28604-PMBT2222A"
                ),
                "Manufacturer": (
                    "INFINEON TECHNOLOGIES AG ON SEMICONDUCTOR "
                    "INFINEON TECHNOLOGIES AG ROHM NEXPERIA"
                ),
            },
            headers,
            roles,
            headers,
            config={"_activeFieldPatternRule": taught["rule"]},
        )
        self.assertEqual(
            [entry["fields"]["mpn"]["value"] for entry in replayed],
            [
                "SMBT2222AE6327HTSA1",
                "MMBT2222ALT1G",
                "SMBT 2222A E6327",
                "SST2222AT116",
                "PMBT2222A",
            ],
        )
        self.assertEqual(
            [entry["fields"]["manufacturer"]["value"] for entry in replayed],
            [
                "INFINEON TECHNOLOGIES AG",
                "ON SEMICONDUCTOR",
                "INFINEON TECHNOLOGIES AG",
                "ROHM",
                "NEXPERIA",
            ],
        )

    def test_visual_tags_override_field_only_preference_and_clean_each_mpn(self):
        value = (
            "00037-GC2400009\n"
            "20038-278LF-24-65\n"
            "05968-49SMLB24.0000-16GGC-E\n"
            "19971-ATSM-49-R 24.0000MHZ 16PF\n"
            "12085-Q 24,0-SMU3-16-30/50-T1-FU-LF\n"
            "20038-FC4SDCBKF24.0\n"
            "23512-FC4SDCBKF24.0"
        )
        manufacturers = (
            "DIODES INC.\n"
            "FOX ELECTRONICS\n"
            "PERICOM, FORMERLY SARONIX\n"
            "MTRONPTI\n"
            "JAUCH H.C.\n"
            "FOX ELECTRONICS\n"
            "ABRACON CORPORATION"
        )
        first_newline = value.index("\n")
        result = build_bom_field_pattern_teach_result(
            headers=["Manufacturer Equivalent Part", "Manufacturer"],
            row={
                "Manufacturer Equivalent Part": value,
                "Manufacturer": manufacturers,
            },
            roles={
                "mpn": "Manufacturer Equivalent Part",
                "manufacturer": "Manufacturer",
            },
            group={"shape": "newline-prefix", "patternKey": "newline-prefix"},
            tagged_spans=[
                {"start": 0, "end": first_newline, "role": "mpn"},
                {"start": first_newline + 1, "end": len(value), "role": "alternateList"},
            ],
            source_header="Manufacturer Equivalent Part",
            alternate_delimiter="\n",
            alternate_mode="complete",
            field_rules={
                "mpn": {
                    "delimiter": "\\n",
                    "stripPrefix": "6",
                    "prefixMode": "first_n_chars",
                },
            },
            prefer_field_rules=True,
        )

        self.assertTrue(result["visualPattern"])
        self.assertEqual(
            [entry["fields"]["mpn"]["value"] for entry in result["entries"]],
            [
                "GC2400009",
                "278LF-24-65",
                "49SMLB24.0000-16GGC-E",
                "ATSM-49-R 24.0000MHZ 16PF",
                "Q 24,0-SMU3-16-30/50-T1-FU-LF",
                "FC4SDCBKF24.0",
                "FC4SDCBKF24.0",
            ],
        )
        self.assertEqual(
            [entry["fields"]["manufacturer"]["value"] for entry in result["entries"]],
            [
                "DIODES INC.",
                "FOX ELECTRONICS",
                "PERICOM, FORMERLY SARONIX",
                "MTRONPTI",
                "JAUCH H.C.",
                "FOX ELECTRONICS",
                "ABRACON CORPORATION",
            ],
        )

    def test_complete_newline_mpn_tag_uses_record_split_before_prefix_cleanup(self):
        value = (
            "00037-GC2400009\n"
            "20038-278LF-24-65\n"
            "05968-49SMLB24.0000-16GGC-E\n"
            "19971-ATSM-49-R 24.0000MHZ 16PF\n"
            "12085-Q 24,0-SMU3-16-30/50-T1-FU-LF\n"
            "20038-FC4SDCBKF24.0\n"
            "23512-FC4SDCBKF24.0"
        )
        manufacturers = (
            "DIODES INC.\n"
            "FOX ELECTRONICS\n"
            "PERICOM, FORMERLY SARONIX\n"
            "MTRONPTI\n"
            "JAUCH H.C.\n"
            "FOX ELECTRONICS\n"
            "ABRACON CORPORATION"
        )

        result = build_bom_field_pattern_teach_result(
            headers=["Manufacturer Equivalent Part", "Manufacturer"],
            row={
                "Manufacturer Equivalent Part": value,
                "Manufacturer": manufacturers,
            },
            roles={
                "mpn": "Manufacturer Equivalent Part",
                "manufacturer": "Manufacturer",
            },
            group={"shape": "newline-prefix", "patternKey": "newline-prefix"},
            tagged_spans=[
                {"start": 6, "end": len(value), "role": "mpn"},
            ],
            source_header="Manufacturer Equivalent Part",
            alternate_delimiter="\n",
            alternate_mode="complete",
            field_rules={
                "mpn": {
                    "stripPrefix": "6",
                    "prefixMode": "first_n_chars",
                },
            },
            prefer_field_rules=True,
        )

        self.assertEqual(result["rule"]["fields"]["mpn"]["delimiter"], "\\n")
        self.assertEqual(
            [entry["fields"]["mpn"]["value"] for entry in result["entries"]],
            [
                "GC2400009",
                "278LF-24-65",
                "49SMLB24.0000-16GGC-E",
                "ATSM-49-R 24.0000MHZ 16PF",
                "Q 24,0-SMU3-16-30/50-T1-FU-LF",
                "FC4SDCBKF24.0",
                "FC4SDCBKF24.0",
            ],
        )
        self.assertEqual(
            [entry["fields"]["manufacturer"]["value"] for entry in result["entries"]],
            [
                "DIODES INC.",
                "FOX ELECTRONICS",
                "PERICOM, FORMERLY SARONIX",
                "MTRONPTI",
                "JAUCH H.C.",
                "FOX ELECTRONICS",
                "ABRACON CORPORATION",
            ],
        )

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    @patch("excel_mapper.services.bom_role_inference._best_mpn_from_text")
    def test_complete_newline_field_rule_becomes_recognized_after_teach(
        self,
        best_mpn,
        _saved_rules,
        _saved_interpretations,
    ):
        best_mpn.side_effect = lambda value: (
            (str(value)[6:], 1.0, "known MPN found inside cell")
            if str(value).startswith(("01525-", "28384-"))
            else (str(value), 1.0, "known MPN")
        )
        source_header = "Manufacturer Equivalent Part"
        source_value = "01525-22-03-2061\n28384-69173-406HLF"
        manufacturers = "MOLEX\nAMPHENOL FCI"
        headers = [source_header, "Manufacturer"]
        roles = {"mpn": source_header, "manufacturer": "Manufacturer"}
        row = {
            source_header: source_value,
            "Manufacturer": manufacturers,
            "__sourceRow": 2,
        }
        inferred = build_bom_field_pattern_groups(
            headers,
            [row],
            roles=roles,
            config={},
            options={"includeAllRows": True, "reviewContractVersion": 3},
        )
        review = inferred["review"]
        pattern = next(
            item for item in review["patterns"]
            if "<PREFIX:6><MPN>" in item["pattern"]
        )
        teach_context = pattern["teachContext"]
        taught = build_bom_field_pattern_teach_result(
            headers=headers,
            row=row,
            roles=roles,
            config={},
            group={
                "id": pattern["groupId"],
                "shape": pattern["patternKey"],
                "patternKey": pattern["patternKey"],
            },
            tagged_spans=[
                {"start": 6, "end": len(source_value), "role": "mpn"},
            ],
            source_header=source_header,
            alternate_delimiter="\n",
            alternate_mode="complete",
            field_rules={
                "mpn": {
                    "stripPrefix": "6",
                    "prefixMode": "first_n_chars",
                },
            },
            prefer_field_rules=True,
        )
        refreshed = refresh_bom_field_pattern_review_after_teach(
            review,
            taught,
            group={
                "id": pattern["groupId"],
                "shape": pattern["patternKey"],
                "patternKey": pattern["patternKey"],
            },
            roles=roles,
            config={},
            active_rules={pattern["patternKey"]: taught["rule"]},
            source_row=2,
            occurrence_id=teach_context["sample"]["sourceFragment"]["id"],
            completed_step_id=teach_context["workflowStepId"],
            taught_source_value=source_value,
        )

        refreshed_pattern = next(
            item for item in refreshed["patterns"]
            if item["patternKey"] == pattern["patternKey"]
        )
        self.assertTrue(refreshed_pattern["recognized"])
        self.assertEqual(refreshed_pattern["statusLabel"], "Recognized")
        self.assertEqual(refreshed["summary"]["recognizedPatternCount"], 1)
        self.assertEqual(refreshed["summary"]["unrecognizedPatternCount"], 0)

    @patch(
        "excel_mapper.services.bom_role_inference._looks_like_parenthesized_manufacturer_alias"
    )
    def test_false_early_manufacturer_never_truncates_complete_source_record(
        self, looks_like_manufacturer
    ):
        looks_like_manufacturer.side_effect = lambda value: str(value).strip() == "TR"
        value = "HM71-101R0LF@ (TR) (BITECHNO) {HOM} [2218451]"

        fragments = _semantic_identity_fragments(value, ["mpn", "manufacturer"])

        self.assertEqual(len(fragments), 1)
        self.assertEqual(fragments[0]["rawValue"], value)
        self.assertEqual(fragments[0]["start"], 0)
        self.assertEqual(fragments[0]["end"], len(value))
        self.assertIn("(<MFR>)", fragments[0]["grammar"])

    @patch(
        "excel_mapper.services.bom_role_inference._looks_like_parenthesized_manufacturer_alias",
        return_value=True,
    )
    def test_unconsumed_text_falls_back_without_cutting_source_record(
        self, _looks_like_manufacturer
    ):
        value = "ABC123 (TR) CUSTOMER TEXT"

        fragments = _semantic_identity_fragments(value, ["mpn", "manufacturer"])

        self.assertEqual(len(fragments), 1)
        self.assertEqual(fragments[0]["rawValue"], value)
        self.assertEqual(fragments[0]["end"], len(value))

    @patch("excel_mapper.services.bom_role_inference.prime_mpn_lookup")
    @patch("excel_mapper.services.bom_role_inference.score_manufacturer_value")
    @patch("excel_mapper.services.bom_role_inference.score_mpn_value")
    def test_value_evidence_keeps_reference_code_separate_from_mpn_and_manufacturer(
        self, score_mpn, score_manufacturer, _prime_lookup
    ):
        def mpn_result(value):
            text = str(value or "")
            matched = text.startswith("PART-") or text == "F9111"
            return {
                "score": 1.0 if matched else 0.0,
                "matched": matched,
                "manufacturer_context": False,
                "mpn_label": False,
                "numeric_identifier": False,
                "document_context": False,
                "exact_lookup": False,
                "generic_spec_designator": False,
            }

        def manufacturer_result(value):
            text = str(value or "")
            matched = text.startswith("Maker ")
            return {
                "score": 1.0 if matched else 0.0,
                "matched": matched,
                "manufacturer": text if matched else "",
            }

        score_mpn.side_effect = mpn_result
        score_manufacturer.side_effect = manufacturer_result
        rows = [
            {
                "MFR": "F9111",
                "Manufacturer Name": f"Maker {index % 3}",
                "Manufacturer Code Number": f"PART-{index:04d}",
            }
            for index in range(12)
        ]

        inferred = infer_bom_roles(
            ["MFR", "Manufacturer Name", "Manufacturer Code Number"],
            rows,
        )

        self.assertEqual(inferred["roles"]["mpn"], "Manufacturer Code Number")
        self.assertEqual(inferred["roles"]["manufacturer"], "Manufacturer Name")

    def test_code_like_reference_is_not_intrinsically_a_manufacturer_name(self):
        self.assertTrue(_looks_like_manufacturer_code_only("F9111"))
        self.assertFalse(_looks_like_manufacturer_code_only("3M"))
        self.assertFalse(_looks_like_manufacturer_code_only("Vishay Dale Electronics"))

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_mpn_only_inference_surfaces_marker_pattern_in_review_summary(
        self, _saved_rules, _saved_interpretations
    ):
        result = build_bom_field_pattern_groups(
            ["Manufacturer Code Number"],
            [{
                "Manufacturer Code Number": "TNPW04021K98BE@ (ED/EI/EP)",
                "__sourceRow": 21,
            }],
            roles={"mpn": "Manufacturer Code Number"},
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True},
        )

        self.assertEqual(result["patternCount"], 1)
        self.assertEqual(
            result["patterns"][0]["grammar"],
            "<MPN>@ (<ALTERNATE_SUFFIXES>)",
        )
        self.assertEqual(
            result["reviewSummary"]["unrecognizedPatterns"][0]["pattern"],
            "<MPN>@ (<ALTERNATE_SUFFIXES>)",
        )
        visual_pattern = result["patterns"][0]["suggestedRule"]["visualPattern"]
        self.assertEqual(
            visual_pattern["mpnComposition"]["operation"],
            "insert_alternate_at_marker",
        )
        self.assertEqual(visual_pattern["alternateDelimiter"], "/")
        self.assertEqual(
            [
                entry["fields"]["mpn"]["value"]
                for entry in result["reviewRows"][0]["occurrences"][0]["entries"]
            ],
            ["TNPW04021K98BEED", "TNPW04021K98BEEI", "TNPW04021K98BEEP"],
        )

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_saved_rule_needs_review_when_it_does_not_cover_detected_alternates(
        self, _saved_rules, saved_interpretations
    ):
        source_header = "Manufacturer Code Number"
        grammar = "<MPN>@ (<ALTERNATE_SUFFIXES>)"
        pattern_key = _semantic_pattern_key(source_header, ["mpn"], grammar)
        saved_interpretations.return_value = {
            pattern_key: {
                "patternKey": pattern_key,
                "matchScope": "structure",
                "rule": {
                    "shape": pattern_key,
                    "patternKey": pattern_key,
                    "fields": {"mpn": {"delimiter": "none"}},
                    "visualPattern": {
                        "type": "tagged_fields",
                        "sourceHeader": source_header,
                        "segments": [
                            {"role": "mpn", "before": "", "after": "@", "wrapper": None},
                        ],
                    },
                },
            },
        }

        result = build_bom_field_pattern_groups(
            [source_header],
            [{source_header: "TNPW04021K98BE@ (ED/EI/EP)", "__sourceRow": 21}],
            roles={"mpn": source_header},
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True},
        )

        pattern = result["patterns"][0]
        self.assertFalse(pattern["recognized"])
        self.assertEqual(
            pattern["recognitionValidation"]["missingRoles"],
            ["alternateList"],
        )
        self.assertEqual(result["reviewSummary"]["recognizedPatternCount"], 0)
        self.assertEqual(result["reviewSummary"]["unrecognizedPatternCount"], 1)

    def test_saved_rule_needs_review_when_alternate_segment_does_not_apply(self):
        validation = _semantic_interpretation_coverage(
            "<MPN>@ (<ALTERNATE_SUFFIXES>) (<MFR>)",
            ["mpn", "manufacturer"],
            {
                "visualPattern": {
                    "type": "bracket_alternate_manufacturer",
                    "segments": [
                        {"role": "mpn"},
                        {"role": "alternateList"},
                        {"role": "manufacturer"},
                    ],
                },
            },
            [{
                "occurrenceId": "row-41",
                "sourceRow": 41,
                "interpretationSpans": [
                    {"role": "mpn", "start": 0, "end": 7},
                    {"role": "manufacturer", "start": 24, "end": 29},
                ],
            }],
        )

        self.assertFalse(validation["valid"])
        self.assertEqual(validation["missingRoles"], [])
        self.assertEqual(validation["failedOccurrenceCount"], 1)
        self.assertEqual(
            validation["failedOccurrences"][0]["missingRoles"],
            ["alternateList"],
        )

    def test_mpn_only_cell_detects_literal_marker_before_alternate_list(self):
        self.assertEqual(
            _mpn_only_marker_alternate_pattern("TNPW04021K98BE@ (ED/EI/EP)"),
            "<MPN>@ (<ALTERNATE_SUFFIXES>)",
        )
        self.assertEqual(
            _mpn_only_marker_alternate_pattern("MAX3245EEAI+@ (/T)"),
            "<MPN>@ (<ALTERNATE_SUFFIXES>)",
        )

        fragments = _semantic_identity_fragments(
            "TNPW04021K98BE@ (ED/EI/EP)",
            ["mpn"],
        )
        self.assertEqual(fragments[0]["grammar"], "<MPN>@ (<ALTERNATE_SUFFIXES>)")

    def test_mpn_only_cell_does_not_treat_plain_at_or_annotation_as_alternates(self):
        self.assertEqual(_mpn_only_marker_alternate_pattern("C0603C104K5RAC@"), "")
        self.assertEqual(
            _mpn_only_marker_alternate_pattern("ABC123@ (Tape & Reel)"),
            "",
        )

    def test_review_labels_preserve_detected_separator_over_saved_display_label(self):
        grammar = "<MPN>@ (<ALTERNATE_SUFFIXES>) (<MFR>) {<STATUS>} [<REF>]"
        pattern = {
            "patternKey": "semantic-test",
            "grammar": grammar,
            "interpretationPattern": (
                "<MPN> (<ALTERNATE_MPN_VALUES>) (<MFR>) {<STATUS>} [<REF>]"
            ),
            "sourceColumn": "Ref Statut",
            "mappedFields": ["mpn", "manufacturer"],
            "occurrenceCount": 1,
            "recognized": True,
            "storedInterpretation": {"matchScope": "structure"},
            "occurrences": [{"sourceRow": 21}],
            "interpretations": [],
        }

        summary = _build_pattern_review_summary([pattern], [])
        workflow = _build_bom_field_review_workflow(
            ["Ref Statut"],
            {"mpn": "Ref Statut", "manufacturer": "Ref Statut"},
            {"alternateLayout": "inside_selected_mpn_columns"},
            [],
            patterns=[pattern],
        )

        self.assertEqual(summary["recognizedPatterns"][0]["pattern"], grammar)
        self.assertEqual(workflow["steps"][0]["pattern"], grammar)

    def test_hash_and_at_marker_sequences_remain_distinct_in_pattern_grammar(self):
        self.assertEqual(
            _mpn_source_fragment_pattern("ABC123@00 (P1/P5)"),
            "<MPN_PREFIX>@<PRIMARY_SUFFIX> (<ALTERNATE_SUFFIXES>)",
        )
        self.assertEqual(
            _mpn_source_fragment_pattern("ABC123#00 (P1/P5)"),
            "<MPN_PREFIX>#<PRIMARY_SUFFIX> (<ALTERNATE_SUFFIXES>)",
        )
        self.assertEqual(
            _mpn_source_fragment_pattern("LTC2936IUFD#@PBF (/TR)"),
            "<MPN_PREFIX>#@<PRIMARY_SUFFIX> (<ALTERNATE_SUFFIXES>)",
        )

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_infer_response_returns_distinct_at_hash_and_hash_at_review_steps(
        self, _saved_rules, _saved_interpretations
    ):
        result = build_bom_field_pattern_groups(
            ["Combined"],
            [{
                "Combined": (
                    "ABC123@00 (P1/P5) (KEMET) / "
                    "DEF456#00 (P1/P5) (KEMET) / "
                    "LTC2936IUFD#@PBF (/TR) (LTC)"
                ),
                "__sourceRow": 2,
            }],
            roles={"mpn": "Combined", "manufacturer": "Combined"},
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True},
        )

        expected = {
            "<MPN_PREFIX>@<PRIMARY_SUFFIX> (<ALTERNATE_SUFFIXES>) (<MFR>)",
            "<MPN_PREFIX>#<PRIMARY_SUFFIX> (<ALTERNATE_SUFFIXES>) (<MFR>)",
            "<MPN_PREFIX>#@<PRIMARY_SUFFIX> (<ALTERNATE_SUFFIXES>) (<MFR>)",
        }
        self.assertEqual({pattern["grammar"] for pattern in result["patterns"]}, expected)
        self.assertEqual(
            {step["pattern"] for step in result["reviewWorkflow"]["steps"] if step["type"] == "teach_visual"},
            expected,
        )

    def test_visual_rule_preserves_complete_hash_at_marker_sequence(self):
        source = "LTC2936IUFD#@PBF (/TR) (LTC) {HOM} [3489945]"

        def span(value, role):
            start = source.index(value)
            return {"start": start, "end": start + len(value), "role": role}

        visual_pattern = derive_visual_pattern_from_tagged_spans(
            source,
            "Combined",
            [
                span("LTC2936IUFD#@PBF", "mpn"),
                span("/TR", "alternateList"),
                span("LTC", "manufacturer"),
            ],
            alternate_delimiter="/",
        )

        self.assertEqual(visual_pattern["mpnComposition"]["markerSequence"], "#@")
        self.assertIn("<MPN_PREFIX>#@<PRIMARY_SUFFIX>", visual_pattern["displayPattern"])

    def test_keeps_complete_records_when_suffix_and_manufacturer_are_both_parenthesized(self):
        value = (
            "BAT54SW,@ (FILM) (STM) {HOM} [1800208]\n"
            "BAT54SW,@ (115) (NEXPERIA) {HOM} [1683148]"
        )

        fragments = _semantic_identity_fragments(value, ["mpn", "manufacturer"])

        self.assertEqual(
            [fragment["rawValue"] for fragment in fragments],
            [
                "BAT54SW,@ (FILM) (STM) {HOM} [1800208]",
                "BAT54SW,@ (115) (NEXPERIA) {HOM} [1683148]",
            ],
        )
        self.assertTrue(all("{<STATUS>} [<REF>]" in fragment["grammar"] for fragment in fragments))

    def test_does_not_carry_previous_record_tail_into_next_pattern(self):
        value = (
            "FJX3906TF (ON SEMI) {AFAB} [2629851]\n"
            "PMST3906,@ (115/135) (NEXPERIA) {HOM} [2453994]"
        )

        fragments = _semantic_identity_fragments(value, ["mpn", "manufacturer"])

        self.assertEqual(
            [fragment["rawValue"] for fragment in fragments],
            [
                "FJX3906TF (ON SEMI) {AFAB} [2629851]",
                "PMST3906,@ (115/135) (NEXPERIA) {HOM} [2453994]",
            ],
        )

    def test_newline_separated_records_remain_independent_patterns(self):
        value = (
            "PCB VIA FILLING PHP-900 IR-10FH (KAGAKU) {HOM} [5015803]\n"
            "VIA FILLING PHP-900 IR-10FH (KAGAKU) {HOM} [3786123]\n"
            "VIA FILLING THP-100 DX1 VF (HV) (TAIYO YU) {HOM} [3783283]\n"
            "VIA FILLING THP-100DX1 (HT) (TAIYO YU) {HOM} [3786123]"
        )

        fragments = _semantic_identity_fragments(value, ["mpn", "manufacturer"])

        self.assertEqual(len(fragments), 4)
        self.assertEqual(
            [fragment["rawValue"] for fragment in fragments],
            value.splitlines(),
        )
        self.assertEqual(
            [fragment["grammar"] for fragment in fragments],
            [
                "<MPN> (<MFR>) {<STATUS>} [<REF>]",
                "<MPN> (<MFR>) {<STATUS>} [<REF>]",
                "<MPN> (<SUFFIX>) (<MFR>) {<STATUS>} [<REF>]",
                "<MPN> (<SUFFIX>) (<MFR>) {<STATUS>} [<REF>]",
            ],
        )

    def test_spaced_slash_does_not_cut_an_incomplete_identity_fragment(self):
        value = "AU 0,1 (I1) / N 5 (I) SELECTIVE (CST/EPM) {HOM} [2754403]"

        fragments = _semantic_identity_fragments(value, ["mpn", "manufacturer"])

        self.assertEqual(len(fragments), 1)
        self.assertEqual(fragments[0]["rawValue"], value)

    def test_spaced_slash_still_splits_complete_identity_records(self):
        value = "ABC123 (KEMET) / XYZ987 (YAGEO)"

        fragments = _semantic_identity_fragments(value, ["mpn", "manufacturer"])

        self.assertEqual(
            [fragment["rawValue"] for fragment in fragments],
            ["ABC123 (KEMET)", "XYZ987 (YAGEO)"],
        )

    def test_trailing_punctuation_stays_attached_to_previous_pattern(self):
        value = (
            "R0402JR-002RL (07/10/13) (YAGEO) {HOM} [1824601]\n"
            "WR04X000 PTL (A/B/D/H/T) (WTC) {HOM} [3078936]\""
        )

        fragments = _semantic_identity_fragments(value, ["mpn", "manufacturer"])

        self.assertEqual(len(fragments), 2)
        self.assertEqual(
            [fragment["rawValue"] for fragment in fragments],
            [
                "R0402JR-002RL (07/10/13) (YAGEO) {HOM} [1824601]",
                "WR04X000 PTL (A/B/D/H/T) (WTC) {HOM} [3078936]\"",
            ],
        )
        self.assertTrue(all(fragment["grammar"] != "<UNCLASSIFIED_TEXT>" for fragment in fragments))
        self.assertTrue(fragments[1]["grammar"].endswith('"'))

    def test_manual_preview_edits_realign_backend_highlights(self):
        value = "WR04X000 P@L (A/B/D/H/T) (WTC) {HOM} [3078936]"

        def span(text, role):
            start = value.index(text)
            return {"start": start, "end": start + len(text), "role": role}

        result = build_bom_field_pattern_teach_result(
            headers=["Combined"],
            row={"Combined": value},
            roles={"mpn": "Combined", "manufacturer": "Combined"},
            entries=[{
                "relation": "Primary",
                "fields": {
                    "mpn": "WR04X000 P@L",
                    "manufacturer": "WTC",
                },
            }],
            group={"shape": "manual-highlight-realignment"},
            tagged_spans=[
                span("WR04X000", "mpn"),
                span("A/B/D/H/T", "alternateList"),
                span("WTC", "manufacturer"),
            ],
            source_header="Combined",
            alternate_delimiter="/",
            has_manual_edits=True,
        )

        spans = result["interpretationSpansByColumn"]["Combined"]
        mpn_span = next(item for item in spans if item["role"] == "mpn")
        manufacturer_span = next(item for item in spans if item["role"] == "manufacturer")
        alternate_span = next(item for item in spans if item["role"] == "alternateList")
        self.assertEqual(value[mpn_span["start"]:mpn_span["end"]], "WR04X000 P@L")
        self.assertEqual(value[manufacturer_span["start"]:manufacturer_span["end"]], "WTC")
        self.assertEqual(value[alternate_span["start"]:alternate_span["end"]], "A/B/D/H/T")

    def test_visual_preview_uses_the_selected_repeated_parenthesis_boundary(self):
        value = "CAF33 TRANSLUCIDE (310ML) (ELKEM SI) {HOM} [ ]"
        mpn_text = "CAF33 TRANSLUCIDE (310ML)"

        def span(text, role):
            start = value.index(text)
            return {"start": start, "end": start + len(text), "role": role}

        result = build_bom_field_pattern_teach_result(
            headers=["Combined"],
            row={"Combined": value},
            roles={"mpn": "Combined", "manufacturer": "Combined"},
            group={"patternKey": "repeated-parenthesis-boundary"},
            tagged_spans=[
                span(mpn_text, "mpn"),
                span("ELKEM SI", "manufacturer"),
            ],
            source_header="Combined",
        )

        fields = result["entries"][0]["fields"]
        self.assertEqual(fields["mpn"]["value"], mpn_text)
        self.assertEqual(fields["manufacturer"]["value"], "ELKEM SI")
        self.assertEqual(result["visualPattern"]["segments"][0]["afterOccurrence"], 2)

    def test_visual_preview_preserves_brackets_around_a_tagged_mpn_segment(self):
        value = "CAF33 TRANSLUCIDE (310ML) (ELKEM SI) {HOM} [ ]"

        def span(text, role):
            start = value.index(text)
            return {"start": start, "end": start + len(text), "role": role}

        result = build_bom_field_pattern_teach_result(
            headers=["Combined"],
            row={"Combined": value},
            roles={"mpn": "Combined", "manufacturer": "Combined"},
            group={"patternKey": "wrapped-mpn-segment"},
            tagged_spans=[
                span("CAF33 TRANSLUCIDE", "mpn"),
                span("310ML", "mpn"),
                span("ELKEM SI", "manufacturer"),
            ],
            source_header="Combined",
        )

        fields = result["entries"][0]["fields"]
        self.assertEqual(fields["mpn"]["value"], "CAF33 TRANSLUCIDE (310ML)")
        self.assertEqual(fields["manufacturer"]["value"], "ELKEM SI")
        spans = result["interpretationSpansByColumn"]["Combined"]
        wrapped_mpn_span = next(
            item for item in spans
            if item["role"] == "mpn" and value[item["start"]:item["end"]] == "(310ML)"
        )
        self.assertEqual(value[wrapped_mpn_span["start"]:wrapped_mpn_span["end"]], "(310ML)")

    def test_manual_normalized_preview_values_realign_to_punctuated_source(self):
        value = "CAF33 TRANSLUCIDE (310ML) (ELKEM SI) {HOM} [ ]"

        def span(text, role):
            start = value.index(text)
            return {"start": start, "end": start + len(text), "role": role}

        result = build_bom_field_pattern_teach_result(
            headers=["Combined"],
            row={"Combined": value},
            roles={"mpn": "Combined", "manufacturer": "Combined"},
            entries=[{
                "relation": "Primary",
                "fields": {
                    "mpn": "CAF33 TRANSLUCIDE310ML",
                    "manufacturer": "ELKEM SI",
                },
            }],
            group={"patternKey": "manual-normalized-preview"},
            tagged_spans=[
                span("CAF33 TRANSLUCIDE", "mpn"),
                span("310ML", "manufacturer"),
            ],
            source_header="Combined",
            has_manual_edits=True,
        )

        fields = result["entries"][0]["fields"]
        self.assertEqual(fields["mpn"]["value"], "CAF33 TRANSLUCIDE310ML")
        self.assertEqual(fields["manufacturer"]["value"], "ELKEM SI")
        spans = result["interpretationSpansByColumn"]["Combined"]
        mpn_span = next(item for item in spans if item["role"] == "mpn")
        manufacturer_span = next(item for item in spans if item["role"] == "manufacturer")
        self.assertEqual(value[mpn_span["start"]:mpn_span["end"]], "CAF33 TRANSLUCIDE (310ML)")
        self.assertEqual(value[manufacturer_span["start"]:manufacturer_span["end"]], "ELKEM SI")

    def test_standalone_punctuation_remains_available_for_user_review(self):
        fragments = _semantic_identity_fragments('"', ["mpn", "manufacturer"])

        self.assertEqual(fragments, [{
            "start": 0,
            "end": 1,
            "rawValue": '"',
            "grammar": "<UNCLASSIFIED_TEXT>",
        }])

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_one_taught_semantic_rule_applies_to_every_matching_fragment(self, _saved_rules, _saved_interpretations):
        headers = ["Combined"]
        roles = {"mpn": "Combined", "manufacturer": "Combined"}
        full_value = "ABC123@ (A/B) (KEMET) / XYZ987@ (C/D) (YAGEO)"
        inferred = build_bom_field_pattern_groups(
            headers,
            [{"Combined": full_value, "__sourceRow": 2}],
            roles=roles,
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True},
        )
        pattern = inferred["patterns"][0]
        fragment = inferred["reviewRows"][0]["occurrences"][0]["rawValue"]

        def span(text, role):
            start = fragment.index(text)
            return {"start": start, "end": start + len(text), "role": role}

        taught = build_bom_field_pattern_teach_result(
            headers=headers,
            row={"Combined": fragment},
            roles=roles,
            group={"shape": pattern["shape"], "patternKey": pattern["patternKey"]},
            tagged_spans=[
                span("ABC123@", "mpn"),
                span("A/B", "alternateList"),
                span("KEMET", "manufacturer"),
            ],
            source_header="Combined",
            alternate_delimiter="/",
        )
        normalized = normalize_bom_rows(
            headers,
            [{"Combined": full_value, "__sourceRow": 2}],
            roles=roles,
            config={
                "alternateLayout": "inside_selected_mpn_columns",
                "fieldPatternRules": {pattern["patternKey"]: taught["rule"]},
            },
        )

        self.assertEqual(
            [row["mpn"] for row in normalized["normalizedRows"]],
            ["ABC123", "ABC123A", "ABC123B", "XYZ987", "XYZ987C", "XYZ987D"],
        )
        self.assertEqual(
            [row["manufacturer"] for row in normalized["normalizedRows"]],
            ["KEMET", "KEMET", "KEMET", "YAGEO", "YAGEO", "YAGEO"],
        )

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_teach_refresh_updates_matching_review_rows_without_reinferring_groups(
        self,
        _saved_rules,
        _saved_interpretations,
    ):
        headers = ["Combined"]
        roles = {"mpn": "Combined", "manufacturer": "Combined"}
        config = {"alternateLayout": "inside_selected_mpn_columns"}
        rows = [
            {"Combined": "ABC123@ (A/B) (KEMET)", "__sourceRow": 2},
            {"Combined": "XYZ987@ (C/D) (YAGEO)", "__sourceRow": 3},
        ]
        inferred = build_bom_field_pattern_groups(
            headers,
            rows,
            roles=roles,
            config=config,
            options={
                "includeAllRows": True,
                "reviewContractVersion": 3,
            },
        )
        review = inferred["review"]
        pattern = review["patterns"][0]
        teach_context = pattern["teachContext"]
        source_value = teach_context["sample"]["sourceFragment"]["rawValue"]

        def span(text, role):
            start = source_value.index(text)
            return {"start": start, "end": start + len(text), "role": role}

        taught = build_bom_field_pattern_teach_result(
            headers=headers,
            row={"Combined": source_value, "__sourceRow": 2},
            roles=roles,
            config=config,
            group={
                "id": pattern["groupId"],
                "shape": pattern["patternKey"],
                "patternKey": pattern["patternKey"],
            },
            tagged_spans=[
                span("ABC123@", "mpn"),
                span("A/B", "alternateList"),
                span("KEMET", "manufacturer"),
            ],
            source_header="Combined",
            alternate_delimiter="/",
        )
        active_rules = {pattern["patternKey"]: taught["rule"]}
        refreshed = refresh_bom_field_pattern_review_after_teach(
            review,
            taught,
            group={
                "id": pattern["groupId"],
                "shape": pattern["patternKey"],
                "patternKey": pattern["patternKey"],
            },
            roles=roles,
            config=config,
            active_rules=active_rules,
            source_row=2,
            occurrence_id=teach_context["sample"]["sourceFragment"]["id"],
            completed_step_id=teach_context["workflowStepId"],
            taught_source_value=source_value,
        )

        self.assertEqual(refreshed["activeRules"], active_rules)
        self.assertEqual(refreshed["summary"]["recognizedPatternCount"], 1)
        self.assertEqual(refreshed["summary"]["unrecognizedPatternCount"], 0)
        self.assertIn(teach_context["workflowStepId"], refreshed["workflow"]["completedStepIds"])
        self.assertEqual(
            [[entry["fields"]["mpn"] for entry in row["entries"]] for row in refreshed["rows"]],
            [
                ["ABC123", "ABC123A", "ABC123B"],
                ["XYZ987", "XYZ987C", "XYZ987D"],
            ],
        )

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_teach_refresh_preserves_every_record_in_a_multiline_cell(
        self,
        _saved_rules,
        _saved_interpretations,
    ):
        source_header = "Ref.Fab(Fabricant){Statut}[BI]"
        headers = ["Ref. Article", source_header, "Libelle"]
        roles = {
            "cpn": "Ref. Article",
            "mpn": source_header,
            "manufacturer": source_header,
            "description": "Libelle",
        }
        config = {"alternateLayout": "inside_selected_mpn_columns"}
        source_value = "\n".join([
            "201Y04L (NICOMATI) {HOM} [1881177]",
            "212M04T03L (ATI) {HOM} [1881176]",
            "212M04T04L (ATI) {HOM} [2253508]",
        ])
        inferred = build_bom_field_pattern_groups(
            headers,
            [{
                "Ref. Article": "A1211925",
                source_header: source_value,
                "Libelle": "CONN CARTE EMBASE 4 CONTACTS",
                "__sourceRow": 39,
            }],
            roles=roles,
            config=config,
            options={"includeAllRows": True, "reviewContractVersion": 3},
        )
        review = inferred["review"]
        pattern = review["patterns"][0]
        teach_context = pattern["teachContext"]
        fragment = teach_context["sample"]["sourceFragment"]["rawValue"]

        def span(text, role):
            start = fragment.index(text)
            return {"start": start, "end": start + len(text), "role": role}

        taught = build_bom_field_pattern_teach_result(
            headers=headers,
            row={source_header: fragment, "__sourceRow": 39},
            roles=roles,
            config=config,
            group={
                "id": pattern["groupId"],
                "shape": pattern["patternKey"],
                "patternKey": pattern["patternKey"],
            },
            tagged_spans=[
                span("201Y04L", "mpn"),
                span("NICOMATI", "manufacturer"),
            ],
            source_header=source_header,
        )
        refreshed = refresh_bom_field_pattern_review_after_teach(
            review,
            taught,
            group={
                "id": pattern["groupId"],
                "shape": pattern["patternKey"],
                "patternKey": pattern["patternKey"],
            },
            roles=roles,
            config=config,
            active_rules={pattern["patternKey"]: taught["rule"]},
            source_row=39,
            occurrence_id=teach_context["sample"]["sourceFragment"]["id"],
            completed_step_id=teach_context["workflowStepId"],
            taught_source_value=fragment,
        )

        self.assertEqual(
            [entry["fields"]["mpn"] for entry in refreshed["rows"][0]["entries"]],
            ["201Y04L", "212M04T03L", "212M04T04L"],
        )
        self.assertEqual(
            [entry["fields"]["manufacturer"] for entry in refreshed["rows"][0]["entries"]],
            ["NICOMATI", "ATI", "ATI"],
        )
        self.assertEqual(refreshed["summary"]["recognizedPatternCount"], 1)
        self.assertEqual(refreshed["summary"]["unrecognizedPatternCount"], 0)

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_teach_refresh_accepts_an_open_review_without_occurrence_metadata(
        self,
        _saved_rules,
        _saved_interpretations,
    ):
        source_header = "Ref.Fab(Fabricant){Statut}[BI]"
        headers = ["Ref. Article", source_header, "Libelle"]
        roles = {
            "cpn": "Ref. Article",
            "mpn": source_header,
            "manufacturer": source_header,
            "description": "Libelle",
        }
        config = {"alternateLayout": "inside_selected_mpn_columns"}
        source_value = "\n".join([
            "LM2903D@ (/R/RE4/RG4) (TEXAS) {HOM} [1671040]",
            "LM2903D@G (/R2) (ON-SEMI) {HOM} [2258208]",
            "LM2903M@ (/X) (ON-SEMI) {AFAB} [1126658]",
        ])
        inferred = build_bom_field_pattern_groups(
            headers,
            [{
                "Ref. Article": "A1231519",
                source_header: source_value,
                "Libelle": "COMPARAT FAIB_CONSO LM2903 300ns",
                "__sourceRow": 41,
            }],
            roles=roles,
            config=config,
            options={"includeAllRows": True, "reviewContractVersion": 3},
        )
        review = inferred["review"]
        target_occurrence = next(
            occurrence
            for occurrence in review["rows"][0]["occurrences"]
            if occurrence["rawValue"] == "LM2903D@G (/R2) (ON-SEMI) {HOM} [2258208]"
        )
        pattern = next(
            item
            for item in review["patterns"]
            if item["patternKey"] == target_occurrence["patternKey"]
        )
        fragment = target_occurrence["rawValue"]

        def span(text, role, start_at=0):
            start = fragment.index(text, start_at)
            return {"start": start, "end": start + len(text), "role": role}

        taught = build_bom_field_pattern_teach_result(
            headers=headers,
            row={source_header: fragment, "__sourceRow": 41},
            roles=roles,
            config=config,
            group={
                "id": pattern["groupId"],
                "shape": pattern["patternKey"],
                "patternKey": pattern["patternKey"],
            },
            tagged_spans=[
                span("LM2903D", "mpn"),
                span("@", "insertionMarker"),
                span("G", "mpn", fragment.index("@") + 1),
                span("/R2", "alternateList"),
                span("ON-SEMI", "manufacturer"),
            ],
            source_header=source_header,
            alternate_delimiter="/",
            alternate_mode="insert_at_marker",
        )
        original_entries = list(review["rows"][0]["entries"])
        review["rows"][0].pop("occurrences", None)
        refreshed = refresh_bom_field_pattern_review_after_teach(
            review,
            taught,
            group={
                "id": pattern["groupId"],
                "shape": pattern["patternKey"],
                "patternKey": pattern["patternKey"],
            },
            roles=roles,
            config=config,
            active_rules={pattern["patternKey"]: taught["rule"]},
            source_row=41,
            occurrence_id=target_occurrence["occurrenceId"],
            completed_step_id=pattern["workflowStepId"],
            taught_source_value=fragment,
        )
        refreshed_pattern = next(
            item
            for item in refreshed["patterns"]
            if item["patternKey"] == pattern["patternKey"]
        )

        self.assertTrue(refreshed_pattern["recognized"])
        self.assertEqual(refreshed["rows"][0]["entries"], original_entries)

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_confirmed_pattern_completes_when_another_occurrence_has_replay_warnings(
        self,
        _saved_rules,
        _saved_interpretations,
    ):
        headers = ["Combined"]
        roles = {"mpn": "Combined", "manufacturer": "Combined"}
        config = {"alternateLayout": "inside_selected_mpn_columns"}
        rows = [
            {"Combined": "ABC123@PBF (/TR) (INFINEON)", "__sourceRow": 21},
            {"Combined": "XYZ987@PBF (/T) (INFINEON)", "__sourceRow": 22},
        ]
        inferred = build_bom_field_pattern_groups(
            headers,
            rows,
            roles=roles,
            config=config,
            options={"includeAllRows": True, "reviewContractVersion": 3},
        )
        review = inferred["review"]
        pattern = review["patterns"][0]
        teach_context = pattern["teachContext"]
        fragment = teach_context["sample"]["sourceFragment"]["rawValue"]

        def span(text, role, start_at=0):
            start = fragment.index(text, start_at)
            return {"start": start, "end": start + len(text), "role": role}

        taught = build_bom_field_pattern_teach_result(
            headers=headers,
            row={"Combined": fragment, "__sourceRow": 21},
            roles=roles,
            config=config,
            group={
                "id": pattern["groupId"],
                "shape": pattern["patternKey"],
                "patternKey": pattern["patternKey"],
            },
            tagged_spans=[
                span("ABC123", "mpn"),
                span("@", "insertionMarker"),
                span("PBF", "mpn", fragment.index("@") + 1),
                span("/TR", "alternateList"),
                span("INFINEON", "manufacturer"),
            ],
            source_header="Combined",
            alternate_delimiter="/",
            alternate_mode="insert_at_marker",
        )
        original_spans = _interpretation_spans_by_column

        def fail_replay_for_second_row(row, *args, **kwargs):
            if row.get("__sourceRow") == 22:
                return {}
            return original_spans(row, *args, **kwargs)

        with patch(
            "excel_mapper.services.bom_role_inference._interpretation_spans_by_column",
            side_effect=fail_replay_for_second_row,
        ):
            refreshed = refresh_bom_field_pattern_review_after_teach(
                review,
                taught,
                group={
                    "id": pattern["groupId"],
                    "shape": pattern["patternKey"],
                    "patternKey": pattern["patternKey"],
                },
                roles=roles,
                config=config,
                active_rules={pattern["patternKey"]: taught["rule"]},
                source_row=21,
                occurrence_id=teach_context["sample"]["sourceFragment"]["id"],
                completed_step_id=teach_context["workflowStepId"],
                taught_source_value=fragment,
            )

        refreshed_pattern = refreshed["patterns"][0]
        self.assertTrue(refreshed_pattern["recognized"])
        self.assertTrue(refreshed_pattern["recognitionValidation"]["confirmedOccurrenceValid"])
        self.assertFalse(refreshed_pattern["recognitionValidation"]["groupReplayValid"])
        self.assertEqual(
            refreshed_pattern["recognitionValidation"]["reason"],
            "confirmed_with_replay_warnings",
        )

    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_pattern_interpretations",
        return_value={},
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_teach_refresh_falls_back_when_rule_would_blank_another_row(
        self,
        _saved_rules,
        _saved_interpretations,
    ):
        headers = ["Combined"]
        roles = {"mpn": "Combined", "manufacturer": "Combined"}
        config = {"alternateLayout": "inside_selected_mpn_columns"}
        rows = [
            {"Combined": "ABC123 (KEMET) {HOM} [1]", "__sourceRow": 38},
            {"Combined": "201Y04L (NICOMATI) {HOM} [1881177]", "__sourceRow": 39},
        ]
        inferred = build_bom_field_pattern_groups(
            headers,
            rows,
            roles=roles,
            config=config,
            options={"includeAllRows": True, "reviewContractVersion": 3},
        )
        review = inferred["review"]
        pattern = review["patterns"][0]
        teach_context = pattern["teachContext"]
        source_value = teach_context["sample"]["sourceFragment"]["rawValue"]

        def span(text, role):
            start = source_value.index(text)
            return {"start": start, "end": start + len(text), "role": role}

        taught = build_bom_field_pattern_teach_result(
            headers=headers,
            row={"Combined": source_value, "__sourceRow": 38},
            roles=roles,
            config=config,
            group={
                "id": pattern["groupId"],
                "shape": pattern["patternKey"],
                "patternKey": pattern["patternKey"],
            },
            tagged_spans=[
                span("ABC123", "mpn"),
                span("KEMET", "manufacturer"),
            ],
            source_header="Combined",
        )
        original_infer = _infer_field_entries_for_row

        def fail_taught_rule_only(*args, **kwargs):
            active_rule = (kwargs.get("config") or {}).get("_activeFieldPatternRule")
            if active_rule:
                return []
            return original_infer(*args, **kwargs)

        with patch(
            "excel_mapper.services.bom_role_inference._infer_field_entries_for_row",
            side_effect=fail_taught_rule_only,
        ):
            refreshed = refresh_bom_field_pattern_review_after_teach(
                review,
                taught,
                group={
                    "id": pattern["groupId"],
                    "shape": pattern["patternKey"],
                    "patternKey": pattern["patternKey"],
                },
                roles=roles,
                config=config,
                active_rules={pattern["patternKey"]: taught["rule"]},
                source_row=38,
                occurrence_id=teach_context["sample"]["sourceFragment"]["id"],
                completed_step_id=teach_context["workflowStepId"],
                taught_source_value=source_value,
            )

        row_39 = next(row for row in refreshed["rows"] if row["sourceRow"] == 39)
        self.assertEqual(len(row_39["entries"]), 1)
        self.assertEqual(row_39["entries"][0]["fields"]["mpn"], "201Y04L")
        self.assertEqual(row_39["entries"][0]["fields"]["manufacturer"], "NICOMATI")
        self.assertEqual(refreshed["summary"]["recognizedPatternCount"], 1)
        self.assertEqual(refreshed["summary"]["unrecognizedPatternCount"], 0)
        self.assertIn(teach_context["workflowStepId"], refreshed["workflow"]["completedStepIds"])


class StructureScopedPrefixRuleTests(TestCase):
    def setUp(self):
        self.headers = ["Description", "MPN", "Manufacturer", "QTY"]
        self.roles = {
            "description": "Description",
            "mpn": "MPN",
            "manufacturer": "Manufacturer",
            "quantity": "QTY",
        }
        self.config = {"alternateLayout": "already_separate_rows"}
        self.shape = _pattern_shape_for_row(
            {"Description": "Resistor", "MPN": "ABCDEF22-03-2061", "Manufacturer": "MOLEX", "QTY": "1"},
            self.headers,
            self.roles,
            self.headers,
            config=self.config,
        )

    def test_unscoped_legacy_prefix_rule_cannot_cut_an_unrelated_mpn(self):
        ColumnRule.objects.create(
            name="BOM field pattern: stale-prefix-test",
            rule={
                "rule_type": "bom_field_pattern",
                "shape": self.shape,
                "parser_rule": {
                    "shape": self.shape,
                    "fields": {
                        "mpn": {
                            "delimiter": "none",
                            "stripPrefix": "6",
                            "prefixMode": "first_n_chars",
                        },
                    },
                },
            },
        )

        result = normalize_bom_rows(
            self.headers,
            [{
                "Description": "Capacitor",
                "MPN": "08051C474K4T2A",
                "Manufacturer": "KYOCERA AVX",
                "QTY": "1",
                "__sourceRow": 2,
            }],
            roles=self.roles,
            config=self.config,
        )

        self.assertEqual(result["normalizedRows"][0]["mpn"], "08051C474K4T2A")
        suggested_mpn_rules = [
            (group.get("suggestedRule") or {}).get("fields", {}).get("mpn", {})
            for group in result.get("patternGroups") or []
        ]
        self.assertTrue(all(not rule.get("stripPrefix") for rule in suggested_mpn_rules))

    def test_one_to_one_mpn_is_not_split_on_punctuation_without_customer_rule(self):
        result = normalize_bom_rows(
            self.headers,
            [{
                "Description": "CAN transceiver",
                "MPN": "TJA1051T/3,S08",
                "Manufacturer": "NXP",
                "QTY": "1",
                "__sourceRow": 122,
            }],
            roles=self.roles,
            config={"alternateLayout": "inside_selected_mpn_columns"},
        )

        self.assertEqual(len(result["normalizedRows"]), 1)
        self.assertEqual(result["normalizedRows"][0]["mpn"], "TJA1051T/3,S08")
        self.assertEqual(result["normalizedRows"][0]["relation"], "Primary")
        self.assertTrue(all(
            not (group.get("suggestedRule") or {}).get("fields", {}).get("mpn")
            for group in result.get("patternGroups") or []
        ))

    def test_prefix_rule_replays_only_for_the_structure_where_it_was_taught(self):
        structure_scope = _bom_pattern_structure_scope(self.headers, self.roles, self.config)
        save_bom_field_pattern_rule({
            "shape": self.shape,
            "structureScope": structure_scope,
            "structureSignature": structure_scope["signature"],
            "fields": {
                "mpn": {
                    "delimiter": "none",
                    "stripPrefix": "6",
                    "prefixMode": "first_n_chars",
                },
            },
        })

        matching = normalize_bom_rows(
            self.headers,
            [{
                "Description": "Connector",
                "MPN": "ABCDEF22-03-2061",
                "Manufacturer": "MOLEX",
                "QTY": "1",
                "__sourceRow": 2,
            }],
            roles=self.roles,
            config=self.config,
        )
        self.assertEqual(matching["normalizedRows"][0]["mpn"], "22-03-2061")

        other_headers = ["Item code", *self.headers]
        different = normalize_bom_rows(
            other_headers,
            [{
                "Item code": "10",
                "Description": "Connector",
                "MPN": "ABCDEF22-03-2061",
                "Manufacturer": "MOLEX",
                "QTY": "1",
                "__sourceRow": 2,
            }],
            roles=self.roles,
            config=self.config,
        )
        self.assertEqual(different["normalizedRows"][0]["mpn"], "ABCDEF22-03-2061")

    def test_global_semantic_pattern_rebinds_to_a_different_structure_column(self):
        source_value = "ABC123 (KEMET)"
        visual_pattern = derive_visual_pattern_from_tagged_spans(
            source_value=source_value,
            source_header="Combined A",
            tagged_spans=[
                {"start": 0, "end": 6, "role": "mpn"},
                {"start": 7, "end": 14, "role": "manufacturer"},
            ],
        )
        pattern_key = _semantic_pattern_key(
            "Combined A",
            ["mpn", "manufacturer"],
            "<MPN> (<MFR>)",
        )
        save_bom_field_pattern_rule(
            {
                "shape": pattern_key,
                "patternKey": pattern_key,
                "fields": {},
                "visualPattern": visual_pattern,
            },
            library_scope="global",
        )

        result = build_bom_field_pattern_groups(
            ["Combined B"],
            [{"Combined B": "XYZ987 (YAGEO)", "__sourceRow": 2}],
            roles={"mpn": "Combined B", "manufacturer": "Combined B"},
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True},
        )

        pattern = result["patterns"][0]
        self.assertEqual(pattern["patternKey"], pattern_key)
        self.assertEqual(pattern["storedInterpretation"]["matchScope"], "global")
        self.assertEqual(result["reviewSummary"]["recognizedPatternCount"], 1)
        self.assertEqual(result["reviewSummary"]["unrecognizedPatternCount"], 0)
        self.assertEqual(
            pattern["suggestedRule"]["visualPattern"]["sourceHeader"],
            "Combined B",
        )
        self.assertEqual(
            result["reviewRows"][0]["occurrences"][0]["entries"][0]["fields"]["mpn"]["value"],
            "XYZ987",
        )

        structure_scope = _bom_pattern_structure_scope(
            ["Combined B"],
            {"mpn": "Combined B", "manufacturer": "Combined B"},
            {"alternateLayout": "inside_selected_mpn_columns"},
        )
        save_bom_field_pattern_rule({
            "shape": pattern_key,
            "patternKey": pattern_key,
            "structureScope": structure_scope,
            "structureSignature": structure_scope["signature"],
            "fields": {"mpn": {"delimiter": "none"}},
            "visualPattern": {
                **visual_pattern,
                "sourceHeader": "Combined B",
            },
        })
        structure_result = build_bom_field_pattern_groups(
            ["Combined B"],
            [{"Combined B": "XYZ987 (YAGEO)", "__sourceRow": 2}],
            roles={"mpn": "Combined B", "manufacturer": "Combined B"},
            config={"alternateLayout": "inside_selected_mpn_columns"},
            options={"includeAllRows": True},
        )
        self.assertEqual(
            structure_result["patterns"][0]["storedInterpretation"]["matchScope"],
            "structure",
        )

    def test_confirmation_saves_semantic_rule_globally_and_for_its_structure(self):
        structure_scope = _bom_pattern_structure_scope(
            ["Combined A"],
            {"mpn": "Combined A", "manufacturer": "Combined A"},
            {"alternateLayout": "inside_selected_mpn_columns"},
        )
        pattern_key = _semantic_pattern_key(
            "Combined A",
            ["mpn", "manufacturer"],
            "<MPN> (<MFR>)",
        )
        result = learn_confirmed_bom_field_patterns(
            [{
                "confirmed": True,
                "rule": {
                    "shape": pattern_key,
                    "patternKey": pattern_key,
                    "fields": {"mpn": {"delimiter": "none"}},
                },
                "rows": [],
            }],
            structure_scope=structure_scope,
        )

        self.assertEqual(
            {item["scope"] for item in result["saved_pattern_rules"]},
            {"structure", "global"},
        )
        self.assertEqual(
            ColumnRule.objects.filter(rule__pattern_key=pattern_key).count(),
            2,
        )

    def test_apply_api_saves_structure_and_replays_confirmed_split_rule(self):
        row = {
            "Description": "Connector",
            "MPN": "ABC123/XYZ456",
            "Manufacturer": "MOLEX",
            "QTY": "1",
            "__sourceRow": 2,
        }
        config = {"alternateLayout": "inside_selected_mpn_columns"}
        shape = _pattern_shape_for_row(
            row,
            self.headers,
            self.roles,
            self.headers,
            config=config,
        )
        response = self.client.post(
            "/api/bom/field-patterns/apply/",
            {
                "headers": self.headers,
                "rows": [row],
                "roles": self.roles,
                "config": config,
                "groups": [{
                    "id": "pattern-1",
                    "shape": shape,
                    "confirmed": True,
                    "rule": {
                        "shape": shape,
                        "fields": {"mpn": {"delimiter": "/"}},
                    },
                    "rows": [],
                }],
                "persist": True,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual([item["mpn"] for item in payload["normalizedRows"]], ["ABC123", "XYZ456"])
        self.assertIsNotNone(payload["savedStructure"])
        self.assertEqual(BomStructurePattern.objects.count(), 1)

        saved_structure = BomStructurePattern.objects.get()
        saved_rules = saved_structure.config.get("fieldPatternRules") or {}
        self.assertEqual(saved_rules[shape]["fields"]["mpn"]["delimiter"], "/")
        self.assertTrue(saved_rules[shape]["fields"]["mpn"]["customerConfirmed"])
        saved_column_rule = ColumnRule.objects.get(
            rule__structure_fingerprint=saved_structure.signature_hash,
        )
        self.assertTrue(saved_column_rule.rule.get("structure_signature"))
        inferred = self.client.post(
            "/api/bom/roles/infer/",
            {
                "headers": self.headers,
                "rows": [row],
                "source_signature": {},
                "config": {},
            },
            content_type="application/json",
        )
        self.assertEqual(inferred.status_code, 200)
        inferred_payload = inferred.json()
        self.assertEqual(inferred_payload["appliedStructure"]["id"], saved_structure.id)
        restored_rules = inferred_payload["config"].get("fieldPatternRules") or {}
        self.assertEqual(restored_rules[shape]["fields"]["mpn"]["delimiter"], "/")

        replay = normalize_bom_rows(
            self.headers,
            [row],
            roles=inferred_payload["roles"],
            config=inferred_payload["config"],
        )
        self.assertEqual([item["mpn"] for item in replay["normalizedRows"]], ["ABC123", "XYZ456"])


class DirectoryDatabaseLearningTests(TestCase):
    def test_unknown_mpn_batch_does_not_query_pair_table(self):
        MpnDirectoryEntry.objects.create(
            mpn="KNOWN-123",
            normalized_mpn="KNOWN123",
            status=MpnDirectoryEntry.STATUS_VERIFIED,
        )
        lookup = DatabaseMpnLookup()

        with self.assertNumQueries(0):
            self.assertEqual(lookup.get_many(["UNKNOWN999"], normalized=True), {})

    def test_pending_pattern_learning_is_excluded_from_global_lookup(self):
        upsert_directory_pairs(
            [{"mpn": "PENDING-MPN-456", "manufacturer": "Pending Manufacturer"}],
            status="pending",
            source="user_confirmed_pattern",
        )

        self.assertEqual(
            MpnDirectoryEntry.objects.get(normalized_mpn="PENDINGMPN456").status,
            MpnDirectoryEntry.STATUS_PENDING,
        )
        self.assertIsNone(database_mpn_lookup())
        self.assertIsNone(manufacturer_lookup_rows())

    def test_continue_confirmation_promotes_normalized_values_to_database_directory(self):
        response = self.client.post(
            "/api/bom/directory/confirm/",
            {
                "headers": ["MPN", "Manufacturer"],
                "roles": {"mpn": "MPN", "manufacturer": "Manufacturer"},
                "config": {},
                "rows": [{
                    "sourceRow": 7,
                    "relation": "Primary",
                    "mpn": "TEST-MPN-123",
                    "manufacturer": "Test Manufacturer Ltd",
                }],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["confirmed_entries"], 1)

        manufacturer = ManufacturerDirectoryEntry.objects.get(normalized_name="TESTMANUFACTURERLTD")
        mpn = MpnDirectoryEntry.objects.get(normalized_mpn="TESTMPN123")
        pair = MpnManufacturerPair.objects.get(mpn=mpn, manufacturer=manufacturer)
        self.assertEqual(manufacturer.status, ManufacturerDirectoryEntry.STATUS_VERIFIED)
        self.assertTrue(manufacturer.metadata.get("recognition_enabled"))
        self.assertEqual(mpn.status, MpnDirectoryEntry.STATUS_VERIFIED)
        self.assertEqual(pair.status, MpnManufacturerPair.STATUS_VERIFIED)
        lookup_entry = database_mpn_lookup().get("TEST-MPN-123")
        self.assertEqual(lookup_entry["mpn"], "TEST-MPN-123")
        self.assertEqual(lookup_entry["manufacturers"], ["Test Manufacturer Ltd"])
        self.assertTrue(MpnPatternEntry.objects.filter(pattern_type="grouped", signature=mpn.grouped_pattern).exists())
        self.assertTrue(DirectoryLearningEvent.objects.filter(
            normalized_mpn="TESTMPN123",
            normalized_manufacturer="TESTMANUFACTURERLTD",
            status=DirectoryLearningEvent.STATUS_PROMOTED,
        ).exists())
