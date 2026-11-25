"""Aplicación menos restrictiva: el calendario vigente ya incumple una regla y
el modelo igual ubica los cambios, sin agregar incumplimientos nuevos.

Los primeros tests corren el modelo real (`solve.solve_model` con CBC, en casos
de 3 días y 3 UCs) porque lo que importa no es qué restricciones se escriben
sino qué calendario sale: la versión ingenua de esto —apagar la restricción—
también deja resolver el caso, pero además deja que las UCs que el modelo ubica
se sumen al incumplimiento. Por eso cada test chequea las dos cosas: que haya
solución, y que lo que el modelo ubicó no empeore nada.

Después van los tests del flujo (`POST /derive` + solve), que es donde la
opción se prende y se transporta hasta el solver.
"""

import json
import time

import pytest
from fastapi.testclient import TestClient

from backend.app.core import config
from backend.app.main import app
from backend.app.services import solver_jobs
from backend.app.services.case_storage import TOLERANCIA_FILENAME, case_dir
from backend.tests.test_jobs_api import _solve_payload
from constants import Solver
from solve import solve_model

client = TestClient(app)

# 3 días con un turno cada uno y 3 UCs. Con un solo turno por día, time_value
# es el día, así que la separación mínima de 2 se lee directo: días adyacentes
# están demasiado cerca y hacen falta 2 de diferencia.
_BASE = {
    "dias": "id\n1\n2\n3\n",
    "turnos": "id\n1\n",
    "turnos_dias": "id_dia,id_turno\n1,1\n2,1\n3,1\n",
    "unidades_curriculares": "codigo,descripcion\nA,UC A\nB,UC B\nC,UC C\n",
    "semestres": "id\n1\n2\n3\n",
    "carreras": "codigo,nombre\nK1,Carrera 1\n",
    "trayectoria_sugerida": "unidad_curricular,semestre,carrera\nA,1,K1\nB,2,K1\nC,3,K1\n",
    "preasignaciones": "unidad_curricular,dia,turno\n",
    "previas": "uc,uc_requerida\n",
    "profesores": "uc_1,uc_2\n",
    "capacidad": "id_dia,id_turno,capacidad\n1,1,100\n2,1,100\n3,1,100\n",
    "inscriptos": "uc,inscriptos\nA,5\nB,5\nC,5\n",
    "coincidencia": "uc_1,uc_2,coincidencia\n",
    "datos": "fac_cp,alta_co\n0.8,100\n",
}

# Las tres UCs en el mismo semestre y carrera: un único grupo que tiene que
# repartirse en días distintos.
_MISMO_SEMESTRE = "unidad_curricular,semestre,carrera\nA,1,K1\nB,1,K1\nC,1,K1\n"

# A pegada a B y a C: con alta_co=100, los dos pares necesitan 2 días de
# separación.
_ALTA_COINCIDENCIA = "uc_1,uc_2,coincidencia\nA,B,150\nA,C,150\n"

# Los dos casos relajados se corren con alpha=0 y beta alto, y C tiene previas
# con las UCs fijas, para que la función objetivo quiera ponerla justo encima
# del incumplimiento (el término de previas premia estar cerca, y con alpha=0
# nada la repele). Sin eso el test no probaría nada: el objetivo ya separa las
# UCs por su cuenta, así que C se iría lejos incluso con la restricción
# apagada, y la versión ingenua de relax_fixed pasaría igual.
_PREVIAS_A_LAS_FIJAS = "uc,uc_requerida\nC,A\nC,B\n"


def _case(tmp_path, **overrides):
    d = tmp_path / "caso"
    d.mkdir()
    for name, content in {**_BASE, **overrides}.items():
        (d / f"{name}.csv").write_text(content)
    return d


def _pre(*filas: tuple[str, int, int]) -> str:
    cuerpo = "".join(f"{uc},{dia},{turno}\n" for uc, dia, turno in filas)
    return "unidad_curricular,dia,turno\n" + cuerpo


def _resolver(case_path, relax_fixed, alpha=0.5, beta=0.5):
    value, _, status, variables, _, _ = solve_model(
        case_path,
        Solver.PULP_CBC_CMD,
        alpha=alpha,
        beta=beta,
        time_limit_minutes=1,
        relax_fixed=relax_fixed,
    )
    # {uc: día} leído de las x que el solver dejó en 1 (el nombre es x_{uc}_{día}_{turno}).
    dias = {
        v.name.rsplit("_", 2)[0][2:]: int(v.name.rsplit("_", 2)[1])
        for v in variables
        if v.name.startswith("x_") and v.varValue is not None and v.varValue > 0.5
    }
    return value, status, dias


# --- el modelo ---

def test_sin_relax_un_choque_de_semestre_entre_las_fijas_es_infactible(tmp_path):
    caso = _case(
        tmp_path,
        trayectoria_sugerida=_MISMO_SEMESTRE,
        preasignaciones=_pre(("A", 1, 1), ("B", 1, 1)),
    )
    assert _resolver(caso, relax_fixed=False)[1] == "Infeasible"


