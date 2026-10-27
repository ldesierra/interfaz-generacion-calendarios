import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { createCase, SchemaValidationApiError } from "../../api/client";
import { REQUIRED_FILES, type RequiredFileName } from "../../api/types";
import { Alert, AlertDescription } from "../ui/alert";
import { Button, buttonVariants } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { cn } from "../../lib/utils";
import { computeDiaIds, diasToCsv } from "../../lib/dias";
import { TURNOS, turnosDiasToCsv, type TurnoId } from "../../lib/turnosDias";
import { DiasCalendarSelector } from "./DiasCalendarSelector";

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
const REFERENCE_FILES: RequiredFileName[] = [
  "unidades_curriculares",
  "turnos",
  "semestres",
  "carreras",
];

const OVERLAP_FILES: RequiredFileName[] = ["trayectoria_sugerida", "previas", "inscriptos", "coincidencia"];

const SUBSTEP2_FILES: RequiredFileName[] = [...OVERLAP_FILES, "preasignaciones", "profesores"];

const CASE_FILES = REQUIRED_FILES.filter(
  (name) => !REFERENCE_FILES.includes(name) && !SUBSTEP2_FILES.includes(name),
);

interface SubstepDef {
  description: string;
  files: RequiredFileName[];
}

const SUBSTEPS: SubstepDef[] = [
  { description: "datos de referencia (precargados, podés reemplazarlos)", files: REFERENCE_FILES },
  {
    description: "trayectoria sugerida, previas, inscriptos, coincidencia, preasignaciones y profesores",
    files: SUBSTEP2_FILES,
  },
  { description: "datos restantes específicos de este caso", files: CASE_FILES },
];

