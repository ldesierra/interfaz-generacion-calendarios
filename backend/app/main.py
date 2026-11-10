from fastapi import FastAPI

from backend.app.api import calendar, cases, changes, jobs

app = FastAPI(title="Interfaz de calendarios")


@app.get("/api/health")
def health() -> dict[str, str]:
    """Chequeo de vida para el health check del hosting (ver render.yaml)."""
    return {"status": "ok"}


app.include_router(cases.router)
app.include_router(changes.router)
app.include_router(calendar.router)
app.include_router(jobs.router)
