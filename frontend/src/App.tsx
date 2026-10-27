import { BrowserRouter, Route, Routes } from "react-router-dom";
import { GeneracionPage } from "./pages/GeneracionPage";
import { HomePage } from "./pages/HomePage";
import { ModificacionPage } from "./pages/ModificacionPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/generacion" element={<GeneracionPage />} />
        <Route path="/modificacion" element={<ModificacionPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
