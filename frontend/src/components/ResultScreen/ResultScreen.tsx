import { useEffect, useState } from "react";
import { ApiError, getJobResult, jobDownloadUrl } from "../../api/client";
import type { JobResultResponse } from "../../api/types";
import { ScheduleTable } from "../ScheduleTable/ScheduleTable";
import "./ResultScreen.css";

interface ResultScreenProps {
  jobId: string;
  onRestart: () => void;
}

export function ResultScreen({ jobId, onRestart }: ResultScreenProps) {
  const [result, setResult] = useState<JobResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);

    getJobResult(jobId)
      .then((body) => {
        if (!cancelled) setResult(body);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "No se pudo obtener el resultado.");
      });

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (error) {
    return (
      <div className="result-screen">
        <p role="alert" className="result-screen__error">
          {error}
        </p>
        <button type="button" onClick={onRestart}>
          Empezar de nuevo
        </button>
      </div>
    );
  }

  if (!result) {
    return <p>Cargando resultado...</p>;
  }

  if (result.status === "error") {
    return (
      <div className="result-screen">
        <p role="alert" className="result-screen__error">
          {result.error_message ?? "El solver terminó con un error."}
        </p>
        <button type="button" onClick={onRestart}>
          Empezar de nuevo
        </button>
      </div>
    );
  }

  if (result.status === "infeasible") {
    return (
      <div className="result-screen">
        <p className="result-screen__infeasible">
          El modelo no encontró un calendario factible con estos parámetros y estos datos.
          Probá ajustando alpha/beta, el tiempo límite, o revisá las preasignaciones y la
          capacidad del caso.
        </p>
        <button type="button" onClick={onRestart}>
          Empezar de nuevo
        </button>
      </div>
    );
  }

  if (result.status === "timeout" && !result.schedule) {
    return (
      <div className="result-screen">
        <p className="result-screen__timeout">
          {result.message ??
            "Se alcanzó el tiempo límite sin encontrar ningún calendario factible."}
        </p>
        <button type="button" onClick={onRestart}>
          Empezar de nuevo
        </button>
      </div>
    );
  }

  return (
    <div className="result-screen">
      {result.status === "timeout" && (
        <p role="alert" className="result-screen__timeout-warning">
          {result.message ?? "Se alcanzó el tiempo límite antes de probar que la solución es óptima."}
        </p>
      )}

      <dl className="result-screen__summary">
        <div>
          <dt>Valor de la función objetivo</dt>
          <dd>{result.objective_value?.toFixed(4)}</dd>
        </div>
        <div>
          <dt>Tiempo de ejecución</dt>
          <dd>{result.execution_time_seconds?.toFixed(1)} s</dd>
        </div>
      </dl>

      {result.schedule && <ScheduleTable schedule={result.schedule} />}

      <div className="result-screen__actions">
        <a className="result-screen__download" href={jobDownloadUrl(jobId)}>
          Descargar CSV
        </a>
        <button type="button" onClick={onRestart}>
          Empezar de nuevo
        </button>
      </div>
    </div>
  );
}
