# Plan — Interfaz web para el modelo de calendarios

Fuente: `Estimacion_Interfaz_Calendario (1).xlsx` (Downloads). Este documento es el plan de trabajo vivo: volvé a esta página y decime "seguí con el plan" para retomar donde quedó.

**Supuestos del proyecto** (de la hoja "Supuestos y Riesgos"):
- Stack: FastAPI/Flask + frontend en React.
- Deploy: Vercel, plan gratuito, un solo usuario, sin concurrencia.
- Solver: único disponible es `PULP_CBC_CMD` (sin licencia Gurobi/CPLEX). Evaluar pedir licencia estudiante de Gurobi.
- Estimación hecha para un dev semi-senior, sin asistencia de IA. Con este asistente los tiempos reales pueden ser menores, pero se mantiene el desglose de la hoja como checklist de alcance.

**Riesgos principales:**
- Vercel free tier + solves largos: el free tier duerme por inactividad y no tiene worker dedicado. Si el solve tarda, puede requerir reducir agresivamente `TimeLimit`, ping periódico o cola simple — posible sobrecosto de días si la primera aproximación no alcanza.
- CBC vs. Gurobi: los tiempos de los logs del proyecto son con Gurobi multi-core. CBC en la CPU compartida de Vercel puede ser mucho más lento, sobre todo en casos grandes (`caso_1s1p`, `caso_2s2p`).

---

## Tarea 1 — Interfaz para cargar datos y correr el modelo (71–104 h)

Carga de CSVs grandes + selects/inputs para parámetros menores + ejecución del modelo y entrega del calendario.

- [x] 1. Diseño de arquitectura (endpoints, contrato front/back, estructura de carpetas) — 6–8h → ver `docs/ARQUITECTURA_INTERFAZ.md`
- [x] 2. Refactor de `solve.py` / `csv_data_to_model_data.py` para recibir archivos subidos en vez de leer de un directorio fijo — 8–12h
- [x] 3. Endpoint(s) de carga de los CSVs grandes + validación de esquema (columnas esperadas, tipos, mensajes de error claros) — 6–10h
- [x] 4. Formulario de parámetros menores (alpha, beta, tiempo límite, nombre del caso) con selects/inputs — 4–5h
- [ ] 5. Ejecución asíncrona del solve: job en background (no bloquear el request HTTP) + endpoint de status/polling — 10–14h
- [ ] 6. Endpoint de resultado: generación del CSV del calendario + vista previa tabular (día × turno) en la web — 10–14h
- [ ] 7. Frontend: carga de archivos, formulario, pantalla de progreso, tabla de resultado, descarga, estilos "user friendly" — 10–16h
- [ ] 8. Manejo de errores de punta a punta (Infeasible, datos incompletos, timeouts) — 5–7h
- [ ] 9. Deploy en Vercel y configuración de Storage free tier — 6–8h
- [ ] 10. Testing end-to-end con casos reales (chico y grande) y ajuste de tiempos reales en el free tier — 6–10h

## Tarea 2 — Edición incremental sobre el calendario perpetuo (45–67 h)

Cargar el calendario vigente como preasignaciones fijas + ubicar la mejor posición para un cambio puntual.

- [ ] 1. Parser: calendario CSV (grilla día/turno) → `preasignaciones.csv` (día/turno fijo por cada UC existente) — 6–8h
- [ ] 2. UI para cargar el calendario vigente + el resto de datos base del caso (reutiliza la carga de archivos de la Tarea 1) — 3–5h
- [ ] 3. UI + lógica para indicar el cambio: alta de UC nueva (código, nombre, carrera/semestre, previas, profesores en común, inscriptos) o modificación de una existente. *Cómo estimar la "coincidencia" de una UC nueva es una decisión de producto, no solo técnica* — 12–18h
- [ ] 4. Backend: armar el "caso derivado" (todo preasignado salvo lo que cambia), mezclar los CSVs base con los datos nuevos y correr `solve_model` — 12–16h
- [ ] 5. Manejo de infactibilidad (no hay hueco válido por capacidad/profesores) con mensaje claro al usuario — 4–6h
- [ ] 6. Mostrar el calendario resultante con el cambio resaltado — 4–6h
- [ ] 7. Testing con datos reales (tomar un `ema_schedule_*.csv` existente y simular altas/modificaciones) — 4–8h

---

## Resumen

