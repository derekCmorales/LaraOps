import { SolverError } from "../../errors";
import { LIMITS } from "../../limits";
import type { ModuleResult, NamedTable } from "../../schema";
import { okResult } from "../../schema";

const INF = Number.POSITIVE_INFINITY;

export type QueueModel = "M/M/1" | "M/M/s" | "M/M/1/K" | "M/M/s/N" | "M/M/s/K" | "M/G/1" | "M/D/1";
export type WaitingCostBasis = "system" | "queue";

export const QUEUE_MODELS: QueueModel[] = ["M/M/1", "M/M/s", "M/M/1/K", "M/M/s/K", "M/M/s/N", "M/G/1", "M/D/1"];
const MULTI_SERVER: QueueModel[] = ["M/M/s", "M/M/s/K", "M/M/s/N"];

export type QueuesRequest = {
  model: QueueModel;
  lambda: number;
  mu: number;
  s: number;
  K: number | null;
  N: number | null;
  service_std_dev: number | null;
  include_pn: boolean;
  cost_waiting_per_unit_time: number | null;
  cost_server_per_unit_time: number | null;
  waiting_cost_basis: WaitingCostBasis;
  optimize_s: boolean;
  s_max: number | null;
  wait_threshold: number | null;
  time_unit: string | null;
};

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("payload debe ser un objeto JSON");
  }
  return body as Record<string, unknown>;
}

/** Número opcional: null si falta; NaN si no es numérico (se reporta con el mensaje del campo). */
function optNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return Number.NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function rate(value: unknown, missing: string, positive: string): number {
  const n = optNumber(value);
  if (n == null || Number.isNaN(n)) throw new SolverError(missing);
  if (!(n > 0)) throw new SolverError(positive);
  return n;
}

function integer(value: unknown, missing: string, invalid: string, max: number, tooBig: string): number {
  const n = optNumber(value);
  if (n == null) throw new SolverError(missing);
  if (Number.isNaN(n) || !Number.isInteger(n) || n < 1) throw new SolverError(invalid);
  if (n > max) throw new SolverError(tooBig);
  return n;
}

function nonNegative(value: unknown, message: string): number | null {
  const n = optNumber(value);
  if (n == null) return null;
  if (Number.isNaN(n) || n < 0) throw new SolverError(message);
  return n;
}

export function parseQueuesRequest(body: unknown): QueuesRequest {
  const o = asRecord(body);
  const model = o.model as QueueModel;
  if (!QUEUE_MODELS.includes(model)) {
    throw new SolverError(`Modelo de colas no soportado. Usa uno de: ${QUEUE_MODELS.join(", ")}.`);
  }
  const lambda = rate(
    o.lambda,
    "Ingresa la tasa de llegada λ (clientes por unidad de tiempo).",
    "La tasa de llegada λ debe ser mayor que 0.",
  );
  const mu = rate(
    o.mu,
    "Ingresa la tasa de servicio μ (clientes que atiende un servidor por unidad de tiempo).",
    "La tasa de servicio μ debe ser mayor que 0.",
  );

  let s = 1;
  if (MULTI_SERVER.includes(model)) {
    s = integer(
      o.s,
      "Indica el número de servidores s.",
      "El número de servidores s debe ser un entero mayor o igual que 1.",
      LIMITS.queuesSMax,
      `s no puede superar ${LIMITS.queuesSMax}`,
    );
  }

  let K: number | null = null;
  if (model === "M/M/1/K" || model === "M/M/s/K") {
    K = integer(
      o.K,
      "Indica la capacidad máxima K (clientes en la fila más los que se atienden).",
      "La capacidad K debe ser un entero mayor o igual que 1.",
      LIMITS.queuesK,
      `K no puede superar ${LIMITS.queuesK}`,
    );
    if (K < s) {
      throw new SolverError(`La capacidad K (${K}) debe ser al menos igual al número de servidores s (${s}).`);
    }
  }

  let N: number | null = null;
  if (model === "M/M/s/N") {
    N = integer(
      o.N,
      "Indica el tamaño de la población N (clientes potenciales).",
      "La población N debe ser un entero mayor o igual que 1.",
      LIMITS.queuesN,
      `N no puede superar ${LIMITS.queuesN}`,
    );
  }

  let sigma: number | null = null;
  if (model === "M/G/1") {
    sigma = nonNegative(o.service_std_dev, "La desviación estándar σ del servicio no puede ser negativa.");
    if (sigma == null) throw new SolverError("Indica la desviación estándar σ del tiempo de servicio.");
  }

  const basis = o.waiting_cost_basis ?? "system";
  if (basis !== "system" && basis !== "queue") {
    throw new SolverError("waiting_cost_basis debe ser «system» (L) o «queue» (Lq).");
  }

  let sMax: number | null = null;
  if (optNumber(o.s_max) != null) {
    sMax = integer(
      o.s_max,
      "",
      "El máximo de servidores a comparar debe ser un entero mayor o igual que 1.",
      LIMITS.queuesSMax,
      `s_max no puede superar ${LIMITS.queuesSMax}`,
    );
  }

  const timeUnit = typeof o.time_unit === "string" && o.time_unit.trim() ? o.time_unit.trim().slice(0, 24) : null;

  return {
    model,
    lambda,
    mu,
    s,
    K,
    N,
    service_std_dev: sigma,
    include_pn: o.include_pn !== false,
    cost_waiting_per_unit_time: nonNegative(o.cost_waiting_per_unit_time, "El costo de espera no puede ser negativo."),
    cost_server_per_unit_time: nonNegative(o.cost_server_per_unit_time, "El costo por servidor no puede ser negativo."),
    waiting_cost_basis: basis,
    optimize_s: Boolean(o.optimize_s),
    s_max: sMax,
    wait_threshold: nonNegative(o.wait_threshold, "El tiempo t para la probabilidad de espera no puede ser negativo."),
    time_unit: timeUnit,
  };
}

