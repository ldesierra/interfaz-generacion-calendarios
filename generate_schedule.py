import csv


def build_schedule_grid(variables, uc_descriptions=None):
    """
    Arma la grilla día×turno a partir de las variables x_<uc>_<dia>_<turno>
    del problema resuelto que valen 1.

    Args:
        variables: variables del problema resuelto (o reconstruidas desde un
            .sol); se usan solo las que empiezan con "x_" y valen 1.
        uc_descriptions: dict {codigo_uc: descripcion}, ver
            csv_data_to_model_data.load_calendar_data. Si no se pasa, se usa
            directamente el código de la UC.

    Returns:
        (max_day, max_turn, schedule) donde `schedule` es
        {dia: {turno: [descripcion_uc, ...]}} con `dia` en 1..max_day y
        `turno` en 1..max_turn.
    """
    uc_descriptions = uc_descriptions or {}

    # Nos quedamos solo con las variables x que valen 1.
    schedule_vars = {}
    for v in variables:
        if v.name.startswith("x_") and v.value() == 1.0:
            schedule_vars[v.name] = v.value()

    # Extraemos los días y turnos máximos de las variables
    max_day = 1
    max_turn = 1
    for var_name in schedule_vars:
        # Las variables tienen la forma x_<uc>_<dia>_<turno>
        parts = var_name.split("_")
        _, _, day, turn = parts
        max_day = max(max_day, int(day))
        max_turn = max(max_turn, int(turn))

    # Creamos un diccionario con la estructura de la tabla.
    schedule = {
        i: {j: [] for j in range(1, max_turn + 1)} for i in range(1, max_day + 1)
    }

    # Procesamos cada una de las variables para agregarlas al schedule.
    for var_name in schedule_vars:
        parts = var_name.split("_")
        _, uc, day, turn = parts

        # Buscamos la descripción de la UC. Fallback al código si no se encuentra.
        uc_description = uc_descriptions.get(uc, uc)

        schedule[int(day)][int(turn)].append(uc_description)

    return max_day, max_turn, schedule


def write_schedule_csv(variables, uc_descriptions, csv_file):
    """Escribe la grilla día×turno como CSV en `csv_file` (un objeto
    file-like abierto en modo texto, p.ej. el que devuelve `open()` o un
    `io.StringIO`)."""
    max_day, max_turn, schedule = build_schedule_grid(variables, uc_descriptions)

    writer = csv.writer(csv_file)

    # Encabezado
    header = ["Día/Turno"] + [f"Turno {i}" for i in range(1, max_turn + 1)]
    writer.writerow(header)

    # Cuerpo principal
    for day in range(1, max_day + 1):
        row = [f"Día {day}"]

        # Procesamos cada turno
        for turn in range(1, max_turn + 1):
            cell = " & ".join(schedule[day][turn]) if schedule[day][turn] else ""
            row.append(cell)

        writer.writerow(row)


def generate_schedule_csv(variables, uc_descriptions=None, csv_name="schedule.csv"):
    """
    Args:
        variables: ver `build_schedule_grid`.
        uc_descriptions: ver `build_schedule_grid`.
        csv_name: ruta del CSV de salida.
    """
    with open(csv_name, "w", newline="") as csvfile:
        write_schedule_csv(variables, uc_descriptions, csvfile)
