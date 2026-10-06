import { SolverError } from "../../errors";
import { dot, identity, invert, matmul, matvec, vecmat, zeros } from "../../linalg";
import type { GraphNetwork, ModuleResult, NamedTable } from "../../schema";
import { okResult } from "../../schema";

const ROW_TOL = 1e-6;
const ARC_TOL = 1e-9;
const NEG_TOL = -1e-9;
const CHAIN_MAX = 20;
const MDP_MAX_STATES = 8;
const MDP_MAX_ACTIONS = 6;
const ENUM_MAX = 256;
const HORIZON_MAX = 200;

type Mode = "chain" | "mdp";

type ChainInput = {
  states: string[];
  transition: number[][];
  initial: number[];
  steps: number;
  nPower: number;
  rewards: number[] | null;
};

type Action = {
  name: string;
  cost: number;
  transitions: number[];
};

type MdpInput = {
  states: string[];
  sense: "min" | "max";
  criterion: "average" | "discounted";
  discount: number | null;
  actions: Action[][];
};

type MarkovClass = {
  id: string;
  states: number[];
  recurrent: boolean;
  absorbing: boolean;
  /** Periodo de la clase recurrente; null si es transitoria. */
  period: number | null;
};

type Classification = {
  classes: MarkovClass[];
  classOf: number[];
  adj: number[][];
  reachable: number[][];
};

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("El cuerpo debe ser un objeto JSON con los datos de la cadena o del proceso de decisión.");
  }
  return body as Record<string, unknown>;
}

function fmtEs(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  return x.toLocaleString("es-MX", { maximumFractionDigits: 6 });
}

