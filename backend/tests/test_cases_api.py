import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.core import config
from backend.app.main import app
from backend.app.services.case_validation import REQUIRED_FILES

CASOS_DIR = Path(__file__).resolve().parents[2] / "casos"

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    storage_dir = tmp_path / "cases"
    monkeypatch.setattr(config, "STORAGE_DIR", storage_dir)
    monkeypatch.setattr("backend.app.services.case_storage.STORAGE_DIR", storage_dir)
    yield storage_dir


def _case_files(case_name: str, overrides: dict | None = None):
    overrides = overrides or {}
    case_dir = CASOS_DIR / case_name
    files = {}
    for name in REQUIRED_FILES:
        if name in overrides:
            files[name] = (f"{name}.csv", overrides[name], "text/csv")
        else:
            files[name] = (
                f"{name}.csv",
                (case_dir / f"{name}.csv").read_bytes(),
                "text/csv",
            )
    return files


def test_create_case_with_valid_files_returns_201(isolated_storage):
    response = client.post("/api/cases", files=_case_files("caso_1s1p"))

    assert response.status_code == 201
    body = response.json()
    assert set(body["files_received"]) == set(REQUIRED_FILES)
    assert (isolated_storage / body["case_id"] / "capacidad.csv").exists()


def test_create_case_with_invalid_schema_returns_422(isolated_storage):
    response = client.post("/api/cases", files=_case_files("caso_sm"))

    assert response.status_code == 422
    body = response.json()
    assert body["error"] == "schema_validation_failed"
    assert body["details"] == [{"file": "datos", "issue": "falta la columna 'alta_co'"}]
    assert not list(isolated_storage.glob("*"))


def test_create_case_with_missing_file_returns_422(isolated_storage):
    files = _case_files("caso_1s1p")
    del files["capacidad"]

    response = client.post("/api/cases", files=files)

    assert response.status_code == 422
    body = response.json()
    assert {"file": "capacidad", "issue": "falta el archivo"} in body["details"]
