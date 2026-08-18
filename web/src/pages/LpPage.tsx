import { useState } from "react";
import { exportLpPdf, exportLpXlsx, solveLp } from "../api/client";
import ModuleWorkbench from "../components/ModuleWorkbench";
import {
  emptyLpSheet,
  lpToSheet,
  sheetToLp,
  type LpBody,
  type SheetMatrix,
} from "../lib/sheetAdapters";

const EXAMPLE: LpBody = {
  sense: "max",
  objective: { x1: 3, x2: 2 },
  constraints: [
    { id: "R1", coeffs: { x1: 2, x2: 1 }, sense: "<=", rhs: 100 },
    { id: "R2", coeffs: { x1: 1, x2: 1 }, sense: "<=", rhs: 80 },
    { id: "R3", coeffs: { x1: 1, x2: 0 }, sense: "<=", rhs: 40 },
  ],
};

type LpOptions = {
  include_iterations: boolean;
  include_sensitivity: boolean;
  include_graph: boolean;
};

export default function LpPage() {
  const [matrix, setMatrix] = useState<SheetMatrix>(() => emptyLpSheet(2, 3));
  const [options, setOptions] = useState<LpOptions>({
    include_iterations: true,
    include_sensitivity: true,
    include_graph: true,
  });

  function buildBody() {
    const body = sheetToLp(matrix);
    return { ...body, ...options };
  }

  function toggleOption(key: keyof LpOptions) {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <ModuleWorkbench
      group="Optimización"
      title="Programación lineal"
      blurb="Fila 1: nombres de variables. Fila 2: objetivo Z. Resto: restricciones con Sentido y LD. Tras resolver verás Solución (variables y restricciones activas), Sensibilidad (holgura y rangos LD), Iteraciones (simplex) y Gráfico (si hay 2 variables). Pega bloques desde Excel con Ctrl+V."
      matrix={matrix}
      onMatrixChange={setMatrix}
      buildBody={buildBody}
      solve={solveLp}
      exportXlsx={exportLpXlsx}
      exportPdf={exportLpPdf}
      filenameBase="lp_result"
      schemaSlug="lp"
      sheetHeight={300}
      sheetKind="lp"
      onLoadExample={() => setMatrix(lpToSheet(EXAMPLE))}
      onImportBody={(body) => setMatrix(lpToSheet(body as LpBody))}
      toolbar={
        <fieldset className="lp-options">
          <legend className="section-label">Opciones de reporte</legend>
          <label className="check-inline">
            <input
              type="checkbox"
              checked={options.include_iterations}
              onChange={() => toggleOption("include_iterations")}
            />
            Iteraciones simplex
          </label>
          <label className="check-inline">
            <input
              type="checkbox"
              checked={options.include_sensitivity}
              onChange={() => toggleOption("include_sensitivity")}
            />
            Sensibilidad / ranging
          </label>
          <label className="check-inline">
            <input
              type="checkbox"
              checked={options.include_graph}
              onChange={() => toggleOption("include_graph")}
            />
            Gráfico (2 variables)
          </label>
        </fieldset>
      }
    />
  );
}
