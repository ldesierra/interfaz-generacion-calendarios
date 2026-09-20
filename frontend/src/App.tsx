import { useState } from "react";
import { ApiError, solveCase } from "./api/client";
import type { JobStatusResponse, SolveParams } from "./api/types";
import { FileUploadForm } from "./components/FileUploadForm/FileUploadForm";
import { ParamsForm } from "./components/ParamsForm/ParamsForm";
import { ProgressScreen } from "./components/ProgressScreen/ProgressScreen";
import { ResultScreen } from "./components/ResultScreen/ResultScreen";
import "./App.css";

type Step =
  | { kind: "upload" }
  | { kind: "params"; caseId: string }
  | { kind: "progress"; jobId: string }
  | { kind: "result"; jobId: string };

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

  return (
    <main className="app">
      <h1>Correr el modelo de calendarios</h1>

      {step.kind === "upload" && (
        <section>
          <h2>1. Datos del caso</h2>
          <FileUploadForm onCaseCreated={(caseId) => setStep({ kind: "params", caseId })} />
        </section>
      )}

      {step.kind === "params" && (
        <section>
          <h2>2. Parámetros de la corrida</h2>
          <ParamsForm
            submitting={submittingParams}
            onSubmit={(params) => handleSolve(step.caseId, params)}
          />
          {solveError && (
            <p role="alert" className="app__error">
              {solveError}
            </p>
          )}
        </section>
      )}

      {step.kind === "progress" && (
        <section>
          <h2>3. Ejecutando el modelo</h2>
          <ProgressScreen jobId={step.jobId} onDone={handleProgressDone} />
        </section>
      )}

      {step.kind === "result" && (
        <section>
          <h2>4. Resultado</h2>
          <ResultScreen jobId={step.jobId} onRestart={handleRestart} />
        </section>
      )}
    </main>
  );
}

export default App;
