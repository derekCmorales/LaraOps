import { FormEvent, ReactNode, useEffect, useState } from "react";
import { downloadBlob, ModuleResult } from "../api/client";
import ExportMenu from "./ExportMenu";
import ModuleShell from "./ModuleShell";
import ResultsTabs from "./ResultsTabs";
import SpreadsheetEditor, { type SheetEditorKind } from "./SpreadsheetEditor";
import JsonModelPanel from "./JsonModelPanel";
import type { SheetMatrix } from "../lib/sheetAdapters";

type Props = {
  group: string;
  title: string;
  blurb?: string;
  matrix: SheetMatrix;
  onMatrixChange: (m: SheetMatrix) => void;
  buildBody: () => unknown;
  solve: (body: unknown) => Promise<ModuleResult>;
  exportXlsx: (body: unknown) => Promise<Blob>;
  exportPdf?: (body: unknown) => Promise<Blob>;
  filenameBase: string;
  toolbar?: ReactNode;
  sheetHeight?: number;
  /** Restaura la cuadrícula de ejemplo (no JSON). */
  onLoadExample?: () => void;
  /** Convierte JSON importado al estado del módulo (p. ej. hoja). */
  onImportBody?: (body: unknown) => void;
  /** Slug para validación JSON en `JsonModelPanel`. */
  schemaSlug?: string;
  modelPreview?: string;
  sheetKind?: SheetEditorKind;
};

export default function ModuleWorkbench({
  group,
  title,
  blurb,
  matrix,
  onMatrixChange,
  buildBody,
  solve,
  exportXlsx,
  exportPdf,
  filenameBase,
  toolbar,
  sheetHeight,
  onLoadExample,
  onImportBody,
  schemaSlug,
  modelPreview,
  sheetKind = "generic",
}: Props) {
  const [tab, setTab] = useState<"datos" | "resultados">("datos");
  const [result, setResult] = useState<ModuleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void runSolve();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  async function runSolve() {
    setError(null);
    setLoading(true);
    try {
      const res = await solve(buildBody());
      setResult(res);
      setTab("resultados");
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function onSolve(e: FormEvent) {
    e.preventDefault();
    await runSolve();
  }

  async function onExportXlsx() {
    setError(null);
    try {
      downloadBlob(await exportXlsx(buildBody()), `${filenameBase}.xlsx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onExportPdf() {
    if (!exportPdf) return;
    setError(null);
    try {
      downloadBlob(await exportPdf(buildBody()), `${filenameBase}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <ModuleShell
      group={group}
      title={title}
      tab={tab}
      onTabChange={setTab}
      resultsEnabled={!!result}
      headerRight={
        <ExportMenu
          disabled={!result && !exportPdf}
          onExportXlsx={onExportXlsx}
          onExportPdf={exportPdf ? onExportPdf : undefined}
        />
      }
      actionBar={
        <>
          {onLoadExample ? (
            <button type="button" className="btn btn-ghost" onClick={onLoadExample}>
              Cargar ejemplo
            </button>
          ) : null}
          <button type="button" className="btn" disabled={loading} onClick={() => void runSolve()}>
            {loading ? "Resolviendo…" : "Resolver"}
          </button>
        </>
      }
    >
      {tab === "datos" ? (
        <form onSubmit={onSolve}>
          {blurb ? <p className="module-blurb">{blurb}</p> : null}
          {toolbar}
          <SpreadsheetEditor matrix={matrix} onChange={onMatrixChange} height={sheetHeight} kind={sheetKind} />
          <JsonModelPanel buildBody={buildBody} onImportBody={onImportBody} result={result} schemaSlug={schemaSlug} />
          {modelPreview ? (
            <div className="model-preview">
              <span className="model-preview-label">Vista previa del modelo</span>
              {modelPreview}
            </div>
          ) : null}
          {error && (
            <p className="error-inline" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : result ? (
        <>
          <ResultsTabs result={result} />
          {error && (
            <p className="error-inline" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <div className="empty-results">
          <strong>Aún no has resuelto este modelo.</strong>
          Completa los datos y presiona Resolver.
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setTab("datos")}>
              Ir a Datos
            </button>
          </div>
        </div>
      )}
    </ModuleShell>
  );
}
