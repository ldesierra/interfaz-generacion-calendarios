import { Link } from "react-router-dom";
import { buttonVariants } from "../components/ui/button";
import { cn } from "../lib/utils";

export function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-6 text-center">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Calendario de evaluaciones</h1>
          <p className="text-sm text-muted-foreground">¿Qué querés hacer?</p>
        </header>
        <div className="flex flex-col gap-3">
          <Link to="/generacion" className={cn(buttonVariants({ size: "lg" }))}>
            Generacion calendario optimizado
          </Link>
          <Link to="/modificacion" className={cn(buttonVariants({ size: "lg", variant: "outline" }))}>
            Modificacion calendario existente
          </Link>
        </div>
      </div>
    </main>
  );
}
