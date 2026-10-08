import { describe, expect, it } from "vitest";
import type { ScheduleGrid, UcChange } from "../api/types";
import { parseCalendarioCsv } from "./calendario";
import { codigoDeCelda, ubicarCambios } from "./cambios";

const SCHEDULE: ScheduleGrid = {
  dias: [1, 2],
  turnos: [1, 2],
  grilla: {
    "1": { "1": ["Calculo (1061)"], "2": [] },
    "2": { "1": [], "2": ["Mate (Q1), x (9999)", "Logica (1027)"] },
  },
};

const change = (tipo: UcChange["tipo"], codigo: string, nombre: string | null): UcChange => ({
  tipo, codigo, nombre, inscriptos: 1, trayectoria: [], previas: [], profesores: [], coincidencias: [],
});

describe("cambios", () => {
  it("lee el código al final de la celda, aunque el nombre tenga paréntesis", () => {
    expect(codigoDeCelda("Mate (Q1), x (9999)")).toBe("9999");
    expect(codigoDeCelda("sin código")).toBeNull();
  });

  it("ubica altas y modificaciones, con el lugar anterior de las modificaciones", () => {
    const anterior = parseCalendarioCsv("Día/Turno,Turno 1,Turno 2\nDía 1,Logica (1027),\nDía 2,,Calculo (1061)\n");
    const result = ubicarCambios(
      SCHEDULE,
      [change("alta", "9999", "Mate (Q1), x"), change("modificacion", "1027", "Logica"), change("alta", "NOPE", null)],
      anterior,
    );
    expect(result).toEqual([
      { tipo: "alta", codigo: "9999", nombre: "Mate (Q1), x", nueva: { dia: 2, turno: 2 }, anterior: null },
      { tipo: "modificacion", codigo: "1027", nombre: "Logica", nueva: { dia: 2, turno: 2 }, anterior: { dia: 1, turno: 1 } },
      { tipo: "alta", codigo: "NOPE", nombre: "NOPE", nueva: null, anterior: null },
    ]);
  });
});
