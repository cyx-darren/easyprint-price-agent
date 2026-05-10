#!/usr/bin/env python3
"""
Import MYGIFT charge rows into Supabase from the XLSX guide.

This complements generate_mygift_charges_seed.py. It uses the same parser and
reads SUPABASE_URL / SUPABASE_SERVICE_KEY from backend/.env by default.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from decimal import Decimal
from pathlib import Path

from generate_mygift_charges_seed import DEFAULT_INPUT, parse_workbook


DEFAULT_ENV = "backend/.env"


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def request_json(
    *,
    method: str,
    url: str,
    service_key: str,
    payload: object | None = None,
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
            "Prefer": "return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def to_jsonable(row: dict[str, object | None]) -> dict[str, object | None]:
    converted: dict[str, object | None] = {}
    for key, value in row.items():
        if isinstance(value, Decimal):
            converted[key] = float(value)
        else:
            converted[key] = value
    return converted


def existing_row_count(supabase_url: str, service_key: str) -> int:
    url = f"{supabase_url.rstrip('/')}/rest/v1/mygift_charges?select=id&limit=1"
    status, body = request_json(method="GET", url=url, service_key=service_key)
    if status != 200:
        raise RuntimeError(f"Failed to check existing rows: HTTP {status}: {body.decode('utf-8', errors='replace')}")
    return len(json.loads(body.decode("utf-8")))


def import_rows(supabase_url: str, service_key: str, rows: list[dict[str, object | None]]) -> None:
    endpoint = f"{supabase_url.rstrip('/')}/rest/v1/mygift_charges"
    payload = [to_jsonable(row) for row in rows]
    status, body = request_json(method="POST", url=endpoint, service_key=service_key, payload=payload)
    if status not in {200, 201, 204}:
        raise RuntimeError(f"Failed to insert MYGIFT rows: HTTP {status}: {body.decode('utf-8', errors='replace')}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import MYGIFT charge rows into Supabase.")
    parser.add_argument("xlsx", nargs="?", default=DEFAULT_INPUT)
    parser.add_argument("--env", default=DEFAULT_ENV)
    parser.add_argument("--force", action="store_true", help="Insert even if mygift_charges already has rows.")
    args = parser.parse_args()

    env = load_env(Path(args.env))
    supabase_url = env.get("SUPABASE_URL")
    service_key = env.get("SUPABASE_SERVICE_KEY")
    if not supabase_url or not service_key:
        raise RuntimeError(f"SUPABASE_URL and SUPABASE_SERVICE_KEY are required in {args.env}")

    rows = parse_workbook(Path(args.xlsx))
    if not args.force and existing_row_count(supabase_url, service_key) > 0:
        print("mygift_charges already has rows; skipping import. Use --force to insert anyway.")
        return

    import_rows(supabase_url, service_key, rows)
    print(f"Inserted {len(rows)} MYGIFT charge rows.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
