from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from excel_mapper.models import (
    BomEntityFieldPattern,
    BomEntityPatternStructure,
    BomFieldPattern,
    BomStructurePattern,
    ColumnRule,
)
from excel_mapper.services.bom_structure_patterns import build_structure_profile
from excel_mapper.services.bom_role_inference import _bom_pattern_structure_scope
from excel_mapper.views import _issue_bom_pattern_confirmation


class BomPatternApiCutoverTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    @patch("excel_mapper.views.refresh_bom_field_pattern_review_after_teach")
    @patch("excel_mapper.views.build_bom_field_pattern_teach_result")
    def test_teach_returns_confirmation_without_any_database_writes(
        self,
        build_teach_result,
        refresh_review,
    ):
        rule = {
            "patternKey": "semantic-a",
            "shape": "semantic-a",
            "fields": {"mpn": {"delimiter": "/"}},
        }
        build_teach_result.return_value = {
            "rule": rule,
            "entries": [{"relation": "Primary", "fields": {"mpn": "ABC"}}],
        }
        refresh_review.return_value = {"contractVersion": 3, "patterns": []}
        before = (
            ColumnRule.objects.count(),
            BomFieldPattern.objects.count(),
            BomEntityFieldPattern.objects.count(),
            BomEntityPatternStructure.objects.count(),
        )

        response = self.client.post(
            "/api/bom/field-patterns/teach/",
            {
                "headers": ["MPN"],
                "row": {"MPN": "ABC"},
                "roles": {"mpn": "MPN"},
                "group": {"patternKey": "semantic-a", "shape": "semantic-a"},
                "sourceHeader": "MPN",
                "confirmInterpretation": True,
                "persist": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.data["confirmation"])
        self.assertIsNone(response.data["saved_rule"])
        self.assertEqual(before, (
            ColumnRule.objects.count(),
            BomFieldPattern.objects.count(),
            BomEntityFieldPattern.objects.count(),
            BomEntityPatternStructure.objects.count(),
        ))

    def test_column_rules_api_hides_legacy_bom_pattern_rows(self):
        ColumnRule.objects.create(
            name="Ordinary rule",
            rule={"value_mode": "static", "value": "EA"},
        )
        hidden = ColumnRule.objects.create(
            name="BOM field pattern: old",
            rule={"rule_type": "bom_field_pattern", "parser_rule": {"fields": {}}},
        )

        response = self.client.get("/api/column-rules/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total"], 1)
        self.assertEqual(response.data["rules"][0]["name"], "Ordinary rule")
        delete_response = self.client.delete(f"/api/column-rules/{hidden.id}/")
        self.assertEqual(delete_response.status_code, 404)
        self.assertTrue(ColumnRule.objects.filter(id=hidden.id).exists())

    def test_legacy_learn_endpoint_is_write_free(self):
        response = self.client.post(
            "/api/bom/field-patterns/learn/",
            {"groups": [{"rule": {"patternKey": "semantic-a"}}]},
            format="json",
        )

        self.assertEqual(response.status_code, 410)
        self.assertEqual(BomFieldPattern.objects.count(), 0)
        self.assertEqual(ColumnRule.objects.count(), 0)

    @patch("excel_mapper.views.learn_confirmed_bom_field_patterns")
    @patch("excel_mapper.views.normalize_bom_rows")
    @patch("excel_mapper.views.resolve_bom_pattern_actor")
    @patch("excel_mapper.views._normaliser_input")
    def test_apply_writes_new_pattern_tables_and_not_column_rules(
        self,
        normaliser_input,
        resolve_actor,
        normalize_rows,
        learn_directory,
    ):
        headers = ["MPN"]
        rows = [{"MPN": "ABC"}]
        roles = {"mpn": "MPN"}
        config = {}
        normaliser_input.return_value = (headers, rows, "session-a")
        resolve_actor.return_value = SimpleNamespace(
            user_id="user-a",
            entity_id="entity-a",
        )
        normalize_rows.return_value = {"normalizedRows": []}
        learn_directory.return_value = {"success": True, "saved_pattern_rules": []}
        profile = build_structure_profile(headers, rows, roles, config, {})
        structure = BomStructurePattern.objects.create(
            name="Existing structure",
            signature_hash=profile["fingerprint"],
        )
        rule = {
            "patternKey": "semantic-a",
            "shape": "semantic-a",
            "fields": {"mpn": {"delimiter": "/"}},
        }
        structure_signature = _bom_pattern_structure_scope(
            headers, roles, config
        )["signature"]
        confirmation = _issue_bom_pattern_confirmation(
            rule=rule,
            pattern_key="semantic-a",
            shape="semantic-a",
            entries=[],
            source_row=1,
            occurrence_id="test-occurrence",
            structure_signature=structure_signature,
        )
        legacy_count = ColumnRule.objects.count()

        with patch(
            "excel_mapper.views.learn_bom_structure",
            return_value=(structure, False),
        ):
            response = self.client.post(
                "/api/bom/field-patterns/apply/",
                {
                    "headers": headers,
                    "rows": rows,
                    "roles": roles,
                    "config": config,
                    "confirmation_tokens": [confirmation["token"]],
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(ColumnRule.objects.count(), legacy_count)
        self.assertEqual(BomFieldPattern.objects.count(), 1)
        self.assertEqual(BomEntityFieldPattern.objects.count(), 1)
        self.assertEqual(BomEntityPatternStructure.objects.count(), 1)
