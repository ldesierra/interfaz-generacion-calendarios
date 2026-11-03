"""Armado del "caso derivado" para la edición incremental.

Parte del caso base (los 14 CSV subidos), el calendario vigente
(`calendario.csv`) y los cambios (`changes.json`) y escribe un caso nuevo
—con su propio `case_id`, así que se resuelve con el `POST /cases/{id}/solve`
de siempre— en el que:

* toda UC del calendario que no cambia queda **fija** en su día/turno
  (`preasignaciones.csv` con una única fila por UC; en el modelo una
  preasignación es el conjunto de slots permitidos, ver `solve.py`);
* las UCs afectadas por un cambio (altas y modificadas) quedan **libres**:
  sin preasignación, el modelo busca su mejor lugar;
* los datos de cada UC afectada (trayectoria, previas, profesores,
  inscriptos, coincidencia) se reemplazan por el estado final del cambio.
"""

import json
import shutil
import uuid
from collections import defaultdict
from dataclasses import dataclass, field

import pandas as pd

from backend.app.schemas.change import UcChange
from backend.app.services import feasibility, uc_change
from backend.app.services.calendar_parser import (
    CalendarParseError,
    LegacyCalendar,
    Placement,
    is_legacy_calendar,
    normalize_name,
    parse_calendar_csv,
    parse_legacy_calendar_csv,
)
from backend.app.services.case_storage import case_dir
from backend.app.services.case_validation import REQUIRED_FILES

CALENDAR_FILENAME = "calendario.csv"


class DerivedCaseError(Exception):
    """El caso derivado no se puede armar; el mensaje es para el usuario."""


@dataclass
class LoadedCalendar:
    """Calendario vigente ya resuelto contra el caso."""

    placements: list[Placement]
    formato: str  # "generado" | "viejo"
    # Formato viejo: nombres de la planilla que no son UCs del caso (p.ej.
    # materias de otro servicio). No se fijan, se avisan.
    desconocidas: list[str] = field(default_factory=list)


@dataclass
class DerivedCase:
    case_id: str
    fixed_ucs: int
    free_ucs: list[str]
    warnings: list[str] = field(default_factory=list)


def _read(case_id: str, name: str) -> pd.DataFrame:
    # dtype=str: se preserva el texto original de los CSV al reescribirlos.
    return pd.read_csv(case_dir(case_id) / f"{name}.csv", dtype=str, keep_default_na=False)


def _turnos_por_dia(case_id: str) -> dict[int, list[int]]:
    """Turnos habilitados de cada día, en el orden de `turnos_dias.csv`."""
    por_dia: dict[int, list[int]] = defaultdict(list)
    for _, r in _read(case_id, "turnos_dias").iterrows():
        por_dia[int(float(r["id_dia"]))].append(int(float(r["id_turno"])))
    return por_dia


def validate_calendar_for_case(case_id: str, placements: list[Placement]) -> None:
    """El calendario tiene que corresponder al caso: sus UCs, días y turnos
    existen en los datos subidos."""
    ucs = {uc.codigo for uc in uc_change.list_ucs(case_id)}
    por_dia = _turnos_por_dia(case_id)

    unknown = sorted({p.codigo for p in placements if p.codigo not in ucs})
    if unknown:
        raise DerivedCaseError(
            "El calendario tiene UCs que no están en las unidades curriculares del caso: "
            + ", ".join(unknown)
        )
    # Con `turno is None` (formato viejo) alcanza con que el día tenga turnos:
    # la UC queda fija al día y el modelo elige el turno.
    def _slot_invalido(p: Placement) -> bool:
        return not por_dia.get(p.dia) if p.turno is None else p.turno not in por_dia.get(p.dia, [])

    bad_slots = sorted(
        {f"Día {p.dia}" if p.turno is None else f"Día {p.dia} Turno {p.turno}"
         for p in placements
         if _slot_invalido(p)}
    )
    if bad_slots:
        raise DerivedCaseError(
            "El calendario usa días/turnos que no existen en el caso: " + ", ".join(bad_slots)
        )


def _dias(case_id: str) -> list[int]:
    return [int(float(v)) for v in _read(case_id, "dias")["id"]]