function asNumber(value: unknown): number | null {
  if (typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function requireInt(value: unknown, fallback: number | null, min: number, max: number, message: string): number {
  if (value == null || value === "") {
    if (fallback == null) throw new SolverError(message);
    return fallback;
  }
  const n = asNumber(value);
  if (n == null || !Number.isInteger(n) || n < min || n > max) throw new SolverError(message);
  return n;
}

function parseStates(raw: unknown, min: number, max: number, what: string): string[] {
  if (!Array.isArray(raw)) {
    throw new SolverError(`Indica los estados de ${what} como una lista de nombres (entre ${min} y ${max}).`);
  }
  const states = raw.map((item, i) => {
    if (typeof item === "number" && Number.isFinite(item)) return String(item);
    if (typeof item !== "string") {
      throw new SolverError(`El estado ${i + 1} debe ser un nombre. Recibí un valor que no es texto.`);
    }
    return item.trim();
  });
  if (states.length < min) {
    throw new SolverError(`${what} necesita al menos ${min} estados (hay ${states.length}).`);
  }
  if (states.length > max) {
    throw new SolverError(`${what} admite como máximo ${max} estados (hay ${states.length}).`);
  }
  if (states.some((s) => !s)) {
    throw new SolverError("Cada estado necesita un nombre. Hay uno vacío: escríbelo o quítalo.");
  }
  const seen = new Set<string>();
  for (const name of states) {
    if (seen.has(name)) {
      throw new SolverError(`El nombre «${name}» está repetido. Cada estado debe llamarse distinto.`);
    }
    seen.add(name);
  }
  return states;
}

/** Deja en 0 los negativos de redondeo y rechaza el resto. Comprueba que la fila sume 1. */
function sanitizeRow(row: number[], states: string[], who: string, verb: "debe" | "deben"): number[] {
  const cleaned = row.map((value, j) => {
    if (value < NEG_TOL) {
      throw new SolverError(
        `${who} tiene una probabilidad negativa hacia «${states[j]}» (${fmtEs(value)}). Usa valores mayores o iguales que 0.`,
      );
    }
    return value < 0 ? 0 : value;
  });
  const sum = cleaned.reduce((acc, value) => acc + value, 0);
  if (Math.abs(sum - 1) > ROW_TOL) {
    const suma = verb === "debe" ? "suma" : "suman";
    throw new SolverError(
      `${who} ${suma} ${fmtEs(sum)} y ${verb} sumar 1. Ajusta las probabilidades para que sumen 1.`,
    );
  }
  return cleaned;
}

function parseMatrix(raw: unknown, states: string[]): number[][] {
  const n = states.length;
  if (!Array.isArray(raw) || raw.length !== n) {
    throw new SolverError(`La matriz de transición debe tener ${n} filas, una por cada estado.`);
  }
  return raw.map((row, i) => {
    if (!Array.isArray(row) || row.length !== n) {
      const got = Array.isArray(row) ? row.length : 0;
      throw new SolverError(
        `La fila del estado «${states[i]}» tiene ${got} probabilidades y debe tener ${n}, una hacia cada estado.`,
      );
    }
    const nums = row.map((value, j) => {
      const nValue = asNumber(value);
      if (nValue == null) {
        throw new SolverError(
          `La probabilidad de ir de «${states[i]}» a «${states[j]}» no es un número. Escríbela como 0.25 o 0,25.`,
        );
      }
      return nValue;
    });
    return sanitizeRow(nums, states, `La fila del estado «${states[i]}»`, "debe");
  });
}

function parseProbRow(raw: unknown, states: string[], who: string): number[] {
  const n = states.length;
  if (!Array.isArray(raw) || raw.length !== n) {
    const got = Array.isArray(raw) ? raw.length : 0;
    throw new SolverError(`${who} debe tener ${n} probabilidades, una hacia cada estado, y tiene ${got}.`);
  }
  const nums = raw.map((value, j) => {
    const nValue = asNumber(value);
    if (nValue == null) {
      throw new SolverError(
        `${who} tiene un valor que no es número hacia «${states[j]}». Escríbelo como 0.25 o 0,25.`,
      );
    }
    return nValue;
  });
  return sanitizeRow(nums, states, who, "deben");
}

function parseInitial(raw: unknown, states: string[], warnings: string[]): number[] {
  const n = states.length;
  if (raw == null) return Array(n).fill(1 / n);
  if (!Array.isArray(raw) || raw.length !== n) {
    throw new SolverError(`La distribución inicial debe tener ${n} números, uno por estado. Si la omites, se usa la uniforme.`);
  }
  const pi = raw.map((value, i) => {
    const x = asNumber(value);
    if (x == null) {
      throw new SolverError(`La probabilidad inicial del estado «${states[i]}» no es un número.`);
    }
    if (x < NEG_TOL) {
      throw new SolverError(
        `La probabilidad inicial del estado «${states[i]}» es negativa (${fmtEs(x)}). Usa valores mayores o iguales que 0.`,
      );
    }
    return x < 0 ? 0 : x;
  });
  const sum = pi.reduce((acc, value) => acc + value, 0);
  if (!(sum > 1e-12)) {
    throw new SolverError(
      "La distribución inicial suma 0. Escribe probabilidades que sumen 1, o quítala para usar la misma probabilidad en cada estado.",
    );
  }
  const normalized = Math.abs(sum - 1) > ROW_TOL;
  if (normalized) {
    warnings.push(
      `La distribución inicial suma ${fmtEs(sum)} y no 1. Se dividió cada valor entre ${fmtEs(sum)} para que sume 1.`,
    );
  }
  return pi.map((value) => value / sum);
}

function parseRewards(raw: unknown, states: string[]): number[] | null {
  if (raw == null) return null;
  const n = states.length;
  if (!Array.isArray(raw) || raw.length !== n) {
    const got = Array.isArray(raw) ? raw.length : 0;
    throw new SolverError(`Las recompensas deben ser ${n} (una por estado) y llegaron ${got}.`);
  }
  return raw.map((value, i) => {
    const x = asNumber(value);
    if (x == null) throw new SolverError(`La recompensa del estado «${states[i]}» no es un número.`);
    return x;
  });
}

function parseChain(body: Record<string, unknown>, warnings: string[]): ChainInput {
  const states = parseStates(body.states, 2, CHAIN_MAX, "Una cadena");
  if (body.transition == null) {
    throw new SolverError(
      "Falta la matriz de transición. Si lo que quieres resolver es un proceso de decisión, envía mode: \"mdp\" y la lista de acciones.",
    );
  }
  const transition = parseMatrix(body.transition, states);
  const initial = parseInitial(body.initial, states, warnings);
  const steps = requireInt(
    body.steps,
    10,
    1,
    HORIZON_MAX,
    `Los pasos deben ser un entero entre 1 y ${HORIZON_MAX}. Indica cuántos pasos de la distribución quieres ver.`,
  );
  const nPower = requireInt(
    body.n_power,
    steps,
    1,
    HORIZON_MAX,
    `La potencia n de P debe ser un entero entre 1 y ${HORIZON_MAX}.`,
  );
  return {
    states,
    transition,
    initial,
    steps,
    nPower,
    rewards: parseRewards(body.rewards, states),
  };
}

function parseMdp(body: Record<string, unknown>): MdpInput {
  const states = parseStates(body.states, 2, MDP_MAX_STATES, "Un proceso de decisión");
  const senseRaw = body.sense ?? "min";
  if (senseRaw !== "min" && senseRaw !== "max") {
    throw new SolverError("El sentido debe ser «min» (minimizar un costo) o «max» (maximizar una recompensa).");
  }
  const criterionRaw = body.criterion ?? "average";
  if (criterionRaw !== "average" && criterionRaw !== "discounted") {
    throw new SolverError("El criterio debe ser «average» (costo promedio) o «discounted» (valor descontado).");
  }
  let discount: number | null = null;
  if (criterionRaw === "discounted") {
    const gamma = asNumber(body.discount);
    if (gamma == null || !(gamma > 0) || !(gamma < 1)) {
      throw new SolverError(
        "Para el criterio descontado indica una tasa γ mayor que 0 y menor que 1. Si no quieres descontar, elige el costo promedio.",
      );
    }
    discount = gamma;
  }
  if (!Array.isArray(body.decisions) || body.decisions.length === 0) {
    throw new SolverError("Agrega las acciones en «decisions»: cada una lleva estado, nombre, costo y probabilidades.");
  }
  const index = new Map(states.map((name, i) => [name, i]));
  const actions: Action[][] = states.map(() => []);
  const names = states.map(() => new Set<string>());
  body.decisions.forEach((item, k) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new SolverError(`La decisión ${k + 1} debe ser un objeto con state, action, cost y transitions.`);
    }
    const rec = item as Record<string, unknown>;
    const stateName =
      typeof rec.state === "string" ? rec.state.trim() : typeof rec.state === "number" && Number.isFinite(rec.state) ? String(rec.state) : "";
    if (!stateName || !index.has(stateName)) {
      throw new SolverError(
        stateName
          ? `La acción menciona el estado «${stateName}», que no está en la lista. Usa exactamente uno de los nombres de states.`
          : `La decisión ${k + 1} no dice en qué estado se toma.`,
      );
    }
    const actionName =
      typeof rec.action === "string"
        ? rec.action.trim()
        : typeof rec.action === "number" && Number.isFinite(rec.action)
          ? String(rec.action)
          : "";
    if (!actionName) throw new SolverError(`Hay una acción sin nombre en el estado «${stateName}».`);
    const i = index.get(stateName)!;
    if (names[i].has(actionName)) {
      throw new SolverError(
        `El estado «${stateName}» tiene dos acciones llamadas «${actionName}». Cada acción de un mismo estado necesita un nombre distinto.`,
      );
    }
    names[i].add(actionName);
    const cost = asNumber(rec.cost);
    if (cost == null) {
      throw new SolverError(`El costo de la acción «${actionName}» en «${stateName}» debe ser un número (puede ser negativo si es una ganancia).`);
    }
    const transitions = parseProbRow(
      rec.transitions,
      states,
      `Las probabilidades de la acción «${actionName}» en «${stateName}»`,
    );
    actions[i].push({ name: actionName, cost, transitions });
  });
  actions.forEach((list, i) => {
    if (list.length === 0) {
      throw new SolverError(`El estado «${states[i]}» no tiene ninguna acción. Agrega al menos una.`);
    }
    if (list.length > MDP_MAX_ACTIONS) {
      throw new SolverError(
        `El estado «${states[i]}» tiene ${list.length} acciones y el máximo es ${MDP_MAX_ACTIONS}. Quita las que no vayas a comparar.`,
      );
    }
  });
  return { states, sense: senseRaw, criterion: criterionRaw, discount, actions };
}

