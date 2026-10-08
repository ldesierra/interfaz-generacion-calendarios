import { describe, expect, it } from "vitest";
import { CalendarioParseError, parseCalendarioCsv } from "./calendario";

describe("parseCalendarioCsv", () => {
  it("lee días, turnos y evaluaciones con paréntesis en el nombre", () => {
    const csv =
      'Día/Turno,Turno 1,Turno 2\nDía 1,Calculo (1061) & Fisica 2 (1152),\nDía 2,,"Mate (Q1), x (1025)"\n';
    const cal = parseCalendarioCsv(csv);
    expect(cal.dias).toEqual([1, 2]);
    expect(cal.turnos).toEqual([1, 2]);
    expect(cal.totalEvaluaciones).toBe(3);
    expect(cal.grilla["1"]["1"]).toEqual([
      { nombre: "Calculo", codigo: "1061" },
      { nombre: "Fisica 2", codigo: "1152" },
    ]);
    expect(cal.grilla["1"]["2"]).toBeUndefined();
    expect(cal.grilla["2"]["2"]).toEqual([{ nombre: "Mate (Q1), x", codigo: "1025" }]);
  });

  it("acepta filas de día con menos columnas y CRLF", () => {
    const cal = parseCalendarioCsv("Día/Turno,Turno 1,Turno 2\r\nDía 1,A (1)\r\nDía 2\r\n");
    expect(cal.dias).toEqual([1, 2]);
    expect(cal.grilla["1"]["1"]).toEqual([{ nombre: "A", codigo: "1" }]);
  });

  it("rechaza archivos que no tienen el formato de calendario", () => {
    expect(() => parseCalendarioCsv("a,b\n1,2\n")).toThrow(CalendarioParseError);
    expect(() => parseCalendarioCsv("Día/Turno,Turno 1\nDía 1,sin codigo\n")).toThrow(/código/);
    expect(() => parseCalendarioCsv("Día/Turno,Turno 1\nDía 1,\n")).toThrow(/ninguna evaluación/);
  });
});
