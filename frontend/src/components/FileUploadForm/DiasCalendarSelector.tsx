import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { computeDiaIds, isSameDate } from "../../lib/dias";

const WEEKDAY_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const MAX_MONTHS_FORWARD = 12;

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

// Lunes = 0 ... domingo = 6, para alinear la grilla con la semana local.
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function buildMonthCells(month: Date): (Date | null)[] {
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const leadingBlanks = mondayIndex(startOfMonth(month));
  const cells: (Date | null)[] = Array.from({ length: leadingBlanks }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), day));
  }
  return cells;
}

interface DiasCalendarSelectorProps {
  selectedDates: Date[];
  onChange: (dates: Date[]) => void;
}

export function DiasCalendarSelector({ selectedDates, onChange }: DiasCalendarSelectorProps) {
  const initialMonth = useMemo(() => startOfMonth(new Date()), []);
  const [viewMonth, setViewMonth] = useState(initialMonth);
  const maxMonth = useMemo(() => addMonths(initialMonth, MAX_MONTHS_FORWARD), [initialMonth]);

  const idByTime = useMemo(() => {
    const sorted = [...selectedDates].sort((a, b) => a.getTime() - b.getTime());
    const ids = computeDiaIds(sorted);
    return new Map(sorted.map((date, index) => [date.getTime(), ids[index]]));
  }, [selectedDates]);

  const cells = useMemo(() => buildMonthCells(viewMonth), [viewMonth]);

  function toggleDate(date: Date) {
    const exists = selectedDates.some((d) => isSameDate(d, date));
    onChange(exists ? selectedDates.filter((d) => !isSameDate(d, date)) : [...selectedDates, date]);
  }

  const canGoPrev = viewMonth.getTime() > initialMonth.getTime();
  const canGoNext = viewMonth.getTime() < maxMonth.getTime();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canGoPrev}
          onClick={() => setViewMonth((m) => addMonths(m, -1))}
          aria-label="Mes anterior"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm font-medium capitalize">
          {viewMonth.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canGoNext}
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
          aria-label="Mes siguiente"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, index) => {
          if (!date) return <span key={`blank-${index}`} />;
          const id = idByTime.get(date.getTime());
          const isSelected = id !== undefined;
          return (
            <button
              key={date.getTime()}
              type="button"
              data-testid={`dia-cell-${date.getDate()}`}
              onClick={() => toggleDate(date)}
              aria-pressed={isSelected}
              aria-label={date.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}
              className={cn(
                "mx-auto flex size-8 items-center justify-center rounded-full text-sm",
                isSelected
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {isSelected ? id : date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
