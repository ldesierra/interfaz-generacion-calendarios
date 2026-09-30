"""Persistencia en filesystem de los CSVs subidos de un caso.

MVP: filesystem local (`storage/cases/{case_id}/`). Ver la nota de
`docs/ARQUITECTURA_INTERFAZ.md` §6 sobre reemplazar esto por un storage
externo si el filesystem efímero de Vercel no alcanza (subtarea 9).
"""

from typing import IO

from backend.app.core.config import STORAGE_DIR


def case_dir(case_id: str):
    return STORAGE_DIR / case_id


def save_case_files(case_id: str, files: dict[str, IO[bytes]]) -> None:
    target_dir = case_dir(case_id)
    target_dir.mkdir(parents=True, exist_ok=True)

    for name, file_obj in files.items():
        if hasattr(file_obj, "seek"):
            file_obj.seek(0)

        with open(target_dir / f"{name}.csv", "wb") as out:
            out.write(file_obj.read())
