import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { CheckCircle2, Circle, UploadCloud } from "lucide-react";
import { createCase, SchemaValidationApiError } from "../../api/client";
import { REQUIRED_FILES, type RequiredFileName } from "../../api/types";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { cn } from "../../lib/utils";

const LABELS: Record<RequiredFileName, string> = {
  dias: "Días",
  unidades_curriculares: "Unidades curriculares",
  turnos: "Turnos",
  turnos_dias: "Turnos por día",
  semestres: "Semestres",
  carreras: "Carreras",
  trayectoria_sugerida: "Trayectoria sugerida",
  preasignaciones: "Preasignaciones",
  previas: "Previas",
  profesores: "Profesores",
  capacidad: "Capacidad",
  inscriptos: "Inscriptos",
  coincidencia: "Coincidencia",
  datos: "Datos generales",
};

type FileMap = Partial<Record<RequiredFileName, File>>;

interface FileUploadFormProps {
  onCaseCreated: (caseId: string) => void;
}

function matchRequiredFile(fileName: string): RequiredFileName | undefined {
  const base = fileName.replace(/\.csv$/i, "").toLowerCase();
  return REQUIRED_FILES.find((name) => name === base);
}

export function FileUploadForm({ onCaseCreated }: FileUploadFormProps) {
  const [files, setFiles] = useState<FileMap>({});
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RequiredFileName, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const bulkInputId = useId();

  const missing = REQUIRED_FILES.filter((name) => !files[name]);
  const allFilesPresent = missing.length === 0;

  function handleBulkChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files;
    if (!selected) return;

    const matched: FileMap = {};
    for (const file of Array.from(selected)) {
      const name = matchRequiredFile(file.name);
      if (name) {
        matched[name] = file;
      }
    }
    setFiles((prev) => ({ ...prev, ...matched }));
    event.target.value = "";
  }

  function handleSingleChange(name: RequiredFileName, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFiles((prev) => ({ ...prev, [name]: file }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allFilesPresent || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});

    try {
      const created = await createCase(files as Record<RequiredFileName, File>);
      onCaseCreated(created.case_id);
    } catch (err) {
      if (err instanceof SchemaValidationApiError) {
        const errors: Partial<Record<RequiredFileName, string>> = {};
        for (const detail of err.details) {
          const key = detail.file as RequiredFileName;
          errors[key] = errors[key] ? `${errors[key]}; ${detail.issue}` : detail.issue;
        }
        setFieldErrors(errors);
      } else {
        setSubmitError(err instanceof Error ? err.message : "Error desconocido al subir el caso.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-input bg-muted/30 p-4">
        <Label htmlFor={bulkInputId} className="flex items-start gap-2 font-normal text-foreground">
          <UploadCloud className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            Seleccioná los 14 CSV del caso (podés elegirlos todos juntos: deben llamarse{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">dias.csv</code>,{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">unidades_curriculares.csv</code>,
            etc.)
          </span>
        </Label>
        <input
          id={bulkInputId}
          type="file"
          accept=".csv"
          multiple
          onChange={handleBulkChange}
          className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
        />
      </div>

      <ul className="flex flex-col gap-1.5">
        {REQUIRED_FILES.map((name) => {
          const file = files[name];
          const error = fieldErrors[name];
          const inputId = `file-${name}`;
          return (
            <li
              key={name}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm",
                error ? "border-destructive/40 bg-destructive/5" : "border-border",
              )}
            >
              {error ? (
                <Circle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
              ) : file ? (
                <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <Label htmlFor={inputId} className="w-44 shrink-0 font-normal">
                {LABELS[name]}
              </Label>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {file ? file.name : "sin archivo"}
              </span>
              <input
                id={inputId}
                type="file"
                accept=".csv"
                onChange={(event) => handleSingleChange(name, event)}
                className="w-40 text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-xs"
              />
              {error && (
                <p className="w-full text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {submitError && (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={!allFilesPresent || submitting} className="self-end">
        {submitting ? "Subiendo..." : "Continuar"}
      </Button>
    </form>
  );
}