/* ——— Núcleo de cálculo ——— */

type Core = {
  metrics: Record<string, number>;
  /** Distribución completa (capacidad o población finita) o truncada (capacidad infinita). */
  pn: number[] | null;
  stable: boolean;
  /** P(Wq > t); null cuando no hay forma cerrada (M/G/1, M/D/1). */
  wqTail: ((t: number) => number) | null;
  /** P(W > t) cuando hay forma cerrada; si no, se integra a partir de wqTail. */
  wTail: ((t: number) => number) | null;
  /** Valores intermedios para mostrar las fórmulas con sustitución. */
  parts: Record<string, number>;
};

const PN_TAIL = 1e-3;

/** Recorta el ruido de punto flotante en probabilidades (p. ej. 1.0000000000000018). */
function prob(x: number): number {
  return Math.min(1, Math.max(0, x));
}
const PN_MAX_ROWS = 200;

/** Probabilidades de nacimiento y muerte normalizadas en escala logarítmica (sin desbordes). */
function birthDeath(maxN: number, ratio: (n: number) => number): number[] {
  const logW = [0];
  for (let n = 1; n <= maxN; n++) {
    const r = ratio(n);
    logW.push(r > 0 ? logW[n - 1] + Math.log(r) : Number.NEGATIVE_INFINITY);
  }
  const top = Math.max(...logW);
  const w = logW.map((x) => Math.exp(x - top));
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / total);
}

/** P(Erlang(k, rate) > t) para k = 1..m como arreglo acumulado de Poisson (escala log). */
function erlangTails(m: number, x: number): number[] {
  // tails[k] = P(Poisson(x) <= k - 1) = P(Erlang(k) > t), con x = rate · t.
  const tails = [0];
  if (x <= 0) {
    for (let k = 1; k <= m; k++) tails.push(1);
    return tails;
  }
  let logTerm = -x;
  let cum = 0;
  for (let k = 1; k <= m; k++) {
    if (k > 1) logTerm += Math.log(x) - Math.log(k - 1);
    cum += Math.exp(logTerm);
    tails.push(Math.min(1, cum));
  }
  return tails;
}

/** P(Wq > t) en modelos finitos: mezcla de Erlang según lo que ve el cliente al llegar. */
function finiteWqTail(arrival: number[], s: number, mu: number): (t: number) => number {
  const maxK = arrival.length - s;
  return (t: number) => {
    if (maxK <= 0) return 0;
    const tails = erlangTails(maxK, s * mu * t);
    let total = 0;
    for (let n = s; n < arrival.length; n++) total += arrival[n] * tails[n - s + 1];
    return prob(total);
  };
}

/** P(W > t) = P(S > t) + ∫₀ᵗ μe^{-μy} P(Wq > t − y) dy (Simpson). */
function integrateWTail(wq: (t: number) => number, mu: number): (t: number) => number {
  return (t: number) => {
    if (t <= 0) return 1;
    const steps = 200;
    const h = t / steps;
    let acc = 0;
    for (let i = 0; i <= steps; i++) {
      const y = i * h;
      const weight = i === 0 || i === steps ? 1 : i % 2 ? 4 : 2;
      acc += weight * mu * Math.exp(-mu * y) * wq(t - y);
    }
    return prob(Math.exp(-mu * t) + (acc * h) / 3);
  };
}

function unstable(lam: number, mu: number, s: number, suggestServers: boolean): Core {
  const r = lam / mu;
  const metrics: Record<string, number> = {
    L: INF,
    Lq: INF,
    W: INF,
    Wq: INF,
    rho: lam / (s * mu),
    P0: 0,
    Pw: 1,
    r,
    servers: s,
    busy_servers: s,
    idle_servers: 0,
  };
  // Con varios servidores en paralelo bastaría con s > λ/μ.
  if (suggestServers) metrics.s_min_stable = Math.floor(r) + 1;
  return {
    metrics,
    pn: null,
    stable: false,
    wqTail: null,
    wTail: null,
    parts: {},
  };
}

