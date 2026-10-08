import type { UcSummary } from "../../api/types";
import { Select } from "../ui/select";

interface UcPickerProps {
  ucs: UcSummary[];
  exclude: string[];
  placeholder: string;
  ariaLabel: string;
  onPick: (codigo: string) => void;
}

// Select que agrega al elegir: vuelve siempre al placeholder, así se usa para
// ir sumando UCs a una lista (previas, profesores, coincidencias).
export function UcPicker({ ucs, exclude, placeholder, ariaLabel, onPick }: UcPickerProps) {
  const options = ucs.filter((uc) => !exclude.includes(uc.codigo));
  return (
    <Select
      value=""
      aria-label={ariaLabel}
      onChange={(event) => event.target.value && onPick(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((uc) => (
        <option key={uc.codigo} value={uc.codigo}>
          {uc.nombre} ({uc.codigo})
        </option>
      ))}
    </Select>
  );
}
