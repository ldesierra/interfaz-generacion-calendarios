import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_FILES } from "../../api/types";
import { FileUploadForm } from "./FileUploadForm";

const REFERENCE_FILES = ["unidades_curriculares", "turnos", "semestres", "carreras"] as const;
const OVERLAP_FILES = ["trayectoria_sugerida", "previas", "inscriptos", "coincidencia"] as const;
const SUBSTEP2_FILES = [...OVERLAP_FILES, "preasignaciones", "profesores"] as const;
const CASE_FILES = REQUIRED_FILES.filter(
  (name) =>
    !(REFERENCE_FILES as readonly string[]).includes(name) &&
    !(SUBSTEP2_FILES as readonly string[]).includes(name),
);

function csvFile(name: string) {
  return new File(["id\n1\n"], `${name}.csv`, { type: "text/csv" });
}

// El formulario precarga los 4 CSV de referencia (ver REFERENCE_FILES) al
// montar, así que cualquier mock de fetch tiene que responder a esas
// llamadas además de a la del submit — si no, el mock termina respondiendo
// a la primera carga de ejemplo en vez de al POST.
function mockFetch(handleApiCall: (input: RequestInfo | URL) => Response | Promise<Response>) {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/ejemplos_csv/")) {
      return new Response("col\nval\n", { status: 200, headers: { "Content-Type": "text/csv" } });
    }
    return handleApiCall(input);
  });
}

async function clickContinuar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /continuar/i }));
}

async function uploadFiles(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
  names: readonly string[],
) {
  for (const name of names) {
    if (name === "dias") {
      await selectDia(user, container, 1);
      continue;
    }
    if (name === "turnos_dias") {
      await selectTurno(user, container, 1, "Mañana");
      continue;
    }
    if (name === "capacidad") {
      await fillCapacidad(user, container, 1, 1);
      continue;
    }
    if (name === "datos") {
      await fillDatos(user, container);
      continue;
    }
    const input = container.querySelector<HTMLInputElement>(`#file-${name}`);
    if (!input) throw new Error(`missing input for ${name}`);
    await user.upload(input, csvFile(name));
  }
}

/** Completa la capacidad del par (día, turno) indicado en "capacidad". */
async function fillCapacidad(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
  diaId: number,
  turnoId: number,
  value = "100",
) {
  const row = container.querySelector<HTMLElement>(`[data-testid="capacidad-row-${diaId}-${turnoId}"]`);
  if (!row) throw new Error(`missing capacidad row for día ${diaId} turno ${turnoId}`);
  const input = row.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error(`missing capacidad input for día ${diaId} turno ${turnoId}`);
  await user.clear(input);
  await user.type(input, value);
}

/** Completa fac_cp y alta_co en "datos". */
async function fillDatos(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
  facCp = "0.8",
  altaCo = "40",
) {
  const row = container.querySelector<HTMLElement>('[data-testid="file-row-datos"]');
  if (!row) throw new Error("missing file-row-datos");
  const inputs = row.querySelectorAll<HTMLInputElement>("input");
  await user.clear(inputs[0]);
  await user.type(inputs[0], facCp);
  await user.clear(inputs[1]);
  await user.type(inputs[1], altaCo);
}

/** Selecciona un día del mes actualmente visible en el calendario de "dias". */
async function selectDia(user: ReturnType<typeof userEvent.setup>, container: HTMLElement, day: number) {
  const cell = container.querySelector<HTMLButtonElement>(`[data-testid="dia-cell-${day}"]`);
  if (!cell) throw new Error(`missing calendar cell for day ${day}`);
  await user.click(cell);
}

/** Marca un turno para el día (id calculado, no día del mes) indicado en "turnos_dias". */
async function selectTurno(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
  diaId: number,
  turnoLabel: "Mañana" | "Mediodía" | "Tarde",
) {
  const row = container.querySelector<HTMLElement>(`[data-testid="turno-row-${diaId}"]`);
  if (!row) throw new Error(`missing turno row for día ${diaId}`);
  const button = Array.from(row.querySelectorAll("button")).find((b) => b.textContent === turnoLabel);
  if (!button) throw new Error(`missing turno button "${turnoLabel}" for día ${diaId}`);
  await user.click(button);
}

/** Avanza del substep 1 (referencia, precargado) al substep 2 (trayectoria/previas/inscriptos/coincidencia/preasignaciones/profesores). */
async function goToOverlapSubstep(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByRole("button", { name: /continuar/i })).toBeEnabled());
  await clickContinuar(user);
}

