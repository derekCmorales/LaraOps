import { Component, lazy, Suspense, type ReactNode } from "react";
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

const LpGraphView = lazy(() => import("./LpGraphView"));
const LpGraph3DView = lazy(() => import("./LpGraph3DView"));

class ChartErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return <p className="field-hint">No se pudo cargar el gráfico interactivo.</p>;
    }
    return this.props.children;
  }
}

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

/** Marcas de eje cortas: sin colas de decimales. */
function fmtTick(n: number): string {
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return n.toLocaleString("es-MX", { maximumFractionDigits: digits });
}

function chartTitle(graph: Graph, module: string): string {
  if (graph.title?.trim()) return graph.title;
  const names = (graph.series || []).map((s) => s.name.toLowerCase());
  if (names.some((n) => n.includes("ucl") || n.includes("lcl") || n === "xbar" || n === "p" || n === "c")) {
    return "Carta de control";
  }
  if (names.includes("histogram") || names.includes("histograma")) return "Histograma de frecuencias";
  if (names.includes("oc_pa") || names.includes("aoq")) return "Curva OC y AOQ";
  if (names.includes("ordering") && names.includes("holding")) return "Costos de inventario vs. cantidad de pedido";
  if (names.includes("tr") || names.includes("tc")) return "Costo–volumen–utilidad";
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

function layoutCircle(
  nodes: { id: string }[],
  w: number,
  h: number,
  radius = 0.36,
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * radius;
  nodes.forEach((node, i) => {
    const a = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    pos.set(node.id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  });
  return pos;
}

/* ——— Layout de red: capas topológicas o círculo ——— */
/**
 * Capas por distancia (BFS) desde los nodos sin arcos de entrada: en redes de flujo y de rutas
 * evita la cadena larguísima que produce el "camino más largo" cuando hay arcos entre vecinos.
 * Dentro de cada capa los nodos se ordenan por la posición media de sus predecesores.
 */
function layoutByDistance(
  nodes: { id: string }[],
  edges: { source: string; target: string }[],
  w: number,
  h: number,
): Map<string, { x: number; y: number }> {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const outs = new Map(ids.map((id) => [id, [] as string[]]));
  const preds = new Map(ids.map((id) => [id, [] as string[]]));
  for (const e of edges) {
    if (!known.has(e.source) || !known.has(e.target) || e.source === e.target) continue;
    outs.get(e.source)!.push(e.target);
    preds.get(e.target)!.push(e.source);
  }
  const roots = ids.filter((id) => preds.get(id)!.length === 0);
  const dist = new Map<string, number>();
  const queue = (roots.length ? roots : [ids[0]]).slice();
  queue.forEach((id) => dist.set(id, 0));
  for (let qi = 0; qi < queue.length; qi++) {
    for (const t of outs.get(queue[qi])!) {
      if (!dist.has(t)) {
        dist.set(t, dist.get(queue[qi])! + 1);
        queue.push(t);
      }
    }
  }
  const maxD = Math.max(0, ...dist.values());
  for (const id of ids) if (!dist.has(id)) dist.set(id, maxD + 1);
  const layerCount = Math.max(...dist.values()) + 1;
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  ids.forEach((id) => layers[dist.get(id)!].push(id));
  const rank = new Map<string, number>();
  layers.forEach((layer, li) => {
    if (li > 0) {
      const score = (id: string) => {
        const before = preds.get(id)!.filter((p) => dist.get(p)! < li && rank.has(p));
        return before.length ? before.reduce((a, p) => a + rank.get(p)!, 0) / before.length : layer.indexOf(id);
      };
      layer.sort((a, b) => score(a) - score(b));
    }
    layer.forEach((id, j) => rank.set(id, j));
  });
  const padX = 48;
  const padY = 44;
  const pos = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, li) => {
    const x = layerCount === 1 ? w / 2 : padX + (li * (w - 2 * padX)) / (layerCount - 1);
    layer.forEach((id, j) => pos.set(id, { x, y: padY + ((j + 1) * (h - 2 * padY)) / (layer.length + 1) }));
  });
  return pos;
}

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

type Pt = { x: number; y: number };

const NODE_R = 24;

