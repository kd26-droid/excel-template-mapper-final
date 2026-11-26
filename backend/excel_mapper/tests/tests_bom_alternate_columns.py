from django.test import SimpleTestCase

from excel_mapper.services.bom_alternate_columns import infer_alternate_column_groups
from excel_mapper.services.bom_role_inference import infer_bom_roles


def _profile(index, header, mpn=0.0, manufacturer=0.0, sample_size=10):
    return {
        "index": index,
        "header": header,
        "sampleSize": sample_size,
        "scores": {"mpn": mpn, "manufacturer": manufacturer},
    }


ROLES = {"mpn": "Part Number", "manufacturer": "Approved Make", "cpn": "CPN"}


class InferAlternateColumnGroupsTests(SimpleTestCase):
    def test_pairs_each_part_number_column_with_the_maker_beside_it(self):
        profiles = [
            _profile(0, "CPN"),
            _profile(1, "Part Number", mpn=0.8),
            _profile(2, "Approved Make", manufacturer=0.9),
            _profile(3, "Alt 1", mpn=0.75),
            _profile(4, "Column 5", mpn=0.2, manufacturer=0.8),
            _profile(5, "Alt 2", mpn=0.75),
            _profile(6, "Column 7", mpn=0.5, manufacturer=0.85),
        ]
        self.assertEqual(
            infer_alternate_column_groups(profiles, ROLES),
            {
                "layout": "separate_columns",
                "groups": [
                    {"slot": "1", "mpn": "Alt 1", "mfr": "Column 5"},
                    {"slot": "2", "mpn": "Alt 2", "mfr": "Column 7"},
                ],
            },
        )

    def test_headers_play_no_part_in_the_decision(self):
        profiles = [
            _profile(1, "Part Number", mpn=0.8),
            _profile(2, "Approved Make", manufacturer=0.9),
            _profile(3, "Anything at all", mpn=0.7),
            _profile(4, "Whatever", manufacturer=0.7),
        ]
        groups = infer_alternate_column_groups(profiles, ROLES)["groups"]
        self.assertEqual(groups, [{"slot": "1", "mpn": "Anything at all", "mfr": "Whatever"}])

    def test_a_part_number_column_without_a_maker_beside_it_is_still_a_group(self):
        profiles = [
            _profile(1, "Part Number", mpn=0.8),
            _profile(2, "Approved Make", manufacturer=0.9),
            _profile(3, "Alt 1", mpn=0.7),
            _profile(4, "Notes"),
        ]
        groups = infer_alternate_column_groups(profiles, ROLES)["groups"]
        self.assertEqual(groups, [{"slot": "1", "mpn": "Alt 1", "mfr": ""}])

    def test_nothing_is_reported_when_no_alternate_columns_exist(self):
        profiles = [
            _profile(1, "Part Number", mpn=0.8),
            _profile(2, "Approved Make", manufacturer=0.9),
            _profile(3, "Quantity"),
        ]
        self.assertEqual(infer_alternate_column_groups(profiles, ROLES), {})

    def test_columns_before_the_primary_part_number_are_never_alternates(self):
        profiles = [
            _profile(0, "Family", mpn=0.75),
            _profile(1, "Part Number", mpn=0.8),
            _profile(2, "Approved Make", manufacturer=0.9),
        ]
        self.assertEqual(infer_alternate_column_groups(profiles, ROLES), {})

    def test_columns_already_assigned_to_a_field_are_never_alternates(self):
        profiles = [
            _profile(1, "Part Number", mpn=0.8),
            _profile(2, "Approved Make", manufacturer=0.9),
            _profile(3, "CPN", mpn=0.7),
        ]
        self.assertEqual(infer_alternate_column_groups(profiles, ROLES), {})

    def test_a_half_recognised_column_is_not_called_either_kind(self):
        profiles = [
            _profile(1, "Part Number", mpn=0.8),
            _profile(2, "Approved Make", manufacturer=0.9),
            _profile(3, "Mixed", mpn=0.65, manufacturer=0.62),
        ]
        self.assertEqual(infer_alternate_column_groups(profiles, ROLES), {})

    def test_no_primary_part_number_means_no_alternates(self):
        profiles = [_profile(1, "Alt 1", mpn=0.8)]
        self.assertEqual(infer_alternate_column_groups(profiles, {}), {})


