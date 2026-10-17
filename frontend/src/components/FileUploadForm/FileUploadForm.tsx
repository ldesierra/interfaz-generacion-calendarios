import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { createCase, SchemaValidationApiError } from "../../api/client";
import { REQUIRED_FILES, type RequiredFileName } from "../../api/types";
import "./FileUploadForm.css";

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
    <form className="file-upload-form" onSubmit={handleSubmit} noValidate>
      <div className="file-upload-form__bulk">
        <label htmlFor={bulkInputId}>
          Seleccioná los 14 CSV del caso (podés elegirlos todos juntos: deben llamarse{" "}
          <code>dias.csv</code>, <code>unidades_curriculares.csv</code>, etc.)
        </label>
        <input
          id={bulkInputId}
          type="file"
          accept=".csv"
          multiple
          onChange={handleBulkChange}
        />
      </div>

      <ul className="file-upload-form__checklist">
        {REQUIRED_FILES.map((name) => {
          const file = files[name];
          const error = fieldErrors[name];
          const inputId = `file-${name}`;
          return (
            <li
              key={name}
              className={
                "file-upload-form__item" +
                (error ? " file-upload-form__item--error" : file ? " file-upload-form__item--ok" : "")
              }
            >
              <span className="file-upload-form__status" aria-hidden="true">
                {file ? "✓" : "○"}
              </span>
              <label htmlFor={inputId}>{LABELS[name]}</label>
              <span className="file-upload-form__filename">
                {file ? file.name : "sin archivo"}
              </span>
              <input
                id={inputId}
                type="file"
                accept=".csv"
                onChange={(event) => handleSingleChange(name, event)}
              />
              {error && (
                <p className="file-upload-form__error" role="alert">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {submitError && (
        <p className="file-upload-form__error" role="alert">
          {submitError}
        </p>
      )}

      <button type="submit" disabled={!allFilesPresent || submitting}>
        {submitting ? "Subiendo..." : "Continuar"}
      </button>
    </form>
  );
}
