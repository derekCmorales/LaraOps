import { SolverError } from "../../errors";
import { LIMITS, assertLimit } from "../../limits";
import type { GraphMatrix, IterationStep, ModuleResult, SensitivityBlock } from "../../schema";
import { emptySensitivity, okResult } from "../../schema";

const BIG_M = 1e9;

export type TransportRequest = {
  supply: Record<string, number>;
  demand: Record<string, number>;
  costs: Record<string, Record<string, number>>;
  method: "northwest" | "vogel" | "least_cost" | "modi_auto";
  objective: "minimize" | "maximize";
  forbidden_routes: [string, string][];
};

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("payload debe ser un objeto JSON");
  }
  return body as Record<string, unknown>;
}

function numMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = Number(val) || 0;
  return out;
}

export function parseTransportRequest(body: unknown): TransportRequest {
  const o = asRecord(body);
  const costsRaw = asRecord(o.costs ?? {});
  const costs: Record<string, Record<string, number>> = {};
  for (const [i, row] of Object.entries(costsRaw)) costs[i] = numMap(row);
  const methods = ["northwest", "vogel", "least_cost", "modi_auto"] as const;
  const method = methods.includes(o.method as (typeof methods)[number])
    ? (o.method as TransportRequest["method"])
    : "modi_auto";
  const forbidden: [string, string][] = [];
  if (Array.isArray(o.forbidden_routes)) {
    for (const pair of o.forbidden_routes) {
      if (Array.isArray(pair) && pair.length >= 2) forbidden.push([String(pair[0]), String(pair[1])]);
    }
  }
  const req: TransportRequest = {
    supply: numMap(o.supply),
    demand: numMap(o.demand),
    costs,
    method,
    objective: o.objective === "maximize" ? "maximize" : "minimize",
    forbidden_routes: forbidden,
  };
  assertLimit(
    Object.keys(req.supply).length <= LIMITS.transportDim && Object.keys(req.demand).length <= LIMITS.transportDim,
    `Transporte limitado a ${LIMITS.transportDim}×${LIMITS.transportDim} en el plan Free`,
  );
  return req;
}

function tableau(
  alloc: Record<string, Record<string, number>>,
  costs: Record<string, Record<string, number>>,
  sources: string[],
  dests: string[],
  supplyRem?: Record<string, number>,
  demandRem?: Record<string, number>,
  u?: Record<string, number | null>,
  v?: Record<string, number | null>,
): (number | string)[][] {
  const header: (number | string)[] = ["", ...dests];
  if (supplyRem) header.push("Oferta");
  const rows: (number | string)[][] = [header];
  for (const i of sources) {
    const row: (number | string)[] = [i];
    for (const j of dests) {
      const a = alloc[i][j];
      const c = costs[i][j];
      row.push(a > 1e-12 ? `${a.toString()} (${c.toString()})` : c);
    }
    if (supplyRem) row.push(supplyRem[i] ?? 0);
    rows.push(row);
  }
  if (demandRem) {
    const dem: (number | string)[] = ["Demanda", ...dests.map((j) => demandRem[j] ?? 0)];
    if (supplyRem) dem.push("");
    rows.push(dem);
  }
  if (u) {
    const urow: (number | string)[] = ["uᵢ", ...sources.map((i) => (u[i] != null ? u[i]! : ""))];
    if (supplyRem) urow.push("");
    rows.push(urow);
  }
  if (v) {
    const vrow: (number | string)[] = ["vⱼ", ...dests.map((j) => (v[j] != null ? v[j]! : ""))];
    if (supplyRem) vrow.push("");
    rows.push(vrow);
  }
  return rows;
}

