// Parser de los dos formatos de calendario vigente que acepta la edición
// incremental.
//
// Formato "generado" — el que baja `GET /api/jobs/{id}/download`:
//   Día/Turno,Turno 1,Turno 2,...
//   Día 1,"UC (cod) & UC (cod)",,...
// Cada celda lista las evaluaciones del día/turno separadas por " & ".
//
// Formato "viejo" — la planilla con la que se armaba el calendario a mano:
//   ,,25/4,27/4,...
//   ,Semestre,Día 1,Día 2,...
//   Eléctrica,Primero,GAL 2,GAL 1,...
// Las columnas son los días y cada fila es un (carrera, semestre), así que la
// misma evaluación aparece repetida en todas las carreras que la tienen; acá
// se junta una sola vez. No trae códigos ni turnos: el backend resuelve los
// nombres contra las UCs del caso cuando se sube el calendario.

export interface EvaluacionCalendario {
  nombre: string;
  // null en el formato viejo: la planilla no trae el código de la UC.
  codigo: string | null;
  dia: number;
  // null en el formato viejo: la planilla sólo indica el día.
  turno: number | null;
}

export type FormatoCalendario = "generado" | "viejo";

export interface CalendarioExistente {
  formato: FormatoCalendario;
  dias: number[];
  // Vacío en el formato viejo.
  turnos: number[];
  evaluaciones: EvaluacionCalendario[];
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

const DIA_COLUMNA = /^d[ií]a\s+\d+$/i;
const TURNO_COLUMNA = /^turno\s+\d+$/i;
// En la planilla vieja una celda puede listar varias evaluaciones del mismo
// día ("CDIV/ CDIVV", "Redes de datos 2 / Electrónica de potencia").
const SEPARADOR_PLANILLA = /[/&]/;

function parseEvaluacion(raw: string): { nombre: string; codigo: string } {
  const match = raw.match(/^(.*)\(([^()]*)\)\s*$/);
  if (!match) throw new CalendarioParseError(`No se pudo leer el código de la evaluación "${raw}".`);
  return { nombre: match[1].trim(), codigo: match[2].trim() };
}

function parseIndex(label: string, prefix: string, where: string): number {
  const match = label.trim().match(new RegExp(`^${prefix}\\s+(\\d+)$`, "i"));
  if (!match) throw new CalendarioParseError(`${where}: se esperaba "${prefix} N" y se encontró "${label}".`);
  return Number(match[1]);
}

// Nombre comparable: sin acentos, sin mayúsculas y sin puntuación. Es la misma
// normalización que usa el backend para machear contra las UCs del caso.
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function rowsNoVacias(text: string): string[][] {
  return parseCsvRows(text.replace(/^\ufeff/, "")).filter((r) => r.some((c) => c.trim() !== ""));
}

// El encabezado del formato generado es `Día/Turno,Turno 1,Turno 2,...`.
function esGenerado(rows: string[][]): boolean {
  const header = rows[0] ?? [];
  return header.length >= 2 && header.slice(1).every((c) => TURNO_COLUMNA.test(c.trim()));
}

// Fila de encabezado de la planilla vieja: la primera con una celda "Día N"
// fuera de la primera columna (en el formato generado "Día N" es siempre la
// primera celda de la fila).
function encabezadoPlanilla(rows: string[][]): number | null {
  if (esGenerado(rows)) return null;
  const index = rows.findIndex((row) => row.slice(1).some((c) => DIA_COLUMNA.test(c.trim())));
  return index === -1 ? null : index;
}

function parsePlanillaVieja(rows: string[][], headerIndex: number): CalendarioExistente {
  const columnas: number[] = [];
  rows[headerIndex].forEach((cell, i) => {
    if (DIA_COLUMNA.test(cell.trim())) columnas.push(i);
  });

  const evaluaciones: EvaluacionCalendario[] = [];
  const vistas = new Set<string>();
  for (const row of rows.slice(headerIndex + 1)) {
    columnas.forEach((columna, posicion) => {
      const cell = (row[columna] ?? "").trim();
      if (cell === "") return;
      for (const parte of cell.split(SEPARADOR_PLANILLA)) {
        const nombre = parte.trim();
        const clave = `${posicion}|${normalizarNombre(nombre)}`;
        if (nombre === "" || normalizarNombre(nombre) === "" || vistas.has(clave)) continue;
        vistas.add(clave);
        // El día es la posición de la columna: el backend la hace corresponder
        // con el N-ésimo día del caso.
        evaluaciones.push({ nombre, codigo: null, dia: posicion + 1, turno: null });
      }
    });
  }

  if (evaluaciones.length === 0) {
    throw new CalendarioParseError("La planilla no tiene ninguna evaluación.");
  }
  return {
    formato: "viejo",
    dias: columnas.map((_, i) => i + 1),
    turnos: [],
    evaluaciones,
    totalEvaluaciones: evaluaciones.length,
  };
}

function parseGenerado(rows: string[][]): CalendarioExistente {
  if (rows.length < 2) throw new CalendarioParseError("El archivo no tiene filas de días.");

  const [header, ...body] = rows;
  if (header.length < 2) throw new CalendarioParseError("Falta al menos una columna de turno.");
  const turnos = header.slice(1).map((label) => parseIndex(label, "Turno", "Encabezado"));

  const dias: number[] = [];
  const evaluaciones: EvaluacionCalendario[] = [];

  for (const row of body) {
    const dia = parseIndex(row[0], "Día", `Fila "${row[0]}"`);
    dias.push(dia);
    turnos.forEach((turno, i) => {
      const cell = (row[i + 1] ?? "").trim();
      if (cell === "") return;
      for (const part of cell.split(" & ")) {
        const { nombre, codigo } = parseEvaluacion(part.trim());
        evaluaciones.push({ nombre, codigo, dia, turno });
      }
    });
  }

  if (evaluaciones.length === 0) {
    throw new CalendarioParseError("El calendario no tiene ninguna evaluación asignada.");
  }
  return { formato: "generado", dias, turnos, evaluaciones, totalEvaluaciones: evaluaciones.length };
}

export function parseCalendarioCsv(text: string): CalendarioExistente {
  const rows = rowsNoVacias(text);
  const headerIndex = encabezadoPlanilla(rows);
  return headerIndex === null ? parseGenerado(rows) : parsePlanillaVieja(rows, headerIndex);
}

export function evaluacionesEn(
  calendario: CalendarioExistente,
  dia: number,
  turno: number | null = null,
): EvaluacionCalendario[] {
  return calendario.evaluaciones.filter((ev) => ev.dia === dia && ev.turno === turno);
}
