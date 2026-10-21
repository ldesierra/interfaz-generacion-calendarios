import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ApiError, getJobStatus } from "../../api/client";
import type { JobStatusResponse } from "../../api/types";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";

const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES = new Set(["optimal", "infeasible", "timeout", "error"]);

const STATUS_LABELS: Record<string, string> = {
  pending: "En cola...",
  running: "Resolviendo el modelo...",
};

function formatElapsed(seconds: number | null): string {
  if (seconds === null) return "";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

interface ProgressScreenProps {
  jobId: string;
  onDone: (status: JobStatusResponse) => void;
}

export function ProgressScreen({ jobId, onDone }: ProgressScreenProps) {
  const [status, setStatus] = useState<JobStatusResponse | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let cancelled = false;
    setPollError(null);

    async function poll() {
      try {
        const body = await getJobStatus(jobId);
        if (cancelled) return;
        setStatus(body);
        if (TERMINAL_STATUSES.has(body.status)) {
          onDoneRef.current(body);
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setPollError(err instanceof ApiError ? err.message : "No se pudo consultar el estado del job.");
        return;
      }
      if (!cancelled) {
        timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    let timeoutId = window.setTimeout(poll, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [jobId, attempt]);

  if (pollError) {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <Alert variant="destructive">
          <AlertDescription>{pollError}</AlertDescription>
        </Alert>
        <Button type="button" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
          Reintentar
        </Button>
      </div>
    );
  }

  const label = status ? STATUS_LABELS[status.status] ?? status.status : "Iniciando...";

  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm font-medium">{label}</p>
      {status?.elapsed_seconds != null && (
        <p className="text-xs text-muted-foreground">
          Tiempo transcurrido: {formatElapsed(status.elapsed_seconds)}
        </p>
      )}
    </div>
  );
}
