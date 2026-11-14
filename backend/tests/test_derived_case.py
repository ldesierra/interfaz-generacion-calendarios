import csv
import io
import shutil
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.core import config
from backend.app.main import app
from backend.app.services import feasibility, solver_jobs
from backend.app.services.calendar_parser import (
    CalendarParseError,
    is_legacy_calendar,
    parse_calendar_csv,
    parse_legacy_calendar_csv,
)
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


# --- parser de la planilla vieja ---

# Columnas = días, filas = (carrera, semestre); la misma evaluación se repite
# en cada carrera que la tiene y una celda puede listar varias con "/".
TINY_PLANILLA = (
    ",,10/4,11/4\n"
    ",Semestre,Día 1,Día 2\n"
    "Carrera 1,Primero,UC A / UC B,UC C\n"
    ",Tercero,uc a,Otra cosa\n"
)


def test_legacy_parser_dedupes_names_and_splits_cells():
    assert is_legacy_calendar(TINY_PLANILLA)
    assert not is_legacy_calendar(TINY_CALENDAR)

    planilla = parse_legacy_calendar_csv(TINY_PLANILLA)
    assert planilla.columnas == 2
    # "UC A" y "uc a" son la misma evaluación del mismo día: queda una sola.
    assert [(e.nombre, e.columna) for e in planilla.entradas] == [
        ("UC A", 0), ("UC B", 0), ("UC C", 1), ("Otra cosa", 1),
    ]


def test_put_calendar_accepts_the_legacy_spreadsheet(tiny):
    body = _put_calendar(tiny, TINY_PLANILLA).json()
    assert body["formato"] == "viejo"
    assert body["evaluaciones"] == 3
    # La planilla no dice el turno: sólo el día.
    assert body["ubicaciones"] == [
        {"codigo": "A", "nombre": "UC A", "dia": 1, "turno": None},
        {"codigo": "B", "nombre": "UC B", "dia": 1, "turno": None},
        {"codigo": "C", "nombre": "UC C", "dia": 2, "turno": None},
    ]
    assert body["desconocidas"] == ["Otra cosa"]


def test_legacy_calendar_maps_day_columns_by_position(tiny, isolated_storage):
    # Los ids de dias.csv no tienen por qué ser 1..N: la N-ésima columna "Día"
    # es el N-ésimo día del caso.
    (isolated_storage / tiny / "dias.csv").write_text("id\n4\n7\n")
    (isolated_storage / tiny / "turnos_dias.csv").write_text("id_dia,id_turno\n4,1\n7,1\n")
    body = _put_calendar(tiny, TINY_PLANILLA).json()
    assert [(u["codigo"], u["dia"]) for u in body["ubicaciones"]] == [("A", 4), ("B", 4), ("C", 7)]


def test_legacy_calendar_rejects_mismatched_days_and_repeated_ucs(tiny):
    r = _put_calendar(tiny, ",Semestre,Día 1\nCarrera 1,Primero,UC A\n")
    assert r.status_code == 422 and "columnas de día" in r.json()["detail"]

    r = _put_calendar(tiny, ",Semestre,Día 1,Día 2\nCarrera 1,Primero,UC A,UC A\n")
    assert r.status_code == 422 and "más de un día" in r.json()["detail"]

    r = _put_calendar(tiny, ",Semestre,Día 1,Día 2\nCarrera 1,Primero,Otra cosa,\n")
    assert r.status_code == 422 and "Ninguna evaluación" in r.json()["detail"]


def test_legacy_names_resolve_through_the_spreadsheet_aliases(real):
    # La planilla usa abreviaturas que no se parecen al nombre del catálogo
    # ("GAL 2", "CDIV") y varias formas del mismo nombre, todas la misma UC.
    # caso_1s1p tiene 10 días (ids 1,3,4,6,7,8,10,11,12,13).
    planilla = (
        ",Semestre," + ",".join(f"Día {i}" for i in range(1, 11)) + "\n"
        "Eléctrica,Primero,GAL 2,GAL 1,,CDIV/ CDIVV,Intro. Invest. De Operaciones,AGPI,"
        ",,Mat disc 1,Fenómenos de Transporte\n"
        "Civil,Primero,,,,,Intro. A la investigación de Operaciones,,,,,\n"
    )
    body = _put_calendar(real, planilla).json()
    assert body["desconocidas"] == []
    assert [(u["codigo"], u["dia"]) for u in body["ubicaciones"]] == [
        ("1031", 1), ("1030", 3), ("1061", 6), ("1062", 6), ("1650", 7),
        ("1944", 8), ("1023", 12), ("Q22", 13),
    ]


