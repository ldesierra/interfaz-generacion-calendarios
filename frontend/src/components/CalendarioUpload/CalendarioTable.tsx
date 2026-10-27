import type { CalendarioExistente } from "../../lib/calendario";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export function CalendarioTable({ calendario }: { calendario: CalendarioExistente }) {
  return (
    <div className="max-h-96 overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Día / Turno</TableHead>
            {calendario.turnos.map((turno) => (
              <TableHead key={turno}>Turno {turno}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {calendario.dias.map((dia) => (
            <TableRow key={dia}>
              <TableHead scope="row">Día {dia}</TableHead>
              {calendario.turnos.map((turno) => {
                const evaluaciones = calendario.grilla[String(dia)]?.[String(turno)] ?? [];
                return (
                  <TableCell key={turno}>
                    {evaluaciones.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {evaluaciones.map((ev) => (
                          <li key={ev.codigo}>
                            {ev.nombre} <span className="text-muted-foreground">({ev.codigo})</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
