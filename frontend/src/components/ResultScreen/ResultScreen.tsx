import { useEffect, useState } from "react";
import { AlertTriangle, Download, RotateCcw } from "lucide-react";
import { ApiError, getJobResult, jobDownloadUrl } from "../../api/client";
import type { JobResultResponse } from "../../api/types";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button, buttonVariants } from "../ui/button";
import { ScheduleTable } from "../ScheduleTable/ScheduleTable";
import { cn } from "../../lib/utils";

interface ResultScreenProps {
  jobId: string;
  onRestart: () => void;
}

function RestartButton({ onRestart }: { onRestart: () => void }) {
  return (
    <Button type="button" variant="outline" onClick={onRestart}>
      <RotateCcw />
      Empezar de nuevo
    </Button>
  );
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
      <div className="flex flex-col gap-4">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <RestartButton onRestart={onRestart} />
      </div>
    );
  }

  if (!result) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Cargando resultado...</p>;
  }

  if (result.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive">
          <AlertDescription>{result.error_message ?? "El solver terminó con un error."}</AlertDescription>
        </Alert>
        <RestartButton onRestart={onRestart} />
      </div>
    );
  }

  if (result.status === "infeasible") {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="warning">
          <AlertTriangle />
          <AlertDescription>
            El modelo no encontró un calendario factible con estos parámetros y estos datos.
            Probá ajustando alpha/beta, el tiempo límite, o revisá las preasignaciones y la
            capacidad del caso.
          </AlertDescription>
        </Alert>
        <RestartButton onRestart={onRestart} />
      </div>
    );
  }

  if (result.status === "timeout" && !result.schedule) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="warning">
          <AlertTriangle />
          <AlertDescription>
            {result.message ??
              "Se alcanzó el tiempo límite sin encontrar ningún calendario factible."}
          </AlertDescription>
        </Alert>
        <RestartButton onRestart={onRestart} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {result.status === "timeout" && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertDescription>
            {result.message ?? "Se alcanzó el tiempo límite antes de probar que la solución es óptima."}
          </AlertDescription>
        </Alert>
      )}

      <dl className="flex gap-6">
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-muted-foreground">Valor de la función objetivo</dt>
          <dd>
            <Badge variant="secondary" className="text-sm font-semibold">
              {result.objective_value?.toFixed(4)}
            </Badge>
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-muted-foreground">Tiempo de ejecución</dt>
          <dd>
            <Badge variant="secondary" className="text-sm font-semibold">
              {result.execution_time_seconds?.toFixed(1)} s
            </Badge>
          </dd>
        </div>
      </dl>

      {result.schedule && <ScheduleTable schedule={result.schedule} />}

      <div className="flex items-center gap-3">
        <a className={cn(buttonVariants({ variant: "default" }))} href={jobDownloadUrl(jobId)}>
          <Download />
          Descargar CSV
        </a>
        <RestartButton onRestart={onRestart} />
      </div>
    </div>
  );
}
