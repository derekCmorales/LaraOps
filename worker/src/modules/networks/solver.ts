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
    ? o.edges.map((e, i) => {
        const row = asRecord(e);
        if (row.source == null || row.target == null || String(row.source).trim() === "" || String(row.target).trim() === "") {
          throw new SolverError(`el arco ${i + 1} necesita origen y destino`);
        }
        const source = String(row.source);
        const target = String(row.target);
        const weight = row.weight == null || row.weight === "" ? 1 : Number(row.weight);
        if (!Number.isFinite(weight)) throw new SolverError(`El peso o costo de ${source} → ${target} no es un número.`);
        const capacity = row.capacity == null || row.capacity === "" ? null : Number(row.capacity);
        if (capacity != null && !Number.isFinite(capacity)) {
          throw new SolverError(`La capacidad de ${source} → ${target} no es un número.`);
        }
        return { source, target, weight, capacity };
      })
    : [];
  const nodes = Array.isArray(o.nodes) ? o.nodes.map(String) : [];
  assertLimit(nodes.length <= LIMITS.networkNodes, `Redes limitado a ${LIMITS.networkNodes} nodos en el plan Free`);
  assertLimit(edges.length <= LIMITS.networkEdges, `Redes limitado a ${LIMITS.networkEdges} aristas en el plan Free`);
  let nodeSupply: Record<string, number> | null = null;
  if (o.node_supply && typeof o.node_supply === "object" && !Array.isArray(o.node_supply)) {
    nodeSupply = {};
    for (const [k, v] of Object.entries(o.node_supply as Record<string, unknown>)) {
      const value = v == null || v === "" ? 0 : Number(v);
      if (!Number.isFinite(value)) throw new SolverError(`La oferta/demanda del nodo «${k}» no es un número.`);
      nodeSupply[k] = value;
    }
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
  const { dist, prev, steps, snaps } = shortestPaths(req.nodes, req.edges, req.source, req.directed, req.sink);
  const negative = req.edges.some((e) => e.weight < 0);
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
  const graphEdges = req.edges
    .filter((e) => e.source !== e.target)
    .map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      // Solo se resalta el arco que realmente usa la ruta (no uno paralelo más caro).
      critical:
        (edgeSet.has(arcKey(e.source, e.target)) && Math.abs(dist[e.source] + e.weight - dist[e.target]) <= 1e-9) ||
        (!req.directed &&
          edgeSet.has(arcKey(e.target, e.source)) &&
          Math.abs(dist[e.target] + e.weight - dist[e.source]) <= 1e-9),
    }));
  // Cuadro del grafo en cada paso: nodos con distancia conocida y el árbol de rutas hallado hasta ese momento.
  const tightEdge = (u: string, v: string, d: Record<string, number>) =>
    graphEdges.findIndex(
      (e) =>
        ((e.source === u && e.target === v) || (!req.directed && e.source === v && e.target === u)) &&
        Math.abs(d[u] + e.weight - d[v]) <= 1e-9,
    );
  steps.forEach((st, i) => {
    const { dist: d, prev: pv, newest } = snaps[i];
    const on = graphEdges.map(() => false);
    const hot = graphEdges.map(() => false);
    for (const v of req.nodes) {
      const u = pv[v];
      if (u == null) continue;
      const k = tightEdge(u, v, d);
      if (k < 0) continue;
      if (newest.includes(v)) hot[k] = true;
      else on[k] = true;
    }
    st.view = {
      node_tone: req.nodes.map((n) => (newest.includes(n) ? "crit" : Number.isFinite(d[n]) ? "flow" : null)),
      node_sub: req.nodes.map((n) => (Number.isFinite(d[n]) ? (n === req.source ? "origen · 0" : `d = ${formatMetric(d[n])}`) : null)),
      edge_on: on,
      edge_hot: hot,
      subtitle:
        st.method === "dijkstra"
          ? `Nodos resueltos: ${String(st.meta.resueltos)}`
          : `Pasada ${i + 1} de Bellman-Ford · actualizados: ${newest.join(", ")}`,
      legend: [
        { label: st.method === "dijkstra" ? "Nodo recién resuelto" : "Distancia actualizada en esta pasada", tone: "crit" },
        { label: "Nodo con distancia conocida y su mejor arco", tone: "flow" },
        { label: "Aún sin distancia", tone: "idle" },
      ],
    };
  });
  const graph: GraphNetwork = {
    type: "network",
    directed: req.directed,
    nodes: req.nodes.map((n) => ({
      id: n,
      critical: path.includes(n),
      kind: n === req.source ? "origen" : n === req.sink ? "destino" : path.includes(n) ? "en la ruta" : undefined,
    })),
    edges: graphEdges,
    title: "Ruta más corta",
    subtitle: `${path.join(" → ")} · longitud = ${formatMetric(length)}`,
    legend: [
      { label: "Ruta más corta", tone: "crit" },
      { label: "Resto de la red", tone: "idle" },
    ],
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
  if (negative) {
    warnings.push("Hay pesos negativos: se usó Bellman-Ford en lugar de Dijkstra, que exige pesos no negativos.");
  }
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
    (a) => Number.isFinite(dist[a.u]) && Number.isFinite(dist[a.v]) && Math.abs(dist[a.u] + a.w - dist[a.v]) <= 1e-9,
  );
  const into = new Map<string, string[]>();
  for (const a of arcs) {
    if (!into.has(a.v)) into.set(a.v, []);
    if (!into.get(a.v)!.includes(a.u)) into.get(a.v)!.push(a.u);
  }
  const out: string[][] = [];
  let visits = 0;
  const walk = (node: string, tail: string[]) => {
    if (out.length >= limit || ++visits > 20000) return;
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

/** Estado del algoritmo tras cada paso: sirve para dibujar el grafo en esa iteración. */
type ShortestSnap = { dist: Record<string, number>; prev: Record<string, string | undefined>; newest: string[] };
type ShortestResult = {
  dist: Record<string, number>;
  prev: Record<string, string | undefined>;
  steps: IterationStep[];
  snaps: ShortestSnap[];
};

function shortestPaths(
  nodes: string[],
  edges: NetworkEdge[],
  source: string,
  directed: boolean,
  sink: string,
): ShortestResult {
  const arcs = arcsOf(edges, directed);
  if (arcs.some((a) => a.w < 0)) return bellmanFord(nodes, arcs, source, sink);
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
): ShortestResult {
  const adj = new Map<string, { to: string; w: number }[]>();
  for (const n of nodes) adj.set(n, []);
  for (const a of arcs) adj.get(a.u)?.push({ to: a.v, w: a.w });
  const dist: Record<string, number> = Object.fromEntries(nodes.map((n) => [n, Infinity]));
  const prev: Record<string, string | undefined> = {};
  dist[source] = 0;
  const solved: string[] = [source];
  const solvedSet = new Set(solved);
  const steps: IterationStep[] = [];
  const snaps: ShortestSnap[] = [];
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
        regla:
          "Entre los nodos aún no resueltos que están conectados a uno resuelto se elige el de menor distancia total desde el origen: esa distancia ya no puede mejorar.",
      },
    });
    snaps.push({ dist: { ...dist }, prev: { ...prev }, newest: [best.node] });
  }
  return { dist, prev, steps, snaps };
}

