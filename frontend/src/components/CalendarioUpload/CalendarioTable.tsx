import { evaluacionesEn, type CalendarioExistente, type EvaluacionCalendario } from "../../lib/calendario";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

function Evaluaciones({ evaluaciones }: { evaluaciones: EvaluacionCalendario[] }) {
  if (evaluaciones.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {evaluaciones.map((ev) => (
        <li key={ev.codigo ?? ev.nombre}>
          {ev.nombre}
          {ev.codigo && <span className="text-muted-foreground"> ({ev.codigo})</span>}
        </li>
      ))}
    </ul>
  );
}

export function CalendarioTable({ calendario }: { calendario: CalendarioExistente }) {
  // La planilla vieja no indica el turno: se muestra una sola columna por día.
  const porDia = calendario.turnos.length === 0;

  return (
    <div className="max-h-96 overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{porDia ? "Día" : "Día / Turno"}</TableHead>
            {porDia ? (
              <TableHead>Evaluaciones</TableHead>
            ) : (
              calendario.turnos.map((turno) => <TableHead key={turno}>Turno {turno}</TableHead>)
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {calendario.dias.map((dia) => (
            <TableRow key={dia}>
              <TableHead scope="row">Día {dia}</TableHead>
              {porDia ? (
                <TableCell>
                  <Evaluaciones evaluaciones={evaluacionesEn(calendario, dia)} />
                </TableCell>
              ) : (
                calendario.turnos.map((turno) => (
                  <TableCell key={turno}>
                    <Evaluaciones evaluaciones={evaluacionesEn(calendario, dia, turno)} />
                  </TableCell>
                ))
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
