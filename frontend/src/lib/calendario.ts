// Parser del CSV de un calendario ya generado (el que baja `GET /api/jobs/{id}/download`):
//   Día/Turno,Turno 1,Turno 2,...
//   Día 1,"UC (cod) & UC (cod)",,...
// Cada celda lista las evaluaciones del día/turno separadas por " & ".

export interface EvaluacionCalendario {
  nombre: string;
  codigo: string;
}

export interface CalendarioExistente {
  dias: number[];
  turnos: number[];
  // grilla[dia][turno] -> evaluaciones; las celdas vacías se omiten.
  grilla: Record<string, Record<string, EvaluacionCalendario[]>>;
  totalEvaluaciones: number;
}

export class CalendarioParseError extends Error {}

// CSV mínimo con soporte de campos entre comillas (RFC 4180).
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseEvaluacion(raw: string): EvaluacionCalendario {
  const match = raw.match(/^(.*)\(([^()]*)\)\s*$/);
  if (!match) throw new CalendarioParseError(`No se pudo leer el código de la evaluación "${raw}".`);
  return { nombre: match[1].trim(), codigo: match[2].trim() };
}

function parseIndex(label: string, prefix: string, where: string): number {
  const match = label.trim().match(new RegExp(`^${prefix}\\s+(\\d+)$`, "i"));
  if (!match) throw new CalendarioParseError(`${where}: se esperaba "${prefix} N" y se encontró "${label}".`);
  return Number(match[1]);
}

export function parseCalendarioCsv(text: string): CalendarioExistente {
  const rows = parseCsvRows(text.replace(/^﻿/, "")).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) throw new CalendarioParseError("El archivo no tiene filas de días.");

  const [header, ...body] = rows;
  if (header.length < 2) throw new CalendarioParseError("Falta al menos una columna de turno.");
  const turnos = header.slice(1).map((label) => parseIndex(label, "Turno", "Encabezado"));

  const dias: number[] = [];
  const grilla: CalendarioExistente["grilla"] = {};
  let totalEvaluaciones = 0;

  for (const row of body) {
    const dia = parseIndex(row[0], "Día", `Fila "${row[0]}"`);
    dias.push(dia);
    grilla[String(dia)] = {};
    turnos.forEach((turno, i) => {
      const cell = (row[i + 1] ?? "").trim();
      if (cell === "") return;
      const evaluaciones = cell.split(" & ").map((part) => parseEvaluacion(part.trim()));
      grilla[String(dia)][String(turno)] = evaluaciones;
      totalEvaluaciones += evaluaciones.length;
    });
  }

  if (totalEvaluaciones === 0) throw new CalendarioParseError("El calendario no tiene ninguna evaluación asignada.");
  return { dias, turnos, grilla, totalEvaluaciones };
}
