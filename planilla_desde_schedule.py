"""Convierte un calendario generado al formato de planilla del docente.

    python planilla_desde_schedule.py schedule_1s1p_corregido_final.csv ejemplos_csv salida.csv

El calendario que baja la interfaz (`Día/Turno,Turno 1,...`, celdas
`Nombre (codigo)`) se reescribe con el layout de la planilla: una columna por
día, una fila por (carrera, semestre) y la UC escrita con su nombre, sin
código ni turno. Sirve para comprobar que el flujo de modificación acepta el
formato con el que el docente viene trabajando.

Las columnas "Día N" de la planilla son posicionales (la N-ésima es el N-ésimo
día de `dias.csv`), así que los ids del caso van en la primera fila, donde la
planilla del docente pone las fechas — el parser ignora todo lo que esté
arriba de la fila de encabezado.

Las UCs sin fila en `trayectoria_sugerida.csv` no tienen (carrera, semestre)
donde ubicarse; van en una fila final aparte para no perderlas.
"""

import csv
import sys
from collections import defaultdict

from backend.app.services.calendar_parser import parse_calendar_csv

ORDINALES = {
    1: "Primero", 2: "Segundo", 3: "Tercero", 4: "Cuarto", 5: "Quinto",
    6: "Sexto", 7: "Séptimo", 8: "Octavo", 9: "Noveno", 10: "Décimo",
}


def _leer(caso, nombre):
    with open(f"{caso}/{nombre}.csv", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def planilla(calendario_csv: str, caso: str) -> list[list[str]]:
    dias = [int(float(r["id"])) for r in _leer(caso, "dias")]
    columna = {dia: i for i, dia in enumerate(dias)}

    ucs = _leer(caso, "unidades_curriculares")
    campo = "descripcion" if "descripcion" in ucs[0] else "unidad_curricular"
    nombre_uc = {r["codigo"]: r[campo] for r in ucs}
    nombre_carrera = {r["codigo"]: r["nombre"] for r in _leer(caso, "carreras")}

    dia_de = {p.codigo: p.dia for p in parse_calendar_csv(open(calendario_csv, encoding="utf-8-sig").read())}

    # (carrera, semestre) -> {posición de columna -> [nombres]}
    filas: dict[tuple[str, int], dict[int, list[str]]] = defaultdict(lambda: defaultdict(list))
    ubicadas = set()
    for r in _leer(caso, "trayectoria_sugerida"):
        codigo = r["unidad_curricular"]
        if codigo not in dia_de:
            continue
        ubicadas.add(codigo)
        filas[(r["carrera"], int(float(r["semestre"])))][columna[dia_de[codigo]]].append(
            nombre_uc.get(codigo, codigo)
        )
    sueltas = {c: d for c, d in dia_de.items() if c not in ubicadas}

    out = [
        ["", "id del día en el caso"] + [str(d) for d in dias],
        ["", "Semestre"] + [f"Día {i}" for i in range(1, len(dias) + 1)],
    ]

    def fila(etiqueta_carrera, semestre, celdas):
        row = [etiqueta_carrera, semestre] + [""] * len(dias)
        for pos, nombres in celdas.items():
            row[2 + pos] = " / ".join(nombres)
        return row

    for carrera in nombre_carrera:
        semestres = sorted(s for (c, s) in filas if c == carrera)
        for i, semestre in enumerate(semestres):
            out.append(
                fila(nombre_carrera[carrera] if i == 0 else "", ORDINALES.get(semestre, str(semestre)),
                     filas[(carrera, semestre)])
            )

    if sueltas:
        celdas: dict[int, list[str]] = defaultdict(list)
        for codigo, dia in sueltas.items():
            celdas[columna[dia]].append(nombre_uc.get(codigo, codigo))
        out.append(fila("Sin trayectoria sugerida", "", celdas))
    return out


def main():
    if len(sys.argv) != 4:
        sys.exit(f"uso: {sys.argv[0]} <calendario.csv> <dir_del_caso> <salida.csv>")
    calendario, caso, salida = sys.argv[1:]
    with open(salida, "w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerows(planilla(calendario, caso))
    print(f"escrito {salida}")


if __name__ == "__main__":
    main()
