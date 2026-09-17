# Arquitectura — Interfaz web para cargar datos y correr el modelo

Diseño para **Tarea 1, subtarea 1** de `PLAN_INTERFAZ_CALENDARIO.md`. Cubre endpoints, contrato front/back y estructura de carpetas. No incluye código de implementación (eso es la subtarea 2 en adelante).

## 1. Stack (según Supuestos y Riesgos)

- Backend: **FastAPI** (async nativo, validación de request/response con Pydantic, encaja con el endpoint de status/polling de la subtarea 5).
- Frontend: **React**.
- Deploy: Vercel free tier, un solo usuario, sin concurrencia.
- Solver: `PULP_CBC_CMD` únicamente.

## 2. Flujo end-to-end

```
1. Usuario sube los 11 CSVs de un caso  ──▶  POST /api/cases            ──▶  case_id
2. Usuario completa alpha/beta/solver/tiempo límite
3. Usuario dispara la corrida             ──▶  POST /api/cases/{id}/solve ──▶ job_id
4. Frontend hace polling                  ──▶  GET  /api/jobs/{id}         (pending → running → done/error)
5. Al terminar, frontend pide el resultado ──▶ GET  /api/jobs/{id}/result   (preview tabular)
6. Usuario descarga el CSV                ──▶  GET  /api/jobs/{id}/download
```

Esto mapea directo a las funciones que ya existen en el repo:

- `csv_data_to_model_data.load_calendar_data(dir_name)` — hoy lee de un directorio fijo en disco. La subtarea 2 la adapta para recibir los archivos subidos (via un directorio temporal por `case_id`, ver §5).
- `solve.solve_model(dir_name, solver_name, alpha, beta, time_limit_minutes)` — sin cambios de firma; se ejecuta en background (subtarea 5).
- `generate_schedule.generate_schedule_csv(variables, csv_name)` — genera el calendario resultante. **Nota:** hoy tiene hardcodeado `data/unidades_curriculares.csv` (línea 28) en vez de usar el directorio del caso — hay que corregirlo en la subtarea 2 para que lea del mismo `case_id`, si no las descripciones de UC van a salir mal (o van a fallar) para cualquier caso que no sea el que está en `data/`.

## 3. Endpoints

Prefijo común: `/api`.

### `POST /api/cases`
Sube los CSVs de un caso y valida esquema.

- Request: `multipart/form-data`, un archivo por cada uno de los 11 CSVs requeridos (nombres de campo = nombre de archivo sin extensión):
  `dias`, `unidades_curriculares`, `turnos`, `turnos_dias`, `semestres`, `carreras`, `trayectoria_sugerida`, `preasignaciones`, `previas`, `profesores`, `capacidad`, `inscriptos`, `coincidencia`, `datos`.
- Validación por archivo (columnas esperadas, ver §4): columnas presentes, tipos correctos, sin filas vacías donde no corresponde.
- Response `201`:
  ```json
  { "case_id": "b1e2...", "created_at": "2026-09-17T18:00:00Z", "files_received": ["dias", "unidades_curriculares", "..."] }
  ```
- Response `422` (error de validación):
  ```json
  {
    "error": "schema_validation_failed",
    "details": [
      { "file": "capacidad", "issue": "falta la columna 'id_turno'" },
      { "file": "datos", "issue": "falta la columna 'alta_co'" }
    ]
  }
  ```

### `POST /api/cases/{case_id}/solve`
Dispara una corrida del modelo sobre un caso ya cargado.

- Request:
  ```json
  { "alpha": 0.5, "beta": 0.5, "solver": "PULP_CBC_CMD", "time_limit_minutes": 15, "nombre_corrida": "corrida-1" }
  ```
  - `solver`: fijo a `PULP_CBC_CMD` en el MVP (único disponible en free tier, según Supuestos), pero se deja el campo por si se habilita Gurobi (licencia estudiante) más adelante.
- Response `202`:
  ```json
  { "job_id": "7f3a...", "case_id": "b1e2...", "status": "pending" }
  ```
- Response `404` si `case_id` no existe.

### `GET /api/jobs/{job_id}`
Status/polling (subtarea 5).

- Response `200`:
  ```json
  { "job_id": "7f3a...", "status": "running", "started_at": "...", "elapsed_seconds": 42 }
  ```
  `status` ∈ `pending | running | optimal | infeasible | error`.
- Si `status == "error"`, incluye `{ "error_message": "..." }` con el mensaje traducido a algo accionable (ver manejo de errores, subtarea 8).

### `GET /api/jobs/{job_id}/result`
Vista previa tabular una vez terminado (subtarea 6).

- Response `200` (si `status == "optimal"`):
  ```json
  {
    "objective_value": 123.45,
    "execution_time_seconds": 812.3,
    "schedule": {
      "dias": [1, 2, 3],
      "turnos": [1, 2],
      "grilla": { "1": { "1": ["Calculo Diferencial (cDiv)"], "2": [] }, "2": { "1": [] } }
    }
  }
  ```
