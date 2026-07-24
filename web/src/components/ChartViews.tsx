import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ModuleResult } from "../api/client";
import { labelOf } from "../lib/resultLabels";
import SolutionTable from "./SolutionTable";

const C = {
  ink: "#0A1628",
  basic: "#0A6B9A",
  pivot: "#C4166B",
  warn: "#945800",
  grid: "#C8D4E4",
  paper: "#F5F8FC",
  muted: "#5A6F87",
};

const SERIES_COLORS = [C.ink, C.basic, C.pivot, C.warn, "#2D6A4F", "#7B2D8E", "#B08900"];

type Graph = NonNullable<ModuleResult["graph"]> & {
  title?: string;
  subtitle?: string;
  kind?: string;
  value_label?: string;
  x_label?: string;
  y_label?: string;
};

function fmt(n: number): string {
  return n.toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

function chartTitle(graph: Graph, module: string): string {
  if (graph.title?.trim()) return graph.title;
  const names = (graph.series || []).map((s) => s.name.toLowerCase());
  if (names.some((n) => n.includes("ucl") || n.includes("lcl") || n === "xbar" || n === "p" || n === "c")) {
    return "Carta de control";
  }
  if (names.includes("histogram") || names.includes("histograma")) return "Histograma de frecuencias";
  if (names.includes("oc_pa") || names.includes("aoq")) return "Curva OC y AOQ";
  if (names.includes("tr") || names.includes("tc")) return "Costo–volumen–utilidad";
  if (names.includes("tc") && names.includes("ordering")) return "Costos de inventario vs. cantidad de pedido";
  if (names.includes("actual") || names.includes("serie")) return "Serie histórica y pronósticos";
  if (names.includes("pn")) return "Distribución de probabilidad Pn";
  if (names.includes("demand") || names.includes("production")) return "Plan agregado: demanda y producción";
  if (names.includes("queue_length") || names.includes("cola")) return "Longitud de cola en el tiempo";
  if (names.includes("optimum") || names.some((n) => n.startsWith("constraint"))) {
    return "Región factible y óptimo (2 variables)";
  }
  if (graph.type === "network") {
    if (module.includes("markov")) return "Diagrama de estados de Markov";
    if (module.includes("pert") || module.includes("cpm")) return "Red del proyecto";
    if (module.includes("mrp")) return "Estructura de materiales (BOM)";
    if (module.includes("decision")) return "Árbol de decisión";
    return "Red / grafo del problema";
  }
  if (graph.type === "gantt") {
    if (module.includes("job")) return "Diagrama de Gantt de trabajos";
    return "Diagrama de Gantt del proyecto";
  }
  if (graph.type === "matrix") {
    if (module.includes("assign")) return "Matriz de asignación óptima";
    if (module.includes("transport")) return "Matriz de envíos (transporte)";
    return "Matriz de resultados";
  }
  return "Gráfico del resultado";
}

function chartSubtitle(graph: Graph, module: string, metrics: Record<string, number>): string | null {
  if (graph.subtitle?.trim()) return graph.subtitle;
  const bits: string[] = [];
  if (metrics.Q_star != null) bits.push(`Q* = ${fmt(metrics.Q_star)}`);
  if (metrics.Q != null && metrics.Q_star == null) bits.push(`Q* = ${fmt(metrics.Q)}`);
  if (metrics.BEP_units != null) bits.push(`Punto de equilibrio = ${fmt(metrics.BEP_units)} unidades`);
  if (metrics.out_of_control != null && metrics.out_of_control > 0) {
    bits.push(`${fmt(metrics.out_of_control)} punto(s) fuera de control`);
  }
  if (metrics.Cp != null) bits.push(`Cp = ${fmt(metrics.Cp)}`);
  if (metrics.Cpk != null) bits.push(`Cpk = ${fmt(metrics.Cpk)}`);
  if (module.includes("forecast") && metrics.best_mape != null) {
    bits.push(`Mejor MAPE = ${fmt(metrics.best_mape)}%`);
  }
  return bits.length ? bits.join(" · ") : null;
}

function isLimitSeries(name: string): boolean {
  const n = name.toLowerCase();
  return ["ucl", "lcl", "cl", "lsc", "lic", "lc", "rop", "punto de reorden"].some((k) => n === k || n.includes(k));
}

function isBarKind(graph: Graph): boolean {
  if (graph.kind === "bar") return true;
  const names = (graph.series || []).map((s) => s.name.toLowerCase());
  const xl = (graph.x_label || "").toLowerCase();
  return (
    names.includes("histogram") ||
    names.includes("histograma") ||
    xl.includes("bin") ||
    xl.includes("centro")
  );
}

function isControlKind(graph: Graph): boolean {
  if (graph.kind === "control") return true;
  const names = (graph.series || []).map((s) => s.name.toLowerCase());
  return names.includes("ucl") && names.includes("lcl");
}

/* ——— Layout de red: capas topológicas o círculo ——— */
function layoutNodes(
  nodes: { id: string }[],
  edges: { source: string; target: string }[],
  w: number,
  h: number
): Map<string, { x: number; y: number }> {
  const ids = nodes.map((n) => n.id);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const outs = new Map(ids.map((id) => [id, [] as string[]]));
  for (const e of edges) {
    if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
    indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
    outs.get(e.source)!.push(e.target);
  }
  const layers: string[][] = [];
  let frontier = ids.filter((id) => (indeg.get(id) || 0) === 0);
  if (!frontier.length) frontier = [ids[0]];

  // BFS por capas (DAG-friendly)
  const assigned = new Set<string>();
  while (frontier.length && assigned.size < ids.length) {
    layers.push(frontier);
    frontier.forEach((id) => assigned.add(id));
    const next: string[] = [];
    for (const id of frontier) {
      for (const t of outs.get(id) || []) {
        if (assigned.has(t)) continue;
        const preds = edges.filter((e) => e.target === t).map((e) => e.source);
        if (preds.every((p) => assigned.has(p))) next.push(t);
      }
    }
    frontier = [...new Set(next)];
    if (!frontier.length) {
      const rest = ids.filter((id) => !assigned.has(id));
      if (rest.length) frontier = [rest[0]];
    }
    if (layers.length > ids.length) break;
  }
  const leftover = ids.filter((id) => !assigned.has(id));
  if (leftover.length) layers.push(leftover);

  const pos = new Map<string, { x: number; y: number }>();
  const useCircle = layers.length <= 1 && ids.length > 2 && edges.length >= ids.length;
  if (useCircle || layers.length === 0) {
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.36;
    ids.forEach((id, i) => {
      const a = (2 * Math.PI * i) / ids.length - Math.PI / 2;
      pos.set(id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
    });
    return pos;
  }

  const padX = 48;
  const padY = 40;
  layers.forEach((layer, li) => {
    const x = padX + (li * (w - 2 * padX)) / Math.max(layers.length - 1, 1);
    layer.forEach((id, j) => {
      const y = padY + ((j + 1) * (h - 2 * padY)) / (layer.length + 1);
      pos.set(id, { x: layers.length === 1 ? w / 2 : x, y });
    });
  });
  return pos;
}

function edgeCaption(e: {
  weight?: number;
  flow?: number;
  probability?: number;
  qty?: number;
  label?: string;
  cost?: number;
  capacity?: number;
}): string {
  const parts: string[] = [];
  if (e.label) parts.push(String(e.label));
  if (e.probability != null) parts.push(`p=${fmt(e.probability)}`);
  if (e.flow != null) parts.push(`flujo ${fmt(e.flow)}`);
  if (e.capacity != null) parts.push(`cap. ${fmt(e.capacity)}`);
  if (e.qty != null) parts.push(`cant. ${fmt(e.qty)}`);
  if (e.cost != null) parts.push(`costo ${fmt(e.cost)}`);
  if (e.weight != null && e.flow == null) parts.push(`${fmt(e.weight)}`);
  return parts.join(" · ");
}

function ChartShell({
  title,
  subtitle,
  legend,
  children,
  ariaLabel,
}: {
  title: string;
  subtitle?: string | null;
  legend?: ReactNode;
  children: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <figure className="chart-frame">
      <figcaption>
        <h3 className="chart-title">{title}</h3>
        {subtitle ? <p className="chart-subtitle">{subtitle}</p> : null}
      </figcaption>
      {legend}
      <div className="chart-wrap" role="img" aria-label={ariaLabel}>
        {children}
      </div>
    </figure>
  );
}

function GraphXYView({ result }: { result: ModuleResult }) {
  const graph = result.graph as Graph;
  if (!graph?.series?.length) {
    return (
      <p className="field-hint">
        Complete los parámetros del modelo y pulse Resolver para generar el gráfico.
      </p>
    );
  }

  const title = chartTitle(graph, result.module);
  const subtitle = chartSubtitle(graph, result.module, result.solution.metrics);
  const xLabel = labelOf(graph.x_label || "x");
  const yLabel = labelOf(graph.y_label || "y");
  const bar = isBarKind(graph);
  const control = isControlKind(graph);

  const xSet = new Set<number>();
  for (const s of graph.series) for (const x of s.x) xSet.add(x);
  const xs = [...xSet].sort((a, b) => a - b);

  const data = xs.map((x) => {
    const row: Record<string, number | string | null> = { x };
    for (const s of graph.series!) {
      const key = labelOf(s.name);
      const idx = s.x.findIndex((v) => Math.abs(v - x) < 1e-9);
      row[key] = idx >= 0 ? s.y[idx] : null;
    }
    return row;
  });

  const seriesMeta = graph.series.map((s, i) => ({
    key: labelOf(s.name),
    raw: s.name,
    color: isLimitSeries(s.name)
      ? s.name.toLowerCase().includes("ucl") || s.name.toLowerCase().includes("lcl")
        ? C.pivot
        : C.warn
      : SERIES_COLORS[i % SERIES_COLORS.length],
    dashed: isLimitSeries(s.name),
    primary: !isLimitSeries(s.name),
  }));

  // Punto óptimo / Q* / BEP
  const optSeries = graph.series.find((s) =>
    /optimum|optimo|óptimo|q\*|q_star|bep/i.test(s.name)
  );
  const qStar = result.solution.metrics.Q_star ?? result.solution.variables.Q;
  const bep = result.solution.metrics.BEP_units ?? result.solution.variables.BEP_units;

  const Chart = bar ? BarChart : LineChart;

  return (
    <ChartShell title={title} subtitle={subtitle} ariaLabel={title}>
      <ResponsiveContainer width="100%" height={320}>
        <Chart data={data} margin={{ top: 12, right: 16, left: 8, bottom: 28 }}>
          <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
          <XAxis
            dataKey="x"
            tick={{ fontSize: 11, fill: C.muted }}
            label={{ value: xLabel, position: "insideBottom", offset: -16, fill: C.ink, fontSize: 12 }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: C.muted }}
            label={{ value: yLabel, angle: -90, position: "insideLeft", fill: C.ink, fontSize: 12 }}
            width={56}
          />
          <Tooltip
            contentStyle={{
              border: `1px solid ${C.grid}`,
              borderRadius: 4,
              fontFamily: "Manrope, sans-serif",
              fontSize: 12,
            }}
            formatter={(value: number | string, name: string) => [
              typeof value === "number" ? fmt(value) : value,
              name,
            ]}
            labelFormatter={(label) => `${xLabel} = ${label}`}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {seriesMeta.map((s) =>
            bar && s.primary ? (
              <Bar key={s.key} dataKey={s.key} fill={s.color} name={s.key} maxBarSize={36} />
            ) : (
              <Line
                key={s.key}
                type={control || s.dashed ? "linear" : "monotone"}
                dataKey={s.key}
                stroke={s.color}
                name={s.key}
                strokeWidth={s.dashed ? 1.5 : 2.25}
                strokeDasharray={s.dashed ? "6 4" : undefined}
                dot={!s.dashed && (graph.series!.find((x) => labelOf(x.name) === s.key)?.x.length ?? 0) <= 16}
                connectNulls
                activeDot={{ r: 4 }}
              />
            )
          )}
          {qStar != null && Number.isFinite(qStar) && (
            <ReferenceLine
              x={qStar}
              stroke={C.pivot}
              strokeDasharray="4 3"
              label={{ value: `Q* = ${fmt(qStar)}`, fill: C.pivot, fontSize: 11, position: "top" }}
            />
          )}
          {bep != null && Number.isFinite(bep) && (
            <ReferenceLine
              x={bep}
              stroke={C.pivot}
              strokeDasharray="4 3"
              label={{ value: `Equilibrio ${fmt(bep)}`, fill: C.pivot, fontSize: 11, position: "top" }}
            />
          )}
          {optSeries && optSeries.x[0] != null && (
            <ReferenceDot
              x={optSeries.x[0]}
              y={optSeries.y[0]}
              r={6}
              fill={C.pivot}
              stroke={C.paper}
              strokeWidth={2}
              label={{ value: "Óptimo", position: "top", fill: C.pivot, fontSize: 11 }}
            />
          )}
        </Chart>
      </ResponsiveContainer>
      {control && (
        <p className="chart-footnote">
          Líneas punteadas: límites de control (LSC / LC / LIC). Un punto fuera de los límites indica
          posible causa especial.
        </p>
      )}
    </ChartShell>
  );
}

function GraphNetworkView({ result }: { result: ModuleResult }) {
  const graph = result.graph as Graph;
  if (!graph?.nodes?.length) return null;

  const nodes = graph.nodes as {
    id: string;
    critical?: boolean;
    absorbing?: boolean;
    kind?: string;
    value?: number;
    root?: boolean;
    supply_demand?: number;
  }[];
  const edges = (graph.edges || []) as {
    source: string;
    target: string;
    critical?: boolean;
    weight?: number;
    flow?: number;
    probability?: number;
    qty?: number;
    label?: string;
    cost?: number;
    capacity?: number;
    min_cut?: boolean;
  }[];

  const w = 640;
  const h = Math.max(300, 40 + nodes.length * 28);
  const pos = layoutNodes(nodes, edges, w, h);
  const title = chartTitle(graph, result.module);
  const subtitle =
    graph.subtitle ||
    `${nodes.length} nodos · ${edges.length} arcos` +
      (nodes.some((n) => n.critical) ? " · magenta = crítico / ruta elegida" : "");

  const hasProb = edges.some((e) => e.probability != null);
  const hasFlow = edges.some((e) => e.flow != null);
  const hasQty = edges.some((e) => e.qty != null);

  return (
    <ChartShell
      title={title}
      subtitle={subtitle}
      ariaLabel={title}
      legend={
        <p className="chart-legend">
          {nodes.some((n) => n.critical) && <span className="legend-crit">● Crítico / ruta</span>}
          {nodes.some((n) => n.absorbing) && <span className="legend-warn">● Absorbente</span>}
          {hasFlow && <span className="legend-flow">● Con flujo</span>}
          {hasProb && <span className="legend-flow">● Probabilidad en arcos</span>}
          {hasQty && <span className="legend-flow">● Cantidad (BOM)</span>}
          <span className="legend-idle">● Resto</span>
        </p>
      }
    >
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" className="network-svg">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill={C.muted} />
          </marker>
          <marker id="arrow-crit" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill={C.pivot} />
          </marker>
          <marker id="arrow-flow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill={C.basic} />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = pos.get(e.source);
          const b = pos.get(e.target);
          if (!a || !b) return null;
          const hasFlowE = e.flow != null && e.flow > 0;
          const crit = e.critical || e.min_cut;
          const stroke = crit ? C.pivot : hasFlowE ? C.basic : C.grid;
          const marker = crit ? "url(#arrow-crit)" : hasFlowE ? "url(#arrow-flow)" : "url(#arrow)";
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const cap = edgeCaption(e);
          // acortar línea para no tapar el nodo
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const shrink = 22;
          const x1 = a.x + (dx / len) * shrink;
          const y1 = a.y + (dy / len) * shrink;
          const x2 = b.x - (dx / len) * shrink;
          const y2 = b.y - (dy / len) * shrink;
          return (
            <g key={i}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={stroke}
                strokeWidth={crit || hasFlowE ? 2.5 : 1.5}
                markerEnd={marker}
              />
              {cap && (
                <text
                  x={mx}
                  y={my - 6}
                  fontSize="11"
                  fill={C.ink}
                  textAnchor="middle"
                  style={{ fontFamily: "IBM Plex Mono, monospace" }}
                >
                  {cap}
                </text>
              )}
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const fill = n.critical ? C.pivot : n.absorbing ? C.warn : n.root ? C.basic : C.ink;
          const sub =
            n.kind ||
            (n.absorbing ? "absorbente" : "") ||
            (n.value != null ? fmt(n.value) : "") ||
            (n.supply_demand != null ? `s/d ${fmt(n.supply_demand)}` : "") ||
            (n.critical ? "crítica" : "");
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r={24} fill={fill} />
              <text
                x={p.x}
                y={p.y + 5}
                textAnchor="middle"
                fill={C.paper}
                fontSize="13"
                fontWeight="700"
                style={{ fontFamily: "Sora, Manrope, sans-serif" }}
              >
                {n.id.length > 8 ? n.id.slice(0, 7) + "…" : n.id}
              </text>
              {sub ? (
                <text
                  x={p.x}
                  y={p.y + 38}
                  textAnchor="middle"
                  fontSize="11"
                  fill={fill}
                  style={{ fontFamily: "Manrope, sans-serif" }}
                >
                  {sub}
                </text>
              ) : null}
              <title>{`${n.id}${n.value != null ? ` · valor ${fmt(n.value)}` : ""}`}</title>
            </g>
          );
        })}
      </svg>
    </ChartShell>
  );
}