/* ——— Álgebra ——— */

function solveLinear(matrix: number[][], rhs: number[], pivotTol = 1e-10): number[] | null {
  const n = matrix.length;
  if (n === 0) return [];
  const m = matrix.map((row, i) => {
    if (row.length !== n) return null;
    return [...row, rhs[i]];
  });
  if (m.some((row) => row == null)) return null;
  const aug = m as number[][];
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(aug[col][col]);
    for (let r = col + 1; r < n; r++) {
      const value = Math.abs(aug[r][col]);
      if (value > best) {
        best = value;
        pivot = r;
      }
    }
    if (best < pivotTol) return null;
    if (pivot !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivot];
      aug[pivot] = tmp;
    }
    const div = aug[col][col];
    for (let j = col; j <= n; j++) aug[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) aug[r][j] -= factor * aug[col][j];
    }
  }
  const x = aug.map((row) => row[n]);
  if (x.some((value) => !Number.isFinite(value))) return null;
  return x;
}

function matPow(p: number[][], exp: number): number[][] {
  const n = p.length;
  let result = identity(n);
  let base = p;
  let e = exp;
  while (e > 0) {
    if (e % 2 === 1) result = matmul(result, base);
    e = Math.floor(e / 2);
    if (e > 0) base = matmul(base, base);
  }
  return result;
}

function tidy(x: number): number {
  if (!Number.isFinite(x)) return x;
  if (Math.abs(x) < 1e-12) return 0;
  if (Math.abs(x - 1) < 1e-12) return 1;
  return x;
}

function extract(p: number[][], idx: number[]): number[][] {
  return idx.map((i) => idx.map((j) => p[i][j]));
}