/** M/M/s con capacidad infinita (s = 1 es M/M/1). */
function mms(lam: number, mu: number, s: number, includePn: boolean): Core {
  const r = lam / mu;
  const rho = r / s;
  if (rho >= 1) return unstable(lam, mu, s, true);
  let w = 1;
  let below = 0;
  for (let n = 0; n < s; n++) {
    below += w;
    w = (w * r) / (n + 1);
  }
  // w = r^s / s!
  const tail = w / (1 - rho);
  const P0 = 1 / (below + tail);
  const Pw = tail * P0;
  const Lq = (Pw * rho) / (1 - rho);
  const L = Lq + r;
  const Wq = Lq / lam;
  const W = Wq + 1 / mu;

  let pn: number[] | null = null;
  if (includePn) {
    pn = [];
    let p = P0;
    let cum = 0;
    for (let n = 0; n < PN_MAX_ROWS; n++) {
      if (n > 0) p = (p * r) / Math.min(n, s);
      pn.push(p);
      cum += p;
      if (n >= Math.max(s + 1, 5) && 1 - cum < PN_TAIL) break;
    }
  }

  const decay = s * mu - lam;
  const wqTail = (t: number) => Pw * Math.exp(-decay * t);
  const gap = s - 1 - r;
  // P(W > t) = e^{-μt}·[1 + Pw·(1 − e^{-μt(s−1−r)}) / (s−1−r)], escrito sin desbordes cuando s−1−r < 0.
  const wTail = (t: number) => {
    if (t <= 0) return 1;
    const a1 = Math.exp(-mu * t);
    let value: number;
    if (Math.abs(gap) < 1e-12) value = a1 * (1 + Pw * mu * t);
    else if (gap > 0) value = a1 * (1 - (Pw * Math.expm1(-mu * t * gap)) / gap);
    else value = a1 + (Pw * (Math.exp(-mu * t * (s - r)) - a1)) / -gap;
    return prob(value);
  };

  return {
    metrics: {
      L,
      Lq,
      W,
      Wq,
      rho,
      P0,
      Pw,
      r,
      servers: s,
      busy_servers: r,
      idle_servers: s - r,
    },
    pn,
    stable: true,
    wqTail,
    wTail,
    parts: { below, rs_fact: w, tail },
  };
}

/** M/M/s/K: capacidad finita K (s = 1 es M/M/1/K). */
function mmsk(lam: number, mu: number, s: number, K: number): Core {
  const r = lam / mu;
  const pn = birthDeath(K, (n) => r / Math.min(n, s));
  const P0 = pn[0];
  const PK = pn[K];
  const lamEff = lam * (1 - PK);
  let L = 0;
  let Lq = 0;
  for (let n = 0; n <= K; n++) {
    L += n * pn[n];
    if (n > s) Lq += (n - s) * pn[n];
  }
  const busy = L - Lq;
  const W = lamEff > 0 ? L / lamEff : INF;
  const Wq = lamEff > 0 ? Lq / lamEff : INF;
  const accepted = 1 - PK;
  const arrival = pn.slice(0, K).map((p) => (accepted > 0 ? p / accepted : 0));
  let Pw = 0;
  for (let n = s; n < K; n++) Pw += arrival[n];
  const wqTail = finiteWqTail(arrival, s, mu);
  return {
    metrics: {
      L,
      Lq,
      W,
      Wq,
      rho: prob(busy / s),
      P0,
      Pw: prob(Pw),
      r,
      servers: s,
      busy_servers: Math.min(s, busy),
      idle_servers: Math.max(0, s - busy),
      lambda_eff: lamEff,
      P_block: PK,
      lambda_lost: lam * PK,
    },
    pn,
    stable: true,
    wqTail,
    wTail: integrateWTail(wqTail, mu),
    parts: {},
  };
}

