import csv
import io
import shutil
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.core import config
from backend.app.main import app
from backend.app.services import solver_jobs
from backend.app.services.calendar_parser import CalendarParseError, parse_calendar_csv
from backend.app.services.case_storage import case_dir
from backend.app.services.case_validation import REQUIRED_FILES
from backend.tests.test_jobs_api import _TINY_CASE_FILES

CASOS_DIR = Path(__file__).resolve().parents[2] / "casos"
client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    storage_dir = tmp_path / "cases"
    monkeypatch.setattr(config, "STORAGE_DIR", storage_dir)
    monkeypatch.setattr("backend.app.services.case_storage.STORAGE_DIR", storage_dir)
    monkeypatch.setattr(solver_jobs, "STORAGE_DIR", storage_dir)
    monkeypatch.setattr(solver_jobs, "_JOBS", {})
    return storage_dir


def _write_case(storage, case_id, files):
    d = storage / case_id
    d.mkdir(parents=True)
    for name, content in files.items():
        (d / f"{name}.csv").write_text(content)
    return case_id


@pytest.fixture
def tiny(isolated_storage):
    return _write_case(isolated_storage, "a" * 32, _TINY_CASE_FILES)


@pytest.fixture
def real(isolated_storage):
    cid = "c" * 32
    d = isolated_storage / cid
    d.mkdir(parents=True)
    for name in REQUIRED_FILES:
        shutil.copy(CASOS_DIR / "caso_1s1p" / f"{name}.csv", d / f"{name}.csv")
    return cid


def _real_calendar(case_id) -> str:
    """Un calendario sintético para caso_1s1p: reparte las UCs en los slots."""
    d = case_dir(case_id)
    slots = list(csv.DictReader(open(d / "turnos_dias.csv")))
    ucs = [r["codigo"] for r in csv.DictReader(open(d / "unidades_curriculares.csv"))]
    grid: dict[tuple[str, str], list[str]] = {}
    for i, uc in enumerate(ucs):
        s = slots[i % len(slots)]
        grid.setdefault((s["id_dia"], s["id_turno"]), []).append(f"UC {uc} ({uc})")
    days = sorted({int(s["id_dia"]) for s in slots})
    turns = sorted({int(s["id_turno"]) for s in slots})
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Día/Turno"] + [f"Turno {t}" for t in turns])
    for day in range(1, max(days) + 1):
        w.writerow([f"Día {day}"] + [" & ".join(grid.get((str(day), str(t)), [])) for t in turns])
    return out.getvalue()


TINY_CALENDAR = "Día/Turno,Turno 1\nDía 1,UC A (A) & UC B (B)\nDía 2,UC C (C)\n"


def _put_calendar(case_id, text):
    return client.put(
        f"/api/cases/{case_id}/calendar", files={"file": ("cal.csv", text.encode(), "text/csv")}
    )


def _put_changes(case_id, *changes):
    r = client.put(f"/api/cases/{case_id}/changes", json={"changes": list(changes)})
    assert r.status_code == 200, r.text


def _alta(codigo="D", **kw):
    body = {
        "tipo": "alta", "codigo": codigo, "nombre": f"UC {codigo}", "inscriptos": 5,
        "trayectoria": [{"carrera": "K1", "semestre": 1}], "previas": [], "profesores": [],
        "coincidencias": [],
    }
    body.update(kw)
    return body


def _rows(case_id, name):
    return list(csv.DictReader(open(case_dir(case_id) / f"{name}.csv")))


# --- parser ---

def test_parser_reads_placements_and_rejects_duplicates():
    placements = parse_calendar_csv(
        'Día/Turno,Turno 1,Turno 2\nDía 1,"Mate (Q1), x (1025)" & Fis (1151),\nDía 2,,Log (1027)\n'
    )
    assert {(p.codigo, p.dia, p.turno) for p in placements} == {
        ("1025", 1, 1), ("1151", 1, 1), ("1027", 2, 2),
    }
    with pytest.raises(CalendarParseError, match="más de una vez"):
        parse_calendar_csv("Día/Turno,Turno 1\nDía 1,A (1)\nDía 2,B (1)\n")
    with pytest.raises(CalendarParseError):
        parse_calendar_csv("a,b\n1,2\n")


# --- PUT /calendar ---

def test_put_calendar_validates_against_the_case(tiny):
    assert _put_calendar(tiny, TINY_CALENDAR).json() == {"evaluaciones": 3}
    assert (case_dir(tiny) / "calendario.csv").exists()

    r = _put_calendar(tiny, "Día/Turno,Turno 1\nDía 1,UC Z (Z)\n")
    assert r.status_code == 422 and "Z" in r.json()["detail"]
    r = _put_calendar(tiny, "Día/Turno,Turno 1\nDía 9,UC A (A)\n")
    assert r.status_code == 422 and "Día 9 Turno 1" in r.json()["detail"]
    assert _put_calendar("f" * 32, TINY_CALENDAR).status_code == 404


