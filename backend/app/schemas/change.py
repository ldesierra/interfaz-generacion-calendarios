from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Trayectoria(BaseModel):
    carrera: str
    semestre: int


class Coincidencia(BaseModel):
    uc: str
    coincidencia: float = Field(ge=0)


class UcChange(BaseModel):
    """Cambio puntual sobre el calendario vigente.

    Siempre describe el estado final completo de la UC (no un diff): para una
    modificación el frontend precarga el estado actual y el usuario edita; el
    caso derivado (subtarea 4) reemplaza todas las filas de la UC con esto.
    """

    tipo: Literal["alta", "modificacion"]
    codigo: str
    nombre: str | None = None  # obligatorio sólo en altas
    inscriptos: float = Field(ge=0)
    trayectoria: list[Trayectoria]
    previas: list[str] = []  # UCs requeridas
    profesores: list[str] = []  # UCs que comparten profesor
    coincidencias: list[Coincidencia] = []

    @field_validator("codigo", "nombre")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v


class UcSummary(BaseModel):
    codigo: str
    nombre: str


class Carrera(BaseModel):
    codigo: str
    nombre: str


class Catalog(BaseModel):
    ucs: list[UcSummary]
    carreras: list[Carrera]
    semestres: list[int]


class UcDetail(UcSummary):
    inscriptos: float
    trayectoria: list[Trayectoria]
    previas: list[str]
    profesores: list[str]
    coincidencias: list[Coincidencia]


class EstimateRequest(BaseModel):
    codigo: str | None = None  # si es una modificación, se excluye a sí misma
    inscriptos: float = Field(ge=0)
    trayectoria: list[Trayectoria]


class ChangeSet(BaseModel):
    changes: list[UcChange]


class ChangeIssue(BaseModel):
    index: int  # posición del cambio dentro de `changes`
    field: str
    issue: str


class ChangeValidationError(BaseModel):
    error: Literal["change_validation_failed"] = "change_validation_failed"
    details: list[ChangeIssue]
