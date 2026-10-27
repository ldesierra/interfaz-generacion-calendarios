import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

function Modal({ title, onClose, children, className }: ModalProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-10">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn("w-full max-w-2xl rounded-xl border bg-background p-6 shadow-lg", className)}
      >
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export { Modal };
