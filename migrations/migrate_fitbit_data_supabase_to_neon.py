#!/usr/bin/env python3
"""Migrate Fitbit raw data from Supabase to Neon.

Usage:
    python migrations/migrate_fitbit_data_supabase_to_neon.py
"""

import json
import os
from urllib.parse import urlparse

import psycopg2
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

SUPABASE_URL = os.getenv('SUPABASE_DATABASE_URL')
NEON_URL = os.getenv('DATABASE_URL')

# (supabase_table, neon_table)
TABLES = [
    ('raw.fitbit__sleep',            'data_warehouse.raw_fitbit__sleep'),
    ('raw.fitbit__activity',         'data_warehouse.raw_fitbit__activity'),
    ('raw.fitbit__heart_rate',       'data_warehouse.raw_fitbit__heart_rate'),
    ('raw.fitbit__hrv',              'data_warehouse.raw_fitbit__hrv'),
    ('raw.fitbit__spo2',             'data_warehouse.raw_fitbit__spo2'),
    ('raw.fitbit__breathing_rate',   'data_warehouse.raw_fitbit__breathing_rate'),
    ('raw.fitbit__cardio_score',     'data_warehouse.raw_fitbit__cardio_score'),
    ('raw.fitbit__temperature_skin', 'data_warehouse.raw_fitbit__temperature_skin'),
]

BATCH_SIZE = 500


def migrate_table(src_cur, dst_conn, src_table: str, dst_table: str) -> int:
    src_cur.execute(f"SELECT count(*) FROM {src_table}")
    total = src_cur.fetchone()[0]
    print(f"\n{src_table} -> {dst_table}: {total} rows")

    if total == 0:
        return 0

    src_cur.execute(
        f"SELECT source_id, data, synced_at, api_version FROM {src_table} ORDER BY synced_at"
    )

    migrated = 0
    batch = []

    for row in src_cur:
        source_id, data, synced_at, api_version = row
        batch.append((source_id, json.dumps(data), synced_at, api_version))

        if len(batch) >= BATCH_SIZE:
            _insert_batch(dst_conn, dst_table, batch)
            migrated += len(batch)
            print(f"  {migrated}/{total}")
            batch = []

    if batch:
        _insert_batch(dst_conn, dst_table, batch)
        migrated += len(batch)
        print(f"  {migrated}/{total}")

    return migrated


def _insert_batch(conn, table: str, batch: list) -> None:
    with conn.cursor() as cur:
        args = []
        placeholders = []
        for source_id, data_json, synced_at, api_version in batch:
            placeholders.append("(%s, %s::jsonb, %s, %s)")
            args.extend([source_id, data_json, synced_at, api_version])

        sql = f"""
            INSERT INTO {table} (source_id, data, synced_at, api_version)
            VALUES {', '.join(placeholders)}
            ON CONFLICT (source_id) DO UPDATE SET
                data = EXCLUDED.data,
                synced_at = EXCLUDED.synced_at,
                api_version = EXCLUDED.api_version
        """
        cur.execute(sql, args)
    conn.commit()


def main():
    if not SUPABASE_URL:
        print("ERROR: SUPABASE_DATABASE_URL not set in .env")
        return
    if not NEON_URL:
        print("ERROR: DATABASE_URL not set in .env")
        return

    print(f"Source: {urlparse(SUPABASE_URL).hostname}")
    print(f"Dest:   {urlparse(NEON_URL).hostname}")
    print(f"Tables: {len(TABLES)}")

    src_conn = psycopg2.connect(SUPABASE_URL)
    dst_conn = psycopg2.connect(NEON_URL)

    try:
        src_cur = src_conn.cursor()
        total_migrated = 0

        for src_table, dst_table in TABLES:
            count = migrate_table(src_cur, dst_conn, src_table, dst_table)
            total_migrated += count

        print(f"\n{'='*60}")
        print(f"Migration complete: {total_migrated} total rows migrated")
        print(f"{'='*60}")
    finally:
        src_conn.close()
        dst_conn.close()


if __name__ == '__main__':
    main()