/** Submatriz de una clase cerrada, renormalizada por si se ignoraron arcos menores que la tolerancia. */
function closedSubmatrix(p: number[][], idx: number[]): number[][] {
  return extract(p, idx).map((row) => {
    const sum = row.reduce((acc, value) => acc + value, 0);
    if (sum <= 0 || Math.abs(sum - 1) <= 1e-12) return row.slice();
    return row.map((value) => value / sum);
  });
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

function tarjan(adj: number[][]): number[][] {
  const n = adj.length;
  const index = Array(n).fill(-1);
  const low = Array(n).fill(0);
  const onStack = Array(n).fill(false);
  const stack: number[] = [];
  const comps: number[][] = [];
  let next = 0;

  function strong(v: number) {
    index[v] = low[v] = next++;
    stack.push(v);
    onStack[v] = true;
    for (const w of adj[v]) {
      if (index[w] === -1) {
        strong(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (onStack[w]) {
        low[v] = Math.min(low[v], index[w]);
      }
    }
    if (low[v] === index[v]) {
      const comp: number[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack[w] = false;
        comp.push(w);
        if (w === v) break;
      }
      comps.push(comp.sort((a, b) => a - b));
    }
  }

  for (let v = 0; v < n; v++) if (index[v] === -1) strong(v);
  return comps;
}

/** Periodo = mcd de las longitudes de ciclo, vía las diferencias de distancia del BFS. */
function periodOf(adj: number[][], members: number[]): number {
  const inside = new Set(members);
  const start = members[0];
  const dist = new Map<number, number>();
  const queue = [start];
  dist.set(start, 0);
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    for (const v of adj[u]) {
      if (!inside.has(v) || dist.has(v)) continue;
      dist.set(v, dist.get(u)! + 1);
      queue.push(v);
    }
  }
  let g = 0;
  for (const u of members) {
    const du = dist.get(u);
    if (du == null) continue;
    for (const v of adj[u]) {
      if (!inside.has(v)) continue;
      const dv = dist.get(v);
      if (dv == null) continue;
      const delta = du + 1 - dv;
      if (delta !== 0) g = gcd(g, delta);
    }
  }
  return g === 0 ? 1 : g;
}

function reachableFrom(adj: number[][], start: number): number[] {
  const seen = new Set<number>([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    for (const v of adj[queue[head]]) {
      if (seen.has(v)) continue;
      seen.add(v);
      queue.push(v);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

function classify(p: number[][]): Classification {
  const n = p.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (p[i][j] > ARC_TOL) adj[i].push(j);
    }
  }
  const comps = tarjan(adj).sort((a, b) => a[0] - b[0]);
  const classes: MarkovClass[] = comps.map((states, k) => {
    const set = new Set(states);
    let leaves = false;
    for (const u of states) {
      if (adj[u].some((v) => !set.has(v))) leaves = true;
    }
    const recurrent = !leaves;
    const absorbing = recurrent && states.length === 1;
    return {
      id: `C${k + 1}`,
      states,
      recurrent,
      absorbing,
      period: recurrent ? periodOf(adj, states) : null,
    };
  });
  const classOf = Array(n).fill(0);
  classes.forEach((cl, k) => {
    for (const i of cl.states) classOf[i] = k;
  });
  const reachable = Array.from({ length: n }, (_, i) => reachableFrom(adj, i));
  return { classes, classOf, adj, reachable };
}

function normalizePi(pi: number[]): number[] | null {
  if (pi.some((value) => !Number.isFinite(value) || value < -1e-7)) return null;
  const clipped = pi.map((value) => (value < 1e-10 ? 0 : value));
  const sum = clipped.reduce((acc, value) => acc + value, 0);
  if (!(sum > 1e-8)) return null;
  return clipped.map((value) => value / sum);
}

function balances(p: number[][], pi: number[], tol = 1e-5): boolean {
  const next = vecmat(pi, p);
  const sum = pi.reduce((acc, value) => acc + value, 0);
  if (Math.abs(sum - 1) > tol) return false;
  return next.every((value, i) => Math.abs(value - pi[i]) <= tol);
}

/** (Pᵀ − I) π = 0 con la última ecuación sustituida por la suma 1. */
function directStationary(p: number[][]): number[] | null {
  const n = p.length;
  if (n === 1) return [1];
  const a = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) a[j][i] = p[i][j];
    a[i][i] -= 1;
  }
  for (let j = 0; j < n; j++) a[n - 1][j] = 1;
  const b = Array(n).fill(0);
  b[n - 1] = 1;
  const x = solveLinear(a, b);
  if (!x) return null;
  const pi = normalizePi(x);
  if (!pi || !balances(p, pi)) return null;
  return pi;
}

/**
 * Si el sistema queda singular por el redondeo, se fija un estado de referencia en 1
 * (sin normalizar), se resuelven las demás ecuaciones de balance y después se normaliza.
 */
function referenceStationary(p: number[][]): number[] | null {
  const n = p.length;
  if (n === 1) return [1];
  for (let ref = 0; ref < n; ref++) {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (i !== ref) idx.push(i);
    const m = idx.length;
    const a = zeros(m, m);
    const b = Array(m).fill(0);
    for (let k = 0; k < m; k++) {
      const j = idx[k];
      b[k] = p[ref][j];
      for (let t = 0; t < m; t++) {
        const i = idx[t];
        a[k][t] = (i === j ? 1 : 0) - p[i][j];
      }
    }
    const x = solveLinear(a, b, 1e-12);
    if (!x) continue;
    const raw = Array(n).fill(0);
    raw[ref] = 1;
    idx.forEach((j, t) => {
      raw[j] = x[t];
    });
    const pi = normalizePi(raw);
    if (pi && balances(p, pi)) return pi;
  }
  return null;
}

function stationaryOf(p: number[][]): number[] {
  const pi = directStationary(p) ?? referenceStationary(p);
  if (!pi) {
    throw new SolverError(
      "No se pudo calcular la distribución estacionaria. Revisa que la matriz sea estocástica (cada fila suma 1) y vuelve a intentarlo.",
    );
  }
  return pi;
}

function embed(n: number, idx: number[], sub: number[]): number[] {
  const pi = Array(n).fill(0);
  idx.forEach((i, t) => {
    pi[i] = sub[t];
  });
  return pi;
}

type TransientPack = {
  transient: number[];
  nMatrix: number[][];
  /** Probabilidad de caer en cada clase recurrente, filas = transitorios. */
  absorption: number[][];
  expectedSteps: number[];
};

function fundamentalMatrix(q: number[][]): number[][] {
  const n = q.length;
  const a = identity(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) a[i][j] -= q[i][j];
  }
  try {
    const inv = invert(a);
    if (inv.some((row) => row.some((value) => !Number.isFinite(value)))) {
      throw new Error("singular");
    }
    return inv;
  } catch {
    throw new SolverError(
      "La matriz (I − Q) de los estados transitorios es singular, así que no se puede armar la matriz fundamental. Revisa que desde cada estado transitorio haya forma de llegar a una clase recurrente.",
    );
  }
}

function analyzeTransients(p: number[][], recurrent: MarkovClass[]): TransientPack | null {
  const n = p.length;
  const closed = new Set(recurrent.flatMap((cl) => cl.states));
  const transient: number[] = [];
  for (let i = 0; i < n; i++) if (!closed.has(i)) transient.push(i);
  if (transient.length === 0) return null;
  const q = extract(p, transient);
  const nMatrix = fundamentalMatrix(q);
  const r = zeros(transient.length, recurrent.length);
  transient.forEach((i, row) => {
    recurrent.forEach((cl, col) => {
      let sum = 0;
      for (const j of cl.states) sum += p[i][j];
      r[row][col] = sum;
    });
  });
  return {
    transient,
    nMatrix,
    absorption: matmul(nMatrix, r),
    expectedSteps: matvec(nMatrix, Array(transient.length).fill(1)),
  };
}

function absorptionOfState(pack: TransientPack | null, recurrent: MarkovClass[], state: number, target: number): number {
  const own = recurrent.findIndex((cl) => cl.states.includes(state));
  if (own >= 0) return own === target ? 1 : 0;
  if (!pack) return 0;
  const row = pack.transient.indexOf(state);
  if (row < 0) return 0;
  return pack.absorption[row][target];
}

function longRunDistribution(
  p: number[][],
  initial: number[],
  states: string[],
  info: Classification,
  warnings: string[],
): number[] {
  const recurrent = info.classes.filter((cl) => cl.recurrent);
  const labelOf = (cl: MarkovClass) => joinNames(states, cl.states);
  if (recurrent.length === 1) {
    const only = recurrent[0];
    if (only.states.length === p.length) return stationaryOf(p);
    const full = directStationary(p);
    if (full) {
      const masked = full.map((value, i) => (only.states.includes(i) ? value : 0));
      const pi = normalizePi(masked);
      if (pi && balances(p, pi)) return pi;
    }
    return embed(p.length, only.states, stationaryOf(closedSubmatrix(p, only.states)));
  }

  const pack = analyzeTransients(p, recurrent);
  const conditional = recurrent.map((cl) => stationaryOf(closedSubmatrix(p, cl.states)));
  const alpha = recurrent.map((_, target) =>
    initial.reduce((sum, prob, i) => sum + prob * absorptionOfState(pack, recurrent, i, target), 0),
  );
  const alphaSum = alpha.reduce((sum, value) => sum + value, 0);
  const weights = alphaSum > 0 ? alpha.map((value) => value / alphaSum) : alpha;
  const pi = Array(p.length).fill(0);
  recurrent.forEach((cl, k) => {
    cl.states.forEach((state, t) => {
      pi[state] += weights[k] * conditional[k][t];
    });
  });
  const listed = recurrent.map((cl) => `${cl.id} (${labelOf(cl)})`).join("; ");
  const allAbsorbing = recurrent.every((cl) => cl.absorbing);
  warnings.push(
    allAbsorbing
      ? `Hay múltiples estados absorbentes (${recurrent.map((cl) => `«${labelOf(cl)}»`).join(" y ")}). No hay una sola distribución de largo plazo: depende de dónde empieces. La tabla usa tu distribución inicial y mezcla esos estados según la probabilidad de terminar en cada uno.`
      : `Hay múltiples clases recurrentes (${listed}), así que no existe una única distribución estacionaria. La tabla es la de largo plazo a partir de la distribución inicial: mezcla la distribución de cada clase según la probabilidad de caer en ella.`,
  );
  return pi.map(tidy);
}

function stateTipo(cl: MarkovClass): "absorbente" | "recurrente" | "transitorio" {
  if (cl.absorbing) return "absorbente";
  if (cl.recurrent) return "recurrente";
  return "transitorio";
}

function classTipo(cl: MarkovClass): "absorbente" | "recurrente" | "transitoria" {
  if (cl.absorbing) return "absorbente";
  if (cl.recurrent) return "recurrente";
  return "transitoria";
}

function joinNames(states: string[], idx: number[]): string {
  return idx.map((i) => states[i]).join(", ");
}

function solveChain(req: ChainInput, warnings: string[]): ModuleResult {
  const { states, transition: p, steps, nPower, rewards } = req;
  const n = states.length;
  const info = classify(p);
  const recurrent = info.classes.filter((cl) => cl.recurrent);
  const absorbingIdx = info.classes.filter((cl) => cl.absorbing).flatMap((cl) => cl.states);
  const periodic = recurrent.filter((cl) => (cl.period ?? 1) > 1);

  if (periodic.length) {
    const detail = periodic
      .map((cl) => `${cl.id} (${joinNames(states, cl.states)}) de periodo ${cl.period}`)
      .join("; ");
    warnings.push(
      `La cadena es periódica: ${detail}. La distribución estacionaria existe, pero la probabilidad después de n pasos puede oscilar y no acercarse a ella, porque solo se visita cada estado en ciertos residuos del periodo.`,
    );
  }

  const steady = longRunDistribution(p, req.initial, states, info, warnings).map(tidy);
  const pack = recurrent.length ? analyzeTransients(p, recurrent) : null;

  let pi = req.initial.slice();
  const transientRows: unknown[][] = [];
  for (let t = 0; t <= steps; t++) {
    transientRows.push([t, ...pi.map(tidy)]);
    pi = vecmat(pi, p);
  }
  const pn = matPow(p, nPower);

  const variables: Record<string, number> = {};
  const metrics: Record<string, number> = {
    steps,
    n_power: nPower,
    is_absorbing_chain: absorbingIdx.length ? 1 : 0,
    num_absorbing_states: absorbingIdx.length,
    num_recurrent_classes: recurrent.length,
    num_transient_states: pack?.transient.length ?? 0,
    is_periodic: periodic.length ? 1 : 0,
  };
  states.forEach((name, i) => {
    variables[name] = steady[i];
    metrics[`steady_${name}`] = steady[i];
  });

  const tables: NamedTable[] = [
    {
      name: "classification",
      columns: ["estado", "clase", "tipo", "periodo", "accesibles"],
      rows: states.map((name, i) => {
        const cl = info.classes[info.classOf[i]];
        return [name, cl.id, stateTipo(cl), cl.period ?? "—", joinNames(states, info.reachable[i])];
      }),
    },
    {
      name: "classes",
      columns: ["clase", "tipo", "periodo", "estados"],
      rows: info.classes.map((cl) => [cl.id, classTipo(cl), cl.period ?? "—", joinNames(states, cl.states)]),
    },
    {
      name: "transient",
      columns: ["t", ...states],
      rows: transientRows,
    },
    {
      name: "steady_state",
      columns: ["estado", "probabilidad"],
      rows: states.map((name, i) => [name, steady[i]]),
    },
    {
      name: "transition_power_n",
      columns: ["estado", ...states],
      rows: states.map((name, i) => [name, ...pn[i].map(tidy)]),
    },
  ];

  if (rewards) {
    const longRun = dot(steady, rewards);
    metrics.long_run_expected_reward = longRun;
    tables.push({
      name: "rewards",
      columns: ["estado", "recompensa", "peso_estacionario", "contribución"],
      rows: states.map((name, i) => [name, rewards[i], steady[i], tidy(steady[i] * rewards[i])]),
    });
  }

  if (pack) {
    const transientNames = pack.transient.map((i) => states[i]);
    const allAbsorbing = recurrent.every((cl) => cl.absorbing);
    const absorptionNames = allAbsorbing
      ? recurrent.map((cl) => states[cl.states[0]])
      : recurrent.map((cl) => cl.id);
    tables.push({
      name: "fundamental_matrix",
      columns: ["estado", ...transientNames],
      rows: pack.nMatrix.map((row, r) => [transientNames[r], ...row.map(tidy)]),
    });
    tables.push({
      name: "absorption_probabilities",
      columns: ["estado", ...absorptionNames],
      rows: pack.absorption.map((row, r) => [transientNames[r], ...row.map(tidy)]),
    });
    tables.push({
      name: "expected_steps_to_absorption",
      columns: ["estado", "pasos_esperados"],
      rows: pack.transient.map((i, r) => [states[i], tidy(pack.expectedSteps[r])]),
    });
    pack.transient.forEach((i, r) => {
      metrics[`expected_steps_${states[i]}`] = tidy(pack.expectedSteps[r]);
    });
    if (rewards) {
      const rewardT = pack.transient.map((i) => rewards[i]);
      const expectedReward = matvec(pack.nMatrix, rewardT);
      tables.push({
        name: "expected_reward_to_absorption",
        columns: ["estado", "recompensa_esperada"],
        rows: pack.transient.map((i, r) => [states[i], tidy(expectedReward[r])]),
      });
    }
  }

  const graph: GraphNetwork = {
    type: "network",
    directed: true,
    nodes: states.map((name, i) => {
      const cl = info.classes[info.classOf[i]];
      return { id: name, absorbing: cl.absorbing, kind: stateTipo(cl) };
    }),
    edges: states.flatMap((source, i) =>
      states.flatMap((target, j) =>
        p[i][j] > ARC_TOL ? [{ source, target, probability: tidy(p[i][j]) }] : [],
      ),
    ),
    title: "Diagrama de estados de la cadena de Markov",
    subtitle: "Las etiquetas en los arcos son probabilidades de transición",
  };

  return okResult("markov", {
    status: "ok",
    variables,
    metrics,
    graph,
    tables,
    warnings,
  });
}

/* ——— Procesos de decisión ——— */

type Eval = {
  scalar: number;
  h: number[];
  multichain: boolean;
};

function policyData(actions: Action[][], choice: number[]): { p: number[][]; c: number[] } {
  return {
    p: choice.map((a, i) => actions[i][a].transitions.slice()),
    c: choice.map((a, i) => actions[i][a].cost),
  };
}

/** g + hᵢ = cᵢ + Σⱼ Pᵢⱼ hⱼ, con h del estado de referencia en 0. */
function solveAverageUnichain(p: number[][], c: number[], ref: number): { g: number; h: number[] } | null {
  const n = p.length;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (i !== ref) idx.push(i);
  const a = zeros(n, n);
  for (let i = 0; i < n; i++) {
    a[i][0] = 1;
    for (let t = 0; t < idx.length; t++) {
      const j = idx[t];
      a[i][t + 1] = (i === j ? 1 : 0) - p[i][j];
    }
  }
  const x = solveLinear(a, c);
  if (!x) return null;
  const h = Array(n).fill(0);
  idx.forEach((j, t) => {
    h[j] = x[t + 1];
  });
  const g = x[0];
  if (!Number.isFinite(g) || h.some((value) => !Number.isFinite(value))) return null;
  for (let i = 0; i < n; i++) {
    const right = c[i] + dot(p[i], h);
    if (Math.abs(g + h[i] - right) > 1e-5) return null;
  }
  return { g, h };
}

function classGain(p: number[][], c: number[], cl: MarkovClass): number {
  const sub = closedSubmatrix(p, cl.states);
  const pi = stationaryOf(sub);
  let g = 0;
  cl.states.forEach((state, t) => {
    g += pi[t] * c[state];
  });
  return g;
}

function solveBias(p: number[][], c: number[], gState: number[], recurrent: MarkovClass[]): number[] {
  const n = p.length;
  const refs = new Set(recurrent.map((cl) => cl.states[0]));
  const free: number[] = [];
  for (let i = 0; i < n; i++) if (!refs.has(i)) free.push(i);
  const h = Array(n).fill(0);
  if (free.length === 0) return h;
  const a = zeros(free.length, free.length);
  const b = free.map((i) => c[i] - gState[i]);
  for (let r = 0; r < free.length; r++) {
    const i = free[r];
    for (let t = 0; t < free.length; t++) {
      const j = free[t];
      a[r][t] = (i === j ? 1 : 0) - p[i][j];
    }
  }
  const x = solveLinear(a, b, 1e-9);
  if (!x) return h;
  free.forEach((j, t) => {
    h[j] = x[t];
  });
  return h;
}

function evaluateAverage(p: number[][], c: number[]): Eval {
  const info = classify(p);
  const recurrent = info.classes.filter((cl) => cl.recurrent);
  if (recurrent.length === 1) {
    const gain = classGain(p, c, recurrent[0]);
    for (const ref of recurrent[0].states) {
      const solved = solveAverageUnichain(p, c, ref);
      if (solved && Math.abs(solved.g - gain) <= 1e-4) {
        return { scalar: solved.g, h: solved.h, multichain: false };
      }
    }
  }
  const pack = analyzeTransients(p, recurrent);
  const gains = recurrent.map((cl) => classGain(p, c, cl));
  const gState = Array(p.length).fill(0);
  for (let i = 0; i < p.length; i++) {
    recurrent.forEach((_, target) => {
      gState[i] += absorptionOfState(pack, recurrent, i, target) * gains[target];
    });
  }
  const scalar = gState.reduce((sum, value) => sum + value, 0) / p.length;
  return {
    scalar,
    h: solveBias(p, c, gState, recurrent),
    multichain: recurrent.length > 1,
  };
}

function evaluateDiscounted(p: number[][], c: number[], gamma: number): Eval {
  const n = p.length;
  const a = identity(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) a[i][j] -= gamma * p[i][j];
  }
  const h = solveLinear(a, c, 1e-12);
  if (!h) {
    throw new SolverError(
      "No se pudo evaluar la política con descuento: la matriz (I − γP) quedó singular. Revisa que γ esté entre 0 y 1 y que las filas de la política sumen 1.",
    );
  }
  const scalar = h.reduce((sum, value) => sum + value, 0) / n;
  return { scalar, h, multichain: false };
}

