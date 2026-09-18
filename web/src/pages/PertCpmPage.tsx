import { useState } from "react";
import { exportPertCpmPdf, exportPertCpmXlsx, solvePertCpm } from "../api/client";
import ModuleWorkbench from "../components/ModuleWorkbench";
import SelectDropdown from "../components/SelectDropdown";
import { CPM_EXAMPLE, CRASH_EXAMPLE, PERT_EXAMPLE } from "../lib/pertExamples";
import {
  emptyPertSheet,
  pertToSheet,
  sheetToPert,
  type PertBody,
  type SheetMatrix,
} from "../lib/sheetAdapters";

export default function PertCpmPage() {
  const [mode, setMode] = useState<"cpm" | "pert">("cpm");
  const [crash, setCrash] = useState(false);
  const [crashTarget, setCrashTarget] = useState("10");
  const [matrix, setMatrix] = useState<SheetMatrix>(() => emptyPertSheet());

  function loadExample(nextMode: "cpm" | "pert") {
    setMode(nextMode);
    setCrash(false);
    setMatrix(pertToSheet(nextMode === "pert" ? PERT_EXAMPLE : CPM_EXAMPLE));
  }

  function loadCrashExample() {
    setMode("cpm");
    setCrash(true);
    setCrashTarget(String(CRASH_EXAMPLE.crash_target ?? 10));
    setMatrix(pertToSheet(CRASH_EXAMPLE));
  }

  return (
    <ModuleWorkbench
      group="Proyectos"
      title="PERT / CPM"
      blurb="Una actividad por fila. Predecesores separados por coma. En CPM usa Duración; en PERT captura a, m y b. Para aceleración (crash) rellena tiempo/costo crash y un objetivo de duración. La ruta crítica se marca en magenta."
      matrix={matrix}
      onMatrixChange={setMatrix}
      buildBody={() => {
        const body = sheetToPert(matrix, mode);
        if (crash && mode === "cpm") {
          body.crash = true;
          const target = Number(crashTarget);
          if (Number.isFinite(target)) body.crash_target = target;
        }
        return body;
      }}
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
        setCrash(Boolean(b.crash));
        if (b.crash_target != null) setCrashTarget(String(b.crash_target));
        setMatrix(pertToSheet(b));
      }}
      toolbar={
        <div className="config-panel" style={{ marginBottom: 12, maxWidth: 420 }}>
          <div className="field">
            <label>Modo</label>
            <SelectDropdown
              value={mode}
              onChange={(v) => {
                const next = v as "cpm" | "pert";
                setMode(next);
                if (next === "pert") setCrash(false);
              }}
              aria-label="Modo"
              options={[
                { value: "cpm", label: "CPM (duración fija)" },
                { value: "pert", label: "PERT (a, m, b)" },
              ]}
            />
          </div>
          {mode === "cpm" && (
            <>
              <label className="field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={crash}
                  onChange={(e) => setCrash(e.target.checked)}
                />
                Aceleración (crash)
              </label>
              {crash && (
                <div className="field">
                  <label htmlFor="crash-target">Duración objetivo</label>
                  <input
                    id="crash-target"
                    type="number"
                    value={crashTarget}
                    onChange={(e) => setCrashTarget(e.target.value)}
                  />
                </div>
              )}
              <button type="button" className="btn btn-ghost" onClick={loadCrashExample}>
                Ejemplo aceleración
              </button>
            </>
          )}
        </div>
      }
    />
  );
}
