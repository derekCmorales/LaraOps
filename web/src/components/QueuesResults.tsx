import { Fragment, useId, type ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ModuleResult } from "../api/client";
import {
  fmtNum,
  fmtPct,
  hasCapacity,
  hasPopulation,
  humanTime,
  isMultiServer,
  modelInfo,
  unitFromLabel,
  unitInfo,
  type QueueModel,
  type TimeUnit,
} from "../lib/queuesForm";
import { translateWarning } from "../lib/resultLabels";
import Explainer from "./Explainer";
import SolutionTable from "./SolutionTable";

type Props = { result: ModuleResult };

const C = {
  ink: "#0A1628",
  basic: "#0A6B9A",
  pivot: "#C4166B",
  warn: "#945800",
  grid: "#C8D4E4",
  muted: "#5A6F87",
};

type Table = NonNullable<ModuleResult["tables"]>[number];

function findTable(result: ModuleResult, name: string): Table | undefined {
  return result.tables?.find((t) => t.name === name);
}

export type QueueContext = {
  model: QueueModel;
  lambda: number;
  mu: number;
  s: number;
  K: number | null;
  N: number | null;
  /** Unidad de tiempo conocida, o null si el cuerpo no la trajo. */
  unit: TimeUnit | null;
  unitLabel: string;
  unitShort: string;
  costBasis: "system" | "queue";
};

/** Lee los datos del problema que el API devuelve en la tabla «datos». */
export function queueContext(result: ModuleResult): QueueContext {
  const rows = findTable(result, "datos")?.rows ?? [];
  const get = (key: string): unknown => rows.find((r) => r[2] === key)?.[1];
  const unit = unitFromLabel(get("time_unit"));
  const info = unit ? unitInfo(unit) : null;
  const num = (key: string) => {
    const v = get(key);
    return typeof v === "number" ? v : null;
  };
  return {
    model: (get("model") as QueueModel) ?? "M/M/1",
    lambda: num("lambda") ?? 0,
    mu: num("mu") ?? 0,
    s: num("s") ?? 1,
    K: num("K"),
    N: num("N"),
    unit,
    unitLabel: info?.label ?? "unidad de tiempo",
    unitShort: info?.short ?? "u.t.",
    costBasis: String(get("waiting_cost_basis") ?? "").startsWith("Lq") ? "queue" : "system",
  };
}

