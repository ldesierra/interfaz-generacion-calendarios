import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

from backend.app.schemas.case import CaseCreated, SchemaValidationError
from backend.app.services.case_storage import save_case_files
from backend.app.services.case_validation import REQUIRED_FILES, validate_case_files

router = APIRouter(prefix="/api")


@router.post(
    "/cases",
    status_code=201,
    response_model=CaseCreated,
    responses={422: {"model": SchemaValidationError}},
)
async def create_case(
    dias: UploadFile | None = File(default=None),
    unidades_curriculares: UploadFile | None = File(default=None),
    turnos: UploadFile | None = File(default=None),
    turnos_dias: UploadFile | None = File(default=None),
    semestres: UploadFile | None = File(default=None),
    carreras: UploadFile | None = File(default=None),
    trayectoria_sugerida: UploadFile | None = File(default=None),
    preasignaciones: UploadFile | None = File(default=None),
    previas: UploadFile | None = File(default=None),
    profesores: UploadFile | None = File(default=None),
    capacidad: UploadFile | None = File(default=None),
    inscriptos: UploadFile | None = File(default=None),
    coincidencia: UploadFile | None = File(default=None),
    datos: UploadFile | None = File(default=None),
):
    uploads: dict[str, UploadFile | None] = {
        "dias": dias,
        "unidades_curriculares": unidades_curriculares,
        "turnos": turnos,
        "turnos_dias": turnos_dias,
        "semestres": semestres,
        "carreras": carreras,
        "trayectoria_sugerida": trayectoria_sugerida,
        "preasignaciones": preasignaciones,
        "previas": previas,
        "profesores": profesores,
        "capacidad": capacidad,
        "inscriptos": inscriptos,
        "coincidencia": coincidencia,
        "datos": datos,
    }
    assert set(uploads) == set(REQUIRED_FILES)

    files_for_validation = {
        name: upload.file if upload is not None else None
        for name, upload in uploads.items()
    }
    issues = validate_case_files(files_for_validation)

    if issues:
        error = SchemaValidationError(details=issues)
        return JSONResponse(status_code=422, content=error.model_dump())

    case_id = uuid.uuid4().hex
    save_case_files(
        case_id, {name: upload.file for name, upload in uploads.items()}
    )

    return CaseCreated(
        case_id=case_id,
        created_at=datetime.now(timezone.utc),
        files_received=list(uploads.keys()),
    )
