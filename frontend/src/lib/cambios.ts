import type { ScheduleGrid, UcChange } from "../api/types";
import type { CalendarioExistente } from "./calendario";

export interface Ubicacion {
  dia: number;
  // null cuando el calendario vigente venía en el formato viejo, que no
  // indica el turno.
  turno: number | null;
}

export interface CambioUbicado {
  tipo: UcChange["tipo"];
  codigo: string;
  nombre: string;
  // Dónde quedó en el calendario resultante (null si el modelo no la ubicó).
  nueva: Ubicacion | null;
  // Dónde estaba en el calendario vigente (sólo para modificaciones).
  anterior: Ubicacion | null;
}

// Las celdas de la grilla son "Nombre de la UC (código)".
export function codigoDeCelda(celda: string): string | null {
  const match = celda.match(/\(([^()]*)\)\s*$/);
  return match ? match[1].trim() : null;
}

export function ubicacionEnGrilla(schedule: ScheduleGrid, codigo: string): Ubicacion | null {
  for (const dia of schedule.dias) {
    for (const turno of schedule.turnos) {
      const celdas = schedule.grilla[String(dia)]?.[String(turno)] ?? [];
      if (celdas.some((celda) => codigoDeCelda(celda) === codigo)) return { dia, turno };
    }
  }
  return null;
}

function ubicacionEnCalendario(calendario: CalendarioExistente, codigo: string): Ubicacion | null {
  const ev = calendario.evaluaciones.find((e) => e.codigo === codigo);
  return ev ? { dia: ev.dia, turno: ev.turno } : null;
}

export function ubicarCambios(
  schedule: ScheduleGrid,
  changes: UcChange[],
  calendarioAnterior: CalendarioExistente | null,
): CambioUbicado[] {
  return changes.map((change) => ({
    tipo: change.tipo,
    codigo: change.codigo,
    nombre: change.nombre ?? change.codigo,
    nueva: ubicacionEnGrilla(schedule, change.codigo),
    anterior:
      change.tipo === "modificacion" && calendarioAnterior
        ? ubicacionEnCalendario(calendarioAnterior, change.codigo)
        : null,
  }));
}
