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
import "./ParamsForm.css";

const NOMBRE_CORRIDA_PATTERN = /^[\w\- ]+$/;

const DEFAULT_PARAMS: SolveParams = {
  alpha: 0.5,
  beta: 0.5,
  solver: SOLVERS[0],
  time_limit_minutes: 15,
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
    <form className="params-form" onSubmit={handleSubmit} noValidate>
      <div className="params-form__field">
        <label htmlFor="nombre_corrida">Nombre del caso</label>
        <input
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
          <p id="nombre_corrida-error" className="params-form__error" role="alert">
            {nombreError}
          </p>
        )}
      </div>

      <div className="params-form__field">
        <label htmlFor="alpha">Alpha (peso de distancia entre semestres)</label>
        <select
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
        </select>
      </div>

      <div className="params-form__field">
        <label htmlFor="beta">Beta (peso de distancia entre previas)</label>
        <select
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
        </select>
      </div>

      <div className="params-form__field">
        <label htmlFor="time_limit_minutes">Tiempo límite</label>
        <select
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
        </select>
      </div>

      <div className="params-form__field">
        <label htmlFor="solver">Solver</label>
        <select
          id="solver"
          value={values.solver}
          disabled={SOLVERS.length === 1}
          onChange={(event) =>
            setValues((prev) => ({ ...prev, solver: event.target.value as Solver }))
          }
        >
          {SOLVERS.map((solver) => (
            <option key={solver} value={solver}>
              {solver}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" disabled={submitting}>
        {submitting ? "Ejecutando..." : "Ejecutar modelo"}
      </button>
    </form>
  );
}