| Concepto | Horas mín | Horas máx |
|---|---|---|
| Tarea 1 — Interfaz de carga y ejecución del modelo | 71 | 104 |
| Tarea 2 — Edición incremental sobre calendario perpetuo | 45 | 67 |
| **TOTAL ESTIMADO** | **116** | **171** |

## Progreso

_(Actualizar acá a medida que se avanza: qué tarea/subtarea está en curso, decisiones tomadas, bloqueos.)_

- 2026-09-17: Tarea 1 / subtarea 1 (diseño de arquitectura) hecha. Doc en `docs/ARQUITECTURA_INTERFAZ.md`: stack FastAPI + React, 4 endpoints (`POST /api/cases`, `POST /api/cases/{id}/solve`, `GET /api/jobs/{id}`, `GET /api/jobs/{id}/result`, `GET /api/jobs/{id}/download`), contrato de columnas por CSV, estructura de carpetas (`backend/`, `model/`, `frontend/`).
  - Bug detectado a corregir en la subtarea 2: `generate_schedule.py:28` lee `data/unidades_curriculares.csv` hardcodeado en vez del directorio del caso.
  - Caso `casos/caso_sm/datos.csv` no tiene la columna `alta_co` que el código actual espera — el validador de `POST /api/cases` tiene que atajar esto.
  - Quedan abiertas (no bloquean el diseño, se resuelven en su subtarea): mecanismo real de ejecución en background en Vercel free tier (subtarea 5) y storage de archivos subidos/resultado (subtarea 9).
- 2026-09-18: Tarea 1 / subtarea 2 (refactor para recibir archivos subidos) hecha.
  - `csv_data_to_model_data.load_calendar_data` ahora acepta un `dir_name` (disco, comportamiento anterior) **o** un `dict {nombre_csv: archivo}` (cualquier cosa que `pandas.read_csv` lea: `UploadFile.file`, `BytesIO`, etc.) — sin escribir a disco primero. También devuelve `uc_descriptions`.
  - `solve.solve_model` devuelve ahora `(valor, tiempo, status, variables, uc_descriptions)` — un elemento más que antes.
  - `generate_schedule.generate_schedule_csv(variables, uc_descriptions, csv_name)` — se sacó el hardcodeo de `data/unidades_curriculares.csv` (el bug detectado en la subtarea 1); ahora recibe las descripciones ya cargadas por `load_calendar_data`.
  - Se actualizaron los 3 call sites existentes (`main.py`, `evaluate_alpha_and_turns_consideration.py`, `solution_to_calendar.py`) para el nuevo contrato.
  - **Hallazgo importante corrigiendo la subtarea 1:** `unidades_curriculares.csv` no tiene siempre columna `descripcion` — los casos grandes (`1s1p`, `1s2p`, `2s1p`, `2s2p`, `md`) usan `unidad_curricular` en su lugar. `load_calendar_data` soporta ambas. Se corrigió `docs/ARQUITECTURA_INTERFAZ.md` §4 en consecuencia.
  - Verificado (sin poetry disponible en este entorno — se armó un venv aparte sólo para probar): `load_calendar_data` da resultados idénticos leyendo de disco vs. de un dict de `BytesIO` simulando uploads sobre `casos/caso_1s1p`; corrida real end-to-end con CBC (disco y "upload") generando el CSV del calendario con descripciones correctas en ambos casos.
  - Sin cambios de comportamiento para los llamados existentes desde disco (mismo `dir_name` como antes).
