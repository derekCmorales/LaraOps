import { SolverError } from "../../errors";
import { LIMITS, assertLimit } from "../../limits";
import type { GraphNetwork, IterationStep, ModuleResult, NamedTable } from "../../schema";
import { okResult } from "../../schema";
import { networkSimplex, type FlowArc } from "./networkSimplex";

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
  distance_matrix?: (number | null)[][] | null;
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
      ? (o.distance_matrix as unknown[]).map((row) =>
          Array.isArray(row)
            ? row.map((cell) => (cell == null || cell === "" ? null : Number(cell)))
            : [],
        )
      : null,
    tsp_method: o.tsp_method === "heuristic" || o.tsp_method === "exact" ? o.tsp_method : null,
  };
}

export function solve(body: unknown): ModuleResult {
  const req = parseNetworksRequest(body);
  assertNodeNames(req.nodes);
  if (req.problem === "shortest_path") return shortest(req);
  if (req.problem === "mst") return mst(req);
  if (req.problem === "max_flow") return maxFlow(req);
  if (req.problem === "transshipment") return transshipment(req);
  return tsp(req);
}

function assertNodeNames(nodes: string[]) {
  if (!nodes.length) throw new SolverError("agrega al menos un nodo");
  if (nodes.some((n) => !n.trim())) throw new SolverError("hay un nodo sin nombre");
  if (new Set(nodes).size !== nodes.length) throw new SolverError("hay nombres de nodo repetidos");
}

function assertEdgesKnown(req: NetworksRequest) {
  for (const e of req.edges) {
    if (!req.nodes.includes(e.source) || !req.nodes.includes(e.target)) {
      throw new SolverError(`el arco ${e.source} → ${e.target} usa un nodo que no está en la lista`);
    }
  }
}

function arcKey(u: string, v: string): string {
  return `${u}\u0000${v}`;
}

function shortest(req: NetworksRequest): ModuleResult {
  if (!req.source || !req.sink) throw new SolverError("origen y destino son obligatorios para ruta más corta");
  if (!req.nodes.includes(req.source) || !req.nodes.includes(req.sink)) {
    throw new SolverError("origen y destino deben estar en la lista de nodos");
  }
  if (!req.edges.length) throw new SolverError("las aristas son obligatorias para ruta más corta");
  assertEdgesKnown(req);
  const { dist, prev, steps } = shortestPaths(req.nodes, req.edges, req.source, req.directed, req.sink);
  if (!(req.sink in dist) || dist[req.sink] === Infinity) {
    throw new SolverError(`No hay ruta de ${req.source} a ${req.sink}`);
  }
  const path: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = req.sink;
  while (cur) {
    if (seen.has(cur)) throw new SolverError("no se pudo reconstruir la ruta");
    seen.add(cur);
    path.push(cur);
    cur = prev[cur] ?? null;
  }
  path.reverse();
  const length = dist[req.sink];
  const edgeSet = new Set(path.slice(0, -1).map((u, i) => arcKey(u, path[i + 1])));
  const graph: GraphNetwork = {
    type: "network",
    directed: req.directed,
    nodes: req.nodes.map((n) => ({ id: n, critical: path.includes(n) })),
    edges: req.edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      critical: edgeSet.has(arcKey(e.source, e.target)) || (!req.directed && edgeSet.has(arcKey(e.target, e.source))),
    })),
    title: "Ruta más corta",
    subtitle: `Longitud = ${formatMetric(length)} · magenta = nodos y arcos de la ruta`,
  };
  const pathTo = (n: string): string => {
    const out: string[] = [];
    const guard = new Set<string>();
    let c: string | undefined = n;
    while (c && !guard.has(c)) {
      guard.add(c);
      out.push(c);
      c = prev[c];
    }
    return out.reverse().join(" → ");
  };
  const distRows = req.nodes.map((n) => [
    n,
    Number.isFinite(dist[n]) ? dist[n] : "sin ruta",
    prev[n] ?? (n === req.source ? "—" : "—"),
    Number.isFinite(dist[n]) ? pathTo(n) : "—",
  ]);
  const alternatives = allShortestPaths(req, dist, req.source, req.sink, 6);
  const warnings: string[] = [];
  if (alternatives.length > 1) {
    warnings.push(
      `Hay más de una ruta más corta (todas miden ${formatMetric(length)}): ${alternatives.map((p) => p.join(" → ")).join("; ")}.`,
    );
  }
  return ok({
    variables: {},
    metrics: { path_length: length },
    warnings,
    tables: [
      { name: "ruta", columns: ["orden", "nodo"], rows: path.map((n, i) => [i, n]) },
      { name: "distancias", columns: ["nodo", "distancia_minima", "llega_desde", "ruta_desde_origen"], rows: distRows },
    ],
    graph,
    iterations: steps,
  });
}

