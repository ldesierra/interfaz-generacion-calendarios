import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarioTable } from "../components/CalendarioUpload/CalendarioTable";
import { CambiosStep } from "../components/CambiosStep/CambiosStep";
import { CalendarioUpload } from "../components/CalendarioUpload/CalendarioUpload";
import { FileUploadForm } from "../components/FileUploadForm/FileUploadForm";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import type { UcChange } from "../api/types";
import type { CalendarioExistente } from "../lib/calendario";
import { cn } from "../lib/utils";

type Step =
  | { kind: "calendario" }
  | { kind: "datos"; calendario: CalendarioExistente; calendarioFile: File }
  | {
      kind: "cambio";
      calendario: CalendarioExistente;
      calendarioFile: File;
      caseId: string;
      changes: UcChange[];
    }
  // Subtarea 4 (armar el caso derivado y resolver) arranca desde acá.
  | {
      kind: "guardado";
      calendario: CalendarioExistente;
      calendarioFile: File;
      caseId: string;
      changes: UcChange[];
    };

const STEPS = [
  { kind: "calendario", label: "Calendario vigente" },
  { kind: "datos", label: "Datos del caso" },
  { kind: "cambio", label: "Cambio" },
] as const;

function calendarioCodigos(calendario: CalendarioExistente): Set<string> {
  const codigos = new Set<string>();
  for (const turnos of Object.values(calendario.grilla)) {
    for (const evaluaciones of Object.values(turnos)) {
      for (const ev of evaluaciones) codigos.add(ev.codigo);
    }
  }
  return codigos;
}

export function ModificacionPage() {
  const [step, setStep] = useState<Step>({ kind: "calendario" });
  const currentIndex = STEPS.findIndex((s) => s.kind === (step.kind === "guardado" ? "cambio" : step.kind));

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1 text-center">
          <Link to="/" className="text-xs text-muted-foreground hover:underline">
            ← Volver al inicio
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Modificación de calendario existente</h1>
          <p className="text-sm text-muted-foreground">
            Cargá el calendario vigente y los datos base para ubicar un cambio puntual.
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
          {step.kind === "calendario" && (
            <>
              <CardHeader>
                <CardTitle>1. Calendario vigente</CardTitle>
              </CardHeader>
              <CardContent>
                <CalendarioUpload
                  onContinue={(calendario, calendarioFile) =>
                    setStep({ kind: "datos", calendario, calendarioFile })
                  }
                />
              </CardContent>
            </>
          )}

          {step.kind === "datos" && (
            <>
              <CardHeader>
                <CardTitle>2. Datos del caso</CardTitle>
              </CardHeader>
              <CardContent>
                <FileUploadForm
                  onCaseCreated={(caseId) =>
                    setStep({
                      kind: "cambio",
                      calendario: step.calendario,
                      calendarioFile: step.calendarioFile,
                      caseId,
                      changes: [],
                    })
                  }
                />
              </CardContent>
            </>
          )}

          {step.kind === "cambio" && (
            <>
              <CardHeader>
                <CardTitle>3. Cambios a realizar</CardTitle>
              </CardHeader>
              <CardContent>
                <CambiosStep
                  caseId={step.caseId}
                  codigosEnCalendario={calendarioCodigos(step.calendario)}
                  changes={step.changes}
                  onChange={(changes) => setStep({ ...step, changes })}
                  onContinue={() => setStep({ ...step, kind: "guardado" })}
                />
              </CardContent>
            </>
          )}

          {step.kind === "guardado" && (
            <>
              <CardHeader>
                <CardTitle>3. Cambios guardados</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm" data-testid="cambios-guardados">
                  {step.changes.length} {step.changes.length === 1 ? "cambio guardado" : "cambios guardados"}.
                  Ubicarlos en el calendario es la próxima tarea.
                </p>
                <ul className="flex flex-col gap-1 text-sm">
                  {step.changes.map((change) => (
                    <li key={change.codigo}>
                      {change.tipo === "alta" ? "Alta" : "Modificación"}:{" "}
                      <strong>
                        {change.nombre ?? ""} ({change.codigo})
                      </strong>
                    </li>
                  ))}
                </ul>
                <CalendarioTable calendario={step.calendario} />
                <div className="mb-6 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep({ ...step, kind: "cambio" })}
                  >
                    Editar cambios
                  </Button>
                </div>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
