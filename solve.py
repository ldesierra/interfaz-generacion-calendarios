from timeit import default_timer as timer

import os
import pulp as pl
import pandas as pd

from csv_data_to_model_data import load_calendar_data
from constants import Solver, MINUTES


def solve_model(
    source, solver_name: Solver, alpha: float, beta: float, time_limit_minutes=15
) -> tuple[float, float, str, list, dict]:
    """
    Args:
        source: path a un directorio con los CSV del caso, o un dict
            {nombre_csv: archivo} con archivos subidos (ver
            csv_data_to_model_data.load_calendar_data).

    Returns:
        (valor_objetivo, tiempo_ejecucion_seg, status, variables, uc_descriptions)
    """
    # region CARGA DE DATOS
    datos = load_calendar_data(source)

    D = datos.get("D")
    C = datos.get("C")
    Td = datos.get("Td")
    PA = datos.get("PA")
    COP = datos.get("COP")
    P = datos.get("P")
    PARES_UC = datos.get("PARES_UC")
    UC_MISMO_SEMESTRE = datos.get("UC_MISMO_SEMESTRE")
    cp = datos.get("cp")
    fac_cp = datos.get("fac_cp")
    alta_co = datos.get("alta_co")
    ins = datos.get("ins")
    co = datos.get("co")
    dist_sem = datos.get("dist_sem")
    DS = datos.get("DS")
    M = datos.get("M")
    dist_peso = datos.get("dist_peso")
    time_value = datos.get("time_value")
    # endregion

    # region DEFINICIÓN DEL PROBLEMA
    problem = pl.LpProblem("Optimizacion_Calendario", pl.LpMinimize)
    # endregion

    # region DEFINICIÓN DE VARIABLES

    # Variable que vale 1 si la UC c se asigna al día d en el turno t
    x = {}
    for c in C:
        for d in D:
            for t in Td[d]:
                x[(c, d, t)] = pl.LpVariable(f"x_{c}_{d}_{t}", cat=pl.LpBinary)

    # Variable binaria para identificar si distancia entre las evaluaciones de dos UC es ds
    w = {}
    for c1, c2 in PARES_UC:
        for ds in DS:
            w[(c1, c2, ds)] = pl.LpVariable(f"w_{c1}_{c2}_{ds}", cat=pl.LpBinary)

    # Variables para definir la distancia entre las evaluaciones de dos UC
    z = {}  # Valor absoluto de la diferencia entre las evaluaciones de c1 y c2
    z_plus = {}  # Indica la parte positiva de z
    z_minus = {}  # Indica la parte negativa de z
    y = {}  # Indica si z_plus o z_minus es activo

    for c1, c2 in PARES_UC:
        z[(c1, c2)] = pl.LpVariable(f"z_{c1}_{c2}", lowBound=0)
        z_plus[(c1, c2)] = pl.LpVariable(f"z_plus_{c1}_{c2}", lowBound=0)
        z_minus[(c1, c2)] = pl.LpVariable(f"z_minus_{c1}_{c2}", lowBound=0)
        y[(c1, c2)] = pl.LpVariable(f"y_{c1}_{c2}", cat=pl.LpBinary)
    # endregion

    # region DEFINICIÓN DE LA FUNCIÓN OBJETIVO

    # Valor máximo de concurrencia entre UC diferentes. Se utiliza para normalizar la concurrencia entre dos UC.
    max_co = max(co[c1, c2] for c1, c2 in co if c1 != c2) + 1

    problem += pl.lpSum(
        # Para cada par de cursos
        pl.lpSum(
            # Multiplicamos el peso de la distancia por la variable binaria correspondiente
            dist_peso[ds]
            * (co[c1, c2] / max_co + alpha * (1 / (dist_sem[c1, c2] + 1)))
            * w[c1, c2, ds]
            for ds in DS
        )
        for c1, c2 in PARES_UC
    ) + pl.lpSum(
        # Para los pares de previas
        pl.lpSum(
            beta
            * min(1, ds / 5)
            * (w[c1, c2, ds] if (c1, c2, ds) in w else w[c2, c1, ds])
            for ds in DS
        )
        for c1, c2 in P
    )
    # endregion

    # region DEFINICIÓN DE LAS RESTRICCIONES

    # Los cursos que tengan profesores coincidentes no pueden ser asignados el mismo turno
    for d in D:
        for t in Td[d]:
            for c1, c2 in COP:
                problem += (
                    x[c1, d, t] + x[c2, d, t] <= 1,
                    f"No_Solapamiento_COP_{c1}_{c2}_Dia_{d}_Turno_{t}",
                )

    # La evaluación de una UC se asigna a único día y turno:
    for c in C:
        problem += (
            pl.lpSum(x[c, d, t] for d in D for t in Td[d]) == 1,
            f"AsignacionUnica_{c}",
        )

    # En un turno no pueden haber mas de 6 evaluaciones
    for d in D:
        for t in Td[d]:
            problem += (
                pl.lpSum(x[c, d, t] for c in C) <= 6,
                f"MaximaEvaluacionesTurno_{d}_{t}",
            )

    # Si dos UC están sugeridas en el mismo semestre para la misma carrera, se asignan a días distintos
    for d in D:
        for c1, c2 in UC_MISMO_SEMESTRE:
            problem += (
                pl.lpSum(x[c1, d, t] + x[c2, d, t] for t in Td[d]) <= 1,
                f"Dias_Distintos_{c1}_{c2}_Dia_{d}",
            )

    # No se puede superar la capacidad disponible de los salones, teniendo en cuenta el factor de capacidad, para cada día y turno
    for d in D:
        for t in Td[d]:
            problem += (
                pl.lpSum(ins[c] * x[c, d, t] for c in C) <= cp[d, t] * fac_cp,
                f"Capacidad_{d}_{t}",
            )

    # Las evaluaciones que se pre-asignan a un conjunto de días y turnos, se asignan en alguno de ellos, y solo en uno.
    for c in PA.keys():
        problem += (pl.lpSum(x[c, d, t] for d, t in PA[c]) == 1, f"PreAsignacion_{c}")

    for c1, c2 in PARES_UC:
        # Calcular la diferencia entre los días asignados a c1 y c2
        day_time_c1 = pl.lpSum(
            time_value[(d, t)] * x[c1, d, t] for d in D for t in Td[d]
        )
        day_time_c2 = pl.lpSum(
            time_value[(d, t)] * x[c2, d, t] for d in D for t in Td[d]
        )

        # Restricciones para hacer que z valga efectivamente la diferencia absoluta
        problem += (
            day_time_c1 - day_time_c2 == z_plus[c1, c2] - z_minus[c1, c2],
            f"Diferencia_Dias_{c1}_{c2}",
        )

        problem += (
            z[c1, c2] == z_plus[c1, c2] + z_minus[c1, c2],
            f"Distancia_Absoluta_{c1}_{c2}",
        )

        problem += pl.lpSum(w[c1, c2, ds] for ds in DS) == 1
        problem += z[c1, c2] == pl.lpSum(ds * w[c1, c2, ds] for ds in DS)

        # Usar y para controlar qué parte de z_plus o z_minus está activa
        problem += (z_plus[c1, c2] <= M * y[c1, c2], f"Control_z_plus_{c1}_{c2}")
        problem += (
            z_minus[c1, c2] <= M * (1 - y[c1, c2]),
            f"Control_z_minus_{c1}_{c2}",
        )

        # Si dos cursos tienen alta coincidencia, deben asignarse al menos con una separacion de 2 dias.
        if co[c1, c2] >= alta_co:
            problem += (
                z[c1, c2] >= 2,
                f"Separacion_Minima_{c1}_{c2}",
            )
    # endregion

    # region SOLUCIÓN DEL PROBLEMA
    solver = None
    time_limit = time_limit_minutes * MINUTES
    cpu_cores = os.cpu_count() or 8

    match solver_name:
        case Solver.GUROBI_CMD:
            solver = pl.GUROBI_CMD(
                msg=1,
                threads=cpu_cores,
                timeLimit=time_limit,
                options=[
                    ("MIPFocus", 2),  # Enfocarse en buscar soluciones factibles rápido
                    ("Presolve", 2),  # Presolución agresiva
                    ("Cuts", 3),  # Generar cortes super agresivos
                    ("Heuristics", 0.5),  # Aumentar el esfuerzo heurístico
                    ("VarBranch", 3),  # Ramificación fuerte
                    ("NoRelHeurWork", 10),
                    # ("SolFiles", "solutions/test/solution"),
                    # ("InputFile", "solutions/solution_99.sol"),
                ],
            )
        case Solver.CPLEX_CMD:
            solver = pl.CPLEX_CMD(msg=1, threads=cpu_cores, timeLimit=time_limit)
        case Solver.PULP_CBC_CMD:
            solver = pl.PULP_CBC_CMD(msg=1, threads=cpu_cores, timeLimit=time_limit)
        case _:
            raise ValueError(f"Solver {solver_name} no soportado")

    start_time = timer()
    problem.solve(solver)
    end_time = timer()

    execution_time = end_time - start_time

    return (
        pl.value(problem.objective),
        execution_time,
        pl.LpStatus[problem.status],
        problem.variables(),
        datos.get("uc_descriptions"),
    )
    # endregion
