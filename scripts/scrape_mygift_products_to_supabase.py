#!/usr/bin/env python3
"""
Scrape MYGIFT product stock/price data and optionally import it to Supabase.

Default mode is dry-run. Pass --commit to write to the project-owned
mygift_products, mygift_product_snapshots, and mygift_product_scrape_runs tables.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any


BASE_URL = "http://www.mygiftuniversal.com.my"
CALCULATOR_URL = f"{BASE_URL}/calculator.php"
LOGIN_URL = f"{BASE_URL}/login.php"
DEFAULT_ENV = "backend/.env"
VENDOR = "MYGIFT"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


class SelectOptionsParser(HTMLParser):
    def __init__(self, target_select_id: str | None = None) -> None:
        super().__init__(convert_charrefs=True)
        self.target_select_id = target_select_id
        self.in_target_select = target_select_id is None
        self.in_option = False
        self.current_value: str | None = None
        self.current_text: list[str] = []
        self.options: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): value for key, value in attrs}
        if tag.lower() == "select" and self.target_select_id is not None:
            self.in_target_select = attrs_dict.get("id") == self.target_select_id
        if tag.lower() == "option" and self.in_target_select:
            self._finish_option()
            self.in_option = True
            self.current_value = attrs_dict.get("value") or ""
            self.current_text = []

    def handle_data(self, data: str) -> None:
        if self.in_option:
            self.current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "option" and self.in_option:
            self._finish_option()
        if tag.lower() == "select" and self.target_select_id is not None:
            self._finish_option()
            self.in_target_select = False

    def close(self) -> None:
        super().close()
        self._finish_option()

    def _finish_option(self) -> None:
        if not self.in_option:
            return
        value = normalize_space(self.current_value or "")
        text = normalize_space("".join(self.current_text))
        self.options.append((value, text))
        self.in_option = False
        self.current_value = None
        self.current_text = []


class ProductTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_row = False
        self.in_cell = False
        self.current_row: list[dict[str, str | None]] = []
        self.current_text: list[str] = []
        self.current_image: str | None = None
        self.rows: list[list[dict[str, str | None]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "tr":
            self._finish_cell()
            self._finish_row()
            self.in_row = True
            self.current_row = []
        elif tag in {"td", "th"} and self.in_row:
            self._finish_cell()
            self.in_cell = True
            self.current_text = []
            self.current_image = None
        elif tag == "img" and self.in_cell:
            attrs_dict = {key.lower(): value for key, value in attrs}
            self.current_image = attrs_dict.get("src")

    def handle_data(self, data: str) -> None:
        if self.in_cell:
            self.current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"td", "th"}:
            self._finish_cell()
        elif tag == "tr":
            self._finish_cell()
            self._finish_row()
            self.in_row = False

    def close(self) -> None:
        super().close()
        self._finish_cell()
        self._finish_row()

    def _finish_cell(self) -> None:
        if not self.in_cell:
            return
        self.current_row.append(
            {
                "text": normalize_space("".join(self.current_text)),
                "image": self.current_image,
            }
        )
        self.in_cell = False
        self.current_text = []
        self.current_image = None

    def _finish_row(self) -> None:
        if self.current_row:
            self.rows.append(self.current_row)
        self.current_row = []


@dataclass
class ProductRow:
    vendor: str
    series_code: str
    item_code: str
    item_unit_price: str | None
    currency: str
    description: str | None
    image_url: str | None
    stock_status: str | None
    stock_quantity: int | None
    decoration_methods: list[str]
    raw_product: dict[str, Any]


@dataclass
class SeriesResult:
    series_code: str
    decoration_methods: list[str]
    products: list[ProductRow]


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def parse_decimal(value: str) -> str | None:
    cleaned = normalize_space(value)
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", cleaned)
    if not match:
        return None
    try:
        return str(Decimal(match.group(1)).quantize(Decimal("0.01")))
    except InvalidOperation:
        return None


def parse_currency(value: str) -> str:
    return "SGD" if "S$" in value or "$" in value else "SGD"


def parse_stock_quantity(value: str) -> int | None:
    cleaned = normalize_space(value)
    if re.fullmatch(r"[0-9]+", cleaned):
        return int(cleaned)
    return None


class MygiftClient:
    def __init__(self, username: str, password: str, timeout: int, retries: int) -> None:
        self.username = username
        self.password = password
        self.timeout = timeout
        self.retries = retries
        self.cookie_jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookie_jar))
        self.opener.addheaders = [
            ("User-Agent", "EasyPrint Price Agent MYGIFT scraper/1.0"),
        ]

    def login(self) -> None:
        self.request(f"{BASE_URL}/index.php?status=UnLogin")
        payload = urllib.parse.urlencode(
            {
                "UserName1": self.username,
                "Pass1": self.password,
            }
        ).encode("utf-8")
        response = self.request(LOGIN_URL, data=payload)
        if "Admin Login Page" in response or "Please Login" in response:
            raise RuntimeError("MYGIFT login failed; portal returned the login page.")

        calculator = self.request(CALCULATOR_URL)
        if 'id="load"' not in calculator:
            raise RuntimeError("MYGIFT login did not reach calculator page.")

    def request(self, url: str, data: bytes | None = None) -> str:
        last_error: Exception | None = None
        for attempt in range(1, self.retries + 2):
            try:
                request = urllib.request.Request(url, data=data, method="POST" if data is not None else "GET")
                with self.opener.open(request, timeout=self.timeout) as response:
                    return response.read().decode("utf-8", errors="replace")
            except (urllib.error.URLError, TimeoutError) as error:
                last_error = error
                if attempt > self.retries:
                    break
                time.sleep(min(2 * attempt, 10))
        raise RuntimeError(f"Request failed for {url}: {last_error}")

    def get_series_codes(self) -> list[str]:
        html = self.request(CALCULATOR_URL)
        parser = SelectOptionsParser("load")
        parser.feed(html)
        parser.close()
        return [value for value, _text in parser.options if value]

    def scrape_series(self, series_code: str) -> SeriesResult:
        step2_url = f"{BASE_URL}/step2.php?{urllib.parse.urlencode({'itemgroup': series_code})}"
        step2_html = self.request(step2_url)
        decoration_methods = parse_decoration_methods(step2_html)

        step3_url = f"{BASE_URL}/step3.php?{urllib.parse.urlencode({'ItemGroup': series_code, 'PM': '', 'qty': '0', 'color': '1'})}"
        step3_html = self.request(step3_url)
        products = parse_products(series_code, decoration_methods, step3_html)
        return SeriesResult(series_code=series_code, decoration_methods=decoration_methods, products=products)


def parse_decoration_methods(html: str) -> list[str]:
    parser = SelectOptionsParser("load2")
    parser.feed(html)
    parser.close()
    methods = []
    seen: set[str] = set()
    for value, text in parser.options:
        method = normalize_space(value or text)
        if not method or method.lower().startswith("please select"):
            continue
        if method not in seen:
            methods.append(method)
            seen.add(method)
    return methods


def parse_products(series_code: str, decoration_methods: list[str], html: str) -> list[ProductRow]:
    parser = ProductTableParser()
    parser.feed(html)
    parser.close()

    products: list[ProductRow] = []
    for cells in parser.rows:
        if len(cells) < 5:
            continue
        item_code = normalize_space(cells[0]["text"] or "")
        if not item_code or item_code.lower() == "item code" or not item_code.startswith(series_code[:2]):
            continue

        price_text = cells[1]["text"] or ""
        description = normalize_space(cells[2]["text"] or "")
        image_url = normalize_space(cells[3]["image"] or "") or None
        stock_status = normalize_space(cells[4]["text"] or "")

        products.append(
            ProductRow(
                vendor=VENDOR,
                series_code=series_code,
                item_code=item_code,
                item_unit_price=parse_decimal(price_text),
                currency=parse_currency(price_text),
                description=description or None,
                image_url=image_url,
                stock_status=stock_status or None,
                stock_quantity=parse_stock_quantity(stock_status),
                decoration_methods=decoration_methods,
                raw_product={
                    "price_text": normalize_space(price_text),
                    "stock_text": stock_status,
                    "source": "step3",
                },
            )
        )
    return products


def request_json(
    *,
    method: str,
    url: str,
    service_key: str,
    payload: Any | None = None,
    timeout: int = 60,
    prefer: str = "return=representation",
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


class SupabaseImporter:
    def __init__(self, supabase_url: str, service_key: str, timeout: int = 60) -> None:
        self.supabase_url = supabase_url.rstrip("/")
        self.service_key = service_key
        self.timeout = timeout

    def create_run(self, run_type: str, series_count: int, metadata: dict[str, Any]) -> str:
        payload = {
            "vendor": VENDOR,
            "source_url": CALCULATOR_URL,
            "run_type": run_type,
            "status": "started",
            "series_count": series_count,
            "metadata": metadata,
        }
        status, body = request_json(
            method="POST",
            url=f"{self.supabase_url}/rest/v1/mygift_product_scrape_runs",
            service_key=self.service_key,
            payload=payload,
            timeout=self.timeout,
        )
        if status not in {200, 201}:
            raise RuntimeError(f"Failed to create scrape run: HTTP {status}: {body.decode('utf-8', errors='replace')}")
        rows = json.loads(body.decode("utf-8"))
        return rows[0]["id"]

    def insert_snapshots(self, run_id: str, products: list[ProductRow], scraped_at: str) -> None:
        rows = []
        for product in products:
            row = product_payload(product)
            row["scrape_run_id"] = run_id
            row["scraped_at"] = scraped_at
            rows.append(row)
        self._insert_batches("mygift_product_snapshots", rows)

    def upsert_products(self, products: list[ProductRow], scraped_at: str) -> None:
        rows = []
        for product in products:
            row = product_payload(product)
            row["is_active"] = True
            row["last_seen_at"] = scraped_at
            row["last_scraped_at"] = scraped_at
            row["missing_since_at"] = None
            row["updated_at"] = scraped_at
            rows.append(row)

        # categories/subcategories/first_seen_at are intentionally absent from
        # the payload so existing manual categorization and first-seen data stay.
        endpoint = (
            f"{self.supabase_url}/rest/v1/mygift_products"
            "?on_conflict=vendor,item_code&columns="
            "vendor,series_code,item_code,item_unit_price,currency,description,image_url,"
            "stock_status,stock_quantity,decoration_methods,raw_product,is_active,"
            "last_seen_at,last_scraped_at,missing_since_at,updated_at"
        )
        for batch in chunked(rows, 500):
            status, body = request_json(
                method="POST",
                url=endpoint,
                service_key=self.service_key,
                payload=batch,
                timeout=self.timeout,
                prefer="resolution=merge-duplicates,return=minimal",
            )
            if status not in {200, 201, 204}:
                raise RuntimeError(f"Failed to upsert products: HTTP {status}: {body.decode('utf-8', errors='replace')}")

    def fetch_active_item_codes(self) -> list[str]:
        offset = 0
        page_size = 1000
        item_codes: list[str] = []
        while True:
            url = (
                f"{self.supabase_url}/rest/v1/mygift_products"
                "?select=item_code"
                f"&vendor=eq.{urllib.parse.quote(VENDOR)}"
                "&is_active=eq.true"
                f"&order=item_code.asc&limit={page_size}&offset={offset}"
            )
            status, body = request_json(
                method="GET",
                url=url,
                service_key=self.service_key,
                timeout=self.timeout,
                prefer="return=representation",
            )
            if status != 200:
                raise RuntimeError(f"Failed to fetch active products: HTTP {status}: {body.decode('utf-8', errors='replace')}")
            rows = json.loads(body.decode("utf-8"))
            item_codes.extend(row["item_code"] for row in rows)
            if len(rows) < page_size:
                return item_codes
            offset += page_size

    def mark_missing_inactive(self, seen_item_codes: list[str], completed_at: str) -> int:
        active_codes = set(self.fetch_active_item_codes())
        missing_codes = sorted(active_codes - set(seen_item_codes))
        if not missing_codes:
            return 0

        payload = {
            "is_active": False,
            "missing_since_at": completed_at,
            "last_scraped_at": completed_at,
            "updated_at": completed_at,
        }
        updated_count = 0
        for batch in chunked_values(missing_codes, 300):
            in_filter = postgrest_in_filter(batch)
            url = (
                f"{self.supabase_url}/rest/v1/mygift_products"
                f"?vendor=eq.{urllib.parse.quote(VENDOR)}"
                f"&item_code=in.{in_filter}"
            )
            status, body = request_json(
                method="PATCH",
                url=url,
                service_key=self.service_key,
                payload=payload,
                timeout=self.timeout,
                prefer="return=representation",
            )
            if status not in {200, 204}:
                raise RuntimeError(f"Failed to mark missing products inactive: HTTP {status}: {body.decode('utf-8', errors='replace')}")
            updated_count += len(json.loads(body.decode("utf-8"))) if body else len(batch)
        return updated_count

    def complete_run(
        self,
        run_id: str,
        *,
        status_value: str,
        succeeded_series_count: int,
        failed_series: list[str],
        product_count: int,
        error_message: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        payload = {
            "status": status_value,
            "completed_at": utc_now_iso(),
            "succeeded_series_count": succeeded_series_count,
            "failed_series_count": len(failed_series),
            "product_count": product_count,
            "failed_series": failed_series,
            "error_message": error_message,
        }
        if metadata is not None:
            payload["metadata"] = metadata
        status, body = request_json(
            method="PATCH",
            url=f"{self.supabase_url}/rest/v1/mygift_product_scrape_runs?id=eq.{run_id}",
            service_key=self.service_key,
            payload=payload,
            timeout=self.timeout,
            prefer="return=minimal",
        )
        if status not in {200, 204}:
            raise RuntimeError(f"Failed to update scrape run: HTTP {status}: {body.decode('utf-8', errors='replace')}")

    def _insert_batches(self, table: str, rows: list[dict[str, Any]]) -> None:
        for batch in chunked(rows, 500):
            status, body = request_json(
                method="POST",
                url=f"{self.supabase_url}/rest/v1/{table}",
                service_key=self.service_key,
                payload=batch,
                timeout=self.timeout,
                prefer="return=minimal",
            )
            if status not in {200, 201, 204}:
                raise RuntimeError(f"Failed to insert {table}: HTTP {status}: {body.decode('utf-8', errors='replace')}")


def product_payload(product: ProductRow) -> dict[str, Any]:
    payload = asdict(product)
    if payload["item_unit_price"] is None:
        payload["item_unit_price"] = None
    return payload


def chunked(values: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def chunked_values(values: list[str], size: int) -> list[list[str]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def postgrest_in_filter(values: list[str]) -> str:
    quoted = ",".join(json.dumps(value) for value in values)
    return urllib.parse.quote(f"({quoted})", safe="(),\"")


def scrape_all(
    *,
    client: MygiftClient,
    requested_codes: list[str] | None,
    limit: int | None,
    delay_ms: int,
) -> tuple[list[SeriesResult], list[str], list[str]]:
    available_codes = client.get_series_codes()
    if requested_codes:
        available_set = set(available_codes)
        missing = [code for code in requested_codes if code not in available_set]
        if missing:
            raise RuntimeError(f"Requested series codes not present in portal: {', '.join(missing)}")
        codes = requested_codes
    else:
        codes = available_codes

    if limit is not None:
        codes = codes[:limit]

    results: list[SeriesResult] = []
    failures: list[str] = []
    for index, code in enumerate(codes, start=1):
        try:
            result = client.scrape_series(code)
            results.append(result)
            print(f"[{index}/{len(codes)}] {code}: {len(result.products)} products, {len(result.decoration_methods)} decoration methods")
        except Exception as error:
            failures.append(code)
            print(f"[{index}/{len(codes)}] {code}: failed: {error}", file=sys.stderr)
        if delay_ms > 0 and index < len(codes):
            time.sleep(delay_ms / 1000)
    return results, failures, codes


def print_summary(results: list[SeriesResult], failures: list[str], codes: list[str], committed: bool) -> None:
    products = [product for result in results for product in result.products]
    print("")
    print("MYGIFT scrape summary")
    print(f"  mode: {'commit' if committed else 'dry-run'}")
    print(f"  requested series: {len(codes)}")
    print(f"  succeeded series: {len(results)}")
    print(f"  failed series: {len(failures)}")
    print(f"  products: {len(products)}")
    if failures:
        print(f"  failures: {', '.join(failures[:20])}{'...' if len(failures) > 20 else ''}")
    for product in products[:5]:
        print(
            "  sample:",
            product.series_code,
            product.item_code,
            product.item_unit_price,
            product.stock_status,
            product.description or "",
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape MYGIFT products and optionally import them to Supabase.")
    parser.add_argument("--env", default=DEFAULT_ENV, help="Path to .env containing Supabase credentials.")
    parser.add_argument("--mygift-username", default=os.environ.get("MYGIFT_USERNAME"))
    parser.add_argument("--mygift-password", default=os.environ.get("MYGIFT_PASSWORD"))
    parser.add_argument("--codes", help="Comma-separated series codes to scrape, e.g. AM09,AM11.")
    parser.add_argument("--limit", type=int, help="Limit the number of series codes scraped from the portal list.")
    parser.add_argument("--delay-ms", type=int, default=300)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--commit", action="store_true", help="Write results to Supabase. Default is dry-run.")
    parser.add_argument(
        "--allow-non-service-key",
        action="store_true",
        help="Allow --commit with a non-service-role key. Use only for controlled maintenance windows.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    env = {**load_env_file(Path(args.env)), **os.environ}
    supabase_url = env.get("SUPABASE_URL")
    service_key = env.get("SUPABASE_SERVICE_KEY")

    if not args.mygift_username or not args.mygift_password:
        raise RuntimeError("MYGIFT credentials are required via --mygift-username/--mygift-password or MYGIFT_USERNAME/MYGIFT_PASSWORD.")
    if args.commit and (not supabase_url or not service_key):
        raise RuntimeError(f"SUPABASE_URL and SUPABASE_SERVICE_KEY are required in {args.env} or environment for --commit.")
    if args.commit and service_key and jwt_role(service_key) != "service_role" and not args.allow_non_service_key:
        raise RuntimeError(
            "SUPABASE_SERVICE_KEY is not a service_role key. Refusing --commit before scraping. "
            "Use a real Supabase service role key, or pass --allow-non-service-key only during a controlled maintenance window."
        )

    requested_codes = [normalize_space(code).upper() for code in args.codes.split(",")] if args.codes else None
    run_type = "partial" if requested_codes or args.limit else "full"

    client = MygiftClient(args.mygift_username, args.mygift_password, args.timeout, args.retries)
    client.login()
    results, failures, codes = scrape_all(
        client=client,
        requested_codes=requested_codes,
        limit=args.limit,
        delay_ms=args.delay_ms,
    )
    products = [product for result in results for product in result.products]
    print_summary(results, failures, codes, args.commit)

    if failures and run_type == "full":
        raise RuntimeError("Full scrape had failed series; aborting before Supabase writes.")
    if not args.commit:
        return

    assert supabase_url is not None
    assert service_key is not None
    importer = SupabaseImporter(supabase_url, service_key, timeout=max(args.timeout, 60))
    metadata: dict[str, Any] = {
        "delay_ms": args.delay_ms,
        "timeout": args.timeout,
        "retries": args.retries,
        "requested_codes": requested_codes,
        "limit": args.limit,
    }
    run_id = importer.create_run(run_type, len(codes), metadata)
    try:
        scraped_at = utc_now_iso()
        importer.insert_snapshots(run_id, products, scraped_at)
        importer.upsert_products(products, scraped_at)
        inactive_count = 0
        if run_type == "full":
            inactive_count = importer.mark_missing_inactive([product.item_code for product in products], utc_now_iso())
        metadata["inactive_marked_count"] = inactive_count
        importer.complete_run(
            run_id,
            status_value="succeeded",
            succeeded_series_count=len(results),
            failed_series=failures,
            product_count=len(products),
            metadata=metadata,
        )
        print(f"Committed scrape run {run_id}; inserted {len(products)} snapshots and upserted latest products.")
        if run_type == "full":
            print(f"Marked {inactive_count} previously active products inactive.")
    except Exception as error:
        importer.complete_run(
            run_id,
            status_value="failed",
            succeeded_series_count=len(results),
            failed_series=failures,
            product_count=len(products),
            error_message=str(error),
            metadata=metadata,
        )
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
