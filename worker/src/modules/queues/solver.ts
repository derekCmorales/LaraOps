import { SolverError } from "../../errors";
import { LIMITS, assertLimit } from "../../limits";
import type { ModuleResult, NamedTable } from "../../schema";
import { okResult } from "../../schema";

const INF = Number.POSITIVE_INFINITY;

export type QueueModel = "M/M/1" | "M/M/s" | "M/M/1/K" | "M/M/s/N" | "M/M/s/K" | "M/G/1" | "M/D/1";

export type QueuesRequest = {
  model: QueueModel;
  lambda: number;
  mu: number;
  s?: number | null;
  K?: number | null;
  N?: number | null;
  service_std_dev?: number | null;
  include_pn?: boolean;
  cost_waiting_per_unit_time?: number | null;
  cost_server_per_unit_time?: number | null;
  optimize_s?: boolean;
  s_max?: number | null;
};

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("payload debe ser un objeto JSON");
  }
  return body as Record<string, unknown>;
}

export function parseQueuesRequest(body: unknown): QueuesRequest {
  const o = asRecord(body);
  const model = o.model as QueueModel;
  const allowed: QueueModel[] = ["M/M/1", "M/M/s", "M/M/1/K", "M/M/s/N", "M/M/s/K", "M/G/1", "M/D/1"];
  if (!allowed.includes(model)) throw new SolverError("modelo de colas no soportado");
  const lam = Number(o.lambda);
  const mu = Number(o.mu);
  if (!(lam > 0) || !(mu > 0)) throw new SolverError("lambda y mu deben ser > 0");
  const req: QueuesRequest = {
    model,
    lambda: lam,
    mu,
    s: o.s == null ? null : Number(o.s),
    K: o.K == null ? null : Number(o.K),
    N: o.N == null ? null : Number(o.N),
    service_std_dev: o.service_std_dev == null ? null : Number(o.service_std_dev),
    include_pn: o.include_pn !== false,
    cost_waiting_per_unit_time: o.cost_waiting_per_unit_time == null ? null : Number(o.cost_waiting_per_unit_time),
    cost_server_per_unit_time: o.cost_server_per_unit_time == null ? null : Number(o.cost_server_per_unit_time),
    optimize_s: Boolean(o.optimize_s),
    s_max: o.s_max == null ? null : Number(o.s_max),
  };
  if (["M/M/s", "M/M/s/N", "M/M/s/K"].includes(model) && req.s == null) {
    throw new SolverError("s is required for multi-server models");
  }
  if (model === "M/M/1/K" && req.K == null) throw new SolverError("K is required for M/M/1/K");
  if (model === "M/M/s/K" && req.K == null) throw new SolverError("K is required for M/M/s/K");
  if (model === "M/M/s/N" && req.N == null) throw new SolverError("N is required for M/M/s/N");
  if (model === "M/G/1" && req.service_std_dev == null) {
    throw new SolverError("service_std_dev is required for M/G/1");
  }
  if (req.s != null) assertLimit(req.s <= LIMITS.queuesSMax, `s no puede superar ${LIMITS.queuesSMax}`);
  if (req.K != null) assertLimit(req.K <= LIMITS.queuesK, `K no puede superar ${LIMITS.queuesK}`);
  if (req.N != null) assertLimit(req.N <= LIMITS.queuesN, `N no puede superar ${LIMITS.queuesN}`);
  if (req.s_max != null) assertLimit(req.s_max <= LIMITS.queuesSMax, `s_max no puede superar ${LIMITS.queuesSMax}`);
  return req;
}

function factorial(n: number): number {
  let x = 1;
  for (let i = 2; i <= n; i++) x *= i;
  return x;
}

