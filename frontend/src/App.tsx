import { ParamsForm } from "./components/ParamsForm/ParamsForm";
import type { SolveParams } from "./api/types";
import "./App.css";

function App() {
  function handleSubmit(params: SolveParams) {
    // TODO(Tarea 1 / subtarea 5): disparar POST /api/cases/{case_id}/solve con estos params.
    console.log("Parámetros de la corrida:", params);
  }

  return (
    <main className="app">
      <h1>Correr el modelo de calendarios</h1>
      <ParamsForm onSubmit={handleSubmit} />
    </main>
  );
}

export default App;
