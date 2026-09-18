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

export function parsePertRequest(body: unknown): PertCpmRequest {
  const o = asRecord(body);
  const activitiesRaw = Array.isArray(o.activities) ? o.activities : [];
  assertLimit(
    activitiesRaw.length <= LIMITS.pertActivities,
    `PERT/CPM limitado a ${LIMITS.pertActivities} actividades en el plan Free`,
  );
  const activities: Activity[] = activitiesRaw.map((a, i) => {
    const row = asRecord(a);
    return {
      id: String(row.id ?? `A${i + 1}`),
      predecessors: Array.isArray(row.predecessors) ? row.predecessors.map(String) : [],
      duration: row.duration == null || row.duration === "" ? null : Number(row.duration),
      a: row.a == null || row.a === "" ? null : Number(row.a),
      m: row.m == null || row.m === "" ? null : Number(row.m),
      b: row.b == null || row.b === "" ? null : Number(row.b),
      crash_time: row.crash_time == null || row.crash_time === "" ? null : Number(row.crash_time),
      normal_cost: row.normal_cost == null || row.normal_cost === "" ? null : Number(row.normal_cost),
      crash_cost: row.crash_cost == null || row.crash_cost === "" ? null : Number(row.crash_cost),
    };
  });
  return {
    activities,
    mode: o.mode === "pert" ? "pert" : "cpm",
    target_time: o.target_time == null ? null : Number(o.target_time),
    target_probability: o.target_probability == null ? null : Number(o.target_probability),
    crash: Boolean(o.crash),
    crash_target: o.crash_target == null ? null : Number(o.crash_target),
    graph_kind: o.graph_kind === "gantt" ? "gantt" : "network",
  };
}

