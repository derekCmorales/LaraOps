import type { ModuleResult } from "../api/client";
import Explainer from "./Explainer";
import SolutionTable from "./SolutionTable";
import { labelColumns, translateWarning } from "../lib/resultLabels";

function fmt(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

function percent(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-MX", { style: "percent", maximumFractionDigits: 1 });
}

export default function PertResults({ result }: { result: ModuleResult }) {
  const metrics = result.solution.metrics;
  const pathTable = result.tables?.find((table) => table.name === "critical_path");
  const schedule = result.tables?.find((table) => table.name === "schedule");
  const crashTable = result.tables?.find((table) => table.name === "durations_after_crash");
  const costTable = result.tables?.find((table) => table.name === "costos_aceleracion");
  const curveTable = result.tables?.find((table) => table.name === "curva_tiempo_costo");
  const path = pathTable?.rows.map((row) => String(row[1])).filter(Boolean) ?? [];
  const missed =
    result.status === "infeasible" ||
    (metrics.crash_target != null && metrics.project_duration > metrics.crash_target + 1e-6);

  return (
    <div className="pert-results">
      {result.warnings?.length > 0 && (
        <ul className="warn-list">
          {result.warnings.map((warning) => (
            <li key={warning}>{translateWarning(warning)}</li>
          ))}
        </ul>
      )}

      <div className="pert-kpis">
        <article className={missed ? "pert-kpi is-warn" : "pert-kpi"}>
          <span>Duración del proyecto</span>
          <strong>{fmt(metrics.project_duration)}</strong>
        </article>
        <article className="pert-kpi pert-kpi-wide">
          <span>Ruta crítica</span>
          {path.length ? (
            <ol className="pert-path">
              {path.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ol>
          ) : (
            <strong>—</strong>
          )}
        </article>
        {metrics.critical_path_count != null && metrics.critical_path_count > 1 && (
          <article className="pert-kpi">
            <span>Rutas críticas</span>
            <strong>{fmt(metrics.critical_path_count)}</strong>
          </article>
        )}
        {metrics.project_std != null && (
          <article className="pert-kpi">
            <span>Desviación estándar</span>
            <strong>{fmt(metrics.project_std)}</strong>
          </article>
        )}
        {metrics.prob_meet_target != null && (
          <article className="pert-kpi">
            <span>Probabilidad de cumplir</span>
            <strong>{percent(metrics.prob_meet_target)}</strong>
          </article>
        )}
        {metrics.duration_for_probability != null && (
          <article className="pert-kpi">
            <span>Duración para la probabilidad</span>
            <strong>{fmt(metrics.duration_for_probability)}</strong>
          </article>
        )}
        {metrics.crash_total_cost != null && (
          <article className="pert-kpi">
            <span>Costo extra</span>
            <strong>{fmt(metrics.crash_total_cost)}</strong>
          </article>
        )}
        {metrics.project_cost != null && (
          <article className="pert-kpi">
            <span>Costo del proyecto</span>
            <strong>{fmt(metrics.project_cost)}</strong>
          </article>
        )}
      </div>

      {schedule && (
        <SolutionTable
          caption="Cronograma"
          columns={labelColumns(schedule.columns)}
          rows={schedule.rows as (string | number | boolean | null)[][]}
          textColumns={[0]}
        />
      )}
      {costTable && (
        <SolutionTable
          caption="Costos y tiempos normales e intensivos"
          columns={labelColumns(costTable.columns)}
          rows={costTable.rows as (string | number | boolean | null)[][]}
          textColumns={[0]}
        />
      )}
      {curveTable && curveTable.rows.length > 1 && (
        <SolutionTable
          caption="Curva tiempo-costo: cada paso acelera el corte más barato de la ruta crítica"
          columns={labelColumns(curveTable.columns)}
          rows={curveTable.rows as (string | number | boolean | null)[][]}
          textColumns={[2]}
        />
      )}
      {crashTable && (
        <SolutionTable
          caption="Duraciones después de acelerar"
          columns={labelColumns(crashTable.columns)}
          rows={crashTable.rows as (string | number | boolean | null)[][]}
          textColumns={[0]}
        />
      )}
      <Explainer result={result} />
    </div>
  );
}
