#!/usr/bin/env python3
"""Migrate Fitbit OAuth2 credentials from Supabase Vault to Neon.

Usage:
    python migrations/migrate_fitbit_credentials.py
"""

import json
import os
from urllib.parse import urlparse

import psycopg2
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

SUPABASE_URL = os.getenv('SUPABASE_DATABASE_URL')
NEON_URL = os.getenv('DATABASE_URL')


def main():
    if not SUPABASE_URL or not NEON_URL:
        print("ERROR: SUPABASE_DATABASE_URL and DATABASE_URL must be set in .env")
        return

    print(f"Source: {urlparse(SUPABASE_URL).hostname}")
    print(f"Dest:   {urlparse(NEON_URL).hostname}")

    # 1. Read from Supabase Vault
    src_conn = psycopg2.connect(SUPABASE_URL)
    try:
        with src_conn.cursor() as cur:
            cur.execute(
                "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = %s",
                ('fitbit',)
            )
            row = cur.fetchone()
            if not row:
                print("ERROR: Fitbit credentials not found in Supabase Vault")
                return
            secret = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    finally:
        src_conn.close()

    print(f"Fitbit credentials loaded (user_id: {secret.get('user_id')})")
    print(f"  expires_at: {secret.get('_expires_at')}")
    print(f"  scope: {secret.get('scope', '')[:50]}...")

    # 2. Create table + insert into Neon
    dst_conn = psycopg2.connect(NEON_URL)
    try:
        with dst_conn.cursor() as cur:
            # Run migration SQL
            migration_sql = open(
                os.path.join(os.path.dirname(__file__), '002_create_oauth2_credentials.sql'),
                'r'
            ).read()
            cur.execute(migration_sql)

            # Insert credentials
            cur.execute("""
                INSERT INTO data_warehouse.oauth2_credentials
                    (service_name, client_id, client_secret, access_token, refresh_token,
                     token_type, expires_at, scope)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (service_name) DO UPDATE SET
                    client_id = EXCLUDED.client_id,
                    client_secret = EXCLUDED.client_secret,
                    access_token = EXCLUDED.access_token,
                    refresh_token = EXCLUDED.refresh_token,
                    expires_at = EXCLUDED.expires_at,
                    scope = EXCLUDED.scope,
                    updated_at = now()
            """, (
                'fitbit',
                secret.get('client_id', ''),
                secret.get('client_secret', ''),
                secret.get('access_token', ''),
                secret.get('refresh_token', ''),
                'Bearer',
                secret.get('_expires_at'),
                secret.get('scope', ''),
            ))
        dst_conn.commit()
        print("\nFitbit credentials migrated to Neon successfully!")
    finally:
        dst_conn.close()


if __name__ == '__main__':
    main()
