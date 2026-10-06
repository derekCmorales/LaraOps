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
import PertResults from "./PertResults";
import EoqResults, { EoqInventoryChart } from "./EoqResults";
import AssignmentResults, { AssignmentDiagram, HungarianSteps } from "./AssignmentResults";
import QueuesResults, { QueuesCharts, QueuesFormulas } from "./QueuesResults";
import TransportIterations from "./TransportIterations";
import TransportResults, { TransportFlowMap, TransportSensitivity } from "./TransportResults";
import Explainer from "./Explainer";
import IterationsViewer, { type IterationStepView } from "./IterationsViewer";
import SolutionTable from "./SolutionTable";
import StatusBand from "./StatusBand";
import JsonTable from "./JsonTable";
import { HundredPercentRule, LpAlgebraicPane, LpDualPane, LpIterations, LpSolutionPane } from "./LpResults";

type Props = { result: ModuleResult };

/** En colas no hay "óptimo": el estado relevante es si el sistema es estable. */
function queuesStatus(result: ModuleResult): string {
  const L = result.solution.metrics.L;
  return typeof L === "number" && Number.isFinite(L) ? "Sistema estable" : "Sistema inestable";
}

function vertexTextColumns(columns: string[]): number[] {
  const idx = columns
    .map((column, index) => (column === "origen" || column === "optimo" ? index : -1))
    .filter((index) => index >= 0);
  return idx.length ? idx : [3, 4];
}

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

function metricsCopyVariables(result: ModuleResult): boolean {
  const vars = result.solution.variables;
  const metrics = result.solution.metrics;
  const varKeys = Object.keys(vars);
  const metricKeys = Object.keys(metrics);
  if (!varKeys.length || varKeys.length !== metricKeys.length) return false;
  return metricKeys.every((k) => vars[k] === metrics[k]);
}

const NETWORK_TABLES = new Set([
  "ruta",
  "distancias",
  "aristas_mst",
  "flows",
  "balance_nodos",
  "oferta_sin_enviar",
  "min_cut",
  "recorrido",
]);

function nodeTextColumns(columns: string[]): number[] {
  return columns
    .map((column, index) => (/^(origen|destino|nodo|tipo|llega_desde|ruta_desde_origen)$/i.test(column) ? index : -1))
    .filter((index) => index >= 0);
}

function GenericSolutionPane({ result }: Props) {
  const mirrored = metricsCopyVariables(result);
  const showVariables = Object.keys(result.solution.variables).length > 0 && !mirrored;
  return (
    <div>
      {result.warnings?.length > 0 && (
        <ul className="warn-list">
          {result.warnings.map((w) => (
            <li key={w}>{translateWarning(w)}</li>
          ))}
        </ul>
      )}
      {showVariables ? (
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
      {showVariables &&
        Object.keys(result.solution.metrics).length > 0 && (
          <SolutionTable
            caption="Métricas"
            columns={["Métrica", "Valor"]}
            rows={labeledEntries(result.solution.metrics as Record<string, unknown>)}
            textColumns={[0]}
          />
        )}
      {result.module === "networks" &&
        result.tables
          ?.filter((t) => NETWORK_TABLES.has(t.name))
          .map((t) => (
            <SolutionTable
              key={t.name}
              caption={tableName(t.name)}
              columns={labelColumns(t.columns)}
              rows={labelTableRows(t.rows) as (string | number | boolean | null)[][]}
              textColumns={nodeTextColumns(t.columns)}
            />
          ))}
      {result.tables
        ?.filter((t) => t.name === "vertices_feasible")
        .map((t) => (
          <SolutionTable
            key={t.name}
            caption={tableName(t.name)}
            columns={labelColumns(t.columns)}
            rows={labelTableRows(t.rows) as (string | number | boolean | null)[][]}
            textColumns={vertexTextColumns(t.columns)}
          />
        ))}
      <Explainer result={result} />
    </div>
  );
}

export default function ResultsTabs({ result }: Props) {
  const panes = useMemo(() => {
    const isLp = result.module === "linear_programming";
    const isTransport = result.module === "transport";
    const isQueues = result.module === "queues";
    const list: { id: string; label: string; content: ReactNode }[] = [
      {
        id: "solution",
        label: "Solución",
        content:
          result.module === "pert_cpm" ? (
            <PertResults result={result} />
          ) : result.module === "eoq" ? (
            <EoqResults result={result} />
          ) : result.module === "assignment" ? (
            <AssignmentResults result={result} />
          ) : isTransport ? (
            <TransportResults result={result} />
          ) : isQueues ? (
            <QueuesResults result={result} />
          ) : isLp ? (
            <LpSolutionPane result={result} />
          ) : (
            <GenericSolutionPane result={result} />
          ),
      },
    ];
    if (result.iterations?.length) {
      const steps = result.iterations as IterationStepView[];
      list.push({
        id: "iterations",
        label: "Iteraciones",
        content:
          result.module === "assignment" ? (
            <HungarianSteps result={result} />
          ) : isLp ? (
            <LpIterations result={result} />
          ) : isTransport ? (
            <TransportIterations result={result} />
          ) : (
            <IterationsViewer steps={steps} />
          ),
      });
    }
    if (result.sensitivity) {
      list.push({
        id: "sensitivity",
        label: "Sensibilidad",
        content: isTransport ? (
          <TransportSensitivity result={result} />
        ) : isLp ? (
          <div>
            <SensitivityPane result={result} />
            <HundredPercentRule result={result} />
          </div>
        ) : (
          <SensitivityPane result={result} />
        ),
      });
    }
    if (isLp && result.tables?.some((t) => t.name === "dual_modelo")) {
      list.push({ id: "dual", label: "Dual", content: <LpDualPane result={result} /> });
    }
    if (isLp && result.tables?.some((t) => t.name === "soluciones_basicas")) {
      list.push({ id: "algebraic", label: "Método algebraico", content: <LpAlgebraicPane result={result} /> });
    }
    if (isQueues) {
      list.push({ id: "formulas", label: "Fórmulas", content: <QueuesFormulas result={result} /> });
      list.push({ id: "graph", label: "Gráficos", content: <QueuesCharts result={result} /> });
    } else if (result.graph) {
      list.push({
        id: "graph",
        label: result.module === "eoq" ? "Gráficos" : "Gráfico",
        content:
          result.module === "eoq" ? (
            <div className="pert-visuals">
              <ChartViews result={result} />
              <EoqInventoryChart result={result} />
            </div>
          ) : result.module === "assignment" ? (
            <AssignmentDiagram result={result} />
          ) : isTransport ? (
            <div className="pert-visuals">
              <TransportFlowMap result={result} />
              <ChartViews result={result} />
            </div>
          ) : (
            <ChartViews result={result} />
          ),
      });
    }
    // Transporte, PL y colas ya muestran sus tablas en sus propias vistas; no se repiten.
    if (result.tables?.length && !isTransport && !isLp && !isQueues) {
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
        statusText={result.module === "queues" ? queuesStatus(result) : undefined}
        objectiveValue={result.solution.objective_value}
        objectiveSense={result.solution.objective_sense}
        warnings={result.warnings}
        valueLabel={
          result.module === "pert_cpm"
            ? "Duración"
            : result.module === "assignment"
              ? result.solution.objective_sense === "max"
                ? "Ganancia total"
                : "Costo total"
              : result.module === "transport"
                ? result.solution.objective_sense === "max"
                  ? "Ganancia total"
                  : "Costo total"
                : "Z"
        }
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
