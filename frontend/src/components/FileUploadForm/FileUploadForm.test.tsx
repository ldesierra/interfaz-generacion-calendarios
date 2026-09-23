import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_FILES } from "../../api/types";
import { FileUploadForm } from "./FileUploadForm";

function csvFile(name: string) {
  return new File(["id\n1\n"], `${name}.csv`, { type: "text/csv" });
}

async function uploadAllRequiredFiles(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  for (const name of REQUIRED_FILES) {
    const input = container.querySelector<HTMLInputElement>(`#file-${name}`);
    if (!input) throw new Error(`missing input for ${name}`);
    await user.upload(input, csvFile(name));
  }
}

// El formulario precarga 4 CSV de ejemplo (ver DEFAULT_LOADED_FILES) al
// montar, así que cualquier mock de fetch tiene que responder a esas
// llamadas además de a la del submit — si no, `mockResolvedValueOnce`
// termina respondiendo a la primera carga de ejemplo en vez de al POST.
function mockFetch(handleApiCall: (input: RequestInfo | URL) => Response | Promise<Response>) {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/ejemplos_csv/")) {
      return new Response("col\nval\n", { status: 200, headers: { "Content-Type": "text/csv" } });
    }
    return handleApiCall(input);
  });
}

describe("FileUploadForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockFetch(() => {
      throw new Error("unexpected fetch call in this test");
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preloads the reference CSVs (unidades_curriculares, turnos, semestres, carreras) by default", async () => {
    render(<FileUploadForm onCaseCreated={vi.fn()} />);

    for (const name of ["unidades_curriculares", "turnos", "semestres", "carreras"]) {
      const row = screen.getByTestId(`file-row-${name}`);
      await waitFor(() => expect(row).toHaveTextContent(`${name}.csv`));
    }
  });

  it("keeps the submit button disabled until all 14 files are selected", async () => {
    const user = userEvent.setup();
    const { container } = render(<FileUploadForm onCaseCreated={vi.fn()} />);

    expect(screen.getByRole("button", { name: /continuar/i })).toBeDisabled();

    await uploadAllRequiredFiles(user, container);

    expect(screen.getByRole("button", { name: /continuar/i })).toBeEnabled();
  });

  it("shows the selected filename for a single field once chosen", async () => {
    const user = userEvent.setup();
    const { container } = render(<FileUploadForm onCaseCreated={vi.fn()} />);

    const input = container.querySelector<HTMLInputElement>("#file-dias");
    expect(input).not.toBeNull();
    await user.upload(input!, csvFile("dias"));

    const diasRow = screen.getByText("Días").closest("li");
    expect(diasRow).not.toBeNull();
    expect(diasRow).toHaveTextContent("dias.csv");
  });

  it("submits the case and calls onCaseCreated on success", async () => {
    const onCaseCreated = vi.fn();
    const user = userEvent.setup();
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            case_id: "abc123",
            created_at: "2026-09-20T00:00:00Z",
            files_received: REQUIRED_FILES,
          }),
          { status: 201 },
        ),
    );

    const { container } = render(<FileUploadForm onCaseCreated={onCaseCreated} />);
    await uploadAllRequiredFiles(user, container);
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    await waitFor(() => expect(onCaseCreated).toHaveBeenCalledWith("abc123"));
    const apiCall = vi.mocked(fetch).mock.calls.find(([input]) => input === "/api/cases");
    expect(apiCall).toBeDefined();
    const [, options] = apiCall!;
    expect(options?.method).toBe("POST");
    expect(options?.body).toBeInstanceOf(FormData);
  });

  it("shows per-file validation errors on a 422 response", async () => {
    const user = userEvent.setup();
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            error: "schema_validation_failed",
            details: [{ file: "datos", issue: "falta la columna 'alta_co'" }],
          }),
          { status: 422 },
        ),
    );

    const { container } = render(<FileUploadForm onCaseCreated={vi.fn()} />);
    await uploadAllRequiredFiles(user, container);
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/alta_co/);
  });

  it("shows a generic error for a network/server failure", async () => {
    const user = userEvent.setup();
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const { container } = render(<FileUploadForm onCaseCreated={vi.fn()} />);
    await uploadAllRequiredFiles(user, container);
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to fetch/i);
  });
});