function bellmanFord(
  nodes: string[],
  arcs: { u: string; v: string; w: number }[],
  source: string,
  sink: string,
): ShortestResult {
  const dist: Record<string, number> = Object.fromEntries(nodes.map((n) => [n, Infinity]));
  const prev: Record<string, string | undefined> = {};
  dist[source] = 0;
  const steps: IterationStep[] = [];
  const snaps: ShortestSnap[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const updated: string[] = [];
    for (const { u, v, w } of arcs) {
      if (dist[u] !== Infinity && dist[u] + w < dist[v] - 1e-12) {
        dist[v] = dist[u] + w;
        prev[v] = u;
        if (!updated.includes(v)) updated.push(v);
      }
    }
    if (!updated.length) break;
    steps.push({
      index: i + 1,
      method: "bellman_ford",
      title: `Pasada ${i + 1}: se actualizan ${updated.join(", ")}`,
      tableau: [
        ["Nodo", "Distancia", "Llega desde"],
        ...nodes.map((n) => [n, Number.isFinite(dist[n]) ? dist[n] : "∞", prev[n] ?? "—"]),
      ],
      meta: {
        actualizados: updated.join(", "),
        regla: "Se relajan todos los arcos: si pasar por u mejora la distancia de v, se actualiza v.",
      },
    });
    snaps.push({ dist: { ...dist }, prev: { ...prev }, newest: [...updated] });
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
    throw new SolverError(
      "hay un ciclo de peso negativo que alcanza el destino; la ruta más corta no está definida (en una red no dirigida, una arista con peso negativo ya forma ese ciclo)",
    );
  }
  return { dist, prev, steps, snaps };
}

function undirectedKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function mst(req: NetworksRequest): ModuleResult {
  if (req.nodes.length < 2) throw new SolverError("el árbol de expansión necesita al menos dos nodos");
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
  const decisions: string[] = undirected.map(() => "pendiente");
  const touched = new Set<string>();
  undirected.forEach((e, ii) => {
    const a = find(e.u);
    const b = find(e.v);
    const accepted = a !== b;
    if (accepted) {
      parent[a] = b;
      tree.push(e);
      touched.add(e.u);
      touched.add(e.v);
    }
    decisions[ii] = accepted ? "aceptada" : "rechazada";
    const acc = tree.reduce((s, x) => s + x.w, 0);
    iterations.push({
      index: ii + 1,
      method: "kruskal",
      title: accepted
        ? `Acepta ${e.u}–${e.v} con peso ${formatMetric(e.w)}`
        : `Rechaza ${e.u}–${e.v}: formaría un ciclo`,
      tableau: [
        ["Arista", "Peso", "Decisión"],
        ...undirected.map((x, j) => [`${x.u}–${x.v}`, x.w, decisions[j]]),
      ],
      meta: {
        arista: `${e.u}–${e.v}`,
        decision: accepted ? "aceptada" : "rechazada",
        peso: e.w,
        peso_acumulado: acc,
        regla: accepted
          ? `Las aristas se revisan de menor a mayor peso. ${e.u} y ${e.v} estaban en grupos distintos, así que unirlos no forma ciclo: se acepta.`
          : `${e.u} y ${e.v} ya están conectados por aristas aceptadas; agregar esta arista cerraría un ciclo, así que se descarta.`,
      },
      view: {
        node_tone: req.nodes.map((n) => (touched.has(n) ? "flow" : null)),
        node_sub: req.nodes.map(() => null),
        edge_on: undirected.map((_, j) => decisions[j] === "aceptada" && j !== ii),
        edge_hot: undirected.map((_, j) => j === ii),
        edge_dashed: undirected.map((_, j) => j === ii && !accepted),
        subtitle: `Peso acumulado del árbol = ${formatMetric(acc)} · ${tree.length} de ${req.nodes.length - 1} aristas`,
        legend: [
          { label: accepted ? "Arista aceptada ahora" : "Arista rechazada (punteada)", tone: "crit" },
          { label: "Aristas ya aceptadas", tone: "flow" },
          { label: "Pendientes o rechazadas", tone: "idle" },
        ],
      },
    });
  });
  if (tree.length !== req.nodes.length - 1) {
    const groups = new Map<string, string[]>();
    for (const n of req.nodes) {
      const root = find(n);
      groups.set(root, [...(groups.get(root) ?? []), n]);
    }
    const detail = [...groups.values()].map((g) => `{${g.join(", ")}}`).join(" y ");
    throw new SolverError(
      `el grafo no es conexo: no existe un árbol de expansión que una todos los nodos (quedan grupos separados: ${detail})`,
    );
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
    subtitle: `Peso total = ${formatMetric(total)} · ${tree.length} aristas elegidas con Kruskal`,
    legend: [
      { label: "Arista del árbol", tone: "crit" },
      { label: "Arista no usada", tone: "idle" },
    ],
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

function tidy(n: number): number {
  const r = Math.round(n * 1e9) / 1e9;
  return Object.is(r, -0) ? 0 : r;
}

function maxFlow(req: NetworksRequest): ModuleResult {
  if (!req.source || !req.sink) throw new SolverError("origen y destino son obligatorios para flujo máximo");
  if (req.source === req.sink) throw new SolverError("origen y destino deben ser distintos");
  if (!req.edges.length) throw new SolverError("las aristas son obligatorias para flujo máximo");
  if (!req.nodes.includes(req.source) || !req.nodes.includes(req.sink)) {
    throw new SolverError("origen y destino deben estar en la lista de nodos");
  }
  assertEdgesKnown(req);
  const source = req.source;
  const sink = req.sink;
  // Capacidad total por arco (los arcos paralelos se suman). En una red no dirigida cada
  // arista puede usarse en cualquier sentido, con su capacidad completa en cada uno.
  const capacities = new Map<string, number>();
  for (const e of req.edges) {
    if (e.source === e.target) continue;
    const cap = e.capacity ?? e.weight;
    if (!(cap >= 0)) throw new SolverError(`La capacidad de ${e.source} → ${e.target} debe ser un número mayor o igual que 0.`);
    const key = arcKey(e.source, e.target);
    capacities.set(key, (capacities.get(key) ?? 0) + cap);
    if (!req.directed) {
      const back = arcKey(e.target, e.source);
      capacities.set(back, (capacities.get(back) ?? 0) + cap);
    }
  }
  const arcs: { u: string; v: string; cap: number }[] = [];
  for (const [key, cap] of capacities) {
    const [u, v] = key.split("\u0000");
    arcs.push({ u, v, cap });
  }
  const residual = new Map<string, Map<string, number>>();
  for (const n of req.nodes) residual.set(n, new Map());
  for (const { u, v, cap } of arcs) {
    residual.get(u)!.set(v, (residual.get(u)!.get(v) ?? 0) + cap);
    if (!residual.get(v)!.has(u)) residual.get(v)!.set(u, 0);
  }
  const res = (u: string, v: string) => residual.get(u)?.get(v) ?? 0;

  /** Una fila por arco (o por arista si la red no es dirigida), orientada según el flujo neto. */
  const flowEdges = (): { u: string; v: string; cap: number; flow: number; k: number; rev: boolean }[] => {
    const out: { u: string; v: string; cap: number; flow: number; k: number; rev: boolean }[] = [];
    const done = new Set<string>();
    arcs.forEach(({ u, v, cap }, k) => {
      if (!req.directed) {
        const key = undirectedKey(u, v);
        if (done.has(key)) return;
        done.add(key);
        const net = tidy(cap - res(u, v));
        out.push(net >= 0 ? { u, v, cap, flow: net, k, rev: false } : { u: v, v: u, cap, flow: -net, k, rev: true });
      } else {
        out.push({ u, v, cap, flow: Math.max(0, tidy(cap - res(u, v))), k, rev: false });
      }
    });
    return out;
  };
  const header = ["Arco", "Capacidad", "Flujo", "Disponible"];
  const snapshot = (): (string | number)[][] => [
    header,
    ...flowEdges().map((e) => [`${e.u}${req.directed ? "→" : "–"}${e.v}`, e.cap, e.flow, tidy(e.cap - e.flow)]),
  ];
  /** Flujo neto de cada arco en el sentido en que fue capturado (negativo = va al revés en una red no dirigida). */
  const netByArc = (): number[] => arcs.map(({ u, v, cap }) => tidy(cap - res(u, v)));

  const iterations: IterationStep[] = [];
  const nets: number[][] = [];
  const paths: (string[] | null)[] = [];
  iterations.push({
    index: 0,
    method: "edmonds_karp",
    title: `Red inicial: sin flujo (se buscarán caminos de aumento de ${source} a ${sink})`,
    tableau: snapshot(),
    meta: {
      regla: `Se empieza con flujo 0 en todos los arcos. En cada paso se busca por anchura (BFS) un camino de ${source} a ${sink} con capacidad disponible y se envía lo que deja pasar su arco más limitado (el cuello de botella).`,
    },
  });
  nets.push(netByArc());
  paths.push(null);
  let totalFlow = 0;
  let step = 0;
  for (;;) {
    const parent: Record<string, string | null> = { [source]: null };
    const queue: string[] = [source];
    for (let qi = 0; qi < queue.length && !(sink in parent); qi++) {
      const u = queue[qi];
      for (const [v, cap] of residual.get(u) ?? new Map<string, number>()) {
        if (cap > 1e-9 && !(v in parent)) {
          parent[v] = u;
          queue.push(v);
        }
      }
    }
    if (!(sink in parent)) break;
    const path: string[] = [sink];
    let bottleneck = Infinity;
    for (let v = sink; v !== source; ) {
      const u = parent[v]!;
      bottleneck = Math.min(bottleneck, res(u, v));
      path.push(u);
      v = u;
    }
    path.reverse();
    bottleneck = tidy(bottleneck);
    for (let i = 0; i + 1 < path.length; i++) {
      const u = path[i];
      const v = path[i + 1];
      residual.get(u)!.set(v, res(u, v) - bottleneck);
      residual.get(v)!.set(u, res(v, u) + bottleneck);
    }
    totalFlow = tidy(totalFlow + bottleneck);
    step++;
    iterations.push({
      index: step,
      method: "edmonds_karp",
      title: `Camino de aumento ${path.join(" → ")} (cuello de botella = ${formatMetric(bottleneck)})`,
      tableau: snapshot(),
      meta: {
        path,
        bottleneck,
        cumulative_flow: totalFlow,
        regla: `Se busca por anchura (BFS) el camino con capacidad disponible de ${source} a ${sink}; se envía lo que deja pasar su arco con menos capacidad disponible (el cuello de botella).`,
      },
    });
    nets.push(netByArc());
    paths.push(path);
  }

  // Corte mínimo: nodos alcanzables desde el origen en la red residual final.
  const reachable = new Set([source]);
  const q = [source];
  while (q.length) {
    const u = q.shift()!;
    for (const [v, cap] of residual.get(u) ?? []) {
      if (cap > 1e-9 && !reachable.has(v)) {
        reachable.add(v);
        q.push(v);
      }
    }
  }
  const sideS = req.nodes.filter((n) => reachable.has(n));
  const sideT = req.nodes.filter((n) => !reachable.has(n));
  const cutRows: unknown[][] = [];
  let cutValue = 0;
  for (const { u, v, cap } of arcs) {
    if (reachable.has(u) && !reachable.has(v)) {
      cutRows.push([u, v, cap]);
      cutValue += cap;
    }
  }
  cutValue = tidy(cutValue);
  iterations.push({
    index: step + 1,
    method: "edmonds_karp",
    title: `Sin caminos de aumento: flujo máximo = ${formatMetric(totalFlow)}`,
    tableau: snapshot(),
    meta: {
      alcanzables_desde_origen: sideS.join(", "),
      regla: `Ya no hay camino con capacidad disponible de ${source} a ${sink}. Los nodos alcanzables (${sideS.join(", ")}) y el resto forman el corte mínimo; su capacidad (${formatMetric(cutValue)}) iguala al flujo.`,
    },
  });
  nets.push(netByArc());
  paths.push(null);

  const edgesNow = flowEdges();
  const isCut = (e: { u: string; v: string }) =>
    (reachable.has(e.u) && !reachable.has(e.v)) || (!req.directed && reachable.has(e.v) && !reachable.has(e.u));

  // Cuadro del grafo de cada paso: flujo por arco (en el sentido del gráfico) y lo que cambió.
  const signed = (net: number[]) => edgesNow.map((e) => (e.rev ? -net[e.k] : net[e.k]));
  const originLabel = req.nodes.map((n) => (n === source ? "origen" : n === sink ? "destino" : null));
  iterations.forEach((it, i) => {
    const flows = signed(nets[i]);
    const before = i > 0 ? signed(nets[i - 1]) : flows;
    const last = i === iterations.length - 1;
    const path = paths[i];
    if (last) {
      it.view = {
        node_tone: req.nodes.map((n) => (reachable.has(n) ? "flow" : "idle")),
        node_sub: originLabel,
        edge_flow: flows,
        edge_hot: edgesNow.map(isCut),
        subtitle: `Flujo máximo = ${formatMetric(totalFlow)} · el corte mínimo vale ${formatMetric(cutValue)}`,
        legend: [
          { label: "Lado del origen en el corte", tone: "flow" },
          { label: "Lado del destino", tone: "idle" },
          { label: "Arco del corte mínimo", tone: "crit" },
        ],
      };
      return;
    }
    const changed = flows.map((f, j) => Math.abs(f - before[j]) > 1e-9);
    const cancelled = flows.map((f, j) => changed[j] && Math.abs(f) < Math.abs(before[j]) - 1e-9);
    it.view = {
      node_tone: req.nodes.map((n) => (path?.includes(n) ? "crit" : null)),
      node_sub: originLabel,
      edge_flow: flows,
      edge_hot: changed,
      edge_dashed: cancelled,
      subtitle: path
        ? `Flujo acumulado = ${formatMetric(Number(it.meta.cumulative_flow))} · camino ${path.join(" → ")}`
        : "Todavía no circula nada",
      legend: path
        ? [
            { label: "Camino de aumento (arcos que cambian)", tone: "crit" },
            { label: "Arco con flujo", tone: "flow" },
            { label: "Arco sin flujo (punteado)", tone: "idle" },
          ]
        : [{ label: "Arco sin flujo (punteado)", tone: "idle" }],
    };
  });

  const rows: unknown[][] = [];
  const variables: Record<string, number> = {};
  for (const e of edgesNow) {
    if (e.flow > 1e-9) {
      rows.push([e.u, e.v, e.flow, e.cap, e.flow >= e.cap - 1e-9 ? "saturado" : "con holgura"]);
      variables[`${e.u}->${e.v}`] = e.flow;
    }
  }
  const warnings: string[] = [];
  if (totalFlow <= 1e-9) {
    warnings.push(`No hay ningún camino con capacidad de ${source} a ${sink}: el flujo máximo es 0.`);
  }
  const graph: GraphNetwork = {
    type: "network",
    directed: req.directed,
    nodes: req.nodes.map((n) => ({
      id: n,
      tone: reachable.has(n) ? "flow" : "idle",
      kind: n === source ? "origen" : n === sink ? "destino" : undefined,
    })),
    edges: edgesNow.map((e) => ({
      source: e.u,
      target: e.v,
      capacity: e.cap,
      flow: e.flow,
      min_cut: isCut(e),
    })),
    title: "Flujo máximo",
    subtitle: `Flujo = ${formatMetric(totalFlow)} · corte mínimo = ${formatMetric(cutValue)} · cada arco muestra flujo/capacidad`,
    legend: [
      { label: "Lado del origen en el corte", tone: "flow" },
      { label: "Lado del destino", tone: "idle" },
      { label: "Arco del corte mínimo", tone: "crit" },
    ],
  };
  return ok({
    variables,
    metrics: { max_flow: totalFlow, min_cut_value: cutValue },
    tables: [
      { name: "flows", columns: ["origen", "destino", "flujo", "capacidad", "estado"], rows },
      { name: "min_cut", columns: ["origen", "destino", "capacidad"], rows: cutRows },
      {
        name: "conjuntos_corte",
        columns: ["lado", "nodos"],
        rows: [
          ["Lado del origen", sideS.join(", ")],
          ["Lado del destino", sideT.join(", ")],
        ],
      },
    ],
    graph,
    iterations,
    warnings,
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
  /** Posiciones en `arcs` de cada arista de la solicitud (dos si la red no es dirigida). */
  const arcsOfEdge: number[][] = [];
  req.edges.forEach((e) => {
    if (e.source === e.target) {
      arcsOfEdge.push([]);
      return;
    }
    if (e.capacity != null && !(e.capacity >= 0)) {
      throw new SolverError(`La capacidad de ${e.source} → ${e.target} debe ser mayor o igual que 0.`);
    }
    const mine = [arcs.length];
    arcs.push({ from: e.source, to: e.target, cost: e.weight, cap: e.capacity });
    if (!req.directed) {
      mine.push(arcs.length);
      arcs.push({ from: e.target, to: e.source, cost: e.weight, cap: e.capacity });
    }
    arcsOfEdge.push(mine);
  });
  const realCount = arcs.length;
  const nodes = [...req.nodes];
  let DUMMY = "Ficticio";
  while (nodes.includes(DUMMY)) DUMMY += "*";
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
  const rows: unknown[][] = [];
  const variables: Record<string, number> = {};
  for (let i = 0; i < realCount; i++) {
    const a = arcs[i];
    const f = tidy(res.flows[i]);
    if (f > 1e-9) {
      rows.push([a.from, a.to, f, a.cost, tidy(f * a.cost)]);
      variables[`${a.from}->${a.to}`] = (variables[`${a.from}->${a.to}`] ?? 0) + f;
    }
  }
  const unsent: unknown[][] = [];
  for (let i = realCount; i < arcs.length; i++) {
    if (res.flows[i] > 1e-9) unsent.push([arcs[i].from, tidy(res.flows[i])]);
  }
  const balanceRows = req.nodes.map((n) => {
    let inflow = 0;
    let outflow = 0;
    for (let i = 0; i < realCount; i++) {
      if (arcs[i].to === n) inflow += res.flows[i];
      if (arcs[i].from === n) outflow += res.flows[i];
    }
    const b = req.node_supply![n] ?? 0;
    return [n, b > 0 ? "oferta" : b < 0 ? "demanda" : "transbordo", b, tidy(inflow), tidy(outflow)];
  });
  const totalCost = res.cost;
  const edgeInfo = req.edges
    .map((e, i) => {
      const idx = arcsOfEdge[i];
      if (!idx.length) return null;
      // En una red no dirigida se dibuja el sentido en que realmente circula el flujo.
      const fwd = tidy(res.flows[idx[0]]);
      const back = idx.length > 1 ? tidy(res.flows[idx[1]]) : 0;
      const reversed = back > fwd;
      return {
        idx,
        reversed,
        edge: {
          source: reversed ? e.target : e.source,
          target: reversed ? e.source : e.target,
          cost: e.weight,
          capacity: e.capacity,
          flow: Math.max(fwd, back),
        },
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  const graphEdges = edgeInfo.map((x) => x.edge);
  // Cuadro del grafo en cada iteración: flujo actual, arcos del árbol, el que entra y el que sale.
  const supplyLabels = req.nodes.map((n) => {
    const b = req.node_supply![n] ?? 0;
    return b > 0 ? `oferta ${formatMetric(b)}` : b < 0 ? `demanda ${formatMetric(-b)}` : "transbordo";
  });
  res.iterations.forEach((st, i) => {
    const fr = res.frames[i];
    if (!fr) return;
    const last = i === res.iterations.length - 1;
    const net = (x: (typeof edgeInfo)[number]) => {
      const n = fr.flow[x.idx[0]] - (x.idx.length > 1 ? fr.flow[x.idx[1]] : 0);
      return x.reversed ? -n : n;
    };
    const has = (x: (typeof edgeInfo)[number], arc: number) => arc >= 0 && x.idx.includes(arc);
    const cost = edgeInfo.reduce((a, x) => a + Math.abs(net(x)) * x.edge.cost, 0);
    st.view = {
      node_sub: supplyLabels,
      edge_flow: edgeInfo.map((x) => tidy(net(x))),
      edge_on: edgeInfo.map((x) => x.idx.some((k) => fr.tree[k])),
      edge_hot: edgeInfo.map((x) => has(x, fr.enter) || has(x, fr.leave)),
      edge_dashed: edgeInfo.map((x) => has(x, fr.leave)),
      subtitle: last
        ? `Solución óptima · costo total = ${formatMetric(tidy(cost))}`
        : `Costo actual = ${formatMetric(tidy(cost))} (todavía mejora)`,
      legend: last
        ? [
            { label: "Arco con flujo", tone: "flow" },
            { label: "Arco sin uso (punteado)", tone: "idle" },
          ]
        : [
            { label: "Arco que entra al árbol", tone: "crit" },
            { label: "Arco del árbol básico", tone: "flow" },
            { label: "Fuera del árbol; el que sale va punteado", tone: "idle" },
          ],
    };
  });
  const graph: GraphNetwork = {
    type: "network",
    directed: true,
    nodes: req.nodes.map((n) => {
      const b = req.node_supply![n] ?? 0;
      return {
        id: n,
        supply_demand: b,
        kind: b > 0 ? `oferta ${formatMetric(b)}` : b < 0 ? `demanda ${formatMetric(-b)}` : "transbordo",
      };
    }),
    edges: graphEdges,
    title: "Flujo de costo mínimo (transbordo)",
    subtitle: `Costo total = ${formatMetric(totalCost)} · cada arco muestra flujo/capacidad y «c» = costo unitario`,
    legend: [
      { label: "Arco con flujo", tone: "flow" },
      { label: "Arco sin uso", tone: "idle" },
    ],
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
  if (req.nodes.length !== n) {
    throw new SolverError(
      `la lista de nodos (${req.nodes.length}) y la matriz de distancias (${n} × ${n}) deben tener el mismo tamaño`,
    );
  }
  const labels = req.nodes;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cell = req.distance_matrix[i][j];
      if (i !== j && (cell == null || !Number.isFinite(cell))) {
        throw new SolverError(`falta la distancia entre ${labels[i]} y ${labels[j]}`);
      }
    }
  }
  const D = req.distance_matrix.map((row) => row.map((cell) => (cell == null || !Number.isFinite(cell) ? 0 : cell)));
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
  let iterations: IterationStep[] | undefined;
  let tourIdx: number[];
  let total: number;
  if (method === "exact") {
    ({ tourIdx, total } = tspExact(D));
  } else {
    const h = tspHeuristic(D, labels);
    ({ tourIdx, total } = h);
    iterations = h.steps;
    warnings.push(
      "Resultado heurístico (mejor de varios arranques con vecino más cercano, 2-opt y Or-opt): suele ser muy bueno, pero no se garantiza que sea el óptimo.",
    );
  }
  total = tidy(total);
  const tour = tourIdx.map((i) => labels[i]);
  // Los nodos se envían en el orden del recorrido: dibujados en círculo forman un polígono sin cruces.
  const order = tourIdx.slice(0, -1);
  if (iterations) {
    // Cuadro de cada paso: el recorrido de ese momento; en magenta las aristas que cambiaron.
    const labelIdx = new Map(labels.map((l, i) => [l, i]));
    const keyOf = (a: string, b: string) => (asymmetric || a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
    let before = new Set<string>();
    iterations.forEach((st) => {
      const rec = st.meta.recorrido as string[];
      const pairs = rec.slice(0, -1).map((l, i) => [l, rec[i + 1]] as const);
      st.view = {
        node_tone: order.map(() => null),
        node_sub: order.map(() => null),
        edges: pairs.map(([a, b]) => ({
          source: a,
          target: b,
          weight: D[labelIdx.get(a)!][labelIdx.get(b)!],
          ...(before.has(keyOf(a, b)) ? { on: true } : { critical: true }),
        })),
        subtitle: `Longitud del recorrido = ${formatMetric(Number(st.meta.longitud))}`,
        legend: [
          { label: "Aristas nuevas en este paso", tone: "crit" },
          { label: "Aristas que se conservan", tone: "flow" },
        ],
      };
      before = new Set(pairs.map(([a, b]) => keyOf(a, b)));
    });
  }
  const graph: GraphNetwork = {
    type: "network",
    directed: true,
    layout: "circle",
    nodes: order.map((idx, i) => ({ id: labels[idx], critical: true, kind: i === 0 ? "inicio" : `${i + 1}.º` })),
    edges: tourIdx.slice(0, -1).map((idx, i) => ({
      source: labels[idx],
      target: labels[tourIdx[i + 1]],
      weight: D[idx][tourIdx[i + 1]],
      critical: true,
    })),
    title: "Agente viajante",
    subtitle: `Longitud = ${formatMetric(total)} · ${method === "exact" ? "óptimo exacto (Held-Karp)" : "heurística"}${asymmetric ? " · distancias asimétricas" : ""}`,
    legend: [{ label: "Recorrido (el número indica el orden de visita)", tone: "crit" }],
  };
  let cumulative = 0;
  const tourRows = tourIdx.map((idx, i) => {
    const leg = i === 0 ? 0 : D[tourIdx[i - 1]][idx];
    cumulative = tidy(cumulative + leg);
    return [i, labels[idx], leg, cumulative];
  });
  return ok({
    variables: {},
    metrics: { tour_length: total },
    tables: [{ name: "recorrido", columns: ["orden", "nodo", "distancia_tramo", "acumulada"], rows: tourRows }],
    graph,
    iterations,
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

function cycleCost(D: number[][], t: number[]): number {
  let c = 0;
  for (let i = 0; i < t.length; i++) c += D[t[i]][t[(i + 1) % t.length]];
  return c;
}

/**
 * Heurística: vecino más cercano desde cada ciudad + mejora local con 2-opt y Or-opt.
 * Cada movimiento se evalúa con el costo real del ciclo, así que también sirve con
 * distancias asimétricas (donde invertir un tramo cambia el costo de todos sus arcos).
 */
function tspHeuristic(
  D: number[][],
  labels: string[],
): { tourIdx: number[]; total: number; steps: IterationStep[] } {
  const n = D.length;
  let best: { cycle: number[]; cost: number; steps: IterationStep[] } | null = null;
  // Con muchas ciudades se prueban solo algunos arranques repartidos, para cuidar el tiempo de cómputo.
  const starts = n <= 12 ? range(0, n) : range(0, 8).map((k) => Math.floor((k * n) / 8));
  for (const start of starts) {
    const steps: IterationStep[] = [];
    const cycle = [start];
    const left = new Set(range(0, n).filter((i) => i !== start));
    while (left.size) {
      const cur = cycle[cycle.length - 1];
      let nxt = -1;
      for (const j of left) if (nxt < 0 || D[cur][j] < D[cur][nxt] || (D[cur][j] === D[cur][nxt] && j < nxt)) nxt = j;
      cycle.push(nxt);
      left.delete(nxt);
    }
    let cost = cycleCost(D, cycle);
    steps.push({
      index: 0,
      method: "tsp_heuristic",
      title: `Vecino más cercano desde ${labels[start]}: longitud ${formatMetric(cost)}`,
      tableau: null,
      meta: { recorrido: [...cycle, start].map((i) => labels[i]), longitud: cost },
    });
    let improved = true;
    while (improved) {
      improved = false;
      // Sumas acumuladas del ciclo en ambos sentidos: el costo de invertir un tramo se evalúa en O(1),
      // también con distancias asimétricas.
      const pf = [0];
      const pr = [0];
      for (let k = 0; k + 1 < n; k++) {
        pf.push(pf[k] + D[cycle[k]][cycle[k + 1]]);
        pr.push(pr[k] + D[cycle[k + 1]][cycle[k]]);
      }
      // 2-opt: invertir el tramo i..j.
      for (let i = 1; i < n - 1 && !improved; i++) {
        for (let j = i + 1; j < n && !improved; j++) {
          const a = cycle[i - 1];
          const bI = cycle[i];
          const bJ = cycle[j];
          const d = cycle[(j + 1) % n];
          const delta = D[a][bJ] + D[bI][d] + (pr[j] - pr[i]) - D[a][bI] - D[bJ][d] - (pf[j] - pf[i]);
          if (delta < -1e-9) {
            const cand = [...cycle.slice(0, i), ...cycle.slice(i, j + 1).reverse(), ...cycle.slice(j + 1)];
            const c = cycleCost(D, cand);
            steps.push({
              index: steps.length,
              method: "tsp_heuristic",
              title: `2-opt: invierte el tramo ${labels[bI]} … ${labels[bJ]} (${formatMetric(cost)} → ${formatMetric(c)})`,
              tableau: null,
              meta: { recorrido: [...cand, cand[0]].map((k) => labels[k]), longitud: c },
            });
            cycle.splice(0, n, ...cand);
            cost = c;
            improved = true;
          }
        }
      }
      // Or-opt: mover un tramo de 1 a 3 ciudades a otra posición (en uno u otro sentido).
      for (let len = 1; len <= 3 && !improved; len++) {
        for (let i = 1; i + len <= n && !improved; i++) {
          const seg = cycle.slice(i, i + len);
          const first = seg[0];
          const last = seg[len - 1];
          const prev = cycle[i - 1];
          const next = cycle[(i + len) % n];
          let fwd = 0;
          let rev = 0;
          for (let k = 0; k + 1 < len; k++) {
            fwd += D[seg[k]][seg[k + 1]];
            rev += D[seg[k + 1]][seg[k]];
          }
          const removal = D[prev][next] - D[prev][first] - D[last][next];
          const rest = [...cycle.slice(0, i), ...cycle.slice(i + len)];
          for (let pos = 1; pos <= rest.length && !improved; pos++) {
            if (pos === i) continue;
            const x = rest[pos - 1];
            const y = rest[pos % rest.length];
            const base = removal - D[x][y];
            const keep = base + D[x][first] + D[last][y];
            const flip = base + D[x][last] + D[first][y] + (rev - fwd);
            if (Math.min(keep, flip) < -1e-9) {
              const piece = keep <= flip ? seg : [...seg].reverse();
              const cand = [...rest.slice(0, pos), ...piece, ...rest.slice(pos)];
              const c = cycleCost(D, cand);
              steps.push({
                index: steps.length,
                method: "tsp_heuristic",
                title: `Or-opt: mueve ${piece.map((k) => labels[k]).join(", ")} (${formatMetric(cost)} → ${formatMetric(c)})`,
                tableau: null,
                meta: { recorrido: [...cand, cand[0]].map((k) => labels[k]), longitud: c },
              });
              cycle.splice(0, n, ...cand);
              cost = c;
              improved = true;
            }
          }
        }
      }
    }
    if (!best || cost < best.cost - 1e-9) best = { cycle: [...cycle], cost, steps };
  }
  const b = best!;
  // El recorrido se presenta empezando en la primera ciudad de la lista.
  const at = b.cycle.indexOf(0);
  const rotated = [...b.cycle.slice(at), ...b.cycle.slice(0, at)];
  b.steps.forEach((st, i) => (st.index = i));
  return { tourIdx: [...rotated, 0], total: b.cost, steps: b.steps };
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
