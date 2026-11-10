# Imagen del backend (FastAPI + solver). Sirve igual en Render, Fly, o un VPS
# con docker; el frontend se despliega aparte en Vercel (ver docs/DEPLOY.md).
FROM python:3.11-slim

# libgomp1: el binario de CBC que trae PuLP se enlaza contra OpenMP.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# requirements.lock.txt fija también las transitivas, para que un build de
# dentro de seis meses instale exactamente lo que se probó.
COPY requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.lock.txt

# El backend importa los módulos del modelo desde la raíz del repo
# (`from solve import solve_model`), así que van al mismo WORKDIR.
COPY solve.py csv_data_to_model_data.py generate_schedule.py constants.py ./
COPY backend/ ./backend/

ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    CASES_STORAGE_DIR=/data/cases

EXPOSE 8000

# --workers 1 no es negociable: el registro de jobs vive en memoria
# (`solver_jobs._JOBS`), así que con más de un worker un POST /solve y el
# polling de su job pueden caer en procesos distintos.
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
