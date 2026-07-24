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

export default function LpPage() {
  const [matrix, setMatrix] = useState<SheetMatrix>(() => emptyLpSheet(2, 1));

  return (
    <ModuleWorkbench
      group="Optimización"
      title="Programación lineal"
      blurb="Fila 1: nombres de variables (editable). Fila 2: objetivo Z. Resto: restricciones. Usa Máx/Mín y ≤ ≥ =. Puedes renombrar variables sin romper el modelo."
      matrix={matrix}
      onMatrixChange={setMatrix}
      buildBody={() => sheetToLp(matrix)}
      solve={solveLp}
      exportXlsx={exportLpXlsx}
      exportPdf={exportLpPdf}
      filenameBase="lp_result"
      schemaSlug="lp"
      sheetHeight={300}
      sheetKind="lp"
      onLoadExample={() => setMatrix(lpToSheet(EXAMPLE))}
      onImportBody={(body) => setMatrix(lpToSheet(body as LpBody))}
    />
  );
}
