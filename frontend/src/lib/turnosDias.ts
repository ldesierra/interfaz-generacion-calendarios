import { computeDiaIds } from "./dias";

export const TURNOS = [
  { id: 1, label: "Mañana" },
  { id: 2, label: "Mediodía" },
  { id: 3, label: "Tarde" },
] as const;

export type TurnoId = (typeof TURNOS)[number]["id"];

export function turnosDiasToCsv(dates: Date[], selections: Map<number, Set<TurnoId>>): string {
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const ids = computeDiaIds(sorted);
  const rows: string[] = [];
  sorted.forEach((date, index) => {
    const turnosSeleccionados = selections.get(date.getTime());
    if (!turnosSeleccionados) return;
    for (const turno of TURNOS) {
      if (turnosSeleccionados.has(turno.id)) rows.push(`${ids[index]},${turno.id}`);
    }
  });
  return `id_dia,id_turno\n${rows.join("\n")}${rows.length ? "\n" : ""}`;
}
