from constants import Solver, Case, Weight
from generate_schedule import generate_schedule_csv
from solve import solve_model
import os
from itertools import product
from metrics import generate_metrics

if __name__ == "__main__":
    # Definir solver y caso a usar
    solver = Solver.GUROBI_CMD
    case = Case.large

    # Definir valores de alpha y beta a probar
    alpha_values = [Weight.WEIGHT_4]
    beta_values = [
        Weight.NO_WEIGHT,
        Weight.WEIGHT_1,
        Weight.WEIGHT_2,
        Weight.WEIGHT_3,
        Weight.WEIGHT_4,
    ]

    # Definir todas las combinaciones de alpha y beta
    parameter_combinations = list(product(alpha_values, beta_values))

    OUTPUT_DIR = "results_parameters_alpha:1"
    # Crear directorio de salida si no existe
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Crear archivo de resultados
    results_file = "results_file_alpha:1.csv"
    with open(results_file, "w") as f:
        f.write("alpha,beta,m_curricula,m_coincidencia,m_estudiantes,m_previas\n")

    for alpha, beta in parameter_combinations:
        print(f"\n{'='*80}")
        print(f"Ejecutando para alpha: {alpha}, beta: {beta}")
        print(f"{'='*80}")

        value, time, status, variables, uc_descriptions = solve_model(
            case, solver, alpha, beta, 60
        )

        print(f"Status {status}, valor {value}, tiempo {time:.2f} segundos")

        if status != "Optimal":
            with open(results_file, "a") as f:
                f.write(f"{alpha},{beta},-,-,-,-\n")

            continue

        # Generar timestamp para nombres de archivo únicos
        case_name = case.split("/")[-1]
        filename = (
            f"{OUTPUT_DIR}/schedule_caso:{case_name}_alpha:{alpha}_beta:{beta}.csv"
        )

        generate_schedule_csv(variables, uc_descriptions, filename)

        # Ejecutar métricas
        metrics = generate_metrics(
            filename,
            f"{case}/coincidencia.csv",
            f"data/previas.csv",
            f"{case}/trayectoria_sugerida.csv",
        )

        # Escribir resultados en el archivo de resultados
        with open(results_file, "a") as f:
            f.write(
                f"{alpha},{beta},{metrics['m_curricula']},{metrics['m_coincidencia']},{metrics['m_estudiantes']},{metrics['m_previas']}\n"
            )

    print("\nTodos los modelos completados!")