/** Todas las rutas de longitud mínima (arcos con dist[u] + w = dist[v]), hasta `limit`. */
function allShortestPaths(
  req: NetworksRequest,
  dist: Record<string, number>,
  source: string,
  sink: string,
  limit: number,
): string[][] {
  const arcs = arcsOf(req.edges, req.directed).filter(
    (a) => Number.isFinite(dist[a.u]) && Math.abs(dist[a.u] + a.w - dist[a.v]) <= 1e-9 && a.w > 0,
  );
  const into = new Map<string, string[]>();
  for (const a of arcs) {
    if (!into.has(a.v)) into.set(a.v, []);
    if (!into.get(a.v)!.includes(a.u)) into.get(a.v)!.push(a.u);
  }
  const out: string[][] = [];
  const walk = (node: string, tail: string[]) => {
    if (out.length >= limit) return;
    if (node === source) {
      out.push([source, ...tail]);
      return;
    }
    for (const p of [...(into.get(node) ?? [])].sort()) {
      if (tail.includes(p)) continue;
      walk(p, [node, ...tail]);
    }
  };
  walk(sink, []);
  return out;
}

function arcsOf(edges: NetworkEdge[], directed: boolean): { u: string; v: string; w: number }[] {
  const arcs: { u: string; v: string; w: number }[] = [];
  for (const e of edges) {
    if (e.source === e.target) continue;
    arcs.push({ u: e.source, v: e.target, w: e.weight });
    if (!directed) arcs.push({ u: e.target, v: e.source, w: e.weight });
  }
  return arcs;
}

function shortestPaths(
  nodes: string[],
  edges: NetworkEdge[],
  source: string,
  directed: boolean,
  sink: string,
): { dist: Record<string, number>; prev: Record<string, string | undefined>; steps: IterationStep[] } {
  const arcs = arcsOf(edges, directed);
  if (arcs.some((a) => a.w < 0)) return { ...bellmanFord(nodes, arcs, source, sink), steps: [] };
  return dijkstra(nodes, arcs, source);
}

/**
 * Algoritmo de la ruta más corta (Dijkstra) con la tabla del libro: en cada iteración se
 * elige el n-ésimo nodo más cercano entre los conectados a los ya resueltos.
 */
function dijkstra(
  nodes: string[],
  arcs: { u: string; v: string; w: number }[],
  source: string,
): { dist: Record<string, number>; prev: Record<string, string | undefined>; steps: IterationStep[] } {
  const adj = new Map<string, { to: string; w: number }[]>();
  for (const n of nodes) adj.set(n, []);
  for (const a of arcs) adj.get(a.u)?.push({ to: a.v, w: a.w });
  const dist: Record<string, number> = Object.fromEntries(nodes.map((n) => [n, Infinity]));
  const prev: Record<string, string | undefined> = {};
  dist[source] = 0;
  const solved: string[] = [source];
  const solvedSet = new Set(solved);
  const steps: IterationStep[] = [];
  const header = ["Nodo resuelto", "Nodo no resuelto más cercano", "Distancia total", "¿Mínima?"];
  for (let n = 1; n < nodes.length; n++) {
    const cands: { from: string; to: string; total: number }[] = [];
    let best: { node: string; from: string; total: number } | null = null;
    for (const r of solved) {
      let nearest: { to: string; w: number } | null = null;
      for (const e of adj.get(r) ?? []) {
        if (solvedSet.has(e.to)) continue;
        if (!nearest || e.w < nearest.w || (e.w === nearest.w && e.to < nearest.to)) nearest = e;
      }
      if (!nearest) continue;
      const total = dist[r] + nearest.w;
      cands.push({ from: r, to: nearest.to, total });
      if (!best || total < best.total - 1e-12) best = { node: nearest.to, from: r, total };
    }
    if (!best) break;
    const chosen = best;
    const rows: (string | number)[][] = cands.map((c) => [
      c.from,
      c.to,
      `${formatMetric(dist[c.from])} + ${formatMetric(c.total - dist[c.from])} = ${formatMetric(c.total)}`,
      Math.abs(c.total - chosen.total) < 1e-9 ? "sí" : "",
    ]);
    dist[best.node] = best.total;
    prev[best.node] = best.from;
    solved.push(best.node);
    solvedSet.add(best.node);
    steps.push({
      index: n,
      method: "dijkstra",
      title: `${n}.º nodo más cercano: ${best.node} (distancia ${formatMetric(best.total)}, llega desde ${best.from})`,
      tableau: [header, ...rows],
      meta: {
        nodo: best.node,
        distancia: best.total,
        ultima_conexion: `${best.from} → ${best.node}`,
        resueltos: solved.join(", "),
      },
    });
  }
  return { dist, prev, steps };
}

