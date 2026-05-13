#!/usr/bin/env python3
"""Import ThumbTech PDF stock/price lists into isolated Supabase tables.

The script defaults to dry-run. Use --commit to write only:
  - thumbtech_products
  - thumbtech_product_snapshots
  - thumbtech_product_scrape_runs
  - thumbtech-product-images storage bucket
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
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

try:
    import fitz  # PyMuPDF
except ImportError as error:  # pragma: no cover - user environment guard
    raise SystemExit("PyMuPDF is required. Install it with: python3 -m pip install pymupdf") from error


VENDOR = "THUMBTECH"
BUCKET_NAME = "thumbtech-product-images"
DEFAULT_ENV = "backend/.env"
DEFAULT_DRINKWARE_PDF = "/Users/darrenchoong/Downloads/Drinkware 11.05.2026.pdf"
DEFAULT_GADGET_PDF = "/Users/darrenchoong/Downloads/Gadget 11.05.2026.pdf"
TABLE_PRODUCTS = "thumbtech_products"
TABLE_SNAPSHOTS = "thumbtech_product_snapshots"
TABLE_RUNS = "thumbtech_product_scrape_runs"


def usage() -> str:
    return f"""Import ThumbTech PDF products into Supabase.

Defaults to dry-run. Pass --commit to write to Supabase.

Examples:
  python3 scripts/import_thumbtech_products_from_pdf.py
  python3 scripts/import_thumbtech_products_from_pdf.py --commit

Options:
  --drinkware-pdf PATH     Default: {DEFAULT_DRINKWARE_PDF}
  --gadget-pdf PATH        Default: {DEFAULT_GADGET_PDF}
  --env PATH               Env file with Supabase credentials. Default: {DEFAULT_ENV}
  --limit-products N       Parse/import only first N non-clearance product rows.
  --commit                 Write snapshots/latest rows and upload images.
  --skip-images            Do not upload images; image_url remains null.
  --assume-image-bucket    Skip bucket create/update checks before image upload.
  --allow-non-service-key  Allow --commit without a service_role JWT.
  --json                   Print summary as JSON.