function evaluatePolicy(actions: Action[][], choice: number[], input: MdpInput): Eval {
  const { p, c } = policyData(actions, choice);
  if (input.criterion === "discounted") return evaluateDiscounted(p, c, input.discount!);
  return evaluateAverage(p, c);
}

function qValue(action: Action, h: number[], gamma: number | null): number {
  const factor = gamma ?? 1;
  return action.cost + factor * dot(action.transitions, h);
}

function improve(actions: Action[][], choice: number[], h: number[], input: MdpInput): number[] {
  const gamma = input.criterion === "discounted" ? input.discount : null;
  return choice.map((current, i) => {
    let best = current;
    let bestQ = qValue(actions[i][current], h, gamma);
    actions[i].forEach((action, a) => {
      const q = qValue(action, h, gamma);
      const better = input.sense === "min" ? q < bestQ - 1e-9 : q > bestQ + 1e-9;
      if (better) {
        bestQ = q;
        best = a;
      }
    });
    return best;
  });
}

function policyKey(choice: number[]): string {
  return choice.join(",");
}

function policyLabel(states: string[], actions: Action[][], choice: number[]): string {
  return states.map((name, i) => `${name}: ${actions[i][choice[i]].name}`).join("; ");
}

function sameChoice(a: number[], b: number[]): boolean {
  return a.every((value, i) => value === b[i]);
}