def test_relax_tolera_el_choque_de_semestre_y_no_deja_que_las_libres_lo_empeoren(tmp_path):
    caso = _case(
        tmp_path,
        trayectoria_sugerida=_MISMO_SEMESTRE,
        previas=_PREVIAS_A_LAS_FIJAS,
        preasignaciones=_pre(("A", 1, 1), ("B", 1, 1)),
    )
    value, status, dias = _resolver(caso, relax_fixed=True, alpha=0, beta=2)

    assert status == "Optimal" and value is not None
    # Lo que ya venía: A y B siguen juntas el día 1.
    assert dias["A"] == 1 and dias["B"] == 1
    # Lo que importa: C es del mismo grupo y el modelo la ubica, así que no
    # puede sumarse al día 1 aunque el objetivo la quiera ahí (tiene previas
    # con A y con B). El tope de ese día subió a 2, las dos forzadas, y no más:
    # apagar la restricción dejaría pasar C acá, y el día 2 es el mejor lugar
    # que le queda.
    assert dias["C"] == 2


def test_sin_relax_un_par_demasiado_cerca_entre_las_fijas_es_infactible(tmp_path):
    caso = _case(
        tmp_path,
        coincidencia=_ALTA_COINCIDENCIA,
        preasignaciones=_pre(("A", 1, 1), ("B", 2, 1)),
    )
    assert _resolver(caso, relax_fixed=False)[1] == "Infeasible"


def test_relax_tolera_el_par_demasiado_cerca_pero_lo_sigue_exigiendo_a_las_libres(tmp_path):
    caso = _case(
        tmp_path,
        coincidencia=_ALTA_COINCIDENCIA,
        previas=_PREVIAS_A_LAS_FIJAS,
        preasignaciones=_pre(("A", 1, 1), ("B", 2, 1)),
    )
    value, status, dias = _resolver(caso, relax_fixed=True, alpha=0, beta=2)

    assert status == "Optimal" and value is not None
    # A y B quedan a un día, como venían.
    assert dias["A"] == 1 and dias["B"] == 2
    # C también tiene mucha coincidencia con A y el objetivo la quiere pegada a
    # ella (tiene previas con A y con B), pero el modelo la ubica: la separación
    # de 2 días se le sigue exigiendo, así que el único día que le queda es el 3.
    assert dias["C"] == 3


def test_relax_no_cambia_el_resultado_cuando_las_fijas_son_consistentes(tmp_path):
    # El caso para el que la opción no está pensada: las preasignaciones no
    # fuerzan ninguna violación, así que ningún tope sube y ninguna familia se
    # saltea. Es lo que hace que prenderla no pueda degradar un caso sano.
    caso = _case(
        tmp_path,
        trayectoria_sugerida="unidad_curricular,semestre,carrera\nA,1,K1\nB,1,K1\nC,3,K1\n",
        coincidencia=_ALTA_COINCIDENCIA,
        preasignaciones=_pre(("A", 1, 1)),
    )
    estricto = _resolver(caso, relax_fixed=False)
    relajado = _resolver(caso, relax_fixed=True)

    assert estricto[1] == relajado[1] == "Optimal"
    assert estricto[0] == pytest.approx(relajado[0])
    assert estricto[2] == relajado[2]


# --- el flujo: POST /derive y el solve del caso derivado ---

@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    storage_dir = tmp_path / "cases"
    monkeypatch.setattr(config, "STORAGE_DIR", storage_dir)
    monkeypatch.setattr("backend.app.services.case_storage.STORAGE_DIR", storage_dir)
    monkeypatch.setattr(solver_jobs, "STORAGE_DIR", storage_dir)
    monkeypatch.setattr(solver_jobs, "_JOBS", {})
    return storage_dir


# A y B juntas el día 1 (el incumplimiento que trae la planilla), C el día 2.
_CALENDARIO = "Día/Turno,Turno 1\nDía 1,UC A (A) & UC B (B)\nDía 2,UC C (C)\nDía 3,\n"

_CAMBIO_C = {
    "tipo": "modificacion",
    "codigo": "C",
    "nombre": "UC C",
    "inscriptos": 7,
    "trayectoria": [{"carrera": "K1", "semestre": 1}],
    "previas": [],
    "profesores": [],
    "coincidencias": [],
}


def _caso_con_choque(storage, case_id="a" * 32, **overrides):
    """Caso cuyo calendario vigente pone A y B del mismo semestre el mismo día,
    con una modificación de C pendiente."""
    d = storage / case_id
    d.mkdir(parents=True)
    for name, content in {**_BASE, "trayectoria_sugerida": _MISMO_SEMESTRE, **overrides}.items():
        (d / f"{name}.csv").write_text(content)
    r = client.put(
        f"/api/cases/{case_id}/calendar",
        files={"file": ("cal.csv", _CALENDARIO.encode(), "text/csv")},
    )
    assert r.status_code == 200, r.text
    r = client.put(f"/api/cases/{case_id}/changes", json={"changes": [_CAMBIO_C]})
    assert r.status_code == 200, r.text
    return case_id


