"""Lectura del catálogo de UCs de un caso y validación/guardado del cambio.

Todo se lee de los CSVs que el usuario subió con `POST /api/cases`
(`storage/cases/{case_id}/`). Ver subtarea 3 de la Tarea 2 en
`PLAN_INTERFAZ_CALENDARIO.md`.
"""

import json

import pandas as pd

from backend.app.schemas.change import (
    Carrera,
    Catalog,
    ChangeIssue,
    Coincidencia,
    Trayectoria,
    UcChange,
    UcDetail,
    UcSummary,
)
from backend.app.services.case_storage import case_dir

CHANGES_FILENAME = "changes.json"

# Fracción de los inscriptos del menor de los dos cursos que se asume que
# cursan ambos, para UCs que comparten carrera y semestre en la trayectoria
# sugerida. Relevado de caso_1s1p: en los 184 pares con trayectoria en común,
# coincidencia / min(inscriptos) tiene mediana ≈ 0.30 (media ≈ 0.32). Es una
# estimación inicial, pendiente de validar con el docente (ver el plan).
SAME_TRAYECTORIA_RATIO = 0.30


def _read(case_id: str, name: str) -> pd.DataFrame:
    return pd.read_csv(case_dir(case_id) / f"{name}.csv", dtype=str, keep_default_na=False)


def _uc_name_column(df: pd.DataFrame) -> str:
    return "descripcion" if "descripcion" in df.columns else "unidad_curricular"


def list_ucs(case_id: str) -> list[UcSummary]:
    df = _read(case_id, "unidades_curriculares")
    col = _uc_name_column(df)
    return [UcSummary(codigo=r["codigo"], nombre=r[col]) for _, r in df.iterrows()]


def get_catalog(case_id: str) -> Catalog:
    carreras = _read(case_id, "carreras")
    semestres = _read(case_id, "semestres")
    return Catalog(
        ucs=list_ucs(case_id),
        carreras=[Carrera(codigo=r["codigo"], nombre=r["nombre"]) for _, r in carreras.iterrows()],
        semestres=sorted(int(float(v)) for v in semestres["id"]),
    )


def _inscriptos(case_id: str) -> dict[str, float]:
    df = _read(case_id, "inscriptos")
    result: dict[str, float] = {}
    for _, r in df.iterrows():
        result.setdefault(r["uc"], float(r["inscriptos"]))
    return result


def _trayectorias(case_id: str) -> dict[str, list[Trayectoria]]:
    df = _read(case_id, "trayectoria_sugerida")
    result: dict[str, list[Trayectoria]] = {}
    for _, r in df.iterrows():
        result.setdefault(r["unidad_curricular"], []).append(
            Trayectoria(carrera=r["carrera"], semestre=int(float(r["semestre"])))
        )
    return result


def _known_codes(case_id: str) -> set[str]:
    """Códigos que aparecen en cualquier archivo del caso. `previas` y
    `coincidencia` de los casos reales referencian códigos que no están en
    `unidades_curriculares.csv` (UCs que no se evalúan en este calendario), y
    siguen siendo referencias válidas para el modelo."""
    codes = {uc.codigo for uc in list_ucs(case_id)}
    for name, cols in (
        ("previas", ["uc", "uc_requerida"]),
        ("profesores", ["uc_1", "uc_2"]),
        ("coincidencia", ["uc_1", "uc_2"]),
        ("inscriptos", ["uc"]),
        ("trayectoria_sugerida", ["unidad_curricular"]),
    ):
        df = _read(case_id, name)
        for col in cols:
            codes.update(df[col])
    return codes


def _unique(items):
    return list(dict.fromkeys(items))


def get_uc_detail(case_id: str, codigo: str) -> UcDetail | None:
    ucs = {uc.codigo: uc for uc in list_ucs(case_id)}
    if codigo not in ucs:
        return None

    previas = _read(case_id, "previas")
    profesores = _read(case_id, "profesores")
    coincidencia = _read(case_id, "coincidencia")

    prof = [
        r["uc_2"] if r["uc_1"] == codigo else r["uc_1"]
        for _, r in profesores.iterrows()
        if codigo in (r["uc_1"], r["uc_2"])
    ]
    coinc: dict[str, float] = {}
    for _, r in coincidencia.iterrows():
        if codigo in (r["uc_1"], r["uc_2"]):
            other = r["uc_2"] if r["uc_1"] == codigo else r["uc_1"]
            coinc.setdefault(other, float(r["coincidencia"]))

    return UcDetail(
        codigo=codigo,
        nombre=ucs[codigo].nombre,
        inscriptos=_inscriptos(case_id).get(codigo, 0.0),
        trayectoria=_trayectorias(case_id).get(codigo, []),
        previas=_unique(r["uc_requerida"] for _, r in previas.iterrows() if r["uc"] == codigo),
        profesores=_unique(prof),
        coincidencias=[Coincidencia(uc=u, coincidencia=v) for u, v in coinc.items()],
    )


