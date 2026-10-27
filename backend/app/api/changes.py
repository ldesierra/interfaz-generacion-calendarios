from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from backend.app.schemas.change import (
    Catalog,
    ChangeSet,
    ChangeValidationError,
    Coincidencia,
    EstimateRequest,
    UcDetail,
)
from backend.app.services import uc_change
from backend.app.services.case_storage import case_dir, is_valid_case_id

router = APIRouter(prefix="/api/cases/{case_id}")


def _require_case(case_id: str) -> None:
    # Validar el formato antes de tocar el filesystem (ver case_storage).
    if not is_valid_case_id(case_id) or not case_dir(case_id).is_dir():
        raise HTTPException(status_code=404, detail="case_not_found")


@router.get("/catalog", response_model=Catalog)
def get_catalog(case_id: str):
    _require_case(case_id)
    return uc_change.get_catalog(case_id)


@router.get("/ucs/{codigo}", response_model=UcDetail)
def get_uc(case_id: str, codigo: str):
    _require_case(case_id)
    detail = uc_change.get_uc_detail(case_id, codigo)
    if detail is None:
        raise HTTPException(status_code=404, detail="uc_not_found")
    return detail


@router.post("/estimate-coincidencia", response_model=list[Coincidencia])
def estimate_coincidencia(case_id: str, body: EstimateRequest):
    _require_case(case_id)
    return uc_change.estimate_coincidencias(
        case_id, body.inscriptos, body.trayectoria, exclude=body.codigo
    )


@router.put(
    "/changes",
    response_model=ChangeSet,
    responses={422: {"model": ChangeValidationError}},
)
def put_changes(case_id: str, body: ChangeSet):
    """Reemplaza el conjunto completo de cambios del caso (puede ser vacío)."""
    _require_case(case_id)
    issues = uc_change.validate_changes(case_id, body.changes)
    if issues:
        error = ChangeValidationError(details=issues)
        return JSONResponse(status_code=422, content=error.model_dump())
    uc_change.save_changes(case_id, body.changes)
    return body
