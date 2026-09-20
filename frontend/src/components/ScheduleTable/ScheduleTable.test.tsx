import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ScheduleGrid } from "../../api/types";
import { ScheduleTable } from "./ScheduleTable";

const schedule: ScheduleGrid = {
  dias: [1, 2],
  turnos: [1],
  grilla: {
    "1": { "1": ["UC B (B)"] },
    "2": { "1": ["UC A (A)", "UC C (C)"] },
  },
};

describe("ScheduleTable", () => {
  it("renders one row per día and one column per turno", () => {
    render(<ScheduleTable schedule={schedule} />);

    expect(screen.getByText("Día 1")).toBeInTheDocument();
    expect(screen.getByText("Día 2")).toBeInTheDocument();
    expect(screen.getByText("Turno 1")).toBeInTheDocument();
    expect(screen.getByText("UC B (B)")).toBeInTheDocument();
    expect(screen.getByText("UC A (A)")).toBeInTheDocument();
    expect(screen.getByText("UC C (C)")).toBeInTheDocument();
  });

  it("shows a placeholder for an empty day/turno slot", () => {
    const empty: ScheduleGrid = { dias: [1], turnos: [1], grilla: { "1": { "1": [] } } };
    render(<ScheduleTable schedule={empty} />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
