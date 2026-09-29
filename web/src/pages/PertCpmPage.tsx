import { useMemo, useState } from "react";
import { exportPertCpmPdf, exportPertCpmXlsx, solvePertCpm } from "../api/client";
import ModuleWorkbench from "../components/ModuleWorkbench";
import PertActivityEditor from "../components/PertActivityEditor";
import { CPM_EXAMPLE, CRASH_EXAMPLE, PERT_EXAMPLE } from "../lib/pertExamples";
import {
  blankRow,
  rowsFromBody,
  validatePertForm,
  type PertRow,
  type TimeUnit,
} from "../lib/pertForm";
import { pertToSheet, type PertBody, type SheetMatrix } from "../lib/sheetAdapters";

type Mode = "cpm" | "pert" | "crash";

export default function PertCpmPage() {
  const [mode, setMode] = useState<Mode>("cpm");
  const [unit, setUnit] = useState<TimeUnit>("días");
  const [rows, setRows] = useState<PertRow[]>(() => [blankRow()]);
  const [crashTarget, setCrashTarget] = useState("");
  const [targetTime, setTargetTime] = useState("");
  const [targetProbability, setTargetProbability] = useState("");
  const [attempted, setAttempted] = useState(false);

  const solverMode = mode === "pert" ? "pert" : "cpm";
  const crash = mode === "crash";

  const report = useMemo(
    () =>
      attempted
        ? validatePertForm({
            mode: solverMode,
            crash,
            rows,
            crashTarget,
            targetTime,
            targetProbability,
          })
        : { errors: [], formErrors: [], body: null },
    [attempted, solverMode, crash, rows, crashTarget, targetTime, targetProbability],
  );

  function applyBody(body: PertBody, nextMode?: Mode) {
    const resolved: Mode = nextMode ?? (body.crash ? "crash" : body.mode === "pert" ? "pert" : "cpm");
    setMode(resolved);
    setRows(rowsFromBody(body));
    setCrashTarget(body.crash_target != null ? String(body.crash_target) : "");
    setTargetTime(body.target_time != null ? String(body.target_time) : "");
    setTargetProbability(body.target_probability != null ? String(body.target_probability) : "");
    setAttempted(false);
  }

  function loadExample() {
    if (mode === "pert") applyBody(PERT_EXAMPLE, "pert");
    else if (mode === "crash") applyBody(CRASH_EXAMPLE, "crash");
    else applyBody(CPM_EXAMPLE, "cpm");
  }

  const matrix = useMemo<SheetMatrix>(() => {
    const body = validatePertForm({
      mode: solverMode,
      crash,
      rows,
      crashTarget,
      targetTime,
      targetProbability,
    }).body;
    if (body) return pertToSheet(body);
    return pertToSheet({
      mode: solverMode,
      activities: rows
        .filter((row) => row.id.trim())
        .map((row) => ({
          id: row.id.trim(),
          predecessors: row.predText
            .split(/[,;]+/)
            .map((part) => part.trim())
            .filter(Boolean),
          duration: row.duration,
          a: row.a,
          m: row.m,
          b: row.b,
          crash_time: row.crash_time,
          normal_cost: row.normal_cost,
          crash_cost: row.crash_cost,
        })),
    });
  }, [solverMode, crash, rows, crashTarget, targetTime, targetProbability]);

  return (
    <ModuleWorkbench
      group="Proyectos"
      title="PERT / CPM"
      blurb="Arma el proyecto como un cronograma: una actividad por fila y predecesores separados por coma. CPM usa una duración fija, PERT tres estimaciones y la aceleración acorta la ruta crítica al menor costo. La ruta crítica se marca en magenta en la red y en el Gantt."
      matrix={matrix}
      onMatrixChange={() => undefined}
      editor={
        <PertActivityEditor
          rows={rows}
          mode={mode}
          unit={unit}
          crashTarget={crashTarget}
          targetTime={targetTime}
          targetProbability={targetProbability}
          errors={report.errors}
          formErrors={report.formErrors}
          onRows={setRows}
          onMode={(next) => {
            setMode(next);
            setAttempted(false);
          }}
          onUnit={setUnit}
          onCrashTarget={setCrashTarget}
          onTargetTime={setTargetTime}
          onTargetProbability={setTargetProbability}
          onLoadCrashExample={() => applyBody(CRASH_EXAMPLE, "crash")}
        />
      }
      buildBody={() => {
        setAttempted(true);
        const next = validatePertForm({
          mode: solverMode,
          crash,
          rows,
          crashTarget,
          targetTime,
          targetProbability,
        });
        if (!next.body) {
          const detail = next.formErrors[0] || next.errors[0]?.message;
          throw new Error(detail || "Revisa las actividades marcadas antes de calcular.");
        }
        return next.body;
      }}
      solve={solvePertCpm}
      exportXlsx={exportPertCpmXlsx}
      exportPdf={exportPertCpmPdf}
      filenameBase="pert_cpm_result"
      onLoadExample={loadExample}
      onImportBody={(body) => applyBody(body as PertBody)}
    />
  );
}
