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

_SOLVE_STATUS_TO_JOB_STATUS: dict[str, JobStatusName] = {
    "Optimal": "optimal",
    "Infeasible": "infeasible",
}


@dataclass
class Job:
    job_id: str
    case_id: str
    status: JobStatusName = "pending"
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error_message: Optional[str] = None
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


def start_solve_job(case_id: str, alpha: float, beta: float, time_limit_minutes: int) -> Job:
    job = Job(job_id=uuid.uuid4().hex, case_id=case_id)
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
        value, execution_time, status, variables, uc_descriptions = solve_model(
            case_dir, Solver.PULP_CBC_CMD, alpha, beta, time_limit_minutes
        )
    except Exception as exc:
        job.error_message = str(exc)
        job.status = "error"
        job.finished_at = datetime.now(timezone.utc)
        return

    job.finished_at = datetime.now(timezone.utc)
    job.status = _SOLVE_STATUS_TO_JOB_STATUS.get(status, "error")

    if job.status == "error":
        job.error_message = f"El solver terminó con un estado inesperado: {status}"
        return

    job.result = {
        "objective_value": value,
        "execution_time_seconds": execution_time,
        "variables": variables,
        "uc_descriptions": uc_descriptions,
    }