export function solve(body: unknown): ModuleResult {
  const req = parseTransportRequest(body);
  const supply = { ...req.supply };
  const demand = { ...req.demand };
  const costs: Record<string, Record<string, number>> = {};
  for (const [i, row] of Object.entries(req.costs)) costs[i] = { ...row };
  const warnings: string[] = [];
  const iterations: IterationStep[] = [];

  for (const [src, dst] of req.forbidden_routes) {
    costs[src] ??= {};
    costs[src][dst] = BIG_M;
    warnings.push(`Ruta prohibida ${src}->${dst} (costo M)`);
  }

  if (req.objective === "maximize") {
    for (const i of Object.keys(costs)) {
      for (const j of Object.keys(costs[i])) {
        if (costs[i][j] < BIG_M / 2) costs[i][j] = -costs[i][j];
      }
    }
    warnings.push("Maximización convertida a minimización de costos negados");
  }

  const totalS = Object.values(supply).reduce((a, b) => a + b, 0);
  const totalD = Object.values(demand).reduce((a, b) => a + b, 0);
  if (Math.abs(totalS - totalD) > 1e-9) {
    if (totalS < totalD) {
      const dummy = "_dummy_source";
      supply[dummy] = totalD - totalS;
      costs[dummy] = Object.fromEntries(Object.keys(demand).map((j) => [j, 0]));
      warnings.push(`Se balanceó con origen ficticio ${dummy}`);
    } else {
      const dummy = "_dummy_dest";
      demand[dummy] = totalS - totalD;
      for (const i of Object.keys(costs)) costs[i][dummy] = 0;
      warnings.push(`Se balanceó con destino ficticio ${dummy}`);
    }
  }

  const sources = Object.keys(supply);
  const dests = Object.keys(demand);
  for (const i of sources) {
    costs[i] ??= {};
    for (const j of dests) {
      costs[i][j] ??= req.forbidden_routes.some(([a, b]) => a === i && b === j) ? BIG_M : 0;
    }
  }

  let alloc: Record<string, Record<string, number>>;
  let iters: IterationStep[];
  if (req.method === "northwest") ({ alloc, iters } = northwest(supply, demand, costs, sources, dests));
  else if (req.method === "least_cost") ({ alloc, iters } = leastCost(supply, demand, costs, sources, dests));
  else ({ alloc, iters } = vogel(supply, demand, costs, sources, dests));
  iterations.push(...iters);

  if (req.method === "modi_auto") {
    const improved = modiImprove(alloc, costs, sources, dests);
    alloc = improved.alloc;
    iterations.push(...improved.iters);
  }

  const basics = sources.reduce((n, i) => n + dests.filter((j) => alloc[i][j] > 1e-12).length, 0);
  const needed = sources.length + dests.length - 1;
  if (basics < needed) warnings.push(`Solución degenerada: ${basics} celdas básicas < m+n-1=${needed}`);

  const { sensitivity, alt } = computeSensitivity(alloc, costs, sources, dests);
  if (alt.length) {
    warnings.push(
      `Óptimos múltiples: hay celdas vacías con costo reducido ≈ 0 (${alt.slice(0, 5).join(", ")}${alt.length > 5 ? "…" : ""})`,
    );
  }

  const shipments: Record<string, number> = {};
  for (const i of sources) {
    for (const j of dests) {
      if (alloc[i][j] > 1e-12) shipments[`${i}->${j}`] = alloc[i][j];
    }
  }

  const totalInternal = sources.reduce(
    (s, i) => s + dests.reduce((t, j) => t + alloc[i][j] * costs[i][j], 0),
    0,
  );
  let objectiveValue = totalInternal;
  let sense: "min" | "max" = "min";
  if (req.objective === "maximize") {
    let total = 0;
    for (const i of sources) {
      for (const j of dests) {
        const cOrig = req.costs[i]?.[j];
        if (cOrig == null) continue;
        total += alloc[i][j] * cOrig;
      }
    }
    objectiveValue = total;
    sense = "max";
  }

  const graph: GraphMatrix = {
    type: "matrix",
    row_labels: sources,
    col_labels: dests,
    values: sources.map((i) => dests.map((j) => alloc[i][j])),
    title: "Matriz de envíos (transporte)",
    subtitle: "Cantidad enviada de cada origen a cada destino",
    value_label: "Cantidad enviada",
  };

  return okResult("transport", {
    status: "optimal",
    variables: shipments,
    objective_value: objectiveValue,
    objective_sense: sense,
    metrics: { total_cost: objectiveValue, basic_cells: basics },
    iterations,
    sensitivity,
    graph,
    warnings,
  });
}

