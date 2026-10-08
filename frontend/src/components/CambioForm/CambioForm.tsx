import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import {
  ApiError,
  ChangeValidationApiError,
  estimateCoincidencia,
  getCatalog,
  getUcDetail,
} from "../../api/client";
import type { Catalog, UcChange } from "../../api/types";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { UcPicker } from "./UcPicker";

interface CambioFormProps {
  caseId: string;
  // Códigos de las UCs presentes en el calendario vigente: una modificación
  // sólo tiene sentido sobre una UC que ya está ubicada.
  codigosEnCalendario: Set<string>;
  // Cambio a editar; sin él, el formulario arranca vacío.
  initial?: UcChange;
  // Posición que ocupará/ocupa este cambio en la lista: se usa para mostrar
  // junto a cada campo sólo los errores del backend que le corresponden.
  index: number;
  // Debe lanzar ChangeValidationApiError (o Error) si el cambio no se acepta.
  onSubmit: (change: UcChange) => Promise<void>;
  onCancel: () => void;
}

type Tipo = UcChange["tipo"];
type FieldErrors = Record<string, string[]>;

interface TrayectoriaRow {
  carrera: string;
  semestre: string;
}
interface CoincidenciaRow {
  uc: string;
  valor: string;
}

export function CambioForm({ caseId, codigosEnCalendario, initial, index, onSubmit, onCancel }: CambioFormProps) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tipo, setTipo] = useState<Tipo>(initial?.tipo ?? "alta");
  const [codigo, setCodigo] = useState(initial?.codigo ?? "");
  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [inscriptos, setInscriptos] = useState(initial ? String(initial.inscriptos) : "");
  const [trayectoria, setTrayectoria] = useState<TrayectoriaRow[]>(
    initial?.trayectoria.length
      ? initial.trayectoria.map((t) => ({ carrera: t.carrera, semestre: String(t.semestre) }))
      : [{ carrera: "", semestre: "" }],
  );
  const [previas, setPrevias] = useState<string[]>(initial?.previas ?? []);
  const [profesores, setProfesores] = useState<string[]>(initial?.profesores ?? []);
  const [coincidencias, setCoincidencias] = useState<CoincidenciaRow[]>(
    initial?.coincidencias.map((c) => ({ uc: c.uc, valor: String(c.coincidencia) })) ?? [],
  );

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingUc, setLoadingUc] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimateNote, setEstimateNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCatalog(caseId)
      .then((c) => !cancelled && setCatalog(c))
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "No se pudo cargar el caso.");
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const nombres = useMemo(
    () => new Map(catalog?.ucs.map((uc) => [uc.codigo, uc.nombre]) ?? []),
    [catalog],
  );
  const labelFor = (uc: string) => (nombres.has(uc) ? `${nombres.get(uc)} (${uc})` : uc);
  const modificables = useMemo(
    () => catalog?.ucs.filter((uc) => codigosEnCalendario.has(uc.codigo)) ?? [],
    [catalog, codigosEnCalendario],
  );

  function clearError(field: string) {
    setErrors((prev) => ({ ...prev, [field]: [] }));
  }

  function resetFields() {
    setCodigo("");
    setNombre("");
    setInscriptos("");
    setTrayectoria([{ carrera: "", semestre: "" }]);
    setPrevias([]);
    setProfesores([]);
    setCoincidencias([]);
    setErrors({});
    setSubmitError(null);
    setEstimateNote(null);
  }

  function handleTipoChange(next: Tipo) {
    setTipo(next);
    resetFields();
  }

  async function handleSelectUc(selected: string) {
    resetFields();
    setCodigo(selected);
    if (!selected) return;
    setLoadingUc(true);
    try {
      const detail = await getUcDetail(caseId, selected);
      setNombre(detail.nombre);
      setInscriptos(String(detail.inscriptos));
      setTrayectoria(
        detail.trayectoria.length > 0
          ? detail.trayectoria.map((t) => ({ carrera: t.carrera, semestre: String(t.semestre) }))
          : [{ carrera: "", semestre: "" }],
      );
      setPrevias(detail.previas);
      setProfesores(detail.profesores);
      setCoincidencias(detail.coincidencias.map((c) => ({ uc: c.uc, valor: String(c.coincidencia) })));
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "No se pudo cargar la UC.");
    } finally {
      setLoadingUc(false);
    }
  }

  const trayectoriaCompleta = trayectoria.filter((t) => t.carrera && t.semestre);
  const inscriptosNum = Number(inscriptos);
  const canEstimate =
    inscriptos !== "" && Number.isFinite(inscriptosNum) && inscriptosNum >= 0 && trayectoriaCompleta.length > 0;

  async function handleEstimate() {
    setEstimating(true);
    setEstimateNote(null);
    setSubmitError(null);
    try {
      const estimates = await estimateCoincidencia(caseId, {
        codigo: tipo === "modificacion" ? codigo : null,
        inscriptos: inscriptosNum,
        trayectoria: trayectoriaCompleta.map((t) => ({ carrera: t.carrera, semestre: Number(t.semestre) })),
      });
      setCoincidencias(estimates.map((e) => ({ uc: e.uc, valor: String(e.coincidencia) })));
      clearError("coincidencias");
      setEstimateNote(
        `Se estimaron ${estimates.length} coincidencias con UCs de la misma carrera y semestre. Podés editarlas.`,
      );
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "No se pudo estimar la coincidencia.");
    } finally {
      setEstimating(false);
    }
  }

  function validateLocally(): FieldErrors {
    const found: FieldErrors = {};
    const add = (field: string, msg: string) => (found[field] = [...(found[field] ?? []), msg]);
    if (!codigo.trim()) add("codigo", tipo === "alta" ? "Ingresá el código." : "Elegí la UC a modificar.");
    if (tipo === "alta" && !nombre.trim()) add("nombre", "Ingresá el nombre.");
    if (inscriptos === "" || !Number.isFinite(inscriptosNum) || inscriptosNum < 0) {
      add("inscriptos", "Ingresá un número mayor o igual a 0.");
    }
    if (trayectoriaCompleta.length === 0) add("trayectoria", "Indicá al menos una carrera y semestre.");
    if (trayectoria.some((t) => Boolean(t.carrera) !== Boolean(t.semestre))) {
      add("trayectoria", "Completá carrera y semestre en cada fila.");
    }
    if (coincidencias.some((c) => c.valor === "" || !(Number(c.valor) >= 0))) {
      add("coincidencias", "Cada coincidencia debe ser un número mayor o igual a 0.");
    }
    return found;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const local = validateLocally();
    setErrors(local);
    setSubmitError(null);
    if (Object.keys(local).length > 0) return;

    setSubmitting(true);
    try {
      await onSubmit({
        tipo,
        codigo: codigo.trim(),
        nombre: nombre.trim() || null,
        inscriptos: inscriptosNum,
        trayectoria: trayectoriaCompleta.map((t) => ({ carrera: t.carrera, semestre: Number(t.semestre) })),
        previas,
        profesores,
        coincidencias: coincidencias.map((c) => ({ uc: c.uc, coincidencia: Number(c.valor) })),
      });
    } catch (err) {
      if (err instanceof ChangeValidationApiError) {
        const byField: FieldErrors = {};
        const others: string[] = [];
        for (const d of err.details) {
          if (d.index === index) byField[d.field] = [...(byField[d.field] ?? []), d.issue];
          else others.push(`Cambio ${d.index + 1}: ${d.issue}`);
        }
        setErrors(byField);
        if (others.length > 0) setSubmitError(others.join("; "));
      } else {
        setSubmitError(err instanceof Error ? err.message : "No se pudo guardar el cambio.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }
  if (!catalog) return <p className="text-sm text-muted-foreground">Cargando datos del caso…</p>;

  const fieldError = (field: string) =>
    errors[field]?.length ? (
      <p className="text-xs text-destructive" role="alert">
        {errors[field].join("; ")}
      </p>
    ) : null;

  const chips = (list: string[], onRemove: (uc: string) => void) => (
    <ul className="flex flex-wrap gap-1.5">
      {list.map((uc) => (
        <li
          key={uc}
          className="flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs"
        >
          {labelFor(uc)}
          <button
            type="button"
            aria-label={`Quitar ${labelFor(uc)}`}
            className="cursor-pointer rounded-full p-0.5 hover:bg-accent"
            onClick={() => onRemove(uc)}
          >
            <Trash2 className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );

  const section = "flex flex-col gap-2 rounded-md border border-border px-3 py-3 text-sm";

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <div className="flex gap-2" role="group" aria-label="Tipo de cambio">
        <Button
          type="button"
          variant={tipo === "alta" ? "default" : "outline"}
          aria-pressed={tipo === "alta"}
          onClick={() => handleTipoChange("alta")}
        >
          Alta de UC nueva
        </Button>
        <Button
          type="button"
          variant={tipo === "modificacion" ? "default" : "outline"}
          aria-pressed={tipo === "modificacion"}
          onClick={() => handleTipoChange("modificacion")}
        >
          Modificar UC existente
        </Button>
      </div>

      <div className={section}>
        {tipo === "alta" ? (
          <>
            <label className="flex flex-col gap-1">
              <span>Código</span>
              <Input value={codigo} onChange={(e) => { setCodigo(e.target.value); clearError("codigo"); }} />
            </label>
            {fieldError("codigo")}
            <label className="flex flex-col gap-1">
              <span>Nombre</span>
              <Input value={nombre} onChange={(e) => { setNombre(e.target.value); clearError("nombre"); }} />
            </label>
            {fieldError("nombre")}
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span>UC a modificar</span>
              <Select value={codigo} onChange={(e) => handleSelectUc(e.target.value)}>
                <option value="">Elegí una UC del calendario…</option>
                {modificables.map((uc) => (
                  <option key={uc.codigo} value={uc.codigo}>
                    {uc.nombre} ({uc.codigo})
                  </option>
                ))}
              </Select>
            </label>
            {modificables.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Ninguna UC del calendario cargado coincide con las UCs del caso.
              </p>
            )}
            {fieldError("codigo")}
          </>
        )}
        <label className="flex flex-col gap-1">
          <span>Inscriptos</span>
          <Input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            className="w-32"
            value={inscriptos}
            disabled={loadingUc}
            onChange={(e) => { setInscriptos(e.target.value); clearError("inscriptos"); }}
          />
        </label>
        {fieldError("inscriptos")}
      </div>

      <div className={section}>
        <span className="font-medium">Carrera y semestre</span>
        {trayectoria.map((row, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={`Carrera ${index + 1}`}
              className="w-56"
              value={row.carrera}
              onChange={(e) => {
                setTrayectoria((prev) => prev.map((r, i) => (i === index ? { ...r, carrera: e.target.value } : r)));
                clearError("trayectoria");
              }}
            >
              <option value="">Carrera…</option>
              {catalog.carreras.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.nombre}
                </option>
              ))}
            </Select>
            <Select
              aria-label={`Semestre ${index + 1}`}
              className="w-32"
              value={row.semestre}
              onChange={(e) => {
                setTrayectoria((prev) => prev.map((r, i) => (i === index ? { ...r, semestre: e.target.value } : r)));
                clearError("trayectoria");
              }}
            >
              <option value="">Semestre…</option>
              {catalog.semestres.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            {trayectoria.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Quitar fila ${index + 1}`}
                onClick={() => setTrayectoria((prev) => prev.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setTrayectoria((prev) => [...prev, { carrera: "", semestre: "" }])}
          >
            Agregar carrera
          </Button>
        </div>
        {fieldError("trayectoria")}
      </div>

      <div className={section}>
        <span className="font-medium">Previas</span>
        {chips(previas, (uc) => setPrevias((prev) => prev.filter((p) => p !== uc)))}
        <UcPicker
          ucs={catalog.ucs}
          exclude={[...previas, codigo]}
          placeholder="Agregar previa…"
          ariaLabel="Agregar previa"
          onPick={(uc) => { setPrevias((prev) => [...prev, uc]); clearError("previas"); }}
        />
        {fieldError("previas")}
      </div>

      <div className={section}>
        <span className="font-medium">Profesores en común</span>
        <p className="text-xs text-muted-foreground">UCs que comparten algún profesor con esta.</p>
        {chips(profesores, (uc) => setProfesores((prev) => prev.filter((p) => p !== uc)))}
        <UcPicker
          ucs={catalog.ucs}
          exclude={[...profesores, codigo]}
          placeholder="Agregar UC…"
          ariaLabel="Agregar profesor en común"
          onPick={(uc) => { setProfesores((prev) => [...prev, uc]); clearError("profesores"); }}
        />
        {fieldError("profesores")}
      </div>

      <div className={section}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">Coincidencia con otras UCs</span>
          <Button type="button" variant="outline" size="sm" disabled={!canEstimate || estimating} onClick={handleEstimate}>
            {estimating ? "Estimando..." : "Estimar automáticamente"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Estudiantes que cursan ambas UCs. Las UCs que no figuran se toman como 0.
        </p>
        {estimateNote && <p className="text-xs text-muted-foreground">{estimateNote}</p>}
        {coincidencias.length > 0 && (
          <ul className="flex max-h-72 flex-col divide-y divide-border overflow-auto">
            {coincidencias.map((row) => (
              <li key={row.uc} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">{labelFor(row.uc)}</span>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  className="w-24"
                  aria-label={`Coincidencia con ${labelFor(row.uc)}`}
                  value={row.valor}
                  onChange={(e) => {
                    setCoincidencias((prev) => prev.map((r) => (r.uc === row.uc ? { ...r, valor: e.target.value } : r)));
                    clearError("coincidencias");
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar coincidencia con ${labelFor(row.uc)}`}
                  onClick={() => setCoincidencias((prev) => prev.filter((r) => r.uc !== row.uc))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <UcPicker
          ucs={catalog.ucs}
          exclude={[...coincidencias.map((c) => c.uc), codigo]}
          placeholder="Agregar coincidencia con…"
          ariaLabel="Agregar coincidencia"
          onPick={(uc) => setCoincidencias((prev) => [...prev, { uc, valor: "" }])}
        />
        {fieldError("coincidencias")}
      </div>

      {submitError && (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={submitting || loadingUc}>
          {submitting ? "Guardando..." : "Guardar cambio"}
        </Button>
      </div>
    </form>
  );
}
