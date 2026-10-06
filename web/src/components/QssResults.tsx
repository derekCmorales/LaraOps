import type { ModuleResult } from "../api/client";
import { fmtNum, fmtPct } from "../lib/qssForm";
import ChartViews from "./ChartViews";
import SolutionTable from "./SolutionTable";

type Props = { result: ModuleResult };

function dato(result: ModuleResult, key: string): unknown {
  const table = result.tables?.find((item) => item.name === "datos");
  return table?.rows.find((row) => row[0] === key)?.[1];
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default function QssResults({ result }: Props) {
  const m = result.solution.metrics;
  const lambda = asNumber(dato(result, "λ"));
  const mu = asNumber(dato(result, "μ"));
  const servers = asNumber(dato(result, "servidores"));
  const capacity = dato(result, "capacidad");
  const lambdaEff = m.lambda_eff;
  const product = lambdaEff != null && m.W != null ? lambdaEff * m.W : null;
  const gap =
    product != null && m.L != null ? Math.abs(m.L - product) / Math.max(Math.abs(product), 1e-9) : null;
  const resumen = result.tables?.find((item) => item.name === "resumen");

  return (
    <div>
      {result.warnings?.length ? (
        <ul className="warn-list">
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <p className="eoq-policy">
        {lambda != null && mu != null ? (
          <>
            Con λ = {fmtNum(lambda)} y μ = {fmtNum(mu)}
            {servers != null ? <> y {fmtNum(servers, 0)} {servers === 1 ? "servidor" : "servidores"}</> : null}
            {capacity != null && capacity !== "ilimitada" ? <> (cupo {String(capacity)})</> : null}, </>
        ) : null}
        se atendieron <strong>{fmtNum(m.served, 0)}</strong> clientes
        {m.rejected ? (
          <>
            {" "}
            y se rechazaron <strong>{fmtNum(m.rejected, 0)}</strong>
          </>
        ) : (
          " y no se rechazó ninguno"
        )}
        . En promedio hay <strong>{fmtNum(m.L, 2)}</strong> clientes en el sistema (<strong>{fmtNum(m.Lq, 2)}</strong> en
        la fila). Cada cliente espera <strong>{fmtNum(m.Wq, 3)}</strong> unidades de tiempo en la fila y pasa{" "}
        <strong>{fmtNum(m.W, 3)}</strong> en el sistema. La utilización es <strong>{fmtPct(m.utilization)}</strong>.
      </p>

      <div className="pert-kpis">
        <article className="pert-kpi eoq-kpi-main">
          <span>Clientes en el sistema (L)</span>
          <strong>{fmtNum(m.L, 3)}</strong>
          <small>fila + servicio</small>
        </article>
        <article className="pert-kpi">
          <span>Clientes en la fila (Lq)</span>
          <strong>{fmtNum(m.Lq, 3)}</strong>
          <small>en promedio</small>
        </article>
        <article className="pert-kpi">
          <span>Tiempo en el sistema (W)</span>
          <strong>{fmtNum(m.W, 3)}</strong>
          <small>unidades de tiempo</small>
        </article>
        <article className="pert-kpi">
          <span>Espera en la fila (Wq)</span>
          <strong>{fmtNum(m.Wq, 3)}</strong>
          <small>unidades de tiempo</small>
        </article>
        <article className="pert-kpi">
          <span>Utilización</span>
          <strong>{fmtPct(m.utilization)}</strong>
          <small>fracción del tiempo ocupado</small>
        </article>
        <article className="pert-kpi">
          <span>Atendidos / rechazados</span>
          <strong>
            {fmtNum(m.served, 0)} / {fmtNum(m.rejected, 0)}
          </strong>
        </article>
      </div>

      {product != null && gap != null ? (
        <p className="field-hint">
          La ley de Little dice que L debería parecerse a λ efectiva × W. Aquí λ efectiva = atendidos / tiempo medido ={" "}
          {fmtNum(lambdaEff, 3)}, así que λ efectiva × W = {fmtNum(product, 3)} y L = {fmtNum(m.L, 3)}.{" "}
          {gap < 0.15
            ? "En esta corrida cuadran de forma aproximada."
            : "La diferencia es grande: suele pasar si el tiempo es corto, el sistema no es estable o varios clientes siguen en servicio al cortar el reloj."}
        </p>
      ) : null}

      <h3 className="section-label">Evolución de la fila</h3>
      <ChartViews result={result} />

      {resumen ? (
        <SolutionTable
          caption="Resumen"
          columns={resumen.columns}
          rows={resumen.rows.map((row) => row.map((cell) => (typeof cell === "number" || typeof cell === "string" ? cell : String(cell ?? ""))))}
          textColumns={[0]}
        />
      ) : null}
    </div>
  );
}