# --- POST /derive ---

def test_derive_requires_calendar_and_changes(tiny):
    assert client.post(f"/api/cases/{tiny}/derive").status_code == 422
    _put_calendar(tiny, TINY_CALENDAR)
    r = client.post(f"/api/cases/{tiny}/derive")
    assert r.status_code == 422 and "cambios" in r.json()["detail"]
    _put_changes(tiny)
    assert client.post(f"/api/cases/{tiny}/derive").status_code == 422  # lista vacía


def test_derive_fixes_unchanged_ucs_and_frees_changed_ones(real):
    _put_calendar(real, _real_calendar(real))
    detail = client.get(f"/api/cases/{real}/ucs/1061").json()
    modif = {**detail, "tipo": "modificacion", "inscriptos": 999, "previas": [], "profesores": [],
             "coincidencias": [{"uc": "1030", "coincidencia": 12.5}]}
    _put_changes(real, modif, _alta("9999", previas=["1061"], profesores=["1062"],
                                    trayectoria=[{"carrera": "civil", "semestre": 1}],
                                    coincidencias=[{"uc": "1030", "coincidencia": 3}]))

    r = client.post(f"/api/cases/{real}/derive")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["free_ucs"] == ["1061", "9999"]
    derived = body["derived_case_id"]
    assert derived != real

    total = len(_rows(real, "unidades_curriculares"))
    pa = _rows(derived, "preasignaciones")
    assert body["fixed_ucs"] == len(pa) == total - 1  # todas menos la modificada; la alta no estaba
    assert {r["unidad_curricular"] for r in pa}.isdisjoint({"1061", "9999"})
    assert len({r["unidad_curricular"] for r in pa}) == len(pa)  # un único slot por UC

    assert any(r["codigo"] == "9999" for r in _rows(derived, "unidades_curriculares"))
    assert [r["inscriptos"] for r in _rows(derived, "inscriptos") if r["uc"] == "1061"] == ["999"]
    assert [r["inscriptos"] for r in _rows(derived, "inscriptos") if r["uc"] == "9999"] == ["5"]
    assert not [r for r in _rows(derived, "previas") if r["uc"] == "1061"]
    assert {r["uc_requerida"] for r in _rows(derived, "previas") if r["uc"] == "9999"} == {"1061"}
    pairs = [(r["uc_1"], r["uc_2"], r["coincidencia"]) for r in _rows(derived, "coincidencia")
             if "1061" in (r["uc_1"], r["uc_2"]) or "9999" in (r["uc_1"], r["uc_2"])]
    assert sorted(pairs) == [("1061", "1030", "12.5"), ("9999", "1030", "3")]
    assert [(r["uc_1"], r["uc_2"]) for r in _rows(derived, "profesores")
            if "9999" in (r["uc_1"], r["uc_2"])] == [("9999", "1062")]
    assert not [r for r in _rows(derived, "profesores") if "1061" in (r["uc_1"], r["uc_2"])]
    assert {(r["semestre"], r["carrera"]) for r in _rows(derived, "trayectoria_sugerida")
            if r["unidad_curricular"] == "9999"} == {("1", "civil")}
    # el caso base no se toca
    assert not [r for r in _rows(real, "inscriptos") if r["uc"] == "9999"]


def test_derive_warns_about_ucs_missing_from_the_calendar(tiny):
    _put_calendar(tiny, "Día/Turno,Turno 1\nDía 1,UC A (A) & UC B (B)\n")
    _put_changes(tiny, _alta("D"))
    body = client.post(f"/api/cases/{tiny}/derive").json()
    assert body["fixed_ucs"] == 2
    assert any("C" in w for w in body["warnings"])


# --- de punta a punta: derivar y resolver ---

def test_derived_case_solves_keeping_the_fixed_ucs_in_place(tiny):
    _put_calendar(tiny, TINY_CALENDAR)
    _put_changes(tiny, _alta("D", trayectoria=[{"carrera": "K1", "semestre": 3}]))
    derived = client.post(f"/api/cases/{tiny}/derive").json()["derived_case_id"]

    job = client.post(
        f"/api/cases/{derived}/solve",
        json={"alpha": 0.5, "beta": 0.5, "solver": "PULP_CBC_CMD", "time_limit_minutes": 1,
              "nombre_corrida": "edicion"},
    ).json()["job_id"]
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        status = client.get(f"/api/jobs/{job}").json()["status"]
        if status in {"optimal", "infeasible", "error", "timeout"}:
            break
        time.sleep(0.2)
    assert status == "optimal"

    grilla = client.get(f"/api/jobs/{job}/result").json()["schedule"]["grilla"]
    assert set(grilla["1"]["1"]) >= {"UC A (A)", "UC B (B)"}
    assert "UC C (C)" in grilla["2"]["1"]
    placed = {uc for day in grilla.values() for turn in day.values() for uc in turn}
    assert "UC D (D)" in placed
