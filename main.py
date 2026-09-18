from solve import solve_model
from constants import Solver, Case
from generate_schedule import generate_schedule_csv
from datetime import datetime

if __name__ == "__main__":
    value, time, status, variables, uc_descriptions = solve_model(
        Case.large_1s1p, Solver.GUROBI_CMD, 0.5, 0.5, 180
    )

    print("Status:", status)

    if status != "Optimal":
        raise Exception(f"El problema no tiene solución óptima. Status: {status}")

    for v in variables:
        print(v.name, "=", v.varValue)

    print(f"Valor óptimo de la función objetivo: {value}")

    print(f"Tiempo de ejecución: {time:.2f} segundos")
    print(f"                     {time/60:.2f} minutos")

    generate_schedule_csv(variables, uc_descriptions, "schedule_1s1p_corregido.csv")
