"""Parsers de los dos formatos de calendario vigente que acepta la edición
incremental.

Formato *generado* — el que baja `GET /api/jobs/{id}/download`:

    Día/Turno,Turno 1,Turno 2,...
    Día 1,"UC (cod) & UC (cod)",,...

"Día N" / "Turno N" son los ids de `dias.csv` / `turnos.csv` del caso (así los
escribe `generate_schedule.build_schedule_grid`) y cada celda trae el código de
la UC entre paréntesis.

Formato *viejo* — la planilla con la que se armaba el calendario a mano:

    ,,25/4,27/4,...
    ,Semestre,Día 1,Día 2,...
    Eléctrica,Primero,GAL 2,GAL 1,...
    ,Tercero,,Cálculo Vectorial,...

Acá las columnas son los días y cada fila es un (carrera, semestre), así que la
misma evaluación aparece repetida en todas las carreras que la tienen. No trae
códigos ni turnos: sólo el nombre de la UC y el día. Las columnas "Día N" se
leen por posición (la N-ésima columna de día es el N-ésimo día de `dias.csv`) y
los nombres se resuelven contra las UCs del caso en `derived_case`.
"""

import csv
import io
import re
import unicodedata
from dataclasses import dataclass


class CalendarParseError(Exception):
    pass


@dataclass(frozen=True)
class Placement:
    codigo: str
    dia: int
    # `None` en el formato viejo: la planilla sólo dice el día, así que la UC
    # queda fija al día y el modelo elige el turno.
    turno: int | None = None


@dataclass(frozen=True)
class LegacyEntry:
    """Una evaluación de la planilla vieja, todavía sin resolver contra el caso."""

    nombre: str
    columna: int  # posición (0-based) de la columna de día


@dataclass(frozen=True)
class LegacyCalendar:
    columnas: int  # cuántas columnas "Día N" tiene la planilla
    entradas: list[LegacyEntry]


_EVALUACION = re.compile(r"^(.*)\(([^()]*)\)\s*$")
_DIA_COLUMNA = re.compile(r"^d[ií]a\s+\d+$", re.IGNORECASE)
_TURNO_COLUMNA = re.compile(r"^turno\s+\d+$", re.IGNORECASE)
# En la planilla vieja una celda puede listar varias evaluaciones del mismo día
# ("CDIV/ CDIVV", "Redes de datos 2 / Electrónica de potencia").
_SEPARADOR = re.compile(r"[/&]")


def _rows(text: str) -> list[list[str]]:
    return [r for r in csv.reader(io.StringIO(text.lstrip("﻿"))) if any(c.strip() for c in r)]


def _index(label: str, prefix: str, where: str) -> int:
    match = re.match(rf"^{prefix}\s+(\d+)$", label.strip(), re.IGNORECASE)
    if not match:
        raise CalendarParseError(f'{where}: se esperaba "{prefix} N" y se encontró "{label}".')
    return int(match.group(1))


def normalize_name(nombre: str) -> str:
    """Nombre comparable: sin acentos, sin mayúsculas y sin puntuación.

    Los nombres de la planilla no coinciden carácter a carácter con los de
    `unidades_curriculares.csv` ("Logica" / "Lógica", "Física 3" / "Fisica 3",
    espacios de más)."""
    sin_acentos = "".join(
        c for c in unicodedata.normalize("NFKD", nombre) if not unicodedata.combining(c)
    )
    return re.sub(r"[^a-z0-9]+", " ", sin_acentos.lower()).strip()


def _es_generado(rows: list[list[str]]) -> bool:
    """El encabezado del formato generado es `Día/Turno,Turno 1,Turno 2,...`."""
    header = rows[0] if rows else []
    return len(header) >= 2 and all(_TURNO_COLUMNA.match(c.strip()) for c in header[1:])


# Abreviaturas y nombres cortos de la planilla que no se parecen al nombre de
# la UC en `unidades_curriculares.csv`. La clave es como lo escribe la planilla
# y el valor, el nombre del catálogo; los dos se comparan normalizados, así que
# no importan acentos, mayúsculas ni puntuación.
_ALIAS_PLANILLA = {
    "GAL 1": "Geometria y Algebra lineal 1",
    "GAL 2": "Geometria y Algebra lineal 2",
    "CDIV": "Calculo Dif. Integral en una variable",
    "CDIVV": "Calculo dif. integral en varias variables",
    "AGPI": "Administracion general para ingenieros",
    "Mat disc 1": "Matemática Discreta 1",
    "Mat disc 2": "Matemática Discreta 2",
    "Intro. A la investigación de Operaciones": "Intro. Invest. De Operaciones",
    "Intro. A la invest. De Operaciones": "Intro. Invest. De Operaciones",
    "Fenómenos de Transporte": "Fenomenos de transporte en ingenieria de procesos",
    "Tecn y Serv Industriales 1": "Tecnologia y servicios industriales 1",
    "Ing. reacciones químicas 1": "Ingenieria de reacciones quimicas 1",
    "Tratamiento de Efluentes y residuos sólidos": "Tratamiento biológico de Efluentes",
}


_ALIAS = {normalize_name(k): normalize_name(v) for k, v in _ALIAS_PLANILLA.items()}


def nombre_canonico(nombre: str) -> str:
    """Nombre normalizado con el que buscar la UC en el catálogo del caso,
    resolviendo las abreviaturas de la planilla.

    Se aplica a los dos lados de la comparación (la planilla y
    `unidades_curriculares.csv`), así que un alias sirve igual si el catálogo
    del caso es el que trae el nombre corto."""
    normalizado = normalize_name(nombre)
    return _ALIAS.get(normalizado, normalizado)


def _legacy_header(rows: list[list[str]]) -> int | None:
    """Índice de la fila de encabezado de la planilla vieja, o None.

    Es la primera fila con una celda "Día N" fuera de la primera columna: en el
    formato generado "Día N" aparece sólo como primera celda de cada fila."""
    if _es_generado(rows):
        return None
    for i, row in enumerate(rows):
        if any(_DIA_COLUMNA.match(c.strip()) for c in row[1:]):
            return i
    return None


def is_legacy_calendar(text: str) -> bool:
    return _legacy_header(_rows(text)) is not None


def parse_legacy_calendar_csv(text: str) -> LegacyCalendar:
    """Lee la planilla vieja: nombres de evaluación por columna de día.

    Se recorre la fila entera de cada (carrera, semestre) y se juntan todas las
    evaluaciones; las repetidas entre carreras quedan una sola vez."""
    rows = _rows(text)
    header_index = _legacy_header(rows)
    if header_index is None:
        raise CalendarParseError('La planilla no tiene una fila de encabezado con columnas "Día N".')

    header = rows[header_index]
    columnas = [i for i, c in enumerate(header) if _DIA_COLUMNA.match(c.strip())]

    entradas: list[LegacyEntry] = []
    vistos: set[tuple[int, str]] = set()
    for row in rows[header_index + 1 :]:
        for posicion, columna in enumerate(columnas):
            cell = row[columna].strip() if columna < len(row) else ""
            if not cell:
                continue
            for parte in _SEPARADOR.split(cell):
                nombre = parte.strip()
                clave = (posicion, normalize_name(nombre))
                if not nombre or not clave[1] or clave in vistos:
                    continue
                vistos.add(clave)
                entradas.append(LegacyEntry(nombre=nombre, columna=posicion))

    if not entradas:
        raise CalendarParseError("La planilla no tiene ninguna evaluación.")
    return LegacyCalendar(columnas=len(columnas), entradas=entradas)


def parse_calendar_csv(text: str) -> list[Placement]:
    rows = _rows(text)
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