export function solve(body: unknown): ModuleResult {
  const req = parsePertRequest(body);
  if (!req.activities.length) throw new SolverError("empty activities");
  const acts = new Map(req.activities.map((a) => [a.id, a]));
  if (acts.size !== req.activities.length) throw new SolverError("duplicate activity ids");
  for (const a of req.activities) {
    for (const p of a.predecessors) {
      if (!acts.has(p)) throw new SolverError(`unknown predecessor ${p} for ${a.id}`);
    }
  }

  const duration: Record<string, number> = {};
  const te: Record<string, number> = {};
  const variance: Record<string, number> = {};
  for (const a of req.activities) {
    if (req.mode === "cpm") {
      if (a.duration == null || a.duration < 0) throw new SolverError(`activity ${a.id} requires duration >= 0`);
      duration[a.id] = a.duration;
      te[a.id] = a.duration;
      variance[a.id] = 0;
    } else {
      if (a.a == null || a.m == null || a.b == null) throw new SolverError(`activity ${a.id} requires a,m,b`);
      if (!(a.a <= a.m && a.m <= a.b)) throw new SolverError(`activity ${a.id} requires a<=m<=b`);
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
    if (req.mode !== "cpm") throw new SolverError("crashing is only supported in CPM mode");
    if (req.crash_target == null) throw new SolverError("crash=True requires crash_target");
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
    if (!warnings.join(" ").includes("Cannot crash further")) {
      warnings.push(`Cannot reach crash_target ${req.crash_target}; best duration ${projectDuration}`);
    }
  }
  const { es, ef, ls, lf, slack, critical, successors } = sched;
  const criticalPath = primaryCriticalPath(acts, successors, critical, order);
  if (countCriticalPaths(acts, successors, critical) > 1) {
    warnings.push("Existen varias rutas críticas; se seleccionó la secuencia lexicográficamente menor");
  }

  const scheduleRows = order.map((aid) => [
    aid,
    es[aid],
    ef[aid],
    ls[aid],
    lf[aid],
    slack[aid],
    critical[aid],
    req.mode === "pert" ? te[aid] : duration[aid],
    req.mode === "pert" ? variance[aid] : "",
  ]);
  const ganttRows = order.map((aid) => [aid, es[aid], ef[aid], critical[aid]]);
  const metrics: Record<string, number> = { project_duration: projectDuration };
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
      if (!(p > 0 && p < 1)) throw new SolverError("target_probability must be in (0,1)");
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

  const nodes = order.map((aid) => ({ id: aid, critical: critical[aid] }));
  const edges: Record<string, unknown>[] = [];
  for (const a of req.activities) {
    for (const p of a.predecessors) {
      edges.push({ source: p, target: a.id, critical: critical[p] && critical[a.id] });
    }
  }
  const tables: NamedTable[] = [
    {
      name: "schedule",
      columns: ["id", "IT", "FT", "ITa", "FTa", "holgura", "crítica", "te", "varianza"],
      rows: scheduleRows,
    },
    { name: "critical_path", columns: ["orden", "id"], rows: criticalPath.map((aid, i) => [i, aid]) },
    { name: "gantt", columns: ["id", "inicio", "fin", "crítica"], rows: ganttRows },
  ];
  if (req.crash) {
    tables.push({
      name: "durations_after_crash",
      columns: ["id", "duration"],
      rows: order.map((aid) => [aid, duration[aid]]),
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
          title: "Red del proyecto (PERT/CPM)",
          subtitle: "Magenta = actividades o arcos de la ruta crítica",
        };

  return okResult("pert_cpm", {
    status: crashInfeasible ? "infeasible" : "ok",
    variables: Object.fromEntries(order.map((aid) => [aid, duration[aid]])),
    objective_value: projectDuration,
    objective_sense: "min",
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
    if (a.crash_time == null || a.normal_cost == null || a.crash_cost == null) continue;
    if (a.crash_time < 0 || a.crash_time > (a.duration ?? 0)) {
      throw new SolverError(`activity ${a.id} requires 0 <= crash_time <= duration`);
    }
    if (a.crash_cost < a.normal_cost) {
      throw new SolverError(`activity ${a.id} crash_cost must be >= normal_cost`);
    }
  }
  let stepI = 0;
  while (true) {
    const sched = schedule(acts, duration, order);
    const t = sched.project_duration;
    if (t <= target + 1e-9) break;
    const candidates: [number, string, number][] = [];
    for (const [aid, a] of acts) {
      if (!sched.critical[aid]) continue;
      if (a.crash_time == null || a.normal_cost == null || a.crash_cost == null) continue;
      const room = duration[aid] - a.crash_time;
      if (room <= 1e-12) continue;
      const normalDur = a.duration ?? duration[aid];
      const span = normalDur - a.crash_time;
      if (span <= 1e-12) continue;
      const slope = (a.crash_cost - a.normal_cost) / span;
      candidates.push([slope, aid, Math.min(1, room)]);
    }
    if (!candidates.length) {
      warnings.push(`Cannot crash further to target ${target}; stopped at duration ${t}`);
      infeasible = true;
      break;
    }
    candidates.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
    const [slope, aid, amount] = candidates[0];
    duration[aid] -= amount;
    const costInc = slope * amount;
    totalCost += costInc;
    stepI++;
    steps.push({
      index: stepI,
      method: "crash",
      title: `Acelerar ${aid} en ${amount}`,
      tableau: null,
      meta: {
        activity: aid,
        amount,
        slope,
        cost_increment: costInc,
        project_duration_before: t,
      },
    });
    if (stepI > 500) {
      warnings.push("Se alcanzó el límite de iteraciones de aceleración");
      infeasible = true;
      break;
    }
  }
  return { duration, totalCost, steps, warnings, infeasible };
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
  if (order.length !== acts.size) throw new SolverError("cycle detected in activity network");
  return order;
}

function primaryCriticalPath(
  acts: Map<string, Activity>,
  successors: Record<string, string[]>,
  critical: Record<string, boolean>,
  order: string[],
): string[] {
  let starts = order.filter((aid) => critical[aid] && !acts.get(aid)!.predecessors.length);
  if (!starts.length) starts = order.filter((aid) => critical[aid]);
  let best: string[] | null = null;
  const dfs = (path: string[]) => {
    const u = path[path.length - 1];
    const critSucc = (successors[u] ?? []).filter((v) => critical[v]);
    if (!critSucc.length) {
      if (best == null || path.join("\0") < best.join("\0")) best = [...path];
      return;
    }
    for (const v of [...critSucc].sort()) dfs([...path, v]);
  };
  for (const s of [...starts].sort()) dfs([s]);
  return best ?? [];
}

function countCriticalPaths(
  acts: Map<string, Activity>,
  successors: Record<string, string[]>,
  critical: Record<string, boolean>,
): number {
  const starts = [...acts.values()].filter((a) => critical[a.id] && !a.predecessors.length).map((a) => a.id);
  let count = 0;
  const dfs = (u: string) => {
    const critSucc = (successors[u] ?? []).filter((v) => critical[v]);
    if (!critSucc.length) {
      count++;
      return;
    }
    for (const v of critSucc) dfs(v);
  };
  for (const s of starts) dfs(s);
  return count;
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
