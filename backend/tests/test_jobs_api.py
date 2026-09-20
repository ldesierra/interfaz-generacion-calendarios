import time

import pytest
from fastapi.testclient import TestClient

from backend.app.core import config
from backend.app.main import app
from backend.app.services import solver_jobs

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    storage_dir = tmp_path / "cases"
    monkeypatch.setattr(config, "STORAGE_DIR", storage_dir)
    monkeypatch.setattr("backend.app.services.case_storage.STORAGE_DIR", storage_dir)
    monkeypatch.setattr(solver_jobs, "STORAGE_DIR", storage_dir)
    monkeypatch.setattr(solver_jobs, "_JOBS", {})
    yield storage_dir


# CSVs mínimos y sintéticos (no un caso real de `casos/`): 3 UC, 2 días,
# 1 turno por día, cada UC en un semestre distinto para no disparar la
# restricción de "días distintos" de UC_MISMO_SEMESTRE. El objetivo es que
# el MIP sea trivial (resuelve en <1s) para probar el ciclo de vida del
# job, no ejercitar el modelo en sí (eso ya lo cubre `casos/`).
_TINY_CASE_FILES = {
    "dias": "id\n1\n2\n",
    "turnos": "id\n1\n",
    "turnos_dias": "id_dia,id_turno\n1,1\n2,1\n",
    "unidades_curriculares": "codigo,descripcion\nA,UC A\nB,UC B\nC,UC C\n",
    "semestres": "id\n1\n2\n3\n",
    "carreras": "codigo,nombre\nK1,Carrera 1\n",
    "trayectoria_sugerida": "unidad_curricular,semestre,carrera\nA,1,K1\nB,2,K1\nC,3,K1\n",
    "preasignaciones": "unidad_curricular,dia,turno\n",
    "previas": "uc,uc_requerida\n",
    "profesores": "uc_1,uc_2\n",
    "capacidad": "id_dia,id_turno,capacidad\n1,1,100\n2,1,100\n",
    "inscriptos": "uc,inscriptos\nA,5\nB,5\nC,5\n",
    "coincidencia": "uc_1,uc_2,coincidencia\n",
    "datos": "fac_cp,alta_co\n0.8,100\n",
}


@pytest.fixture
def small_case(isolated_storage) -> str:
    case_id = "a" * 32  # case_dir espera un uuid4().hex real, ver is_valid_case_id
    case_dir = isolated_storage / case_id
    case_dir.mkdir(parents=True)
    for name, content in _TINY_CASE_FILES.items():
        (case_dir / f"{name}.csv").write_text(content)
    return case_id


def _solve_payload(**overrides):
    payload = {
        "alpha": 0.5,
        "beta": 0.5,
        "solver": "PULP_CBC_CMD",
        "time_limit_minutes": 1,
        "nombre_corrida": "corrida-1",
    }
    payload.update(overrides)
    return payload


def test_solve_unknown_case_returns_404():
    response = client.post("/api/cases/no-existe/solve", json=_solve_payload())

    assert response.status_code == 404


def test_solve_rejects_case_id_that_is_not_a_valid_uuid(isolated_storage):
    # case_id llega del cliente en la URL sin pasar por la validación de
    # POST /api/cases. "%2e%2e" decodifica a ".." y NO debería poder usarse
    # para resolver un path fuera de STORAGE_DIR (STORAGE_DIR.parent existe
    # siempre, así que sin validar el formato esto daría 202 en vez de 404).
    response = client.post("/api/cases/%2e%2e/solve", json=_solve_payload())

    assert response.status_code == 404


def test_solve_rejects_unsupported_solver(small_case):
    response = client.post(
        f"/api/cases/{small_case}/solve", json=_solve_payload(solver="GUROBI_CMD")
    )

    assert response.status_code == 422


def test_solve_rejects_empty_nombre_corrida(small_case):
    response = client.post(
        f"/api/cases/{small_case}/solve", json=_solve_payload(nombre_corrida="   ")
    )

    assert response.status_code == 422


def test_get_status_of_unknown_job_returns_404():
    response = client.get("/api/jobs/no-existe")

    assert response.status_code == 404


def test_solve_returns_202_and_job_can_be_polled(small_case):
    response = client.post(f"/api/cases/{small_case}/solve", json=_solve_payload())

    assert response.status_code == 202
    body = response.json()
    assert body["case_id"] == small_case
    # El solve corre en background: para un caso trivial como este puede
    # incluso terminar antes de que se arme esta respuesta.
    assert body["status"] in ("pending", "running", "optimal", "infeasible", "error")

    status_response = client.get(f"/api/jobs/{body['job_id']}")
    assert status_response.status_code == 200
    status_body = status_response.json()
    assert status_body["job_id"] == body["job_id"]
    assert status_body["case_id"] == small_case
    assert status_body["status"] in ("pending", "running", "optimal", "infeasible", "error")


def test_solve_job_runs_in_background_and_reaches_a_terminal_status(small_case):
    response = client.post(f"/api/cases/{small_case}/solve", json=_solve_payload())
    job_id = response.json()["job_id"]

    terminal_statuses = {"optimal", "infeasible", "error"}
    deadline = time.monotonic() + 20
    status_body = None
    while time.monotonic() < deadline:
        status_body = client.get(f"/api/jobs/{job_id}").json()
        if status_body["status"] in terminal_statuses:
            break
        time.sleep(0.2)

    assert status_body is not None
    # El caso sintético es trivialmente factible: si termina en otro estado
    # (infeasible/error) es un bug real, no falta de tiempo.
    assert status_body["status"] == "optimal", status_body
    assert status_body["elapsed_seconds"] is not None
    assert status_body["elapsed_seconds"] >= 0
    assert status_body["error_message"] is None
