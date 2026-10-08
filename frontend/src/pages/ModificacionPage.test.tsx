import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, deriveCase, getCatalog, putChanges, uploadCalendar } from "../api/client";
import { ModificacionPage } from "./ModificacionPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, uploadCalendar: vi.fn(), deriveCase: vi.fn(), getCatalog: vi.fn(), putChanges: vi.fn() };
});

// El formulario de datos es largo y ya tiene sus propios tests: acá sólo
// importa que, al crear el caso, la página suba el calendario.
vi.mock("../components/FileUploadForm/FileUploadForm", () => ({
  FileUploadForm: ({ onCaseCreated }: { onCaseCreated: (id: string) => void }) => (
    <button onClick={() => onCaseCreated("case1")}>crear caso</button>
  ),
}));

const CSV = "Día/Turno,Turno 1\nDía 1,Calculo (1061)\n";

async function reachDatosStep() {
  render(
    <MemoryRouter>
      <ModificacionPage />
    </MemoryRouter>,
  );
  const input = document.getElementById("file-calendario") as HTMLInputElement;
  await userEvent.upload(input, new File([CSV], "cal.csv", { type: "text/csv" }));
  await userEvent.click(await screen.findByRole("button", { name: "Continuar" }));
}

describe("ModificacionPage", () => {
  beforeEach(() => {
    vi.mocked(getCatalog).mockResolvedValue({
      ucs: [{ codigo: "1061", nombre: "Calculo" }],
      carreras: [{ codigo: "civil", nombre: "Civil" }],
      semestres: [1],
    });
  });
  afterEach(() => vi.resetAllMocks());

  it("sube el calendario al crear el caso y avanza a los cambios", async () => {
    vi.mocked(uploadCalendar).mockResolvedValue({ evaluaciones: 1 });
    await reachDatosStep();
    await userEvent.click(screen.getByRole("button", { name: "crear caso" }));

    expect(uploadCalendar).toHaveBeenCalledWith("case1", expect.any(File));
    expect(await screen.findByText("3. Cambios a realizar")).toBeInTheDocument();
  });

  it("se queda en los datos y muestra el error si el calendario no cuadra con el caso", async () => {
    vi.mocked(uploadCalendar).mockRejectedValue(
      new ApiError("El calendario usa días/turnos que no existen en el caso: Día 9 Turno 1", 422),
    );
    await reachDatosStep();
    await userEvent.click(screen.getByRole("button", { name: "crear caso" }));

    expect(await screen.findByText(/Día 9 Turno 1/)).toBeInTheDocument();
    expect(screen.getByText("2. Datos del caso")).toBeInTheDocument();
  });

  it("al continuar desde los cambios deriva el caso y muestra el resumen", async () => {
    vi.mocked(uploadCalendar).mockResolvedValue({ evaluaciones: 1 });
    vi.mocked(deriveCase).mockResolvedValue({
      derived_case_id: "d1",
      fixed_ucs: 64,
      free_ucs: ["1061", "9999"],
      warnings: ["Estas UCs del caso no figuran en el calendario vigente: X"],
    });
    vi.mocked(putChanges).mockImplementation(async (_id, changes) => changes);

    await reachDatosStep();
    await userEvent.click(screen.getByRole("button", { name: "crear caso" }));
    await userEvent.click(await screen.findByRole("button", { name: "Agregar modificación" }));
    // Alta mínima para tener algo en la lista.
    await screen.findByRole("button", { name: "Alta de UC nueva" });
    await userEvent.type(screen.getByLabelText("Código"), "9999");
    await userEvent.type(screen.getByLabelText("Nombre"), "Nueva");
    await userEvent.type(screen.getByLabelText("Inscriptos"), "5");
    await userEvent.selectOptions(screen.getByLabelText("Carrera 1"), "civil");
    await userEvent.selectOptions(screen.getByLabelText("Semestre 1"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambio" }));
    await userEvent.click(await screen.findByRole("button", { name: "Continuar" }));

    expect(deriveCase).toHaveBeenCalledWith("case1");
    expect(await screen.findByTestId("resumen-derivado")).toHaveTextContent(
      "64 evaluaciones quedan fijas; el modelo ubica 2 UCs (1061, 9999).",
    );
    expect(screen.getByText(/no figuran en el calendario vigente/)).toBeInTheDocument();
  });
});
