import { useState } from "react";
import { exportPertCpmPdf, exportPertCpmXlsx, solvePertCpm } from "../api/client";
import ModuleWorkbench from "../components/ModuleWorkbench";
import SelectDropdown from "../components/SelectDropdown";
import { CPM_EXAMPLE, PERT_EXAMPLE } from "../lib/pertExamples";
import {
  emptyPertSheet,
  pertToSheet,
  sheetToPert,
  type PertBody,
  type SheetMatrix,
} from "../lib/sheetAdapters";

export default function PertCpmPage() {
  const [mode, setMode] = useState<"cpm" | "pert">("cpm");
  const [matrix, setMatrix] = useState<SheetMatrix>(() => emptyPertSheet());

  function loadExample(nextMode: "cpm" | "pert") {
    setMode(nextMode);
    setMatrix(pertToSheet(nextMode === "pert" ? PERT_EXAMPLE : CPM_EXAMPLE));
  }

  return (
    <ModuleWorkbench
      group="Proyectos"
      title="PERT / CPM"
      blurb="Una actividad por fila. Predecesores separados por coma. En CPM usa Duración; en PERT captura a, m y b. La ruta crítica se marca en magenta."
      matrix={matrix}
      onMatrixChange={setMatrix}
      buildBody={() => sheetToPert(matrix, mode)}
      solve={solvePertCpm}
      exportXlsx={exportPertCpmXlsx}
      exportPdf={exportPertCpmPdf}
      filenameBase="pert_cpm_result"
      sheetHeight={300}
      onLoadExample={() => loadExample(mode)}
      onImportBody={(body) => {
        const b = body as PertBody;
        const m = b.mode ?? mode;
        setMode(m);
        setMatrix(pertToSheet(b));
      }}
      toolbar={
        <div className="config-panel" style={{ marginBottom: 12, maxWidth: 280 }}>
          <div className="field">
            <label>Modo</label>
            <SelectDropdown
              value={mode}
              onChange={(v) => setMode(v as "cpm" | "pert")}
              aria-label="Modo"
              options={[
                { value: "cpm", label: "CPM (duración fija)" },
                { value: "pert", label: "PERT (a, m, b)" },
              ]}
            />
          </div>
        </div>
      }
    />
  );
}
