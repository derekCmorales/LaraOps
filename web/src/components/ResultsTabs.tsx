import { useMemo, useState, type ReactNode } from "react";
import type { ModuleResult } from "../api/client";
import { labelColumns, labeledEntries, labelTableRows, tableName, translateVariable, translateWarning } from "../lib/resultLabels";
import ChartViews from "./ChartViews";
import Explainer from "./Explainer";
import IterationsViewer, { type IterationStepView } from "./IterationsViewer";
import SolutionTable from "./SolutionTable";
import StatusBand from "./StatusBand";
import JsonTable from "./JsonTable";

type Props = { result: ModuleResult };

function SensitivityPane({ result }: Props) {
  const sens = result.sensitivity as {
    shadow_prices?: Record<string, unknown>[];
    reduced_costs?: Record<string, unknown>[];
    objective_ranges?: Record<string, unknown>[];
    rhs_ranges?: Record<string, unknown>[];
  } | null;
  if (!sens) return null;

  function block(title: string, rows: Record<string, unknown>[] | undefined) {
    if (!rows?.length) return null;
    const cols = Object.keys(rows[0]);
    return (
      <SolutionTable
        key={title}
        caption={title}
        columns={labelColumns(cols)}
        rows={rows.map((r) => cols.map((c) => r[c] as string | number))}
        textColumns={[0]}
      />
    );
  }

  const blocks: ReactNode[] = [
    block("Precios sombra", sens.shadow_prices),
    block("Costos reducidos", sens.reduced_costs),
    block("Rangos de optimalidad", sens.objective_ranges),
    block("Rangos de factibilidad (lado derecho)", sens.rhs_ranges),
  ].filter(Boolean);

  return (
    <div>
      {blocks.length ? (
        blocks
      ) : (
        <p className="field-hint">No hay tablas de sensibilidad para este resultado.</p>
      )}
    </div>
  );
}

export default function ResultsTabs({ result }: Props) {
  const panes = useMemo(() => {
    const list: { id: string; label: string; content: ReactNode }[] = [
      {
        id: "solution",
        label: "Solución",
        content: (
          <div>
            {result.warnings?.length > 0 && (
              <ul className="warn-list">
                {result.warnings.map((w) => (
                  <li key={w}>{translateWarning(w)}</li>
                ))}
              </ul>
            )}
            {Object.keys(result.solution.variables).length > 0 ? (
              <SolutionTable
                caption="Variables"
                columns={["Variable", "Valor"]}
                rows={Object.entries(result.solution.variables).map(([k, v]) => [
                  translateVariable(k),
                  v,
                ])}
                textColumns={[0]}
              />
            ) : Object.keys(result.solution.metrics).length > 0 ? (
              <SolutionTable
                caption="Resultados"
                columns={["Métrica", "Valor"]}
                rows={labeledEntries(result.solution.metrics as Record<string, unknown>)}
                textColumns={[0]}
              />
            ) : (
              <p className="field-hint">No hay variables ni métricas en este resultado.</p>
            )}
            {Object.keys(result.solution.variables).length > 0 &&
              Object.keys(result.solution.metrics).length > 0 && (
              <SolutionTable
                caption="Métricas"
                columns={["Métrica", "Valor"]}
                rows={labeledEntries(result.solution.metrics as Record<string, unknown>)}
                textColumns={[0]}
              />
            )}
            <Explainer result={result} />
          </div>
        ),
      },
    ];
    if (result.iterations?.length) {
      const steps = result.iterations as IterationStepView[];
      list.push({
        id: "iterations",
        label: "Iteraciones",
        content: <IterationsViewer steps={steps} />,
      });
    }
    if (result.sensitivity) {
      list.push({ id: "sensitivity", label: "Sensibilidad", content: <SensitivityPane result={result} /> });
    }
    if (result.graph) {
      list.push({ id: "graph", label: "Gráfico", content: <ChartViews result={result} /> });
    }
    if (result.tables?.length) {
      list.push({
        id: "tables",
        label: "Tablas",
        content: (
          <div>
            {result.tables.map((t) => (
              <div key={t.name} style={{ marginBottom: 16 }}>
                <JsonTable
                  table={{
                    ...t,
                    name: tableName(t.name),
                    columns: labelColumns(t.columns),
                    rows: labelTableRows(t.rows),
                  }}
                />
              </div>
            ))}
          </div>
        ),
      });
    }
    return list;
  }, [result]);

  const [tab, setTab] = useState(panes[0]?.id ?? "solution");
  const active = panes.find((p) => p.id === tab) ?? panes[0];

  return (
    <section aria-live="polite">
      <StatusBand
        status={result.status}
        objectiveValue={result.solution.objective_value}
        objectiveSense={result.solution.objective_sense}
        warnings={result.warnings}
      />
      <div className="result-tabs" role="tablist" aria-label="Vistas del resultado">
        {panes.map((p) => (
          <button
            key={p.id}
            type="button"
            id={`tab-${p.id}`}
            className="result-tab"
            role="tab"
            aria-selected={active?.id === p.id}
            aria-controls={`panel-${p.id}`}
            onClick={() => setTab(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${active?.id}`} aria-labelledby={`tab-${active?.id}`}>
        {active?.content}
      </div>
    </section>
  );
}
