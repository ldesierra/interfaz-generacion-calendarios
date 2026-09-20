import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getJobStatus } from "../../api/client";
import type { JobStatusResponse } from "../../api/types";
import { ProgressScreen } from "./ProgressScreen";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, getJobStatus: vi.fn() };
});

function statusBody(overrides: Partial<JobStatusResponse>): JobStatusResponse {
  return {
    job_id: "job-1",
    case_id: "case-1",
    status: "running",
    started_at: "2026-09-20T00:00:00Z",
    elapsed_seconds: 1,
    error_message: null,
    ...overrides,
  };
}

describe("ProgressScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(getJobStatus).mockReset();
  });

  it("shows the running label and elapsed time while polling", async () => {
    vi.mocked(getJobStatus).mockResolvedValue(statusBody({ status: "running", elapsed_seconds: 65 }));

    render(<ProgressScreen jobId="job-1" onDone={vi.fn()} />);
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText(/resolviendo el modelo/i)).toBeInTheDocument();
    expect(screen.getByText(/1:05/)).toBeInTheDocument();
  });

  it("stops polling and calls onDone once the job reaches a terminal status", async () => {
    const onDone = vi.fn();
    vi.mocked(getJobStatus)
      .mockResolvedValueOnce(statusBody({ status: "running" }))
      .mockResolvedValueOnce(statusBody({ status: "optimal", elapsed_seconds: 3 }));

    render(<ProgressScreen jobId="job-1" onDone={onDone} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(getJobStatus).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(getJobStatus).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledWith(statusBody({ status: "optimal", elapsed_seconds: 3 }));

    // No debería seguir pidiendo el estado después de terminar.
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(getJobStatus).toHaveBeenCalledTimes(2);
  });

  it("shows an error with a retry button when polling fails", async () => {
    vi.mocked(getJobStatus).mockRejectedValue(new ApiError("el job no existe", 404));

    render(<ProgressScreen jobId="job-1" onDone={vi.fn()} />);
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByRole("alert")).toHaveTextContent(/el job no existe/i);
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });
});
