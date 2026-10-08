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
import uuid
from dataclasses import dataclass, field

import pandas as pd

from backend.app.schemas.change import UcChange
from backend.app.services import uc_change
from backend.app.services.calendar_parser import (
    CalendarParseError,
    Placement,
    parse_calendar_csv,
)
from backend.app.services.case_storage import case_dir
from backend.app.services.case_validation import REQUIRED_FILES

CALENDAR_FILENAME = "calendario.csv"


class DerivedCaseError(Exception):
    """El caso derivado no se puede armar; el mensaje es para el usuario."""


@dataclass
class DerivedCase:
    case_id: str
    fixed_ucs: int
    free_ucs: list[str]
    warnings: list[str] = field(default_factory=list)


def _read(case_id: str, name: str) -> pd.DataFrame:
    # dtype=str: se preserva el texto original de los CSV al reescribirlos.
    return pd.read_csv(case_dir(case_id) / f"{name}.csv", dtype=str, keep_default_na=False)


def validate_calendar_for_case(case_id: str, placements: list[Placement]) -> None:
    """El calendario tiene que corresponder al caso: sus UCs, días y turnos
    existen en los datos subidos."""
    ucs = {uc.codigo for uc in uc_change.list_ucs(case_id)}
    slots = {(r["id_dia"], r["id_turno"]) for _, r in _read(case_id, "turnos_dias").iterrows()}

    unknown = sorted({p.codigo for p in placements if p.codigo not in ucs})
    if unknown:
        raise DerivedCaseError(
            "El calendario tiene UCs que no están en las unidades curriculares del caso: "
            + ", ".join(unknown)
        )
    bad_slots = sorted({(p.dia, p.turno) for p in placements if (str(p.dia), str(p.turno)) not in slots})
    if bad_slots:
        raise DerivedCaseError(
            "El calendario usa días/turnos que no existen en el caso: "
            + ", ".join(f"Día {d} Turno {t}" for d, t in bad_slots)
        )


def save_calendar(case_id: str, text: str) -> list[Placement]:
    try:
        placements = parse_calendar_csv(text)
    except CalendarParseError as exc:
        raise DerivedCaseError(str(exc)) from exc
    validate_calendar_for_case(case_id, placements)
    (case_dir(case_id) / CALENDAR_FILENAME).write_text(text, encoding="utf-8")
    return placements


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

    placements = parse_calendar_csv((base / CALENDAR_FILENAME).read_text(encoding="utf-8"))
    changes = [UcChange(**c) for c in json.loads((base / uc_change.CHANGES_FILENAME).read_text())]
    if not changes:
        raise DerivedCaseError("No hay cambios para aplicar.")
    # Los datos pueden haberse validado antes de que cambie el caso: se revalida.
    validate_calendar_for_case(case_id, placements)
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
    fixed = [p for p in placements if p.codigo not in affected]
    files["preasignaciones"] = pd.DataFrame(
        [
            {"unidad_curricular": p.codigo, "dia": str(p.dia), "turno": str(p.turno)}
            for p in fixed
        ],
        columns=["unidad_curricular", "dia", "turno"],
    )

    warnings: list[str] = []
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

    return DerivedCase(
        case_id=derived_id,
        fixed_ucs=len(fixed),
        free_ucs=sorted(affected),
        warnings=warnings,
    )


def _num(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)
