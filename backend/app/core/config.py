import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]

STORAGE_DIR = Path(os.environ.get("CASES_STORAGE_DIR", PROJECT_ROOT / "storage" / "cases"))
