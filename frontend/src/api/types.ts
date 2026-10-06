// Contrato de POST /api/cases/{case_id}/solve — ver docs/ARQUITECTURA_INTERFAZ.md §3.

export const SOLVERS = ["PULP_CBC_CMD"] as const;
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