function emptyAlloc(sources: string[], dests: string[]): Record<string, Record<string, number>> {
  return Object.fromEntries(sources.map((i) => [i, Object.fromEntries(dests.map((j) => [j, 0]))]));
}

function northwest(
  supply: Record<string, number>,
  demand: Record<string, number>,
  costs: Record<string, Record<string, number>>,
  sources: string[],
  dests: string[],
) {
  const s = { ...supply };
  const d = { ...demand };
  const alloc = emptyAlloc(sources, dests);
  const iterations: IterationStep[] = [];
  let i = 0;
  let j = 0;
  let step = 0;
  while (i < sources.length && j < dests.length) {
    const qty = Math.min(s[sources[i]], d[dests[j]]);
    alloc[sources[i]][dests[j]] = qty;
    s[sources[i]] -= qty;
    d[dests[j]] -= qty;
    iterations.push({
      index: step,
      method: "northwest",
      title: `Esquina noroeste (${sources[i]},${dests[j]})=${qty}`,
      tableau: tableau(alloc, costs, sources, dests, s, d),
      meta: { i: sources[i], j: dests[j], qty },
    });
    step++;
    if (s[sources[i]] < 1e-12) i++;
    if (d[dests[j]] < 1e-12) j++;
  }
  return { alloc, iters: iterations };
}

function leastCost(
  supply: Record<string, number>,
  demand: Record<string, number>,
  costs: Record<string, Record<string, number>>,
  sources: string[],
  dests: string[],
) {
  const s = { ...supply };
  const d = { ...demand };
  const alloc = emptyAlloc(sources, dests);
  const iterations: IterationStep[] = [];
  let step = 0;
  const activeI = new Set(sources);
  const activeJ = new Set(dests);
  while (activeI.size && activeJ.size) {
    let best: [string, string] | null = null;
    let bestC = Infinity;
    for (const i of activeI) {
      for (const j of activeJ) {
        const c = costs[i][j];
        if (c < bestC) {
          bestC = c;
          best = [i, j];
        }
      }
    }
    if (!best) break;
    const [i, j] = best;
    const qty = Math.min(s[i], d[j]);
    alloc[i][j] += qty;
    s[i] -= qty;
    d[j] -= qty;
    iterations.push({
      index: step,
      method: "least_cost",
      title: `Costo mínimo (${i},${j})=${qty} c=${bestC}`,
      tableau: tableau(alloc, costs, sources, dests, s, d),
      meta: { i, j, qty, cost: bestC },
    });
    step++;
    if (s[i] < 1e-12) activeI.delete(i);
    if (d[j] < 1e-12) activeJ.delete(j);
  }
  return { alloc, iters: iterations };
}

