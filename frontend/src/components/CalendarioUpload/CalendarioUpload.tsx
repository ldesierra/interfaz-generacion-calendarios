import { useState, type ChangeEvent } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { CalendarioParseError, parseCalendarioCsv, type CalendarioExistente } from "../../lib/calendario";
import { cn } from "../../lib/utils";
import { Alert, AlertDescription } from "../ui/alert";
import { Button, buttonVariants } from "../ui/button";
import { Label } from "../ui/label";
import { CalendarioTable } from "./CalendarioTable";

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

interface CalendarioUploadProps {
  onContinue: (calendario: CalendarioExistente, file: File) => void;
}

export function CalendarioUpload({ onContinue }: CalendarioUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [calendario, setCalendario] = useState<CalendarioExistente | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setCalendario(null);
    setError(null);
    try {
      setCalendario(parseCalendarioCsv(await readFileText(selected)));
    } catch (err) {
      setError(
        err instanceof CalendarioParseError
          ? err.message
          : "No se pudo leer el archivo como un calendario.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Subí el calendario vigente en el mismo formato que descarga la generación (filas “Día N”,
        columnas “Turno N”).
      </p>

      <div
        data-testid="calendario-row"
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm",
          error ? "border-destructive/40 bg-destructive/5" : "border-border",
        )}
      >
        {error ? (
          <Circle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
        ) : calendario ? (
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="w-44 shrink-0 font-normal">Calendario vigente</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {file ? file.name : "sin archivo"}
        </span>
        <input
          id="file-calendario"
          type="file"
          accept=".csv"
          onChange={handleChange}
          className="sr-only"
        />
        <Label
          htmlFor="file-calendario"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer")}
        >
          Elegir archivo
        </Label>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {calendario && (
        <>
          <p className="text-sm text-muted-foreground" data-testid="calendario-resumen">
            {calendario.totalEvaluaciones} evaluaciones en {calendario.dias.length} días y{" "}
            {calendario.turnos.length} turnos.
          </p>
          <CalendarioTable calendario={calendario} />
        </>
      )}

      <div className="flex justify-end mb-6">
        <Button
          type="button"
          disabled={!calendario || !file}
          onClick={() => calendario && file && onContinue(calendario, file)}
        >
          Continuar
        </Button>
      </div>
    </div>
  );
}
