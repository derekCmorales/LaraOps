import { SolverError } from "../../errors";
import { LIMITS, assertLimit } from "../../limits";
import type { GraphGantt, GraphNetwork, IterationStep, ModuleResult, NamedTable } from "../../schema";
import { okResult } from "../../schema";

export type Activity = {
  id: string;
  predecessors: string[];
  duration: number | null;
  a: number | null;
  m: number | null;
  b: number | null;
  crash_time: number | null;
  normal_cost: number | null;
  crash_cost: number | null;
};

export type PertCpmRequest = {
  activities: Activity[];
  mode: "cpm" | "pert";
  target_time?: number | null;
  target_probability?: number | null;
  crash: boolean;
  crash_target?: number | null;
  graph_kind: "network" | "gantt";
};

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("payload debe ser un objeto JSON");
  }
  return body as Record<string, unknown>;
}

function readOptionalNumber(value: unknown, label: string): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SolverError(`${label} no es un número válido. Escribe un valor como 4 o 1,5.`);
    }
    return value;
  }
  const raw = String(value).trim();
  if (raw === "") return null;
  if (/invalid number|número no válido|numero no valido/i.test(raw)) {
    throw new SolverError(`${label} no es un número válido. Escribe un valor como 4 o 1,5.`);
  }
  const n = Number(raw.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) {
    throw new SolverError(`${label} no es un número válido. Escribe un valor como 4 o 1,5.`);
  }
  return n;
}

export function parsePertRequest(body: unknown): PertCpmRequest {
  const o = asRecord(body);
  const activitiesRaw = Array.isArray(o.activities) ? o.activities : [];
  assertLimit(
    activitiesRaw.length <= LIMITS.pertActivities,
    `PERT/CPM limitado a ${LIMITS.pertActivities} actividades en el plan Free`,
  );
  const activities: Activity[] = activitiesRaw.map((a, i) => {
    const row = asRecord(a);
    const id = String(row.id ?? `A${i + 1}`).trim() || `A${i + 1}`;
    const who = `«${id}»`;
    return {
      id,
      predecessors: Array.isArray(row.predecessors)
        ? row.predecessors.map((p) => String(p).trim()).filter(Boolean)
        : [],
      duration: readOptionalNumber(row.duration, `La duración de ${who}`),
      a: readOptionalNumber(row.a, `El tiempo optimista (a) de ${who}`),
      m: readOptionalNumber(row.m, `El tiempo más probable (m) de ${who}`),
      b: readOptionalNumber(row.b, `El tiempo pesimista (b) de ${who}`),
      crash_time: readOptionalNumber(row.crash_time, `El tiempo crash de ${who}`),
      normal_cost: readOptionalNumber(row.normal_cost, `El costo normal de ${who}`),
      crash_cost: readOptionalNumber(row.crash_cost, `El costo crash de ${who}`),
    };
  });
  return {
    activities,
    mode: o.mode === "pert" ? "pert" : "cpm",
    target_time: readOptionalNumber(o.target_time, "El tiempo objetivo"),
    target_probability: readOptionalNumber(o.target_probability, "La probabilidad objetivo"),
    crash: Boolean(o.crash),
    crash_target: readOptionalNumber(o.crash_target, "La duración objetivo"),
    graph_kind: o.graph_kind === "gantt" ? "gantt" : "network",
  };
}