- 2026-09-19: Tarea 1 / subtarea 3 (endpoint de carga + validación de esquema) hecha.
  - Arrancó `backend/` (no existía todavía pese a que la subtarea 2 ya había tocado el motor): `backend/app/main.py` (FastAPI), `backend/app/api/cases.py` (`POST /api/cases`), `backend/app/schemas/case.py` (`CaseCreated`, `ValidationIssue`, `SchemaValidationError`), `backend/app/services/case_validation.py` (tabla de columnas requeridas de §4 de `docs/ARQUITECTURA_INTERFAZ.md` + validación), `backend/app/services/case_storage.py` (guarda los 14 CSVs subidos en `storage/cases/{case_id}/`), `backend/app/core/config.py` (path de storage configurable por env var).
  - Endpoint valida, por archivo: columna(s) requerida(s) presentes (con el caso especial de `unidades_curriculares` aceptando `descripcion` **o** `unidad_curricular`), sin valores vacíos en columnas requeridas, columnas numéricas efectivamente numéricas, exactamente una fila en `datos.csv`, y `preasignaciones.csv` como único archivo que puede no tener filas. Devuelve `422` con la forma exacta de `docs/ARQUITECTURA_INTERFAZ.md` §3 (`{"error": "schema_validation_failed", "details": [...]}`) o `201` con `case_id`/`created_at`/`files_received` y los CSVs guardados en disco.
  - Confirmado con los casos reales: `caso_1s1p` (y el resto de los casos grandes) pasa validación completa; `caso_sm` y `caso_md` fallan con `{"file": "datos", "issue": "falta la columna 'alta_co'"}` — exactamente el problema que iba a romper el solve más adelante (detectado en la subtarea 1/2).
  - Se agregaron `fastapi`, `uvicorn`, `python-multipart` a `pyproject.toml` (más `pytest`/`httpx` como dev deps). **Sin poetry disponible en este entorno** (mismo problema que la subtarea 2: el binario de poetry tiene un intérprete roto) no se pudo correr `poetry lock` — el lockfile quedó desactualizado respecto al `pyproject.toml` nuevo. Hay que correr `poetry lock` en un entorno con poetry funcional antes del próximo `poetry install`.
  - 16 tests nuevos en `backend/tests/` (`test_case_validation.py` con los CSVs reales de `casos/` + casos sintéticos de error, `test_cases_api.py` con `TestClient` end a end) — todos verdes en un venv de python3.11 aparte (mismo workaround que la subtarea 2). También probado a mano levantando `uvicorn` y pegándole con `curl` con archivos reales de `caso_1s1p` (201) y `caso_sm` (422).
  - Próximo paso: subtarea 4 (formulario de parámetros menores) o subtarea 5 (ejecución asíncrona del solve) — cualquiera de las dos ya puede apoyarse en `POST /api/cases`.
- 2026-09-20: Tarea 1 / subtarea 4 (formulario de parámetros menores) hecha.
  - Arrancó `frontend/` (no existía todavía): Vite + React + TypeScript, siguiendo la estructura de `docs/ARQUITECTURA_INTERFAZ.md` §5 (`src/components/`, `src/api/`). `src/api/types.ts` define el contrato de `POST /api/cases/{case_id}/solve` (§3 del doc de arquitectura).
  - `alpha` y `beta` son selects (no inputs libres) sobre los valores del enum `Weight` de `constants.py` (`0, 0.25, 0.5, 0.75, 1`); `tiempo límite` es un select sobre los valores del enum `TimeLimit` (`15/30/60/120/180/240` min). `solver` queda fijo a `PULP_CBC_CMD` (único soportado, ver Supuestos), como select deshabilitado para no romper el contrato cuando se habilite Gurobi. `nombre del caso` es un input de texto, obligatorio, validado contra `^[\w\- ]+$` (va a nombrar el archivo de resultado en la subtarea 6) — errores inline, sin bloquear la edición.
  - Componente `ParamsForm` (`frontend/src/components/ParamsForm/`) queda desacoplado del resto de la página: recibe `onSubmit`/`submitting`/`initialValues` y no sabe nada de la carga de archivos ni del polling — se integra al resto en la subtarea 7. `App.tsx` lo renderiza standalone por ahora (el submit sólo hace `console.log`, todavía no hay endpoint de solve — subtarea 5).
  - 6 tests con Vitest + Testing Library (`ParamsForm.test.tsx`) cubriendo: submit con defaults y nombre recortado, selección de alpha/beta/tiempo límite, bloqueo por nombre vacío, bloqueo por caracteres inválidos, limpieza del error al reeditar, botón deshabilitado mientras `submitting`. Verificado `npm run build` (typecheck + vite build) y `npm run test`, ambos verdes.
  - **Fricción de setup:** el scaffold de Vite instaló `vite@8` + `@vitejs/plugin-react@6`, pero `vitest@3.2.7` sólo soporta `vite ^5||^6||^7` — el build fallaba por conflicto de tipos entre las dos copias de Vite. Se fijaron `vite@7.3.6` y `@vitejs/plugin-react@4.7.0` para que todo dedupee a una sola versión de Vite.
  - No se pudo verificar visualmente en el navegador (la extensión de Claude in Chrome no está conectada en este entorno) — sólo se confirmó por `curl` que `npm run dev` sirve el HTML esperado.
  - Próximo paso: subtarea 5 (ejecución asíncrona del solve) para tener un endpoint real al que este formulario le pueda pegar, o subtarea 7 para integrar `ParamsForm` a la página completa junto con la carga de archivos.
