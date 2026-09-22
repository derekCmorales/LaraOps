import { SolverError } from "../../errors";
import { LIMITS, assertLimit } from "../../limits";
import type { GraphNetwork, IterationStep, ModuleResult, NamedTable } from "../../schema";
import { okResult } from "../../schema";
import { solveLp } from "../lp/solver";
import type { LPConstraint } from "../lp/types";

export type NetworkEdge = {
  source: string;
  target: string;
  weight: number;
  capacity: number | null;
};

export type NetworksRequest = {
  problem: "shortest_path" | "mst" | "max_flow" | "transshipment" | "tsp";
  nodes: string[];
  edges: NetworkEdge[];
  source?: string | null;
  sink?: string | null;
  directed: boolean;
  node_supply?: Record<string, number> | null;
  distance_matrix?: number[][] | null;
  tsp_method?: "exact" | "heuristic" | null;
};

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("payload debe ser un objeto JSON");
  }
  return body as Record<string, unknown>;
}

export function parseNetworksRequest(body: unknown): NetworksRequest {
  const o = asRecord(body);
  const problems = ["shortest_path", "mst", "max_flow", "transshipment", "tsp"] as const;
  if (!problems.includes(o.problem as (typeof problems)[number])) {
    throw new SolverError("problem de redes no soportado");
  }
  const edges = Array.isArray(o.edges)
    ? o.edges.map((e) => {
        const row = asRecord(e);
        return {
          source: String(row.source),
          target: String(row.target),
          weight: row.weight == null ? 1 : Number(row.weight),
          capacity: row.capacity == null ? null : Number(row.capacity),
        };
      })
    : [];
  const nodes = Array.isArray(o.nodes) ? o.nodes.map(String) : [];
  assertLimit(nodes.length <= LIMITS.networkNodes, `Redes limitado a ${LIMITS.networkNodes} nodos en el plan Free`);
  assertLimit(edges.length <= LIMITS.networkEdges, `Redes limitado a ${LIMITS.networkEdges} aristas en el plan Free`);
  let nodeSupply: Record<string, number> | null = null;
  if (o.node_supply && typeof o.node_supply === "object" && !Array.isArray(o.node_supply)) {
    nodeSupply = {};
    for (const [k, v] of Object.entries(o.node_supply as Record<string, unknown>)) nodeSupply[k] = Number(v) || 0;
  }
  return {
    problem: o.problem as NetworksRequest["problem"],
    nodes,
    edges,
    source: o.source == null ? null : String(o.source),
    sink: o.sink == null ? null : String(o.sink),
    directed: o.directed !== false,
    node_supply: nodeSupply,
    distance_matrix: Array.isArray(o.distance_matrix)
      ? (o.distance_matrix as unknown[]).map((row) => (Array.isArray(row) ? row.map(Number) : []))
      : null,
    tsp_method: o.tsp_method === "heuristic" || o.tsp_method === "exact" ? o.tsp_method : null,
  };
}

export function solve(body: unknown): ModuleResult {
  const req = parseNetworksRequest(body);
  if (req.problem === "shortest_path") return shortest(req);
  if (req.problem === "mst") return mst(req);
  if (req.problem === "max_flow") return maxFlow(req);
  if (req.problem === "transshipment") return transshipment(req);
  return tsp(req);
}

function shortest(req: NetworksRequest): ModuleResult {
  if (!req.source || !req.sink) throw new SolverError("origen y destino son obligatorios para ruta más corta");
  if (!req.edges.length) throw new SolverError("las aristas son obligatorias para ruta más corta");
  const { dist, prev } = dijkstra(req.nodes, req.edges, req.source, req.directed);
  if (!(req.sink in dist) || dist[req.sink] === Infinity) {
    throw new SolverError(`No hay ruta de ${req.source} a ${req.sink}`);
  }
  const path: string[] = [];
  let cur: string | null = req.sink;
  while (cur) {
    path.push(cur);
    cur = prev[cur] ?? null;
  }
  path.reverse();
  const length = dist[req.sink];
  const edgeSet = new Set(path.slice(0, -1).map((u, i) => `${u}|${path[i + 1]}`));
  const graph: GraphNetwork = {
    type: "network",
    nodes: req.nodes.map((n) => ({ id: n, critical: path.includes(n) })),
    edges: req.edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      critical: edgeSet.has(`${e.source}|${e.target}`) || (!req.directed && edgeSet.has(`${e.target}|${e.source}`)),
    })),
    title: "Ruta más corta",
    subtitle: `Longitud = ${length.toPrecision(4)} · magenta = nodos/arcos de la ruta`,
  };
  return ok(
    {
      variables: Object.fromEntries(path.map((n, i) => [n, i])),
      metrics: { path_length: length },
      tables: [{ name: "ruta", columns: ["orden", "nodo"], rows: path.map((n, i) => [i, n]) }],
      graph,
      pathLabels: path,
    },
  );
}

