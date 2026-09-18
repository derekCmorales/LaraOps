import { SolverError } from "../../errors";
import { LIMITS, assertLimit } from "../../limits";
import type { GraphXY, ModuleResult } from "../../schema";
import { okResult } from "../../schema";

export type EoqRequest = {
  D: number;
  S: number;
  H: number;
  C: number;
  graph_points: number;
};

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("payload debe ser un objeto JSON");
  }
  return body as Record<string, unknown>;
}

function pos(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !(n > 0)) throw new SolverError(`${name} debe ser > 0`);
  return n;
}

function nonneg(v: unknown, name: string, fallback: number): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new SolverError(`${name} debe ser ≥ 0`);
  return n;
}

export function parseEoqRequest(body: unknown): EoqRequest {
  const o = asRecord(body);
  const graphPoints = o.graph_points == null ? 40 : Number(o.graph_points);
  if (!Number.isFinite(graphPoints) || graphPoints < 5 || graphPoints > LIMITS.eoqGraphPoints) {
    throw new SolverError(`graph_points debe estar entre 5 y ${LIMITS.eoqGraphPoints}`);
  }
  assertLimit(graphPoints <= LIMITS.eoqGraphPoints, `graph_points no puede superar ${LIMITS.eoqGraphPoints}`);
  return {
    D: pos(o.D, "D"),
    S: pos(o.S, "S"),
    H: pos(o.H, "H"),
    C: nonneg(o.C, "C", 0),
    graph_points: Math.trunc(graphPoints),
  };
}

export function solve(body: unknown): ModuleResult {
  const req = parseEoqRequest(body);
  const qStar = Math.sqrt((2.0 * req.D * req.S) / req.H);
  const ordersPerYear = req.D / qStar;
  const timeBetween = 1.0 / ordersPerYear;
  const tcOrdering = ordersPerYear * req.S;
  const tcHolding = (qStar / 2.0) * req.H;
  const tc = tcOrdering + tcHolding + req.C * req.D;

  const qMin = 0.2 * qStar;
  const qMax = 2.5 * qStar;
  const n = req.graph_points;
  const xs: number[] = [];
  const tcYs: number[] = [];
  const ordYs: number[] = [];
  const holdYs: number[] = [];
  for (let i = 0; i < n; i++) {
    const q = qMin + ((qMax - qMin) * i) / (n - 1);
    xs.push(q);
    const nOrders = req.D / q;
    const ordering = nOrders * req.S;
    const holding = (q / 2.0) * req.H;
    ordYs.push(ordering);
    holdYs.push(holding);
    tcYs.push(ordering + holding + req.C * req.D);
  }

  const graph: GraphXY = {
    type: "xy",
    series: [
      { name: "TC", x: xs, y: tcYs },
      { name: "ordering", x: xs, y: ordYs },
      { name: "holding", x: xs, y: holdYs },
    ],
    x_label: "Cantidad de pedido (Q)",
    y_label: "Costo anual",
    title: "Costos de inventario vs. cantidad de pedido",
    subtitle: `Mínimo en Q* = ${qStar.toFixed(2)}`,
  };

  return okResult("eoq", {
    status: "ok",
    variables: { Q: qStar },
    metrics: {
      Q_star: qStar,
      orders_per_year: ordersPerYear,
      time_between_orders_years: timeBetween,
      TC: tc,
      TC_ordering: tcOrdering,
      TC_holding: tcHolding,
    },
    graph,
    tables: [
      {
        name: "summary",
        columns: ["métrica", "valor"],
        rows: [
          ["Q_star", qStar],
          ["orders_per_year", ordersPerYear],
          ["time_between_orders_years", timeBetween],
          ["TC", tc],
          ["TC_ordering", tcOrdering],
          ["TC_holding", tcHolding],
        ],
      },
    ],
  });
}