function vogel(
  supply: Record<string, number>,
  demand: Record<string, number>,
  costs: Record<string, Record<string, number>>,
  sources: string[],
  dests: string[],
) {
  const s = { ...supply };
  const d = { ...demand };
  const alloc = emptyAlloc(sources, dests);
  const iterations: IterationStep[] = [];
  const activeI = new Set(sources);
  const activeJ = new Set(dests);
  let step = 0;
  while (activeI.size && activeJ.size) {
    const rowPen: Record<string, number> = {};
    for (const i of activeI) {
      const vals = [...activeJ].map((j) => costs[i][j]).sort((a, b) => a - b);
      rowPen[i] = vals.length > 1 ? vals[1] - vals[0] : vals[0];
    }
    const colPen: Record<string, number> = {};
    for (const j of activeJ) {
      const vals = [...activeI].map((i) => costs[i][j]).sort((a, b) => a - b);
      colPen[j] = vals.length > 1 ? vals[1] - vals[0] : vals[0];
    }
    const bestRow = Object.keys(rowPen).reduce((a, b) => (rowPen[a] >= rowPen[b] ? a : b));
    const bestCol = Object.keys(colPen).reduce((a, b) => (colPen[a] >= colPen[b] ? a : b));
    let i: string;
    let j: string;
    if (rowPen[bestRow] >= colPen[bestCol]) {
      i = bestRow;
      j = [...activeJ].reduce((a, b) => (costs[i][a] < costs[i][b] ? a : b));
    } else {
      j = bestCol;
      i = [...activeI].reduce((a, b) => (costs[a][j] < costs[b][j] ? a : b));
    }
    const qty = Math.min(s[i], d[j]);
    alloc[i][j] += qty;
    s[i] -= qty;
    d[j] -= qty;
    iterations.push({
      index: step,
      method: "vogel",
      title: `Vogel (${i},${j})=${qty}`,
      tableau: tableau(alloc, costs, sources, dests, s, d),
      meta: { i, j, qty, row_pen: rowPen, col_pen: colPen },
    });
    step++;
    if (s[i] < 1e-12) activeI.delete(i);
    if (d[j] < 1e-12) activeJ.delete(j);
  }
  return { alloc, iters: iterations };
}

function modiImprove(
  allocIn: Record<string, Record<string, number>>,
  costs: Record<string, Record<string, number>>,
  sources: string[],
  dests: string[],
  maxIters = 50,
) {
  const alloc = structuredClone(allocIn);
  const iterations: IterationStep[] = [];
  for (let t = 0; t < maxIters; t++) {
    const basics: [string, string][] = [];
    for (const i of sources) for (const j of dests) if (alloc[i][j] > 1e-12) basics.push([i, j]);
    const needed = sources.length + dests.length - 1;
    if (basics.length < needed) {
      outer: for (const i of sources) {
        for (const j of dests) {
          if (!basics.some(([a, b]) => a === i && b === j)) {
            alloc[i][j] = 1e-9;
            basics.push([i, j]);
            if (basics.length >= needed) break outer;
          }
        }
      }
    }
    const u: Record<string, number | null> = Object.fromEntries(sources.map((i) => [i, null]));
    const v: Record<string, number | null> = Object.fromEntries(dests.map((j) => [j, null]));
    u[sources[0]] = 0;
    let changed = true;
    let guard = 0;
    while (changed && guard < 100) {
      changed = false;
      guard++;
      for (const [i, j] of basics) {
        if (u[i] != null && v[j] == null) {
          v[j] = costs[i][j] - u[i]!;
          changed = true;
        } else if (v[j] != null && u[i] == null) {
          u[i] = costs[i][j] - v[j]!;
          changed = true;
        }
      }
    }
    if (sources.some((i) => u[i] == null) || dests.some((j) => v[j] == null)) break;
    let best: [string, string] | null = null;
    let bestVal = 0;
    for (const i of sources) {
      for (const j of dests) {
        if (alloc[i][j] > 1e-12) continue;
        const dij = costs[i][j] - u[i]! - v[j]!;
        if (dij < bestVal - 1e-9) {
          bestVal = dij;
          best = [i, j];
        }
      }
    }
    iterations.push({
      index: t,
      method: "modi",
      title: `Ciclo MODI ${t}`,
      tableau: tableau(alloc, costs, sources, dests, undefined, undefined, u, v),
      meta: { u, v, enter: best, delta: bestVal },
    });
    if (!best) {
      for (const i of sources) for (const j of dests) if (alloc[i][j] < 1e-8) alloc[i][j] = 0;
      break;
    }
    const path = findCycle(alloc, sources, dests, best[0], best[1]);
    if (!path.length) break;
    const minus = path.filter((_, idx) => idx % 2 === 1);
    const theta = Math.min(...minus.map(([i, j]) => alloc[i][j]));
    path.forEach(([i, j], idx) => {
      if (idx % 2 === 0) alloc[i][j] += theta;
      else {
        alloc[i][j] -= theta;
        if (alloc[i][j] < 1e-8) alloc[i][j] = 0;
      }
    });
  }
  return { alloc, iters: iterations };
}