function dijkstra(
  nodes: string[],
  edges: NetworkEdge[],
  source: string,
  directed: boolean,
): { dist: Record<string, number>; prev: Record<string, string | undefined> } {
  const adj = new Map<string, { to: string; w: number }[]>();
  for (const n of nodes) adj.set(n, []);
  for (const e of edges) {
    adj.get(e.source)?.push({ to: e.target, w: e.weight });
    if (!directed) adj.get(e.target)?.push({ to: e.source, w: e.weight });
  }
  const dist: Record<string, number> = Object.fromEntries(nodes.map((n) => [n, Infinity]));
  const prev: Record<string, string | undefined> = {};
  dist[source] = 0;
  const used = new Set<string>();
  while (used.size < nodes.length) {
    let u: string | null = null;
    let best = Infinity;
    for (const n of nodes) {
      if (!used.has(n) && dist[n] < best) {
        best = dist[n];
        u = n;
      }
    }
    if (u == null || best === Infinity) break;
    used.add(u);
    for (const { to, w } of adj.get(u) ?? []) {
      if (dist[u] + w < dist[to]) {
        dist[to] = dist[u] + w;
        prev[to] = u;
      }
    }
  }
  return { dist, prev };
}

function mst(req: NetworksRequest): ModuleResult {
  if (!req.edges.length) throw new SolverError("las aristas son obligatorias para el árbol mínimo");
  const undirected = req.edges.map((e) => ({
    u: e.source,
    v: e.target,
    w: e.weight,
  }));
  undirected.sort((a, b) => a.w - b.w);
  const parent: Record<string, string> = {};
  const find = (x: string): string => {
    parent[x] ??= x;
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  };
  const tree: { u: string; v: string; w: number }[] = [];
  for (const e of undirected) {
    const a = find(e.u);
    const b = find(e.v);
    if (a !== b) {
      parent[a] = b;
      tree.push(e);
    }
  }
  const total = tree.reduce((s, e) => s + e.w, 0);
  const mstEdges = new Set(tree.flatMap((e) => [`${e.u}|${e.v}`, `${e.v}|${e.u}`]));
  const graph: GraphNetwork = {
    type: "network",
    nodes: req.nodes.map((n) => ({ id: n, critical: true })),
    edges: req.edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      critical: mstEdges.has(`${e.source}|${e.target}`),
    })),
  };
  return ok({
    variables: Object.fromEntries(tree.map((e) => [`${e.u}-${e.v}`, e.w])),
    metrics: { mst_weight: total },
    tables: [{ name: "aristas_mst", columns: ["origen", "destino", "peso"], rows: tree.map((e) => [e.u, e.v, e.w]) }],
    graph,
  });
}