function edgeKey(source: string, target: string): string {
  return `${source}\u0000${target}`;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Trazo de un arco. Los lazos salen hacia fuera del dibujo; un par ida/vuelta se curva
 * a lados opuestos; un arco recto que pasaría por encima de otro nodo también se curva.
 */
function edgeGeometry(
  source: string,
  target: string,
  a: Pt,
  b: Pt,
  pos: Map<string, Pt>,
  edgeSet: Set<string>,
  undirected: boolean,
  center: Pt,
): { d: string; lx: number; ly: number } {
  if (source === target) {
    let ux = a.x - center.x;
    let uy = a.y - center.y;
    const ul = Math.hypot(ux, uy);
    if (ul < 1) {
      ux = 0;
      uy = -1;
    } else {
      ux /= ul;
      uy /= ul;
    }
    const spread = 0.42;
    const rot = (x: number, y: number, ang: number) => ({
      x: x * Math.cos(ang) - y * Math.sin(ang),
      y: x * Math.sin(ang) + y * Math.cos(ang),
    });
    const d1 = rot(ux, uy, -spread);
    const d2 = rot(ux, uy, spread);
    const reach = 88;
    const s = { x: a.x + d1.x * NODE_R, y: a.y + d1.y * NODE_R };
    const e = { x: a.x + d2.x * (NODE_R + 4), y: a.y + d2.y * (NODE_R + 4) };
    const c1 = { x: a.x + rot(ux, uy, -spread * 1.1).x * reach, y: a.y + rot(ux, uy, -spread * 1.1).y * reach };
    const c2 = { x: a.x + rot(ux, uy, spread * 1.1).x * reach, y: a.y + rot(ux, uy, spread * 1.1).y * reach };
    return {
      d: `M${s.x},${s.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${e.x},${e.y}`,
      lx: a.x + ux * (reach * 0.7 + 12),
      ly: a.y + uy * (reach * 0.7 + 12),
    };
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let bend = 0;
  if (!undirected && edgeSet.has(edgeKey(target, source))) bend = 0.16;
  for (const [id, p] of pos) {
    if (id === source || id === target) continue;
    if (distToSegment(p, a, b) < NODE_R + 6) {
      bend = Math.max(bend, 0.28);
      break;
    }
  }
  if (bend === 0) {
    const x1 = a.x + (dx / len) * NODE_R;
    const y1 = a.y + (dy / len) * NODE_R;
    const x2 = b.x - (dx / len) * (NODE_R - 2);
    const y2 = b.y - (dy / len) * (NODE_R - 2);
    return { d: `M${x1},${y1} L${x2},${y2}`, lx: (a.x + b.x) / 2, ly: (a.y + b.y) / 2 - 9 };
  }
  // Perpendicular a la izquierda del sentido a→b: el arco de vuelta queda al otro lado.
  const px = -dy / len;
  const py = dx / len;
  const offset = Math.max(bend * len, 30);
  const c = { x: (a.x + b.x) / 2 + px * offset, y: (a.y + b.y) / 2 + py * offset };
  const toward = (from: Pt, to: Pt, r: number) => {
    const l = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: from.x + ((to.x - from.x) / l) * r, y: from.y + ((to.y - from.y) / l) * r };
  };
  const s = toward(a, c, NODE_R);
  const e = toward(b, c, NODE_R - 2);
  return {
    d: `M${s.x},${s.y} Q${c.x},${c.y} ${e.x},${e.y}`,
    lx: 0.25 * a.x + 0.5 * c.x + 0.25 * b.x,
    ly: 0.25 * a.y + 0.5 * c.y + 0.25 * b.y,
  };
}

function edgeCaption(e: {
  weight?: number;
  flow?: number;
  probability?: number;
  qty?: number;
  label?: string;
  cost?: number;
  capacity?: number | null;
}): string {
  const parts: string[] = [];
  if (e.label) parts.push(String(e.label));
  if (e.probability != null) parts.push(`p=${fmt(e.probability)}`);
  if (e.flow != null && e.capacity != null) parts.push(`${fmt(e.flow)}/${fmt(e.capacity)}`);
  else {
    if (e.flow != null) parts.push(`flujo ${fmt(e.flow)}`);
    if (e.capacity != null) parts.push(`cap. ${fmt(e.capacity)}`);
  }
  if (e.qty != null) parts.push(`cant. ${fmt(e.qty)}`);
  if (e.cost != null) parts.push(`c ${fmt(e.cost)}`);
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

function isEnvelope(name: string): boolean {
  return /^envolvente/i.test(name);
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
  const integerX = xs.every((x) => Number.isInteger(x));

  const data = xs.map((x) => {
    const row: Record<string, number | string | null> = { x };
    for (const s of graph.series!) {
      const key = labelOf(s.name);
      const idx = s.x.findIndex((v) => Math.abs(v - x) < 1e-9);
      row[key] = idx >= 0 ? s.y[idx] : null;
    }
    return row;
  });

  // Punto óptimo / Q* / BEP
  const isOptimum = (name: string) => /optimum|optimo|óptimo|q\*|q_star|bep/i.test(name);
  const optSeries = graph.series.find((s) => isOptimum(s.name));

  const seriesMeta = graph.series
    .map((s, i) => ({
      key: labelOf(s.name),
      raw: s.name,
      color: isLimitSeries(s.name)
        ? s.name.toLowerCase().includes("ucl") || s.name.toLowerCase().includes("lcl")
          ? C.pivot
          : C.warn
        : isEnvelope(s.name)
          ? C.pivot
          : SERIES_COLORS[i % SERIES_COLORS.length],
      dashed: isLimitSeries(s.name),
      envelope: isEnvelope(s.name),
      primary: !isLimitSeries(s.name),
      single: s.x.length === 1,
    }))
    // Un punto suelto (el óptimo) va como marca, no como serie con leyenda.
    .filter((s) => !(s.single && isOptimum(s.raw)));
  const qStar = result.solution.metrics.Q_star ?? result.solution.variables.Q;
  const bep = result.solution.metrics.BEP_units ?? result.solution.variables.BEP_units;
  // EOQ: punto mínimo sobre la curva de costo relevante.
  const minRow =
    result.module === "eoq" && qStar != null
      ? data.find((row) => Math.abs(Number(row.x) - qStar) < 1e-9)
      : undefined;
  const minKey = labelOf(graph.series[0].name);
  const minY = minRow ? minRow[minKey] : null;

  const Chart = bar ? BarChart : LineChart;

  return (
    <ChartShell title={title} subtitle={subtitle} ariaLabel={title}>
      <ResponsiveContainer width="100%" height={320}>
        <Chart data={data} margin={{ top: 12, right: 16, left: 8, bottom: 28 }}>
          <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
          <XAxis
            dataKey="x"
            type={bar ? "category" : "number"}
            domain={bar ? undefined : ["dataMin", "dataMax"]}
            allowDecimals={!integerX}
            tickFormatter={(v: number | string) => (typeof v === "number" ? fmtTick(v) : String(v))}
            tick={{ fontSize: 11, fill: C.muted }}
            label={{ value: xLabel, position: "insideBottom", offset: -16, fill: C.ink, fontSize: 12 }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: C.muted }}
            tickFormatter={(v: number) => fmtTick(v)}
            label={{ value: yLabel, angle: -90, position: "insideLeft", fill: C.ink, fontSize: 12 }}
            width={64}
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
            labelFormatter={(label) => `${xLabel} = ${typeof label === "number" ? fmt(label) : label}`}
          />
          <Legend verticalAlign="top" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
          {seriesMeta.map((s) =>
            bar && s.primary ? (
              <Bar key={s.key} dataKey={s.key} fill={s.color} name={s.key} maxBarSize={36} isAnimationActive={false} />
            ) : (
              <Line
                key={s.key}
                type={control || s.dashed || s.envelope ? "linear" : "monotone"}
                dataKey={s.key}
                stroke={s.color}
                name={s.key}
                strokeWidth={s.dashed ? 1.5 : s.envelope ? 4 : 2.25}
                strokeOpacity={s.envelope ? 0.55 : 1}
                strokeDasharray={s.dashed ? "6 4" : undefined}
                dot={!s.dashed && !s.envelope && (graph.series!.find((x) => labelOf(x.name) === s.key)?.x.length ?? 0) <= 16}
                connectNulls
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            )
          )}
          {qStar != null && Number.isFinite(qStar) && (
            <ReferenceLine
              x={qStar}
              stroke={C.pivot}
              strokeDasharray="4 3"
              label={{ value: `Q* = ${fmt(qStar)}`, fill: C.pivot, fontSize: 11, position: "insideTopRight" }}
            />
          )}
          {minRow && typeof minY === "number" && (
            <ReferenceDot
              x={Number(minRow.x)}
              y={minY}
              r={6}
              fill={C.pivot}
              stroke={C.paper}
              strokeWidth={2}
              label={{ value: `Mínimo ${fmt(minY)}`, position: "bottom", fill: C.pivot, fontSize: 11 }}
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
              label={{ value: `Óptimo (${fmt(optSeries.x[0])}; ${fmt(optSeries.y[0])})`, position: "top", fill: C.pivot, fontSize: 11 }}
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

type NetNode = {
  id: string;
  critical?: boolean;
  absorbing?: boolean;
  kind?: string;
  value?: number;
  root?: boolean;
  supply_demand?: number;
  tone?: "crit" | "flow" | "warn" | "idle";
  duration?: number;
  es?: number;
  ef?: number;
  ls?: number;
  lf?: number;
  slack?: number;
};

type ToneName = "crit" | "flow" | "warn" | "idle";
const TONE_FILL: Record<ToneName, string> = { crit: C.pivot, flow: C.basic, warn: C.warn, idle: C.ink };

function rectEdge(
  from: { x: number; y: number },
  to: { x: number; y: number },
  hw: number,
  hh: number,
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { x: from.x + hw, y: from.y };
  const scale = Math.min(hw / Math.abs(dx), hh / Math.abs(dy));
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

function AonNetwork({
  result,
  nodes,
  edges,
}: {
  result: ModuleResult;
  nodes: NetNode[];
  edges: { source: string; target: string; critical?: boolean }[];
}) {
  const graph = result.graph as Graph;
  const w = Math.max(880, nodes.length * 170);
  const h = Math.max(460, nodes.length * 108);
  const pos = layoutNodes(nodes, edges, w, h);
  const hw = 62;
  const hh = 38;
  const title = chartTitle(graph, result.module);
  return (
    <ChartShell
      title={title}
      subtitle={graph.subtitle || "Actividades en los nodos. Magenta = ruta crítica."}
      ariaLabel={title}
      legend={
        <p className="chart-legend">
          <span className="legend-crit">■ Ruta crítica</span>
          <span className="legend-flow">■ Con holgura</span>
          <span>ES / EF arriba · LS / LF abajo</span>
        </p>
      }
    >
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" className="network-svg">
        <defs>
          <marker id="aon-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill={C.muted} />
          </marker>
          <marker id="aon-arrow-crit" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill={C.pivot} />
          </marker>
        </defs>
        {edges.map((edge, index) => {
          const a = pos.get(edge.source);
          const b = pos.get(edge.target);
          if (!a || !b) return null;
          const start = rectEdge(a, b, hw, hh);
          const end = rectEdge(b, a, hw, hh);
          return (
            <line
              key={`${edge.source}-${edge.target}-${index}`}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke={edge.critical ? C.pivot : C.grid}
              strokeWidth={edge.critical ? 2.4 : 1.5}
              markerEnd={edge.critical ? "url(#aon-arrow-crit)" : "url(#aon-arrow)"}
            />
          );
        })}
        {nodes.map((node) => {
          const p = pos.get(node.id);
          if (!p) return null;
          const crit = Boolean(node.critical);
          return (
            <g key={node.id}>
              <rect
                x={p.x - hw}
                y={p.y - hh}
                width={hw * 2}
                height={hh * 2}
                rx={4}
                fill={crit ? "#FDE7F1" : C.paper}
                stroke={crit ? C.pivot : C.basic}
                strokeWidth={crit ? 2 : 1.4}
              />
              <text x={p.x - hw + 8} y={p.y - hh + 14} fontSize="10" fill={C.muted} style={{ fontFamily: "IBM Plex Mono, monospace" }}>
                {node.es != null ? fmt(node.es) : ""}
              </text>
              <text x={p.x + hw - 8} y={p.y - hh + 14} fontSize="10" fill={C.muted} textAnchor="end" style={{ fontFamily: "IBM Plex Mono, monospace" }}>
                {node.ef != null ? fmt(node.ef) : ""}
              </text>
              <text x={p.x} y={p.y - 2} textAnchor="middle" fontSize="14" fontWeight="700" fill={crit ? C.pivot : C.ink} style={{ fontFamily: "Sora, Manrope, sans-serif" }}>
                {node.id.length > 10 ? `${node.id.slice(0, 9)}…` : node.id}
              </text>
              <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize="10" fill={C.ink} style={{ fontFamily: "IBM Plex Mono, monospace" }}>
                {node.duration != null ? `d ${fmt(node.duration)}` : ""}
              </text>
              <text x={p.x - hw + 8} y={p.y + hh - 8} fontSize="10" fill={C.muted} style={{ fontFamily: "IBM Plex Mono, monospace" }}>
                {node.ls != null ? fmt(node.ls) : ""}
              </text>
              <text x={p.x + hw - 8} y={p.y + hh - 8} fontSize="10" fill={C.muted} textAnchor="end" style={{ fontFamily: "IBM Plex Mono, monospace" }}>
                {node.lf != null ? fmt(node.lf) : ""}
              </text>
              <title>
                {`${node.id}: duración ${node.duration != null ? fmt(node.duration) : "—"}, ES ${node.es != null ? fmt(node.es) : "—"}, EF ${node.ef != null ? fmt(node.ef) : "—"}, holgura ${node.slack != null ? fmt(node.slack) : "—"}`}
              </title>
            </g>
          );
        })}
      </svg>
    </ChartShell>
  );
}

function ganttFromTables(result: ModuleResult): ModuleResult | null {
  const table = result.tables?.find((item) => item.name === "gantt");
  if (!table) return null;
  const col = (name: string) => table.columns.indexOf(name);
  const idI = col("actividad") >= 0 ? col("actividad") : col("id");
  const startI = col("inicio");
  const endI = col("fin");
  const critI = col("critica") >= 0 ? col("critica") : col("crítica");
  const slackI = col("holgura");
  if (idI < 0 || startI < 0 || endI < 0) return null;
  return {
    ...result,
    graph: {
      type: "gantt",
      bars: table.rows.map((row) => ({
        id: String(row[idI]),
        start: Number(row[startI]),
        end: Number(row[endI]),
        critical: Boolean(row[critI]),
        slack: slackI >= 0 ? Number(row[slackI]) : undefined,
      })),
      title: "Diagrama de Gantt",
      subtitle: "Magenta = ruta crítica · la banda gris es la holgura",
      x_label: "Tiempo",
    },
  };
}

function GraphNetworkView({ result }: { result: ModuleResult }) {
  const graph = result.graph as Graph;
  if (!graph?.nodes?.length) return null;

  const nodes = graph.nodes as NetNode[];
  const earlyEdges = (graph.edges || []) as { source: string; target: string; critical?: boolean }[];
  if (nodes.some((node) => typeof node.es === "number" && typeof node.duration === "number")) {
    return <AonNetwork result={result} nodes={nodes} edges={earlyEdges} />;
  }

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
  const loops = edges.some((e) => e.source === e.target);
  const undirected = (graph as { directed?: boolean }).directed === false;
  // Una cadena de Markov casi nunca es un DAG: en capas los arcos se enciman, en círculo se leen.
  const circular =
    nodes.length > 2 &&
    ((graph as { layout?: string }).layout === "circle" || undirected || result.module === "markov");
  const h = Math.max(
    loops ? 420 : 300,
    40 + nodes.length * 28,
    circular ? 360 + Math.max(0, nodes.length - 8) * 22 : 0,
    result.module === "networks" && !circular ? 280 + nodes.length * 22 : 0,
  );
  // En un círculo explícito la etiqueta del nodo va hacia afuera, lejos de las flechas que llegan.
  const outwardLabels = circular && (graph as { layout?: string }).layout === "circle";
  const subPos = (p: { x: number; y: number }) => {
    if (!outwardLabels) return { x: p.x, y: p.y + 38 };
    const dx = p.x - w / 2;
    const dy = p.y - h / 2;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * 40, y: p.y + (dy / len) * 38 + 4 };
  };
  const customLegend = (graph as { legend?: { label: string; tone: ToneName }[] }).legend;
  const pos = circular
    ? layoutCircle(nodes, w, h, loops ? 0.27 : 0.36)
    : result.module === "networks"
      ? layoutByDistance(nodes, edges, w, h)
      : layoutNodes(nodes, edges, w, h);
  const edgeSet = new Set(edges.map((e) => edgeKey(e.source, e.target)));
  const center = { x: w / 2, y: h / 2 };
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
        customLegend?.length ? (
          <p className="chart-legend">
            {customLegend.map((item) => (
              <span key={item.label} className={`legend-${item.tone}`}>
                ● {item.label}
              </span>
            ))}
          </p>
        ) : (
          <p className="chart-legend">
            {nodes.some((n) => n.critical) && <span className="legend-crit">● Crítico / ruta</span>}
            {nodes.some((n) => n.absorbing) && <span className="legend-warn">● Absorbente</span>}
            {hasFlow && <span className="legend-flow">● Con flujo</span>}
            {hasProb && <span className="legend-flow">● Probabilidad en arcos</span>}
            {hasQty && <span className="legend-flow">● Cantidad (BOM)</span>}
            <span className="legend-idle">● Resto</span>
          </p>
        )
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
          // En una red no dirigida solo llevan flecha las aristas por las que circula flujo.
          const marker =
            undirected && !hasFlowE ? undefined : crit ? "url(#arrow-crit)" : hasFlowE ? "url(#arrow-flow)" : "url(#arrow)";
          const cap = edgeCaption(e);
          const geo = edgeGeometry(e.source, e.target, a, b, pos, edgeSet, undirected, center);
          return (
            <g key={i}>
              <title>{`${e.source} → ${e.target}${cap ? `: ${cap}` : ""}`}</title>
              <path
                d={geo.d}
                fill="none"
                stroke={stroke}
                strokeWidth={crit || hasFlowE ? 2.5 : 1.5}
                strokeDasharray={e.flow != null && !hasFlowE && !crit ? "5 4" : undefined}
                markerEnd={marker}
              />
              {cap && (
                <text
                  x={geo.lx}
                  y={geo.ly}
                  fontSize="11"
                  fill={C.ink}
                  stroke={C.paper}
                  strokeWidth={3}
                  paintOrder="stroke"
                  textAnchor="middle"
                  dominantBaseline="middle"
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
          const fill = n.tone
            ? TONE_FILL[n.tone]
            : n.critical
              ? C.pivot
              : n.absorbing
                ? C.warn
                : n.root
                  ? C.basic
                  : C.ink;
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
                  x={subPos(p).x}
                  y={subPos(p).y}
                  textAnchor="middle"
                  fontSize="11"
                  fill={fill}
                  style={{ fontFamily: "Manrope, sans-serif" }}
                >
                  {sub}
                </text>
              ) : null}
              <title>{`${n.id}${n.kind ? ` · ${n.kind}` : ""}${n.value != null ? ` · valor ${fmt(n.value)}` : ""}`}</title>
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
  if (t === "xy" && result.graph.kind === "lp3d") {
    return (
      <ChartErrorBoundary>
        <Suspense fallback={<p className="field-hint">Cargando gráfico 3D…</p>}>
          <LpGraph3DView result={result} />
        </Suspense>
      </ChartErrorBoundary>
    );
  }
  if (t === "xy" && result.graph.kind === "lp2d") {
    return (
      <ChartErrorBoundary>
        <Suspense fallback={<p className="field-hint">Cargando gráfico interactivo…</p>}>
          <LpGraphView result={result} />
        </Suspense>
      </ChartErrorBoundary>
    );
  }
  if (t === "xy") return <GraphXYView result={result} />;
  if (t === "matrix") return <GraphMatrixView result={result} />;
  if (result.module === "pert_cpm") {
    const gantt = result.graph?.type === "gantt" ? result : ganttFromTables(result);
    return (
      <div className="pert-visuals">
        {gantt ? <GraphGanttView result={gantt} /> : null}
        {t === "network" ? <GraphNetworkView result={result} /> : null}
      </div>
    );
  }
  if (t === "network") return <GraphNetworkView result={result} />;
  if (t === "gantt") return <GraphGanttView result={result} />;
  return (
    <p className="field-hint">
      Tipo de gráfico «{t}» aún no soportado en la vista. Revisa Solución o Tablas.
    </p>
  );
}
