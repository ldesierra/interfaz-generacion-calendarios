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
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";

const NOMBRE_CORRIDA_PATTERN = /^[\w\- ]+$/;

const DEFAULT_PARAMS: SolveParams = {
  alpha: 0.5,
  beta: 0.5,
  solver: SOLVERS[0],
  time_limit_minutes: 180,
  nombre_corrida: "",
};

interface ParamsFormProps {
  onSubmit: (params: SolveParams) => void;
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateNombreCorrida(values.nombre_corrida);
    setNombreError(error);
    if (error) {
      return;
    }
    onSubmit({ ...values, nombre_corrida: values.nombre_corrida.trim() });
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
            onChange={(event) => setValues((prev) => ({ ...prev, solver: event.target.value as Solver }))}
          >
            {SOLVERS.map((solver) => (
              <option key={solver} value={solver}>
                {solver}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Button type="submit" disabled={submitting} className="self-end mb-3">
        {submitting ? "Ejecutando..." : "Ejecutar modelo"}
      </Button>
    </form>
  );
}