function maxFlow(req: NetworksRequest): ModuleResult {
  if (!req.source || !req.sink) throw new SolverError("origen y destino son obligatorios para flujo máximo");
  if (!req.edges.length) throw new SolverError("las aristas son obligatorias para flujo máximo");
  if (!req.nodes.includes(req.source) || !req.nodes.includes(req.sink)) {
    throw new SolverError("origen y destino deben estar en la lista de nodos");
  }
  const capacities = new Map<string, number>();
  const ck = (u: string, v: string) => `${u}|${v}`;
  for (const e of req.edges) {
    const cap = e.capacity ?? e.weight;
    capacities.set(ck(e.source, e.target), (capacities.get(ck(e.source, e.target)) ?? 0) + cap);
  }
  const residual = new Map<string, Map<string, number>>();
  const addRes = (u: string, v: string, cap: number) => {
    if (!residual.has(u)) residual.set(u, new Map());
    residual.get(u)!.set(v, (residual.get(u)!.get(v) ?? 0) + cap);
  };
  for (const [key, cap] of capacities) {
    const [u, v] = key.split("|");
    addRes(u, v, cap);
    if (!residual.has(v)) residual.set(v, new Map());
    if (!residual.get(v)!.has(u)) residual.get(v)!.set(u, residual.get(v)!.get(u) ?? 0);
  }

  const iterations: IterationStep[] = [];
  let totalFlow = 0;
  let step = 0;
  while (true) {
    const parent: Record<string, string | null> = { [req.source]: null };
    const queue = [req.source];
    let found = req.source === req.sink;
    while (queue.length && !found) {
      const u = queue.shift()!;
      for (const [v, cap] of residual.get(u) ?? []) {
        if (cap > 1e-9 && !(v in parent)) {
          parent[v] = u;
          if (v === req.sink) {
            found = true;
            break;
          }
          queue.push(v);
        }
      }
    }
    if (!found || !(req.sink in parent)) break;
    const path: string[] = [];
    let v = req.sink;
    let bottleneck = Infinity;
    while (v !== req.source) {
      const u = parent[v]!;
      bottleneck = Math.min(bottleneck, residual.get(u)?.get(v) ?? 0);
      path.push(v);
      v = u;
    }
    path.push(req.source);
    path.reverse();
    v = req.sink;
    while (v !== req.source) {
      const u = parent[v]!;
      residual.get(u)!.set(v, (residual.get(u)!.get(v) ?? 0) - bottleneck);
      residual.get(v)!.set(u, (residual.get(v)!.get(u) ?? 0) + bottleneck);
      v = u;
    }
    totalFlow += bottleneck;
    step++;
    iterations.push({
      index: step,
      method: "edmonds_karp",
      title: `Camino de aumento ${path.join(" -> ")} (cuello de botella = ${bottleneck})`,
      tableau: null,
      meta: { path, bottleneck, cumulative_flow: totalFlow },
    });
  }

  const reachable = new Set([req.source]);
  const q = [req.source];
  while (q.length) {
    const u = q.shift()!;
    for (const [v, cap] of residual.get(u) ?? []) {
      if (cap > 1e-9 && !reachable.has(v)) {
        reachable.add(v);
        q.push(v);
      }
    }
  }
  const cutRows: unknown[][] = [];
  let cutValue = 0;
  for (const [key, cap] of capacities) {
    const [u, v] = key.split("|");
    if (reachable.has(u) && !reachable.has(v)) {
      cutRows.push([u, v, cap]);
      cutValue += cap;
    }
  }
  const rows: unknown[][] = [];
  const variables: Record<string, number> = {};
  for (const [u, targets] of residual) {
    for (const [v, remaining] of targets) {
      if (capacities.has(ck(u, v))) {
        const flow = (capacities.get(ck(u, v)) ?? 0) - remaining;
        if (flow > 1e-9) {
          rows.push([u, v, flow]);
          variables[`${u}->${v}`] = flow;
        }
      }
    }
  }
  const flowOf = (u: string, v: string) => {
    const cap = capacities.get(ck(u, v));
    if (cap == null) return 0;
    return Math.max(0, cap - (residual.get(u)?.get(v) ?? cap));
  };
  const graph: GraphNetwork = {
    type: "network",
    nodes: req.nodes.map((n) => ({ id: n, critical: reachable.has(n) })),
    edges: req.edges.map((e) => ({
      source: e.source,
      target: e.target,
      capacity: e.capacity ?? e.weight,
      flow: flowOf(e.source, e.target),
      min_cut: reachable.has(e.source) && !reachable.has(e.target),
    })),
  };
  return ok({
    variables,
    metrics: { max_flow: totalFlow, min_cut_value: cutValue },
    tables: [
      { name: "flows", columns: ["origen", "destino", "flujo"], rows },
      { name: "min_cut", columns: ["origen", "destino", "capacidad"], rows: cutRows },
    ],
    graph,
    iterations,
  });
}