/** Avanza del substep 1 hasta el substep 3 (final), completando el substep 2 en el camino. */
async function goToCaseSubstep(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  await goToOverlapSubstep(user);
  await uploadFiles(user, container, SUBSTEP2_FILES);
  await clickContinuar(user);
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

    for (const name of REFERENCE_FILES) {
      const row = screen.getByTestId(`file-row-${name}`);
      await waitFor(() => expect(row).toHaveTextContent(`${name}.csv`));
    }
  });

  it("only shows each substep's own files", async () => {
    const user = userEvent.setup();
    const { container } = render(<FileUploadForm onCaseCreated={vi.fn()} />);

    for (const name of REFERENCE_FILES) {
      expect(screen.getByTestId(`file-row-${name}`)).toBeInTheDocument();
    }
    for (const name of [...SUBSTEP2_FILES, ...CASE_FILES]) {
      expect(screen.queryByTestId(`file-row-${name}`)).not.toBeInTheDocument();
    }

    await goToOverlapSubstep(user);

    for (const name of SUBSTEP2_FILES) {
      expect(screen.getByTestId(`file-row-${name}`)).toBeInTheDocument();
    }
    for (const name of [...REFERENCE_FILES, ...CASE_FILES]) {
      expect(screen.queryByTestId(`file-row-${name}`)).not.toBeInTheDocument();
    }

    await uploadFiles(user, container, SUBSTEP2_FILES);
    await clickContinuar(user);

    for (const name of CASE_FILES) {
      expect(screen.getByTestId(`file-row-${name}`)).toBeInTheDocument();
    }
    for (const name of [...REFERENCE_FILES, ...SUBSTEP2_FILES]) {
      expect(screen.queryByTestId(`file-row-${name}`)).not.toBeInTheDocument();
    }
  });

  it("goes back a substep at a time with Atrás", async () => {
    const user = userEvent.setup();
    const { container } = render(<FileUploadForm onCaseCreated={vi.fn()} />);

    await goToCaseSubstep(user, container);
    expect(screen.getByTestId(`file-row-${CASE_FILES[0]}`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /atrás/i }));
    for (const name of SUBSTEP2_FILES) {
      expect(screen.getByTestId(`file-row-${name}`)).toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: /atrás/i }));
    for (const name of REFERENCE_FILES) {
      expect(screen.getByTestId(`file-row-${name}`)).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /atrás/i })).not.toBeInTheDocument();
  });

  it("keeps the final submit disabled until all case files are selected, then enables it", async () => {
    const user = userEvent.setup();
    const { container } = render(<FileUploadForm onCaseCreated={vi.fn()} />);

    await goToCaseSubstep(user, container);
    expect(screen.getByRole("button", { name: /continuar/i })).toBeDisabled();

    await uploadFiles(user, container, CASE_FILES);

    expect(screen.getByRole("button", { name: /continuar/i })).toBeEnabled();
  });

  it("marks selected calendar days with a running id and reflects the count", async () => {
    const user = userEvent.setup();
    const { container } = render(<FileUploadForm onCaseCreated={vi.fn()} />);

    await goToCaseSubstep(user, container);

    const diasRow = screen.getByText("Días").closest("li");
    expect(diasRow).not.toBeNull();
    expect(diasRow).toHaveTextContent("sin días seleccionados");

    await selectDia(user, container, 1);
    expect(diasRow).toHaveTextContent("1 día(s) seleccionado(s)");
    expect(container.querySelector('[data-testid="dia-cell-1"]')).toHaveTextContent("1");

    await selectDia(user, container, 3);
    expect(diasRow).toHaveTextContent("2 día(s) seleccionado(s)");
    // Día 2 no fue seleccionado, así que el día 3 salta directo al id 3.
    expect(container.querySelector('[data-testid="dia-cell-3"]')).toHaveTextContent("3");
  });

  it("shows one turno row per selected día, dynamically, and toggles turnos on/off", async () => {
    const user = userEvent.setup();
    const { container } = render(<FileUploadForm onCaseCreated={vi.fn()} />);

    await goToCaseSubstep(user, container);

    expect(container.querySelector('[data-testid="turno-row-1"]')).not.toBeInTheDocument();

    await selectDia(user, container, 1);
    expect(container.querySelector('[data-testid="turno-row-1"]')).toBeInTheDocument();

    await selectDia(user, container, 3);
    expect(container.querySelector('[data-testid="turno-row-1"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="turno-row-3"]')).toBeInTheDocument();

    const mananaButton = Array.from(
      container.querySelector('[data-testid="turno-row-1"]')!.querySelectorAll("button"),
    ).find((b) => b.textContent === "Mañana")!;

    expect(mananaButton).toHaveAttribute("aria-pressed", "false");
    await user.click(mananaButton);
    expect(mananaButton).toHaveAttribute("aria-pressed", "true");
    await user.click(mananaButton);
    expect(mananaButton).toHaveAttribute("aria-pressed", "false");
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
    await goToCaseSubstep(user, container);
    await uploadFiles(user, container, CASE_FILES);
    await clickContinuar(user);

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
    await goToCaseSubstep(user, container);
    await uploadFiles(user, container, CASE_FILES);
    await clickContinuar(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/alta_co/);
  });

  it("goes back to the reference substep when the validation error is for a reference file", async () => {
    const user = userEvent.setup();
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            error: "schema_validation_failed",
            details: [{ file: "carreras", issue: "falta la columna 'codigo'" }],
          }),
          { status: 422 },
        ),
    );

    const { container } = render(<FileUploadForm onCaseCreated={vi.fn()} />);
    await goToCaseSubstep(user, container);
    await uploadFiles(user, container, CASE_FILES);
    await clickContinuar(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/codigo/);
    expect(screen.getByTestId("file-row-carreras")).toBeInTheDocument();
  });

  it("goes back to the overlap substep when the validation error is for an overlap file", async () => {
    const user = userEvent.setup();
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            error: "schema_validation_failed",
            details: [{ file: "previas", issue: "uc inexistente" }],
          }),
          { status: 422 },
        ),
    );

    const { container } = render(<FileUploadForm onCaseCreated={vi.fn()} />);
    await goToCaseSubstep(user, container);
    await uploadFiles(user, container, CASE_FILES);
    await clickContinuar(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/uc inexistente/);
    expect(screen.getByTestId("file-row-previas")).toBeInTheDocument();
  });

  it("shows a generic error for a network/server failure", async () => {
    const user = userEvent.setup();
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const { container } = render(<FileUploadForm onCaseCreated={vi.fn()} />);
    await goToCaseSubstep(user, container);
    await uploadFiles(user, container, CASE_FILES);
    await clickContinuar(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to fetch/i);
  });
});