/** M/M/s//N: población finita de N clientes; λ es la tasa de cada cliente fuera del sistema. */
function mmsn(lam: number, mu: number, s: number, N: number): Core {
  const pn = birthDeath(N, (n) => ((N - n + 1) * lam) / (Math.min(n, s) * mu));
  const P0 = pn[0];
  let L = 0;
  let Lq = 0;
  for (let n = 0; n <= N; n++) {
    L += n * pn[n];
    if (n > s) Lq += (n - s) * pn[n];
  }
  const lamEff = lam * (N - L);
  const busy = L - Lq;
  const W = lamEff > 0 ? L / lamEff : INF;
  const Wq = lamEff > 0 ? Lq / lamEff : INF;
  const outside = N - L;
  const arrival = pn.slice(0, N).map((p, n) => (outside > 0 ? ((N - n) * p) / outside : 0));
  let Pw = 0;
  for (let n = s; n < N; n++) Pw += arrival[n];
  const wqTail = finiteWqTail(arrival, s, mu);
  return {
    metrics: {
      L,
      Lq,
      W,
      Wq,
      rho: prob(busy / s),
      P0,
      Pw: prob(Pw),
      r: lam / mu,
      servers: s,
      busy_servers: Math.min(s, busy),
      idle_servers: Math.max(0, s - busy),
      lambda_eff: lamEff,
      customers_outside: outside,
    },
    pn,
    stable: true,
    wqTail,
    wTail: integrateWTail(wqTail, mu),
    parts: {},
  };
}

/** M/G/1 con Pollaczek-Khinchine; M/D/1 es el caso σ = 0. */
function mg1(lam: number, mu: number, sigma: number): Core {
  const rho = lam / mu;
  if (rho >= 1) return unstable(lam, mu, 1, false);
  const Lq = (lam ** 2 * sigma ** 2 + rho ** 2) / (2 * (1 - rho));
  const L = Lq + rho;
  const Wq = Lq / lam;
  const W = Wq + 1 / mu;
  return {
    metrics: {
      L,
      Lq,
      W,
      Wq,
      rho,
      P0: 1 - rho,
      Pw: rho,
      r: rho,
      servers: 1,
      busy_servers: rho,
      idle_servers: 1 - rho,
      cv_service: sigma * mu,
    },
    pn: null,
    stable: true,
    wqTail: null,
    wTail: null,
    parts: {},
  };
}

function evaluate(req: QueuesRequest, lam: number, s: number, includePn: boolean): Core {
  const mu = req.mu;
  switch (req.model) {
    case "M/M/1":
      return mms(lam, mu, 1, includePn);
    case "M/M/s":
      return mms(lam, mu, s, includePn);
    case "M/M/1/K":
      return mmsk(lam, mu, 1, Number(req.K));
    case "M/M/s/K":
      return mmsk(lam, mu, s, Number(req.K));
    case "M/M/s/N":
      return mmsn(lam, mu, s, Number(req.N));
    case "M/G/1":
      return mg1(lam, mu, Number(req.service_std_dev));
    default:
      return mg1(lam, mu, 0);
  }
}

/* ——— Presentación ——— */

/** Número corto para las sustituciones: hasta 4 decimales, sin ceros de sobra. */
export function fmt(x: number): string {
  if (!Number.isFinite(x)) return x > 0 ? "∞" : "-∞";
  const r = Number(x.toFixed(4));
  return String(r === 0 ? 0 : r);
}

type FormulaRow = [string, string, string, number | null, string];

