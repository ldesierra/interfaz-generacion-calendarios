import { useState } from "react";
import { ApiError, solveCase } from "./api/client";
import type { JobStatusResponse, SolveParams } from "./api/types";
import { FileUploadForm } from "./components/FileUploadForm/FileUploadForm";
import { ParamsForm } from "./components/ParamsForm/ParamsForm";
import { ProgressScreen } from "./components/ProgressScreen/ProgressScreen";
import { ResultScreen } from "./components/ResultScreen/ResultScreen";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { cn } from "./lib/utils";

type Step =
  | { kind: "upload" }
  | { kind: "params"; caseId: string }
  | { kind: "progress"; jobId: string }
  | { kind: "result"; jobId: string };

const STEPS = [
  { kind: "upload", label: "Datos del caso" },
  { kind: "params", label: "Parámetros" },
  { kind: "progress", label: "Ejecución" },
  { kind: "result", label: "Resultado" },
] as const;

function App() {
  const [step, setStep] = useState<Step>({ kind: "upload" });
  const [solveError, setSolveError] = useState<string | null>(null);
  const [submittingParams, setSubmittingParams] = useState(false);

  async function handleSolve(caseId: string, params: SolveParams) {
    setSubmittingParams(true);
    setSolveError(null);
    try {
      const accepted = await solveCase(caseId, params);
      setStep({ kind: "progress", jobId: accepted.job_id });
    } catch (err) {
      setSolveError(err instanceof ApiError ? err.message : "No se pudo iniciar la corrida.");
    } finally {
      setSubmittingParams(false);
    }
  }

  function handleRestart() {
    setSolveError(null);
    setStep({ kind: "upload" });
  }

  function handleProgressDone(status: JobStatusResponse) {
    setStep({ kind: "result", jobId: status.job_id });
  }

  const currentIndex = STEPS.findIndex((s) => s.kind === step.kind);

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Calendario de evaluaciones</h1>
          <p className="text-sm text-muted-foreground">
            Subí los datos del caso, elegí los parámetros y corré el modelo de optimización.
          </p>
        </header>

        <ol className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground">
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
          {step.kind === "upload" && (
            <>
              <CardHeader>
                <CardTitle>1. Datos del caso</CardTitle>
              </CardHeader>
              <CardContent>
                <FileUploadForm onCaseCreated={(caseId) => setStep({ kind: "params", caseId })} />
              </CardContent>
            </>
          )}

          {step.kind === "params" && (
            <>
              <CardHeader>
                <CardTitle>2. Parámetros de la corrida</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <ParamsForm
                  submitting={submittingParams}
                  onSubmit={(params) => handleSolve(step.caseId, params)}
                />
                {solveError && (
                  <Alert variant="destructive">
                    <AlertDescription>{solveError}</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </>
          )}

          {step.kind === "progress" && (
            <>
              <CardHeader>
                <CardTitle>3. Ejecutando el modelo</CardTitle>
              </CardHeader>
              <CardContent>
                <ProgressScreen jobId={step.jobId} onDone={handleProgressDone} />
              </CardContent>
            </>
          )}

          {step.kind === "result" && (
            <>
              <CardHeader>
                <CardTitle>4. Resultado</CardTitle>
              </CardHeader>
              <CardContent>
                <ResultScreen jobId={step.jobId} onRestart={handleRestart} />
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}

export default App;
