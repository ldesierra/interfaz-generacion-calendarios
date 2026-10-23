MINUTES = 60


# Definición de un Enum para los diferentes solvers soportados
class Solver:
    CPLEX_CMD = "CPLEX_CMD"
    GUROBI_CMD = "GUROBI_CMD"
    HIGHS = "HiGHS"
    PULP_CBC_CMD = "PULP_CBC_CMD"


# Definición de un Enum para los diferentes casos soportados
class Case:
    small = "casos/caso_sm"
    medium = "casos/caso_md"
    large_1s1p = "casos/caso_1s1p"
    large_1s2p = "casos/caso_1s2p"
    large_2s1p = "casos/caso_2s1p"
    large_2s2p = "casos/caso_2s2p"

# Definición de un Enum para los diferentes valores de ponderación
class Weight:
    NO_WEIGHT = 0
    WEIGHT_1 = 0.25
    WEIGHT_2 = 0.5
    WEIGHT_3 = 0.75
    WEIGHT_4 = 1

class TimeLimit:
    SMALL = 15
    MEDIUM = 30
    LARGE = 60
    XLARGE = 120
    XXLARGE = 180
    XXXLARGE = 240
