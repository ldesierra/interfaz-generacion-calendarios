from io import BytesIO
from pathlib import Path

from backend.app.services.case_validation import REQUIRED_FILES, validate_case_files

CASOS_DIR = Path(__file__).resolve().parents[2] / "casos"


def _load_case_files(case_name: str) -> dict[str, BytesIO]:
    case_dir = CASOS_DIR / case_name
    return {
        name: BytesIO((case_dir / f"{name}.csv").read_bytes()) for name in REQUIRED_FILES
    }


def test_caso_sm_is_valid_except_for_missing_alta_co():
    files = _load_case_files("caso_sm")

    issues = validate_case_files(files)

    # caso_sm/datos.csv sólo tiene fac_cp: sin este chequeo, el solve
    # rompe más adelante con un KeyError poco claro (ver ARQUITECTURA_INTERFAZ.md §4).
    assert [(i.file, i.issue) for i in issues] == [
        ("datos", "falta la columna 'alta_co'")
    ]


def test_caso_1s1p_is_fully_valid():
    files = _load_case_files("caso_1s1p")

    issues = validate_case_files(files)

    assert issues == []


def test_caso_md_is_valid_except_for_missing_alta_co():
    files = _load_case_files("caso_md")

    issues = validate_case_files(files)

    assert [(i.file, i.issue) for i in issues] == [
        ("datos", "falta la columna 'alta_co'")
    ]


def test_missing_file_reported():
    files = _load_case_files("caso_1s1p")
    files["capacidad"] = None

    issues = validate_case_files(files)

    assert [(i.file, i.issue) for i in issues] == [("capacidad", "falta el archivo")]


def test_missing_column_reported():
    files = _load_case_files("caso_1s1p")
    files["capacidad"] = BytesIO(b"id_dia,capacidad\n1,90\n")

    issues = validate_case_files(files)

    assert [(i.file, i.issue) for i in issues] == [
        ("capacidad", "falta la columna 'id_turno'")
    ]


def test_non_numeric_column_reported():
    files = _load_case_files("caso_1s1p")
    files["capacidad"] = BytesIO(b"id_dia,id_turno,capacidad\n1,1,mucha\n")

    issues = validate_case_files(files)

    assert [(i.file, i.issue) for i in issues] == [
        ("capacidad", "la columna 'capacidad' debe ser numérica")
    ]


def test_empty_required_cell_reported():
    files = _load_case_files("caso_1s1p")
    files["capacidad"] = BytesIO(b"id_dia,id_turno,capacidad\n1,,90\n")

    issues = validate_case_files(files)

    assert [(i.file, i.issue) for i in issues] == [
        ("capacidad", "la columna 'id_turno' tiene valores vacíos")
    ]


def test_unidades_curriculares_accepts_descripcion_or_unidad_curricular():
    files_sm = _load_case_files("caso_sm")
    files_1s1p = _load_case_files("caso_1s1p")

    issues_sm = validate_case_files({**files_sm, "unidades_curriculares": files_sm["unidades_curriculares"]})
    issues_1s1p = validate_case_files({**files_1s1p, "unidades_curriculares": files_1s1p["unidades_curriculares"]})

    assert not any(i.file == "unidades_curriculares" for i in issues_sm)
    assert not any(i.file == "unidades_curriculares" for i in issues_1s1p)


def test_unidades_curriculares_missing_both_name_columns():
    files = _load_case_files("caso_1s1p")
    files["unidades_curriculares"] = BytesIO(b"codigo\n1030\n")

    issues = validate_case_files(files)

    assert [(i.file, i.issue) for i in issues] == [
        (
            "unidades_curriculares",
            "falta una de estas columnas: 'descripcion' / 'unidad_curricular'",
        )
    ]


def test_preasignaciones_can_be_empty():
    files = _load_case_files("caso_1s1p")
    files["preasignaciones"] = BytesIO(b"unidad_curricular,dia,turno\n")

    issues = validate_case_files(files)

    assert issues == []


def test_other_files_cannot_be_empty():
    files = _load_case_files("caso_1s1p")
    files["capacidad"] = BytesIO(b"id_dia,id_turno,capacidad\n")

    issues = validate_case_files(files)

    assert [(i.file, i.issue) for i in issues] == [
        ("capacidad", "el archivo no tiene filas de datos")
    ]


def test_datos_requires_exactly_one_row():
    files = _load_case_files("caso_1s1p")
    files["datos"] = BytesIO(b"fac_cp,alta_co\n0.8,40\n0.8,40\n")

    issues = validate_case_files(files)

    assert [(i.file, i.issue) for i in issues] == [
        ("datos", "se esperaba exactamente una fila de datos, se encontraron 2")
    ]


def test_unreadable_csv_reported_with_clear_message():
    files = _load_case_files("caso_1s1p")
    files["capacidad"] = BytesIO(b"")

    issues = validate_case_files(files)

    assert [(i.file, i.issue) for i in issues] == [
        ("capacidad", "el archivo está vacío")
    ]