export function solve(body: unknown): ModuleResult {
  const req = parseQueuesRequest(body);
  const lam = req.lambda;
  const mu = req.mu;
  const warnings: string[] = [];
  const { metrics, pn } = dispatch(req, lam, mu, warnings);

  const tables: NamedTable[] = [];
  let graph = null;
  if (pn && req.include_pn) {
    tables.push({
      name: "Pn",
      columns: ["n", "Pn"],
      rows: pn.map((p, i) => [i, p]),
    });
    graph = {
      type: "xy" as const,
      series: [{ name: "Pn", x: pn.map((_, i) => i), y: pn.map((p) => p) }],
      x_label: "n (clientes en el sistema)",
      y_label: "Probabilidad Pn",
      title: "Distribución de probabilidad del número de clientes",
      subtitle: `Modelo ${req.model}`,
      kind: "bar",
    };
  }

  applyCosts(req, metrics, warnings);
  const variables: Record<string, number> = {};
  for (const [k, v] of Object.entries(metrics)) {
    if (typeof v === "number" && Number.isFinite(v)) variables[k] = v;
  }

  if (req.optimize_s) {
    const costTable = optimizeServers(req, lam, mu, warnings);
    if (costTable) tables.push(costTable);
  }

  return okResult("queues", {
    status: "ok",
    variables,
    metrics,
    graph,
    tables: tables.length ? tables : null,
    warnings,
  });
}

function dispatch(
  req: QueuesRequest,
  lam: number,
  mu: number,
  warnings: string[],
): { metrics: Record<string, number>; pn: number[] | null } {
  if (req.model === "M/M/1") return mm1(lam, mu, req.include_pn !== false, warnings);
  if (req.model === "M/M/s") return mms(lam, mu, Number(req.s), req.include_pn !== false, warnings);
  if (req.model === "M/M/1/K") return mm1k(lam, mu, Number(req.K), warnings);
  if (req.model === "M/M/s/N") return mmsn(lam, mu, Number(req.s), Number(req.N), warnings);
  if (req.model === "M/M/s/K") return mmsk(lam, mu, Number(req.s), Number(req.K), warnings);
  if (req.model === "M/G/1") return mg1(lam, mu, Number(req.service_std_dev), warnings);
  return md1(lam, mu, warnings);
}

function mm1(lam: number, mu: number, includePn: boolean, warnings: string[]) {
  const rho = lam / mu;
  if (rho >= 1) {
    warnings.push(
      "rho >= 1: el sistema M/M/1 es inestable (la cola crece sin límite); L, Lq, W y Wq tienden a infinito",
    );
    return { metrics: { L: INF, Lq: INF, W: INF, Wq: INF, rho, P0: 0 }, pn: null };
  }
  const p0 = 1 - rho;
  const lq = rho ** 2 / (1 - rho);
  const L = rho / (1 - rho);
  const W = 1 / (mu - lam);
  const wq = lam / (mu * (mu - lam));
  const pn = includePn ? Array.from({ length: 21 }, (_, n) => p0 * rho ** n) : null;
  return { metrics: { L, Lq: lq, W, Wq: wq, rho, P0: p0 }, pn };
}

function mms(lam: number, mu: number, s: number, includePn: boolean, warnings: string[]) {
  const rho = lam / (s * mu);
  if (rho >= 1) {
    warnings.push(
      `rho >= 1: el sistema M/M/${s} es inestable (lambda >= s*mu); L, Lq, W y Wq tienden a infinito`,
    );
    return { metrics: { L: INF, Lq: INF, W: INF, Wq: INF, rho, P0: 0 }, pn: null };
  }
  let sumTerm = 0;
  for (let n = 0; n < s; n++) sumTerm += (lam / mu) ** n / factorial(n);
  const last = (lam / mu) ** s / (factorial(s) * (1 - rho));
  const p0 = 1 / (sumTerm + last);
  const lq = (p0 * (lam / mu) ** s * rho) / (factorial(s) * (1 - rho) ** 2);
  const L = lq + lam / mu;
  const wq = lq / lam;
  const W = wq + 1 / mu;
  let pn: number[] | null = null;
  if (includePn) {
    const nMax = Math.max(s + 15, 21);
    pn = [];
    for (let n = 0; n < nMax; n++) {
      if (n < s) pn.push((p0 * (lam / mu) ** n) / factorial(n));
      else pn.push((p0 * (lam / mu) ** n) / (factorial(s) * s ** (n - s)));
    }
  }
  return { metrics: { L, Lq: lq, W, Wq: wq, rho, P0: p0 }, pn };
}

