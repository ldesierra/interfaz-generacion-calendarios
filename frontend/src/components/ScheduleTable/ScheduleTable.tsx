import type { ScheduleGrid } from "../../api/types";
import { codigoDeCelda } from "../../lib/cambios";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

interface ScheduleTableProps {
  schedule: ScheduleGrid;
  // {código de UC: tipo de cambio}: esas UCs se marcan en la grilla.
  highlights?: Record<string, "alta" | "modificacion">;
}

const HIGHLIGHT_LABEL = { alta: "Nueva", modificacion: "Modificada" } as const;

export function ScheduleTable({ schedule, highlights = {} }: ScheduleTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Día / Turno</TableHead>
            {schedule.turnos.map((turno) => (
              <TableHead key={turno}>Turno {turno}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedule.dias.map((dia) => (
            <TableRow key={dia}>
              <TableHead scope="row">Día {dia}</TableHead>
              {schedule.turnos.map((turno) => {
                const evaluaciones = schedule.grilla[String(dia)]?.[String(turno)] ?? [];
                return (
                  <TableCell key={turno}>
                    {evaluaciones.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {evaluaciones.map((uc) => {
                          const codigo = codigoDeCelda(uc);
                          const tipo = codigo ? highlights[codigo] : undefined;
                          return (
                            <li
                              key={uc}
                              data-highlight={tipo}
                              className={cn(
                                tipo && "-mx-1 rounded bg-primary/10 px-1 py-0.5 font-medium",
                              )}
                            >
                              {uc}
                              {tipo && (
                                <Badge variant={tipo === "alta" ? "default" : "secondary"} className="ml-1.5">
                                  {HIGHLIGHT_LABEL[tipo]}
                                </Badge>
                              )}
                            </li>
                          );
                        })}
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
