import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.core import config
from backend.app.main import app
from backend.app.services.case_validation import REQUIRED_FILES

CASOS_DIR = Path(__file__).resolve().parents[2] / "casos"

client = TestClient(app)


@pytest.fixture
def case_id(tmp_path, monkeypatch):
    storage_dir = tmp_path / "cases"
    monkeypatch.setattr(config, "STORAGE_DIR", storage_dir)
    monkeypatch.setattr("backend.app.services.case_storage.STORAGE_DIR", storage_dir)
    cid = "a" * 32
    target = storage_dir / cid
    target.mkdir(parents=True)
    for name in REQUIRED_FILES:
        shutil.copy(CASOS_DIR / "caso_1s1p" / f"{name}.csv", target / f"{name}.csv")
    return cid


def _alta(**overrides):
    body = {
        "tipo": "alta",
        "codigo": "9999",
        "nombre": "UC Nueva",
        "inscriptos": 100,
        "trayectoria": [{"carrera": "civil", "semestre": 1}],
        "previas": ["1061"],
        "profesores": ["1062"],
        "coincidencias": [{"uc": "1030", "coincidencia": 12.5}],
    }
    body.update(overrides)
    return body


def test_catalog_and_detail(case_id):
    catalog = client.get(f"/api/cases/{case_id}/catalog").json()
    assert {"codigo": "1061", "nombre": "Calculo Dif. Integral en una variable"} in catalog["ucs"]
    assert {"codigo": "civil", "nombre": "Ingeniería Civil"} in catalog["carreras"]
    assert catalog["semestres"][:3] == [1, 2, 3]

    detail = client.get(f"/api/cases/{case_id}/ucs/1061").json()
    assert detail["nombre"] == "Calculo Dif. Integral en una variable"
    assert {"carrera": "civil", "semestre": 1} in detail["trayectoria"]
    assert "1062" in detail["profesores"]  # profesores.csv: 1061,1062
    assert detail["inscriptos"] > 0


def test_unknown_case_or_uc_is_404(case_id):
    assert client.get(f"/api/cases/{'b' * 32}/catalog").status_code == 404
    assert client.get("/api/cases/%2e%2e/catalog").status_code == 404
    assert client.get(f"/api/cases/{case_id}/ucs/NOPE").status_code == 404


def test_estimate_only_lists_ucs_sharing_career_and_semester(case_id):
    body = {"inscriptos": 100, "trayectoria": [{"carrera": "civil", "semestre": 1}]}
    estimates = client.post(f"/api/cases/{case_id}/estimate-coincidencia", json=body).json()
    by_uc = {e["uc"]: e["coincidencia"] for e in estimates}
    assert "1061" in by_uc  # civil, semestre 1 (trayectoria_sugerida.csv)
    assert all(v > 0 for v in by_uc.values())

    detail = client.get(f"/api/cases/{case_id}/ucs/1061").json()
    insc = detail["inscriptos"]
    assert by_uc["1061"] == round(0.30 * min(100, insc), 1)


def test_estimate_excludes_the_uc_being_modified(case_id):
    body = {"codigo": "1061", "inscriptos": 100, "trayectoria": [{"carrera": "civil", "semestre": 1}]}
    estimates = client.post(f"/api/cases/{case_id}/estimate-coincidencia", json=body).json()
    assert "1061" not in {e["uc"] for e in estimates}


def _put(case_id, *changes):
    return client.put(f"/api/cases/{case_id}/changes", json={"changes": list(changes)})


def test_put_valid_alta_saves_changes(case_id):
    r = _put(case_id, _alta(codigo=" 9999 "))
    assert r.status_code == 200
    assert r.json()["changes"][0]["codigo"] == "9999"
    from backend.app.services.case_storage import case_dir

    assert (case_dir(case_id) / "changes.json").exists()


def test_put_empty_list_is_valid(case_id):
    assert _put(case_id).status_code == 200


def test_put_valid_modificacion(case_id):
    detail = client.get(f"/api/cases/{case_id}/ucs/1061").json()
    body = {**detail, "tipo": "modificacion", "inscriptos": detail["inscriptos"] + 10}
    r = _put(case_id, body)
    assert r.status_code == 200, r.text


def test_several_changes_and_references_between_new_ucs(case_id):
    nueva_a = _alta(codigo="A1", nombre="A", previas=[], profesores=[], coincidencias=[])
    nueva_b = _alta(codigo="B1", nombre="B", previas=["A1"], profesores=[], coincidencias=[])
    detail = client.get(f"/api/cases/{case_id}/ucs/1061").json()
    modif = {**detail, "tipo": "modificacion"}
    assert _put(case_id, nueva_a, nueva_b, modif).status_code == 200


def test_issues_carry_the_index_of_the_offending_change(case_id):
    r = _put(case_id, _alta(), _alta(codigo="1061"))
    assert r.status_code == 422
    details = {(d["index"], d["field"]) for d in r.json()["details"]}
    assert (1, "codigo") in details
    assert all(index == 1 for index, _ in details)


def test_two_changes_on_the_same_uc_is_422(case_id):
    r = _put(case_id, _alta(), _alta())
    assert r.status_code == 422
    assert r.json()["details"][0]["index"] == 1


@pytest.mark.parametrize(
    "overrides, field",
    [
        ({"codigo": "1061"}, "codigo"),  # alta de una UC que ya existe
        ({"nombre": " "}, "nombre"),
        ({"trayectoria": []}, "trayectoria"),
        ({"trayectoria": [{"carrera": "zzz", "semestre": 1}]}, "trayectoria"),
        ({"trayectoria": [{"carrera": "civil", "semestre": 99}]}, "trayectoria"),
        ({"previas": ["NOPE"]}, "previas"),
        ({"profesores": ["9999"]}, "profesores"),  # se refiere a sí misma
        ({"coincidencias": [{"uc": "1030", "coincidencia": 1}, {"uc": "1030", "coincidencia": 2}]}, "coincidencias"),
    ],
)
def test_put_invalid_alta_returns_422(case_id, overrides, field):
    r = _put(case_id, _alta(**overrides))
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "change_validation_failed"
    assert field in {d["field"] for d in body["details"]}


def test_modificacion_of_unknown_uc_returns_422(case_id):
    r = _put(case_id, _alta(tipo="modificacion", codigo="NOPE"))
    assert r.status_code == 422
