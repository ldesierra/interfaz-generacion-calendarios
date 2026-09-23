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
- [ ] 2. Refactor de `solve.py` / `csv_data_to_model_data.py` para recibir archivos subidos en vez de leer de un directorio fijo — 8–12h
- [ ] 3. Endpoint(s) de carga de los CSVs grandes + validación de esquema (columnas esperadas, tipos, mensajes de error claros) — 6–10h
- [ ] 4. Formulario de parámetros menores (alpha, beta, tiempo límite, nombre del caso) con selects/inputs — 4–5h
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
- Próximo paso: subtarea 2 (refactor de `solve.py` / `csv_data_to_model_data.py` para recibir archivos subidos).
