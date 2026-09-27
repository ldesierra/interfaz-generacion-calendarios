"""Validación de esquema de los CSVs subidos en POST /api/cases.

Ver `docs/ARQUITECTURA_INTERFAZ.md` §4 para el contrato de columnas por
archivo, relevado de los casos reales en `casos/`.
"""

from typing import IO, Optional

import pandas as pd

from backend.app.schemas.case import ValidationIssue

REQUIRED_FILES = [
    "dias",
    "unidades_curriculares",
    "turnos",
    "turnos_dias",
    "semestres",
    "carreras",
    "trayectoria_sugerida",
    "preasignaciones",
    "previas",
    "profesores",
    "capacidad",
    "inscriptos",
    "coincidencia",
    "datos",
]

# `unidades_curriculares.csv` no tiene siempre la columna "descripcion":
# caso_sm usa "codigo,descripcion", los casos grandes usan
# "unidad_curricular,codigo". Se acepta cualquiera de las dos (ver
# csv_data_to_model_data.load_calendar_data).
FILE_SCHEMAS: dict[str, dict] = {
    "dias": {"required": ["id"], "numeric": ["id"]},
    "unidades_curriculares": {
        "required": ["codigo"],
        "one_of": ["descripcion", "unidad_curricular"],
    },
    "turnos": {"required": ["id"], "numeric": ["id"]},
    "turnos_dias": {"required": ["id_dia", "id_turno"], "numeric": ["id_dia", "id_turno"]},
    "semestres": {"required": ["id"], "numeric": ["id"]},
    "carreras": {"required": ["codigo", "nombre"]},
    "trayectoria_sugerida": {
        "required": ["unidad_curricular", "semestre", "carrera"],
        "numeric": ["semestre"],
    },
    # Puede no tener filas (sólo cabecera) si el caso no tiene preasignaciones.
    "preasignaciones": {
        "required": ["unidad_curricular", "dia", "turno"],
        "numeric": ["dia", "turno"],
        "allow_empty": True,
    },
    "previas": {"required": ["uc", "uc_requerida"]},
    "profesores": {"required": ["uc_1", "uc_2"]},
    "capacidad": {
        "required": ["id_dia", "id_turno", "capacidad"],
        "numeric": ["id_dia", "id_turno", "capacidad"],
    },
    "inscriptos": {"required": ["uc", "inscriptos"], "numeric": ["inscriptos"]},
    "coincidencia": {
        "required": ["uc_1", "uc_2", "coincidencia"],
        "numeric": ["coincidencia"],
    },
    "datos": {
        "required": ["fac_cp", "alta_co"],
        "numeric": ["fac_cp", "alta_co"],
        "single_row": True,
    },
}


def _validate_file(name: str, file_obj: Optional[IO[bytes]]) -> list[ValidationIssue]:
    if file_obj is None:
        return [ValidationIssue(file=name, issue="falta el archivo")]

    if hasattr(file_obj, "seek"):
        file_obj.seek(0)

    try:
        df = pd.read_csv(file_obj)
    except pd.errors.EmptyDataError:
        return [ValidationIssue(file=name, issue="el archivo está vacío")]
    except Exception as e:
        return [ValidationIssue(file=name, issue=f"no se pudo leer el CSV: {e}")]

    schema = FILE_SCHEMAS[name]
    required = schema.get("required", [])
    one_of = schema.get("one_of")

    issues = [
        ValidationIssue(file=name, issue=f"falta la columna '{c}'")
        for c in required
        if c not in df.columns
    ]

    if one_of and not any(c in df.columns for c in one_of):
        opciones = " / ".join(f"'{c}'" for c in one_of)
        issues.append(
            ValidationIssue(file=name, issue=f"falta una de estas columnas: {opciones}")
        )

    if issues:
        # Sin las columnas esperadas no tiene sentido seguir validando datos.
        return issues

    if not schema.get("allow_empty") and df.empty:
        return [ValidationIssue(file=name, issue="el archivo no tiene filas de datos")]

    if schema.get("single_row") and len(df) != 1:
        issues.append(
            ValidationIssue(
                file=name,
                issue=f"se esperaba exactamente una fila de datos, se encontraron {len(df)}",
            )
        )

    for col in required:
        if df[col].isna().any():
            issues.append(
                ValidationIssue(file=name, issue=f"la columna '{col}' tiene valores vacíos")
            )

    for col in schema.get("numeric", []):
        non_null = df[col].dropna()
        if non_null.empty:
            continue
        if pd.to_numeric(non_null, errors="coerce").isna().any():
            issues.append(
                ValidationIssue(file=name, issue=f"la columna '{col}' debe ser numérica")
            )

    return issues


