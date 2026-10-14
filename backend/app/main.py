from fastapi import FastAPI

from backend.app.api import cases, jobs

app = FastAPI(title="Interfaz de calendarios")
app.include_router(cases.router)
app.include_router(jobs.router)