class InferBomRolesAlternateColumnsTests(SimpleTestCase):
    HEADERS = [
        "Item", "Part Number", "Approved Make",
        "Alternate Part Number & Makes 1", "Column 5",
        "Alternate Part Number & Makes 2", "Column 7",
    ]

    # Real rows from a customer BOM: capacitors with two alternates each.
    SAMPLE = (
        ("06035C104JAT2A", "AVX", "0603B104K500CT", "Walsin", "CC0603KRX7R9BB104", "Yageo"),
        ("06035C105KAT2A", "AVX", "0603B105K500CT", "Walsin", "CC0603KRX7R9BB105", "Yageo"),
        ("08055A222KAT2A / C0805C222K5RACTU", "AVX / Kemet", "0805B222K500CT", "Walsin", "CC0805KRX7R9BB222", "Yageo"),
        ("08055C225KAT2A", "AVX", "0805B225K500CT", "Walsin", "C0805C225K5RACTU", "kemet"),
        ("C2012X7R1H475K125AC", "TDK", "GRM21BZ71H475KE15L", "murata", "CS2012X7R475K500NRE", "Samwha"),
        ("0805YC106KAT2A", "AVX", "CC0805KKX7R7BB106", "Yageo", "CS2012X7R106K160NRE", "Samwha"),
        ("12065C475KAT2A", "AVX", "1206B475K500CT", "Walsin", "CL31B475KBHNFNE", "Samsung"),
        ("0603N103K500CT", "Walsin", "CC0603JRNPO9BN103", "Yageo", "GRM1885C1H103JA01J", "Murata"),
        ("06035A100KAT2A", "AVX", "0603N100K500CT", "Walsin", "CC0603KRNPO9BN100", "Yageo"),
        ("06035A560KAT2A", "AVX", "0603N560K500CT", "Walsin", "CC0603KRNPO9BN560", "Yageo"),
    )

    def _rows(self):
        return [
            dict(zip(self.HEADERS[1:], values), Item=str(index + 1))
            for index, values in enumerate(self.SAMPLE)
        ]

    def test_the_infer_result_carries_the_alternate_column_groups(self):
        result = infer_bom_roles(self.HEADERS, self._rows())
        self.assertEqual(result["roles"]["mpn"], "Part Number")
        self.assertEqual(result["roles"]["manufacturer"], "Approved Make")
        self.assertEqual(result["alternateColumns"]["layout"], "separate_columns")
        self.assertEqual(
            result["alternateColumns"]["groups"],
            [
                {"slot": "1", "mpn": "Alternate Part Number & Makes 1", "mfr": "Column 5"},
                {"slot": "2", "mpn": "Alternate Part Number & Makes 2", "mfr": "Column 7"},
            ],
        )

    def test_approved_make_is_the_manufacturer_not_an_approval_flag(self):
        headers = ["Part Number", "Approved Make"]
        rows = [
            {"Part Number": mpn, "Approved Make": make}
            for mpn, make, *_ in self.SAMPLE
        ]
        result = infer_bom_roles(headers, rows)
        self.assertEqual(result["roles"]["manufacturer"], "Approved Make")
        self.assertEqual(result["alternateColumns"], {})

    def test_a_real_approval_status_column_is_still_not_a_manufacturer(self):
        headers = ["Part Number", "Approved Status"]
        rows = [
            {"Part Number": mpn, "Approved Status": "Yes" if i % 2 else "No"}
            for i, (mpn, *_) in enumerate(self.SAMPLE)
        ]
        result = infer_bom_roles(headers, rows)
        self.assertNotEqual(result["roles"]["manufacturer"], "Approved Status")


class FinalizeAlternateConfigTests(SimpleTestCase):
    """What the infer API hands the page as config, and who gets the last word."""

    DETECTED = {
        "layout": "separate_columns",
        "groups": [{"slot": "1", "mpn": "Alt 1", "mfr": "Alt 1 Make"}],
    }

    def _finalize(self, request_config=None, learned=None, detected=DETECTED):
        from excel_mapper.views import _finalize_bom_inference_with_structure

        result = {"roles": {"mpn": "Part Number"}, "alternateColumns": detected}
        _roles, config, _matched, _sources = _finalize_bom_inference_with_structure(
            result, learned or [], request_config=request_config or {},
        )
        return config

    def test_detected_groups_become_the_returned_config(self):
        config = self._finalize()
        self.assertEqual(config["alternateLayout"], "separate_columns")
        self.assertEqual(config["structure"], "separate_cells")
        self.assertEqual(config["alternateColumnGroups"], self.DETECTED["groups"])

    def test_nothing_detected_leaves_the_config_alone(self):
        self.assertNotIn("alternateLayout", self._finalize(detected={}))

    def test_a_layout_the_caller_already_chose_is_never_replaced(self):
        config = self._finalize(request_config={"alternateLayout": "already_separate_rows"})
        self.assertEqual(config["alternateLayout"], "already_separate_rows")
        self.assertNotIn("alternateColumnGroups", config)

    def test_a_structure_the_user_confirmed_is_never_replaced(self):
        learned = [{
            "score": 0.95,
            "workflow": {"userTouched": True},
            "resolved_roles": {},
            "resolved_config": {"alternateLayout": "inside_selected_mpn_columns"},
        }]
        config = self._finalize(learned=learned)
        self.assertEqual(config["alternateLayout"], "inside_selected_mpn_columns")

    def test_a_layout_only_learned_automatically_does_not_block_detection(self):
        learned = [{
            "score": 0.95,
            "resolved_roles": {},
            "resolved_config": {"alternateLayout": "already_separate_rows"},
        }]
        self.assertEqual(self._finalize(learned=learned)["alternateLayout"], "separate_columns")

    def test_alternates_copy_every_primary_field_except_the_manufacturer(self):
        fields = self._finalize()["alternateInheritFields"]
        self.assertEqual(
            fields,
            ["cpn", "description", "quantity", "uom", "level", "parent", "notes", "internalNotes"],
        )
        self.assertNotIn("manufacturer", fields)
        self.assertNotIn("mpn", fields)

    def test_nothing_is_copied_when_there_are_no_alternates(self):
        config = self._finalize(request_config={"alternateLayout": "already_separate_rows"})
        self.assertNotIn("alternateInheritFields", config)

    def test_what_the_caller_chose_to_copy_is_kept_even_when_empty(self):
        for chosen in ([], ["quantity"]):
            config = self._finalize(request_config={"alternateInheritFields": chosen})
            self.assertEqual(config["alternateInheritFields"], chosen)
