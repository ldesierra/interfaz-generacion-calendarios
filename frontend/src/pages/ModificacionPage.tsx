import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  deriveCase,
  solveCase,
  uploadCalendar,
  uploadWarmStart,
  type DerivedCase,
} from "../api/client";
import type { SolveParams, UcChange } from "../api/types";
import { CalendarioUpload } from "../components/CalendarioUpload/CalendarioUpload";
import { CambiosStep } from "../components/CambiosStep/CambiosStep";
import { FileUploadForm } from "../components/FileUploadForm/FileUploadForm";
import { ParamsForm } from "../components/ParamsForm/ParamsForm";
import { ProgressScreen } from "../components/ProgressScreen/ProgressScreen";
import { ResultScreen } from "../components/ResultScreen/ResultScreen";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import type { CalendarioExistente } from "../lib/calendario";
import { cn } from "../lib/utils";

type StepKind = "calendario" | "datos" | "cambio" | "params" | "progress" | "result";

const STEPS: { kind: StepKind; label: string }[] = [
  { kind: "calendario", label: "Calendario" },
  { kind: "datos", label: "Datos" },
  { kind: "cambio", label: "Cambios" },
  { kind: "params", label: "Parámetros" },
  { kind: "progress", label: "Ejecución" },
  { kind: "result", label: "Resultado" },
];

function calendarioCodigos(calendario: CalendarioExistente): Set<string> {
  const codigos = new Set<string>();
  for (const turnos of Object.values(calendario.grilla)) {
    for (const evaluaciones of Object.values(turnos)) {
      for (const ev of evaluaciones) codigos.add(ev.codigo);
    }
  }
  return codigos;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

export function ModificacionPage() {
  const [step, setStep] = useState<StepKind>("calendario");
  const [calendario, setCalendario] = useState<{ data: CalendarioExistente; file: File } | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [changes, setChanges] = useState<UcChange[]>([]);
  const [derived, setDerived] = useState<DerivedCase | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentIndex = STEPS.findIndex((s) => s.kind === step);

  function goTo(next: StepKind) {
    setError(null);
    setStep(next);
  }

  // El calendario se sube al backend apenas existe el caso: ahí se valida
  // contra los datos (UCs, días y turnos) y, si no cuadra, el usuario corrige
  // los archivos sin avanzar.
  async function handleCaseCreated(newCaseId: string) {
    if (!calendario) return;
    setBusy(true);
    setError(null);
    try {
      await uploadCalendar(newCaseId, calendario.file);
      setCaseId(newCaseId);
      setChanges([]);
      setStep("cambio");
    } catch (err) {
      setError(errorMessage(err, "No se pudo cargar el calendario."));
    } finally {
      setBusy(false);
    }
  }

  async function handleDerive() {
    if (!caseId) return;
    setBusy(true);
    setError(null);
    try {
      setDerived(await deriveCase(caseId));
      setStep("params");
    } catch (err) {
      setError(errorMessage(err, "No se pudo preparar el caso."));
    } finally {
      setBusy(false);
    }
  }

  async function handleSolve(params: SolveParams, warmStartFile: File | null) {
    if (!derived) return;
    setBusy(true);
    setError(null);
    try {
      if (params.warm_start && warmStartFile) {
        await uploadWarmStart(derived.derived_case_id, warmStartFile);
      }
      const accepted = await solveCase(derived.derived_case_id, params);
      setJobId(accepted.job_id);
      setStep("progress");
    } catch (err) {
      setError(errorMessage(err, "No se pudo iniciar la corrida."));
    } finally {
      setBusy(false);
    }
  }

  const errorAlert = error && (
    <Alert variant="destructive">
      <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
    </Alert>
  );

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1 text-center">
          <Link to="/" className="text-xs text-muted-foreground hover:underline">
            ← Volver al inicio
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Modificación de calendario existente</h1>
          <p className="text-sm text-muted-foreground">
            Cargá el calendario vigente y los datos base para ubicar cambios puntuales.
          </p>
        </header>

        <ol className="flex flex-wrap items-center justify-center gap-2 text-xs font-medium text-muted-foreground">
          {STEPS.map((s, index) => (
            <li key={s.kind} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border text-[11px]",
                  index === currentIndex
                    ? "border-primary bg-primary text-primary-foreground"
                    : index < currentIndex
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-background",
                )}
              >
                {index + 1}
              </span>
              <span className={cn(index === currentIndex && "text-foreground")}>{s.label}</span>
              {index < STEPS.length - 1 && <span className="mx-1 h-px w-4 bg-border" />}
            </li>
          ))}
        </ol>

        <Card>
          {step === "calendario" && (
            <>
              <CardHeader>
                <CardTitle>1. Calendario vigente</CardTitle>
              </CardHeader>
              <CardContent>
                <CalendarioUpload
                  onContinue={(data, file) => {
                    setCalendario({ data, file });
                    goTo("datos");
                  }}
                />
              </CardContent>
            </>
          )}

          {step === "datos" && (
            <>
              <CardHeader>
                <CardTitle>2. Datos del caso</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <FileUploadForm onCaseCreated={handleCaseCreated} />
                {busy && <p className="text-sm text-muted-foreground">Validando el calendario…</p>}
                {errorAlert}
              </CardContent>
            </>
          )}

          {step === "cambio" && caseId && calendario && (
            <>
              <CardHeader>
                <CardTitle>3. Cambios a realizar</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <CambiosStep
                  caseId={caseId}
                  codigosEnCalendario={calendarioCodigos(calendario.data)}
                  changes={changes}
                  onChange={setChanges}
                  onContinue={handleDerive}
                  continuing={busy}
                />
                {errorAlert}
              </CardContent>
            </>
          )}

          {step === "params" && derived && (
            <>
              <CardHeader>
                <CardTitle>4. Parámetros de la corrida</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground" data-testid="resumen-derivado">
                  {derived.fixed_ucs} evaluaciones quedan fijas; el modelo ubica {derived.free_ucs.length}{" "}
                  {derived.free_ucs.length === 1 ? "UC" : "UCs"} ({derived.free_ucs.join(", ")}).
                </p>
                {derived.warnings.map((warning) => (
                  <Alert key={warning}>
                    <AlertDescription>{warning}</AlertDescription>
                  </Alert>
                ))}
                <ParamsForm submitting={busy} onSubmit={handleSolve} />
                {errorAlert}
              </CardContent>
            </>
          )}

          {step === "progress" && jobId && (
            <>
              <CardHeader>
                <CardTitle>5. Ejecutando el modelo</CardTitle>
              </CardHeader>
              <CardContent>
                <ProgressScreen jobId={jobId} onDone={() => goTo("result")} />
              </CardContent>
            </>
          )}

          {step === "result" && jobId && (
            <>
              <CardHeader>
                <CardTitle>6. Resultado</CardTitle>
              </CardHeader>
              <CardContent>
                <ResultScreen
                  jobId={jobId}
                  onRestart={() => goTo("cambio")}
                  changes={changes}
                  calendarioAnterior={calendario?.data ?? null}
                />
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