"""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import ThumbTech PDF products into isolated Supabase tables.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=usage(),
    )
    parser.add_argument("--drinkware-pdf", default=DEFAULT_DRINKWARE_PDF)
    parser.add_argument("--gadget-pdf", default=DEFAULT_GADGET_PDF)
    parser.add_argument("--env", dest="env_path", default=DEFAULT_ENV)
    parser.add_argument("--limit-products", type=int)
    parser.add_argument("--commit", action="store_true")
    parser.add_argument("--skip-images", action="store_true")
    parser.add_argument("--assume-image-bucket", action="store_true")
    parser.add_argument("--allow-non-service-key", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if args.limit_products is not None and args.limit_products <= 0:
        parser.error("--limit-products must be a positive integer")
    return args


def load_env_file(env_path: str) -> dict[str, str]:
    path = Path(env_path)
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def jwt_role(token: str | None) -> str | None:
    if not token:
        return None
    parts = token.split(".")
    if len(parts) < 2:
        return None
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        return json.loads(payload).get("role")
    except Exception:
        return None


def normalize_space(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\u00a0", " ")
    text = text.replace("\ufb02", "fl").replace("\ufb01", "fi")
    return re.sub(r"\s+", " ", text).strip()


def clean_cell(value: Any) -> str:
    return normalize_space(value).strip()


def clean_sku(value: str) -> str:
    cleaned = normalize_space(value).upper()
    cleaned = re.sub(r"\s*-\s+", "-", cleaned)
    cleaned = re.sub(r"\s+", "", cleaned)
    return cleaned


def slugify(value: str) -> str:
    slug = normalize_space(value).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug or "item"


def item_suffix(value: str) -> str:
    suffix = normalize_space(value).upper().replace("&", " AND ")
    suffix = re.sub(r"[^A-Z0-9]+", "-", suffix)
    suffix = suffix.strip("-")
    return suffix or "DEFAULT"


def parse_int(value: Any) -> int | None:
    text = normalize_space(value).replace(",", "")
    if not text:
        return None
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    return None


def parse_decimal(value: Any) -> str | None:
    text = normalize_space(value).replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)", text)
    if not match:
        return None
    try:
        return str(Decimal(match.group(0)).quantize(Decimal("0.01")))
    except InvalidOperation:
        return None


def first_decimal_in_rows(rows: list[list[str]]) -> str | None:
    for row in rows:
        if not row:
            continue
        price = parse_decimal(row[-1])
        if price is not None:
            return price
    return None


def series_code_from_name(product_name: str) -> str:
    name = normalize_space(product_name).upper()
    if name.startswith("SMART HYDRATE"):
        return "SMART-HYDRATE"
    match = re.match(r"([A-Z0-9]+(?:-[A-Z0-9]+)*)\b", name)
    if match:
        return match.group(1)
    return item_suffix(name)


def extract_field(pattern: str, text: str) -> str | None:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if not match:
        return None
    return normalize_space(match.group(1).strip(" :|"))


def extract_material(text: str) -> str | None:
    return extract_field(r"Material:?\s*([^|]+)", text)


def extract_capacity(text: str, product_name: str) -> str | None:
    capacity = extract_field(r"CAPACITY:?\s*([^|]+)", text)
    if capacity:
        return capacity
    match = re.search(r"\b(\d+(?:\.\d+)?\s*(?:ML|L|MAH|W))\b", product_name, flags=re.IGNORECASE)
    return normalize_space(match.group(1).upper()) if match else None


def extract_dimensions(*values: str) -> str | None:
    parts: list[str] = []
    for value in values:
        text = normalize_space(value)
        for match in re.finditer(
            r"(?:Dimension|Folded Dimension)?\s*:?\s*([0-9.]+\s*(?:cm|mm)\s*[x*]\s*[0-9.]+\s*(?:cm|mm)(?:\s*[x*]\s*[0-9.]+\s*(?:cm|mm))?)",
            text,
            flags=re.IGNORECASE,
        ):
            part = normalize_space(match.group(1))
            if part and part not in parts:
                parts.append(part)
    return "; ".join(parts) if parts else None


def extract_weight(*values: str) -> str | None:
    parts: list[str] = []
    for value in values:
        text = normalize_space(value)
        for match in re.finditer(r"(?:Weight|WEIGHT|Estimated Full Set Weight)\s*:?\s*([0-9.+\s]+g)", text, flags=re.IGNORECASE):
            part = normalize_space(match.group(1))
            if part and part not in parts:
                parts.append(part)
    return "; ".join(parts) if parts else None


def extract_printing_options(text: str) -> list[str]:
    match = re.search(r"Printing Option:?\s*(.+)", text, flags=re.IGNORECASE)
    if not match:
        return []
    options = match.group(1)
    options = re.split(r"\s+-{3,}\s+| Specification: | Product Warranty: ", options, maxsplit=1, flags=re.IGNORECASE)[0]
    parts = [normalize_space(part) for part in re.split(r"\s*/\s*", options)]
    cleaned: list[str] = []
    for part in parts:
        part = part.strip(" .")
        if part and part not in cleaned:
            cleaned.append(part)
    return cleaned


def footer_status(rows: list[list[str]]) -> tuple[str | None, str | None, str | None]:
    stock_status = None
    colour = None
    warranty = None
    for row in rows:
        first = row[0] if len(row) > 0 else ""
        if first.upper().startswith("IN STOCK>"):
            stock_status = "IN STOCK"
            colour = normalize_space(first.split(">", 1)[1]).upper() or None
        if len(row) > 2 and row[2]:
            if "WARRANTY" in row[2].upper():
                warranty = normalize_space(row[2]).upper()
    return stock_status, colour, warranty


def supplier_labels_from_cells(cells: list[str]) -> list[str]:
    ignored = {"", "SGD", "COMING SOON", "DESCRIPTION", "STOCK LEVEL", "STOCK LEVEL RESERVED"}
    labels: list[str] = []
    for cell in cells:
        value = normalize_space(cell).upper()
        if not value or value in ignored:
            continue
        if value in {"SPECIAL OFFER", "PREMIUM", "BELOW COST!!!", "BELOW COST"} and value not in labels:
            labels.append(value)
    return labels


@dataclass
class PdfBand:
    catalog: str
    source_file: str
    page_number: int
    header_row_number: int
    rows: list[list[str]]
    crop_rect: tuple[float, float, float, float] | None
    page_path: str


@dataclass
class ParsedResult:
    products: list[dict[str, Any]]
    skipped_products: int
    excluded_clearance_count: int
    source_files: list[str]
    parse_warnings: list[str]


def table_rows(table: Any) -> list[list[str]]:
    extracted = table.extract()
    return [[clean_cell(cell) for cell in row] for row in extracted]


def row_bbox(table: Any, row_index: int) -> tuple[float, float, float, float] | None:
    if row_index >= len(table.rows):
        return None
    bbox = table.rows[row_index].bbox
    return (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))


def crop_rect_for_header(table: Any, header_index: int, end_y: float | None, catalog: str) -> tuple[float, float, float, float] | None:
    bbox = row_bbox(table, header_index)
    if bbox is None:
        return None
    header_row = table.rows[header_index]
    cells = header_row.cells
    x0 = float(table.bbox[0])
    if catalog == "drinkware" and len(cells) > 3 and cells[3]:
        x1 = float(cells[3][0])
    elif catalog == "gadget" and len(cells) > 2 and cells[2]:
        x1 = float(cells[2][0])
    else:
        x1 = float(table.bbox[2])
    y0 = max(float(bbox[1]), float(table.bbox[1]))
    y1 = min(float(end_y if end_y is not None else table.bbox[3]), float(table.bbox[3]))
    if x1 <= x0 or y1 <= y0:
        return None
    return (x0, y0, x1, y1)


def is_drinkware_header(row: list[str]) -> bool:
    return (
        len(row) >= 10
        and bool(row[0])
        and "SKU" in row[4].upper()
        and "STOCK" in row[5].upper()
        and "RESERVED" in row[6].upper()
    )


def is_gadget_header(row: list[str]) -> bool:
    return (
        len(row) >= 6
        and bool(row[0])
        and "STOCK" in row[3].upper()
        and "RESERVED" in row[4].upper()
        and any(cell.upper() == "SGD" for cell in row[5:])
    )


def collect_bands(pdf_path: Path, catalog: str) -> tuple[list[PdfBand], list[str]]:
    warnings: list[str] = []
    bands: list[PdfBand] = []
    current: dict[str, Any] | None = None

    doc = fitz.open(pdf_path)
    try:
        for page_index, page in enumerate(doc):
            tables = page.find_tables().tables
            if not tables:
                continue
            table = tables[0]
            rows = table_rows(table)
            header_indexes = [
                index
                for index, row in enumerate(rows)
                if (is_drinkware_header(row) if catalog == "drinkware" else is_gadget_header(row))
            ]

            for row_index, row in enumerate(rows):
                is_header = row_index in header_indexes
                if is_header:
                    if current is not None:
                        end_y = row_bbox(table, row_index)[1] if current["page_index"] == page_index and row_bbox(table, row_index) else None
                        current["crop_rect"] = current["crop_rect_factory"](end_y)
                        bands.append(
                            PdfBand(
                                catalog=current["catalog"],
                                source_file=current["source_file"],
                                page_number=current["page_number"],
                                header_row_number=current["header_row_number"],
                                rows=current["rows"],
                                crop_rect=current["crop_rect"],
                                page_path=current["page_path"],
                            )
                        )
                    current = {
                        "catalog": catalog,
                        "source_file": pdf_path.name,
                        "page_number": page_index + 1,
                        "page_index": page_index,
                        "header_row_number": row_index + 1,
                        "rows": [row],
                        "page_path": str(pdf_path),
                        "crop_rect": None,
                        "crop_rect_factory": lambda end_y, table=table, row_index=row_index, catalog=catalog: crop_rect_for_header(table, row_index, end_y, catalog),
                    }
                elif current is not None:
                    current["rows"].append(row)

        if current is not None:
            current["crop_rect"] = current["crop_rect_factory"](None)
            bands.append(
                PdfBand(
                    catalog=current["catalog"],
                    source_file=current["source_file"],
                    page_number=current["page_number"],
                    header_row_number=current["header_row_number"],
                    rows=current["rows"],
                    crop_rect=current["crop_rect"],
                    page_path=current["page_path"],
                )
            )
    finally:
        doc.close()

    if not bands:
        warnings.append(f"No product bands found in {pdf_path.name}")
    return bands, warnings


def band_is_clearance(band: PdfBand) -> bool:
    joined = " ".join(" ".join(row) for row in band.rows).upper()
    return "CLEARANCE" in joined


def product_image_bytes(band: PdfBand) -> bytes | None:
    if band.crop_rect is None:
        return None
    doc = fitz.open(band.page_path)
    try:
        page = doc[band.page_number - 1]
        rect = fitz.Rect(*band.crop_rect)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=rect, alpha=False)
        return pix.tobytes("png")
    finally:
        doc.close()


def base_product_fields(band: PdfBand, header: list[str], detail: list[str], all_text: str) -> dict[str, Any]:
    product_name = normalize_space(header[0])
    series_code = series_code_from_name(product_name)
    packaging = normalize_space(header[2] if band.catalog == "drinkware" and len(header) > 2 else header[1] if len(header) > 1 else "") or None
    description_parts = []
    if len(detail) > 0 and detail[0]:
        description_parts.append(detail[0])
    if band.catalog == "gadget" and len(header) > 2 and header[2] and "DESCRIPTION" not in header[2].upper():
        description_parts.append(header[2])
    description = " | ".join(dict.fromkeys(normalize_space(part) for part in description_parts if normalize_space(part))) or None
    product_details = normalize_space(detail[3] if band.catalog == "drinkware" and len(detail) > 3 else detail[2] if len(detail) > 2 else "") or None
    package_text = normalize_space(detail[2] if band.catalog == "drinkware" and len(detail) > 2 else detail[1] if len(detail) > 1 else "")
    footer_text = " ".join(" | ".join(row[:3]) for row in band.rows if row)
    labels = supplier_labels_from_cells(header + detail)
    if header:
        for cell in header:
            value = normalize_space(cell).upper()
            if value == "COMING SOON":
                continue
            if value in {"SPECIAL OFFER", "PREMIUM", "BELOW COST!!!", "BELOW COST"} and value not in labels:
                labels.append(value)
    return {
        "vendor": VENDOR,
        "source_catalog": band.catalog,
        "source_file": band.source_file,
        "source_pdf_page": band.page_number,
        "source_row_number": band.header_row_number,
        "series_code": series_code,
        "product_name": product_name,
        "description": description,
        "product_details": product_details,
        "packaging": packaging,
        "material": extract_material(all_text),
        "dimensions": extract_dimensions(package_text, product_details or "", all_text),
        "weight": extract_weight(package_text, product_details or "", footer_text),
        "capacity": extract_capacity(product_details or "", product_name),
        "warranty": footer_status(band.rows)[2],
        "item_unit_price": first_decimal_in_rows(band.rows),
        "currency": "SGD",
        "stock_status": footer_status(band.rows)[0],
        "supplier_labels": labels,
        "decoration_methods": extract_printing_options(product_details or all_text),
        "raw_product": {
            "source": "thumbtech_pdf",
            "source_catalog": band.catalog,
            "source_file": band.source_file,
            "source_pdf_page": band.page_number,
            "source_row_number": band.header_row_number,
            "header_row": header,
            "detail_row": detail,
            "rows": band.rows,
        },
    }


def build_item_code(series_code: str, sku_colour: str | None, colour: str | None) -> str:
    sku = clean_sku(sku_colour or "")
    if sku and re.search(r"\d", sku) and not sku.startswith("IN STOCK"):
        return sku
    suffix_source = colour or sku or "DEFAULT"
    return f"{series_code}-{item_suffix(suffix_source)}"


def parse_drinkware_band(band: PdfBand) -> list[dict[str, Any]]:
    rows = band.rows
    if len(rows) < 2:
        return []
    header = rows[0]
    detail = rows[1]
    all_text = " | ".join(" | ".join(row) for row in rows)
    base = base_product_fields(band, header, detail, all_text)
    products: list[dict[str, Any]] = []

    for row_offset, row in enumerate(rows[2:], start=3):
        if len(row) < 7:
            continue
        sku_cell = clean_sku(row[4])
        stock = parse_int(row[5])
        reserved = parse_int(row[6])
        if not sku_cell or stock is None or reserved is None:
            continue
        if sku_cell in {"SKU-COLOUR", "SKU"}:
            continue

        if "-" in sku_cell:
            colour = sku_cell.split("-", 1)[1]
        else:
            colour = sku_cell
        item_code = build_item_code(base["series_code"], sku_cell, colour)
        available = max(stock - reserved, 0)
        product = {
            **base,
            "item_code": item_code,
            "sku_colour": sku_cell,
            "colour": normalize_space(colour).upper(),
            "source_row_key": f"{band.catalog}:p{band.page_number}:r{band.header_row_number}:{item_code}",
            "stock_level_quantity": stock,
            "reserved_quantity": reserved,
            "stock_quantity": available,
            "incoming_stock": {},
            "image_url": None,
            "image_urls": [],
        }
        product["raw_product"] = {
            **base["raw_product"],
            "variant_row": row,
            "variant_row_number_in_band": row_offset,
        }
        products.append(product)
    return products


def incoming_month_labels(row: list[str], price_col: int) -> dict[int, str]:
    labels: dict[int, str] = {}
    for col in range(5, price_col):
        value = normalize_space(row[col] if col < len(row) else "")
        if value and parse_int(value) is None:
            labels[col] = value
    return labels


def attach_incoming(target: dict[str, int], row: list[str], labels: dict[int, str], price_col: int) -> None:
    for col in range(5, price_col):
        value = parse_int(row[col] if col < len(row) else "")
        label = labels.get(col)
        if value is not None and label:
            target[label] = value


def colour_from_product_details(text: str) -> str | None:
    colour = extract_field(r"Colour:?\s*([^|]+)", text)
    return colour.upper() if colour else None


def parse_gadget_band(band: PdfBand) -> list[dict[str, Any]]:
    rows = band.rows
    if len(rows) < 2:
        return []
    header = rows[0]
    detail = rows[1]
    all_text = " | ".join(" | ".join(row) for row in rows)
    base = base_product_fields(band, header, detail, all_text)
    price_col = max(len(header) - 1, 6)
    stock_status, footer_colour, footer_warranty = footer_status(rows)
    base["stock_status"] = stock_status
    base["warranty"] = base.get("warranty") or footer_warranty

    products: list[dict[str, Any]] = []
    current_colour: str | None = None
    current_months: dict[int, str] = {}
    last_product: dict[str, Any] | None = None

    def add_variant(colour: str | None, stock: int, reserved: int, incoming: dict[str, int], variant_row: list[str], row_number: int) -> dict[str, Any]:
        resolved_colour = normalize_space(colour or footer_colour or colour_from_product_details(all_text) or "DEFAULT").upper()
        item_code = build_item_code(base["series_code"], resolved_colour, resolved_colour)
        available = max(stock - reserved, 0)
        product = {
            **base,
            "item_code": item_code,
            "sku_colour": resolved_colour,
            "colour": resolved_colour,
            "source_row_key": f"{band.catalog}:p{band.page_number}:r{band.header_row_number}:{item_code}",
            "stock_level_quantity": stock,
            "reserved_quantity": reserved,
            "stock_quantity": available,
            "incoming_stock": dict(incoming),
            "image_url": None,
            "image_urls": [],
        }
        product["raw_product"] = {
            **base["raw_product"],
            "variant_row": variant_row,
            "variant_row_number_in_band": row_number,
        }
        products.append(product)
        return product

    for row_offset, row in enumerate(rows[1:], start=2):
        if not any(row):
            continue
        first = row[0].upper() if len(row) > 0 else ""
        if first.startswith("IN STOCK>"):
            continue

        if len(row) <= price_col:
            row = row + [""] * (price_col + 1 - len(row))

        stock_cell = row[3]
        reserved_cell = row[4]
        stock = parse_int(stock_cell)
        reserved = parse_int(reserved_cell)
        text_stock = normalize_space(stock_cell)

        month_updates = incoming_month_labels(row, price_col)
        if month_updates:
            current_months.update(month_updates)

        if text_stock and stock is None and "STOCK" not in text_stock.upper():
            current_colour = text_stock.upper()
            current_months = incoming_month_labels(row, price_col)
            continue

        if stock is not None and reserved is not None:
            incoming: dict[str, int] = {}
            attach_incoming(incoming, row, current_months, price_col)
            last_product = add_variant(current_colour, stock, reserved, incoming, row, row_offset)
            current_colour = None
            continue

        if last_product is not None:
            attach_incoming(last_product["incoming_stock"], row, current_months, price_col)

    if not products:
        stock = parse_int(detail[3] if len(detail) > 3 else "")
        reserved = parse_int(detail[4] if len(detail) > 4 else "")
        if stock is not None and reserved is not None:
            incoming: dict[str, int] = {}
            current_months = incoming_month_labels(detail, price_col)
            for row in rows[2:]:
                attach_incoming(incoming, row, current_months, price_col)
            add_variant(None, stock, reserved, incoming, detail, 2)

    return products


def deduplicate_products(products: list[dict[str, Any]]) -> None:
    counts: dict[str, int] = {}
    for product in products:
        key = f"{product['vendor']}\x1f{product['item_code']}"
        counts[key] = counts.get(key, 0) + 1
    duplicates = [key for key, count in counts.items() if count > 1]
    if not duplicates:
        return
    examples = []
    for key in duplicates[:10]:
        _vendor, item_code = key.split("\x1f", 1)
        examples.append(f"{item_code} ({counts[key]} rows)")
    raise RuntimeError(f"Duplicate ThumbTech item codes found: {'; '.join(examples)}")


def parse_pdfs(paths: list[tuple[str, Path]], limit_products: int | None = None) -> ParsedResult:
    products: list[dict[str, Any]] = []
    skipped_products = 0
    excluded_clearance_count = 0
    warnings: list[str] = []

    for catalog, path in paths:
        if not path.exists():
            raise FileNotFoundError(f"PDF not found: {path}")
        bands, band_warnings = collect_bands(path, catalog)
        warnings.extend(band_warnings)
        for band in bands:
            if band_is_clearance(band):
                excluded_clearance_count += 1
                skipped_products += 1
                continue
            parsed = parse_drinkware_band(band) if catalog == "drinkware" else parse_gadget_band(band)
            if not parsed:
                skipped_products += 1
                warnings.append(f"No product rows parsed for {path.name} page {band.page_number} row {band.header_row_number}: {band.rows[0][0] if band.rows else 'unknown'}")
                continue
            image_bytes = product_image_bytes(band)
            for product in parsed:
                product["_image_bytes"] = image_bytes
                product["_image_object_path"] = f"{catalog}/{slugify(product['series_code'])}/{slugify(product['item_code'])}.png"
                products.append(product)
                if limit_products and len(products) >= limit_products:
                    deduplicate_products(products)
                    return ParsedResult(products, skipped_products, excluded_clearance_count, [path.name for _catalog, path in paths], warnings)

    deduplicate_products(products)
    return ParsedResult(products, skipped_products, excluded_clearance_count, [path.name for _catalog, path in paths], warnings)


def chunked(values: list[Any], size: int) -> list[list[Any]]:
    return [values[index:index + size] for index in range(0, len(values), size)]


def postgrest_in_filter(values: list[str]) -> str:
    return urllib.parse.quote("(" + ",".join(json.dumps(value) for value in values) + ")", safe="")


def request_json(method: str, url: str, key: str, payload: Any | None = None, headers: dict[str, str] | None = None) -> Any:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request_headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, data=body, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            text = response.read().decode("utf-8")
            return json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        message = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase {method} {url} failed: HTTP {error.code}: {message[:800]}") from error


def request_bytes(method: str, url: str, key: str, payload: bytes | None = None, headers: dict[str, str] | None = None) -> bytes:
    request_headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, data=payload, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        message = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase {method} {url} failed: HTTP {error.code}: {message[:800]}") from error


class SupabaseImporter:
    def __init__(self, supabase_url: str, service_key: str) -> None:
        self.supabase_url = supabase_url.rstrip("/")
        self.service_key = service_key

    def create_run(self, result: ParsedResult, run_type: str, metadata: dict[str, Any]) -> str:
        unique_series = sorted({product["series_code"] for product in result.products})
        rows = request_json(
            "POST",
            f"{self.supabase_url}/rest/v1/{TABLE_RUNS}",
            self.service_key,
            {
                "vendor": VENDOR,
                "source_type": "pdf",
                "source_files": result.source_files,
                "run_type": run_type,
                "status": "started",
                "series_count": len(unique_series),
                "skipped_product_count": result.skipped_products,
                "excluded_clearance_count": result.excluded_clearance_count,
                "metadata": metadata,
            },
        )
        return rows[0]["id"]

    def complete_run(self, run_id: str, payload: dict[str, Any]) -> None:
        request_json(
            "PATCH",
            f"{self.supabase_url}/rest/v1/{TABLE_RUNS}?id=eq.{run_id}",
            self.service_key,
            payload,
            headers={"Prefer": "return=minimal"},
        )

    def ensure_bucket(self) -> None:
        try:
            request_json("GET", f"{self.supabase_url}/storage/v1/bucket/{BUCKET_NAME}", self.service_key)
            request_json(
                "PUT",
                f"{self.supabase_url}/storage/v1/bucket/{BUCKET_NAME}",
                self.service_key,
                {"public": True, "file_size_limit": 5_242_880, "allowed_mime_types": ["image/png"]},
                headers={"Prefer": "return=minimal"},
            )
            return
        except RuntimeError as error:
            if "HTTP 404" not in str(error):
                raise
        request_json(
            "POST",
            f"{self.supabase_url}/storage/v1/bucket",
            self.service_key,
            {"id": BUCKET_NAME, "name": BUCKET_NAME, "public": True, "file_size_limit": 5_242_880, "allowed_mime_types": ["image/png"]},
            headers={"Prefer": "return=minimal"},
        )

    def upload_images(self, products: list[dict[str, Any]]) -> None:
        seen: dict[str, str] = {}
        for product in products:
            image_bytes = product.get("_image_bytes")
            object_path = product.get("_image_object_path")
            if not image_bytes or not object_path:
                continue
            if object_path not in seen:
                encoded_path = urllib.parse.quote(object_path, safe="/")
                request_bytes(
                    "POST",
                    f"{self.supabase_url}/storage/v1/object/{BUCKET_NAME}/{encoded_path}",
                    self.service_key,
                    image_bytes,
                    headers={"Content-Type": "image/png", "x-upsert": "true"},
                )
                seen[object_path] = f"{self.supabase_url}/storage/v1/object/public/{BUCKET_NAME}/{encoded_path}"
            product["image_url"] = seen[object_path]
            product["image_urls"] = [seen[object_path]]

    def clean_product(self, product: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in product.items() if not key.startswith("_")}

    def insert_snapshots(self, run_id: str, products: list[dict[str, Any]], scraped_at: str) -> None:
        rows = [
            {
                **self.clean_product(product),
                "scrape_run_id": run_id,
                "scraped_at": scraped_at,
            }
            for product in products
        ]
        for batch in chunked(rows, 300):
            request_json(
                "POST",
                f"{self.supabase_url}/rest/v1/{TABLE_SNAPSHOTS}",
                self.service_key,
                batch,
                headers={"Prefer": "return=minimal"},
            )

    def upsert_products(self, products: list[dict[str, Any]], scraped_at: str) -> None:
        rows = [
            {
                **self.clean_product(product),
                "is_active": True,
                "last_seen_at": scraped_at,
                "last_scraped_at": scraped_at,
                "missing_since_at": None,
                "updated_at": scraped_at,
            }
            for product in products
        ]
        columns = ",".join(
            [
                "vendor",
                "source_catalog",
                "source_file",
                "source_pdf_page",
                "source_row_number",
                "source_row_key",
                "series_code",
                "item_code",
                "sku_colour",
                "colour",
                "product_name",
                "description",
                "product_details",
                "packaging",
                "material",
                "dimensions",
                "weight",
                "capacity",
                "warranty",
                "item_unit_price",
                "currency",
                "image_url",
                "image_urls",
                "stock_status",
                "stock_level_quantity",
                "reserved_quantity",
                "stock_quantity",
                "incoming_stock",
                "supplier_labels",
                "decoration_methods",
                "raw_product",
                "is_active",
                "last_seen_at",
                "last_scraped_at",
                "missing_since_at",
                "updated_at",
            ]
        )
        for batch in chunked(rows, 300):
            request_json(
                "POST",
                f"{self.supabase_url}/rest/v1/{TABLE_PRODUCTS}?on_conflict=vendor,item_code&columns={columns}",
                self.service_key,
                batch,
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            )

    def mark_missing_inactive(self, seen_item_codes: set[str], scraped_at: str) -> int:
        rows = request_json(
            "GET",
            f"{self.supabase_url}/rest/v1/{TABLE_PRODUCTS}?select=id,item_code&vendor=eq.{urllib.parse.quote(VENDOR)}&is_active=eq.true&limit=20000",
            self.service_key,
        )
        missing_ids = [row["id"] for row in rows if row["item_code"] not in seen_item_codes]
        for batch in chunked(missing_ids, 300):
            request_json(
                "PATCH",
                f"{self.supabase_url}/rest/v1/{TABLE_PRODUCTS}?id=in.{postgrest_in_filter(batch)}",
                self.service_key,
                {
                    "is_active": False,
                    "missing_since_at": scraped_at,
                    "last_scraped_at": scraped_at,
                    "updated_at": scraped_at,
                },
                headers={"Prefer": "return=minimal"},
            )
        return len(missing_ids)


def iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def summary_for(result: ParsedResult, committed: bool, run_id: str | None = None, inactive_marked_count: int = 0) -> dict[str, Any]:
    unique_series = sorted({product["series_code"] for product in result.products})
    by_catalog: dict[str, int] = {}
    for product in result.products:
        by_catalog[product["source_catalog"]] = by_catalog.get(product["source_catalog"], 0) + 1
    return {
        "committed": committed,
        "source_files": result.source_files,
        "parsed_product_rows": len(result.products),
        "unique_series_count": len(unique_series),
        "rows_by_catalog": by_catalog,
        "skipped_product_count": result.skipped_products,
        "excluded_clearance_count": result.excluded_clearance_count,
        "import_run_id": run_id,
        "inactive_marked_count": inactive_marked_count,
        "warnings": result.parse_warnings[:50],
        "sample_rows": [
            {
                key: product.get(key)
                for key in [
                    "source_catalog",
                    "series_code",
                    "item_code",
                    "item_unit_price",
                    "stock_level_quantity",
                    "reserved_quantity",
                    "stock_quantity",
                    "incoming_stock",
                    "product_name",
                ]
            }
            for product in result.products[:10]
        ],
    }


def print_summary(summary: dict[str, Any], as_json: bool) -> None:
    if as_json:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return
    print("")
    print("ThumbTech product import summary")
    print(f"  mode: {'commit' if summary['committed'] else 'dry-run'}")
    print(f"  source files: {', '.join(summary['source_files'])}")
    print(f"  parsed product rows: {summary['parsed_product_rows']}")
    print(f"  unique series: {summary['unique_series_count']}")
    print(f"  rows by catalog: {summary['rows_by_catalog']}")
    print(f"  skipped product bands: {summary['skipped_product_count']}")
    print(f"  excluded clearance bands: {summary['excluded_clearance_count']}")
    if summary.get("import_run_id"):
        print(f"  scrape run: {summary['import_run_id']}")
    if summary.get("inactive_marked_count"):
        print(f"  marked inactive: {summary['inactive_marked_count']}")
    for warning in summary["warnings"][:10]:
        print(f"  warning: {warning}")
    for row in summary["sample_rows"]:
        print(
            "  sample:",
            row["source_catalog"],
            row["series_code"],
            row["item_code"],
            row["item_unit_price"],
            row["stock_quantity"],
            row["incoming_stock"],
        )


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    env = {**load_env_file(args.env_path), **os.environ}
    supabase_url = env.get("SUPABASE_URL")
    service_key = env.get("SUPABASE_SERVICE_KEY")

    if args.commit and (not supabase_url or not service_key):
        raise RuntimeError(f"SUPABASE_URL and SUPABASE_SERVICE_KEY are required in {args.env_path} or the environment for --commit.")
    if args.commit and jwt_role(service_key) != "service_role" and not args.allow_non_service_key:
        raise RuntimeError("SUPABASE_SERVICE_KEY is not a service_role JWT. Refusing --commit.")

    paths = [
        ("drinkware", Path(args.drinkware_pdf)),
        ("gadget", Path(args.gadget_pdf)),
    ]
    result = parse_pdfs(paths, limit_products=args.limit_products)
    run_type = "partial" if args.limit_products else "full"
    metadata = {
        "source": "thumbtech_pdf",
        "limit_products": args.limit_products,
        "image_bucket": None if args.skip_images else BUCKET_NAME,
        "clearance_rule": "skip product bands containing CLEARANCE",
        "coming_soon_rule": "store future quantities in incoming_stock only",
        "stock_quantity_rule": "max(stock_level_quantity - reserved_quantity, 0)",
    }

    if not args.commit:
        print_summary(summary_for(result, committed=False), args.json)
        return 0

    assert supabase_url is not None
    assert service_key is not None
    importer = SupabaseImporter(supabase_url, service_key)
    scraped_at = iso_now()
    run_id = importer.create_run(result, run_type, metadata)

    try:
        if not args.skip_images:
            if not args.assume_image_bucket:
                importer.ensure_bucket()
            importer.upload_images(result.products)
        importer.insert_snapshots(run_id, result.products, scraped_at)
        importer.upsert_products(result.products, scraped_at)
        inactive_marked_count = 0
        if run_type == "full":
            inactive_marked_count = importer.mark_missing_inactive({product["item_code"] for product in result.products}, scraped_at)
        unique_series = sorted({product["series_code"] for product in result.products})
        completion_metadata = {**metadata, "inactive_marked_count": inactive_marked_count, "parse_warnings": result.parse_warnings[:100]}
        importer.complete_run(
            run_id,
            {
                "status": "succeeded",
                "completed_at": iso_now(),
                "succeeded_series_count": len(unique_series),
                "failed_series_count": 0,
                "product_count": len(result.products),
                "skipped_product_count": result.skipped_products,
                "excluded_clearance_count": result.excluded_clearance_count,
                "failed_series": [],
                "error_message": None,
                "metadata": completion_metadata,
            },
        )
        print_summary(summary_for(result, committed=True, run_id=run_id, inactive_marked_count=inactive_marked_count), args.json)
        return 0
    except Exception as error:
        unique_series = sorted({product["series_code"] for product in result.products})
        importer.complete_run(
            run_id,
            {
                "status": "failed",
                "completed_at": iso_now(),
                "succeeded_series_count": 0,
                "failed_series_count": len(unique_series),
                "product_count": 0,
                "skipped_product_count": result.skipped_products,
                "excluded_clearance_count": result.excluded_clearance_count,
                "failed_series": unique_series,
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
