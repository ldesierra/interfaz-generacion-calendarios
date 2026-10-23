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
            el modelo actual se ignoran, así que una semilla vieja (con
            variables w/z/y de la formulación anterior) sigue sirviendo: de
            ella sólo se aprovechan las x, que son las que importan.

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

    # Costo que aporta cada par de UC a la función objetivo. Es continua: su
    # valor queda determinado por x a través de las restricciones Costo_* (ver
    # la región de restricciones), así que las únicas variables enteras del
    # modelo son las x.
    cost = {
        (c1, c2): pl.LpVariable(f"cost_{c1}_{c2}", lowBound=0) for c1, c2 in PARES_UC
    }

    if warm_start_sol is not None:
        seed_values = _load_sol_file(warm_start_sol)
        for var_dict in (x, cost):
            for var in var_dict.values():
                if var.name in seed_values:
                    var.setInitialValue(seed_values[var.name], check=False)
    # endregion

    # region DEFINICIÓN DE LA FUNCIÓN OBJETIVO
    problem += pl.lpSum(cost.values())
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

    # Costo de cada par de UC según los turnos que ocupan.
    #
    # El costo de un par depende sólo de la distancia entre los dos turnos
    # asignados, así que se puede tabular: q[s1, s2] es lo que aporta al
    # objetivo que c1 vaya en el turno s1 y c2 en el s2. Como cada UC ocupa
    # exactamente un turno (ver AsignacionUnica), para el s1 que c1 realmente
    # usa la fila queda
    #     cost >= sum_s2 q(s1, s2) * x[c2, s2] = q(s1, s2_real)
    # y para cualquier otro s1 el término -Mq la afloja. Como se minimiza,
    # cost baja hasta el valor exacto del par.
    #
    # Es la misma función objetivo que la versión con w/z/z_plus/z_minus/y,
    # pero sin ninguna binaria auxiliar. Aquellas quedaban determinadas por x
    # y aun así el solver ramificaba sobre ellas: eran el 96% de las binarias
    # del modelo, y la cadena big-M que las ligaba casi no propagaba, al punto
    # de que en caso_1s1p no aparecía ninguna solución factible. Acá la
    # linealización acepta cualquier q, convexa o no, así que tampoco hace
    # falta tratar distinto al término de previas (que es cóncavo y era
    # justamente lo que obligaba a que w fuera binaria).
    max_co = max(co[c1, c2] for c1, c2 in co if c1 != c2) + 1

    slots = [(d, t) for d in D for t in Td[d]]
    dist = {
        (s1, s2): abs(time_value[s1] - time_value[s2]) for s1 in slots for s2 in slots
    }
    slots_cercanos = {s1: [s2 for s2 in slots if dist[s1, s2] < 2] for s1 in slots}

    # Cuántas veces aparece cada par en P: el término de previas se suma una
    # vez por aparición, igual que en la versión anterior del objetivo.
    pares_uc_set = set(PARES_UC)
    previas_por_par = {}
    for c1, c2 in P:
        if (c1, c2) in pares_uc_set:
            par = (c1, c2)
        elif (c2, c1) in pares_uc_set:
            par = (c2, c1)
        else:
            raise KeyError(f"El par de previas ({c1}, {c2}) no está en PARES_UC")
        previas_por_par[par] = previas_por_par.get(par, 0) + 1

    for c1, c2 in PARES_UC:
        coef = co[c1, c2] / max_co + alpha * (1 / (dist_sem[c1, c2] + 1))
        n_previas = previas_por_par.get((c1, c2), 0)

        q = {}
        for s1 in slots:
            for s2 in slots:
                ds = dist[s1, s2]
                q[s1, s2] = coef * dist_peso[ds] + n_previas * beta * min(1, ds / 5)

        # Mq alcanza para aflojar la fila cuando c1 no va en s1: todo q es >= 0
        # y cost tiene lowBound=0, así que el lado derecho queda <= 0.
        Mq = max(q.values())

        for s1 in slots:
            problem += (
                cost[c1, c2]
                >= pl.lpSum(q[s1, s2] * x[(c2,) + s2] for s2 in slots)
                - Mq * (1 - x[(c1,) + s1]),
                f"Costo_{c1}_{c2}_Dia_{s1[0]}_Turno_{s1[1]}",
            )

        # Si dos cursos tienen alta coincidencia, deben asignarse al menos con
        # una separacion de 2 dias. Antes esto se imponía como z >= 2, o sea a
        # través de toda la cadena big-M; escrito directo sobre x es una
        # familia tipo clique que el solver sí propaga mientras busca una
        # solución factible.
        if co[c1, c2] >= alta_co:
            for s1 in slots:
                problem += (
                    x[(c1,) + s1]
                    + pl.lpSum(x[(c2,) + s2] for s2 in slots_cercanos[s1])
                    <= 1,
                    f"Separacion_Minima_{c1}_{c2}_Dia_{s1[0]}_Turno_{s1[1]}",
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
