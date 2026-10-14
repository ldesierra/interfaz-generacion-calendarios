from fastapi import APIRouter, HTTPException

from backend.app.schemas.job import JobStatusResponse, SolveAccepted, SolveRequest
from backend.app.services.case_storage import case_dir, is_valid_case_id
from backend.app.services.solver_jobs import get_job, start_solve_job

router = APIRouter(prefix="/api")


@router.post("/cases/{case_id}/solve", status_code=202, response_model=SolveAccepted)
async def solve_case(case_id: str, request: SolveRequest):
    if not is_valid_case_id(case_id) or not case_dir(case_id).is_dir():
        raise HTTPException(status_code=404, detail="el caso no existe")

    job = start_solve_job(
        case_id=case_id,
        alpha=request.alpha,
        beta=request.beta,
        time_limit_minutes=request.time_limit_minutes,
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