function transshipment(req: NetworksRequest): ModuleResult {
  if (!req.node_supply) {
    throw new SolverError("node_supply es obligatorio para transbordo (positivo = oferta, negativo = demanda)");
  }
  if (!req.edges.length) throw new SolverError("las aristas son obligatorias para transbordo");
  const supplyKeys = Object.keys(req.node_supply).sort();
  const nodeKeys = [...req.nodes].sort();
  if (supplyKeys.join("|") !== nodeKeys.join("|")) {
    throw new SolverError("las claves de node_supply deben coincidir exactamente con los nodos");
  }
  const total = Object.values(req.node_supply).reduce((a, b) => a + b, 0);
  if (Math.abs(total) > 1e-6) {
    throw new SolverError(`red desbalanceada: oferta/demanda total = ${total}, debe sumar 0`);
  }

  const varNames = req.edges.map((e, i) => `f_${i}`);
  const objective: Record<string, number> = {};
  const constraints: LPConstraint[] = [];
  req.edges.forEach((e, i) => {
    objective[varNames[i]] = e.weight;
    if (e.capacity != null) {
      constraints.push({
        id: `cap_${i}`,
        coeffs: { [varNames[i]]: 1 },
        sense: "<=",
        rhs: e.capacity,
      });
    }
  });
  for (const node of req.nodes) {
    const coeffs: Record<string, number> = {};
    req.edges.forEach((e, i) => {
      if (e.source === node) coeffs[varNames[i]] = (coeffs[varNames[i]] ?? 0) + 1;
      if (e.target === node) coeffs[varNames[i]] = (coeffs[varNames[i]] ?? 0) - 1;
    });
    constraints.push({
      id: `balance_${node}`,
      coeffs,
      sense: "=",
      rhs: req.node_supply![node],
    });
  }
  const lp = solveLp({
    sense: "min",
    objective,
    constraints,
    variable_names: varNames,
    include_iterations: false,
    include_sensitivity: false,
    include_graph: false,
  });
  if (lp.status !== "optimal") {
    throw new SolverError(`el problema de transbordo es ${lp.status}`);
  }
  const rows: unknown[][] = [];
  const variables: Record<string, number> = {};
  req.edges.forEach((e, i) => {
    const f = lp.solution.variables[varNames[i]] ?? 0;
    if (f > 1e-9) {
      rows.push([e.source, e.target, f, e.weight, f * e.weight]);
      variables[`${e.source}->${e.target}`] = f;
    }
  });
  const totalCost = lp.solution.objective_value ?? 0;
  const graph: GraphNetwork = {
    type: "network",
    nodes: req.nodes.map((n) => ({ id: n, supply_demand: req.node_supply![n] })),
    edges: req.edges.map((e, i) => ({
      source: e.source,
      target: e.target,
      cost: e.weight,
      capacity: e.capacity,
      flow: lp.solution.variables[varNames[i]] ?? 0,
    })),
  };
  return ok({
    variables,
    metrics: { total_cost: totalCost },
    tables: [
      { name: "flows", columns: ["origen", "destino", "flujo", "costo_unitario", "costo"], rows },
    ],
    graph,
  });
}

function tsp(req: NetworksRequest): ModuleResult {
  if (!req.distance_matrix) throw new SolverError("la matriz de distancias es obligatoria para TSP");
  const n = req.distance_matrix.length;
  if (n < 2 || req.distance_matrix.some((row) => row.length !== n)) {
    throw new SolverError("la matriz de distancias debe ser cuadrada n × n con n ≥ 2");
  }
  const labels = req.nodes.length === n ? req.nodes : Array.from({ length: n }, (_, i) => `N${i}`);
  const warnings: string[] = [];
  let method = req.tsp_method ?? (n <= LIMITS.tspExactMax ? "exact" : "heuristic");
  if (method === "exact" && n > LIMITS.tspExactMax) {
    warnings.push(`El TSP exacto está limitado a ≤${LIMITS.tspExactMax} nodos (tiene ${n}); se usa heurística.`);
    method = "heuristic";
  }
  if (method === "heuristic") {
    assertLimit(n <= LIMITS.tspHeuristicMax, `TSP heurístico limitado a ${LIMITS.tspHeuristicMax} nodos`);
  }
  const D = req.distance_matrix;
  const { tourIdx, total } = method === "exact" ? tspExact(D) : tspHeuristic(D);
  const tour = tourIdx.map((i) => labels[i]);
  const tourEdges = new Set<string>();
  for (let i = 0; i < tourIdx.length - 1; i++) {
    tourEdges.add(`${tourIdx[i]}|${tourIdx[i + 1]}`);
    tourEdges.add(`${tourIdx[i + 1]}|${tourIdx[i]}`);
  }
  const graph: GraphNetwork = {
    type: "network",
    nodes: labels.map((id) => ({ id })),
    edges: labels.flatMap((_, i) =>
      labels.flatMap((__, j) =>
        i !== j && tourEdges.has(`${i}|${j}`)
          ? [{ source: labels[i], target: labels[j], weight: D[i][j], critical: true }]
          : [],
      ),
    ),
  };
  return ok({
    variables: Object.fromEntries(tourIdx.map((idx, i) => [labels[idx], i])),
    metrics: { tour_length: total },
    tables: [{ name: "recorrido", columns: ["orden", "nodo"], rows: tour.map((n0, i) => [i, n0]) }],
    graph,
    warnings,
  });
}

