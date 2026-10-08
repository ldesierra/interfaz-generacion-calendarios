import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { putChanges } from "../../api/client";
import type { UcChange } from "../../api/types";
import { CambioForm } from "../CambioForm/CambioForm";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Modal } from "../ui/modal";

interface CambiosStepProps {
  caseId: string;
  codigosEnCalendario: Set<string>;
  changes: UcChange[];
  onChange: (changes: UcChange[]) => void;
  onContinue: () => void;
  // true mientras el padre prepara el paso siguiente (deshabilita Continuar).
  continuing?: boolean;
}

// `index === null` es un alta de cambio nueva (se agrega al final de la lista).
type Editing = { index: number | null };

export function CambiosStep({ caseId, codigosEnCalendario, changes, onChange, onContinue, continuing = false }: CambiosStepProps) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Cada alta/edición/baja se manda como la lista completa: el backend
  // valida el conjunto (referencias entre cambios, UCs repetidas) y la guarda.
  async function commit(next: UcChange[]) {
    await putChanges(caseId, next);
    onChange(next);
  }

  async function handleSubmit(change: UcChange) {
    const index = editing?.index ?? changes.length;
    const next = [...changes];
    next[index] = change;
    await commit(next);
    setEditing(null);
  }

  async function handleRemove(index: number) {
    setRemoveError(null);
    try {
      await commit(changes.filter((_, i) => i !== index));
    } catch {
      setRemoveError("No se pudo quitar el cambio: otro cambio depende de esta UC.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Agregá todas las altas y modificaciones de UCs que quieras ubicar en el calendario.
      </p>

      {changes.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Todavía no agregaste ningún cambio.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="lista-cambios">
          {changes.map((change, index) => (
            <li
              key={change.codigo}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <Badge variant={change.tipo === "alta" ? "default" : "secondary"}>
                {change.tipo === "alta" ? "Alta" : "Modificación"}
              </Badge>
              <span className="min-w-0 flex-1 truncate">
                {change.nombre ?? ""} <span className="text-muted-foreground">({change.codigo})</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Editar ${change.codigo}`}
                onClick={() => setEditing({ index })}
              >
                <Pencil />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Quitar ${change.codigo}`}
                onClick={() => handleRemove(index)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {removeError && (
        <p className="text-xs text-destructive" role="alert">
          {removeError}
        </p>
      )}

      <div>
        <Button type="button" variant="outline" onClick={() => setEditing({ index: null })}>
          Agregar modificación
        </Button>
      </div>

      <div className="mb-6 flex justify-end">
        <Button type="button" disabled={changes.length === 0 || continuing} onClick={onContinue}>
          {continuing ? "Preparando..." : "Continuar"}
        </Button>
      </div>

      {editing && (
        <Modal
          title={editing.index === null ? "Agregar modificación" : "Editar modificación"}
          onClose={() => setEditing(null)}
        >
          <CambioForm
            caseId={caseId}
            codigosEnCalendario={codigosEnCalendario}
            initial={editing.index === null ? undefined : changes[editing.index]}
            index={editing.index ?? changes.length}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}