def _validate_preasignaciones_reference_turnos_dias(
    files: dict[str, Optional[IO[bytes]]]
) -> list[ValidationIssue]:
    """Chequea que cada (dia, turno) de `preasignaciones` exista en `turnos_dias`.

    `dias`/`turnos_dias` los arma el calendario del frontend, mientras que
    `preasignaciones` es un CSV subido aparte — si no coinciden (p.ej. un
    `preasignaciones.csv` de otro caso, con otros ids de día), el solve
    rompe más adelante con un `KeyError` críptico sobre `x[c, d, t]`
    (ver `solve.solve_model`, restricción "PreAsignacion_"). Se valida acá
    para dar un 422 claro en vez de ese crash.
    """
    pa_file = files.get("preasignaciones")
    td_file = files.get("turnos_dias")
    if pa_file is None or td_file is None:
        return []

    pa_file.seek(0)
    td_file.seek(0)
    try:
        pa_df = pd.read_csv(pa_file)
        td_df = pd.read_csv(td_file)
    except Exception:
        # Ya se reporta desde _validate_file; no duplicar el error acá.
        return []

    required_pa = {"unidad_curricular", "dia", "turno"}
    required_td = {"id_dia", "id_turno"}
    if not required_pa.issubset(pa_df.columns) or not required_td.issubset(td_df.columns):
        return []

    valid_pairs = set(zip(td_df["id_dia"], td_df["id_turno"]))
    invalid_pairs: list[tuple] = []
    seen: set[tuple] = set()
    for _, row in pa_df.iterrows():
        pair = (row["dia"], row["turno"])
        if pair not in valid_pairs and pair not in seen:
            seen.add(pair)
            invalid_pairs.append(pair)

    if not invalid_pairs:
        return []

    # Un CSV desalineado con el calendario puede tener decenas de filas
    # inválidas — se resume en un único issue (con algunos ejemplos) en vez
    # de uno por combinación, para no inundar la respuesta.
    ejemplos = ", ".join(f"día {d} turno {t}" for d, t in invalid_pairs[:3])
    restantes = len(invalid_pairs) - 3
    if restantes > 0:
        ejemplos += f" (y {restantes} más)"

    return [
        ValidationIssue(
            file="preasignaciones",
            issue=(
                f"{len(invalid_pairs)} combinación(es) de día/turno no existen en "
                f"turnos_dias: {ejemplos} — revisá que coincidan con el calendario "
                "elegido"
            ),
        )
    ]


def validate_case_files(
    files: dict[str, Optional[IO[bytes]]]
) -> list[ValidationIssue]:
    """Valida los CSVs de un caso subidos por HTTP.

    `files` debe tener una entrada por cada nombre en `REQUIRED_FILES`
    (con `None` si no se subió), mapeando a un objeto file-like que
    `pandas.read_csv` pueda leer (p.ej. `UploadFile.file`).
    """
    issues: list[ValidationIssue] = []
    for name in REQUIRED_FILES:
        issues.extend(_validate_file(name, files.get(name)))

    if not issues:
        issues.extend(_validate_preasignaciones_reference_turnos_dias(files))

    return issues