function GraphGanttView({ result }: { result: ModuleResult }) {
  const graph = result.graph as Graph & {
    bars?: { id: string; start: number; end: number; critical?: boolean; slack?: number }[];
  };
  if (!graph?.bars?.length) return null;
  const max = Math.max(...graph.bars.map((b) => b.end + (b.slack || 0)), 1);
  const ticks = Array.from({ length: Math.min(11, Math.floor(max) + 1) }, (_, i) =>
    Math.round((i * max) / Math.min(10, Math.floor(max) || 1))
  );
  const uniqueTicks = [...new Set(ticks)];
  const title = chartTitle(graph, result.module);
  const critCount = graph.bars.filter((b) => b.critical).length;

  return (
    <ChartShell
      title={title}
      subtitle={
        graph.subtitle ||
        `${graph.bars.length} actividades · duración total ${fmt(max)}${
          critCount ? ` · ${critCount} en ruta crítica` : ""
        }`
      }
      ariaLabel={title}
      legend={
        <p className="chart-legend">
          <span className="legend-crit">■ Crítica</span>
          <span className="legend-flow">■ Normal</span>
          <span className="legend-idle">■ Holgura</span>
          <span>{labelOf(graph.x_label || "Tiempo")} →</span>
        </p>
      }
    >
      <div className="gantt-scale">
        {uniqueTicks.map((t) => (
          <span key={t} style={{ left: `${(t / max) * 100}%` }}>
            {t}
          </span>
        ))}
      </div>
      {graph.bars.map((b) => (
        <div key={b.id} className="gantt-row">
          <span className="gantt-label" title={b.id}>
            {b.id}
          </span>
          <div className="gantt-track">
            <div
              className={b.critical ? "gantt-bar gantt-bar-crit" : "gantt-bar"}
              style={{
                left: `${(b.start / max) * 100}%`,
                width: `${(Math.max(b.end - b.start, 0.01) / max) * 100}%`,
              }}
              title={`${b.id}: ${b.start} → ${b.end}${b.critical ? " (crítica)" : ""}`}
            />
            {b.slack != null && b.slack > 0 && (
              <div
                className="gantt-slack"
                style={{
                  left: `${(b.end / max) * 100}%`,
                  width: `${(b.slack / max) * 100}%`,
                }}
                title={`Holgura ${fmt(b.slack)}`}
              />
            )}
          </div>
          <span className="gantt-meta">
            {fmt(b.start)}–{fmt(b.end)}
            {b.critical ? " · crítica" : ""}
            {b.slack != null && b.slack > 0 ? ` · holgura ${fmt(b.slack)}` : ""}
          </span>
        </div>
      ))}
    </ChartShell>
  );
}