function formulaRows(req: QueuesRequest, core: Core): FormulaRow[] {
  const m = core.metrics;
  const lam = req.lambda;
  const mu = req.mu;
  const s = req.s;
  const t = req.time_unit ?? "unidad de tiempo";
  const cl = "clientes";
  const rows: FormulaRow[] = [];
  const push = (label: string, formula: string, subst: string, value: number | null, unit = "") =>
    rows.push([label, formula, subst, value != null && Number.isFinite(value) ? value : null, unit]);

  if (!core.stable) {
    const multi = req.model === "M/M/s";
    const sm = multi ? "s·μ" : "μ";
    push(
      "Utilización ρ",
      multi ? "ρ = λ / (s·μ)" : "ρ = λ / μ",
      multi ? `${fmt(lam)} / (${s} · ${fmt(mu)})` : `${fmt(lam)} / ${fmt(mu)}`,
      m.rho,
    );
    push("Condición de estabilidad", `ρ < 1  ⇔  λ < ${sm}`, `${fmt(m.rho)} ≥ 1`, null);
    return rows;
  }

  switch (req.model) {
    case "M/M/1":
      push("Utilización ρ", "ρ = λ / μ", `${fmt(lam)} / ${fmt(mu)}`, m.rho);
      push("Prob. de sistema vacío P0", "P0 = 1 - ρ", `1 - ${fmt(m.rho)}`, m.P0);
      push("Clientes en el sistema L", "L = ρ / (1 - ρ)", `${fmt(m.rho)} / (1 - ${fmt(m.rho)})`, m.L, cl);
      push("Clientes en la fila Lq", "Lq = ρ² / (1 - ρ)", `${fmt(m.rho)}² / (1 - ${fmt(m.rho)})`, m.Lq, cl);
      push("Tiempo en el sistema W", "W = 1 / (μ - λ)", `1 / (${fmt(mu)} - ${fmt(lam)})`, m.W, t);
      push("Tiempo en la fila Wq", "Wq = λ / (μ·(μ - λ))", `${fmt(lam)} / (${fmt(mu)} · (${fmt(mu)} - ${fmt(lam)}))`, m.Wq, t);
      push("Prob. de esperar Pw", "Pw = ρ", fmt(m.rho), m.Pw);
      push("Prob. de n clientes Pn", "Pn = (1 - ρ)·ρ^n", "ver tabla Pn", null);
      break;
    case "M/M/s": {
      const p = core.parts;
      push("Utilización ρ", "ρ = λ / (s·μ)", `${fmt(lam)} / (${s} · ${fmt(mu)})`, m.rho);
      push(
        "Prob. de sistema vacío P0",
        "P0 = [Σ(n=0..s-1) (λ/μ)^n / n! + (λ/μ)^s / (s!·(1 - ρ))]^-1",
        `[${fmt(p.below)} + ${fmt(p.tail)}]^-1`,
        m.P0,
      );
      push(
        "Prob. de esperar Pw (Erlang C)",
        "Pw = (λ/μ)^s · P0 / (s!·(1 - ρ))",
        `${fmt(m.r)}^${s} · ${fmt(m.P0)} / (${s}! · (1 - ${fmt(m.rho)}))`,
        m.Pw,
      );
      push("Clientes en la fila Lq", "Lq = Pw · ρ / (1 - ρ)", `${fmt(m.Pw)} · ${fmt(m.rho)} / (1 - ${fmt(m.rho)})`, m.Lq, cl);
      push("Clientes en el sistema L", "L = Lq + λ/μ", `${fmt(m.Lq)} + ${fmt(m.r)}`, m.L, cl);
      push("Tiempo en la fila Wq", "Wq = Lq / λ", `${fmt(m.Lq)} / ${fmt(lam)}`, m.Wq, t);
      push("Tiempo en el sistema W", "W = Wq + 1/μ", `${fmt(m.Wq)} + 1 / ${fmt(mu)}`, m.W, t);
      push("Prob. de n clientes Pn", "Pn = P0·(λ/μ)^n / n!  (n ≤ s);  P0·(λ/μ)^n / (s!·s^(n-s))  (n > s)", "ver tabla Pn", null);
      break;
    }
    case "M/M/1/K":
    case "M/M/s/K": {
      const K = Number(req.K);
      const single = req.model === "M/M/1/K";
      push(
        "Prob. de n clientes Pn",
        single ? "Pn = P0·(λ/μ)^n,  n = 0..K" : "Pn = P0·(λ/μ)^n / n!  (n ≤ s);  P0·(λ/μ)^n / (s!·s^(n-s))  (s < n ≤ K)",
        "ver tabla Pn",
        null,
      );
      push("Prob. de sistema vacío P0", "P0 = 1 / Σ(n=0..K) (términos de Pn sin P0)", `K = ${K}`, m.P0);
      push("Prob. de sistema lleno PK", "PK = Pn con n = K", `n = ${K}`, m.P_block);
      push("Tasa efectiva λeff", "λeff = λ·(1 - PK)", `${fmt(lam)} · (1 - ${fmt(m.P_block)})`, m.lambda_eff, `${cl}/${t}`);
      push("Clientes rechazados", "λ·PK", `${fmt(lam)} · ${fmt(m.P_block)}`, m.lambda_lost, `${cl}/${t}`);
      push("Clientes en el sistema L", "L = Σ n·Pn", "ver tabla Pn", m.L, cl);
      push("Clientes en la fila Lq", single ? "Lq = L - (1 - P0)" : "Lq = Σ(n>s) (n - s)·Pn", single ? `${fmt(m.L)} - (1 - ${fmt(m.P0)})` : "ver tabla Pn", m.Lq, cl);
      push("Tiempo en el sistema W", "W = L / λeff", `${fmt(m.L)} / ${fmt(m.lambda_eff)}`, m.W, t);
      push("Tiempo en la fila Wq", "Wq = Lq / λeff", `${fmt(m.Lq)} / ${fmt(m.lambda_eff)}`, m.Wq, t);
      push(
        "Utilización ρ",
        single ? "ρ = λeff / μ = 1 - P0" : "ρ = λeff / (s·μ)",
        single ? `${fmt(m.lambda_eff)} / ${fmt(mu)}` : `${fmt(m.lambda_eff)} / (${s} · ${fmt(mu)})`,
        m.rho,
      );
      push("Prob. de esperar Pw", "Pw = Σ(s ≤ n < K) Pn / (1 - PK)", "ver tabla Pn", m.Pw);
      break;
    }
    case "M/M/s/N": {
      const N = Number(req.N);
      push(
        "Prob. de n clientes Pn",
        "Pn = P0·N!/((N-n)!·n!)·(λ/μ)^n  (n ≤ s);  P0·N!/((N-n)!·s!·s^(n-s))·(λ/μ)^n  (s < n ≤ N)",
        "ver tabla Pn",
        null,
      );
      push("Prob. de sistema vacío P0", "P0 = 1 / Σ(n=0..N) (términos de Pn sin P0)", `N = ${N}`, m.P0);
      push("Clientes en el sistema L", "L = Σ n·Pn", "ver tabla Pn", m.L, cl);
      push("Clientes en la fila Lq", "Lq = Σ(n>s) (n - s)·Pn", "ver tabla Pn", m.Lq, cl);
      push("Clientes fuera del sistema", "N - L", `${N} - ${fmt(m.L)}`, m.customers_outside, cl);
      push("Tasa efectiva λeff", "λeff = λ·(N - L)", `${fmt(lam)} · (${N} - ${fmt(m.L)})`, m.lambda_eff, `${cl}/${t}`);
      push("Tiempo en el sistema W", "W = L / λeff", `${fmt(m.L)} / ${fmt(m.lambda_eff)}`, m.W, t);
      push("Tiempo en la fila Wq", "Wq = Lq / λeff", `${fmt(m.Lq)} / ${fmt(m.lambda_eff)}`, m.Wq, t);
      push("Utilización ρ", "ρ = λeff / (s·μ)", `${fmt(m.lambda_eff)} / (${s} · ${fmt(mu)})`, m.rho);
      push("Prob. de esperar Pw", "Pw = Σ(n ≥ s) (N - n)·Pn / (N - L)", "ver tabla Pn", m.Pw);
      break;
    }
    default: {
      const det = req.model === "M/D/1";
      const sigma = det ? 0 : Number(req.service_std_dev);
      push("Utilización ρ", "ρ = λ / μ", `${fmt(lam)} / ${fmt(mu)}`, m.rho);
      push("Prob. de sistema vacío P0", "P0 = 1 - ρ", `1 - ${fmt(m.rho)}`, m.P0);
      if (det) {
        push("Clientes en la fila Lq", "Lq = ρ² / (2·(1 - ρ))", `${fmt(m.rho)}² / (2 · (1 - ${fmt(m.rho)}))`, m.Lq, cl);
      } else {
        push(
          "Clientes en la fila Lq (Pollaczek-Khinchine)",
          "Lq = (λ²σ² + ρ²) / (2·(1 - ρ))",
          `(${fmt(lam)}² · ${fmt(sigma)}² + ${fmt(m.rho)}²) / (2 · (1 - ${fmt(m.rho)}))`,
          m.Lq,
          cl,
        );
      }
      push("Clientes en el sistema L", "L = Lq + ρ", `${fmt(m.Lq)} + ${fmt(m.rho)}`, m.L, cl);
      push("Tiempo en la fila Wq", "Wq = Lq / λ", `${fmt(m.Lq)} / ${fmt(lam)}`, m.Wq, t);
      push("Tiempo en el sistema W", "W = Wq + 1/μ", `${fmt(m.Wq)} + 1 / ${fmt(mu)}`, m.W, t);
      push("Prob. de esperar Pw", "Pw = ρ", fmt(m.rho), m.Pw);
    }
  }

  if (m.t != null && m.P_wq_gt_t != null) {
    const tt = fmt(m.t);
    if (req.model === "M/M/1" || req.model === "M/M/s") {
      push("Prob. de esperar en fila más de t", "P(Wq > t) = Pw · e^(-(s·μ - λ)·t)", `${fmt(m.Pw)} · e^(-(${s} · ${fmt(mu)} - ${fmt(lam)}) · ${tt})`, m.P_wq_gt_t);
      push(
        "Prob. de estar en el sistema más de t",
        req.model === "M/M/1" ? "P(W > t) = e^(-μ·(1 - ρ)·t)" : "P(W > t) = e^(-μ·t)·[1 + Pw·(1 - e^(-μ·t·(s - 1 - λ/μ))) / (s - 1 - λ/μ)]",
        `t = ${tt}`,
        m.P_w_gt_t,
      );
    } else {
      push("Prob. de esperar en fila más de t", "P(Wq > t) = Σ πn · P(Erlang(n - s + 1, s·μ) > t)", `t = ${tt}`, m.P_wq_gt_t);
      push("Prob. de estar en el sistema más de t", "P(W > t) = P(S > t) + ∫ μe^(-μy)·P(Wq > t - y) dy", `t = ${tt}`, m.P_w_gt_t);
    }
  }

  if (m.cost_total != null) {
    const queue = req.waiting_cost_basis === "queue";
    const base = queue ? "Lq" : "L";
    const cw = req.cost_waiting_per_unit_time ?? 0;
    const cs = req.cost_server_per_unit_time ?? 0;
    push("Costo de espera", `Cw · ${base}`, `${fmt(cw)} · ${fmt(queue ? m.Lq : m.L)}`, m.cost_waiting, `$/${t}`);
    push("Costo de servicio", "Cs · s", `${fmt(cs)} · ${req.s}`, m.cost_server, `$/${t}`);
    push("Costo total", "Cw·" + base + " + Cs·s", `${fmt(m.cost_waiting)} + ${fmt(m.cost_server)}`, m.cost_total, `$/${t}`);
  }
  return rows;
}

