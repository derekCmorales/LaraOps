import { useMemo, useState, type ReactNode } from "react";
import type { ModuleResult } from "../api/client";
import {
  labelColumns,
  labeledEntries,
  labelTableRows,
  tableName,
  translateVariable,
  translateWarning,
} from "../lib/resultLabels";
import ChartViews from "./ChartViews";
import Explainer from "./Explainer";
import IterationsViewer, { type IterationStepView } from "./IterationsViewer";
import SolutionTable from "./SolutionTable";
import StatusBand from "./StatusBand";
import JsonTable from "./JsonTable";

type Props = { result: ModuleResult };

type SensitivityData = {
  constraint_analysis?: Record<string, unknown>[];
  objective_ranges?: Record<string, unknown>[];
  reduced_costs?: Record<string, unknown>[];
};

function tableFromRows(
  title: string,
  rows: Record<string, unknown>[] | undefined,
  opts?: { activeRowIndexes?: number[]; filterCols?: string[] },
) {
  if (!rows?.length) return null;
  let cols = Object.keys(rows[0]);
  if (opts?.filterCols) {
    cols = cols.filter((c) => opts.filterCols!.includes(c));
  }
  const activeRowIndexes =
    opts?.activeRowIndexes ??
    (cols.includes("slack_or_surplus")
      ? rows
          .map((r, i) => (Math.abs(Number(r.slack_or_surplus ?? 1)) < 1e-6 ? i : -1))
          .filter((i) => i >= 0)
      : []);
  return (
    <SolutionTable
      key={title}
      caption={title}
      columns={labelColumns(cols)}
      rows={rows.map((r) => cols.map((c) => r[c] as string | number))}
      textColumns={[0]}
      activeRowIndexes={activeRowIndexes}
    />
  );
}

function SensitivityPane({ result }: Props) {
  const sens = result.sensitivity as SensitivityData | null;
  if (!sens) return null;

  const nonBasicReduced =
    sens.reduced_costs?.filter((r) => Math.abs(Number(r.reduced_cost ?? 0)) > 1e-8) ?? [];

  const blocks: ReactNode[] = [
    tableFromRows("Análisis de restricciones", sens.constraint_analysis),
    tableFromRows("Rangos de optimalidad", sens.objective_ranges, {
      filterCols: ["variable", "coeff", "allowable_decrease", "allowable_increase", "min_coef", "max_coef"],
    }),
    nonBasicReduced.length
      ? tableFromRows("Costos reducidos (variables no básicas)", nonBasicReduced, {
          filterCols: ["variable", "reduced_cost"],
        })
      : null,
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

function LpSolutionPane({ result }: Props) {
  const sens = result.sensitivity as SensitivityData | null;
  const rcByVar = new Map(
    (sens?.reduced_costs ?? []).map((r) => [String(r.variable), Number(r.reduced_cost ?? 0)]),
  );
  const coefByVar = new Map(
    (sens?.objective_ranges ?? []).map((r) => [String(r.variable), Number(r.coeff ?? 0)]),
  );

  const varRows = Object.entries(result.solution.variables).map(([k, v]) => [
    translateVariable(k),
    v,
    coefByVar.get(k) ?? "—",
    rcByVar.has(k) ? rcByVar.get(k)! : "—",
  ]);

  const constraintSummary =
    sens?.constraint_analysis?.map((r) => [
      r.constraint_id,
      r.lhs,
      r.sense,
      r.rhs,
      r.slack_or_surplus,
      r.shadow_price,
    ]) ?? [];

  const activeConstraintRows =
    sens?.constraint_analysis
      ?.map((r, i) => (Math.abs(Number(r.slack_or_surplus ?? 1)) < 1e-6 ? i : -1))
      .filter((i) => i >= 0) ?? [];

  const multipleOptima = result.warnings?.some((w) =>
    w.toLowerCase().includes("óptimos múltiples"),
  );
  const optimalVertices =
    result.tables
      ?.find((t) => t.name === "vertices_feasible")
      ?.rows.filter((row) => {
        const optCol = row[row.length - 1];
        return String(optCol).toLowerCase() in { sí: 1, si: 1, yes: 1, "1": 1 };
      }) ?? [];

  return (
    <div>
      {result.warnings?.length > 0 && (
        <ul className="warn-list">
          {result.warnings.map((w) => (
            <li key={w}>{translateWarning(w)}</li>
          ))}
        </ul>
      )}
      {varRows.length > 0 ? (
        <SolutionTable
          caption="Variables"
          columns={["Variable", "Valor", "Coef. objetivo", "Costo reducido"]}
          rows={varRows}
          textColumns={[0]}
        />
      ) : (
        <p className="field-hint">No hay variables en este resultado.</p>
      )}
      {constraintSummary.length > 0 && (
        <SolutionTable
          caption="Restricciones en el óptimo"
          columns={labelColumns([
            "constraint_id",
            "lhs",
            "sense",
            "rhs",
            "slack_or_surplus",
            "shadow_price",
          ])}
          rows={constraintSummary as (string | number)[][]}
          textColumns={[0]}
          activeRowIndexes={activeConstraintRows}
        />
      )}
      {multipleOptima && optimalVertices.length > 1 && (
        <SolutionTable
          caption="Vértices óptimos alternativos"
          columns={
            result.tables?.find((t) => t.name === "vertices_feasible")?.columns.slice(0, 3) ?? [
              "x",
              "y",
              "Z",
            ]
          }
          rows={optimalVertices.map((row) => row.slice(0, 3)) as (string | number)[][]}
        />
      )}
      {result.tables
        ?.filter((t) => t.name === "vertices_feasible")
        .map((t) => (
          <SolutionTable
            key={t.name}
            caption={tableName(t.name)}
            columns={labelColumns(t.columns)}
            rows={labelTableRows(t.rows) as (string | number | boolean | null)[][]}
            textColumns={[3, 4]}
          />
        ))}
      <Explainer result={result} />
    </div>
  );
}

function GenericSolutionPane({ result }: Props) {
  return (
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
      {result.tables
        ?.filter((t) => t.name === "vertices_feasible")
        .map((t) => (
          <SolutionTable
            key={t.name}
            caption={tableName(t.name)}
            columns={labelColumns(t.columns)}
            rows={labelTableRows(t.rows) as (string | number | boolean | null)[][]}
            textColumns={[3, 4]}
          />
        ))}
      <Explainer result={result} />
    </div>
  );
}

export default function ResultsTabs({ result }: Props) {
  const panes = useMemo(() => {
    const isLp = result.module === "linear_programming";
    const list: { id: string; label: string; content: ReactNode }[] = [
      {
        id: "solution",
        label: "Solución",
        content: isLp ? <LpSolutionPane result={result} /> : <GenericSolutionPane result={result} />,
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