export function solve(body: unknown): ModuleResult {
  const req = parsePertRequest(body);
  if (!req.activities.length) throw new SolverError("Agrega al menos una actividad.");
  const acts = new Map(req.activities.map((a) => [a.id, a]));
  if (acts.size !== req.activities.length) throw new SolverError("Hay actividades con el mismo nombre.");
  for (const a of req.activities) {
    for (const p of a.predecessors) {
      if (!acts.has(p)) {
        throw new SolverError(`La actividad «${a.id}» depende de «${p}», que no existe.`);
      }
    }
  }

  const duration: Record<string, number> = {};
  const te: Record<string, number> = {};
  const variance: Record<string, number> = {};
  for (const a of req.activities) {
    if (req.mode === "cpm") {
      if (a.duration == null || a.duration < 0) {
        throw new SolverError(`La actividad «${a.id}» necesita una duración mayor o igual que 0.`);
      }
      duration[a.id] = a.duration;
      te[a.id] = a.duration;
      variance[a.id] = 0;
    } else {
      if (a.a == null || a.m == null || a.b == null) {
        throw new SolverError(
          `La actividad «${a.id}» necesita los tres tiempos de PERT: optimista (a), más probable (m) y pesimista (b).`,
        );
      }
      if (a.a < 0 || !(a.a <= a.m && a.m <= a.b)) {
        throw new SolverError(`En «${a.id}» los tiempos deben cumplir 0 ≤ a ≤ m ≤ b.`);
      }
      const teVal = (a.a + 4 * a.m + a.b) / 6;
      const varVal = ((a.b - a.a) / 6) ** 2;
      duration[a.id] = teVal;
      te[a.id] = teVal;
      variance[a.id] = varVal;
    }
  }

  let crashSteps: IterationStep[] = [];
  let totalCrashCost = 0;
  const warnings: string[] = [];
  let crashInfeasible = false;
  if (req.crash) {
    if (req.mode !== "cpm") throw new SolverError("La aceleración solo aplica en modo CPM.");
    if (req.crash_target == null || req.crash_target < 0) {
      throw new SolverError("Indica una duración objetivo mayor o igual que 0 para la aceleración.");
    }
    const crashed = crashProject(acts, duration, req.crash_target);
    Object.assign(duration, crashed.duration);
    totalCrashCost = crashed.totalCost;
    crashSteps = crashed.steps;
    warnings.push(...crashed.warnings);
    crashInfeasible = crashed.infeasible;
  }

  const order = topoSort(acts);
  const sched = schedule(acts, duration, order);
  let projectDuration = sched.project_duration;
  if (req.crash && req.crash_target != null && projectDuration > req.crash_target + 1e-6) {
    crashInfeasible = true;
    if (!warnings.length) {
      warnings.push(
        `No se puede llegar a la duración objetivo ${fmtQty(req.crash_target)}. La menor duración alcanzable es ${fmtQty(projectDuration)}.`,
      );
    }
  }
  const { es, ef, ls, lf, slack, critical, successors } = sched;
  const enumerated = enumerateCriticalPaths(acts, successors, critical, order);
  const criticalPath = pickCriticalPath(enumerated.paths, variance);
  if (enumerated.paths.length > 1 || enumerated.truncated) {
    if (enumerated.truncated) {
      warnings.push(
        "Hay muchas rutas críticas; se listan solo algunas. En PERT, la probabilidad usa la de mayor varianza entre las revisadas.",
      );
    } else if (req.mode === "pert") {
      warnings.push("Hay varias rutas críticas. La probabilidad de PERT usa la de mayor varianza.");
    } else {
      warnings.push("Hay varias rutas críticas. Se muestra la primera en orden alfabético.");
    }
  }

  const scheduleColumns =
    req.mode === "pert"
      ? ["actividad", "optimista", "probable", "pesimista", "te", "varianza", "es", "ef", "ls", "lf", "holgura", "critica"]
      : ["actividad", "duracion", "es", "ef", "ls", "lf", "holgura", "critica"];
  const scheduleRows = order.map((aid) => {
    const timing = [es[aid], ef[aid], ls[aid], lf[aid], slack[aid], critical[aid]];
    if (req.mode === "pert") {
      const act = acts.get(aid)!;
      return [aid, act.a, act.m, act.b, te[aid], variance[aid], ...timing];
    }
    return [aid, duration[aid], ...timing];
  });
  const ganttRows = order.map((aid) => [aid, es[aid], ef[aid], slack[aid], critical[aid]]);
  const metrics: Record<string, number> = { project_duration: projectDuration };
  if (!enumerated.truncated) metrics.critical_path_count = enumerated.paths.length;
  if (req.mode === "pert") {
    const projectTe = criticalPath.reduce((s, aid) => s + te[aid], 0);
    const projectVar = criticalPath.reduce((s, aid) => s + variance[aid], 0);
    const projectStd = Math.sqrt(projectVar);
    metrics.project_te = projectTe;
    metrics.project_variance = projectVar;
    metrics.project_std = projectStd;
    if (req.target_time != null && projectStd > 1e-12) {
      metrics.prob_meet_target = normCdf((req.target_time - projectTe) / projectStd);
    } else if (req.target_time != null) {
      metrics.prob_meet_target = req.target_time >= projectTe ? 1 : 0;
    }
    if (req.target_probability != null) {
      const p = req.target_probability;
      if (!(p > 0 && p < 1)) {
        throw new SolverError("La probabilidad debe estar entre 0 y 1, sin incluir los extremos.");
      }
      const z = normPpf(p);
      metrics.target_probability = p;
      metrics.duration_for_probability = projectTe + z * projectStd;
    }
  }
  if (req.crash) {
    metrics.crash_total_cost = totalCrashCost;
    metrics.crash_target = req.crash_target ?? 0;
    const normalCost = req.activities.reduce((s, a) => s + (a.normal_cost ?? 0), 0);
    metrics.normal_cost_sum = normalCost;
    metrics.project_cost = normalCost + totalCrashCost;
  }

  const nodes = order.map((aid) => ({
    id: aid,
    critical: critical[aid],
    duration: duration[aid],
    es: es[aid],
    ef: ef[aid],
    ls: ls[aid],
    lf: lf[aid],
    slack: slack[aid],
  }));
  const edges: Record<string, unknown>[] = [];
  for (const a of req.activities) {
    for (const p of a.predecessors) {
      edges.push({ source: p, target: a.id, critical: critical[p] && critical[a.id] });
    }
  }
  const tables: NamedTable[] = [
    {
      name: "schedule",
      columns: scheduleColumns,
      rows: scheduleRows,
    },
    { name: "critical_path", columns: ["orden", "actividad"], rows: criticalPath.map((aid, i) => [i + 1, aid]) },
    { name: "gantt", columns: ["actividad", "inicio", "fin", "holgura", "critica"], rows: ganttRows },
  ];
  if (enumerated.paths.length > 1) {
    tables.push({
      name: "critical_paths",
      columns: ["ruta", "duracion", "varianza"],
      rows: enumerated.paths.map((path) => [
        path.join(" → "),
        path.reduce((sum, aid) => sum + duration[aid], 0),
        path.reduce((sum, aid) => sum + variance[aid], 0),
      ]),
    });
  }
  if (req.crash) {
    tables.push({
      name: "durations_after_crash",
      columns: ["actividad", "normal", "acelerada", "recorte"],
      rows: order.map((aid) => {
        const normal = acts.get(aid)!.duration ?? duration[aid];
        const accelerated = duration[aid];
        return [aid, normal, accelerated, normal - accelerated];
      }),
    });
  }
  const graph: GraphNetwork | GraphGantt =
    req.graph_kind === "gantt"
      ? {
          type: "gantt",
          bars: order.map((aid) => ({
            id: aid,
            start: es[aid],
            end: ef[aid],
            critical: critical[aid],
            slack: slack[aid],
          })),
          title: "Diagrama de Gantt del proyecto",
          subtitle: "Magenta = ruta crítica · gris = holgura",
          x_label: "Tiempo",
        }
      : {
          type: "network",
          nodes,
          edges,
          title: "Red del proyecto (actividades en nodos)",
          subtitle: "Cada nodo muestra ES, EF, LS, LF y duración. Magenta = ruta crítica.",
        };

  return okResult("pert_cpm", {
    status: crashInfeasible ? "infeasible" : "ok",
    variables: Object.fromEntries(order.map((aid) => [aid, duration[aid]])),
    objective_value: projectDuration,
    objective_sense: null,
    metrics,
    iterations: crashSteps.length ? crashSteps : null,
    graph,
    tables,
    warnings,
  });
}

