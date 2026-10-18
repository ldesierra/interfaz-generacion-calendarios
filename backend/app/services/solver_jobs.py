"""Ejecución en background del solve y registro de jobs en memoria.

MVP: un registro en memoria (`_JOBS`) y un thread por job — corre en el
mismo proceso, sin cola ni worker aparte, según el supuesto de "un solo
usuario, sin concurrencia" del plan. Antes de construir el frontend de
progreso (subtarea 7) falta el spike de `docs/ARQUITECTURA_INTERFAZ.md`
§6: confirmar que esto se sostiene en el free tier de Vercel; si no
alcanza, esta capa es la que hay que reemplazar por una cola real.
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from backend.app.core.config import STORAGE_DIR
from backend.app.schemas.job import JobStatusName
from constants import Solver
from solve import solve_model

# CBC, al llegar al time_limit_minutes, puede terminar en varios estados
# combinados de (status, solution_status) — ver el docstring de
# `solve.solve_model`. Sólo "Optimal Solution Found" es un óptimo probado;
# "Solution Found" es la mejor solución entera encontrada antes de que se
# agotara el tiempo, y "Not Solved" es que ni siquiera se encontró una.
_TIMEOUT_MESSAGE_WITH_SOLUTION = (
    "Se alcanzó el tiempo límite antes de poder probar que la solución es óptima. "
    "Este calendario es factible y se puede usar, pero podría no ser el mejor "
    "posible — para intentar mejorarlo, volvé a correr con un tiempo límite mayor."
)
_TIMEOUT_MESSAGE_NO_SOLUTION = (
    "Se alcanzó el tiempo límite sin encontrar ningún calendario factible. "
    "Probá aumentar el tiempo límite, o revisar si el caso es demasiado grande "
    "para el tiempo disponible."
)


def _classify_solution(status: str, solution_status: str) -> tuple[JobStatusName, Optional[str]]:
    """Traduce (status, solution_status) de PuLP a un status de job + mensaje.

    Devuelve (job_status, message). `message` es `None` salvo para
    "timeout" (siempre) y "error" (el detalle del estado inesperado).
    """
    if status == "Optimal" and solution_status == "Optimal Solution Found":
        return "optimal", None
    if status == "Optimal" and solution_status == "Solution Found":
        return "timeout", _TIMEOUT_MESSAGE_WITH_SOLUTION
    if status == "Infeasible":
        return "infeasible", None
    if status == "Not Solved":
        return "timeout", _TIMEOUT_MESSAGE_NO_SOLUTION
    return "error", f"El solver terminó con un estado inesperado: {status} ({solution_status})"


@dataclass
class Job:
    job_id: str
    case_id: str
    nombre_corrida: str
    status: JobStatusName = "pending"
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error_message: Optional[str] = None
    # Mensaje accionable para status == "timeout" (ver _classify_solution).
    message: Optional[str] = None
    result: Optional[dict] = None

    def elapsed_seconds(self) -> Optional[float]:
        if self.started_at is None:
            return None
        end = self.finished_at or datetime.now(timezone.utc)
        return (end - self.started_at).total_seconds()


_JOBS: dict[str, Job] = {}
_JOBS_LOCK = threading.Lock()


def get_job(job_id: str) -> Optional[Job]:
    with _JOBS_LOCK:
        return _JOBS.get(job_id)


def start_solve_job(
    case_id: str, nombre_corrida: str, alpha: float, beta: float, time_limit_minutes: int
) -> Job:
    job = Job(job_id=uuid.uuid4().hex, case_id=case_id, nombre_corrida=nombre_corrida)
    with _JOBS_LOCK:
        _JOBS[job.job_id] = job

    thread = threading.Thread(
        target=_run_job,
        args=(job, alpha, beta, time_limit_minutes),
        daemon=True,
    )
    thread.start()
    return job


def _run_job(job: Job, alpha: float, beta: float, time_limit_minutes: int) -> None:
    job.status = "running"
    job.started_at = datetime.now(timezone.utc)

    case_dir = STORAGE_DIR / job.case_id
    try:
        value, execution_time, status, variables, uc_descriptions, solution_status = solve_model(
            case_dir, Solver.PULP_CBC_CMD, alpha, beta, time_limit_minutes
        )
    except Exception as exc:
        job.error_message = str(exc)
        job.status = "error"
        job.finished_at = datetime.now(timezone.utc)
        return

    job.finished_at = datetime.now(timezone.utc)
    new_status, message = _classify_solution(status, solution_status)

    if new_status == "error":
        job.error_message = message
        job.status = new_status
        return

    if new_status == "infeasible" or (new_status == "timeout" and value is None):
        # Infactible, o tiempo agotado sin encontrar ninguna solución entera:
        # no hay `result`/calendario que mostrar.
        job.message = message
        job.status = new_status
        return

    # "optimal", o "timeout" con una solución entera encontrada. `result` se
    # completa antes de exponer el status final: un lector que vea `status`
    # en un estado terminal (p.ej. GET /jobs/{id}/result, justo después de
    # que el polling de status vea el mismo cambio) tiene que encontrar
    # siempre `result` ya armado, nunca `None` a mitad de camino.
    job.result = {
        "objective_value": value,
        "execution_time_seconds": execution_time,
        "variables": variables,
        "uc_descriptions": uc_descriptions,
    }
    job.message = message
    job.status = new_status
