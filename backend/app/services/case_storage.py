"""Persistencia en filesystem de los CSVs subidos de un caso.

MVP: filesystem local (`storage/cases/{case_id}/`). Ver la nota de
`docs/ARQUITECTURA_INTERFAZ.md` §6 sobre reemplazar esto por un storage
externo si el filesystem efímero de Vercel no alcanza (subtarea 9).
"""

import re
from typing import IO

from backend.app.core.config import STORAGE_DIR

# case_id se genera en POST /api/cases como uuid.uuid4().hex. Validar el
# formato antes de resolverlo contra el filesystem evita que un case_id
# arbitrario del cliente (p.ej. "../../etc") se use para construir un path
# fuera de STORAGE_DIR (usado por endpoints que sí reciben case_id del
# cliente, como POST /api/cases/{case_id}/solve).
_CASE_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


def is_valid_case_id(case_id: str) -> bool:
    return bool(_CASE_ID_PATTERN.match(case_id))


def case_dir(case_id: str):
    return STORAGE_DIR / case_id


WARM_START_FILENAME = "warm_start.csv"


def warm_start_path(case_id: str):
    return case_dir(case_id) / WARM_START_FILENAME


def save_warm_start_file(case_id: str, file_obj: IO[bytes]) -> None:
    target_dir = case_dir(case_id)
    target_dir.mkdir(parents=True, exist_ok=True)

    if hasattr(file_obj, "seek"):
        file_obj.seek(0)

    with open(warm_start_path(case_id), "wb") as out:
        out.write(file_obj.read())


def save_case_files(case_id: str, files: dict[str, IO[bytes]]) -> None:
    target_dir = case_dir(case_id)
    target_dir.mkdir(parents=True, exist_ok=True)

    for name, file_obj in files.items():
        if hasattr(file_obj, "seek"):
            file_obj.seek(0)

        with open(target_dir / f"{name}.csv", "wb") as out:
            out.write(file_obj.read())