def test_derive_detects_conflicts_between_ucs_fixed_only_by_day(isolated_storage):
    # Sin turno el modelo igual no puede separar dos UCs del mismo semestre y
    # carrera puestas el mismo día, ni acercar un par de coincidencia alta: se
    # avisa antes de correr un solve que no puede salir bien.
    files = {**_TINY_CASE_FILES,
             "trayectoria_sugerida": "unidad_curricular,semestre,carrera\nA,1,K1\nB,1,K1\nC,3,K1\n",
             "coincidencia": "uc_1,uc_2,coincidencia\nA,C,150\n"}
    case = _write_case(isolated_storage, "b" * 32, files)
    _put_calendar(case, TINY_PLANILLA)
    _put_changes(case, _alta("D", trayectoria=[{"carrera": "K1", "semestre": 3}]))

    r = client.post(f"/api/cases/{case}/derive")
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "mismo día (Día 1)" in detail
    assert "Día 1" in detail and "Día 2" in detail and "días de separación" in detail


def test_derive_fixes_legacy_ucs_to_the_whole_day(isolated_storage):
    # Día 1 con dos turnos: una UC fijada sólo por día queda preasignada a los
    # dos, y el modelo elige el turno.
    files = {**_TINY_CASE_FILES,
             "turnos": "id\n1\n2\n",
             "turnos_dias": "id_dia,id_turno\n1,1\n1,2\n2,1\n",
             "capacidad": "id_dia,id_turno,capacidad\n1,1,100\n1,2,100\n2,1,100\n"}
    case = _write_case(isolated_storage, "b" * 32, files)
    _put_calendar(case, TINY_PLANILLA)
    _put_changes(case, _alta("D", trayectoria=[{"carrera": "K1", "semestre": 3}]))

    body = client.post(f"/api/cases/{case}/derive").json()
    assert body["fixed_ucs"] == 3
    assert any("Otra cosa" in w for w in body["warnings"])
    pa = _rows(body["derived_case_id"], "preasignaciones")
    assert [(r["unidad_curricular"], r["dia"], r["turno"]) for r in pa] == [
        ("A", "1", "1"), ("A", "1", "2"), ("B", "1", "1"), ("B", "1", "2"), ("C", "2", "1"),
    ]

# --- PUT /calendar ---

def test_put_calendar_validates_against_the_case(tiny):
    body = _put_calendar(tiny, TINY_CALENDAR).json()
    assert body["evaluaciones"] == 3 and body["formato"] == "generado" and body["desconocidas"] == []
    assert body["ubicaciones"][0] == {"codigo": "A", "nombre": "UC A", "dia": 1, "turno": 1}
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


def test_derive_fixes_unchanged_ucs_and_frees_changed_ones(real, monkeypatch):
    # El calendario sintético (round-robin) no respeta las restricciones del
    # caso; acá sólo interesa qué se escribe, no la factibilidad (ver más abajo).
    monkeypatch.setattr(feasibility, "fixed_conflict_report", lambda path: [])
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


# --- subtarea 5: infactibilidad ---

def _two_uc_case(isolated_storage, case_id="e" * 32):
    """A y B del mismo semestre/carrera (días distintos), 2 días × 1 turno."""
    files = dict(_TINY_CASE_FILES)
    files["unidades_curriculares"] = "codigo,descripcion\nA,UC A\nB,UC B\n"
    files["trayectoria_sugerida"] = "unidad_curricular,semestre,carrera\nA,1,K1\nB,1,K1\n"
    files["inscriptos"] = "uc,inscriptos\nA,5\nB,5\n"
    return _write_case(isolated_storage, case_id, files)


def test_derive_is_blocked_when_the_current_calendar_already_breaks_constraints(isolated_storage):
    case = _two_uc_case(isolated_storage)
    _put_calendar(case, "Día/Turno,Turno 1\nDía 1,UC A (A) & UC B (B)\n")  # mismo día
    _put_changes(case, _alta("D"))
    before = set(isolated_storage.iterdir())

    r = client.post(f"/api/cases/{case}/derive")

    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "calendario vigente ya incumple" in detail
    assert "UC A (A) y UC B (B) son del mismo semestre y carrera" in detail
    assert set(isolated_storage.iterdir()) == before  # no queda un caso derivado a medias


