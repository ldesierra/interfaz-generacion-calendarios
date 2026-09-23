import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { createCase, SchemaValidationApiError } from "../../api/client";
import { REQUIRED_FILES, type RequiredFileName } from "../../api/types";
import { Alert, AlertDescription } from "../ui/alert";
import { Button, buttonVariants } from "../ui/button";
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

// Estos CSV son de referencia (carreras, semestres, turnos, UCs) y suelen
// repetirse igual entre casos, así que se precargan desde los ejemplos para
// no obligar a subirlos a mano cada vez. El usuario puede reemplazarlos
// igual eligiendo otro archivo en el input correspondiente.
const DEFAULT_LOADED_FILES: RequiredFileName[] = [
  "unidades_curriculares",
  "turnos",
  "semestres",
  "carreras",
];

const REMAINING_FILES = REQUIRED_FILES.filter((name) => !DEFAULT_LOADED_FILES.includes(name));

type Substep = "reference" | "case";

export function FileUploadForm({ onCaseCreated }: FileUploadFormProps) {
  const [substep, setSubstep] = useState<Substep>("reference");
  const [files, setFiles] = useState<FileMap>({});
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RequiredFileName, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      DEFAULT_LOADED_FILES.map(async (name) => {
        const response = await fetch(`/ejemplos_csv/${name}.csv`);
        if (!response.ok) throw new Error(`No se pudo cargar ${name}.csv`);
        const blob = await response.blob();
        return [name, new File([blob], `${name}.csv`, { type: "text/csv" })] as const;
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        setFiles((prev) => ({ ...Object.fromEntries(entries), ...prev }));
      })
      .catch(() => {
        // Si falla la carga de los ejemplos, el usuario los sube a mano igual.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleFiles = substep === "reference" ? DEFAULT_LOADED_FILES : REMAINING_FILES;
  const missingVisible = visibleFiles.filter((name) => !files[name]);
  const allVisiblePresent = missingVisible.length === 0;
  const allFilesPresent = REQUIRED_FILES.every((name) => files[name]);

  function handleSingleChange(name: RequiredFileName, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFiles((prev) => ({ ...prev, [name]: file }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allVisiblePresent || submitting) return;

    if (substep === "reference") {
      setSubstep("case");
      return;
    }

    if (!allFilesPresent) return;

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
        // Si el error es de uno de los CSV de referencia (no visibles en este
        // substep), volvemos para que se vea.
        if (DEFAULT_LOADED_FILES.some((name) => errors[name])) {
          setSubstep("reference");
        }
      } else {
        setSubmitError(err instanceof Error ? err.message : "Error desconocido al subir el caso.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <p className="text-sm text-muted-foreground">
        {substep === "reference"
          ? "Paso 1 de 2: datos de referencia (precargados, podés reemplazarlos)"
          : "Paso 2 de 2: datos específicos de este caso"}
      </p>

      <ul className="flex flex-col gap-1.5">
        {visibleFiles.map((name) => {
          const file = files[name];
          const error = fieldErrors[name];
          const inputId = `file-${name}`;
          return (
            <li
              key={name}
              data-testid={`file-row-${name}`}
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
              <span className="w-44 shrink-0 font-normal">{LABELS[name]}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {file ? file.name : "sin archivo"}
              </span>
              <input
                id={inputId}
                type="file"
                accept=".csv"
                onChange={(event) => handleSingleChange(name, event)}
                className="sr-only"
              />
              <Label
                htmlFor={inputId}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer")}
              >
                Elegir archivo
              </Label>
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

      <div className="flex justify-end gap-2 mb-6">
        {substep === "case" && (
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => setSubstep("reference")}
          >
            Atrás
          </Button>
        )}
        <Button type="submit" disabled={!allVisiblePresent || submitting}>
          {submitting ? "Subiendo..." : "Continuar"}
        </Button>
      </div>
    </form>
  );
}
