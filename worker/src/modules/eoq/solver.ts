import { SolverError } from "../../errors";
import { LIMITS, assertLimit } from "../../limits";
import type { GraphXY, ModuleResult } from "../../schema";
import { okResult } from "../../schema";

export type EoqRequest = {
  D: number;
  S: number;
  H: number;
  C: number;
  /** Tiempo de entrega en días (0 = sin punto de reorden). */
  lead_time: number;
  /** Días de operación por año para pasar de años a días. */
  working_days: number;
  graph_points: number;
};

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("payload debe ser un objeto JSON");
  }
  return body as Record<string, unknown>;
}

function pos(v: unknown, label: string): number {
  const n = v == null || v === "" ? NaN : Number(v);
  if (!Number.isFinite(n) || !(n > 0)) throw new SolverError(`${label} debe ser mayor que 0`);
  return n;
}

function nonneg(v: unknown, label: string, fallback: number): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new SolverError(`${label} no puede ser negativo`);
  return n;
}

export function parseEoqRequest(body: unknown): EoqRequest {
  const o = asRecord(body);
  const graphPoints = o.graph_points == null ? 40 : Number(o.graph_points);
  if (!Number.isFinite(graphPoints) || graphPoints < 5 || graphPoints > LIMITS.eoqGraphPoints) {
    throw new SolverError(`graph_points debe estar entre 5 y ${LIMITS.eoqGraphPoints}`);
  }
  assertLimit(graphPoints <= LIMITS.eoqGraphPoints, `graph_points no puede superar ${LIMITS.eoqGraphPoints}`);
  const workingDays = o.working_days == null || o.working_days === "" ? 365 : pos(o.working_days, "Días por año");
  if (workingDays > 366) throw new SolverError("Días por año no puede superar 366");
  return {
    D: pos(o.D, "La demanda anual (D)"),
    S: pos(o.S, "El costo de ordenar (S)"),
    H: pos(o.H, "El costo de mantener (H)"),
    C: nonneg(o.C, "El costo unitario (C)", 0),
    lead_time: nonneg(o.lead_time, "El tiempo de entrega", 0),
    working_days: workingDays,
    graph_points: Math.trunc(graphPoints),
  };
}

function fmt2(n: number): string {
  return n.toFixed(2);
}

function fmtDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function solve(body: unknown): ModuleResult {
  const req = parseEoqRequest(body);
  const qStar = Math.sqrt((2.0 * req.D * req.S) / req.H);
  const ordersPerYear = req.D / qStar;
  const timeBetween = 1.0 / ordersPerYear;
  const timeBetweenDays = timeBetween * req.working_days;
  const tcOrdering = ordersPerYear * req.S;
  const tcHolding = (qStar / 2.0) * req.H;
  const relevantCost = tcOrdering + tcHolding;
  const purchaseCost = req.C * req.D;
  const tc = relevantCost + purchaseCost;
  const dailyDemand = req.D / req.working_days;
  const warnings: string[] = [];

  const metrics: Record<string, number> = {
    Q_star: qStar,
    orders_per_year: ordersPerYear,
    time_between_orders_years: timeBetween,
    time_between_orders_days: timeBetweenDays,
    avg_inventory: qStar / 2.0,
    TC_ordering: tcOrdering,
    TC_holding: tcHolding,
    relevant_cost: relevantCost,
    purchase_cost: purchaseCost,
    TC: tc,
    daily_demand: dailyDemand,
  };

  let reorderPoint: number | null = null;
  if (req.lead_time > 0) {
    reorderPoint = dailyDemand * req.lead_time;
    metrics.lead_time = req.lead_time;
    metrics.reorder_point = reorderPoint;
    if (req.lead_time > timeBetweenDays) {
      warnings.push(
        "El tiempo de entrega es mayor que el tiempo entre pedidos: habrá más de un pedido en tránsito. Compara el punto de reorden con la posición de inventario (en mano + en tránsito).",
      );
    }
  }

  // Malla de Q que incluye Q* exacto para que el mínimo quede sobre la curva.
  const qMin = 0.2 * qStar;
  const qMax = 2.5 * qStar;
  const n = req.graph_points;
  const qs: number[] = [];
  for (let i = 0; i < n; i++) qs.push(qMin + ((qMax - qMin) * i) / (n - 1));
  let nearest = 0;
  for (let i = 1; i < n; i++) {
    if (Math.abs(qs[i] - qStar) < Math.abs(qs[nearest] - qStar)) nearest = i;
  }
  qs[nearest] = qStar;

  const relYs: number[] = [];
  const ordYs: number[] = [];
  const holdYs: number[] = [];
  for (const q of qs) {
    const ordering = (req.D / q) * req.S;
    const holding = (q / 2.0) * req.H;
    ordYs.push(ordering);
    holdYs.push(holding);
    relYs.push(ordering + holding);
  }

  const subtitle =
    purchaseCost > 0
      ? `Mínimo en Q* = ${fmt2(qStar)} con costo relevante ${fmt2(relevantCost)}. El costo de compra (${fmt2(purchaseCost)}) no depende de Q y no se grafica.`
      : `Mínimo en Q* = ${fmt2(qStar)} con costo relevante ${fmt2(relevantCost)}.`;

  const graph: GraphXY = {
    type: "xy",
    series: [
      { name: "relevant_cost", x: qs, y: relYs },
      { name: "ordering", x: qs, y: ordYs },
      { name: "holding", x: qs, y: holdYs },
    ],
    x_label: "Cantidad de pedido (Q)",
    y_label: "Costo anual",
    title: "Costos de inventario vs. cantidad de pedido",
    subtitle,
  };

  const rows: (string | number)[][] = [
    ["Cantidad económica de pedido (Q*)", qStar],
    ["Pedidos por año (N = D / Q*)", ordersPerYear],
    ["Tiempo entre pedidos (años)", timeBetween],
    [`Tiempo entre pedidos (días, ${fmtDays(req.working_days)} días/año)`, timeBetweenDays],
    ["Inventario promedio (Q* / 2)", qStar / 2.0],
    ["Costo anual de ordenar (D / Q* x S)", tcOrdering],
    ["Costo anual de mantener (Q* / 2 x H)", tcHolding],
    ["Costo relevante (ordenar + mantener)", relevantCost],
    ["Costo anual de compra (C x D)", purchaseCost],
    ["Costo total anual", tc],
  ];
  if (reorderPoint != null) {
    rows.push(["Demanda diaria (D / días por año)", dailyDemand]);
    rows.push(["Punto de reorden (demanda diaria x tiempo de entrega)", reorderPoint]);
  }

  return okResult("eoq", {
    status: "ok",
    variables: { Q: qStar },
    metrics,
    graph,
    tables: [{ name: "summary", columns: ["métrica", "valor"], rows }],
    warnings,
  });
}