def _resolve_legacy(case_id: str, legacy: LegacyCalendar) -> LoadedCalendar:
    """Resuelve la planilla vieja contra el caso: columna N-ésima → N-ésimo día
    de `dias.csv`, nombre de la evaluación → código de la UC."""
    dias = _dias(case_id)
    if legacy.columnas != len(dias):
        raise DerivedCaseError(
            f"La planilla tiene {legacy.columnas} columnas de día y el caso tiene "
            f"{len(dias)}: no se pueden hacer corresponder."
        )

    por_nombre: dict[str, str] = {}
    for uc in uc_change.list_ucs(case_id):
        por_nombre.setdefault(normalize_name(uc.nombre), uc.codigo)

    placements: list[Placement] = []
    ubicadas: dict[str, int] = {}
    desconocidas: list[str] = []
    vistas: set[str] = set()
    for entrada in legacy.entradas:
        dia = dias[entrada.columna]
        codigo = por_nombre.get(normalize_name(entrada.nombre))
        if codigo is None:
            if normalize_name(entrada.nombre) not in vistas:
                vistas.add(normalize_name(entrada.nombre))
                desconocidas.append(entrada.nombre)
            continue
        if codigo in ubicadas:
            if ubicadas[codigo] != dia:
                raise DerivedCaseError(
                    f"La evaluación '{entrada.nombre}' ({codigo}) aparece en más de un día "
                    f"(Día {ubicadas[codigo]} y Día {dia})."
                )
            continue
        ubicadas[codigo] = dia
        placements.append(Placement(codigo=codigo, dia=dia, turno=None))

    if not placements:
        raise DerivedCaseError(
            "Ninguna evaluación de la planilla coincide con una unidad curricular del caso."
        )
    return LoadedCalendar(placements=placements, formato="viejo", desconocidas=desconocidas)


def load_calendar(case_id: str, text: str) -> LoadedCalendar:
    """Lee el calendario vigente en cualquiera de los dos formatos y lo valida
    contra el caso."""
    try:
        if is_legacy_calendar(text):
            loaded = _resolve_legacy(case_id, parse_legacy_calendar_csv(text))
        else:
            loaded = LoadedCalendar(placements=parse_calendar_csv(text), formato="generado")
    except CalendarParseError as exc:
        raise DerivedCaseError(str(exc)) from exc
    validate_calendar_for_case(case_id, loaded.placements)
    return loaded


def save_calendar(case_id: str, text: str) -> LoadedCalendar:
    loaded = load_calendar(case_id, text)
    (case_dir(case_id) / CALENDAR_FILENAME).write_text(text, encoding="utf-8")
    return loaded


def _without_rows(df: pd.DataFrame, mask: pd.Series) -> pd.DataFrame:
    return df[~mask]


def _append(df: pd.DataFrame, rows: list[dict]) -> pd.DataFrame:
    if not rows:
        return df
    return pd.concat([df, pd.DataFrame(rows, columns=df.columns).fillna("")], ignore_index=True)