function schedule(
  acts: Map<string, Activity>,
  duration: Record<string, number>,
  order: string[],
) {
  const es: Record<string, number> = {};
  const ef: Record<string, number> = {};
  for (const aid of order) {
    const preds = acts.get(aid)!.predecessors;
    es[aid] = preds.length ? Math.max(...preds.map((p) => ef[p])) : 0;
    ef[aid] = es[aid] + duration[aid];
  }
  const projectDuration = Object.values(ef).length ? Math.max(...Object.values(ef)) : 0;
  const ls: Record<string, number> = {};
  const lf: Record<string, number> = {};
  const successors: Record<string, string[]> = {};
  for (const a of acts.values()) {
    for (const p of a.predecessors) {
      successors[p] ??= [];
      successors[p].push(a.id);
    }
  }
  for (const aid of [...order].reverse()) {
    const succs = successors[aid] ?? [];
    lf[aid] = succs.length ? Math.min(...succs.map((s) => ls[s])) : projectDuration;
    ls[aid] = lf[aid] - duration[aid];
  }
  const slack = Object.fromEntries([...acts.keys()].map((aid) => [aid, ls[aid] - es[aid]]));
  const critical = Object.fromEntries([...acts.keys()].map((aid) => [aid, slack[aid] <= 1e-9]));
  return { es, ef, ls, lf, slack, critical, successors, project_duration: projectDuration };
}

