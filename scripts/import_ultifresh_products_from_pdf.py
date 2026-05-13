#!/usr/bin/env python3
"""Parse Ultifresh's agent price-list PDF and optionally import it to Supabase.

Default mode is dry-run. Pass --commit to write only:
  - ultifresh_products
  - ultifresh_product_snapshots
  - ultifresh_product_import_runs
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

try:
    import fitz
except ImportError as error:  # pragma: no cover - environment guard
    raise SystemExit("PyMuPDF is required. Install it with: python3 -m pip install pymupdf") from error


DEFAULT_INPUT = "/Users/darrenchoong/Downloads/Ultifresh SG -- Normal Agent Price list - 2025.pdf"
DEFAULT_ENV = "backend/.env"
VENDOR = "ULTIFRESH"
TABLE_PRODUCTS = "ultifresh_products"
TABLE_SNAPSHOTS = "ultifresh_product_snapshots"
TABLE_RUNS = "ultifresh_product_import_runs"
STOCK_STATUS = "assumed_in_stock"
STOCK_ASSUMPTION = "Ultifresh stock assumed always available; PDF does not provide stock quantities."


@dataclass
class UltifreshProduct:
    vendor: str
    design_group: str | None
    design_no: int
    product_name: str
    series_code: str
    item_code: str
    catalog_page_range: str | None
    item_unit_price: str | None
    normal_agent_price: str | None
    ma_promo_price: str | None
    currency: str
    stock_status: str
    stock_quantity: int | None
    stock_assumption: str
    source_price_list_date: str | None
    source_file: str
    source_pdf_page: int
    source_row_number: int
    source_row_key: str
    size_surcharge_note: str | None
    raw_product: dict[str, Any]


def usage() -> str:
    return f"""Import Ultifresh PDF products into Supabase.

Defaults to dry-run. Pass --commit to write to Supabase.

Examples:
  python3 scripts/import_ultifresh_products_from_pdf.py
  python3 scripts/import_ultifresh_products_from_pdf.py --commit

Options:
  --input PATH             Default: {DEFAULT_INPUT}
  --env PATH               Env file with Supabase credentials. Default: {DEFAULT_ENV}
  --limit-rows N           Parse/import only the first N product rows.
  --commit                 Insert snapshots and upsert latest products to Supabase.
  --allow-non-service-key  Allow --commit without a service_role JWT.
  --json                   Print summary as JSON.
