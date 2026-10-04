import type { ModuleResult } from "../api/client";
import { DUMMY_DEST, DUMMY_SOURCE } from "./transportForm";

export type Num = number | string | null;

/** Estado de la tabla en un paso (o en la solución final). */
export type TransportStepMeta = {
  phase: "initial" | "modi" | "check";
  sources: string[];
  dests: string[];
  alloc: number[][];
  basis: [number, number][];
  reason?: string;
  // Solución inicial
  cell?: [number, number];
  qty?: number;
  cost?: Num;
  crossed?: "row" | "col" | "both";
  row_penalties?: Num[];
  col_penalties?: Num[];
  supply_left?: number[];
  demand_left?: number[];
  // MODI / prueba de optimalidad
  u?: Num[];
  v?: Num[];
  reduced?: Num[][];
  enter?: [number, number] | null;
  delta?: Num;
  cycle?: [number, number, number][];
  theta?: number;
  leave?: [number, number] | null;
};

export type TransportModel = {
  sources: string[];
  dests: string[];
  /** Costo original por celda; "M" = prohibida. */
  costs: Num[][];
  supply: number[];
  demand: number[];
  dummyRow: boolean;
  dummyCol: boolean;
};

export function isDummySource(name: string): boolean {
  return name === DUMMY_SOURCE;
}

export function isDummyDest(name: string): boolean {
  return name === DUMMY_DEST;
}

/** Reconstruye costos, oferta y demanda desde la tabla «costos» del resultado. */
export function modelFromResult(result: ModuleResult): TransportModel | null {
  const table = result.tables?.find((t) => t.name === "costos");
  if (!table || table.rows.length < 2) return null;
  const dests = table.columns.slice(1, -1);
  const body = table.rows.slice(0, -1);
  const demandRow = table.rows[table.rows.length - 1];
  const sources = body.map((row) => String(row[0]));
  return {
    sources,
    dests,
    costs: body.map((row) => row.slice(1, dests.length + 1) as Num[]),
    supply: body.map((row) => Number(row[dests.length + 1]) || 0),
    demand: dests.map((_, c) => Number(demandRow[c + 1]) || 0),
    dummyRow: sources.some(isDummySource),
    dummyCol: dests.some(isDummyDest),
  };
}

type RawStep = { title: string; method: string; meta?: Record<string, unknown> };

export function stepMetas(result: ModuleResult): { title: string; method: string; meta: TransportStepMeta }[] {
  return ((result.iterations ?? []) as RawStep[])
    .filter((s) => s.meta && Array.isArray(s.meta.alloc))
    .map((s) => ({ title: s.title, method: s.method, meta: s.meta as unknown as TransportStepMeta }));
}

export type TransportSensitivityData = {
  reduced_costs?: Record<string, Num>[];
  shadow_prices?: Record<string, Num>[];
};

/** Último paso con multiplicadores: la solución final con uᵢ, vⱼ y costos reducidos. */
export function finalMeta(result: ModuleResult): TransportStepMeta | null {
  const steps = stepMetas(result);
  for (let k = steps.length - 1; k >= 0; k--) {
    if (steps[k].meta.u) return steps[k].meta;
  }
  return steps.length ? steps[steps.length - 1].meta : null;
}

export function fmt(value: Num | undefined, digits = 2): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value.replace(/-/g, "−");
  if (!Number.isFinite(value)) return "—";
  const v = Math.abs(value) < 1e-9 ? 0 : value;
  return v.toLocaleString("es-MX", { maximumFractionDigits: digits }).replace("-", "−");
}

/** Texto del backend con flechas y signos tipográficos. */
export function pretty(text: string): string {
  return text
    .replace(/ -> /g, " → ")
    .replace(/->/g, "→")
    .replace(/theta/g, "θ")
    .replace(/ - /g, " − ")
    .replace(/\(-(\d)/g, "(−$1")
    .replace(/ -(\d)/g, " −$1")
    .replace(/m \+ n − 1/g, "m + n − 1");
}

export function routeText(from: string, to: string): string {
  return `${from} → ${to}`;
}

export function numeric(value: Num | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
