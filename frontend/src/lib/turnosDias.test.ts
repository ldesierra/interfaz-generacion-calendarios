import { describe, expect, it } from "vitest";
import { TURNOS, turnosDiasToCsv, type TurnoId } from "./turnosDias";

function d(day: number) {
  return new Date(2026, 0, day);
}

describe("turnosDiasToCsv", () => {
  it("matches the sample turnos_dias.csv for the sample dias selection", () => {
    const dates = [d(1), d(3), d(4), d(6), d(7), d(8), d(10), d(11), d(12), d(13)];
    const allTurnos = new Set<TurnoId>(TURNOS.map((t) => t.id));
    const twoTurnos = new Set<TurnoId>([1, 2]);
    const selections = new Map<number, Set<TurnoId>>([
      [d(1).getTime(), twoTurnos],
      [d(3).getTime(), allTurnos],
      [d(4).getTime(), allTurnos],
      [d(6).getTime(), allTurnos],
      [d(7).getTime(), allTurnos],
      [d(8).getTime(), twoTurnos],
      [d(10).getTime(), allTurnos],
      [d(11).getTime(), allTurnos],
      [d(12).getTime(), allTurnos],
      [d(13).getTime(), allTurnos],
    ]);

    expect(turnosDiasToCsv(dates, selections)).toBe(
      "id_dia,id_turno\n" +
        [
          "1,1",
          "1,2",
          "3,1",
          "3,2",
          "3,3",
          "4,1",
          "4,2",
          "4,3",
          "6,1",
          "6,2",
          "6,3",
          "7,1",
          "7,2",
          "7,3",
          "8,1",
          "8,2",
          "10,1",
          "10,2",
          "10,3",
          "11,1",
          "11,2",
          "11,3",
          "12,1",
          "12,2",
          "12,3",
          "13,1",
          "13,2",
          "13,3",
        ].join("\n") +
        "\n",
    );
  });

  it("omits days with no turno selected", () => {
    const dates = [d(1), d(2)];
    const selections = new Map<number, Set<TurnoId>>([[d(1).getTime(), new Set([1])]]);
    expect(turnosDiasToCsv(dates, selections)).toBe("id_dia,id_turno\n1,1\n");
  });

  it("returns just the header when nothing is selected", () => {
    expect(turnosDiasToCsv([d(1)], new Map())).toBe("id_dia,id_turno\n");
  });
});
