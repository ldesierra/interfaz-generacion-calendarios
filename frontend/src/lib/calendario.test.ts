import { describe, expect, it } from "vitest";
import { CalendarioParseError, evaluacionesEn, parseCalendarioCsv } from "./calendario";

describe("parseCalendarioCsv (formato generado)", () => {
  it("lee días, turnos y evaluaciones con paréntesis en el nombre", () => {
    const csv =
      'Día/Turno,Turno 1,Turno 2\nDía 1,Calculo (1061) & Fisica 2 (1152),\nDía 2,,"Mate (Q1), x (1025)"\n';
    const cal = parseCalendarioCsv(csv);
    expect(cal.formato).toBe("generado");
    expect(cal.dias).toEqual([1, 2]);
    expect(cal.turnos).toEqual([1, 2]);
    expect(cal.totalEvaluaciones).toBe(3);
    expect(evaluacionesEn(cal, 1, 1)).toEqual([
      { nombre: "Calculo", codigo: "1061", dia: 1, turno: 1 },
      { nombre: "Fisica 2", codigo: "1152", dia: 1, turno: 1 },
    ]);
    expect(evaluacionesEn(cal, 1, 2)).toEqual([]);
    expect(evaluacionesEn(cal, 2, 2)).toEqual([
      { nombre: "Mate (Q1), x", codigo: "1025", dia: 2, turno: 2 },
    ]);
  });

  it("acepta filas de día con menos columnas y CRLF", () => {
    const cal = parseCalendarioCsv("Día/Turno,Turno 1,Turno 2\r\nDía 1,A (1)\r\nDía 2\r\n");
    expect(cal.dias).toEqual([1, 2]);
    expect(evaluacionesEn(cal, 1, 1)).toEqual([{ nombre: "A", codigo: "1", dia: 1, turno: 1 }]);
  });

  it("rechaza archivos que no tienen el formato de calendario", () => {
    expect(() => parseCalendarioCsv("a,b\n1,2\n")).toThrow(CalendarioParseError);
    expect(() => parseCalendarioCsv("Día/Turno,Turno 1\nDía 1,sin codigo\n")).toThrow(/código/);
    expect(() => parseCalendarioCsv("Día/Turno,Turno 1\nDía 1,\n")).toThrow(/ninguna evaluación/);
  });
});

describe("parseCalendarioCsv (planilla vieja)", () => {
  // Columnas = días, filas = (carrera, semestre). La fila de fechas de arriba
  // se ignora y cada evaluación aparece repetida en cada carrera que la tiene.
  const PLANILLA =
    ",,25/4,27/4\n" +
    ",Semestre,Día 1,Día 2\n" +
    "Eléctrica,Primero,GAL 2,CDIV/ CDIVV\n" +
    ",Tercero,,Probabilidad y Estadística \n" +
    "Civil,Primero,gal 2,CDIV\n";

  it("junta la fila entera, separa las celdas con varias y no repite evaluaciones", () => {
    const cal = parseCalendarioCsv(PLANILLA);
    expect(cal.formato).toBe("viejo");
    expect(cal.dias).toEqual([1, 2]);
    expect(cal.turnos).toEqual([]);
    // "GAL 2" y "gal 2" son la misma evaluación; "CDIV" aparece en dos carreras.
    expect(cal.evaluaciones.map((ev) => [ev.nombre, ev.dia])).toEqual([
      ["GAL 2", 1],
      ["CDIV", 2],
      ["CDIVV", 2],
      ["Probabilidad y Estadística", 2],
    ]);
  });

  it("no trae códigos ni turnos: los resuelve el backend contra el caso", () => {
    const cal = parseCalendarioCsv(PLANILLA);
    expect(cal.evaluaciones.every((ev) => ev.codigo === null && ev.turno === null)).toBe(true);
    expect(evaluacionesEn(cal, 1)).toEqual([
      { nombre: "GAL 2", codigo: null, dia: 1, turno: null },
    ]);
  });

  it("rechaza una planilla sin evaluaciones", () => {
    expect(() => parseCalendarioCsv(",Semestre,Día 1,Día 2\nEléctrica,Primero,,\n")).toThrow(
      /ninguna evaluación/,
    );
  });
});