def build_derived_case(case_id: str) -> DerivedCase:
    base = case_dir(case_id)
    if not (base / CALENDAR_FILENAME).is_file():
        raise DerivedCaseError("Falta cargar el calendario vigente.")
    if not (base / uc_change.CHANGES_FILENAME).is_file():
        raise DerivedCaseError("Falta indicar los cambios.")

    changes = [UcChange(**c) for c in json.loads((base / uc_change.CHANGES_FILENAME).read_text())]
    if not changes:
        raise DerivedCaseError("No hay cambios para aplicar.")
    # Los datos pueden haberse validado antes de que cambie el caso: se revalida.
    loaded = load_calendar(case_id, (base / CALENDAR_FILENAME).read_text(encoding="utf-8"))
    placements = loaded.placements
    issues = uc_change.validate_changes(case_id, changes)
    if issues:
        raise DerivedCaseError("Los cambios ya no son válidos: " + "; ".join(i.issue for i in issues))

    affected = {c.codigo for c in changes}
    files = {name: _read(case_id, name) for name in REQUIRED_FILES}

    # --- unidades curriculares: se suman las altas ---
    ucs = files["unidades_curriculares"]
    name_col = uc_change._uc_name_column(ucs)
    files["unidades_curriculares"] = _append(
        ucs,
        [{"codigo": c.codigo, name_col: c.nombre} for c in changes if c.tipo == "alta"],
    )

    # --- datos de cada UC afectada: se quitan sus filas y se reescriben ---
    tray = files["trayectoria_sugerida"]
    files["trayectoria_sugerida"] = _append(
        _without_rows(tray, tray["unidad_curricular"].isin(affected)),
        [
            {"unidad_curricular": c.codigo, "semestre": str(t.semestre), "carrera": t.carrera}
            for c in changes
            for t in c.trayectoria
        ],
    )

    # Las previas de la UC (no las filas donde otra UC la requiere).
    prev = files["previas"]
    files["previas"] = _append(
        _without_rows(prev, prev["uc"].isin(affected)),
        [{"uc": c.codigo, "uc_requerida": r} for c in changes for r in c.previas],
    )

    prof = files["profesores"]
    files["profesores"] = _append(
        _without_rows(prof, prof["uc_1"].isin(affected) | prof["uc_2"].isin(affected)),
        [{"uc_1": c.codigo, "uc_2": o} for c in changes for o in c.profesores],
    )

    ins = files["inscriptos"]
    files["inscriptos"] = _append(
        _without_rows(ins, ins["uc"].isin(affected)),
        [{"uc": c.codigo, "inscriptos": _num(c.inscriptos)} for c in changes],
    )

    coinc = files["coincidencia"]
    files["coincidencia"] = _append(
        _without_rows(coinc, coinc["uc_1"].isin(affected) | coinc["uc_2"].isin(affected)),
        [
            {"uc_1": c.codigo, "uc_2": co.uc, "coincidencia": _num(co.coincidencia)}
            for c in changes
            for co in c.coincidencias
        ],
    )

    # --- preasignaciones: fijas las UCs del calendario que no cambian ---
    # Una preasignación es el conjunto de slots permitidos: con turno (formato
    # generado) es una fila; sin turno (planilla vieja) son todos los turnos de
    # ese día, así que la UC queda fija al día y el modelo elige el turno.
    por_dia = _turnos_por_dia(case_id)
    fixed = [p for p in placements if p.codigo not in affected]
    files["preasignaciones"] = pd.DataFrame(
        [
            {"unidad_curricular": p.codigo, "dia": str(p.dia), "turno": str(turno)}
            for p in fixed
            for turno in ([p.turno] if p.turno is not None else por_dia[p.dia])
        ],
        columns=["unidad_curricular", "dia", "turno"],
    )

    warnings: list[str] = []
    if loaded.desconocidas:
        warnings.append(
            "Estas evaluaciones de la planilla no son unidades curriculares del caso, así que "
            "no se tuvieron en cuenta: " + ", ".join(loaded.desconocidas)
        )
    placed = {p.codigo for p in placements}
    unplaced = sorted(
        uc.codigo
        for uc in uc_change.list_ucs(case_id)
        if uc.codigo not in placed and uc.codigo not in affected
    )
    if unplaced:
        warnings.append(
            "Estas UCs del caso no figuran en el calendario vigente, así que el modelo "
            "también las va a ubicar: " + ", ".join(unplaced)
        )

    derived_id = uuid.uuid4().hex
    out = case_dir(derived_id)
    out.mkdir(parents=True)
    for name, df in files.items():
        df.to_csv(out / f"{name}.csv", index=False)

    # Si lo que queda fijo ya se incumple entre sí, el modelo va a ser
    # infactible hagan lo que hagan los cambios: se avisa ahora, sin correr
    # (y esperar) un solve que no puede salir bien.
    try:
        report = feasibility.fixed_conflict_report(out)
    except Exception:
        report = []
    if report:
        shutil.rmtree(out)
        raise DerivedCaseError("\n- ".join([report[0], *report[1:]]))

    return DerivedCase(
        case_id=derived_id,
        fixed_ucs=len(fixed),
        free_ucs=sorted(affected),
        warnings=warnings,
    )


def _num(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)
