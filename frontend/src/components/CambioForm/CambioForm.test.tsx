import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChangeValidationApiError,
  estimateCoincidencia,
  getCatalog,
  getUcDetail,
} from "../../api/client";
import type { UcChange } from "../../api/types";
import { CambioForm } from "./CambioForm";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    getCatalog: vi.fn(),
    getUcDetail: vi.fn(),
    estimateCoincidencia: vi.fn(),
  };
});

const CATALOG = {
  ucs: [
    { codigo: "1061", nombre: "Calculo" },
    { codigo: "1030", nombre: "Geometria" },
    { codigo: "1151", nombre: "Fisica 1" },
  ],
  carreras: [{ codigo: "civil", nombre: "Ingeniería Civil" }],
  semestres: [1, 2],
};

function setup(onSubmit = vi.fn().mockResolvedValue(undefined), initial?: UcChange) {
  render(
    <CambioForm
      caseId="c1"
      codigosEnCalendario={new Set(["1061", "1030"])}
      initial={initial}
      index={0}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  );
  return onSubmit;
}

async function fillAlta() {
  await screen.findByText("Alta de UC nueva");
  await userEvent.type(screen.getByLabelText("Código"), "9999");
  await userEvent.type(screen.getByLabelText("Nombre"), "UC Nueva");
  await userEvent.type(screen.getByLabelText("Inscriptos"), "100");
  await userEvent.selectOptions(screen.getByLabelText("Carrera 1"), "civil");
  await userEvent.selectOptions(screen.getByLabelText("Semestre 1"), "1");
}

describe("CambioForm", () => {
  beforeEach(() => {
    vi.mocked(getCatalog).mockResolvedValue(CATALOG);
  });
  afterEach(() => vi.resetAllMocks());

  it("no envía un alta incompleta y marca los campos que faltan", async () => {
    const onSubmit = setup();
    await screen.findByText("Alta de UC nueva");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambio" }));
    expect(await screen.findByText("Ingresá el código.")).toBeInTheDocument();
    expect(screen.getByText("Ingresá el nombre.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("estima la coincidencia y guarda un alta con todos los campos", async () => {
    vi.mocked(estimateCoincidencia).mockResolvedValue([{ uc: "1061", coincidencia: 30 }]);
    const onSubmit = setup();
    await fillAlta();

    await userEvent.selectOptions(screen.getByLabelText("Agregar previa"), "1030");
    await userEvent.click(screen.getByRole("button", { name: "Estimar automáticamente" }));
    expect(estimateCoincidencia).toHaveBeenCalledWith("c1", {
      codigo: null,
      inscriptos: 100,
      trayectoria: [{ carrera: "civil", semestre: 1 }],
    });
    expect(await screen.findByLabelText("Coincidencia con Calculo (1061)")).toHaveValue(30);

    await userEvent.click(screen.getByRole("button", { name: "Guardar cambio" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      tipo: "alta",
      codigo: "9999",
      nombre: "UC Nueva",
      inscriptos: 100,
      trayectoria: [{ carrera: "civil", semestre: 1 }],
      previas: ["1030"],
      profesores: [],
      coincidencias: [{ uc: "1061", coincidencia: 30 }],
    } satisfies UcChange);
  });

  it("muestra los errores de validación del backend junto al campo", async () => {
    const onSubmit = setup(
      vi.fn().mockRejectedValue(
        new ChangeValidationApiError([
          { index: 0, field: "codigo", issue: "ya existe una UC con código '9999'" },
          { index: 2, field: "previas", issue: "la UC 'X' no existe" },
        ]),
      ),
    );
    await fillAlta();
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambio" }));
    expect(await screen.findByText("ya existe una UC con código '9999'")).toBeInTheDocument();
    // Los errores de otros cambios de la lista no se pegan a los campos de este.
    expect(screen.getByText("Cambio 3: la UC 'X' no existe")).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("al modificar precarga la UC elegida, sólo ofrece UCs del calendario", async () => {
    vi.mocked(getUcDetail).mockResolvedValue({
      codigo: "1061",
      nombre: "Calculo",
      inscriptos: 250,
      trayectoria: [{ carrera: "civil", semestre: 1 }],
      previas: ["1030"],
      profesores: [],
      coincidencias: [{ uc: "1151", coincidencia: 7.5 }],
    });
    const onSubmit = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Modificar UC existente" }));

    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Calculo (1061)");
    expect(screen.getByLabelText("UC a modificar")).not.toHaveTextContent("Fisica 1");

    await userEvent.selectOptions(screen.getByLabelText("UC a modificar"), "1061");
    expect(await screen.findByLabelText("Coincidencia con Fisica 1 (1151)")).toHaveValue(7.5);
    const inscriptos = screen.getByLabelText("Inscriptos");
    await userEvent.clear(inscriptos);
    await userEvent.type(inscriptos, "300");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambio" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: "modificacion", codigo: "1061", nombre: "Calculo", inscriptos: 300, previas: ["1030"] }),
    );
  });

  it("al editar arranca con los datos del cambio existente", async () => {
    setup(undefined, {
      tipo: "alta",
      codigo: "9999",
      nombre: "UC Nueva",
      inscriptos: 80,
      trayectoria: [{ carrera: "civil", semestre: 2 }],
      previas: ["1030"],
      profesores: [],
      coincidencias: [],
    });
    expect(await screen.findByLabelText("Código")).toHaveValue("9999");
    expect(screen.getByLabelText("Inscriptos")).toHaveValue(80);
    expect(screen.getByLabelText("Semestre 1")).toHaveValue("2");
    expect(screen.getByRole("button", { name: "Quitar Geometria (1030)" })).toBeInTheDocument();
  });
});
