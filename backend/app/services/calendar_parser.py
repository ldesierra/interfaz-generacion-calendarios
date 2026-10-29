"""Parser del CSV de un calendario ya generado (el que baja
`GET /api/jobs/{id}/download`) a una lista de ubicaciones fijas.

    Día/Turno,Turno 1,Turno 2,...
    Día 1,"UC (cod) & UC (cod)",,...

"Día N" / "Turno N" son los ids de `dias.csv` / `turnos.csv` del caso (así los
escribe `generate_schedule.build_schedule_grid`).
"""

import csv
import io
import re
from dataclasses import dataclass


class CalendarParseError(Exception):
    pass


@dataclass(frozen=True)
class Placement:
    codigo: str
    dia: int
    turno: int


_EVALUACION = re.compile(r"^(.*)\(([^()]*)\)\s*$")


def _index(label: str, prefix: str, where: str) -> int:
    match = re.match(rf"^{prefix}\s+(\d+)$", label.strip(), re.IGNORECASE)
    if not match:
        raise CalendarParseError(f'{where}: se esperaba "{prefix} N" y se encontró "{label}".')
    return int(match.group(1))


def parse_calendar_csv(text: str) -> list[Placement]:
    rows = [r for r in csv.reader(io.StringIO(text.lstrip("﻿"))) if any(c.strip() for c in r)]
    if len(rows) < 2:
        raise CalendarParseError("El calendario no tiene filas de días.")

    header, body = rows[0], rows[1:]
    if len(header) < 2:
        raise CalendarParseError("Falta al menos una columna de turno.")
    turnos = [_index(label, "Turno", "Encabezado") for label in header[1:]]

    placements: list[Placement] = []
    seen: dict[str, Placement] = {}
    for row in body:
        dia = _index(row[0], "Día", f'Fila "{row[0]}"')
        for position, turno in enumerate(turnos, start=1):
            cell = row[position].strip() if position < len(row) else ""
            if not cell:
                continue
            for part in cell.split(" & "):
                match = _EVALUACION.match(part.strip())
                if not match:
                    raise CalendarParseError(
                        f'Día {dia}, Turno {turno}: no se pudo leer el código de "{part.strip()}".'
                    )
                codigo = match.group(2).strip()
                if codigo in seen:
                    other = seen[codigo]
                    raise CalendarParseError(
                        f"La UC '{codigo}' aparece más de una vez "
                        f"(Día {other.dia} Turno {other.turno} y Día {dia} Turno {turno})."
                    )
                placement = Placement(codigo=codigo, dia=dia, turno=turno)
                seen[codigo] = placement
                placements.append(placement)

    if not placements:
        raise CalendarParseError("El calendario no tiene ninguna evaluación asignada.")
    return placements
