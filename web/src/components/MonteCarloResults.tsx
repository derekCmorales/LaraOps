import type { ModuleResult } from "../api/client";
import { fmtNum } from "../lib/monteCarloForm";
import ChartViews from "./ChartViews";
import SolutionTable from "./SolutionTable";

type Props = { result: ModuleResult };

function lookup(result: ModuleResult, key: string): unknown {
  const table = result.tables?.find((item) => item.name === "contexto");
  return table?.rows.find((row) => row[0] === key)?.[1];
}

function table(result: ModuleResult, name: string) {
  return result.tables?.find((item) => item.name === name);
}

function rowsOf(raw: unknown[][] | undefined): (string | number | null)[][] {
  if (!raw) return [];
  return raw.map((row) =>
    row.map((cell) => (typeof cell === "number" || typeof cell === "string" ? cell : cell == null ? null : String(cell))),
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="warn-list">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}

function Kpi({ label, value, note, main }: { label: string; value: string; note?: string; main?: boolean }) {
  return (
    <article className={main ? "pert-kpi eoq-kpi-main" : "pert-kpi"}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </article>
  );
}

export default function MonteCarloResults({ result }: Props) {
  const m = result.solution.metrics;
  const mode = String(lookup(result, "modo") ?? (m.ci95_low != null ? "monte_carlo" : m.variance != null ? "rng" : "variates"));
  const expression = lookup(result, "expresion");
  const histogram = table(result, "histogram");
  const sample = table(result, "muestra");
  const method = table(result, "metodo");
  const percentiles = table(result, "percentiles");

  return (
    <div>
      <Warnings warnings={result.warnings ?? []} />

      {mode === "monte_carlo" ? (
        <p className="eoq-policy">
          La media estimada es <strong>{fmtNum(m.mean)}</strong>
          {m.stderr != null ? <> (error estándar {fmtNum(m.stderr)})</> : null}. Con 95% de confianza la media está entre{" "}
          <strong>{fmtNum(m.ci95_low)}</strong> y <strong>{fmtNum(m.ci95_high)}</strong>.
        </p>
      ) : null}
      {mode === "rng" ? (
        <p className="eoq-policy">
          La media de la muestra es <strong>{fmtNum(m.mean)}</strong> (la teórica de U(0, 1) es 1/2) y la varianza muestral
          es <strong>{fmtNum(m.variance)}</strong> (la teórica es 1/12 ≈ {fmtNum(1 / 12)}).
        </p>
      ) : null}
      {mode === "variates" ? (
        <p className="eoq-policy">
          La media muestral es <strong>{fmtNum(m.mean)}</strong>
          {m.theoretical_mean != null ? (
            <>
              {" "}
              y la teórica es <strong>{fmtNum(m.theoretical_mean)}</strong>
            </>
          ) : null}
          . La desviación estándar muestral es <strong>{fmtNum(m.std)}</strong>
          {m.theoretical_variance != null ? <> (varianza teórica {fmtNum(m.theoretical_variance)})</> : null}.
        </p>
      ) : null}
      {mode === "monte_carlo" && typeof expression === "string" ? (
        <p className="field-hint">Fórmula: {expression}</p>
      ) : null}

      <div className="pert-kpis">
        <Kpi label="Media" value={fmtNum(m.mean)} main />
        {mode === "monte_carlo" ? (
          <>
            <Kpi label="Desviación estándar" value={fmtNum(m.std)} note="s, divide entre n−1" />
            <Kpi label="Percentil 5" value={fmtNum(m.p05)} />
            <Kpi label="Mediana" value={fmtNum(m.p50)} />
            <Kpi label="Percentil 95" value={fmtNum(m.p95)} />
          </>
        ) : null}
        {mode === "rng" ? (
          <>
            <Kpi label="Varianza muestral" value={fmtNum(m.variance)} note="teórica 1/12" />
            <Kpi label="Mínimo" value={fmtNum(m.min)} />
            <Kpi label="Máximo" value={fmtNum(m.max)} />
          </>
        ) : null}
        {mode === "variates" ? (
          <>
            <Kpi label="Desviación estándar" value={fmtNum(m.std)} />
            <Kpi label="Media teórica" value={fmtNum(m.theoretical_mean)} />
            <Kpi label="Varianza teórica" value={fmtNum(m.theoretical_variance)} />
          </>
        ) : null}
      </div>

      {percentiles ? (
        <SolutionTable
          caption="Percentiles"
          columns={percentiles.columns}
          rows={rowsOf(percentiles.rows)}
          textColumns={[]}
        />
      ) : null}

      <h3 className="section-label">Histograma</h3>
      <ChartViews result={result} />
      {histogram ? (
        <SolutionTable
          caption="Intervalos del histograma"
          columns={histogram.columns}
          rows={rowsOf(histogram.rows)}
          textColumns={[]}
        />
      ) : null}

      {sample ? (
        <SolutionTable caption="Muestra" columns={sample.columns} rows={rowsOf(sample.rows)} textColumns={[0]} />
      ) : null}
      {method ? (
        <SolutionTable
          caption="Cómo se generó"
          columns={method.columns}
          rows={rowsOf(method.rows)}
          textColumns={method.columns.map((_, index) => index)}
        />
      ) : null}
    </div>
  );
}
