#!/usr/bin/env python3
"""Run dbt with environment variables loaded from .env file.

Usage:
    python apps/transform/scripts/run_dbt.py seed
    python apps/transform/scripts/run_dbt.py run
    python apps/transform/scripts/run_dbt.py test
    python apps/transform/scripts/run_dbt.py run --select staging.toggl_track
"""

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv


def setup_env() -> Path:
    """Setup environment variables and return transform dir path."""
    os.environ["PYTHONUTF8"] = "1"

    script_dir = Path(__file__).parent
    transform_dir = script_dir.parent
    project_root = transform_dir.parent.parent

    # Load .env from project root
    load_dotenv(project_root / ".env")

    # Parse DATABASE_URL into NEON_* vars if not already set
    if not os.getenv("NEON_HOST"):
        database_url = os.getenv("DATABASE_URL")
        if database_url:
            parsed = urlparse(database_url)
            os.environ["NEON_HOST"] = parsed.hostname or ""
            os.environ["NEON_USER"] = parsed.username or ""
            os.environ["NEON_PASSWORD"] = parsed.password or ""
            os.environ["NEON_DB"] = parsed.path.lstrip("/").split("?")[0] or "neondb"

    return transform_dir


def run_dbt(transform_dir: Path, args: list[str]) -> int:
    """Run dbt command and return exit code."""
    print(f"\n{'='*60}")
    print(f"Running: dbt {' '.join(args)}")
    print(f"Host: {os.environ.get('NEON_HOST')}")
    print(f"{'='*60}")

    result = subprocess.run(
        [sys.executable, "-c", "from dbt.cli.main import cli; cli()"] + args,
        cwd=transform_dir,
        env=os.environ,
    )
    return result.returncode


def main() -> None:
    transform_dir = setup_env()

    if len(sys.argv) < 2:
        print("Usage: python apps/transform/scripts/run_dbt.py <command> [args...]")
        print("")
        print("Commands:")
        print("  seed [args]    Load seed CSVs into database")
        print("  run [args]     Run dbt models")
        print("  test [args]    Run dbt tests")
        print("  debug          Test connection")
        sys.exit(1)

    dbt_args = sys.argv[1:]
    sys.exit(run_dbt(transform_dir, dbt_args))


if __name__ == "__main__":
    main()
