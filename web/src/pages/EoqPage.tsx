import { useState } from "react";
import { exportEoqPdf, exportEoqXlsx, solveEoq } from "../api/client";
import ModuleWorkbench from "../components/ModuleWorkbench";
import { emptyEoqSheet, eoqToSheet, sheetToEoq, type SheetMatrix } from "../lib/sheetAdapters";

const EXAMPLE = { D: 1000, S: 10, H: 0.5, C: 5 };

export default function EoqPage() {
  const [matrix, setMatrix] = useState<SheetMatrix>(() => emptyEoqSheet());

  return (
    <ModuleWorkbench
      group="Inventarios y producción"
      title="EOQ"
      blurb="Cantidad económica de pedido. Edita demanda (D), costo de ordenar (S), costo de mantener (H) y costo unitario (C)."
      matrix={matrix}
      onMatrixChange={setMatrix}
      buildBody={() => sheetToEoq(matrix)}
      solve={solveEoq}
      exportXlsx={exportEoqXlsx}
      exportPdf={exportEoqPdf}
      filenameBase="eoq_result"
      sheetHeight={220}
      onLoadExample={() => setMatrix(eoqToSheet(EXAMPLE))}
      onImportBody={(body) => setMatrix(eoqToSheet(body as typeof EXAMPLE))}
    />
  );
}