function mm1k(lam: number, mu: number, K: number, warnings: string[]) {
  const r = lam / mu;
  let p0: number;
  let pn: number[];
  if (Math.abs(r - 1) < 1e-12) {
    p0 = 1 / (K + 1);
    pn = Array(K + 1).fill(p0);
  } else {
    p0 = (1 - r) / (1 - r ** (K + 1));
    pn = Array.from({ length: K + 1 }, (_, n) => p0 * r ** n);
  }
  const L = pn.reduce((s, p, n) => s + n * p, 0);
  const lamEff = lam * (1 - pn[K]);
  const lq = L - lamEff / mu;
  const W = lamEff > 1e-12 ? L / lamEff : INF;
  const wq = lamEff > 1e-12 ? lq / lamEff : INF;
  const rho = 1 - p0;
  warnings.push("rho reportado como 1-P0 (utilización del servidor) para capacidad finita");
  return { metrics: { L, Lq: lq, W, Wq: wq, rho, P0: p0, lambda_eff: lamEff }, pn };
}

function mmsn(lam: number, mu: number, s: number, N: number, warnings: string[]) {
  const pnUnnorm = [1];
  for (let n = 1; n <= N; n++) {
    if (n <= s) pnUnnorm.push((pnUnnorm[n - 1] * (N - n + 1) * lam) / (n * mu));
    else pnUnnorm.push((pnUnnorm[n - 1] * (N - n + 1) * lam) / (s * mu));
  }
  const total = pnUnnorm.reduce((a, b) => a + b, 0);
  const pn = pnUnnorm.map((x) => x / total);
  const p0 = pn[0];
  const L = pn.reduce((s0, p, n) => s0 + n * p, 0);
  const lamEff = lam * pn.reduce((s0, p, n) => s0 + (N - n) * p, 0);
  const busy = pn.reduce((s0, p, n) => s0 + Math.min(n, s) * p, 0);
  const lq = L - busy;
  const W = lamEff > 1e-12 ? L / lamEff : INF;
  const wq = lamEff > 1e-12 ? lq / lamEff : INF;
  const rho = busy / s;
  if (N <= s) warnings.push("N <= s: la cola nunca se forma en esta población finita (Lq = 0)");
  return { metrics: { L, Lq: lq, W, Wq: wq, rho, P0: p0, lambda_eff: lamEff }, pn };
}

function mmsk(lam: number, mu: number, s: number, K: number, warnings: string[]) {
  if (K < s) throw new SolverError("K debe ser mayor o igual que s en M/M/s/K");
  const r = lam / mu;
  const pnUnnorm = [1];
  for (let n = 1; n <= K; n++) {
    if (n <= s) pnUnnorm.push((pnUnnorm[n - 1] * r) / n);
    else pnUnnorm.push((pnUnnorm[n - 1] * r) / s);
  }
  const total = pnUnnorm.reduce((a, b) => a + b, 0);
  const pn = pnUnnorm.map((x) => x / total);
  const p0 = pn[0];
  const L = pn.reduce((s0, p, n) => s0 + n * p, 0);
  const lamEff = lam * (1 - pn[K]);
  const busy = lamEff / mu;
  const lq = L - busy;
  const W = lamEff > 1e-12 ? L / lamEff : INF;
  const wq = lamEff > 1e-12 ? lq / lamEff : INF;
  const rho = busy / s;
  void warnings;
  return { metrics: { L, Lq: lq, W, Wq: wq, rho, P0: p0, lambda_eff: lamEff }, pn };
}