"""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import Ultifresh PDF products into isolated Supabase tables.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=usage(),
    )
    parser.add_argument("--input", default=DEFAULT_INPUT)
    parser.add_argument("--env", dest="env_path", default=DEFAULT_ENV)
    parser.add_argument("--limit-rows", type=int)
    parser.add_argument("--commit", action="store_true")
    parser.add_argument("--allow-non-service-key", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if args.limit_rows is not None and args.limit_rows <= 0:
        parser.error("--limit-rows must be a positive integer")
    return args


def normalize_space(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\u00a0", " ")
    return re.sub(r"\s+", " ", text).strip()


def item_code_from_series(series_code: str) -> str:
    item_code = normalize_space(series_code).upper()
    item_code = re.sub(r"\s+", "-", item_code)
    item_code = re.sub(r"[^A-Z0-9-]+", "", item_code)
    item_code = re.sub(r"-+", "-", item_code).strip("-")
    return item_code or "UNKNOWN"


def parse_decimal(value: Any) -> str | None:
    text = normalize_space(value).replace(",", "")
    if not text or text == "-":
        return None
    if not re.fullmatch(r"\d+(?:\.\d+)?", text):
        return None
    try:
        return str(Decimal(text).quantize(Decimal("0.01")))
    except InvalidOperation:
        return None


def parse_price_list_date(full_text: str) -> str | None:
    match = re.search(r"Ultifresh Price List \((\d{1,2} [A-Za-z]{3} \d{4})\)", full_text)
    if not match:
        return None
    try:
        return datetime.strptime(match.group(1), "%d %b %Y").date().isoformat()
    except ValueError:
        return None


def parse_size_surcharge_note(full_text: str) -> str | None:
    text = normalize_space(full_text)
    match = re.search(r"FOR SIZE 4XL to 7XL, WILL ADD ON \$2 or \$4 FOR AVAILABLE MODELS", text, flags=re.IGNORECASE)
    if not match:
        return None
    return match.group(0)


def source_key(source_date: str | None, design_no: int, item_code: str) -> str:
    date_part = source_date or "unknown-date"
    return f"ultifresh:{date_part}:design-no:{design_no}:item:{item_code}"


def parse_pdf(pdf_path: Path, limit_rows: int | None = None) -> tuple[list[UltifreshProduct], dict[str, Any]]:
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    doc = fitz.open(pdf_path)
    try:
        full_text = "\n".join(page.get_text("text") for page in doc)
        source_date = parse_price_list_date(full_text)
        size_surcharge_note = parse_size_surcharge_note(full_text)
        products: list[UltifreshProduct] = []
        current_design_group: str | None = None
        scanned_table_rows = 0
        skipped_table_rows = 0

        for page_number, page in enumerate(doc, start=1):
            tables = page.find_tables().tables
            for table in tables:
                for table_row_number, row in enumerate(table.extract(), start=1):
                    cells = [normalize_space(cell) for cell in row]
                    scanned_table_rows += 1

                    if len(cells) < 7 or not cells[1].isdigit():
                        skipped_table_rows += 1
                        continue

                    if cells[0]:
                        current_design_group = cells[0]

                    design_no = int(cells[1])
                    product_name = cells[2]
                    series_code = normalize_space(cells[3])
                    item_code = item_code_from_series(series_code)
                    normal_agent_price = parse_decimal(cells[5])
                    ma_promo_price = parse_decimal(cells[6])

                    if not product_name or not series_code or normal_agent_price is None:
                        skipped_table_rows += 1
                        continue

                    source_row_number = len(products) + 1
                    product = UltifreshProduct(
                        vendor=VENDOR,
                        design_group=current_design_group,
                        design_no=design_no,
                        product_name=product_name,
                        series_code=series_code,
                        item_code=item_code,
                        catalog_page_range=normalize_space(cells[4]) or None,
                        item_unit_price=normal_agent_price,
                        normal_agent_price=normal_agent_price,
                        ma_promo_price=ma_promo_price,
                        currency="SGD",
                        stock_status=STOCK_STATUS,
                        stock_quantity=None,
                        stock_assumption=STOCK_ASSUMPTION,
                        source_price_list_date=source_date,
                        source_file=pdf_path.name,
                        source_pdf_page=page_number,
                        source_row_number=source_row_number,
                        source_row_key=source_key(source_date, design_no, item_code),
                        size_surcharge_note=size_surcharge_note,
                        raw_product={
                            "source": "ultifresh_pdf",
                            "source_file": pdf_path.name,
                            "source_pdf_page": page_number,
                            "source_table_row_number": table_row_number,
                            "raw_row": {
                                "design": cells[0],
                                "no": cells[1],
                                "products": cells[2],
                                "series": cells[3],
                                "page": cells[4],
                                "normal_agent": cells[5],
                                "ma_promo_price": cells[6],
                            },
                        },
                    )
                    products.append(product)

                    if limit_rows is not None and len(products) >= limit_rows:
                        metadata = {
                            "scanned_table_rows": scanned_table_rows,
                            "skipped_table_rows": skipped_table_rows,
                            "source_price_list_date": source_date,
                            "size_surcharge_note": size_surcharge_note,
                            "limited": True,
                        }
                        validate_unique_item_codes(products)
                        return products, metadata

        metadata = {
            "scanned_table_rows": scanned_table_rows,
            "skipped_table_rows": skipped_table_rows,
            "source_price_list_date": source_date,
            "size_surcharge_note": size_surcharge_note,
            "limited": False,
        }
        validate_unique_item_codes(products)
        return products, metadata
    finally:
        doc.close()


def validate_unique_item_codes(products: list[UltifreshProduct]) -> None:
    counts: dict[str, int] = {}
    for product in products:
        key = f"{product.vendor}\x1f{product.item_code}"
        counts[key] = counts.get(key, 0) + 1
    duplicates = [key for key, count in counts.items() if count > 1]
    if duplicates:
        examples = []
        for key in duplicates[:10]:
            _vendor, item_code = key.split("\x1f", 1)
            examples.append(f"{item_code} ({counts[key]} rows)")
        raise RuntimeError(f"Duplicate Ultifresh item codes found: {'; '.join(examples)}")


def load_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def jwt_role(token: str | None) -> str | None:
    if not token:
        return None
    parts = token.split(".")
    if len(parts) < 2:
        return None
    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload.encode("utf-8")))
        return data.get("role")
    except Exception:
        return None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def chunked(values: list[Any], size: int) -> list[list[Any]]:
    return [values[index:index + size] for index in range(0, len(values), size)]


def postgrest_in_filter(values: list[str]) -> str:
    return urllib.parse.quote("(" + ",".join(json.dumps(value) for value in values) + ")", safe="")


def request_json(method: str, url: str, key: str, payload: Any | None = None, prefer: str = "return=representation") -> Any:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": prefer,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            text = response.read().decode("utf-8")
            return json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        message = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase {method} {url} failed: HTTP {error.code}: {message[:800]}") from error


class SupabaseImporter:
    def __init__(self, supabase_url: str, key: str) -> None:
        self.supabase_url = supabase_url.rstrip("/")
        self.key = key

    def create_run(self, source_file: str, products: list[UltifreshProduct], run_type: str, metadata: dict[str, Any]) -> str:
        rows = request_json(
            "POST",
            f"{self.supabase_url}/rest/v1/{TABLE_RUNS}",
            self.key,
            {
                "vendor": VENDOR,
                "source_type": "pdf",
                "source_file": source_file,
                "run_type": run_type,
                "status": "started",
                "row_count": metadata.get("scanned_table_rows", 0),
                "product_count": len(products),
                "skipped_row_count": metadata.get("skipped_table_rows", 0),
                "metadata": metadata,
            },
        )
        return rows[0]["id"]

    def complete_run(self, run_id: str, payload: dict[str, Any]) -> None:
        request_json(
            "PATCH",
            f"{self.supabase_url}/rest/v1/{TABLE_RUNS}?id=eq.{run_id}",
            self.key,
            payload,
            prefer="return=minimal",
        )

    def insert_snapshots(self, run_id: str, products: list[UltifreshProduct], imported_at: str) -> None:
        rows = [
            {
                **asdict(product),
                "import_run_id": run_id,
                "imported_at": imported_at,
            }
            for product in products
        ]
        for batch in chunked(rows, 300):
            request_json(
                "POST",
                f"{self.supabase_url}/rest/v1/{TABLE_SNAPSHOTS}",
                self.key,
                batch,
                prefer="return=minimal",
            )

    def upsert_products(self, products: list[UltifreshProduct], imported_at: str) -> None:
        rows = [
            {
                **asdict(product),
                "is_active": True,
                "last_seen_at": imported_at,
                "last_imported_at": imported_at,
                "missing_since_at": None,
                "updated_at": imported_at,
            }
            for product in products
        ]
        columns = ",".join(
            [
                "vendor",
                "design_group",
                "design_no",
                "product_name",
                "series_code",
                "item_code",
                "catalog_page_range",
                "item_unit_price",
                "normal_agent_price",
                "ma_promo_price",
                "currency",
                "stock_status",
                "stock_quantity",
                "stock_assumption",
                "source_price_list_date",
                "source_file",
                "source_pdf_page",
                "source_row_number",
                "source_row_key",
                "size_surcharge_note",
                "raw_product",
                "is_active",
                "last_seen_at",
                "last_imported_at",
                "missing_since_at",
                "updated_at",
            ]
        )
        for batch in chunked(rows, 300):
            request_json(
                "POST",
                f"{self.supabase_url}/rest/v1/{TABLE_PRODUCTS}?on_conflict=vendor,item_code&columns={columns}",
                self.key,
                batch,
                prefer="resolution=merge-duplicates,return=minimal",
            )

    def mark_missing_inactive(self, seen_item_codes: set[str], imported_at: str) -> int:
        rows = request_json(
            "GET",
            f"{self.supabase_url}/rest/v1/{TABLE_PRODUCTS}?select=id,item_code&vendor=eq.{urllib.parse.quote(VENDOR)}&is_active=eq.true&limit=10000",
            self.key,
        )
        missing_ids = [row["id"] for row in rows if row["item_code"] not in seen_item_codes]
        for batch in chunked(missing_ids, 300):
            request_json(
                "PATCH",
                f"{self.supabase_url}/rest/v1/{TABLE_PRODUCTS}?id=in.{postgrest_in_filter(batch)}",
                self.key,
                {
                    "is_active": False,
                    "missing_since_at": imported_at,
                    "last_imported_at": imported_at,
                    "updated_at": imported_at,
                },
                prefer="return=minimal",
            )
        return len(missing_ids)


def build_summary(products: list[UltifreshProduct], metadata: dict[str, Any], committed: bool, run_id: str | None = None, inactive_marked_count: int = 0) -> dict[str, Any]:
    design_groups = sorted({product.design_group for product in products if product.design_group})
    promo_count = sum(1 for product in products if product.ma_promo_price is not None)
    return {
        "committed": committed,
        "source_file": products[0].source_file if products else None,
        "parsed_product_rows": len(products),
        "design_group_count": len(design_groups),
        "design_groups": design_groups,
        "promo_price_count": promo_count,
        "source_price_list_date": metadata.get("source_price_list_date"),
        "scanned_table_rows": metadata.get("scanned_table_rows"),
        "skipped_table_rows": metadata.get("skipped_table_rows"),
        "import_run_id": run_id,
        "inactive_marked_count": inactive_marked_count,
        "sample_rows": [
            {
                "design_group": product.design_group,
                "design_no": product.design_no,
                "product_name": product.product_name,
                "series_code": product.series_code,
                "item_code": product.item_code,
                "item_unit_price": product.item_unit_price,
                "ma_promo_price": product.ma_promo_price,
                "stock_status": product.stock_status,
                "stock_quantity": product.stock_quantity,
            }
            for product in products[:10]
        ],
    }


def print_summary(summary: dict[str, Any], as_json: bool) -> None:
    if as_json:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return
    print("")
    print("Ultifresh product import summary")
    print(f"  mode: {'commit' if summary['committed'] else 'dry-run'}")
    print(f"  source file: {summary['source_file']}")
    print(f"  parsed product rows: {summary['parsed_product_rows']}")
    print(f"  design groups: {summary['design_group_count']} {summary['design_groups']}")
    print(f"  promo price rows: {summary['promo_price_count']}")
    print(f"  source price list date: {summary['source_price_list_date']}")
    print(f"  scanned table rows: {summary['scanned_table_rows']}")
    print(f"  skipped table rows: {summary['skipped_table_rows']}")
    if summary.get("import_run_id"):
        print(f"  import run: {summary['import_run_id']}")
    if summary.get("inactive_marked_count"):
        print(f"  marked inactive: {summary['inactive_marked_count']}")
    for row in summary["sample_rows"]:
        print(
            "  sample:",
            row["design_group"],
            row["series_code"],
            row["item_code"],
            row["item_unit_price"],
            row["ma_promo_price"],
            row["stock_status"],
        )


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    input_path = Path(args.input)
    products, metadata = parse_pdf(input_path, limit_rows=args.limit_rows)

    env = {**load_env_file(Path(args.env_path)), **os.environ}
    supabase_url = env.get("SUPABASE_URL")
    service_key = env.get("SUPABASE_SERVICE_KEY")
    run_type = "partial" if args.limit_rows else "full"

    if args.commit and (not supabase_url or not service_key):
        raise RuntimeError(f"SUPABASE_URL and SUPABASE_SERVICE_KEY are required in {args.env_path} or environment for --commit.")
    if args.commit and jwt_role(service_key) != "service_role" and not args.allow_non_service_key:
        raise RuntimeError("SUPABASE_SERVICE_KEY is not a service_role JWT. Refusing --commit.")

    if not args.commit:
        print_summary(build_summary(products, metadata, committed=False), args.json)
        return 0

    assert supabase_url is not None
    assert service_key is not None
    importer = SupabaseImporter(supabase_url, service_key)
    run_id = importer.create_run(input_path.name, products, run_type, metadata)
    imported_at = utc_now_iso()

    try:
        importer.insert_snapshots(run_id, products, imported_at)
        importer.upsert_products(products, imported_at)
        inactive_marked_count = 0
        if run_type == "full":
            inactive_marked_count = importer.mark_missing_inactive({product.item_code for product in products}, imported_at)
        importer.complete_run(
            run_id,
            {
                "status": "succeeded",
                "completed_at": utc_now_iso(),
                "product_count": len(products),
                "failed_row_count": 0,
                "error_message": None,
                "metadata": {**metadata, "inactive_marked_count": inactive_marked_count},
            },
        )
        print_summary(build_summary(products, metadata, committed=True, run_id=run_id, inactive_marked_count=inactive_marked_count), args.json)
        return 0
    except Exception as error:
        importer.complete_run(
            run_id,
            {
                "status": "failed",
                "completed_at": utc_now_iso(),
                "failed_row_count": len(products),
                "error_message": str(error),
                "metadata": metadata,
            },
        )
        raise


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
