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

    expect(onSubmit).toHaveBeenCalledWith({
      alpha: 0.5,
      beta: 0.5,
      solver: "PULP_CBC_CMD",
      time_limit_minutes: 15,
      nombre_corrida: "caso 1",
    });
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
});
