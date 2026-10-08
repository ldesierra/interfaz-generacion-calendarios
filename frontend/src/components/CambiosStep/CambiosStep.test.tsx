import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeValidationApiError, getCatalog, putChanges } from "../../api/client";
import type { UcChange } from "../../api/types";
import { CambiosStep } from "./CambiosStep";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, getCatalog: vi.fn(), getUcDetail: vi.fn(), estimateCoincidencia: vi.fn(), putChanges: vi.fn() };
});

const CATALOG = {
  ucs: [
    { codigo: "1061", nombre: "Calculo" },
    { codigo: "1030", nombre: "Geometria" },
  ],
  carreras: [{ codigo: "civil", nombre: "Ingeniería Civil" }],
  semestres: [1, 2],
};

const ALTA: UcChange = {
  tipo: "alta",
  codigo: "9999",
  nombre: "UC Nueva",
  inscriptos: 10,
  trayectoria: [{ carrera: "civil", semestre: 1 }],
  previas: [],
  profesores: [],
  coincidencias: [],
};

function Harness({ initial = [], onContinue = vi.fn() }: { initial?: UcChange[]; onContinue?: () => void }) {
  const [changes, setChanges] = useState(initial);
  return (
    <CambiosStep
      caseId="c1"
      codigosEnCalendario={new Set(["1061", "1030"])}
      changes={changes}
      onChange={setChanges}
      onContinue={onContinue}
    />
  );
}

describe("CambiosStep", () => {
  beforeEach(() => {
    vi.mocked(getCatalog).mockResolvedValue(CATALOG);
    vi.mocked(putChanges).mockImplementation(async (_id, changes) => changes);
  });
  afterEach(() => vi.resetAllMocks());

  it("empieza vacío con Continuar deshabilitado", () => {
    render(<Harness />);
    expect(screen.getByText("Todavía no agregaste ningún cambio.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });

  it("agrega un cambio desde el modal y lo manda al backend junto con los anteriores", async () => {
    render(<Harness initial={[ALTA]} />);
    await userEvent.click(screen.getByRole("button", { name: "Agregar modificación" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Alta de UC nueva");
    await userEvent.type(within(dialog).getByLabelText("Código"), "8888");
    await userEvent.type(within(dialog).getByLabelText("Nombre"), "Otra");
    await userEvent.type(within(dialog).getByLabelText("Inscriptos"), "5");
    await userEvent.selectOptions(within(dialog).getByLabelText("Carrera 1"), "civil");
    await userEvent.selectOptions(within(dialog).getByLabelText("Semestre 1"), "2");
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar cambio" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const sent = vi.mocked(putChanges).mock.calls[0][1];
    expect(sent.map((c) => c.codigo)).toEqual(["9999", "8888"]);
    expect(within(screen.getByTestId("lista-cambios")).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("deja el modal abierto con el error si el backend rechaza el cambio", async () => {
    vi.mocked(putChanges).mockRejectedValue(
      new ChangeValidationApiError([{ index: 0, field: "codigo", issue: "ya existe una UC con código '1061'" }]),
    );
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Agregar modificación" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Alta de UC nueva");
    await userEvent.type(within(dialog).getByLabelText("Código"), "1061");
    await userEvent.type(within(dialog).getByLabelText("Nombre"), "X");
    await userEvent.type(within(dialog).getByLabelText("Inscriptos"), "5");
    await userEvent.selectOptions(within(dialog).getByLabelText("Carrera 1"), "civil");
    await userEvent.selectOptions(within(dialog).getByLabelText("Semestre 1"), "1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar cambio" }));

    expect(await within(dialog).findByText("ya existe una UC con código '1061'")).toBeInTheDocument();
    expect(screen.getByText("Todavía no agregaste ningún cambio.")).toBeInTheDocument();
  });

  it("edita y quita cambios", async () => {
    render(<Harness initial={[ALTA]} />);
    await userEvent.click(screen.getByRole("button", { name: "Editar 9999" }));
    const dialog = await screen.findByRole("dialog");
    const inscriptos = await within(dialog).findByLabelText("Inscriptos");
    await userEvent.clear(inscriptos);
    await userEvent.type(inscriptos, "77");
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar cambio" }));
    expect(vi.mocked(putChanges).mock.calls[0][1][0].inscriptos).toBe(77);

    await userEvent.click(screen.getByRole("button", { name: "Quitar 9999" }));
    expect(vi.mocked(putChanges).mock.calls[1][1]).toEqual([]);
    expect(screen.getByText("Todavía no agregaste ningún cambio.")).toBeInTheDocument();
  });

  it("Continuar avisa a la página", async () => {
    const onContinue = vi.fn();
    render(<Harness initial={[ALTA]} onContinue={onContinue} />);
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onContinue).toHaveBeenCalled();
  });
});
