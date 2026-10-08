import { useEffect, useState } from "react";
import { AlertTriangle, Download, RotateCcw } from "lucide-react";
import { ApiError, getJobResult, jobDownloadUrl, jobWarmStartDownloadUrl } from "../../api/client";
import type { JobResultResponse, UcChange } from "../../api/types";
import type { CalendarioExistente } from "../../lib/calendario";
import { ubicarCambios, type Ubicacion } from "../../lib/cambios";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button, buttonVariants } from "../ui/button";
import { ScheduleTable } from "../ScheduleTable/ScheduleTable";
import { cn } from "../../lib/utils";

interface ResultScreenProps {
  jobId: string;
  onRestart: () => void;
  // Edición de un calendario existente: cambios pedidos y calendario previo,
  // para resaltar en la grilla las UCs que se ubicaron.
  changes?: UcChange[];
  calendarioAnterior?: CalendarioExistente | null;
}

function ubicacionTexto({ dia, turno }: Ubicacion) {
  return `Día ${dia} Turno ${turno}`;
}

function RestartButton({ onRestart }: { onRestart: () => void }) {
  return (
    <Button type="button" variant="outline" onClick={onRestart} className="mb-3">
      <RotateCcw />
      Empezar de nuevo
    </Button>
  );
}

export function ResultScreen({ jobId, onRestart, changes, calendarioAnterior = null }: ResultScreenProps) {
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

  const highlights = Object.fromEntries((changes ?? []).map((c) => [c.codigo, c.tipo]));
  const ubicados = result?.schedule && changes ? ubicarCambios(result.schedule, changes, calendarioAnterior) : [];

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
    const reasons = result.infeasibility_reasons ?? [];
    // Si el primer mensaje es un encabezado ("...:"), el resto son los ítems.
    const hasHeader = reasons.length > 1 && reasons[0].endsWith(":");
    const intro = hasHeader ? reasons[0] : "El modelo no encontró un calendario factible:";
    const items = hasHeader ? reasons.slice(1) : reasons;
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="warning">
          <AlertTriangle />
          <AlertDescription>
            {reasons.length > 0 ? (
              <div className="flex flex-col gap-2" data-testid="infeasibility-reasons">
                <p>{intro}</p>
                <ul className="list-disc pl-5">
                  {items.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                El modelo no encontró un calendario factible con estos parámetros y estos datos.
                Probá ajustando alpha/beta, el tiempo límite, o revisá las preasignaciones y la
                capacidad del caso.
              </>
            )}
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

      {result.schedule && ubicados.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Cambios ubicados">
          <h3 className="text-sm font-medium">Cambios ubicados</h3>
          <ul className="flex flex-col gap-1 text-sm" data-testid="cambios-ubicados">
            {ubicados.map((cambio) => (
              <li key={cambio.codigo} className="flex flex-wrap items-center gap-2">
                <Badge variant={cambio.tipo === "alta" ? "default" : "secondary"}>
                  {cambio.tipo === "alta" ? "Nueva" : "Modificada"}
                </Badge>
                <span>
                  {cambio.nombre} <span className="text-muted-foreground">({cambio.codigo})</span>
                </span>
                <span className="text-muted-foreground">
                  →{" "}
                  {cambio.nueva ? ubicacionTexto(cambio.nueva) : "no quedó ubicada"}
                  {cambio.anterior &&
                    (cambio.nueva &&
                    cambio.nueva.dia === cambio.anterior.dia &&
                    cambio.nueva.turno === cambio.anterior.turno
                      ? " (sigue en el mismo lugar)"
                      : ` (antes: ${ubicacionTexto(cambio.anterior)})`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.schedule && <ScheduleTable schedule={result.schedule} highlights={highlights} />}

      <div className="flex items-center gap-3">
        <a className={cn(buttonVariants({ variant: "default" }))} href={jobDownloadUrl(jobId)}>
          <Download />
          Descargar CSV
        </a>
        <a
          className={cn(buttonVariants({ variant: "outline" }))}
          href={jobWarmStartDownloadUrl(jobId)}
        >
          <Download />
          Descargar warm start
        </a>
        <RestartButton onRestart={onRestart} />
      </div>
    </div>
  );
}