function findCycle(
  alloc: Record<string, Record<string, number>>,
  sources: string[],
  dests: string[],
  startI: string,
  startJ: string,
): [string, string][] {
  const basics = new Set<string>();
  for (const i of sources) for (const j of dests) if (alloc[i][j] > 1e-12) basics.add(`${i}|${j}`);
  basics.add(`${startI}|${startJ}`);
  const key = (i: string, j: string) => `${i}|${j}`;
  const inPath = (path: [string, string][], i: string, j: string) =>
    path.slice(1).some(([a, b]) => a === i && b === j);

  const search = (path: [string, string][], horizontal: boolean): [string, string][] | null => {
    const [i, j] = path[path.length - 1];
    if (path.length >= 4 && i === startI && j === startJ) return path.slice(0, -1);
    if (horizontal) {
      for (const jj of dests) {
        if (jj === j) continue;
        if (basics.has(key(i, jj)) && !inPath(path, i, jj)) {
          const res = search([...path, [i, jj]], false);
          if (res) return res;
        }
      }
    } else {
      for (const ii of sources) {
        if (ii === i) continue;
        if (basics.has(key(ii, j)) && !inPath(path, ii, j)) {
          const res = search([...path, [ii, j]], true);
          if (res) return res;
        }
      }
    }
    return null;
  };
  return search([[startI, startJ]], true) ?? [];
}

function computeSensitivity(
  alloc: Record<string, Record<string, number>>,
  costs: Record<string, Record<string, number>>,
  sources: string[],
  dests: string[],
): { sensitivity: SensitivityBlock; alt: string[] } {
  const basics: [string, string][] = [];
  for (const i of sources) for (const j of dests) if (alloc[i][j] > 1e-12) basics.push([i, j]);
  const needed = sources.length + dests.length - 1;
  const work = structuredClone(alloc);
  if (basics.length < needed) {
    outer: for (const i of sources) {
      for (const j of dests) {
        if (work[i][j] <= 1e-12) {
          work[i][j] = 1e-9;
          basics.push([i, j]);
          if (basics.length >= needed) break outer;
        }
      }
    }
  }
  const u: Record<string, number | null> = Object.fromEntries(sources.map((i) => [i, null]));
  const v: Record<string, number | null> = Object.fromEntries(dests.map((j) => [j, null]));
  u[sources[0]] = 0;
  let changed = true;
  let guard = 0;
  while (changed && guard < 200) {
    changed = false;
    guard++;
    for (const [i, j] of basics) {
      if (u[i] != null && v[j] == null) {
        v[j] = costs[i][j] - u[i]!;
        changed = true;
      } else if (v[j] != null && u[i] == null) {
        u[i] = costs[i][j] - v[j]!;
        changed = true;
      }
    }
  }
  const alt: string[] = [];
  if (sources.some((i) => u[i] == null) || dests.some((j) => v[j] == null)) {
    return { sensitivity: emptySensitivity(), alt };
  }
  const reduced: Record<string, unknown>[] = [];
  for (const i of sources) {
    for (const j of dests) {
      const dij = costs[i][j] - u[i]! - v[j]!;
      if (alloc[i][j] <= 1e-12) {
        reduced.push({ variable: `${i}->${j}`, reduced_cost: dij, u_i: u[i], v_j: v[j] });
        if (Math.abs(dij) < 1e-8) alt.push(`${i}->${j}`);
      }
    }
  }
  return { sensitivity: { ...emptySensitivity(), reduced_costs: reduced }, alt };
}