function GraphMatrixView({ result }: { result: ModuleResult }) {
  const graph = result.graph as Graph;
  if (!graph?.values) return null;
  const title = chartTitle(graph, result.module);
  const valueLabel = graph.value_label ? labelOf(graph.value_label) : "Valor";
  const cols = ["", ...(graph.col_labels || [])];
  const rows = (graph.row_labels || []).map((r, i) => [
    r,
    ...(graph.values![i] || []).map((v) => (v == null ? null : Number(v))),
  ]);

  // Resaltar celdas > 0 en asignación/transporte
  const numeric = rows.flatMap((r) => r.slice(1).map((v) => Number(v) || 0));
  const maxV = Math.max(...numeric, 1);

  return (
    <ChartShell
      title={title}
      subtitle={
        graph.subtitle ||
        `${graph.row_labels?.length ?? 0} filas × ${graph.col_labels?.length ?? 0} columnas · ${valueLabel}`
      }
      ariaLabel={title}
    >
      <div className="matrix-heat">
        <table className="data-table">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={i} scope="col">
                  {c || "·"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => {
                  if (ci === 0) {
                    return (
                      <th key={ci} scope="row" className="col-text">
                        {String(cell)}
                      </th>
                    );
                  }
                  const n = cell == null ? null : Number(cell);
                  const active = n != null && Math.abs(n) > 1e-9;
                  const intensity = active ? 0.15 + (Math.abs(n!) / maxV) * 0.45 : 0;
                  return (
                    <td
                      key={ci}
                      className={active ? "cell-basic" : undefined}
                      style={
                        active
                          ? { background: `color-mix(in srgb, var(--basic) ${intensity * 100}%, transparent)` }
                          : undefined
                      }
                    >
                      {n == null ? "—" : fmt(n)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="chart-footnote">
        Las celdas con color indican valores positivos ({valueLabel.toLowerCase()}). Más intenso = mayor
        magnitud.
      </p>
      {/* Fallback accesible: misma info en SolutionTable si se necesita exportar mentalmente */}
      <div className="sr-only">
        <SolutionTable caption={title} columns={cols} rows={rows} textColumns={[0]} />
      </div>
    </ChartShell>
  );
}

export default function ChartViews({ result }: { result: ModuleResult }) {
  const t = result.graph?.type;
  if (!result.graph) {
    return (
      <p className="field-hint">
        Este módulo no generó un gráfico para este resultado. Revisa Solución o Tablas.
      </p>
    );
  }
  if (t === "xy") return <GraphXYView result={result} />;
  if (t === "matrix") return <GraphMatrixView result={result} />;
  if (t === "network") return <GraphNetworkView result={result} />;
  if (t === "gantt") return <GraphGanttView result={result} />;
  return (
    <p className="field-hint">
      Tipo de gráfico «{t}» aún no soportado en la vista. Revisa Solución o Tablas.
    </p>
  );
}
