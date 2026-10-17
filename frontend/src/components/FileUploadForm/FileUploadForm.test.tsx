import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_FILES } from "../../api/types";
import { FileUploadForm } from "./FileUploadForm";

function csvFile(name: string) {
  return new File(["id\n1\n"], `${name}.csv`, { type: "text/csv" });
}

function allRequiredFiles() {
  return REQUIRED_FILES.map((name) => csvFile(name));
}

describe("FileUploadForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the submit button disabled until all 14 files are selected", async () => {
    const user = userEvent.setup();
    render(<FileUploadForm onCaseCreated={vi.fn()} />);

    expect(screen.getByRole("button", { name: /continuar/i })).toBeDisabled();

    const bulkInput = screen.getByLabelText(/seleccioná los 14 csv/i);
    await user.upload(bulkInput, allRequiredFiles());

    expect(screen.getByRole("button", { name: /continuar/i })).toBeEnabled();
  });

  it("matches bulk-selected files to their required slot by filename", async () => {
    const user = userEvent.setup();
    render(<FileUploadForm onCaseCreated={vi.fn()} />);

    await user.upload(screen.getByLabelText(/seleccioná los 14 csv/i), [csvFile("dias")]);

    const diasRow = screen.getByText("Días").closest("li");
    expect(diasRow).not.toBeNull();
    expect(diasRow).toHaveTextContent("dias.csv");
  });

  it("submits the case and calls onCaseCreated on success", async () => {
    const onCaseCreated = vi.fn();
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          case_id: "abc123",
          created_at: "2026-09-20T00:00:00Z",
          files_received: REQUIRED_FILES,
        }),
        { status: 201 },
      ),
    );

    render(<FileUploadForm onCaseCreated={onCaseCreated} />);
    await user.upload(screen.getByLabelText(/seleccioná los 14 csv/i), allRequiredFiles());
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    await waitFor(() => expect(onCaseCreated).toHaveBeenCalledWith("abc123"));
    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(options?.method).toBe("POST");
    expect(options?.body).toBeInstanceOf(FormData);
  });

  it("shows per-file validation errors on a 422 response", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "schema_validation_failed",
          details: [{ file: "datos", issue: "falta la columna 'alta_co'" }],
        }),
        { status: 422 },
      ),
    );

    render(<FileUploadForm onCaseCreated={vi.fn()} />);
    await user.upload(screen.getByLabelText(/seleccioná los 14 csv/i), allRequiredFiles());
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/alta_co/);
  });

  it("shows a generic error for a network/server failure", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<FileUploadForm onCaseCreated={vi.fn()} />);
    await user.upload(screen.getByLabelText(/seleccioná los 14 csv/i), allRequiredFiles());
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to fetch/i);
  });
});
