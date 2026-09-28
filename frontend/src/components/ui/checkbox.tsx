import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

function Checkbox({ className, checked, ...props }: React.ComponentProps<"input">) {
  return (
    <span className="relative inline-flex size-4 shrink-0">
      <input
        type="checkbox"
        data-slot="checkbox"
        checked={checked}
        className={cn(
          "peer size-4 shrink-0 appearance-none rounded-[4px] border border-input bg-transparent shadow-xs outline-none transition-[color,box-shadow]",
          "checked:border-primary checked:bg-primary",
          "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
      <Check
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-4 text-primary-foreground opacity-0 peer-checked:opacity-100"
      />
    </span>
  );
}

export { Checkbox };
