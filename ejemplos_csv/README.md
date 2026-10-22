# Ejemplos de CSVs

Los 14 CSVs que pide `POST /api/cases` (ver la interfaz web), copiados tal
cual de `casos/caso_1s1p` — un caso real, no datos inventados. Sirven para
ver el formato exacto esperado por cada archivo antes de armar un caso
propio.

El contrato completo (columnas requeridas, cuáles pueden ser numéricas,
cuáles pueden no tener filas) está implementado en
`backend/app/services/case_validation.py` y resumido acá:

| Archivo | Columnas requeridas | Notas |
|---|---|---|
| `dias.csv` | `id` | un id por día del calendario |
| `unidades_curriculares.csv` | `codigo` + (`descripcion` **o** `unidad_curricular`) | `descripcion`/`unidad_curricular` es el nombre completo de la UC; alcanza con una de las dos columnas (este ejemplo usa `unidad_curricular`) |
| `turnos.csv` | `id` | un id por turno del día |
| `turnos_dias.csv` | `id_dia`, `id_turno` | qué turnos están disponibles en cada día |
| `semestres.csv` | `id` | |
| `carreras.csv` | `codigo`, `nombre` | |
| `trayectoria_sugerida.csv` | `unidad_curricular`, `semestre`, `carrera` | en qué semestre de qué carrera se sugiere cada UC (`unidad_curricular` acá es el código, no el nombre) |
| `preasignaciones.csv` | `unidad_curricular`, `dia`, `turno` | es el único archivo que puede no tener filas (sólo la cabecera) si el caso no tiene evaluaciones ya fijadas |
| `previas.csv` | `uc`, `uc_requerida` | pares de UC con relación de previatura |
| `profesores.csv` | `uc_1`, `uc_2` | pares de UC con profesores en común (no pueden coincidir en el mismo turno) |
| `capacidad.csv` | `id_dia`, `id_turno`, `capacidad` | cupo de salones disponible por día/turno |
| `inscriptos.csv` | `uc`, `inscriptos` | cantidad de inscriptos por UC |
| `coincidencia.csv` | `uc_1`, `uc_2`, `coincidencia` | cantidad de estudiantes inscriptos simultáneamente a cada par de UC |
| `datos.csv` | `fac_cp`, `alta_co` | una sola fila: factor de capacidad de los salones y umbral de "alta coincidencia" entre UC |

Todas las columnas marcadas como numéricas en el validador (ids, `dia`,
`turno`, `capacidad`, `inscriptos`, `coincidencia`, `fac_cp`, `alta_co`,
`semestre`) tienen que poder convertirse a número — si alguna fila las deja
vacías o con texto, `POST /api/cases` devuelve `422` señalando exactamente
qué archivo y qué problema.