- Response `409` si el job todavía no terminó.
- Response `200` con `status: "infeasible"` y sin `schedule` si el modelo no encontró solución.

### `GET /api/jobs/{job_id}/download`
Devuelve el CSV del calendario (`Content-Disposition: attachment`) generado por `generate_schedule_csv`.

## 4. Contrato de columnas por CSV (para la validación de `POST /api/cases`)

Relevado de `casos/caso_sm` y `casos/caso_1s1p` (ver `csv_data_to_model_data.load_csv`):

| Archivo | Columnas requeridas |
|---|---|
| `dias.csv` | `id` |
| `unidades_curriculares.csv` | `codigo`, `descripcion` |
| `turnos.csv` | `id` |
| `turnos_dias.csv` | `id_dia`, `id_turno` |
| `semestres.csv` | `id` |
| `carreras.csv` | `codigo`, `nombre` |
| `trayectoria_sugerida.csv` | `unidad_curricular`, `semestre`, `carrera` |
| `preasignaciones.csv` | `unidad_curricular`, `dia`, `turno` (puede estar vacío salvo cabecera) |
| `previas.csv` | `uc`, `uc_requerida` |
| `profesores.csv` | `uc_1`, `uc_2` |
| `capacidad.csv` | `id_dia`, `id_turno`, `capacidad` |
| `inscriptos.csv` | `uc`, `inscriptos` |
| `coincidencia.csv` | `uc_1`, `uc_2`, `coincidencia` |
| `datos.csv` | `fac_cp`, `alta_co` (una sola fila) |

**Nota de un caso real encontrado:** `casos/caso_sm/datos.csv` sólo tiene `fac_cp`, sin `alta_co` — con el `csv_data_to_model_data.py` actual eso rompe (`datos["alta_co"]` no existe). El validador de `POST /api/cases` tiene que detectar esto y devolver un 422 claro en vez de dejar que reviente más adelante en el solve.

## 5. Estructura de carpetas propuesta

```
proyecto-grado/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app, monta los routers
│   │   ├── api/
│   │   │   ├── cases.py            # POST /api/cases
│   │   │   └── jobs.py             # POST /solve, GET /jobs/{id}, /result, /download
│   │   ├── schemas/
│   │   │   ├── case.py             # Pydantic: CaseCreated, ValidationError
│   │   │   └── job.py              # Pydantic: SolveRequest, JobStatus, JobResult
│   │   ├── services/
│   │   │   ├── case_storage.py     # guarda los CSVs subidos en storage/{case_id}/*.csv
│   │   │   ├── case_validation.py  # tabla de columnas requeridas (§4) + chequeo
│   │   │   └── solver_jobs.py      # arma el job, llama a solve_model, guarda resultado
│   │   └── core/
│   │       └── config.py           # paths de storage, límites de tamaño de archivo, etc.
│   └── tests/
├── model/                          # el motor de optimización tal cual existe hoy
│   ├── solve.py
│   ├── csv_data_to_model_data.py
│   ├── generate_schedule.py
│   └── constants.py
├── frontend/
│   ├── src/
│   │   ├── pages/                  # Carga, Progreso, Resultado
│   │   ├── components/             # FileUploadForm, ParamsForm, ScheduleTable
│   │   └── api/                    # cliente HTTP (fetch de los endpoints de §3)
│   └── ...
├── casos/                          # casos de prueba existentes (no tocar)
└── PLAN_INTERFAZ_CALENDARIO.md
```

`model/` es el motor actual movido tal cual (la subtarea 2 lo adapta para leer de `storage/{case_id}/` en vez de un path fijo, no lo reescribe). `backend/app/services/` es la única capa nueva que conecta HTTP con el motor existente — mantiene `solve.py` y `csv_data_to_model_data.py` reusables también para la Tarea 2 (edición incremental), que va a llamar a los mismos servicios de carga y de solve con un `case_id` derivado del calendario vigente.

## 6. Decisiones que quedan abiertas para subtareas siguientes

- **Ejecución en background (subtarea 5):** Vercel free tier no tiene worker dedicado. Un `BackgroundTasks` de FastAPI dentro de la misma función serverless puede no sobrevivir más allá del ciclo de vida del request. Antes de construir el frontend de progreso, conviene un spike chico: correr un `solve` largo en un endpoint de Vercel y confirmar cuánto tiempo real se sostiene el proceso. Si no alcanza, la alternativa (cola simple + ping periódico, mencionada en Riesgos) se decide ahí, no acá.
- **Storage de los CSVs subidos y del resultado (subtarea 9):** en el MVP se asume filesystem temporal (`/tmp` en Vercel es efímero por invocación). Si el free tier no lo sostiene entre el upload y el solve, hay que sumar un storage externo (Vercel Blob u otro) — a definir en la subtarea 9, no bloquea el diseño de los endpoints de arriba.
