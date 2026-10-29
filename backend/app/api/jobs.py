from io import StringIO

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from backend.app.schemas.job import (
    JobResultResponse,
    JobStatusResponse,
    ScheduleGrid,
    SolveAccepted,
    SolveRequest,
)
from backend.app.services.case_storage import (
    case_dir,
    is_valid_case_id,
    save_warm_start_file,
    warm_start_path,
)
from backend.app.services.solver_jobs import get_job, start_solve_job
from generate_schedule import build_schedule_grid, write_schedule_csv, write_warm_start_csv

router = APIRouter(prefix="/api")

_NOT_FINISHED_STATUSES = ("pending", "running")


@router.post("/cases/{case_id}/warm-start", status_code=204)
async def upload_warm_start(case_id: str, file: UploadFile = File(...)):
    if not is_valid_case_id(case_id) or not case_dir(case_id).is_dir():
        raise HTTPException(status_code=404, detail="el caso no existe")

    save_warm_start_file(case_id, file.file)


@router.post("/cases/{case_id}/solve", status_code=202, response_model=SolveAccepted)
async def solve_case(case_id: str, request: SolveRequest):
    if not is_valid_case_id(case_id) or not case_dir(case_id).is_dir():
        raise HTTPException(status_code=404, detail="el caso no existe")

    if request.warm_start and not warm_start_path(case_id).is_file():
        raise HTTPException(
            status_code=400, detail="no se subió ningún archivo de warm start para este caso"
        )

    job = start_solve_job(
        case_id=case_id,
        nombre_corrida=request.nombre_corrida,
        solver=request.solver,
        alpha=request.alpha,
        beta=request.beta,
        time_limit_minutes=request.time_limit_minutes,
        warm_start=request.warm_start,
    )

    return SolveAccepted(job_id=job.job_id, case_id=job.case_id, status=job.status)


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="el job no existe")

    return JobStatusResponse(
        job_id=job.job_id,
        case_id=job.case_id,
        status=job.status,
        started_at=job.started_at,
        elapsed_seconds=job.elapsed_seconds(),
        error_message=job.error_message,
    )


@router.get("/jobs/{job_id}/result", response_model=JobResultResponse)
async def get_job_result(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="el job no existe")

    if job.status in _NOT_FINISHED_STATUSES:
        raise HTTPException(status_code=409, detail="el job todavía no terminó")

    if job.status == "error":
        return JobResultResponse(
            status="error",
            execution_time_seconds=job.elapsed_seconds(),
            error_message=job.error_message,
        )

    if job.status == "infeasible":
        return JobResultResponse(
            status="infeasible",
            execution_time_seconds=job.elapsed_seconds(),
            infeasibility_reasons=job.infeasibility_reasons,
        )

    if job.status == "timeout" and job.result is None:
        return JobResultResponse(
            status="timeout",
            execution_time_seconds=job.elapsed_seconds(),
            message=job.message,
        )

    # "optimal", o "timeout" con una solución factible encontrada.
    execution_time_seconds = job.result["execution_time_seconds"]
    max_day, max_turn, schedule = build_schedule_grid(
        job.result["variables"], job.result["uc_descriptions"]
    )
    grilla = {
        str(day): {str(turn): schedule[day][turn] for turn in range(1, max_turn + 1)}
        for day in range(1, max_day + 1)
    }

    return JobResultResponse(
        status=job.status,
        objective_value=job.result["objective_value"],
        execution_time_seconds=execution_time_seconds,
        schedule=ScheduleGrid(
            dias=list(range(1, max_day + 1)),
            turnos=list(range(1, max_turn + 1)),
            grilla=grilla,
        ),
        proven_optimal=job.status == "optimal",
        message=job.message,
    )


@router.get("/jobs/{job_id}/download")
async def download_job_result(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="el job no existe")

    if job.result is None:
        raise HTTPException(
            status_code=409, detail="el job no tiene un calendario para descargar"
        )

    buffer = StringIO()
    write_schedule_csv(job.result["variables"], job.result["uc_descriptions"], buffer)

    filename = f"calendario_{job.nombre_corrida.replace(' ', '_')}.csv"
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/jobs/{job_id}/warm-start-download")
async def download_job_warm_start(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="el job no existe")

    if job.result is None:
        raise HTTPException(
            status_code=409, detail="el job no tiene una solución para usar como warm start"
        )

    buffer = StringIO()
    write_warm_start_csv(job.result["variables"], buffer)

    filename = f"warm_start_{job.nombre_corrida.replace(' ', '_')}.csv"
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