function waitingBase(req: QueuesRequest, m: Record<string, number>): number {
  return req.waiting_cost_basis === "queue" ? m.Lq : m.L;
}

function applyCosts(req: QueuesRequest, core: Core, warnings: string[]) {
  if (req.cost_waiting_per_unit_time == null && req.cost_server_per_unit_time == null) return;
  if (!core.stable) {
    warnings.push("No se calculan costos: el sistema es inestable (la fila crece sin límite).");
    return;
  }
  const m = core.metrics;
  const cw = req.cost_waiting_per_unit_time ?? 0;
  const cs = req.cost_server_per_unit_time ?? 0;
  m.cost_waiting = cw * waitingBase(req, m);
  m.cost_server = cs * req.s;
  m.cost_total = m.cost_waiting + m.cost_server;
}

function optimizeServers(req: QueuesRequest, metrics: Record<string, number>, warnings: string[]): NamedTable | null {
  if (!MULTI_SERVER.includes(req.model)) {
    warnings.push("La comparación de servidores solo aplica a modelos con varios servidores (M/M/s, M/M/s/K, M/M/s//N).");
    return null;
  }
  if (req.cost_waiting_per_unit_time == null || req.cost_server_per_unit_time == null) {
    warnings.push("Para comparar el número de servidores captura el costo de espera y el costo por servidor.");
    return null;
  }
  const cw = req.cost_waiting_per_unit_time;
  const cs = req.cost_server_per_unit_time;
  const r = req.lambda / req.mu;
  const capacity = req.model === "M/M/s/K" ? Number(req.K) : req.model === "M/M/s/N" ? Number(req.N) : LIMITS.queuesSMax;
  const minStable = req.model === "M/M/s" ? Math.floor(r) + 1 : 1;
  const upper = Math.min(req.s_max ?? Math.max(minStable + 8, req.s + 5), LIMITS.queuesSMax, capacity);

  const rows: unknown[][] = [];
  let bestS: number | null = null;
  let bestCost = INF;
  for (let sTry = 1; sTry <= upper; sTry++) {
    const core = evaluate(req, req.lambda, sTry, false);
    if (!core.stable) continue;
    const m = core.metrics;
    const costWaiting = cw * waitingBase(req, m);
    const costServer = cs * sTry;
    const costTotal = costWaiting + costServer;
    rows.push([sTry, m.L, m.Lq, m.W, m.Wq, m.rho, m.Pw, costWaiting, costServer, costTotal, false]);
    if (costTotal < bestCost - 1e-12) {
      bestCost = costTotal;
      bestS = sTry;
    }
  }
  // Con s ≤ λ/μ la fila crece sin límite: esos valores de s no aparecen en la tabla.
  if (bestS == null) {
    warnings.push(`No hay un número de servidores estable hasta s = ${upper}; aumenta el máximo a comparar.`);
    return null;
  }
  for (const row of rows) row[row.length - 1] = row[0] === bestS;
  metrics.s_optimal = bestS;
  metrics.cost_total_optimal = bestCost;
  return {
    name: "cost_by_s",
    columns: ["servidores", "L", "Lq", "W", "Wq", "rho", "Pw", "costo_espera", "costo_servidor", "costo_total", "óptimo"],
    rows,
  };
}