function mg1(lam: number, mu: number, sigma: number, warnings: string[]) {
  const rho = lam / mu;
  if (rho >= 1) {
    warnings.push("rho >= 1: el sistema M/G/1 es inestable; L, Lq, W y Wq tienden a infinito");
    return { metrics: { L: INF, Lq: INF, W: INF, Wq: INF, rho, P0: 0 }, pn: null };
  }
  const lq = (lam ** 2 * sigma ** 2 + rho ** 2) / (2 * (1 - rho));
  const L = lq + rho;
  const wq = lq / lam;
  const W = wq + 1 / mu;
  const p0 = 1 - rho;
  warnings.push("M/G/1 usa la fórmula de Pollaczek-Khinchine; no existe distribución Pn de forma cerrada");
  return { metrics: { L, Lq: lq, W, Wq: wq, rho, P0: p0 }, pn: null };
}

function md1(lam: number, mu: number, warnings: string[]) {
  return mg1(lam, mu, 0, warnings);
}

function applyCosts(req: QueuesRequest, metrics: Record<string, number>, warnings: string[]) {
  if (req.cost_waiting_per_unit_time == null && req.cost_server_per_unit_time == null) return;
  if (metrics.L === INF) {
    warnings.push("No se calculan costos: el sistema es inestable (L = infinito)");
    return;
  }
  const sUsed = req.s ?? 1;
  const cw = req.cost_waiting_per_unit_time ?? 0;
  const cs = req.cost_server_per_unit_time ?? 0;
  const costWaiting = cw * metrics.L;
  const costServer = cs * sUsed;
  metrics.cost_waiting = costWaiting;
  metrics.cost_server = costServer;
  metrics.cost_total = costWaiting + costServer;
}

function optimizeServers(
  req: QueuesRequest,
  lam: number,
  mu: number,
  warnings: string[],
): NamedTable | null {
  if (!["M/M/s", "M/M/s/K", "M/M/s/N"].includes(req.model)) {
    warnings.push("optimize_s solo aplica a modelos multi-servidor (M/M/s, M/M/s/K, M/M/s/N)");
    return null;
  }
  if (req.cost_waiting_per_unit_time == null || req.cost_server_per_unit_time == null) {
    warnings.push("optimize_s requiere cost_waiting_per_unit_time y cost_server_per_unit_time");
    return null;
  }
  const cw = req.cost_waiting_per_unit_time;
  const cs = req.cost_server_per_unit_time;
  const sMin = Math.max(1, req.model !== "M/M/s/N" ? Math.ceil(lam / mu) : 1);
  const sMax = req.s_max ?? Math.max(sMin + 10, (req.s ?? sMin) + 10);
  const rows: unknown[][] = [];
  let bestS: number | null = null;
  let bestCost = INF;
  const local: string[] = [];
  for (let sTry = 1; sTry <= sMax; sTry++) {
    let m: Record<string, number>;
    try {
      if (req.model === "M/M/s") m = mms(lam, mu, sTry, false, local).metrics;
      else if (req.model === "M/M/s/K") {
        const K = Number(req.K);
        if (K < sTry) continue;
        m = mmsk(lam, mu, sTry, K, local).metrics;
      } else {
        const N = Number(req.N);
        if (sTry > N) continue;
        m = mmsn(lam, mu, sTry, N, local).metrics;
      }
    } catch {
      continue;
    }
    if (m.L === INF) continue;
    const costWaiting = cw * m.L;
    const costServer = cs * sTry;
    const costTotal = costWaiting + costServer;
    rows.push([sTry, m.L, m.Lq, m.W, m.Wq, m.rho, costWaiting, costServer, costTotal, false]);
    if (costTotal < bestCost) {
      bestCost = costTotal;
      bestS = sTry;
    }
  }
  if (bestS == null) {
    warnings.push("No fue posible optimizar s: ningún valor evaluado resultó estable");
    return null;
  }
  for (const row of rows) row[row.length - 1] = row[0] === bestS;
  warnings.push(`Número óptimo de servidores recomendado: s = ${bestS} (costo total = ${bestCost.toPrecision(4)})`);
  return {
    name: "cost_by_s",
    columns: [
      "servidores",
      "L",
      "Lq",
      "W",
      "Wq",
      "rho",
      "costo_espera",
      "costo_servidor",
      "costo_total",
      "óptimo",
    ],
    rows,
  };
}
