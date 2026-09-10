import json
from unittest.mock import patch

from django.test import SimpleTestCase

from excel_mapper.services.bom_role_inference import (
    build_bom_field_pattern_groups,
    build_bom_field_pattern_teach_result,
    derive_visual_pattern_from_tagged_spans,
    _infer_field_entries_for_row,
    _interpretation_spans_by_column,
    _mpn_source_fragment_pattern,
    _pattern_shape_for_row,
    _same_cell_parenthesized_patterns_from_entries,
    _semantic_identity_fragments,
    _build_split_field_review_step,
    _split_field_preview,
    _visual_pattern_identity_pairs,
    _visual_pattern_interpretation_spans,
    derive_bom_field_pattern_rule_from_correction,
    normalize_bom_rows,
)


class VisualPatternMpnExtractionTests(SimpleTestCase):
    def setUp(self):
        self.value = "SOLDER MASK ALKALINE DEV. FINEDEL DSR-330C10-11M (TAMURA)"
        self.visual_pattern = {
            "type": "bracket_manufacturer",
            "sourceHeader": "Combined part",
        }

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
    def test_case_1b_without_patterns_goes_directly_to_normalization(
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
        self.assertEqual([step["type"] for step in workflow["steps"]], ["normalize"])
        self.assertEqual(workflow["nextStep"]["type"], "normalize")
        self.assertTrue(workflow["directNormalize"])

    @patch(
        "excel_mapper.services.bom_role_inference._build_semantic_review_patterns",
        return_value=[],
    )
    @patch(
        "excel_mapper.services.bom_role_inference.load_saved_bom_field_pattern_rules",
        return_value={},
    )
    def test_branch_b_without_patterns_goes_directly_to_normalization_for_one_to_one_fields(
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
        self.assertEqual(workflow["nextStep"]["type"], "normalize")
        self.assertEqual(workflow["nextStep"]["case"], "direct")
        self.assertTrue(workflow["directNormalize"])

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
            {"sourceRow", "sourceColumn", "start", "end", "rawValue", "patternKey"}
            <= set(occurrence)
            for pattern in result["patterns"]
            for occurrence in pattern["occurrences"]
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
        self.assertIn("storedInterpretation", step)
        self.assertEqual(len(result["patterns"][0]["interpretations"]), 2)
        self.assertNotIn("entries", result["patterns"][0]["occurrences"][0])

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
        self.assertEqual(len(pattern["occurrences"]), 220)
        self.assertEqual(len(pattern["interpretations"]), 220)
        self.assertTrue(all(set(row_entry) == {"occurrenceId"} for row_entry in pattern["rowEntries"].values()))
        self.assertTrue(all("occurrences" not in row for sample in pattern["samples"] for row in sample["patternRows"]))
        self.assertLess(len(json.dumps(result)), 5_000_000)


class SemanticIdentityFragmentTests(SimpleTestCase):
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
        fragment = pattern["occurrences"][0]["rawValue"]

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