/** Datos del problema: los usa la interfaz y aparecen al inicio del PDF y del Excel. */
function inputTable(req: QueuesRequest): NamedTable {
  const rows: unknown[][] = [["Modelo", req.model, "model"]];
  rows.push([req.model === "M/M/s/N" ? "Tasa de llegada por cliente λ" : "Tasa de llegada λ", req.lambda, "lambda"]);
  rows.push(["Tasa de servicio por servidor μ", req.mu, "mu"]);
  rows.push(["Servidores s", req.s, "s"]);
  if (req.K != null) rows.push(["Capacidad del sistema K", req.K, "K"]);
  if (req.N != null) rows.push(["Población N", req.N, "N"]);
  if (req.model === "M/G/1") rows.push(["Desv. estándar del servicio σ", req.service_std_dev, "sigma"]);
  if (req.time_unit) rows.push(["Unidad de tiempo", req.time_unit, "time_unit"]);
  if (req.cost_waiting_per_unit_time != null || req.cost_server_per_unit_time != null) {
    rows.push(["Costo de espera por cliente", req.cost_waiting_per_unit_time ?? 0, "cost_waiting"]);
    rows.push(["Costo por servidor", req.cost_server_per_unit_time ?? 0, "cost_server"]);
    rows.push([
      "Costo de espera sobre",
      req.waiting_cost_basis === "queue" ? "Lq (clientes en la fila)" : "L (clientes en el sistema)",
      "waiting_cost_basis",
    ]);
  }
  if (req.wait_threshold != null) rows.push(["Tiempo t", req.wait_threshold, "wait_threshold"]);
  return { name: "datos", columns: ["parametro", "valor", "clave"], rows };
}

