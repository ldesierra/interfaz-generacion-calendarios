import { useState, type FormEvent } from "react";
import {
  SOLVERS,
  TIME_LIMIT_OPTIONS,
  WEIGHT_OPTIONS,
  type SolveParams,
  type Solver,
  type TimeLimitMinutes,
  type Weight,
} from "../../api/types";
import { Button, buttonVariants } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { cn } from "../../lib/utils";

const NOMBRE_CORRIDA_PATTERN = /^[\w\- ]+$/;
const WARM_START_SOLVER: Solver = "GUROBI_CMD";

const DEFAULT_PARAMS: SolveParams = {
  alpha: 0.5,
  beta: 0.5,
  solver: SOLVERS[0],
  time_limit_minutes: 180,
  nombre_corrida: "",
  warm_start: false,
};

interface ParamsFormProps {
  onSubmit: (params: SolveParams, warmStartFile: File | null) => void;
  submitting?: boolean;
  initialValues?: Partial<SolveParams>;
}

function validateNombreCorrida(nombre: string): string | null {
  const trimmed = nombre.trim();
  if (trimmed.length === 0) {
    return "El nombre del caso es obligatorio.";
  }
  if (trimmed.length > 60) {
    return "El nombre del caso no puede superar los 60 caracteres.";
  }
  if (!NOMBRE_CORRIDA_PATTERN.test(trimmed)) {
    return "Usá solo letras, números, espacios, guiones y guiones bajos.";
  }
  return null;
}

export function ParamsForm({ onSubmit, submitting = false, initialValues }: ParamsFormProps) {
  const [values, setValues] = useState<SolveParams>({
    ...DEFAULT_PARAMS,
    ...initialValues,
  });
  const [nombreError, setNombreError] = useState<string | null>(null);
  const [warmStartFile, setWarmStartFile] = useState<File | null>(null);
  const [warmStartError, setWarmStartError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateNombreCorrida(values.nombre_corrida);
    setNombreError(error);

    let fileError: string | null = null;
    if (values.warm_start && !warmStartFile) {
      fileError = "Elegí un archivo de warm start, o desmarcá la opción.";
    }
    setWarmStartError(fileError);

    if (error || fileError) {
      return;
    }
    onSubmit(
      { ...values, nombre_corrida: values.nombre_corrida.trim() },
      values.warm_start ? warmStartFile : null,
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nombre_corrida">Nombre del caso</Label>
        <Input
          id="nombre_corrida"
          type="text"
          value={values.nombre_corrida}
          onChange={(event) => {
            setValues((prev) => ({ ...prev, nombre_corrida: event.target.value }));
            if (nombreError) {
              setNombreError(null);
            }
          }}
          aria-invalid={nombreError ? "true" : "false"}
          aria-describedby={nombreError ? "nombre_corrida-error" : undefined}
        />
        {nombreError && (
          <p id="nombre_corrida-error" className="text-xs text-destructive" role="alert">
            {nombreError}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="alpha">Alpha (peso de distancia entre semestres)</Label>
          <Select
            id="alpha"
            value={values.alpha}
            onChange={(event) =>
              setValues((prev) => ({ ...prev, alpha: Number(event.target.value) as Weight }))
            }
          >
            {WEIGHT_OPTIONS.map((weight) => (
              <option key={weight} value={weight}>
                {weight}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="beta">Beta (peso de distancia entre previas)</Label>
          <Select
            id="beta"
            value={values.beta}
            onChange={(event) =>
              setValues((prev) => ({ ...prev, beta: Number(event.target.value) as Weight }))
            }
          >
            {WEIGHT_OPTIONS.map((weight) => (
              <option key={weight} value={weight}>
                {weight}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="time_limit_minutes">Tiempo límite</Label>
          <Select
            id="time_limit_minutes"
            value={values.time_limit_minutes}
            onChange={(event) =>
              setValues((prev) => ({
                ...prev,
                time_limit_minutes: Number(event.target.value) as TimeLimitMinutes,
              }))
            }
          >
            {TIME_LIMIT_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} min
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="solver">Solver</Label>
          <Select
            id="solver"
            value={values.solver}
            onChange={(event) => {
              const solver = event.target.value as Solver;
              setValues((prev) => ({
                ...prev,
                solver,
                warm_start: solver === WARM_START_SOLVER ? prev.warm_start : false,
              }));
            }}
          >
            {SOLVERS.map((solver) => (
              <option key={solver} value={solver}>
                {solver}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2.5">
        <Label
          htmlFor="warm_start"
          className={cn(values.solver !== WARM_START_SOLVER && "opacity-50")}
        >
          <Checkbox
            id="warm_start"
            checked={values.warm_start}
            disabled={values.solver !== WARM_START_SOLVER}
            onChange={(event) => {
              const checked = event.target.checked;
              setValues((prev) => ({ ...prev, warm_start: checked }));
              if (!checked) {
                setWarmStartError(null);
              }
            }}
          />
          Usar warm start
        </Label>
        <p className="text-xs text-muted-foreground">
          {values.solver === WARM_START_SOLVER
            ? "Le pasa al solver los valores de una solución previa (CSV con \"nombre_variable,valor\" por línea) para arrancar de ahí en vez de buscar a ciegas. Usá el botón \"Descargar warm start\" del resultado de una corrida anterior de este caso — el CSV del calendario no sirve para esto."
            : "Sólo tiene efecto con el solver GUROBI_CMD."}
        </p>

        {values.warm_start && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
            <input
              id="warm_start_file"
              type="file"
              accept=".csv"
              onChange={(event) => {
                setWarmStartFile(event.target.files?.[0] ?? null);
                setWarmStartError(null);
              }}
              className="sr-only"
            />
            <Label
              htmlFor="warm_start_file"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer")}
            >
              Elegir archivo
            </Label>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {warmStartFile ? warmStartFile.name : "sin archivo"}
            </span>
          </div>
        )}
        {warmStartError && (
          <p className="text-xs text-destructive" role="alert">
            {warmStartError}
          </p>
        )}
      </div>

      <Button type="submit" disabled={submitting} className="self-end mb-3">
        {submitting ? "Ejecutando..." : "Ejecutar modelo"}
      </Button>
    </form>
  );
}