function betterScalar(candidate: number, current: number, sense: "min" | "max"): boolean {
  return sense === "min" ? candidate < current - 1e-8 : candidate > current + 1e-8;
}

function closeScalar(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-5 * (1 + Math.abs(a) + Math.abs(b));
}

type SolvedPolicy = { choice: number[]; eval: Eval };

function policyIteration(input: MdpInput, warnings: string[]): { best: SolvedPolicy; trace: SolvedPolicy[] } {
  const { actions, states } = input;
  let choice = states.map(() => 0);
  const seen = new Set<string>();
  const trace: SolvedPolicy[] = [];
  let best: SolvedPolicy | null = null;
  let settled = false;
  for (let iter = 0; iter < 64; iter++) {
    const key = policyKey(choice);
    if (seen.has(key)) break;
    seen.add(key);
    const evalNow = evaluatePolicy(actions, choice, input);
    const solved = { choice: choice.slice(), eval: evalNow };
    trace.push(solved);
    if (!best || betterScalar(evalNow.scalar, best.eval.scalar, input.sense)) best = solved;
    const next = improve(actions, choice, evalNow.h, input);
    if (sameChoice(next, choice)) {
      settled = true;
      break;
    }
    choice = next;
  }
  if (!settled) {
    warnings.push(
      "La iteración de políticas no se estabilizó en el límite de pasos. Se muestra la mejor política que sí se evaluó.",
    );
  }
  return { best: best!, trace };
}

