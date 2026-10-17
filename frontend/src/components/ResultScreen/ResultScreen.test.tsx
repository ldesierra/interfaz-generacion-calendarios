import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getJobResult } from "../../api/client";
import type { JobResultResponse } from "../../api/types";
import { ResultScreen } from "./ResultScreen";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, getJobResult: vi.fn() };
});

function optimalResult(): JobResultResponse {
  return {
    status: "optimal",
    objective_value: 0.576032,
    execution_time_seconds: 0.03,
    schedule: {
      dias: [1, 2],
      turnos: [1],
      grilla: { "1": { "1": ["UC B (B)"] }, "2": { "1": ["UC A (A)"] } },
    },
    error_message: null,
  };
}

describe("ResultScreen", () => {
  afterEach(() => {
    vi.mocked(getJobResult).mockReset();
  });

  it("renders the schedule and a download link for an optimal result", async () => {
    vi.mocked(getJobResult).mockResolvedValue(optimalResult());

    render(<ResultScreen jobId="job-1" onRestart={vi.fn()} />);

    expect(await screen.findByText("UC B (B)")).toBeInTheDocument();
    const downloadLink = screen.getByRole("link", { name: /descargar csv/i });
    expect(downloadLink).toHaveAttribute("href", "/api/jobs/job-1/download");
  });

  it("shows a friendly message with no schedule when infeasible", async () => {
    vi.mocked(getJobResult).mockResolvedValue({
      status: "infeasible",
      objective_value: null,
      execution_time_seconds: 1.2,
      schedule: null,
      error_message: null,
    });

    render(<ResultScreen jobId="job-1" onRestart={vi.fn()} />);

    expect(await screen.findByText(/no encontró un calendario factible/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /descargar csv/i })).not.toBeInTheDocument();
  });

  it("shows the error message when the job failed", async () => {
    vi.mocked(getJobResult).mockResolvedValue({
      status: "error",
      objective_value: null,
      execution_time_seconds: 0.5,
      schedule: null,
      error_message: "No se encontró el archivo capacidad.csv",
    });

    render(<ResultScreen jobId="job-1" onRestart={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/capacidad\.csv/);
  });

  it("shows an error and lets the user restart when fetching the result fails", async () => {
    const onRestart = vi.fn();
    const user = userEvent.setup();
    vi.mocked(getJobResult).mockRejectedValue(new ApiError("el job no existe", 404));

    render(<ResultScreen jobId="job-1" onRestart={onRestart} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/el job no existe/i);
    await user.click(screen.getByRole("button", { name: /empezar de nuevo/i }));
    expect(onRestart).toHaveBeenCalled();
  });
});
