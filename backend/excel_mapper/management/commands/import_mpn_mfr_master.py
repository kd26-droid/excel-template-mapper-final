from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from excel_mapper.services.mpn_mfr_master_importer import import_mpn_mfr_master


class Command(BaseCommand):
    help = "Import raw MPN/MFR rows into backend manufacturer and MPN recognition assets."

    def add_arguments(self, parser):
        parser.add_argument("input_file", help="Path to MPN-MFR workbook")
        parser.add_argument("--sheet", default="MPN-MFR", help="Worksheet containing MPN/MFR rows")
        parser.add_argument(
            "--output-dir",
            default=None,
            help="Output directory. Defaults to backend/excel_mapper/data",
        )

    def handle(self, *args, **options):
        input_path = Path(options["input_file"]).expanduser()
        if not input_path.exists():
            raise CommandError(f"Input file not found: {input_path}")

        output_dir = Path(options["output_dir"]).expanduser() if options["output_dir"] else (
            Path(__file__).resolve().parents[2] / "data"
        )

        result = import_mpn_mfr_master(input_path, output_dir, sheet_name=options["sheet"])

        self.stdout.write(self.style.SUCCESS(
            f"Imported {result['raw_rows']} rows, {result['unique_mpns']} unique MPNs, "
            f"{result['unique_manufacturers']} manufacturers."
        ))
        self.stdout.write(f"Skipped generic/spec designators: {result['skipped_generic_specs']}")
        self.stdout.write(f"Removed existing generic/spec lookup entries: {result['removed_existing_generic_specs']}")
        self.stdout.write(f"Added manufacturers: {result['added_manufacturers']}")
        self.stdout.write(f"New exact MPNs in lookup: {result['new_exact_mpns']}")
        self.stdout.write(f"New MPN/MFR pairs in lookup: {result['new_pairs']}")
        self.stdout.write(result["lookup_path"])