/** Curva de congestión: cómo cambian L y W cuando sube la tasa de llegada con todo lo demás fijo. */
function congestionCurve(req: QueuesRequest): NamedTable {
  const lambdas: number[] = [];
  const finite = req.model === "M/M/1/K" || req.model === "M/M/s/K" || req.model === "M/M/s/N";
  if (finite) {
    for (let i = 1; i <= 20; i++) lambdas.push((req.lambda * i) / 10);
  } else {
    const capacity = req.s * req.mu;
    const grid = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97];
    for (const g of grid) lambdas.push(g * capacity);
    if (req.lambda < capacity) lambdas.push(req.lambda);
  }
  const unique = [...new Set(lambdas.map((x) => Number(x.toPrecision(12))))].sort((a, b) => a - b);
  const rows = unique.map((lam) => {
    const m = evaluate(req, lam, req.s, false).metrics;
    return [lam, m.rho, m.L, m.Lq, m.W, m.Wq];
  });
  return { name: "curva_congestion", columns: ["lambda", "rho", "L", "Lq", "W", "Wq"], rows };
}

export function solve(body: unknown): ModuleResult {
  const req = parseQueuesRequest(body);
  const warnings: string[] = [];
  const core = evaluate(req, req.lambda, req.s, req.include_pn);
  const m = core.metrics;

  if (!core.stable) {
    const capacity = req.model === "M/M/s" ? "s·μ" : "μ";
    warnings.push(
      `Sistema inestable: ρ = ${fmt(m.rho)} ≥ 1. Llegan más clientes (λ = ${fmt(req.lambda)}) de los que se pueden atender (${capacity} = ${fmt(req.s * req.mu)}), así que la fila crece sin límite; L, Lq, W y Wq tienden a infinito.`,
    );
  } else if (m.rho >= 0.9 && !("P_block" in m) && !("customers_outside" in m)) {
    warnings.push(
      `Sistema muy cargado (ρ = ${fmt(m.rho)}): un pequeño aumento en las llegadas hace crecer mucho la espera.`,
    );
  }
  if (req.model === "M/M/s/N" && Number(req.N) <= req.s) {
    warnings.push("Con N ≤ s nunca se forma fila: siempre hay un servidor libre para cada cliente (Lq = 0).");
  }

  if (req.wait_threshold != null) {
    if (core.wqTail && core.stable) {
      const t = req.wait_threshold;
      m.t = t;
      m.P_wq_gt_t = core.wqTail(t);
      m.P_w_gt_t = (core.wTail ?? integrateWTail(core.wqTail, req.mu))(t);
    } else if (core.stable) {
      warnings.push(
        "La probabilidad de esperar más de t solo se calcula en modelos exponenciales (M/M/…); en M/G/1 y M/D/1 no hay fórmula cerrada.",
      );
    }
  }

  applyCosts(req, core, warnings);

  const tables: NamedTable[] = [inputTable(req)];
  let graph = null;
  if (core.pn && req.include_pn) {
    let cum = 0;
    const rows = core.pn.map((p, n) => {
      cum += p;
      return [n, p, Math.min(1, cum)];
    });
    tables.push({ name: "Pn", columns: ["n", "Pn", "acumulada"], rows });
    if (!("lambda_eff" in m) && 1 - cum > PN_TAIL) {
      warnings.push(
        `La tabla Pn se muestra hasta n = ${core.pn.length - 1}; los valores mayores suman ${fmt(1 - cum)} de probabilidad.`,
      );
    }
    graph = {
      type: "xy" as const,
      series: [{ name: "Pn", x: core.pn.map((_, i) => i), y: core.pn.slice() }],
      x_label: "n (clientes en el sistema)",
      y_label: "Probabilidad Pn",
      title: "Distribución de probabilidad del número de clientes",
      subtitle: `Modelo ${req.model}`,
      kind: "bar",
    };
  }

  if (req.optimize_s) {
    const costTable = optimizeServers(req, m, warnings);
    if (costTable) tables.push(costTable);
  }

  tables.push({
    name: "formulas",
    columns: ["medida", "formula", "sustitucion", "valor", "unidad"],
    rows: formulaRows(req, core),
  });
  tables.push(congestionCurve(req));

  const variables: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === "number" && Number.isFinite(v)) variables[k] = v;
  }

  return okResult("queues", {
    status: "ok",
    variables,
    metrics: m,
    graph,
    tables,
    warnings,
  });
}