function finite(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function TimeValue({ value, ctx }: { value: number | undefined; ctx: QueueContext }) {
  if (!ctx.unit) {
    return (
      <>
        <strong>{fmtNum(value)}</strong>
        <small>{ctx.unitLabel}</small>
      </>
    );
  }
  const t = humanTime(value, ctx.unit);
  return (
    <>
      <strong>{fmtNum(value)}</strong>
      <small>
        {unitInfo(ctx.unit).plural}
        {t.alt ? ` · ${t.alt}` : ""}
      </small>
    </>
  );
}

function timeText(value: number | undefined, ctx: QueueContext): string {
  if (!ctx.unit) return `${fmtNum(value)} ${ctx.unitLabel}`;
  const t = humanTime(value, ctx.unit);
  return t.alt ? `${t.main} (${t.alt})` : t.main;
}

function Kpi({ label, children, main, warn }: { label: string; children: ReactNode; main?: boolean; warn?: boolean }) {
  const cls = ["pert-kpi", main ? "eoq-kpi-main" : "", warn ? "is-warn" : ""].filter(Boolean).join(" ");
  return (
    <article className={cls}>
      <span>{label}</span>
      {children}
    </article>
  );
}

function Warnings({ result }: Props) {
  if (!result.warnings?.length) return null;
  return (
    <ul className="warn-list">
      {result.warnings.map((w) => (
        <li key={w}>{translateWarning(w)}</li>
      ))}
    </ul>
  );
}

function UnstableCallout({ result, ctx }: { result: ModuleResult; ctx: QueueContext }) {
  const m = result.solution.metrics;
  const multi = isMultiServer(ctx.model);
  const capacity = ctx.s * ctx.mu;
  const neededMu = ctx.lambda / ctx.s;
  const serviceTime = ctx.unit ? humanTime(1 / neededMu, ctx.unit) : null;
  const serviceText = serviceTime ? (serviceTime.alt ?? serviceTime.main).replace("≈ ", "") : null;
  return (
    <div className="q-callout is-bad" role="status">
      <h3>El sistema es inestable</h3>
      <p>
        Llegan λ = {fmtNum(ctx.lambda)} clientes por {ctx.unitLabel} y, {multi ? "con todos los servidores ocupados" : "aun con el servidor siempre ocupado"}, solo se
        pueden atender {multi ? "s·μ" : "μ"} = {fmtNum(capacity)} por {ctx.unitLabel} (ρ = {fmtNum(m.rho)}). La fila
        crece sin límite, así que L, Lq, W y Wq no tienen un valor finito.
      </p>
      <p>Para que sea estable necesitas ρ &lt; 1. Algunas opciones:</p>
      <ul>
        <li>
          Atender más rápido: μ mayor que {fmtNum(neededMu)} clientes por {ctx.unitLabel}
          {multi ? " por servidor" : ""}
          {serviceText ? ` (atender a cada cliente en menos de ${serviceText})` : ""}.
        </li>
        {finite(m.s_min_stable) && (ctx.model === "M/M/1" || ctx.model === "M/M/s") ? (
          <li>
            {multi ? "Usar" : "Abrir más servidores (modelo M/M/s):"} al menos s = {fmtNum(m.s_min_stable, 0)}{" "}
            servidores.
          </li>
        ) : null}
        <li>
          Reducir las llegadas a menos de {fmtNum(capacity)} por {ctx.unitLabel}, o limitar el cupo (modelo con
          capacidad K) para que los que encuentran el sistema lleno se vayan.
        </li>
      </ul>
    </div>
  );
}

function Summary({ result, ctx }: { result: ModuleResult; ctx: QueueContext }) {
  const m = result.solution.metrics;
  const serving = m.busy_servers;
  const parts: ReactNode[] = [];
  parts.push(
    <Fragment key="l">
      En promedio hay <strong>{fmtNum(m.L, 2)}</strong> clientes en el sistema: <strong>{fmtNum(m.Lq, 2)}</strong>{" "}
      esperando en la fila y {fmtNum(serving, 2)} siendo atendidos.{" "}
    </Fragment>,
  );
  parts.push(
    <Fragment key="w">
      Cada cliente espera <strong>{timeText(m.Wq, ctx)}</strong> en la fila y pasa{" "}
      <strong>{timeText(m.W, ctx)}</strong> en total.{" "}
    </Fragment>,
  );
  parts.push(
    <Fragment key="rho">
      {ctx.s > 1 ? "Los servidores están ocupados" : "El servidor está ocupado"} el <strong>{fmtPct(m.rho)}</strong>{" "}
      del tiempo y el <strong>{fmtPct(m.Pw)}</strong> de los clientes {hasCapacity(ctx.model) ? "que entran " : ""}
      tiene que esperar.
    </Fragment>,
  );
  if (hasCapacity(ctx.model) && finite(m.P_block)) {
    parts.push(
      <Fragment key="k">
        {" "}
        El sistema está lleno el <strong>{fmtPct(m.P_block)}</strong> del tiempo, así que se pierden{" "}
        <strong>{fmtNum(m.lambda_lost, 3)}</strong> clientes por {ctx.unitLabel} y solo entran λeff ={" "}
        {fmtNum(m.lambda_eff, 3)}.
      </Fragment>,
    );
  }
  if (hasPopulation(ctx.model) && finite(m.customers_outside)) {
    parts.push(
      <Fragment key="n">
        {" "}
        De los {fmtNum(ctx.N, 0)} clientes de la población, en promedio <strong>{fmtNum(m.customers_outside, 2)}</strong>{" "}
        están fuera del sistema (operando) y llegan λeff = {fmtNum(m.lambda_eff, 3)} por {ctx.unitLabel}.
      </Fragment>,
    );
  }
  return <p className="eoq-policy q-summary">{parts}</p>;
}

function Bars({ result, ctx }: { result: ModuleResult; ctx: QueueContext }) {
  const m = result.solution.metrics;
  const service = 1 / ctx.mu;
  const W = m.W;
  const queueShare = finite(W) && W > 0 ? Math.max(0, Math.min(1, m.Wq / W)) : 0;
  const busyShare = Math.max(0, Math.min(1, m.busy_servers / ctx.s));
  return (
    <div className="q-bars">
      <figure className="q-bar-figure">
        <figcaption>¿En qué se va el tiempo de un cliente?</figcaption>
        <div className="q-stack" role="img" aria-label={`Fila ${fmtPct(queueShare)} y servicio ${fmtPct(1 - queueShare)} del tiempo total`}>
          <span className="q-stack-queue" style={{ width: `${queueShare * 100}%` }} />
          <span className="q-stack-service" style={{ width: `${(1 - queueShare) * 100}%` }} />
        </div>
        <p className="q-legend">
          <span className="q-legend-item">
            <span className="q-dot q-dot-queue" /> En la fila: {timeText(m.Wq, ctx)} ({fmtPct(queueShare, 0)})
          </span>
          <span className="q-legend-item">
            <span className="q-dot q-dot-service" /> En servicio (1/μ): {timeText(service, ctx)} ({fmtPct(1 - queueShare, 0)})
          </span>
        </p>
      </figure>
      <figure className="q-bar-figure">
        <figcaption>{ctx.s > 1 ? "¿Qué tan ocupados están los servidores?" : "¿Qué tan ocupado está el servidor?"}</figcaption>
        <div className="q-stack" role="img" aria-label={`${fmtNum(m.busy_servers, 2)} de ${ctx.s} servidores ocupados en promedio`}>
          <span className="q-stack-busy" style={{ width: `${busyShare * 100}%` }} />
          <span className="q-stack-idle" style={{ width: `${(1 - busyShare) * 100}%` }} />
        </div>
        <p className="q-legend">
          <span className="q-legend-item">
            <span className="q-dot q-dot-busy" /> Ocupado: {fmtNum(m.busy_servers, 2)} de {ctx.s} ({fmtPct(busyShare, 0)})
          </span>
          <span className="q-legend-item">
            <span className="q-dot q-dot-idle" /> Libre: {fmtNum(m.idle_servers, 2)}
          </span>
        </p>
      </figure>
    </div>
  );
}

function WaitProbabilities({ result, ctx }: { result: ModuleResult; ctx: QueueContext }) {
  const m = result.solution.metrics;
  if (!finite(m.t) || !finite(m.P_wq_gt_t)) return null;
  const natural = ctx.unit ? humanTime(m.t, ctx.unit) : null;
  const t = natural?.alt ? natural.alt.replace("≈ ", "") : timeText(m.t, ctx);
  return (
    <section className="q-block">
      <h3 className="section-label">Probabilidad de esperar más de {t}</h3>
      <div className="pert-kpis">
        <Kpi label={`Esperar en la fila más de t`}>
          <strong>{fmtPct(m.P_wq_gt_t)}</strong>
          <small>P(Wq &gt; {fmtNum(m.t)})</small>
        </Kpi>
        <Kpi label={`Pasar en el sistema más de t`}>
          <strong>{fmtPct(m.P_w_gt_t)}</strong>
          <small>P(W &gt; {fmtNum(m.t)}), incluye el servicio</small>
        </Kpi>
        <Kpi label="Esperar algo (Wq > 0)">
          <strong>{fmtPct(m.Pw)}</strong>
          <small>{fmtPct(1 - m.Pw)} pasa directo a servicio</small>
        </Kpi>
      </div>
    </section>
  );
}

function Costs({ result, ctx }: { result: ModuleResult; ctx: QueueContext }) {
  const m = result.solution.metrics;
  const costTable = findTable(result, "cost_by_s");
  if (!finite(m.cost_total) && !costTable) return null;
  const per = `por ${ctx.unitLabel}`;
  const base = ctx.costBasis === "queue" ? "Lq" : "L";
  const money = (v: number | undefined) =>
    finite(v) ? v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
  const best = finite(m.s_optimal) ? m.s_optimal : null;
  const savings = best != null && finite(m.cost_total) && finite(m.cost_total_optimal) ? m.cost_total - m.cost_total_optimal : null;
  const cols = costTable?.columns ?? [];
  const idx = (name: string) => cols.indexOf(name);
  return (
    <section className="q-block">
      <h3 className="section-label">Costos {per}</h3>
      {finite(m.cost_total) ? (
        <SolutionTable
          columns={["Concepto", "Fórmula", "Valor"]}
          rows={[
            ["Espera de clientes", `Cw · ${base}`, money(m.cost_waiting)],
            ["Servidores", "Cs · s", money(m.cost_server)],
            ["Costo total", `Cw·${base} + Cs·s`, money(m.cost_total)],
          ]}
          textColumns={[0, 1]}
        />
      ) : null}
      {best != null ? (
        <div className={best === ctx.s ? "q-callout is-ok" : "q-callout is-tip"}>
          <h3>
            Recomendación: {fmtNum(best, 0)} {best === 1 ? "servidor" : "servidores"}
          </h3>
          <p>
            Con s = {fmtNum(best, 0)} el costo total esperado es {money(m.cost_total_optimal)} {per}
            {best === ctx.s
              ? ", el más bajo de los valores comparados: tu número actual de servidores ya es el óptimo."
              : savings != null && savings > 0
                ? `. Hoy, con s = ${ctx.s}, cuesta ${money(m.cost_total)}: ahorrarías ${money(savings)} ${per} (${fmtPct(savings / m.cost_total)}).`
                : "."}
          </p>
        </div>
      ) : null}
      {costTable && ctx.model === "M/M/s" && Number(costTable.rows[0]?.[0]) > 1 ? (
        <p className="field-hint">
          Solo se comparan valores con s &gt; λ/μ = {fmtNum(ctx.lambda / ctx.mu, 3)}: con menos servidores la fila
          crecería sin límite.
        </p>
      ) : null}
      {costTable ? (
        <SolutionTable
          caption="Comparación por número de servidores"
          columns={["Servidores", "Lq", `Wq (${ctx.unitShort})`, "Utilización", "Costo espera", "Costo servidores", "Costo total"]}
          rows={costTable.rows.map((r) => [
            `${r[idx("servidores")]}${r[idx("óptimo")] ? " ★" : ""}${r[idx("servidores")] === ctx.s ? " (actual)" : ""}`,
            r[idx("Lq")] as number,
            r[idx("Wq")] as number,
            fmtPct(r[idx("rho")] as number),
            money(r[idx("costo_espera")] as number),
            money(r[idx("costo_servidor")] as number),
            money(r[idx("costo_total")] as number),
          ])}
          textColumns={[0]}
        />
      ) : null}
    </section>
  );
}

const ASSUMPTIONS: Record<QueueModel, string> = {
  "M/M/1": "Supuestos: llegadas de Poisson (tiempos entre llegadas exponenciales), servicio exponencial, un servidor, fila única sin límite, se atiende en orden de llegada y el sistema ya está en estado estable.",
  "M/M/s": "Supuestos: llegadas de Poisson, servicio exponencial igual en los s servidores, una sola fila sin límite que atiende al primero que llegó y estado estable.",
  "M/M/1/K": "Supuestos: llegadas de Poisson, servicio exponencial, un servidor y lugar para K clientes en total; quien llega con el sistema lleno se va y no regresa.",
  "M/M/s/K": "Supuestos: llegadas de Poisson, servicio exponencial, s servidores y lugar para K clientes en total (fila + servicio); quien llega con el sistema lleno se pierde.",
  "M/M/s/N": "Supuestos: población de N clientes; cada cliente que está fuera regresa con tasa λ (exponencial), servicio exponencial y s servidores.",
  "M/G/1": "Supuestos: llegadas de Poisson, un servidor y tiempos de servicio con cualquier distribución de media 1/μ y desviación σ (fórmula de Pollaczek-Khinchine).",
  "M/D/1": "Supuestos: llegadas de Poisson y servicio de duración constante 1/μ. La fila promedio es la mitad que en M/M/1 con la misma ρ.",
};

export default function QueuesResults({ result }: Props) {
  const ctx = queueContext(result);
  const m = result.solution.metrics;
  const stable = finite(m.L);
  const info = modelInfo(ctx.model);

  if (!stable) {
    return (
      <div className="q-results">
        <UnstableCallout result={result} ctx={ctx} />
        <div className="pert-kpis">
          <Kpi label="Utilización" warn>
            <strong>{fmtNum(m.rho, 4)}</strong>
            <small>ρ debe ser menor que 1</small>
          </Kpi>
          <Kpi label="Carga ofrecida">
            <strong>{fmtNum(m.r, 4)}</strong>
            <small>λ/μ: servidores que estarían ocupados todo el tiempo</small>
          </Kpi>
        </div>
        <Explainer result={result} />
      </div>
    );
  }

  return (
    <div className="q-results">
      <Warnings result={result} />
      <p className="q-model-line">
        Modelo <code>{info.kendall}</code> · {info.title.toLowerCase()}
        {ctx.s > 1 ? ` · s = ${ctx.s}` : ""}
        {ctx.K != null ? ` · K = ${ctx.K}` : ""}
        {ctx.N != null ? ` · N = ${ctx.N}` : ""} · λ = {fmtNum(ctx.lambda)} y μ = {fmtNum(ctx.mu)} por {ctx.unitLabel}
      </p>

      <div className="pert-kpis">
        <Kpi label="Espera en la fila (Wq)" main>
          <TimeValue value={m.Wq} ctx={ctx} />
        </Kpi>
        <Kpi label="Tiempo en el sistema (W)">
          <TimeValue value={m.W} ctx={ctx} />
        </Kpi>
        <Kpi label="Clientes en la fila (Lq)">
          <strong>{fmtNum(m.Lq)}</strong>
          <small>en promedio</small>
        </Kpi>
        <Kpi label="Clientes en el sistema (L)">
          <strong>{fmtNum(m.L)}</strong>
          <small>fila + servicio</small>
        </Kpi>
        <Kpi label="Utilización" warn={m.rho >= 0.9 && !hasCapacity(ctx.model) && !hasPopulation(ctx.model)}>
          <strong>{fmtPct(m.rho)}</strong>
          <small>ρ: tiempo ocupado de cada servidor</small>
        </Kpi>
        <Kpi label="Prob. de esperar (Pw)">
          <strong>{fmtPct(m.Pw)}</strong>
          <small>sistema vacío P0 = {fmtPct(m.P0)}</small>
        </Kpi>
        {hasCapacity(ctx.model) ? (
          <Kpi label="Sistema lleno (PK)" warn={m.P_block >= 0.05}>
            <strong>{fmtPct(m.P_block)}</strong>
            <small>
              se pierden {fmtNum(m.lambda_lost, 3)} clientes/{ctx.unitShort}
            </small>
          </Kpi>
        ) : null}
        {hasPopulation(ctx.model) ? (
          <Kpi label="Fuera del sistema (N − L)">
            <strong>{fmtNum(m.customers_outside)}</strong>
            <small>de {fmtNum(ctx.N, 0)} clientes, en promedio</small>
          </Kpi>
        ) : null}
        {finite(m.lambda_eff) ? (
          <Kpi label="Tasa efectiva de entrada">
            <strong>{fmtNum(m.lambda_eff)}</strong>
            <small>λeff: clientes que entran por {ctx.unitLabel}</small>
          </Kpi>
        ) : null}
      </div>

      <Summary result={result} ctx={ctx} />
      <Bars result={result} ctx={ctx} />
      <WaitProbabilities result={result} ctx={ctx} />
      <Costs result={result} ctx={ctx} />

      <p className="chart-footnote">{ASSUMPTIONS[ctx.model]}</p>
      <Explainer result={result} />
    </div>
  );
}

/* ——— Fórmulas ——— */

export function QueuesFormulas({ result }: Props) {
  const table = findTable(result, "formulas");
  const ctx = queueContext(result);
  const m = result.solution.metrics;
  if (!table) return <p className="field-hint">No hay fórmulas para este resultado.</p>;
  const lam = finite(m.lambda_eff) ? m.lambda_eff : ctx.lambda;
  // El API manda la unidad en singular («hora»); los tiempos se leen mejor en plural.
  const unitText = (u: string) => (ctx.unit && u === ctx.unitLabel ? unitInfo(ctx.unit).plural : u);
  const lamName = finite(m.lambda_eff) ? "λeff" : "λ";
  return (
    <div className="q-formulas">
      <p className="module-blurb">
        Cada medida con su fórmula de libro y los valores sustituidos. Los resultados están en clientes, en{" "}
        {ctx.unit ? unitInfo(ctx.unit).plural : "la unidad de tiempo de tus tasas"} o como probabilidad.
      </p>
      <div className="q-table-scroll">
        <table className="data-table q-formula-table">
          <thead>
            <tr>
              <th scope="col">Medida</th>
              <th scope="col" className="col-text">
                Fórmula
              </th>
              <th scope="col" className="col-text">
                Sustitución
              </th>
              <th scope="col">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                <td className="col-text" data-label="Medida">
                  {String(r[0])}
                </td>
                <td className="col-text q-math" data-label="Fórmula">
                  {String(r[1])}
                </td>
                <td className="col-text q-math" data-label="Sustitución">
                  {String(r[2])}
                </td>
                <td data-label="Resultado">
                  {typeof r[3] === "number" ? fmtNum(r[3]) : "—"}
                  {r[4] && typeof r[3] === "number" ? <span className="q-unit"> {unitText(String(r[4]))}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {finite(m.L) && finite(m.W) ? (
        <aside className="q-callout is-ok q-little">
          <h3>Comprobación: ley de Little</h3>
          <p className="q-math">
            {lamName} · W = {fmtNum(lam)} × {fmtNum(m.W)} = {fmtNum(lam * m.W)} = L ✓
          </p>
          <p className="q-math">
            {lamName} · Wq = {fmtNum(lam)} × {fmtNum(m.Wq)} = {fmtNum(lam * m.Wq)} = Lq ✓
          </p>
        </aside>
      ) : null}
      <dl className="q-glossary">
        <div>
          <dt>λ</dt>
          <dd>Tasa de llegada (clientes por unidad de tiempo).</dd>
        </div>
        <div>
          <dt>μ</dt>
          <dd>Tasa de servicio de un servidor; 1/μ es el tiempo promedio de servicio.</dd>
        </div>
        <div>
          <dt>s</dt>
          <dd>Número de servidores en paralelo.</dd>
        </div>
        <div>
          <dt>ρ</dt>
          <dd>Utilización: fracción del tiempo que cada servidor está ocupado.</dd>
        </div>
        <div>
          <dt>L, Lq</dt>
          <dd>Clientes promedio en el sistema y en la fila.</dd>
        </div>
        <div>
          <dt>W, Wq</dt>
          <dd>Tiempo promedio en el sistema y en la fila.</dd>
        </div>
        <div>
          <dt>Pn</dt>
          <dd>Probabilidad de que haya exactamente n clientes en el sistema.</dd>
        </div>
        <div>
          <dt>Pw</dt>
          <dd>Probabilidad de que un cliente que llega tenga que esperar.</dd>
        </div>
      </dl>
    </div>
  );
}

/* ——— Gráficos ——— */

function tick(n: number): string {
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return n.toLocaleString("es-MX", { maximumFractionDigits: digits });
}

function situation(n: number, ctx: QueueContext): string {
  if (n === 0) return "Sistema vacío";
  const capacity = ctx.K ?? ctx.N;
  const full = hasCapacity(ctx.model) && n === capacity ? " · lleno: el que llega se va" : "";
  if (n <= ctx.s) {
    const free = ctx.s - n;
    return `${n} en servicio${free ? `, ${free} ${free === 1 ? "servidor libre" : "servidores libres"}` : ""}${full}`;
  }
  return `${ctx.s} en servicio, ${n - ctx.s} en la fila${full}`;
}

function PnChart({ result, ctx }: { result: ModuleResult; ctx: QueueContext }) {
  const table = findTable(result, "Pn");
  const tableId = useId();
  if (!table) return null;
  const K = hasCapacity(ctx.model) ? ctx.K : null;
  const data = table.rows.map((r) => ({ n: r[0] as number, pn: r[1] as number, cum: r[2] as number }));
  const color = (n: number) => (K != null && n === K ? C.warn : n > ctx.s ? C.pivot : C.basic);
  return (
    <figure className="chart-frame">
      <figcaption>
        <h3 className="chart-title">¿Cuántos clientes hay en el sistema?</h3>
        <p className="chart-subtitle">
          Barras: probabilidad Pn de encontrar exactamente n clientes. Línea: probabilidad acumulada de que haya n o
          menos.
        </p>
      </figcaption>
      <div className="chart-wrap" role="img" aria-label={`Distribución Pn de n = 0 a n = ${data.length - 1}`}>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 28 }}>
            <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="n"
              tick={{ fontSize: 11, fill: C.muted }}
              label={{ value: "n (clientes en el sistema)", position: "insideBottom", offset: -16, fill: C.ink, fontSize: 12 }}
            />
            <YAxis yAxisId="p" tickFormatter={tick} tick={{ fontSize: 11, fill: C.muted }} width={48} />
            <YAxis
              yAxisId="c"
              orientation="right"
              domain={[0, 1]}
              tickFormatter={(v: number) => `${Math.round(v * 100)} %`}
              tick={{ fontSize: 11, fill: C.muted }}
              width={52}
            />
            <Tooltip
              contentStyle={{ border: `1px solid ${C.grid}`, borderRadius: 4, fontSize: 12 }}
              formatter={(value: number, name: string) => [fmtNum(value), name]}
              labelFormatter={(n) => `n = ${n}: ${situation(Number(n), ctx)}`}
            />
            <Bar yAxisId="p" dataKey="pn" name="Pn" isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.n} fill={color(d.n)} />
              ))}
            </Bar>
            <Line
              yAxisId="c"
              type="monotone"
              dataKey="cum"
              name="Acumulada P(N ≤ n)"
              stroke={C.ink}
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="q-legend">
        <span className="q-legend-item">
          <span className="q-dot" style={{ background: C.basic }} /> Sin fila (n ≤ s = {ctx.s})
        </span>
        <span className="q-legend-item">
          <span className="q-dot" style={{ background: C.pivot }} /> Con fila (n &gt; s)
        </span>
        {K != null ? (
          <span className="q-legend-item">
            <span className="q-dot" style={{ background: C.warn }} /> Lleno (n = K = {K})
          </span>
        ) : null}
        <span className="q-legend-item">
          <span className="q-dot q-dot-line" /> Acumulada
        </span>
      </p>
      <details className="q-details">
        <summary aria-controls={tableId}>Ver tabla Pn ({data.length} filas)</summary>
        <div id={tableId} className="q-table-scroll">
          <SolutionTable
            columns={["n", "Pn", "P(N ≤ n)", "Situación"]}
            rows={data.map((d) => [d.n, d.pn, d.cum, situation(d.n, ctx)])}
            textColumns={[3]}
          />
        </div>
      </details>
    </figure>
  );
}

