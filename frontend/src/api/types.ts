// Contratos de la API — ver docs/ARQUITECTURA_INTERFAZ.md §3.

// Mismo orden que REQUIRED_FILES en backend/app/services/case_validation.py.
export const REQUIRED_FILES = [
  "dias",
  "unidades_curriculares",
  "turnos",
  "turnos_dias",
  "semestres",
  "carreras",
  "trayectoria_sugerida",
  "preasignaciones",
  "previas",
  "profesores",
  "capacidad",
  "inscriptos",
  "coincidencia",
  "datos",
] as const;

export type RequiredFileName = (typeof REQUIRED_FILES)[number];

export interface CaseCreated {
  case_id: string;
  created_at: string;
  files_received: string[];
}

export interface ValidationIssue {
  file: string;
  issue: string;
}

export interface SchemaValidationError {
  error: "schema_validation_failed";
  details: ValidationIssue[];
}

export const SOLVERS = ["GUROBI_CMD", "PULP_CBC_CMD"] as const;
export type Solver = (typeof SOLVERS)[number];

// Valores del enum Weight en constants.py — alpha/beta se eligen de este set.
export const WEIGHT_OPTIONS = [0, 0.25, 0.5, 0.75, 1] as const;
export type Weight = (typeof WEIGHT_OPTIONS)[number];

// Valores del enum TimeLimit en constants.py (minutos).
export const TIME_LIMIT_OPTIONS = [15, 30, 60, 120, 180, 240] as const;
export type TimeLimitMinutes = (typeof TIME_LIMIT_OPTIONS)[number];

export interface SolveParams {
  alpha: Weight;
  beta: Weight;
  solver: Solver;
  time_limit_minutes: TimeLimitMinutes;
  nombre_corrida: string;
}

export interface SolveAccepted {
  job_id: string;
  case_id: string;
  status: JobStatusName;
}

export type JobStatusName =
  | "pending"
  | "running"
  | "optimal"
  | "infeasible"
  | "timeout"
  | "error";

export interface JobStatusResponse {
  job_id: string;
  case_id: string;
  status: JobStatusName;
  started_at: string | null;
  elapsed_seconds: number | null;
  error_message: string | null;
}

export interface ScheduleGrid {
  dias: number[];
  turnos: number[];
  // {"<dia>": {"<turno>": ["UC 1 (código)", ...]}}
  grilla: Record<string, Record<string, string[]>>;
}

export interface JobResultResponse {
  status: JobStatusName;
  objective_value: number | null;
  execution_time_seconds: number | null;
  schedule: ScheduleGrid | null;
  // true si `schedule` fue probado óptimo; false si viene de un "timeout"
  // con solución factible; null si no hay `schedule`.
  proven_optimal: boolean | null;
  // Mensaje accionable para status === "timeout" (con o sin `schedule`).
  message: string | null;
  error_message: string | null;
}