export function FileUploadForm({ onCaseCreated }: FileUploadFormProps) {
  const [substepIndex, setSubstepIndex] = useState(0);
  const [files, setFiles] = useState<FileMap>({});
  const [selectedDias, setSelectedDias] = useState<Date[]>([]);
  const [turnoSelections, setTurnoSelections] = useState<Map<number, Set<TurnoId>>>(new Map());
  const [capacidades, setCapacidades] = useState<Map<number, Map<TurnoId, string>>>(new Map());
  const [facCp, setFacCp] = useState("");
  const [altaCo, setAltaCo] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RequiredFileName, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      REFERENCE_FILES.map(async (name) => {
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

  const sortedDias = useMemo(() => {
    const sorted = [...selectedDias].sort((a, b) => a.getTime() - b.getTime());
    const ids = computeDiaIds(sorted);
    return sorted.map((date, index) => ({ date, id: ids[index] }));
  }, [selectedDias]);

  const isLastSubstep = substepIndex === SUBSTEPS.length - 1;
  const visibleFiles = SUBSTEPS[substepIndex].files;
  const missingVisible = visibleFiles.filter((name) => !files[name]);
  const allVisiblePresent = missingVisible.length === 0;
  const allFilesPresent = REQUIRED_FILES.every((name) => files[name]);

  function updateTurnosDiasFile(dates: Date[], selections: Map<number, Set<TurnoId>>) {
    const hasAnyTurno = [...selections.values()].some((s) => s.size > 0);
    if (!hasAnyTurno) {
      setFiles((prev) => {
        if (!prev.turnos_dias) return prev;
        const { turnos_dias: _turnosDias, ...rest } = prev;
        return rest;
      });
      return;
    }
    const csv = turnosDiasToCsv(dates, selections);
    setFiles((prev) => ({
      ...prev,
      turnos_dias: new File([csv], "turnos_dias.csv", { type: "text/csv" }),
    }));
  }

  function updateCapacidadFile(
    dates: Date[],
    selections: Map<number, Set<TurnoId>>,
    capMap: Map<number, Map<TurnoId, string>>,
  ) {
    const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
    const ids = computeDiaIds(sorted);
    const rows: string[] = [];
    let missing = false;

    sorted.forEach((date, index) => {
      const turnos = selections.get(date.getTime());
      if (!turnos || turnos.size === 0) return;
      const caps = capMap.get(date.getTime());
      for (const turno of TURNOS) {
        if (!turnos.has(turno.id)) continue;
        const value = caps?.get(turno.id);
        if (!value) {
          missing = true;
          continue;
        }
        rows.push(`${ids[index]},${turno.id},${value}`);
      }
    });

    if (rows.length === 0 || missing) {
      setFiles((prev) => {
        if (!prev.capacidad) return prev;
        const { capacidad: _capacidad, ...rest } = prev;
        return rest;
      });
      return;
    }

    const csv = `id_dia,id_turno,capacidad\n${rows.join("\n")}\n`;
    setFiles((prev) => ({
      ...prev,
      capacidad: new File([csv], "capacidad.csv", { type: "text/csv" }),
    }));
  }

  function updateDatosFile(facCpValue: string, altaCoValue: string) {
    if (facCpValue === "" || altaCoValue === "") {
      setFiles((prev) => {
        if (!prev.datos) return prev;
        const { datos: _datos, ...rest } = prev;
        return rest;
      });
      return;
    }
    const csv = `fac_cp,alta_co\n${facCpValue},${altaCoValue}\n`;
    setFiles((prev) => ({
      ...prev,
      datos: new File([csv], "datos.csv", { type: "text/csv" }),
    }));
  }

  function handleDiasChange(dates: Date[]) {
    setSelectedDias(dates);
    setFieldErrors((prev) => ({ ...prev, dias: undefined }));
    if (dates.length === 0) {
      setFiles((prev) => {
        const { dias: _dias, ...rest } = prev;
        return rest;
      });
    } else {
      setFiles((prev) => ({ ...prev, dias: new File([diasToCsv(dates)], "dias.csv", { type: "text/csv" }) }));
    }
    updateTurnosDiasFile(dates, turnoSelections);
    updateCapacidadFile(dates, turnoSelections, capacidades);
  }

  function toggleTurno(date: Date, turnoId: TurnoId) {
    const key = date.getTime();
    const current = new Set(turnoSelections.get(key));
    if (current.has(turnoId)) current.delete(turnoId);
    else current.add(turnoId);
    const next = new Map(turnoSelections);
    if (current.size === 0) next.delete(key);
    else next.set(key, current);

    setTurnoSelections(next);
    updateTurnosDiasFile(selectedDias, next);
    updateCapacidadFile(selectedDias, next, capacidades);
    setFieldErrors((prev) => ({ ...prev, turnos_dias: undefined }));
  }

  function handleCapacidadChange(date: Date, turnoId: TurnoId, value: string) {
    const key = date.getTime();
    const current = new Map(capacidades.get(key));
    if (value === "") current.delete(turnoId);
    else current.set(turnoId, value);
    const next = new Map(capacidades);
    if (current.size === 0) next.delete(key);
    else next.set(key, current);

    setCapacidades(next);
    updateCapacidadFile(selectedDias, turnoSelections, next);
    setFieldErrors((prev) => ({ ...prev, capacidad: undefined }));
  }

  function handleFacCpChange(value: string) {
    setFacCp(value);
    updateDatosFile(value, altaCo);
    setFieldErrors((prev) => ({ ...prev, datos: undefined }));
  }

  function handleAltaCoChange(value: string) {
    setAltaCo(value);
    updateDatosFile(facCp, value);
    setFieldErrors((prev) => ({ ...prev, datos: undefined }));
  }

  function handleSingleChange(name: RequiredFileName, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFiles((prev) => ({ ...prev, [name]: file }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  function handleViewFile(file: File) {
    const url = URL.createObjectURL(file);
    window.open(url, "_blank", "noopener,noreferrer");
    // Se libera después de dar tiempo a que la nueva pestaña la cargue.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allVisiblePresent || submitting) return;

    if (!isLastSubstep) {
      setSubstepIndex((index) => index + 1);
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
        // Si el error es de un CSV que no se ve en el último substep,
        // volvemos al substep que lo contiene para que se vea.
        const earliestErroredSubstep = SUBSTEPS.findIndex((s) =>
          s.files.some((name) => errors[name]),
        );
        if (earliestErroredSubstep !== -1 && earliestErroredSubstep !== SUBSTEPS.length - 1) {
          setSubstepIndex(earliestErroredSubstep);
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
        Paso {substepIndex + 1} de {SUBSTEPS.length}: {SUBSTEPS[substepIndex].description}
      </p>

      <ul className="flex flex-col gap-1.5">
        {visibleFiles.flatMap((name) => {
          const file = files[name];
          const error = fieldErrors[name];

          if (name === "dias") {
            return (
              <li key={name} data-testid="file-row-dias" className="rounded-md border border-border px-3 py-2 text-sm">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-normal">{LABELS.dias}</span>
                  <span className="text-xs text-muted-foreground">
                    {selectedDias.length > 0
                      ? `${selectedDias.length} día(s) seleccionado(s)`
                      : "sin días seleccionados"}
                  </span>
                </div>
                <DiasCalendarSelector selectedDates={selectedDias} onChange={handleDiasChange} />
                {error && (
                  <p className="mt-2 text-xs text-destructive" role="alert">
                    {error}
                  </p>
                )}
              </li>
            );
          }

          if (name === "turnos_dias") {
            return [
              <li key="dias-turnos-divider" aria-hidden="true" className="my-1 border-t border-border" />,
              <li
                key={name}
                data-testid="file-row-turnos_dias"
                className="flex flex-col gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-normal">{LABELS.turnos_dias}</span>
                  {sortedDias.length === 0 && (
                    <span className="text-xs text-muted-foreground">seleccioná días primero</span>
                  )}
                </div>
                {sortedDias.length > 0 && (
                  <ul className="flex flex-col divide-y divide-border">
                    {sortedDias.map(({ date, id }) => {
                      const selected = turnoSelections.get(date.getTime()) ?? new Set<TurnoId>();
                      return (
                        <li
                          key={id}
                          data-testid={`turno-row-${id}`}
                          className="flex flex-wrap items-center justify-between gap-2 py-2"
                        >
                          <span className="text-muted-foreground">
                            {date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}
                            {" · día "}
                            {id}
                          </span>
                          <div className="flex gap-1.5">
                            {TURNOS.map((turno) => (
                              <Button
                                key={turno.id}
                                type="button"
                                size="sm"
                                variant={selected.has(turno.id) ? "default" : "outline"}
                                aria-pressed={selected.has(turno.id)}
                                onClick={() => toggleTurno(date, turno.id)}
                              >
                                {turno.label}
                              </Button>
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {error && (
                  <p className="text-xs text-destructive" role="alert">
                    {error}
                  </p>
                )}
              </li>,
            ];
          }

          if (name === "capacidad") {
            const pairs: { date: Date; diaId: number; turno: (typeof TURNOS)[number] }[] = [];
            sortedDias.forEach(({ date, id }) => {
              const turnos = turnoSelections.get(date.getTime());
              if (!turnos) return;
              for (const turno of TURNOS) {
                if (turnos.has(turno.id)) pairs.push({ date, diaId: id, turno });
              }
            });

            return (
              <li
                key={name}
                data-testid="file-row-capacidad"
                className="flex flex-col gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-normal">{LABELS.capacidad}</span>
                  {pairs.length === 0 && (
                    <span className="text-xs text-muted-foreground">seleccioná turnos primero</span>
                  )}
                </div>
                {pairs.length > 0 && (
                  <ul className="flex flex-col divide-y divide-border">
                    {pairs.map(({ date, diaId, turno }) => {
                      const value = capacidades.get(date.getTime())?.get(turno.id) ?? "";
                      return (
                        <li
                          key={`${diaId}-${turno.id}`}
                          data-testid={`capacidad-row-${diaId}-${turno.id}`}
                          className="flex flex-wrap items-center justify-between gap-2 py-2"
                        >
                          <span className="text-muted-foreground">
                            {date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}
                            {" · día "}
                            {diaId}
                            {" · "}
                            {turno.label}
                          </span>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            className="w-28"
                            value={value}
                            onChange={(event) => handleCapacidadChange(date, turno.id, event.target.value)}
                            aria-label={`Capacidad día ${diaId} ${turno.label}`}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
                {error && (
                  <p className="text-xs text-destructive" role="alert">
                    {error}
                  </p>
                )}
              </li>
            );
          }

          if (name === "datos") {
            return (
              <li
                key={name}
                data-testid="file-row-datos"
                className="flex flex-col gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="font-normal">{LABELS.datos}</span>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2">
                    <span className="text-muted-foreground">fac_cp</span>
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      inputMode="decimal"
                      className="w-24"
                      value={facCp}
                      onChange={(event) => handleFacCpChange(event.target.value)}
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-muted-foreground">alta_co</span>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      className="w-24"
                      value={altaCo}
                      onChange={(event) => handleAltaCoChange(event.target.value)}
                    />
                  </label>
                </div>
                {error && (
                  <p className="text-xs text-destructive" role="alert">
                    {error}
                  </p>
                )}
              </li>
            );
          }

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
              {file && !SUBSTEP2_FILES.includes(name) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleViewFile(file)}
                >
                  Ver archivo
                </Button>
              )}
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
        {substepIndex > 0 && (
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => setSubstepIndex((index) => index - 1)}
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
