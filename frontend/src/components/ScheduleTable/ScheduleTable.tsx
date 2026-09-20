import type { ScheduleGrid } from "../../api/types";
import "./ScheduleTable.css";

interface ScheduleTableProps {
  schedule: ScheduleGrid;
}

export function ScheduleTable({ schedule }: ScheduleTableProps) {
  return (
    <table className="schedule-table">
      <thead>
        <tr>
          <th scope="col">Día / Turno</th>
          {schedule.turnos.map((turno) => (
            <th scope="col" key={turno}>
              Turno {turno}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {schedule.dias.map((dia) => (
          <tr key={dia}>
            <th scope="row">Día {dia}</th>
            {schedule.turnos.map((turno) => {
              const evaluaciones = schedule.grilla[String(dia)]?.[String(turno)] ?? [];
              return (
                <td key={turno}>
                  {evaluaciones.length === 0 ? (
                    <span className="schedule-table__empty">—</span>
                  ) : (
                    <ul>
                      {evaluaciones.map((uc) => (
                        <li key={uc}>{uc}</li>
                      ))}
                    </ul>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
