from csv_data_to_model_data import load_calendar_data
from generate_schedule import generate_schedule_csv
from metrics import generate_metrics
import os


class Variable:
    def __init__(self, name, value):
        self.name = name
        self._value = float(value)

    def value(self):
        return self._value


# files = os.listdir("solutions")
# files = [file for file in files if os.path.isfile(f"solutions/{file}")]

# best = float("inf")
# best_file = None

# for file in files:
#     with open(f"solutions/{file}", "r") as f:
#         lines = f.readlines()
#     lines = [line.strip() for line in lines if line.startswith("x")]

#     variables = [
#         Variable(name, value) for name, value in [line.split(" ") for line in lines]
#     ]

#     generate_schedule_csv(variables, f"schedule_test.csv")
#     metrics = generate_metrics(
#         "schedule_test.csv",
#         "casos/caso_1s1p/coincidencia.csv",
#         "data/previas.csv",
#         "casos/caso_1s1p/trayectoria_sugerida.csv",
#     )

#     if metrics["m_estudiantes"] < best:
#         best = metrics["m_estudiantes"]
#         best_file = file

# print(best_file)
# print(best)

with open(f"solutions/test/solution_93.sol", "r") as f:
    lines = f.readlines()
lines = [line.strip() for line in lines if line.startswith("x")]

variables = [
    Variable(name, value) for name, value in [line.split(" ") for line in lines]
]

uc_descriptions = load_calendar_data("casos/caso_1s1p")["uc_descriptions"]
generate_schedule_csv(variables, uc_descriptions, f"schedule_test.csv")
