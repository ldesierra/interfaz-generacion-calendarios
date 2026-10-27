import argparse

from solve import solve_model
from constants import Solver, Case
from generate_schedule import generate_schedule_csv
from datetime import datetime

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--warm-start",
        action="store_true",
        help="Usar solutions/1s1p-v2/seed.sol como punto de partida para Gurobi.",
    )
    args = parser.parse_args()

    value, time, status, variables, uc_descriptions, solution_status = solve_model(
        Case.large_1s1p,
        Solver.GUROBI_CMD,
        0.5,
        0.5,
        180,
        warm_start_sol="solutions/1s1p-v2/seed.sol" if args.warm_start else None,
    )

    print("Status:", status, "-", solution_status)

    if value is None:
        raise Exception(f"No se encontró ninguna solución factible. Status: {status}")

    if status != "Optimal":
        print(f"Aviso: no se probó optimalidad (status: {status}), se muestra la mejor solución factible encontrada.")

    # Variables x_<uc>_<dia>_<turno> asignadas (valen 1) en la mejor solución encontrada.
    for v in variables:
        if v.name.startswith("x_") and v.varValue == 1.0:
            print(v.name, "=", v.varValue)

    print(f"Valor de la función objetivo: {value}")

    print(f"Tiempo de ejecución: {time:.2f} segundos")
    print(f"                     {time/60:.2f} minutos")

    generate_schedule_csv(variables, uc_descriptions, "schedule_1s1p_corregido.csv")
    print("Calendario escrito en schedule_1s1p_corregido.csv")