def estimate_coincidencias(
    case_id: str,
    inscriptos: float,
    trayectoria: list[Trayectoria],
    exclude: str | None = None,
) -> list[Coincidencia]:
    """Estima la coincidencia de una UC con las existentes que comparten
    (carrera, semestre) en la trayectoria sugerida. Las demás quedan en 0
    (no se listan), igual que en los casos reales donde `coincidencia.csv`
    es ralo."""
    own = {(t.carrera, t.semestre) for t in trayectoria}
    others_inscriptos = _inscriptos(case_id)
    estimates: list[Coincidencia] = []
    for uc, trays in _trayectorias(case_id).items():
        if uc == exclude or uc not in others_inscriptos:
            continue
        if own & {(t.carrera, t.semestre) for t in trays}:
            value = round(SAME_TRAYECTORIA_RATIO * min(inscriptos, others_inscriptos[uc]), 1)
            if value > 0:
                estimates.append(Coincidencia(uc=uc, coincidencia=value))
    return sorted(estimates, key=lambda c: c.uc)


def validate_changes(case_id: str, changes: list[UcChange]) -> list[ChangeIssue]:
    """Valida el conjunto de cambios. Las altas del mismo lote cuentan como UCs
    existentes para las referencias de los demás cambios (previas, profesores,
    coincidencias)."""
    issues: list[ChangeIssue] = []
    existing = {uc.codigo for uc in list_ucs(case_id)}
    known = _known_codes(case_id) | {c.codigo for c in changes if c.tipo == "alta"}
    carreras = set(_read(case_id, "carreras")["codigo"])
    semestres = {int(float(s)) for s in _read(case_id, "semestres")["id"]}

    seen: set[str] = set()
    for index, change in enumerate(changes):

        def add(field: str, issue: str) -> None:
            issues.append(ChangeIssue(index=index, field=field, issue=issue))

        codigo = change.codigo.strip()
        if not codigo:
            add("codigo", "el código es obligatorio")
        elif codigo in seen:
            add("codigo", f"ya hay otro cambio sobre la UC '{codigo}'")
        elif change.tipo == "alta" and codigo in existing:
            add("codigo", f"ya existe una UC con código '{codigo}'")
        elif change.tipo == "modificacion" and codigo not in existing:
            add("codigo", f"no existe una UC con código '{codigo}'")
        seen.add(codigo)

        if change.tipo == "alta" and not (change.nombre or "").strip():
            add("nombre", "el nombre es obligatorio para una UC nueva")

        if not change.trayectoria:
            add("trayectoria", "indicá al menos una carrera y semestre")
        for t in change.trayectoria:
            if t.carrera not in carreras:
                add("trayectoria", f"carrera desconocida '{t.carrera}'")
            if t.semestre not in semestres:
                add("trayectoria", f"semestre desconocido '{t.semestre}'")
        if len({(t.carrera, t.semestre) for t in change.trayectoria}) != len(change.trayectoria):
            add("trayectoria", "hay filas repetidas")

        def check_refs(field: str, ucs: list[str]) -> None:
            for uc in ucs:
                if uc == codigo:
                    add(field, "una UC no puede referirse a sí misma")
                elif uc not in known:
                    add(field, f"la UC '{uc}' no existe")
            if len(set(ucs)) != len(ucs):
                add(field, "hay UCs repetidas")

        check_refs("previas", change.previas)
        check_refs("profesores", change.profesores)
        check_refs("coincidencias", [c.uc for c in change.coincidencias])
    return issues


def save_changes(case_id: str, changes: list[UcChange]) -> None:
    path = case_dir(case_id) / CHANGES_FILENAME
    path.write_text(json.dumps([c.model_dump() for c in changes], ensure_ascii=False, indent=2))