def _derive(case_id, tolerar=None):
    body = None if tolerar is None else {"tolerar_conflictos": tolerar}
    return client.post(f"/api/cases/{case_id}/derive", json=body)


def test_derive_rechaza_el_calendario_incumplidor_y_ofrece_la_opcion(isolated_storage):
    caso = _caso_con_choque(isolated_storage)
    r = _derive(caso)

    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "mismo día" in detail
    # Como lo único que incumple es tolerable, se le dice que tiene la opción.
    assert "Aplicación menos restrictiva" in detail


def test_derive_con_la_opcion_arma_el_caso_y_avisa_que_lo_tolerado_sigue_ahi(isolated_storage):
    caso = _caso_con_choque(isolated_storage)
    r = _derive(caso, tolerar=True)

    assert r.status_code == 201, r.text
    body = r.json()
    assert len(body["toleradas"]) == 1 and "mismo día" in body["toleradas"][0]
    assert any("menos restrictiva" in w for w in body["warnings"])

    # La marca queda en el caso derivado: es lo que hace que su solve corra
    # relajado, por más veces que se lo resuelva.
    marca = case_dir(body["derived_case_id"]) / TOLERANCIA_FILENAME
    assert json.loads(marca.read_text())["conflictos"] == body["toleradas"]


def test_un_incumplimiento_que_el_modelo_no_puede_tolerar_frena_igual(isolated_storage):
    # Capacidad: el día 1 tiene lugar para 4 (5 * fac_cp 0.8) y A + B llevan
    # 10 inscriptos. Aflojarlo no serviría, el modelo sería infactible de todas
    # formas, así que la opción no lo deja pasar ni lo ofrece.
    caso = _caso_con_choque(
        isolated_storage,
        trayectoria_sugerida=_BASE["trayectoria_sugerida"],
        capacidad="id_dia,id_turno,capacidad\n1,1,5\n2,1,100\n3,1,100\n",
    )
    for tolerar in (None, True):
        r = _derive(caso, tolerar=tolerar)
        assert r.status_code == 422
        assert "capacidad" in r.json()["detail"]
        assert "Aplicación menos restrictiva" not in r.json()["detail"]


def test_de_punta_a_punta_el_caso_tolerado_se_resuelve(isolated_storage):
    # Lo mismo que hace el usuario: calendario que ya incumple, cambio
    # pendiente, la opción marcada y resolver. Sin la opción esto no pasa de
    # /derive; con ella el solver tiene que devolver un calendario de verdad.
    caso = _caso_con_choque(isolated_storage)
    derived_id = _derive(caso, tolerar=True).json()["derived_case_id"]

    job_id = client.post(f"/api/cases/{derived_id}/solve", json=_solve_payload()).json()["job_id"]
    deadline = time.monotonic() + 60
    status = None
    while time.monotonic() < deadline:
        status = client.get(f"/api/jobs/{job_id}").json()
        if status["status"] in {"optimal", "timeout", "infeasible", "error"}:
            break
        time.sleep(0.1)

    assert status["status"] == "optimal", status
    grilla = client.get(f"/api/jobs/{job_id}/result").json()["schedule"]["grilla"]
    # La grilla etiqueta cada evaluación como "UC A (A)": alcanza el código.
    dia_de = {
        uc.rsplit("(", 1)[1].rstrip(")"): int(dia)
        for dia, turnos in grilla.items()
        for ucs in turnos.values()
        for uc in ucs
    }
    # A y B siguen juntas el día 1 (lo que se toleró) y C, que es la que el
    # modelo ubica, no se les suma.
    assert dia_de["A"] == 1 and dia_de["B"] == 1
    assert dia_de["C"] != 1


@pytest.mark.parametrize("tolerar,esperado", [(True, True), (None, False)])
def test_el_solve_del_caso_derivado_hereda_la_tolerancia(
    isolated_storage, monkeypatch, tolerar, esperado
):
    # Sin tolerancia el caso ni se arma (el calendario incumple), así que para
    # el caso de control se usa un calendario que sí cumple.
    overrides = {} if tolerar else {"trayectoria_sugerida": _BASE["trayectoria_sugerida"]}
    caso = _caso_con_choque(isolated_storage, **overrides)
    r = _derive(caso, tolerar=tolerar)
    assert r.status_code == 201, r.text
    derived_id = r.json()["derived_case_id"]

    capturado = {}

    def _fake_solve_model(*args, relax_fixed=False, **kwargs):
        capturado["relax_fixed"] = relax_fixed
        return (1.0, 0.01, "Optimal", [], {}, "Optimal Solution Found")

    monkeypatch.setattr(solver_jobs, "solve_model", _fake_solve_model)

    job_id = client.post(f"/api/cases/{derived_id}/solve", json=_solve_payload()).json()["job_id"]
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if client.get(f"/api/jobs/{job_id}").json()["status"] in {"optimal", "error"}:
            break
        time.sleep(0.05)

    assert capturado["relax_fixed"] is esperado