type FlowEdge = { to: string; rev: number; cap: number };

function crashSlope(a: Activity, duration: number): number | null {
  if (a.crash_time == null || a.normal_cost == null || a.crash_cost == null) return null;
  const normal = a.duration ?? duration;
  const span = normal - a.crash_time;
  if (span <= 1e-12) return null;
  return (a.crash_cost - a.normal_cost) / span;
}

function crashProject(
  acts: Map<string, Activity>,
  durationIn: Record<string, number>,
  target: number,
) {
  const duration = { ...durationIn };
  const warnings: string[] = [];
  const steps: IterationStep[] = [];
  let totalCost = 0;
  let infeasible = false;
  const order = topoSort(acts);
  for (const a of acts.values()) {
    const hasAny = a.crash_time != null || a.normal_cost != null || a.crash_cost != null;
    if (!hasAny) continue;
    if (a.crash_time == null || a.normal_cost == null || a.crash_cost == null) {
      throw new SolverError(
        `La actividad «${a.id}» necesita tiempo crash, costo normal y costo crash para poder acelerarse.`,
      );
    }
    const normal = a.duration ?? duration[a.id] ?? 0;
    if (a.crash_time < 0 || a.crash_time > normal + 1e-9) {
      throw new SolverError(`En «${a.id}» el tiempo crash debe estar entre 0 y la duración normal.`);
    }
    if (a.crash_cost < a.normal_cost) {
      throw new SolverError(`En «${a.id}» el costo crash debe ser mayor o igual que el costo normal.`);
    }
  }
  let stepI = 0;
  while (true) {
    const sched = schedule(acts, duration, order);
    const t = sched.project_duration;
    if (t <= target + 1e-9) break;
    const slopes = new Map<string, number>();
    for (const [aid, a] of acts) {
      if (!sched.critical[aid]) continue;
      const slope = crashSlope(a, duration[aid]);
      if (slope == null) continue;
      if (duration[aid] - (a.crash_time ?? duration[aid]) <= 1e-12) continue;
      slopes.set(aid, slope);
    }
    const cut = cheapestCriticalCut(acts, sched.critical, sched.successors, slopes);
    if (!cut) {
      warnings.push(
        `No se puede llegar a la duración objetivo ${fmtQty(target)}. La menor duración alcanzable es ${fmtQty(t)}.`,
      );
      infeasible = true;
      break;
    }
    const avoiding = longestCompletePathAvoiding(acts, duration, order, new Set(cut));
    const slackLimit = avoiding < 0 ? Number.POSITIVE_INFINITY : t - avoiding;
    const room = Math.min(...cut.map((aid) => duration[aid] - (acts.get(aid)!.crash_time ?? duration[aid])));
    const amount = Math.min(room, t - target, slackLimit);
    if (!(amount > 1e-8)) {
      warnings.push(
        `No se puede llegar a la duración objetivo ${fmtQty(target)}. La menor duración alcanzable es ${fmtQty(t)}.`,
      );
      infeasible = true;
      break;
    }
    let costInc = 0;
    for (const aid of cut) {
      duration[aid] -= amount;
      costInc += (slopes.get(aid) ?? 0) * amount;
    }
    totalCost += costInc;
    stepI++;
    const names = cut.length === 1 ? cut[0] : cut.join(" y ");
    steps.push({
      index: stepI,
      method: "crash",
      title: `Acelerar ${names} en ${fmtQty(amount)} (costo +${fmtQty(costInc)})`,
      tableau: null,
      meta: {
        activity: cut.join(", "),
        amount,
        slope: cut.length === 1 ? (slopes.get(cut[0]) ?? 0) : costInc / amount,
        cost_increment: costInc,
        project_duration_before: t,
      },
    });
    if (stepI > 500) {
      warnings.push("Se alcanzó el límite de iteraciones de aceleración.");
      infeasible = true;
      break;
    }
  }
  return { duration, totalCost, steps, warnings, infeasible };
}

