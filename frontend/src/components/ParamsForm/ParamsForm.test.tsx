import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ParamsForm } from "./ParamsForm";

describe("ParamsForm", () => {
  it("submits the default params with the trimmed case name", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ParamsForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/nombre del caso/i), "  caso 1  ");
    await user.click(screen.getByRole("button", { name: /ejecutar modelo/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      {
        alpha: 0.5,
        beta: 0.5,
        solver: "GUROBI_CMD",
        time_limit_minutes: 180,
        nombre_corrida: "caso 1",
        warm_start: false,
      },
      null,
    );
  });

  it("sends the selected alpha, beta and time limit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ParamsForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/nombre del caso/i), "caso-2");
    await user.selectOptions(screen.getByLabelText(/^alpha/i), "0.25");
    await user.selectOptions(screen.getByLabelText(/^beta/i), "1");
    await user.selectOptions(screen.getByLabelText(/tiempo límite/i), "60");
    await user.click(screen.getByRole("button", { name: /ejecutar modelo/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ alpha: 0.25, beta: 1, time_limit_minutes: 60 }),
      null,
    );
  });

  it("lets the user switch between the Gurobi and CBC solvers", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ParamsForm onSubmit={onSubmit} />);

    expect(screen.getByLabelText(/solver/i)).toHaveValue("GUROBI_CMD");

    await user.type(screen.getByLabelText(/nombre del caso/i), "caso-3");
    await user.selectOptions(screen.getByLabelText(/solver/i), "PULP_CBC_CMD");
    await user.click(screen.getByRole("button", { name: /ejecutar modelo/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ solver: "PULP_CBC_CMD" }),
      null,
    );
  });

  it("blocks submit and shows an error when the case name is empty", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ParamsForm onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /ejecutar modelo/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/obligatorio/i);
  });

  it("rejects case names with characters unsafe for a filename", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ParamsForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/nombre del caso/i), "caso/raro?");
    await user.click(screen.getByRole("button", { name: /ejecutar modelo/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/guiones/i);
  });

  it("clears the error as soon as the user edits the case name again", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ParamsForm onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /ejecutar modelo/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/nombre del caso/i), "c");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the submit button while submitting", () => {
    render(<ParamsForm onSubmit={vi.fn()} submitting />);
    expect(screen.getByRole("button", { name: /ejecutando/i })).toBeDisabled();
  });

  it("blocks submit and shows an error when warm start is checked without a file", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ParamsForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/nombre del caso/i), "caso-4");
    await user.click(screen.getByLabelText(/usar warm start/i));
    await user.click(screen.getByRole("button", { name: /ejecutar modelo/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/elegí un archivo/i);
  });

  it("submits the warm start file when checked and selected", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ParamsForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/nombre del caso/i), "caso-5");
    await user.click(screen.getByLabelText(/usar warm start/i));

    const file = new File(["x_1_2_3,1"], "warm_start.csv", { type: "text/csv" });
    const fileInput = document.getElementById("warm_start_file") as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: /ejecutar modelo/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ warm_start: true }),
      file,
    );
  });

  it("disables warm start when the solver is not Gurobi", async () => {
    const user = userEvent.setup();
    render(<ParamsForm onSubmit={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/solver/i), "PULP_CBC_CMD");

    expect(screen.getByLabelText(/usar warm start/i)).toBeDisabled();
  });
});