function tspExact(D: number[][]): { tourIdx: number[]; total: number } {
  const n = D.length;
  if (n === 2) return { tourIdx: [0, 1, 0], total: D[0][1] + D[1][0] };
  const C = new Map<string, [number, number]>();
  const key = (bits: number, k: number) => `${bits}|${k}`;
  for (let k = 1; k < n; k++) C.set(key(1 << k, k), [D[0][k], 0]);
  for (let subsetSize = 2; subsetSize < n; subsetSize++) {
    for (const subset of combinations(range(1, n), subsetSize)) {
      let bits = 0;
      for (const b of subset) bits |= 1 << b;
      for (const k of subset) {
        const prev = bits & ~(1 << k);
        let best = Infinity;
        let bestM = 0;
        for (const m of subset) {
          if (m === k) continue;
          const cand = C.get(key(prev, m))![0] + D[m][k];
          if (cand < best) {
            best = cand;
            bestM = m;
          }
        }
        C.set(key(bits, k), [best, bestM]);
      }
    }
  }
  const bitsFull = (1 << n) - 2;
  let total = Infinity;
  let last = 1;
  for (let k = 1; k < n; k++) {
    const cand = C.get(key(bitsFull, k))![0] + D[k][0];
    if (cand < total) {
      total = cand;
      last = k;
    }
  }
  const seq: number[] = [];
  let bitsR = bitsFull;
  let k = last;
  while (k !== 0) {
    seq.push(k);
    const prevK = C.get(key(bitsR, k))![1];
    bitsR &= ~(1 << k);
    k = prevK;
  }
  return { tourIdx: [0, ...seq.reverse(), 0], total };
}

function tspHeuristic(D: number[][]): { tourIdx: number[]; total: number } {
  const n = D.length;
  const unvisited = new Set(range(1, n));
  const tour = [0];
  let current = 0;
  while (unvisited.size) {
    let nxt = -1;
    let best = Infinity;
    for (const j of unvisited) {
      if (D[current][j] < best) {
        best = D[current][j];
        nxt = j;
      }
    }
    tour.push(nxt);
    unvisited.delete(nxt);
    current = nxt;
  }
  tour.push(0);
  twoOpt(tour, D);
  const total = tour.slice(0, -1).reduce((s, _, i) => s + D[tour[i]][tour[i + 1]], 0);
  return { tourIdx: tour, total };
}

function twoOpt(tour: number[], D: number[][]): void {
  const n = tour.length;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 2; i++) {
      for (let j = i + 1; j < n - 1; j++) {
        const a = tour[i - 1];
        const b = tour[i];
        const c = tour[j];
        const d = tour[j + 1];
        if (D[a][c] + D[b][d] < D[a][b] + D[c][d] - 1e-9) {
          const mid = tour.slice(i, j + 1).reverse();
          tour.splice(i, j + 1 - i, ...mid);
          improved = true;
        }
      }
    }
  }
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, i) => start + i);
}

function combinations(arr: number[], k: number): number[][] {
  const out: number[][] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < arr.length; i++) rec(i + 1, [...acc, arr[i]]);
  };
  rec(0, []);
  return out;
}

function ok(args: {
  variables: Record<string, number>;
  metrics: Record<string, number>;
  tables: NamedTable[];
  graph: GraphNetwork;
  pathLabels?: string[];
  iterations?: IterationStep[];
  warnings?: string[];
}): ModuleResult {
  const variables = args.pathLabels
    ? { ...args.variables, ...Object.fromEntries(args.pathLabels.map((l) => [l, 1])) }
    : args.variables;
  return okResult("networks", {
    status: "ok",
    variables,
    objective_sense: "min",
    metrics: args.metrics,
    iterations: args.iterations ?? null,
    graph: args.graph,
    tables: args.tables,
    warnings: args.warnings ?? [],
  });
}
