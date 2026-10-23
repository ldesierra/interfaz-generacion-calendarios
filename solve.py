from timeit import default_timer as timer

import os
import pulp as pl
import pandas as pd
from dotenv import load_dotenv

from csv_data_to_model_data import load_calendar_data
from constants import Solver, MINUTES

load_dotenv()


def _cop_conflict_groups(cop_pairs):
    """
    Agrupa los pares de UC con profesores coincidentes (COP) en componentes
    conexas. Cuando una componente es un clique completo (todas las UC del
    grupo son incompatibles entre sí), se puede reemplazar por una única
    restricción "a lo sumo una del grupo por turno", que es más fuerte (mejor
    relajación LP) que imponer la restricción par por par. Componentes que no
    son cliques completos se dejan como pares sueltos para no cambiar el
    conjunto de soluciones factibles.
    """
    from collections import defaultdict

    adj = defaultdict(set)
    nodes = set()
    for a, b in cop_pairs:
        adj[a].add(b)
        adj[b].add(a)
        nodes.add(a)
        nodes.add(b)

    visited = set()
    clique_groups = []
    leftover_pairs = []

    for start in nodes:
        if start in visited:
            continue

        stack = [start]
        component = set()
        while stack:
            n = stack.pop()
            if n in component:
                continue
            component.add(n)
            stack.extend(adj[n] - component)
        visited |= component

        is_clique = all((adj[n] | {n}) >= component for n in component)

        if is_clique and len(component) > 1:
            clique_groups.append(sorted(component))
        else:
            for a, b in cop_pairs:
                if a in component and b in component:
                    leftover_pairs.append((a, b))

    return clique_groups, leftover_pairs


def _load_sol_file(path):
    """Lee un warm start con los valores de una solución previa.

    Acepta tanto un .sol de Gurobi/CBC (líneas "nombre_variable valor") como
    un CSV de dos columnas (líneas "nombre_variable,valor"). Comentarios con #.
    """
    values = {}
    with open(path) as f:
        for line_number, line in enumerate(f, start=1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            name, _, val = line.rpartition(",") if "," in line else line.rpartition(" ")
            try:
                values[name.strip()] = float(val)
            except ValueError:
                raise ValueError(
                    f"El archivo de warm start no tiene el formato esperado en la línea "
                    f"{line_number} (se espera 'nombre_variable,valor' o 'nombre_variable "
                    f"valor'): {line!r}"
                ) from None
    return values


def solve_model(
    source,
    solver_name: Solver,
    alpha: float,
    beta: float,
    time_limit_minutes=15,
    warm_start_sol=None,
) -> tuple[float, float, str, list, dict, str]:
    """
    Args:
        source: path a un directorio con los CSV del caso, o un dict
            {nombre_csv: archivo} con archivos subidos (ver
            csv_data_to_model_data.load_calendar_data).
        warm_start_sol: path opcional a un .sol (formato Gurobi/CBC) con una
            solución previa para usar como punto de partida (solo tiene
            efecto con Solver.GUROBI_CMD). Encontrar la primera solución
            factible desde cero puede ser muy lento en casos grandes; si ya
            existe una solución conocida para el mismo caso (aunque haya
            sido calculada con una versión anterior del modelo, con más o
            menos pares de UC), pasarla acá deja que Gurobi arranque de ahí
            en vez de buscar a ciegas. Variables del .sol que no existen en
            el modelo actual se ignoran.

    Returns:
        (valor_objetivo, tiempo_ejecucion_seg, status, variables, uc_descriptions, solution_status)

        `status` (`pl.LpStatus`) y `solution_status` (`pl.LpSolution`) hay
        que mirarlos juntos: CBC, al llegar al `time_limit_minutes` con una
        solución entera factible pero sin probar que sea óptima, reporta
        `status="Optimal"` igual (una particularidad de cómo PuLP parsea la
        salida de CBC) — `solution_status` es lo único que distingue ese
        caso ("Solution Found") de un óptimo probado ("Optimal Solution
        Found"). Si el tiempo se agota sin encontrar ninguna solución
        entera, `status` pasa a ser "Not Solved".
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
    GRUPOS_MISMO_SEMESTRE = datos.get("GRUPOS_MISMO_SEMESTRE")
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

    if warm_start_sol is not None:
        seed_values = _load_sol_file(warm_start_sol)
        for var_dict in (x, w, z, z_plus, z_minus, y):
            for var in var_dict.values():
                if var.name in seed_values:
                    var.setInitialValue(seed_values[var.name], check=False)
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
    cop_clique_groups, cop_leftover_pairs = _cop_conflict_groups(COP)

    for d in D:
        for t in Td[d]:
            for idx, group in enumerate(cop_clique_groups):
                problem += (
                    pl.lpSum(x[c, d, t] for c in group) <= 1,
                    f"No_Solapamiento_COP_Grupo_{idx}_Dia_{d}_Turno_{t}",
                )
            for c1, c2 in cop_leftover_pairs:
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

    # Si dos o más UC están sugeridas en el mismo semestre para la misma carrera,
    # se asignan a días distintos (a lo sumo una del grupo por día)
    for d in D:
        for idx, group in enumerate(GRUPOS_MISMO_SEMESTRE):
            problem += (
                pl.lpSum(x[c, d, t] for c in group for t in Td[d]) <= 1,
                f"Dias_Distintos_Grupo_{idx}_Dia_{d}",
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
            # Usa gurobipy (bindings nativos) en vez del binario gurobi_cl,
            # para poder conectarse a una licencia WLS via variables de entorno
            # (GRB_WLSACCESSID / GRB_WLSSECRET / GRB_LICENSEID) sin depender
            # de tener el instalador completo de Gurobi.
            gurobi_env_options = {
                key: cast(os.environ[env_var])
                for key, env_var, cast in [
                    ("WLSACCESSID", "GRB_WLSACCESSID", str),
                    ("WLSSECRET", "GRB_WLSSECRET", str),
                    ("LICENSEID", "GRB_LICENSEID", int),
                ]
                if env_var in os.environ
            }
            solver = pl.GUROBI(
                msg=1,
                timeLimit=time_limit,
                manageEnv=True,
                envOptions=gurobi_env_options,
                warmStart=warm_start_sol is not None,
                Threads=cpu_cores,
                MIPFocus=1,  # Enfocarse en encontrar soluciones factibles rápido
                Presolve=2,  # Presolución agresiva
                Cuts=3,  # Generar cortes super agresivos
                Heuristics=0.5,  # Aumentar el esfuerzo heurístico
                VarBranch=3,  # Ramificación fuerte
                NoRelHeurWork=10,
            )
        case Solver.CPLEX_CMD:
            solver = pl.CPLEX_CMD(msg=1, threads=cpu_cores, timeLimit=time_limit)
        case Solver.HIGHS:
            # HiGHS (open source) via highspy, que ya viene como dependencia de
            # PuLP. Es bastante mas fuerte que CBC en este modelo y no necesita
            # licencia, asi que es la alternativa libre a Gurobi.
            solver = pl.HiGHS(msg=1, threads=cpu_cores, timeLimit=time_limit)
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
        pl.LpSolution[problem.sol_status],
    )
    # endregion
