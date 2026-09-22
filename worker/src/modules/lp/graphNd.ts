import type { GraphXY } from "../../schema";
import { build2dGraph } from "./graph2d";
import { build3dGraph } from "./graph3d";
import type { LPConstraint, LPRequest } from "./types";
import { collectVarNames } from "./types";

const EPS = 1e-9;

export function buildLpGraph(
  req: LPRequest,
  xStar: Record<string, number>,
  zStar: number,
): { graph: GraphXY | null; warnings: string[] } {
  const names = collectVarNames(req);
  const warnings: string[] = [];
  if (names.length < 2) return { graph: null, warnings };
  const picked = freeNames(req, names);
  warnings.push(...picked.warnings);
  if (picked.free.length < 2) return { graph: null, warnings };
  const sameSet = picked.free.length === names.length && names.every((name) => picked.free.includes(name));
  if (sameSet && picked.free.length === 2) return { graph: build2dGraph(req, xStar, zStar), warnings };

  const reduced = reduce(req, names, xStar, picked.free);
  const zFree = zStar - reduced.zOffset;
  let graph: GraphXY | null;
  if (picked.free.length === 2) graph = build2dGraph(reduced.req, xStar, zFree, reduced.zOffset);
  else {
    graph = build3dGraph(reduced.req, xStar, zFree, reduced.zOffset, sameSet ? null : reduced.fixed);
    if (!graph && !sameSet) {
      warnings.push("No se pudo construir el poliedro 3D. Elige otras tres variables o un corte de dos.");
    }
  }
  if (!graph) return { graph: null, warnings };
  if (!sameSet && picked.free.length === 2) {
    const held = Object.entries(reduced.fixed)
      .map(([name, value]) => `${name} = ${fmtNum(value)}`)
      .join(", ");
    graph = {
      ...graph,
      title: "Corte por el óptimo",
      subtitle: `${graph.subtitle ?? ""}. Fijas en el óptimo: ${held}`,
    };
  }
  return { graph, warnings };
}

function freeNames(req: LPRequest, names: string[]): { free: string[]; warnings: string[] } {
  const requested = dedupe(req.graph_variables ?? []);
  if (!requested.length) {
    return { free: names.length <= 3 ? [...names] : names.slice(0, 3), warnings: [] };
  }
  const known = requested.filter((name) => names.includes(name));
  const unknown = requested.filter((name) => !names.includes(name));
  const warnings = unknown.length
    ? [`Variables de gráfico ignoradas porque no están en el modelo: ${unknown.join(", ")}`]
    : [];
  if (known.length >= 2) return { free: known.slice(0, 3), warnings };
  return { free: names.length <= 3 ? [...names] : names.slice(0, 3), warnings };
}

function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function reduce(req: LPRequest, names: string[], xStar: Record<string, number>, free: string[]) {
  const fixed: Record<string, number> = {};
  for (const name of names) {
    if (!free.includes(name)) fixed[name] = xStar[name] ?? 0;
  }
  const zOffset = Object.entries(fixed).reduce((sum, [name, value]) => sum + (req.objective[name] ?? 0) * value, 0);
  const constraints: LPConstraint[] = [];
  for (const c of req.constraints) {
    const shift = Object.entries(fixed).reduce((sum, [name, value]) => sum + (c.coeffs[name] ?? 0) * value, 0);
    const coeffs: Record<string, number> = {};
    for (const name of free) coeffs[name] = c.coeffs[name] ?? 0;
    if (free.every((name) => Math.abs(coeffs[name]) < EPS)) continue;
    constraints.push({ id: c.id, coeffs, sense: c.sense, rhs: clean(c.rhs - shift) });
  }
  const bounds = req.bounds
    ? Object.fromEntries(free.filter((name) => name in req.bounds!).map((name) => [name, req.bounds![name]]))
    : null;
  const next: LPRequest = {
    sense: req.sense,
    objective: Object.fromEntries(free.map((name) => [name, req.objective[name] ?? 0])),
    constraints,
    variable_names: [...free],
    bounds,
    include_iterations: false,
    include_sensitivity: false,
    include_graph: true,
  };
  return { req: next, zOffset, fixed };
}

function fmtNum(value: number): string {
  if (Math.abs(value - Math.round(value)) < 1e-8) return String(Math.round(value));
  return value.toPrecision(4).replace(/\.?0+$/, "");
}

function clean(value: number): number {
  const rounded = Number(value.toFixed(10));
  return Math.abs(rounded) < 1e-12 ? 0 : rounded;
}