function bellmanFord(
  nodes: string[],
  arcs: { u: string; v: string; w: number }[],
  source: string,
  sink: string,
): { dist: Record<string, number>; prev: Record<string, string | undefined> } {
  const dist: Record<string, number> = Object.fromEntries(nodes.map((n) => [n, Infinity]));
  const prev: Record<string, string | undefined> = {};
  dist[source] = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    let changed = false;
    for (const { u, v, w } of arcs) {
      if (dist[u] !== Infinity && dist[u] + w < dist[v]) {
        dist[v] = dist[u] + w;
        prev[v] = u;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const affected = new Set<string>();
  for (const { u, v, w } of arcs) {
    if (dist[u] !== Infinity && dist[u] + w < dist[v] - 1e-9) affected.add(v);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const { u, v } of arcs) {
      if (affected.has(u) && !affected.has(v)) {
        affected.add(v);
        grew = true;
      }
    }
  }
  if (affected.has(sink)) {
    throw new SolverError("hay un ciclo de peso negativo que alcanza el destino; la ruta más corta no está definida");
  }
  return { dist, prev };
}

function undirectedKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function mst(req: NetworksRequest): ModuleResult {
  if (req.nodes.length < 2) throw new SolverError("el árbol de expansión necesita al menos dos nodos");
  if (!req.edges.length) throw new SolverError("las aristas son obligatorias para el árbol mínimo");
  assertEdgesKnown(req);
  const best = new Map<string, { u: string; v: string; w: number }>();
  for (const e of req.edges) {
    if (e.source === e.target) continue;
    const key = undirectedKey(e.source, e.target);
    const prev = best.get(key);
    if (!prev || e.weight < prev.w) best.set(key, { u: e.source, v: e.target, w: e.weight });
  }
  const undirected = [...best.values()].sort((a, b) => a.w - b.w || a.u.localeCompare(b.u) || a.v.localeCompare(b.v));
  const parent: Record<string, string> = {};
  for (const n of req.nodes) parent[n] = n;
  const find = (x: string): string => {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  };
  const tree: { u: string; v: string; w: number }[] = [];
  const iterations: IterationStep[] = [];
  let step = 0;
  for (const e of undirected) {
    const a = find(e.u);
    const b = find(e.v);
    step += 1;
    if (a !== b) {
      parent[a] = b;
      tree.push(e);
      iterations.push({
        index: step,
        method: "kruskal",
        title: `Acepta ${e.u}–${e.v} con peso ${formatMetric(e.w)}`,
        tableau: null,
        meta: {
          arista: `${e.u}–${e.v}`,
          decision: "aceptada",
          peso: e.w,
          peso_acumulado: tree.reduce((s, x) => s + x.w, 0),
        },
      });
    } else {
      iterations.push({
        index: step,
        method: "kruskal",
        title: `Rechaza ${e.u}–${e.v}: formaría un ciclo`,
        tableau: null,
        meta: {
          arista: `${e.u}–${e.v}`,
          decision: "rechazada",
          peso: e.w,
          peso_acumulado: tree.reduce((s, x) => s + x.w, 0),
        },
      });
    }
  }
  if (tree.length !== req.nodes.length - 1) {
    throw new SolverError("el grafo no es conexo: no existe un árbol de expansión que una todos los nodos");
  }
  const total = tree.reduce((s, e) => s + e.w, 0);
  const mstEdges = new Set(tree.map((e) => undirectedKey(e.u, e.v)));
  const graph: GraphNetwork = {
    type: "network",
    directed: false,
    nodes: req.nodes.map((n) => ({ id: n })),
    edges: undirected.map((e) => ({
      source: e.u,
      target: e.v,
      weight: e.w,
      critical: mstEdges.has(undirectedKey(e.u, e.v)),
    })),
    title: "Árbol de expansión mínima",
    subtitle: `Peso = ${formatMetric(total)} · magenta = aristas del árbol (Kruskal)`,
  };
  return ok({
    variables: Object.fromEntries(tree.map((e) => [`${e.u}-${e.v}`, e.w])),
    metrics: { mst_weight: total },
    tables: [{ name: "aristas_mst", columns: ["origen", "destino", "peso"], rows: tree.map((e) => [e.u, e.v, e.w]) }],
    graph,
    iterations,
  });
}

function formatMetric(n: number): string {
  return n.toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

function maxFlow(req: NetworksRequest): ModuleResult {
  if (!req.source || !req.sink) throw new SolverError("origen y destino son obligatorios para flujo máximo");
  if (req.source === req.sink) throw new SolverError("origen y destino deben ser distintos");
  if (!req.edges.length) throw new SolverError("las aristas son obligatorias para flujo máximo");
  if (!req.nodes.includes(req.source) || !req.nodes.includes(req.sink)) {
    throw new SolverError("origen y destino deben estar en la lista de nodos");
  }
  assertEdgesKnown(req);
  const capacities = new Map<string, number>();
  const arcs: { u: string; v: string; cap: number }[] = [];
  for (const e of req.edges) {
    if (e.source === e.target) continue;
    const cap = e.capacity ?? e.weight;
    if (!(cap >= 0)) throw new SolverError(`La capacidad de ${e.source} → ${e.target} debe ser un número mayor o igual que 0.`);
    const key = arcKey(e.source, e.target);
    capacities.set(key, (capacities.get(key) ?? 0) + cap);
    // En una red no dirigida cada arista puede usarse en cualquier sentido.
    if (!req.directed) {
      const back = arcKey(e.target, e.source);
      capacities.set(back, (capacities.get(back) ?? 0) + cap);
    }
  }
  for (const [key, cap] of capacities) {
    const [u, v] = key.split("\u0000");
    arcs.push({ u, v, cap });
  }
  const residual = new Map<string, Map<string, number>>();
  const addRes = (u: string, v: string, cap: number) => {
    if (!residual.has(u)) residual.set(u, new Map());
    residual.get(u)!.set(v, (residual.get(u)!.get(v) ?? 0) + cap);
  };
  for (const { u, v, cap } of arcs) {
    addRes(u, v, cap);
    if (!residual.has(v)) residual.set(v, new Map());
    if (!residual.get(v)!.has(u)) residual.get(v)!.set(u, residual.get(v)!.get(u) ?? 0);
  }

  const iterations: IterationStep[] = [];
  let totalFlow = 0;
  let step = 0;
  while (true) {
    const parent: Record<string, string | null> = { [req.source]: null };
    const queue: string[] = [req.source];
    let found = req.source === req.sink;
    while (queue.length && !found) {
      const u: string = queue.shift()!;
      for (const [v, cap] of residual.get(u) ?? new Map<string, number>()) {
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
    let v: string = req.sink;
    let bottleneck = Infinity;
    while (v !== req.source) {
      const u = parent[v];
      if (u == null) {
        bottleneck = 0;
        break;
      }
      bottleneck = Math.min(bottleneck, residual.get(u)?.get(v) ?? 0);
      path.push(v);
      v = u;
    }
    if (!Number.isFinite(bottleneck) || bottleneck <= 1e-9) break;
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
  for (const { u, v, cap } of arcs) {
    if (reachable.has(u) && !reachable.has(v)) {
      cutRows.push([u, v, cap]);
      cutValue += cap;
    }
  }
  const rows: unknown[][] = [];
  const variables: Record<string, number> = {};
  for (const { u, v, cap } of arcs) {
    const remaining = residual.get(u)?.get(v) ?? cap;
    const flow = cap - remaining;
    if (flow > 1e-9) {
      rows.push([u, v, flow]);
      variables[`${u}->${v}`] = flow;
    }
  }
  const flowOf = (u: string, v: string) => {
    const cap = capacities.get(arcKey(u, v));
    if (cap == null) return 0;
    return Math.max(0, cap - (residual.get(u)?.get(v) ?? cap));
  };
  const graph: GraphNetwork = {
    type: "network",
    directed: req.directed,
    nodes: req.nodes.map((n) => ({ id: n, critical: reachable.has(n) })),
    edges: req.edges
      .filter((e) => e.source !== e.target)
      .map((e) => ({
        source: e.source,
        target: e.target,
        capacity: e.capacity ?? e.weight,
        flow: flowOf(e.source, e.target),
        min_cut: reachable.has(e.source) && !reachable.has(e.target),
      })),
    title: "Flujo máximo",
    subtitle: `Flujo = ${formatMetric(totalFlow)} · corte mínimo = ${formatMetric(cutValue)}`,
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
    throw new SolverError("Indica la oferta (+), la demanda (−) o 0 (transbordo) de cada nodo.");
  }
  if (!req.edges.length) throw new SolverError("Agrega al menos un arco con su costo.");
  assertEdgesKnown(req);
  for (const n of Object.keys(req.node_supply)) {
    if (!req.nodes.includes(n)) throw new SolverError(`La oferta/demanda menciona el nodo «${n}», que no está en la lista.`);
  }
  const supply: Record<string, number> = Object.fromEntries(req.nodes.map((n) => [n, req.node_supply![n] ?? 0]));
  const totalSupply = Object.values(supply).filter((b) => b > 0).reduce((a, b) => a + b, 0);
  const totalDemand = -Object.values(supply).filter((b) => b < 0).reduce((a, b) => a + b, 0);
  const excess = totalSupply - totalDemand;
  const warnings: string[] = [];
  if (excess < -1e-9) {
    throw new SolverError(
      `La demanda total (${formatMetric(totalDemand)}) es mayor que la oferta total (${formatMetric(totalSupply)}): no se puede atender a todos. Agrega oferta o un origen ficticio.`,
    );
  }
  const arcs: FlowArc[] = [];
  req.edges.forEach((e) => {
    if (!Number.isFinite(e.weight)) throw new SolverError(`El costo de ${e.source} → ${e.target} no es un número.`);
    if (e.capacity != null && !(e.capacity >= 0)) {
      throw new SolverError(`La capacidad de ${e.source} → ${e.target} debe ser mayor o igual que 0.`);
    }
    arcs.push({ from: e.source, to: e.target, cost: e.weight, cap: e.capacity });
    if (!req.directed) arcs.push({ from: e.target, to: e.source, cost: e.weight, cap: e.capacity });
  });
  const nodes = [...req.nodes];
  const DUMMY = "Ficticio";
  if (excess > 1e-9) {
    nodes.push(DUMMY);
    supply[DUMMY] = -excess;
    for (const n of req.nodes) {
      if (supply[n] > 0) arcs.push({ from: n, to: DUMMY, cost: 0, cap: null, label: `${n}→${DUMMY}` });
    }
    warnings.push(
      `La oferta supera a la demanda en ${formatMetric(excess)}: se agregó un destino ficticio con costo 0 que recibe lo que no se envía.`,
    );
  }
  const res = networkSimplex(nodes, arcs, supply, true);
  warnings.push(...res.warnings);
  if (res.status !== "optimal") {
    return okResult("networks", {
      status: res.status,
      objective_sense: "min",
      iterations: res.iterations.length ? res.iterations : null,
      warnings,
    });
  }
  const realCount = arcs.length - (excess > 1e-9 ? req.nodes.filter((n) => supply[n] > 0).length : 0);
  const rows: unknown[][] = [];
  const variables: Record<string, number> = {};
  const flowByKey = new Map<string, number>();
  for (let i = 0; i < realCount; i++) {
    const a = arcs[i];
    const f = res.flows[i];
    if (f > 1e-9) {
      rows.push([a.from, a.to, f, a.cost, f * a.cost]);
      variables[`${a.from}->${a.to}`] = f;
      flowByKey.set(arcKey(a.from, a.to), (flowByKey.get(arcKey(a.from, a.to)) ?? 0) + f);
    }
  }
  const unsent: unknown[][] = [];
  for (let i = realCount; i < arcs.length; i++) {
    if (res.flows[i] > 1e-9) unsent.push([arcs[i].from, res.flows[i]]);
  }
  const balanceRows = req.nodes.map((n) => {
    let inflow = 0;
    let outflow = 0;
    for (let i = 0; i < realCount; i++) {
      if (arcs[i].to === n) inflow += res.flows[i];
      if (arcs[i].from === n) outflow += res.flows[i];
    }
    const b = req.node_supply![n] ?? 0;
    return [n, b > 0 ? "oferta" : b < 0 ? "demanda" : "transbordo", b, inflow, outflow];
  });
  const totalCost = res.cost;
  const graph: GraphNetwork = {
    type: "network",
    directed: true,
    nodes: req.nodes.map((n) => ({ id: n, supply_demand: req.node_supply![n] ?? 0 })),
    edges: req.edges.map((e) => ({
      source: e.source,
      target: e.target,
      cost: e.weight,
      capacity: e.capacity,
      flow: flowByKey.get(arcKey(e.source, e.target)) ?? 0,
    })),
    title: "Flujo de costo mínimo (transbordo)",
    subtitle: `Costo = ${formatMetric(totalCost)} · cian = arcos con flujo`,
  };
  const tables: NamedTable[] = [
    { name: "flows", columns: ["origen", "destino", "flujo", "costo_unitario", "costo"], rows },
    { name: "balance_nodos", columns: ["nodo", "tipo", "oferta_demanda", "entra", "sale"], rows: balanceRows },
  ];
  if (unsent.length) tables.push({ name: "oferta_sin_enviar", columns: ["origen", "cantidad"], rows: unsent });
  return ok({
    variables,
    metrics: { total_cost: totalCost, network_simplex_iterations: Math.max(0, res.iterations.length - 1) },
    tables,
    graph,
    iterations: res.iterations,
    warnings,
  });
}

function tsp(req: NetworksRequest): ModuleResult {
  if (!req.distance_matrix) throw new SolverError("la matriz de distancias es obligatoria para TSP");
  const n = req.distance_matrix.length;
  if (n < 2 || req.distance_matrix.some((row) => row.length !== n)) {
    throw new SolverError("la matriz de distancias debe ser cuadrada n × n con n ≥ 2");
  }
  const labels = req.nodes.length === n ? req.nodes : Array.from({ length: n }, (_, i) => `N${i}`);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cell = req.distance_matrix[i][j];
      if (i !== j && (cell == null || !Number.isFinite(cell))) {
        throw new SolverError(`falta la distancia entre ${labels[i]} y ${labels[j]}`);
      }
    }
  }
  const D = req.distance_matrix.map((row) => row.map((cell) => (cell == null ? 0 : cell)));
  const warnings: string[] = [];
  let method = req.tsp_method ?? (n <= LIMITS.tspExactMax ? "exact" : "heuristic");
  if (method === "exact" && n > LIMITS.tspExactMax) {
    warnings.push(`El TSP exacto está limitado a ≤${LIMITS.tspExactMax} nodos (tiene ${n}); se usa heurística.`);
    method = "heuristic";
  }
  if (method === "heuristic") {
    assertLimit(n <= LIMITS.tspHeuristicMax, `TSP heurístico limitado a ${LIMITS.tspHeuristicMax} nodos`);
  }
  const asymmetric = D.some((row, i) => row.some((value, j) => value !== D[j][i]));
  const { tourIdx, total } = method === "exact" ? tspExact(D) : tspHeuristic(D);
  const tour = tourIdx.map((i) => labels[i]);
  const graph: GraphNetwork = {
    type: "network",
    directed: asymmetric,
    nodes: labels.map((id) => ({ id })),
    edges: tourIdx.slice(0, -1).map((idx, i) => ({
      source: labels[idx],
      target: labels[tourIdx[i + 1]],
      weight: D[idx][tourIdx[i + 1]],
      critical: true,
    })),
    title: "Agente viajante",
    subtitle: `Longitud = ${formatMetric(total)} · ${method === "exact" ? "óptimo exacto" : "heurística (vecino más cercano + 2-opt)"}`,
  };
  return ok({
    variables: {},
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
