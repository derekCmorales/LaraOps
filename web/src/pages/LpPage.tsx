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

function sheetVarNames(matrix: SheetMatrix): string[] {
  if (!matrix.length) return [];
  return matrix[0]
    .slice(1, -2)
    .map((cell) => String(cell ?? "").trim())
    .filter(Boolean);
}

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
  const [picked, setPicked] = useState<string[] | null>(null);
  const varNames = sheetVarNames(matrix);
  const selected = (picked ?? varNames.slice(0, 3)).filter((name) => varNames.includes(name));

  function buildBody() {
    const body = sheetToLp(matrix);
    const graph_variables =
      varNames.length >= 3 && selected.length >= 2 && selected.length <= 3 ? selected : undefined;
    return { ...body, ...options, ...(graph_variables ? { graph_variables } : {}) };
  }

  function toggleGraphVar(name: string) {
    setPicked(() => {
      const current = (picked ?? varNames.slice(0, 3)).filter((item) => varNames.includes(item));
      if (current.includes(name)) return current.filter((item) => item !== name);
      const next = [...current, name];
      return next.length > 3 ? next.slice(next.length - 3) : next;
    });
  }

  function toggleOption(key: keyof LpOptions) {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <ModuleWorkbench
      group="Optimización"
      title="Programación lineal"
      blurb="Fila 1: nombres de variables. Fila 2: objetivo Z. Resto: restricciones con Sentido y LD. Tras resolver verás Solución, Sensibilidad, Iteraciones simplex y el Gráfico: plano con 2 variables, poliedro con 3, o un corte por el óptimo si hay más. Pega bloques desde Excel con Ctrl+V."
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
            Gráfico (2D o 3D)
          </label>
          {options.include_graph && varNames.length >= 3 ? (
            <div className="lp-graph-vars">
              <span className="section-label">Variables del gráfico</span>
              {varNames.map((name) => (
                <label key={name} className="check-inline">
                  <input
                    type="checkbox"
                    checked={selected.includes(name)}
                    onChange={() => toggleGraphVar(name)}
                  />
                  {name}
                </label>
              ))}
              <p className="field-hint">
                {selected.length === 2
                  ? "Corte plano: las demás variables se fijan en el óptimo."
                  : selected.length === 3
                    ? varNames.length === 3
                      ? "Poliedro en tres variables."
                      : "Corte 3D por el óptimo: las demás variables quedan fijas."
                    : "Elige 2 variables para un plano o 3 para un poliedro."}
              </p>
            </div>
          ) : null}
        </fieldset>
      }
    />
  );
}
