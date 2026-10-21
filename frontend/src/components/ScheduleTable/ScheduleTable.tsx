import type { ScheduleGrid } from "../../api/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

interface ScheduleTableProps {
  schedule: ScheduleGrid;
}

export function ScheduleTable({ schedule }: ScheduleTableProps) {
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
                        {evaluaciones.map((uc) => (
                          <li key={uc}>{uc}</li>
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
