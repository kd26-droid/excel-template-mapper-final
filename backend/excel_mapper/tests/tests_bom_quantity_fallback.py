from django.test import SimpleTestCase

from excel_mapper.services.bom_role_inference import infer_bom_roles

# Real rows from a customer BOM: part number, maker, then whatever the test adds.
PARTS = (
    ("06035C104JAT2A", "AVX"),
    ("06035C105KAT2A", "AVX"),
    ("08055A222KAT2A", "AVX"),
    ("08055C225KAT2A", "AVX"),
    ("C2012X7R1H475K125AC", "TDK"),
    ("0805YC106KAT2A", "AVX"),
    ("12065C475KAT2A", "AVX"),
    ("0603N103K500CT", "Walsin"),
    ("06035A100KAT2A", "AVX"),
    ("06035A560KAT2A", "AVX"),
    ("2060-453/998-404", "Wago"),
    ("2825890-2", "TE Connectivity"),
)
COUNTS = ("0", "1", "0", "3", "3", "1", "2", "1", "1", "8", "1", "2")


def _infer(extra_columns, headers_first=("Part Number", "Make")):
    headers = list(headers_first) + [name for name, _values in extra_columns]
    rows = []
    for index, (mpn, make) in enumerate(PARTS):
        row = {"Part Number": mpn, "Make": make}
        for name, values in extra_columns:
            row[name] = values[index]
        rows.append(row)
    return infer_bom_roles(headers, rows)["roles"]


class QuantityFromTheOnlyNumericColumnTests(SimpleTestCase):
    def test_an_unfamiliar_header_is_quantity_when_nothing_else_could_be(self):
        roles = _infer([("QPS", COUNTS)])
        self.assertEqual(roles["quantity"], "QPS")

    def test_the_header_plays_no_part(self):
        roles = _infer([("Whatever", COUNTS)])
        self.assertEqual(roles["quantity"], "Whatever")

    def test_two_numeric_columns_are_ambiguous_so_neither_is_chosen(self):
        other = ("2", "2", "1", "1", "4", "1", "1", "3", "2", "1", "1", "5")
        roles = _infer([("QPS", COUNTS), ("Other", other)])
        self.assertEqual(roles["quantity"], "")

    def test_a_line_number_sequence_is_not_a_quantity(self):
        sequence = tuple(str(n) for n in range(1, len(PARTS) + 1))
        roles = _infer([("S.No.", sequence)])
        self.assertEqual(roles["quantity"], "")

    def test_long_identifiers_are_not_a_quantity(self):
        ids = tuple(str(100000000 + n * 7919) for n in range(len(PARTS)))
        roles = _infer([("Code", ids)])
        self.assertEqual(roles["quantity"], "")

    def test_a_level_column_is_not_a_quantity(self):
        levels = ("1", "2", "2", "2", "3", "3", "1", "2", "2", "3", "1", "2")
        roles = _infer([("BOM Level", levels)])
        self.assertNotEqual(roles["quantity"], "BOM Level")

    def test_a_percentage_or_cost_column_is_not_a_quantity(self):
        roles = _infer([("Unit Cost", COUNTS)])
        self.assertEqual(roles["quantity"], "")

    def test_a_text_column_is_not_a_quantity(self):
        words = ("Top", "Bottom", "Top", "Top", "Bottom", "Top", "Top", "Bottom", "Top", "Top", "Top", "Bottom")
        roles = _infer([("Side", words)])
        self.assertEqual(roles["quantity"], "")

    def test_a_column_that_says_quantity_is_still_found_the_usual_way(self):
        roles = _infer([("Qty", COUNTS)])
        self.assertEqual(roles["quantity"], "Qty")
