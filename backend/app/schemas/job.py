import re
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

NOMBRE_CORRIDA_PATTERN = re.compile(r"^[\w\- ]+$")

JobStatusName = Literal["pending", "running", "optimal", "infeasible", "timeout", "error"]


class SolveRequest(BaseModel):
    alpha: float = Field(ge=0, le=1)
    beta: float = Field(ge=0, le=1)
    solver: Literal["PULP_CBC_CMD", "GUROBI_CMD"] = "PULP_CBC_CMD"
    time_limit_minutes: int = Field(gt=0, le=240)
    nombre_corrida: str
    warm_start: bool = False

    @field_validator("nombre_corrida")
    @classmethod
    def _validar_nombre_corrida(cls, value: str) -> str:
        nombre = value.strip()
        if not nombre:
            raise ValueError("el nombre de la corrida es obligatorio")
        if len(nombre) > 60:
            raise ValueError("el nombre de la corrida no puede superar los 60 caracteres")
        if not NOMBRE_CORRIDA_PATTERN.match(nombre):
            raise ValueError(
                "el nombre de la corrida sólo puede tener letras, números, espacios, "
                "guiones y guiones bajos"
            )
        return nombre


class SolveAccepted(BaseModel):
    job_id: str
    case_id: str
    status: JobStatusName


class JobStatusResponse(BaseModel):
    job_id: str
    case_id: str
    status: JobStatusName
    started_at: Optional[datetime] = None
    elapsed_seconds: Optional[float] = None
    error_message: Optional[str] = None


class ScheduleGrid(BaseModel):
    dias: list[int]
    turnos: list[int]
    # {"<dia>": {"<turno>": ["UC 1 (código)", ...]}} — claves como string
    # porque así viajan por JSON.
    grilla: dict[str, dict[str, list[str]]]


class JobResultResponse(BaseModel):
    status: JobStatusName
    objective_value: Optional[float] = None
    execution_time_seconds: Optional[float] = None
    schedule: Optional[ScheduleGrid] = None
    # true si `schedule` fue probado óptimo; false si viene de un
    # "timeout" con solución factible encontrada (ver solver_jobs.py);
    # None si no hay `schedule` (infeasible/error/timeout sin solución).
    proven_optimal: Optional[bool] = None
    # Mensaje accionable para "timeout" (con o sin `schedule`) — ver
    # `solver_jobs._TIMEOUT_MESSAGE_*`.
    message: Optional[str] = None
    error_message: Optional[str] = None
    # Para "infeasible": explicación de la causa, una frase por problema (ver
    # `services/feasibility.py`). Vacía si no se pudo determinar.
    infeasibility_reasons: Optional[list[str]] = None
