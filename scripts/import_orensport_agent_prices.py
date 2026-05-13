#!/usr/bin/env python3
"""
Parse OrenSport's agent-price PDF and optionally import it to Supabase.

Default mode is dry-run. Pass --commit to upsert rows into orensport_products.
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
    raise RuntimeError("PyMuPDF is required. Install/use a Python with the 'fitz' module available.") from error


DEFAULT_INPUT = "/Users/darrenchoong/Downloads/ORENSPORT_AGENT_SG.pdf"
DEFAULT_ENV = "backend/.env"
VENDOR = "ORENSPORT"
TABLE = "orensport_products"


@dataclass
class OrenSportRow:
    vendor: str
    item_series_code: str
    raw_item_series_code: str
    sizes: str | None
    agent_price: str | None
    price_4xl_5xl_7xl: str | None
    currency: str
    product_details: str | None
    remark: str | None
    price_update: str | None
    price_variant: str
    page_ref: str | None
    source_pdf_page: int
    source_row_number: int
    source_row_key: str
    source_file: str
    effective_date: str | None
    raw_row: dict[str, Any]
    updated_at: str


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_space(value: str) -> str:
    value = value.replace("\u00a0", " ")
    value = re.sub(r"\s*/\s*", "/", value)
    return re.sub(r"\s+", " ", value).strip()


def parse_decimal(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = normalize_space(value)
    if cleaned == "-":
        return None
    match = re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", cleaned)
    if not match:
        return None
    try:
        return str(Decimal(cleaned).quantize(Decimal("0.01")))
    except InvalidOperation:
        return None


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


def jwt_role(token: str) -> str | None:
    parts = token.split(".")
    if len(parts) < 2:
        return None
    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload.encode("utf-8")))
        return data.get("role")
    except Exception:
        return None


def parse_effective_date(text: str) -> str | None:
    match = re.search(r"Effective Date:\s*([0-9]{2})/([0-9]{2})/([0-9]{4})", text)
    if not match:
        return None
    day, month, year = match.groups()
    return f"{year}-{month}-{day}"


def join_words(words: list[tuple[float, float, str]]) -> str | None:
    if not words:
        return None
    ordered = sorted(words, key=lambda word: (round(word[1], 1), word[0]))
    return normalize_space(" ".join(word[2] for word in ordered)) or None


def split_codes(raw_item_series_code: str) -> list[str]:
    codes = []
    for part in re.split(r"/", raw_item_series_code):
        code = normalize_space(part)
        if code:
            codes.append(code)
    return codes or [raw_item_series_code]


def price_variant(price_update: str | None, remark: str | None) -> str:
    text = normalize_space(" ".join(part for part in [price_update, remark] if part)).lower()
    if "promotion" in text:
        return "promotion"
    if "wsl" in text or "while stock" in text:
        return "wsl"
    if "new sizes" in text:
        return "new_sizes"
    if text == "new" or "new in" in text:
        return "new"
    return "regular"


def source_key(page_number: int, source_row_number: int, item_series_code: str) -> str:
    return f"orensport_agent_sg:2026-01-20:p{page_number}:r{source_row_number}:code:{item_series_code}"


def is_agent_price_anchor(word: tuple[float, float, float, float, str, int, int, int]) -> bool:
    x0, _y0, _x1, _y1, text, *_ = word
    return 198 <= x0 <= 216 and re.fullmatch(r"[0-9]+(?:\.[0-9]{1,2})?", text) is not None


def extract_pdf_rows(pdf_path: Path) -> tuple[list[dict[str, Any]], str | None]:
    doc = fitz.open(pdf_path)
    full_text = "\n".join(page.get_text("text") for page in doc)
    effective_date = parse_effective_date(full_text)
    pdf_rows: list[dict[str, Any]] = []
    global_row_number = 0

    for page_index, page in enumerate(doc, start=1):
        words = page.get_text("words")
        anchors = sorted(
            [(word[1], word[4]) for word in words if is_agent_price_anchor(word)],
            key=lambda item: item[0],
        )
        if not anchors:
            continue

        boundaries: list[tuple[float, float, float]] = []
        for index, (anchor_y, _price_text) in enumerate(anchors):
            start_y = ((anchors[index - 1][0] + anchor_y) / 2) if index > 0 else anchor_y - 6
            end_y = ((anchor_y + anchors[index + 1][0]) / 2) if index < len(anchors) - 1 else anchor_y + 8
            boundaries.append((start_y, anchor_y, end_y))

        for start_y, anchor_y, end_y in boundaries:
            row_words = [
                (word[0], word[1], word[4])
                for word in words
                if start_y <= word[1] < end_y
            ]
            first_col = [(x, y, text) for x, y, text in row_words if x < 62]
            raw_item_words = [(x, y, text) for x, y, text in row_words if 62 <= x < 148]
            sizes_words = [(x, y, text) for x, y, text in row_words if 148 <= x < 198]
            agent_price_words = [(x, y, text) for x, y, text in row_words if 198 <= x < 232]
            oversize_price_words = [(x, y, text) for x, y, text in row_words if 232 <= x < 270]
            details_words = [(x, y, text) for x, y, text in row_words if 270 <= x < 546]
            remark_words = [(x, y, text) for x, y, text in row_words if x >= 546]

            first_col_text = join_words(first_col)
            page_ref = first_col_text if first_col_text and re.fullmatch(r"[0-9]+(?:-[0-9]+)?", first_col_text) else None
            price_update = first_col_text if first_col_text and page_ref is None else None
            raw_item_series_code = join_words(raw_item_words)
            agent_price_text = join_words(agent_price_words)

            if not raw_item_series_code or not parse_decimal(agent_price_text):
                continue

            global_row_number += 1
            remark = join_words(remark_words)
            row = {
                "page_ref": page_ref,
                "price_update": price_update,
                "raw_item_series_code": raw_item_series_code,
                "sizes": join_words(sizes_words),
                "agent_price": agent_price_text,
                "price_4xl_5xl_7xl": join_words(oversize_price_words),
                "product_details": join_words(details_words),
                "remark": remark,
                "source_pdf_page": page_index,
                "source_row_number": global_row_number,
                "anchor_y": round(anchor_y, 1),
            }
            pdf_rows.append(row)

    return pdf_rows, effective_date


def expand_rows(pdf_rows: list[dict[str, Any]], effective_date: str | None, source_file: str) -> list[OrenSportRow]:
    imported_at = utc_now_iso()
    expanded: list[OrenSportRow] = []
    for row in pdf_rows:
        raw_item_series_code = row["raw_item_series_code"]
        for item_series_code in split_codes(raw_item_series_code):
            variant = price_variant(row.get("price_update"), row.get("remark"))
            expanded.append(
                OrenSportRow(
                    vendor=VENDOR,
                    item_series_code=item_series_code,
                    raw_item_series_code=raw_item_series_code,
                    sizes=row.get("sizes"),
                    agent_price=parse_decimal(row.get("agent_price")),
                    price_4xl_5xl_7xl=parse_decimal(row.get("price_4xl_5xl_7xl")),
                    currency="SGD",
                    product_details=row.get("product_details"),
                    remark=row.get("remark"),
                    price_update=row.get("price_update"),
                    price_variant=variant,
                    page_ref=row.get("page_ref"),
                    source_pdf_page=row["source_pdf_page"],
                    source_row_number=row["source_row_number"],
                    source_row_key=source_key(row["source_pdf_page"], row["source_row_number"], item_series_code),
                    source_file=source_file,
                    effective_date=effective_date,
                    raw_row=row,
                    updated_at=imported_at,
                )
            )
    return expanded


def request_json(
    *,
    method: str,
    url: str,
    service_key: str,
    payload: Any | None = None,
    timeout: int = 60,
    prefer: str = "return=minimal",
) -> tuple[int, bytes]:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": prefer,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def chunked(values: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def import_rows(supabase_url: str, service_key: str, rows: list[OrenSportRow]) -> None:
    endpoint = (
        f"{supabase_url.rstrip('/')}/rest/v1/{TABLE}"
        "?on_conflict=source_row_key&columns="
        "vendor,item_series_code,raw_item_series_code,sizes,agent_price,price_4xl_5xl_7xl,"
        "currency,product_details,remark,price_update,price_variant,page_ref,source_pdf_page,"
        "source_row_number,source_row_key,source_file,effective_date,raw_row,updated_at"
    )
    payload = [asdict(row) for row in rows]
    for batch in chunked(payload, 500):
        status, body = request_json(
            method="POST",
            url=endpoint,
            service_key=service_key,
            payload=batch,
            prefer="resolution=merge-duplicates,return=minimal",
        )
        if status not in {200, 201, 204}:
            raise RuntimeError(f"Failed to upsert {TABLE}: HTTP {status}: {body.decode('utf-8', errors='replace')}")


def print_summary(pdf_rows: list[dict[str, Any]], rows: list[OrenSportRow], committed: bool) -> None:
    variants: dict[str, int] = {}
    for row in rows:
        variants[row.price_variant] = variants.get(row.price_variant, 0) + 1

    print("OrenSport import summary")
    print(f"  mode: {'commit' if committed else 'dry-run'}")
    print(f"  pdf price rows: {len(pdf_rows)}")
    print(f"  split item rows: {len(rows)}")
    print(f"  variants: {json.dumps(variants, sort_keys=True)}")
    for row in rows[:8]:
        print(
            "  sample:",
            row.item_series_code,
            row.sizes or "-",
            row.agent_price or "-",
            row.price_4xl_5xl_7xl or "-",
            row.price_variant,
            row.product_details or "",
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import OrenSport agent-price PDF rows into Supabase.")
    parser.add_argument("pdf", nargs="?", default=DEFAULT_INPUT)
    parser.add_argument("--env", default=DEFAULT_ENV)
    parser.add_argument("--commit", action="store_true", help="Write to Supabase. Default is dry-run.")
    parser.add_argument(
        "--allow-non-service-key",
        action="store_true",
        help="Allow --commit with a non-service-role key. Use only for controlled maintenance windows.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        raise RuntimeError(f"PDF not found: {pdf_path}")

    env = {**load_env_file(Path(args.env)), **os.environ}
    supabase_url = env.get("SUPABASE_URL")
    service_key = env.get("SUPABASE_SERVICE_KEY")

    if args.commit and (not supabase_url or not service_key):
        raise RuntimeError(f"SUPABASE_URL and SUPABASE_SERVICE_KEY are required in {args.env} or environment for --commit.")
    if args.commit and service_key and jwt_role(service_key) != "service_role" and not args.allow_non_service_key:
        raise RuntimeError(
            "SUPABASE_SERVICE_KEY is not a service_role key. Refusing --commit before parsing. "
            "Use a real Supabase service role key, or pass --allow-non-service-key only during a controlled maintenance window."
        )

    pdf_rows, effective_date = extract_pdf_rows(pdf_path)
    rows = expand_rows(pdf_rows, effective_date, str(pdf_path))
    print_summary(pdf_rows, rows, args.commit)

    if not args.commit:
        return

    assert supabase_url is not None
    assert service_key is not None
    import_rows(supabase_url, service_key, rows)
    print(f"Committed {len(rows)} rows to {TABLE}.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