/** Corte de costo mínimo que cruza todas las rutas críticas (actividades como arcos). */
function cheapestCriticalCut(
  acts: Map<string, Activity>,
  critical: Record<string, boolean>,
  successors: Record<string, string[]>,
  slopes: Map<string, number>,
): string[] | null {
  const crit = [...acts.keys()].filter((id) => critical[id]);
  if (!crit.length) return null;
  const critSet = new Set(crit);
  const INF = 1e15;
  const graph = new Map<string, FlowEdge[]>();
  const addNode = (id: string) => {
    if (!graph.has(id)) graph.set(id, []);
  };
  const addEdge = (u: string, v: string, cap: number) => {
    addNode(u);
    addNode(v);
    const fu = graph.get(u)!;
    const fv = graph.get(v)!;
    fu.push({ to: v, rev: fv.length, cap });
    fv.push({ to: u, rev: fu.length - 1, cap: 0 });
  };
  const S = "__s";
  const T = "__t";
  addNode(S);
  addNode(T);
  for (const id of crit) {
    const slope = slopes.get(id);
    addEdge(`${id}#in`, `${id}#out`, slope == null ? INF : Math.max(0, slope));
    const preds = acts.get(id)!.predecessors.filter((p) => critSet.has(p));
    if (!preds.length) addEdge(S, `${id}#in`, INF);
    for (const p of preds) addEdge(`${p}#out`, `${id}#in`, INF);
    const succs = (successors[id] ?? []).filter((s) => critSet.has(s));
    if (!succs.length) addEdge(`${id}#out`, T, INF);
  }
  const flow = maxFlow(graph, S, T);
  if (flow >= INF / 10) return null;
  const reach = residualReachable(graph, S);
  const cut = crit.filter((id) => reach.has(`${id}#in`) && !reach.has(`${id}#out`) && slopes.has(id));
  return cut.length ? cut.sort((a, b) => a.localeCompare(b)) : null;
}

function maxFlow(graph: Map<string, FlowEdge[]>, source: string, sink: string): number {
  let flow = 0;
  const nodeCount = graph.size;
  for (let guard = 0; guard < nodeCount * nodeCount + 5; guard++) {
    const prev = new Map<string, { node: string; edge: number }>();
    const q = [source];
    prev.set(source, { node: source, edge: -1 });
    let found = false;
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi];
      if (u === sink) {
        found = true;
        break;
      }
      for (const [ei, edge] of (graph.get(u) ?? []).entries()) {
        if (edge.cap <= 1e-12 || prev.has(edge.to)) continue;
        prev.set(edge.to, { node: u, edge: ei });
        q.push(edge.to);
      }
    }
    if (!found || !prev.has(sink)) break;
    let amount = Number.POSITIVE_INFINITY;
    for (let v = sink; v !== source; ) {
      const step = prev.get(v)!;
      amount = Math.min(amount, graph.get(step.node)![step.edge].cap);
      v = step.node;
    }
    for (let v = sink; v !== source; ) {
      const step = prev.get(v)!;
      const edge = graph.get(step.node)![step.edge];
      edge.cap -= amount;
      graph.get(edge.to)![edge.rev].cap += amount;
      v = step.node;
    }
    flow += amount;
  }
  return flow;
}

function residualReachable(graph: Map<string, FlowEdge[]>, source: string): Set<string> {
  const seen = new Set<string>([source]);
  const q = [source];
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi];
    for (const edge of graph.get(u) ?? []) {
      if (edge.cap <= 1e-12 || seen.has(edge.to)) continue;
      seen.add(edge.to);
      q.push(edge.to);
    }
  }
  return seen;
}