function CongestionChart({ result, ctx }: { result: ModuleResult; ctx: QueueContext }) {
  const table = findTable(result, "curva_congestion");
  if (!table) return null;
  const data = table.rows.map((r) => ({ lambda: r[0] as number, rho: r[1] as number, W: r[4] as number, Wq: r[5] as number, L: r[2] as number }));
  const capacity = ctx.s * ctx.mu;
  const showCapacity = !hasCapacity(ctx.model) && !hasPopulation(ctx.model);
  const xMax = showCapacity ? capacity : Math.max(...data.map((d) => d.lambda));
  return (
    <figure className="chart-frame">
      <figcaption>
        <h3 className="chart-title">¿Qué pasa si llegan más clientes?</h3>
        <p className="chart-subtitle">
          Tiempo promedio según la tasa de llegada λ, con el mismo servicio y {ctx.s === 1 ? "servidor" : `${ctx.s} servidores`}.
          {showCapacity
            ? ` Al acercarse a la capacidad s·μ = ${fmtNum(capacity)} por ${ctx.unitLabel} la espera se dispara.`
            : " Con cupo o población limitada la espera se estabiliza porque entran menos clientes."}
        </p>
      </figcaption>
      <div className="chart-wrap" role="img" aria-label="Curva de congestión: W y Wq contra λ">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data} margin={{ top: 12, right: 24, left: 0, bottom: 28 }}>
            <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="lambda"
              type="number"
              domain={[0, xMax]}
              tickFormatter={tick}
              tick={{ fontSize: 11, fill: C.muted }}
              label={{ value: `λ (clientes por ${ctx.unitLabel})`, position: "insideBottom", offset: -16, fill: C.ink, fontSize: 12 }}
            />
            <YAxis
              tickFormatter={tick}
              tick={{ fontSize: 11, fill: C.muted }}
              width={56}
              label={{ value: ctx.unit ? unitInfo(ctx.unit).plural : "tiempo", angle: -90, position: "insideLeft", fill: C.ink, fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{ border: `1px solid ${C.grid}`, borderRadius: 4, fontSize: 12 }}
              formatter={(value: number, name: string) => [fmtNum(value), name]}
              labelFormatter={(l) => {
                const d = data.find((x) => x.lambda === Number(l));
                return `λ = ${fmtNum(Number(l))}${d ? ` · ρ = ${fmtNum(d.rho, 3)} · L = ${fmtNum(d.L, 2)}` : ""}`;
              }}
            />
            <Legend verticalAlign="top" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
            {ctx.lambda <= xMax ? (
              <ReferenceLine
                x={ctx.lambda}
                stroke={C.pivot}
                strokeDasharray="4 4"
                label={{ value: "Hoy", position: "top", fill: C.pivot, fontSize: 11 }}
              />
            ) : null}
            <Line type="monotone" dataKey="W" name="W (en el sistema)" stroke={C.ink} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="Wq" name="Wq (en la fila)" stroke={C.basic} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

function CostChart({ result, ctx }: { result: ModuleResult; ctx: QueueContext }) {
  const table = findTable(result, "cost_by_s");
  if (!table) return null;
  const cols = table.columns;
  const at = (r: unknown[], name: string) => r[cols.indexOf(name)] as number;
  const data = table.rows.map((r) => ({
    s: at(r, "servidores"),
    espera: at(r, "costo_espera"),
    servidores: at(r, "costo_servidor"),
    total: at(r, "costo_total"),
  }));
  const best = result.solution.metrics.s_optimal;
  return (
    <figure className="chart-frame">
      <figcaption>
        <h3 className="chart-title">Costo total según el número de servidores</h3>
        <p className="chart-subtitle">
          Más servidores cuestan más, pero reducen el costo de espera. El óptimo está donde la suma es mínima.
        </p>
      </figcaption>
      <div className="chart-wrap" role="img" aria-label={`Costo total por número de servidores; mínimo en s = ${best}`}>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 12, right: 24, left: 8, bottom: 28 }}>
            <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="s"
              tick={{ fontSize: 11, fill: C.muted }}
              label={{ value: "Servidores (s)", position: "insideBottom", offset: -16, fill: C.ink, fontSize: 12 }}
            />
            <YAxis tickFormatter={tick} tick={{ fontSize: 11, fill: C.muted }} width={64} />
            <Tooltip
              contentStyle={{ border: `1px solid ${C.grid}`, borderRadius: 4, fontSize: 12 }}
              formatter={(value: number, name: string) => [fmtNum(value, 2), name]}
              labelFormatter={(s) => `s = ${s}`}
            />
            <Legend verticalAlign="top" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
            {finite(best) ? (
              <ReferenceLine x={best} stroke={C.pivot} strokeDasharray="4 4" label={{ value: "Óptimo", position: "top", fill: C.pivot, fontSize: 11 }} />
            ) : null}
            <Line type="monotone" dataKey="espera" name="Costo de espera" stroke={C.basic} strokeWidth={2} isAnimationActive={false} />
            <Line type="monotone" dataKey="servidores" name="Costo de servidores" stroke={C.warn} strokeWidth={2} isAnimationActive={false} />
            <Line type="monotone" dataKey="total" name="Costo total" stroke={C.ink} strokeWidth={2.5} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="chart-footnote">Costos {`por ${ctx.unitLabel}`}.</p>
    </figure>
  );
}

export function QueuesCharts({ result }: Props) {
  const ctx = queueContext(result);
  const hasPn = !!findTable(result, "Pn");
  return (
    <div className="pert-visuals">
      {hasPn ? (
        <PnChart result={result} ctx={ctx} />
      ) : (
        <p className="field-hint">
          {finite(result.solution.metrics.L)
            ? `En ${modelInfo(ctx.model).kendall} no hay una fórmula cerrada para Pn; solo se calculan los promedios.`
            : "El sistema es inestable: no existe una distribución Pn de estado estable."}
        </p>
      )}
      <CongestionChart result={result} ctx={ctx} />
      <CostChart result={result} ctx={ctx} />
    </div>
  );
}
