import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CalendarioUpload } from "./CalendarioUpload";

const CSV = "Día/Turno,Turno 1,Turno 2\nDía 1,Calculo (1061) & Fisica 2 (1152),\nDía 2,,Logica (1027)\n";

function pick(name: string, content: string) {
  const input = document.getElementById("file-calendario") as HTMLInputElement;
  return userEvent.upload(input, new File([content], name, { type: "text/csv" }));
}

describe("CalendarioUpload", () => {
  it("parsea el CSV, muestra el resumen y habilita Continuar", async () => {
    const onContinue = vi.fn();
    render(<CalendarioUpload onContinue={onContinue} />);
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();

    await pick("cal.csv", CSV);

    expect(await screen.findByTestId("calendario-resumen")).toHaveTextContent(
      "3 evaluaciones en 2 días y 2 turnos",
    );
    expect(screen.getByText("Fisica 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue.mock.calls[0][0].totalEvaluaciones).toBe(3);
  });

  it("muestra el error y deja Continuar deshabilitado con un archivo inválido", async () => {
    render(<CalendarioUpload onContinue={vi.fn()} />);
    await pick("malo.csv", "a,b\n1,2\n");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });
});