function enumeratePolicies(input: MdpInput): SolvedPolicy[] | null {
  const counts = input.actions.map((list) => list.length);
  let product = 1;
  for (const count of counts) {
    product *= count;
    if (product > ENUM_MAX) return null;
  }
  const out: SolvedPolicy[] = [];
  const choice = Array(counts.length).fill(0);
  for (let n = 0; n < product; n++) {
    out.push({ choice: choice.slice(), eval: evaluatePolicy(input.actions, choice, input) });
    for (let i = counts.length - 1; i >= 0; i--) {
      choice[i] += 1;
      if (choice[i] < counts[i]) break;
      choice[i] = 0;
    }
  }
  return out;
}

function solveMdp(input: MdpInput, warnings: string[]): ModuleResult {
  const { states, actions, sense, criterion } = input;
  const { best, trace } = policyIteration(input, warnings);
  const enumerated = enumeratePolicies(input);
  if (!enumerated) {
    const total = actions.reduce((prod, list) => prod * list.length, 1);
    warnings.push(
      `Hay ${total} políticas y solo se listan todas cuando son 256 o menos. La óptima se obtuvo por iteración de políticas.`,
    );
  }
  const pool = enumerated ?? [best];
  let target = best.eval.scalar;
  for (const item of pool) {
    if (betterScalar(item.eval.scalar, target, sense)) target = item.eval.scalar;
  }
  // La iteración debe alcanzar el óptimo de la enumeración. Si no lo hace,
  // se reporta la política enumerada y la traza de la iteración se deja intacta.
  let reported = best;
  if (enumerated && !closeScalar(best.eval.scalar, target)) {
    const replacement = enumerated.find((item) => closeScalar(item.eval.scalar, target));
    if (replacement) {
      warnings.push(
        "La iteración de políticas no coincidió con la mejor política enumerada; se reporta la de la enumeración.",
      );
      reported = { choice: replacement.choice.slice(), eval: replacement.eval };
    }
  }

  const chosen = reported.choice;
  const { p, c } = policyData(actions, chosen);
  const info = classify(p);
  if (reported.eval.multichain || info.classes.filter((cl) => cl.recurrent).length > 1) {
    warnings.push(
      "La política óptima tiene varias clases recurrentes, así que el costo promedio depende de dónde empieces. El número que se reporta es el esperado si el estado inicial es igual de probable en todos los estados.",
    );
  }

  const valueName = criterion === "discounted" ? "valor_descontado" : "costo_promedio";
  const policyRows = (enumerated ?? [best]).map((item) => [
    policyLabel(states, actions, item.choice),
    item.eval.scalar,
    closeScalar(item.eval.scalar, reported.eval.scalar) ? "sí" : "no",
  ]);

  const variables: Record<string, number> = { optimal_value: reported.eval.scalar };
  const metrics: Record<string, number> = {
    optimal_value: reported.eval.scalar,
    num_states: states.length,
  };
  if (input.discount != null) metrics.discount = input.discount;
  states.forEach((name, i) => {
    variables[`valor_${name}`] = reported.eval.h[i];
    metrics[`valor_${name}`] = reported.eval.h[i];
  });

  const tables: NamedTable[] = [];
  if (enumerated) {
    tables.push({
      name: "policies",
      columns: ["politica", valueName, "optima"],
      rows: policyRows,
    });
  }
  tables.push({
    name: "policy_iteration",
    columns: ["paso", "politica", valueName],
    rows: trace.map((item, i) => [i + 1, policyLabel(states, actions, item.choice), item.eval.scalar]),
  });
  tables.push({
    name: "optimal_policy",
    columns: ["estado", "accion", "costo", "valor"],
    rows: states.map((name, i) => [name, actions[i][chosen[i]].name, c[i], reported.eval.h[i]]),
  });

  const graph: GraphNetwork = {
    type: "network",
    directed: true,
    nodes: states.map((name, i) => {
      const cl = info.classes[info.classOf[i]];
      return {
        id: name,
        absorbing: cl.absorbing,
        kind: actions[i][chosen[i]].name,
      };
    }),
    edges: states.flatMap((source, i) =>
      states.flatMap((target, j) =>
        p[i][j] > ARC_TOL ? [{ source, target, probability: tidy(p[i][j]) }] : [],
      ),
    ),
    title: "Política óptima del proceso de decisión",
    subtitle: "En cada estado se muestra la acción elegida; los arcos son sus probabilidades",
  };

  return okResult("markov", {
    status: "optimal",
    variables,
    objective_value: reported.eval.scalar,
    objective_sense: sense,
    metrics,
    graph,
    tables,
    warnings,
  });
}

function detectMode(body: Record<string, unknown>): Mode {
  if (body.mode === "mdp") return "mdp";
  if (body.mode === "chain" || body.mode == null) return "chain";
  throw new SolverError("El modo debe ser «chain» (cadena de Markov) o «mdp» (proceso de decisión).");
}

export function solve(body: unknown): ModuleResult {
  const record = asRecord(body);
  const mode = detectMode(record);
  const warnings: string[] = [];
  if (mode === "mdp") return solveMdp(parseMdp(record), warnings);
  return solveChain(parseChain(record, warnings), warnings);
}
