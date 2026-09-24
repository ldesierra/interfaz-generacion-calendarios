export function isSameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toUtcDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

// Asigna a cada fecha (ordenada cronológicamente) el mismo "id" de día que
// usa el modelo: el primer día seleccionado es 1, y cada día siguiente suma
// la cantidad de días de calendario transcurridos desde el anterior (1 si
// son consecutivos, más si hay días sin seleccionar en el medio).
export function computeDiaIds(dates: Date[]): number[] {
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const ids: number[] = [];
  sorted.forEach((date, index) => {
    if (index === 0) {
      ids.push(1);
      return;
    }
    const diffDays = toUtcDayNumber(date) - toUtcDayNumber(sorted[index - 1]);
    ids.push(ids[index - 1] + diffDays);
  });
  return ids;
}

export function diasToCsv(dates: Date[]): string {
  return `id\n${computeDiaIds(dates).join("\n")}\n`;
}