def test_infeasible_job_explains_which_uc_has_no_slot_left(isolated_storage):
    case = _two_uc_case(isolated_storage)
    _put_calendar(case, "Día/Turno,Turno 1\nDía 1,UC A (A)\nDía 2,UC B (B)\n")
    # D es del mismo semestre/carrera que A y B: cada día ya tiene a una de las dos.
    _put_changes(case, _alta("D"))
    derived = client.post(f"/api/cases/{case}/derive").json()["derived_case_id"]

    job = client.post(
        f"/api/cases/{derived}/solve",
        json={"alpha": 0.5, "beta": 0.5, "solver": "PULP_CBC_CMD", "time_limit_minutes": 1,
              "nombre_corrida": "x"},
    ).json()["job_id"]
    deadline = time.monotonic() + 30
    while client.get(f"/api/jobs/{job}").json()["status"] in {"pending", "running"}:
        assert time.monotonic() < deadline
        time.sleep(0.2)

    result = client.get(f"/api/jobs/{job}/result").json()
    assert result["status"] == "infeasible"
    reasons = result["infeasibility_reasons"]
    assert len(reasons) == 1
    assert "No hay ningún día/turno posible para UC D (D)" in reasons[0]
    assert "mismo semestre y carrera" in reasons[0] and "UC A" in reasons[0]


def test_diagnose_flags_capacity_and_close_pairs(isolated_storage):
    files = dict(_TINY_CASE_FILES)
    files["inscriptos"] = "uc,inscriptos\nA,90\nB,90\nC,5\n"  # capacidad 100 * 0.8 = 80
    files["coincidencia"] = "uc_1,uc_2,coincidencia\nA,C,150\n"  # >= alta_co (100)
    files["preasignaciones"] = "unidad_curricular,dia,turno\nA,1,1\nB,2,1\nC,2,1\n"
    case = _write_case(isolated_storage, "f" * 32, files)
    messages = feasibility.diagnose(case_dir(case))
    text = "\n".join(messages)
    assert "supera la capacidad" in text
    assert "demasiado cerca" in text


def test_derive_restricts_a_changed_uc_to_the_chosen_days(isolated_storage):
    # Elegir días no deja la UC libre: se le preasignan todos los turnos de
    # esos días, así el modelo la ubica ahí adentro y no en cualquier lado.
    files = {**_TINY_CASE_FILES,
             "turnos": "id\n1\n2\n",
             "turnos_dias": "id_dia,id_turno\n1,1\n1,2\n2,1\n2,2\n",
             "capacidad": "id_dia,id_turno,capacidad\n1,1,100\n1,2,100\n2,1,100\n2,2,100\n"}
    case = _write_case(isolated_storage, "b" * 32, files)
    _put_calendar(case, TINY_CALENDAR)
    _put_changes(case, _alta("D", dias=[2]))

    body = client.post(f"/api/cases/{case}/derive").json()
    pa = {(r["unidad_curricular"], r["dia"], r["turno"]) for r in _rows(body["derived_case_id"], "preasignaciones")}
    # Las 3 del calendario siguen clavadas a su slot...
    assert {("A", "1", "1"), ("B", "1", "1"), ("C", "2", "1")} <= pa
    # ...y la nueva queda con los dos turnos del Día 2 y ninguno del Día 1.
    assert {s for s in pa if s[0] == "D"} == {("D", "2", "1"), ("D", "2", "2")}


def test_derive_without_chosen_days_leaves_the_uc_free(isolated_storage):
    # El default no cambia: sin días, la UC afectada no aparece en preasignaciones.
    case = _write_case(isolated_storage, "b" * 32, _TINY_CASE_FILES)
    _put_calendar(case, TINY_CALENDAR)
    _put_changes(case, _alta("D"))

    body = client.post(f"/api/cases/{case}/derive").json()
    pa = _rows(body["derived_case_id"], "preasignaciones")
    assert all(r["unidad_curricular"] != "D" for r in pa)


def test_changes_reject_days_outside_the_case(tiny):
    r = client.put(f"/api/cases/{tiny}/changes", json={"changes": [_alta("D", dias=[9])]})
    assert r.status_code == 422
    assert {"index": 0, "field": "dias", "issue": "el día '9' no existe en el caso o no tiene turnos"} in (
        r.json()["details"]
    )

    r = client.put(f"/api/cases/{tiny}/changes", json={"changes": [_alta("D", dias=[1, 1])]})
    assert r.status_code == 422
    assert any(d["issue"] == "hay días repetidos" for d in r.json()["details"])


def test_catalog_lists_the_days_that_have_turns(isolated_storage):
    # El form necesita los días para ofrecerlos; un día sin turnos no sirve.
    files = {**_TINY_CASE_FILES,
             "dias": "id\n1\n2\n5\n",
             "turnos_dias": "id_dia,id_turno\n1,1\n2,1\n"}
    case = _write_case(isolated_storage, "c" * 32, files)
    assert client.get(f"/api/cases/{case}/catalog").json()["dias"] == [1, 2]
