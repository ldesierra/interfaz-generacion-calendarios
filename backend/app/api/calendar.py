from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend.app.services import derived_case
from backend.app.services.case_storage import case_dir, is_valid_case_id

router = APIRouter(prefix="/api/cases/{case_id}")


class CalendarSaved(BaseModel):
    evaluaciones: int


class DerivedCaseCreated(BaseModel):
    derived_case_id: str
    fixed_ucs: int
    free_ucs: list[str]
    warnings: list[str]


def _require_case(case_id: str) -> None:
    if not is_valid_case_id(case_id) or not case_dir(case_id).is_dir():
        raise HTTPException(status_code=404, detail="el caso no existe")


@router.put("/calendar", response_model=CalendarSaved)
async def put_calendar(case_id: str, file: UploadFile = File(...)):
    """Guarda el calendario vigente del caso, validado contra sus datos."""
    _require_case(case_id)
    try:
        text = (await file.read()).decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail="el calendario no es un CSV en UTF-8")
    try:
        placements = derived_case.save_calendar(case_id, text)
    except derived_case.DerivedCaseError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return CalendarSaved(evaluaciones=len(placements))


@router.post("/derive", status_code=201, response_model=DerivedCaseCreated)
def derive_case(case_id: str):
    """Arma el caso derivado (calendario vigente + cambios). El caso nuevo se
    resuelve con `POST /api/cases/{derived_case_id}/solve`."""
    _require_case(case_id)
    try:
        derived = derived_case.build_derived_case(case_id)
    except derived_case.DerivedCaseError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return DerivedCaseCreated(
        derived_case_id=derived.case_id,
        fixed_ucs=derived.fixed_ucs,
        free_ucs=derived.free_ucs,
        warnings=derived.warnings,
    )
