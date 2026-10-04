import {
  CartesianGrid,
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

function fmt(value: number | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-MX", { maximumFractionDigits: digits });
}

function money(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cycleDays(m: Record<string, number>): number | undefined {
  if (m.time_between_orders_days != null) return m.time_between_orders_days;
  if (m.time_between_orders_years != null) return m.time_between_orders_years * 365;
  return undefined;
}

export default function EoqResults({ result }: Props) {
  const m = result.solution.metrics;
  const qStar = m.Q_star ?? result.solution.variables.Q;
  const days = cycleDays(m);
  const relevant = m.relevant_cost ?? (m.TC_ordering ?? 0) + (m.TC_holding ?? 0);
  const purchase = m.purchase_cost ?? Math.max(0, (m.TC ?? 0) - relevant);
  const rop = m.reorder_point;
  const rounded = Math.round(qStar);

  const breakdown: (string | number)[][] = [
    ["Ordenar", "N × S = (D / Q*) × S", m.TC_ordering],
    ["Mantener", "(Q* / 2) × H", m.TC_holding],
    ["Costo relevante", "ordenar + mantener", relevant],
  ];
  if (purchase > 0) breakdown.push(["Compra", "C × D", purchase]);
  breakdown.push(["Costo total anual", purchase > 0 ? "relevante + compra" : "relevante", m.TC]);

  return (
    <div className="eoq-results">
      {result.warnings?.length > 0 && (
        <ul className="warn-list">
          {result.warnings.map((w) => (
            <li key={w}>{translateWarning(w)}</li>
          ))}
        </ul>
      )}

      <div className="pert-kpis">
        <article className="pert-kpi eoq-kpi-main">
          <span>Cantidad por pedido (Q*)</span>
          <strong>{fmt(qStar)}</strong>
          {Math.abs(qStar - rounded) > 1e-9 ? <small>≈ {fmt(rounded, 0)} unidades en la práctica</small> : <small>unidades</small>}
        </article>
        <article className="pert-kpi">
          <span>Pedidos por año (N)</span>
          <strong>{fmt(m.orders_per_year)}</strong>
        </article>
        <article className="pert-kpi">
          <span>Tiempo entre pedidos (T)</span>
          <strong>{fmt(days, 1)}</strong>
          <small>días</small>
        </article>
        <article className="pert-kpi">
          <span>Costo total anual</span>
          <strong>{money(m.TC)}</strong>
          {purchase > 0 ? <small>incluye compra de {money(purchase)}</small> : null}
        </article>
        {rop != null ? (
          <article className="pert-kpi">
            <span>Punto de reorden (ROP)</span>
            <strong>{fmt(rop)}</strong>
            <small>unidades</small>
          </article>
        ) : null}
      </div>

      <p className="eoq-policy">
        <strong>Política:</strong> pide {fmt(qStar)} unidades cada {fmt(days, 1)} días ({fmt(m.orders_per_year)} veces
        al año)
        {rop != null
          ? `, y coloca el pedido cuando el inventario baje a ${fmt(rop)} unidades (tiempo de entrega de ${fmt(m.lead_time, 2)} días).`
          : ". Agrega el tiempo de entrega para saber cuándo pedir."}
      </p>

      <SolutionTable
        caption="Costos anuales en el óptimo"
        columns={["Concepto", "Fórmula", "Valor"]}
        rows={breakdown.map(([a, b, v]) => [a, b, typeof v === "number" ? Number(v.toFixed(4)) : v])}
        textColumns={[0, 1]}
      />

      <SolutionTable
        caption="Inventario"
        columns={["Indicador", "Valor"]}
        rows={[
          ["Inventario máximo (Q*)", qStar],
          ["Inventario promedio (Q* / 2)", m.avg_inventory ?? qStar / 2],
          ...(m.daily_demand != null ? [["Demanda diaria (d)", m.daily_demand] as (string | number)[]] : []),
          ...(rop != null ? [["Punto de reorden (d × L)", rop] as (string | number)[]] : []),
        ]}
        textColumns={[0]}
      />

      <Explainer result={result} />
    </div>
  );
}

/** Diagrama de dientes de sierra: el inventario baja de Q* a 0 en cada ciclo. */
export function EoqInventoryChart({ result }: Props) {
  const m = result.solution.metrics;
  const qStar = m.Q_star ?? result.solution.variables.Q;
  const T = cycleDays(m);
  if (!qStar || !T || !Number.isFinite(T)) return null;
  const L = m.lead_time ?? 0;
  const rop = m.reorder_point;
  const cycles = 3;

  const data: { t: number; inv: number }[] = [];
  for (let k = 0; k < cycles; k++) {
    data.push({ t: k * T, inv: qStar });
    data.push({ t: (k + 1) * T, inv: 0 });
  }

  // Momentos en que se coloca cada pedido (solo si llega dentro del mismo ciclo).
  const orderMoments = L > 0 && L < T ? Array.from({ length: cycles }, (_, k) => (k + 1) * T - L) : [];

  return (
    <figure className="chart-frame">
      <figcaption>
        <h3 className="chart-title">Nivel de inventario en el tiempo</h3>
        <p className="chart-subtitle">
          Cada pedido de {fmt(qStar)} unidades se consume en {fmt(T, 1)} días. El inventario promedio es Q*/2 ={" "}
          {fmt(qStar / 2)}.
          {rop != null ? ` Cuando el inventario llega a ${fmt(rop)} unidades se coloca el siguiente pedido.` : ""}
        </p>
      </figcaption>
      <div
        className="chart-wrap"
        role="img"
        aria-label={`Inventario en dientes de sierra: de ${fmt(qStar)} a 0 cada ${fmt(T, 1)} días`}
      >
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 12, right: 24, left: 8, bottom: 28 }}>
            <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              domain={[0, cycles * T]}
              ticks={Array.from({ length: cycles + 1 }, (_, k) => k * T)}
              tickFormatter={(v: number) => fmt(v, 1)}
              tick={{ fontSize: 11, fill: C.muted }}
              label={{ value: "Tiempo (días)", position: "insideBottom", offset: -16, fill: C.ink, fontSize: 12 }}
            />
            <YAxis
              domain={[0, "auto"]}
              tickFormatter={(v: number) => fmt(v, 0)}
              tick={{ fontSize: 11, fill: C.muted }}
              label={{ value: "Unidades", angle: -90, position: "insideLeft", fill: C.ink, fontSize: 12 }}
              width={64}
            />
            <Tooltip
              contentStyle={{ border: `1px solid ${C.grid}`, borderRadius: 4, fontSize: 12 }}
              formatter={(value: number) => [fmt(value), "Inventario"]}
              labelFormatter={(label) => `Día ${fmt(Number(label), 1)}`}
            />
            <Legend verticalAlign="top" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
            <ReferenceLine
              y={qStar / 2}
              stroke={C.basic}
              strokeDasharray="6 4"
              label={{ value: "Promedio Q*/2", position: "insideTopRight", fill: C.basic, fontSize: 11 }}
            />
            {rop != null && rop > 0 && rop < qStar ? (
              <ReferenceLine
                y={rop}
                stroke={C.warn}
                strokeDasharray="6 4"
                label={{ value: `ROP = ${fmt(rop)}`, position: "insideBottomRight", fill: C.warn, fontSize: 11 }}
              />
            ) : null}
            {orderMoments.map((t, i) => (
              <ReferenceLine
                key={t}
                x={t}
                stroke={C.pivot}
                strokeDasharray="3 3"
                label={i === 0 ? { value: "Pedir", position: "top", fill: C.pivot, fontSize: 11 } : undefined}
              />
            ))}
            <Line
              type="linear"
              dataKey="inv"
              name="Inventario disponible"
              stroke={C.ink}
              strokeWidth={2.25}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
