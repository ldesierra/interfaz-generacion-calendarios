from fastapi import FastAPI

from backend.app.api import cases

app = FastAPI(title="Interfaz de calendarios")
app.include_router(cases.router)
