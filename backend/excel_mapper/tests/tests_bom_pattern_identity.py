import base64
import json
import time
from unittest.mock import Mock, patch

from django.core.cache import cache
from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory

from excel_mapper.services.bom_pattern_identity import (
    BomPatternIdentityError,
    resolve_bom_pattern_actor,
)


class BomPatternIdentityTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.factory = APIRequestFactory()

    def _request(self, token, entity_id="entity-a", enterprise_id="enterprise-a"):
        return self.factory.post(
            "/api/bom/field-patterns/apply/",
            {},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
            HTTP_X_FACTWISE_ENTITY_ID=entity_id,
            HTTP_X_FACTWISE_ENTERPRISE_ID=enterprise_id,
            HTTP_X_FACTWISE_API_URL="https://factwise.example.test",
        )

    @patch("excel_mapper.services.bom_pattern_identity.requests.get")
    def test_dev_actor_is_verified_against_selected_entity(self, get):
        get.return_value = Mock(
            status_code=200,
            json=lambda: [{"entity_id": "entity-a"}],
        )
        actor = resolve_bom_pattern_actor(
            self._request("dev.enterprise-a.user-a"),
            required=True,
        )

        self.assertEqual(actor.user_id, "user-a")
        self.assertEqual(actor.entity_id, "entity-a")
        self.assertEqual(actor.enterprise_id, "enterprise-a")

    @patch("excel_mapper.services.bom_pattern_identity.requests.get")
    def test_verified_actor_is_cached_until_token_expiry(self, get):
        payload = {
            "extension_EnterpriseId": "enterprise-a",
            "extension_EnterpriseUserId": "user-a",
            "exp": int(time.time()) + 600,
        }
        encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
        token = f"header.{encoded}.signature"
        get.return_value = Mock(
            status_code=200,
            json=lambda: [{"entity_id": "entity-a"}],
        )
        request = self._request(token)

        resolve_bom_pattern_actor(request, required=True)
        resolve_bom_pattern_actor(request, required=True)

        self.assertEqual(get.call_count, 1)

    @patch("excel_mapper.services.bom_pattern_identity.requests.get")
    def test_entity_not_available_to_token_is_rejected(self, get):
        get.return_value = Mock(
            status_code=200,
            json=lambda: [{"entity_id": "entity-b"}],
        )
        with self.assertRaises(BomPatternIdentityError):
            resolve_bom_pattern_actor(
                self._request("dev.enterprise-a.user-a"),
                required=True,
            )

    def test_missing_identity_is_allowed_for_read_but_not_apply(self):
        request = self.factory.post("/api/bom/field-patterns/infer/", {}, format="json")
        self.assertIsNone(resolve_bom_pattern_actor(request, required=False))
        with self.assertRaises(BomPatternIdentityError):
            resolve_bom_pattern_actor(request, required=True)
