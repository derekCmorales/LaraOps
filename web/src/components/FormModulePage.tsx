import { ReactNode, useEffect, useState } from "react";
import { downloadBlob, ModuleResult } from "../api/client";
import ExportMenu from "./ExportMenu";
import JsonModelPanel from "./JsonModelPanel";
import ModuleShell from "./ModuleShell";
import ResultsTabs from "./ResultsTabs";

type Props = {
  group: string;
  title: string;
  blurb: string;
  filenameBase: string;
  buildBody: () => unknown;
  solve: (body: unknown) => Promise<ModuleResult>;
  exportXlsx: (body: unknown) => Promise<Blob>;
  exportPdf?: (body: unknown) => Promise<Blob>;
  onLoadExample: () => void;
  onImportBody?: (body: unknown) => void;
  schemaSlug?: string;
  children: ReactNode;
};

/** Shell de módulo con formularios / cuadrículas — sin JSON en la UI. */
export default function FormModulePage({
  group,
  title,
  blurb,
  filenameBase,
  buildBody,
  solve,
  exportXlsx,
  exportPdf,
  onLoadExample,
  onImportBody,
  schemaSlug,
  children,
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
      const body = buildBody();
      const res = await solve(body);
      setResult(res);
      setTab("resultados");
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
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
          onExportXlsx={async () => {
            try {
              downloadBlob(await exportXlsx(buildBody()), `${filenameBase}.xlsx`);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
          onExportPdf={
            exportPdf
              ? async () => {
                  try {
                    downloadBlob(await exportPdf(buildBody()), `${filenameBase}.pdf`);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                }
              : undefined
          }
        />
      }
      actionBar={
        <>
          <button type="button" className="btn btn-ghost" onClick={onLoadExample}>
            Cargar ejemplo
          </button>
          <button type="button" className="btn" disabled={loading} onClick={() => void runSolve()}>
            {loading ? "Resolviendo…" : "Resolver"}
          </button>
        </>
      }
    >
      {tab === "datos" ? (
        <div>
          <p className="module-blurb">{blurb}</p>
          {children}
          <JsonModelPanel buildBody={buildBody} onImportBody={onImportBody} result={result} schemaSlug={schemaSlug} />
        </div>
      ) : result ? (
        <ResultsTabs result={result} />
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
          {error && (
            <p className="error-inline" role="alert">
              {error}
            </p>
          )}
    </ModuleShell>
  );
}