/** Longitud del camino completo más largo que no usa actividades de `avoid`. −1 si no existe. */
function longestCompletePathAvoiding(
  acts: Map<string, Activity>,
  duration: Record<string, number>,
  order: string[],
  avoid: Set<string>,
): number {
  const best: Record<string, number> = {};
  const successors: Record<string, string[]> = {};
  for (const a of acts.values()) {
    for (const p of a.predecessors) {
      successors[p] ??= [];
      successors[p].push(a.id);
    }
  }
  for (const aid of order) {
    if (avoid.has(aid)) continue;
    const preds = acts.get(aid)!.predecessors;
    if (!preds.length) {
      best[aid] = duration[aid];
      continue;
    }
    const reachable = preds.filter((p) => best[p] != null);
    if (!reachable.length) continue;
    best[aid] = duration[aid] + Math.max(...reachable.map((p) => best[p]));
  }
  let longest = -1;
  for (const aid of Object.keys(best)) {
    if ((successors[aid] ?? []).length) continue;
    longest = Math.max(longest, best[aid]);
  }
  return longest;
}

function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n - Math.round(n)) < 1e-8) return String(Math.round(n));
  return String(Math.round(n * 10000) / 10000);
}

function topoSort(acts: Map<string, Activity>): string[] {
  const indeg: Record<string, number> = Object.fromEntries([...acts.keys()].map((id) => [id, 0]));
  const succ: Record<string, string[]> = {};
  for (const a of acts.values()) {
    for (const p of a.predecessors) {
      succ[p] ??= [];
      succ[p].push(a.id);
      indeg[a.id] += 1;
    }
  }
  const q = Object.entries(indeg)
    .filter(([, d]) => d === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];
  while (q.length) {
    const u = q.shift()!;
    order.push(u);
    for (const v of [...(succ[u] ?? [])].sort()) {
      indeg[v] -= 1;
      if (indeg[v] === 0) q.push(v);
    }
  }
  if (order.length !== acts.size) throw new SolverError("Hay un ciclo en la red de actividades.");
  return order;
}

function enumerateCriticalPaths(
  acts: Map<string, Activity>,
  successors: Record<string, string[]>,
  critical: Record<string, boolean>,
  order: string[],
): { paths: string[][]; truncated: boolean } {
  const limit = 24;
  const paths: string[][] = [];
  let truncated = false;
  let visits = 0;
  let starts = order.filter((aid) => critical[aid] && !acts.get(aid)!.predecessors.some((p) => critical[p]));
  if (!starts.length) starts = order.filter((aid) => critical[aid]);
  const dfs = (path: string[]) => {
    if (truncated) return;
    visits += 1;
    if (visits > 4000 || paths.length >= limit) {
      truncated = true;
      return;
    }
    const u = path[path.length - 1];
    const next = (successors[u] ?? []).filter((v) => critical[v]);
    if (!next.length) {
      paths.push([...path]);
      return;
    }
    for (const v of [...next].sort((a, b) => a.localeCompare(b))) dfs([...path, v]);
  };
  for (const s of [...starts].sort((a, b) => a.localeCompare(b))) dfs([s]);
  return { paths, truncated };
}

function pickCriticalPath(paths: string[][], variance: Record<string, number>): string[] {
  if (!paths.length) return [];
  const score = (path: string[]) => path.reduce((sum, aid) => sum + (variance[aid] ?? 0), 0);
  let best = paths[0];
  let bestVar = score(best);
  let bestKey = best.join("\0");
  for (const path of paths.slice(1)) {
    const v = score(path);
    const key = path.join("\0");
    if (v > bestVar + 1e-12 || (Math.abs(v - bestVar) <= 1e-12 && key < bestKey)) {
      best = path;
      bestVar = v;
      bestKey = key;
    }
  }
  return best;
}

/** Abramowitz & Stegun 26.2.17 approximation of Φ(z). */
function normCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  const p =
    1 -
    d * (0.31938153 * t - 0.356563782 * t ** 2 + 1.781477937 * t ** 3 - 1.821255978 * t ** 4 + 1.330274429 * t ** 5);
  return z >= 0 ? p : 1 - p;
}

/** Rational approximation of the standard normal quantile (Beasley-Springer-Moro). */
function normPpf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357745959009e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464858,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
