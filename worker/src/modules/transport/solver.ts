import { SolverError } from "../../errors";
import { LIMITS, assertLimit } from "../../limits";
import type { GraphMatrix, IterationStep, ModuleResult, NamedTable, SensitivityBlock } from "../../schema";
import { emptySensitivity, okResult } from "../../schema";

/**
 * Transporte con M simbólica: cada costo es a·M + b, de modo que las rutas
 * prohibidas nunca se confunden con un costo grande pero finito.
 */

export const DUMMY_SOURCE = "Origen ficticio";
export const DUMMY_DEST = "Destino ficticio";

const METHODS = ["northwest", "vogel", "least_cost", "modi_auto"] as const;
export type TransportMethod = (typeof METHODS)[number];

const METHOD_LABEL: Record<TransportMethod, string> = {
  northwest: "Esquina noroeste",
  least_cost: "Costo mínimo",
  vogel: "Vogel",
  modi_auto: "Vogel + MODI",
};

const MAX_PIVOTS = 500;
const BLAND_AFTER = 50;

export type TransportRequest = {
  supply: Record<string, number>;
  demand: Record<string, number>;
  costs: Record<string, Record<string, number>>;
  method: TransportMethod;
  objective: "minimize" | "maximize";
  forbidden_routes: [string, string][];
};

type Cell = [number, number];
/** a·M + b */
type MV = [number, number];

const M_EPS = 1e-9;

function mvSub(x: MV, y: MV): MV {
  return [x[0] - y[0], x[1] - y[1]];
}

function mvAdd(x: MV, y: MV): MV {
  return [x[0] + y[0], x[1] + y[1]];
}

function mvScale(x: MV, k: number): MV {
  return [x[0] * k, x[1] * k];
}

function mvCmp(x: MV, y: MV, eps: number): number {
  if (Math.abs(x[0] - y[0]) > M_EPS) return x[0] < y[0] ? -1 : 1;
  if (Math.abs(x[1] - y[1]) > eps) return x[1] < y[1] ? -1 : 1;
  return 0;
}

function hasM(x: MV): boolean {
  return Math.abs(x[0]) > M_EPS;
}

/** Número limpio: sin colas de punto flotante. */
function clean(x: number): number {
  const r = Math.round(x);
  if (Math.abs(x - r) < 1e-9) return r === 0 ? 0 : r;
  return Number(x.toFixed(9));
}

function fmtNum(x: number): string {
  const v = Number(clean(x).toFixed(4));
  return String(v === 0 ? 0 : v);
}

/** M-valor legible: 3, M, -M + 2, 2M - 1. */
function fmtMV(x: MV): string {
  const a = clean(x[0]);
  const b = clean(x[1]);
  if (Math.abs(a) <= M_EPS) return fmtNum(b);
  const coef = a === 1 ? "M" : a === -1 ? "-M" : `${fmtNum(a)}M`;
  if (Math.abs(b) < 1e-12) return coef;
  return `${coef} ${b < 0 ? "-" : "+"} ${fmtNum(Math.abs(b))}`;
}

/** Valor para JSON: número si no lleva M, texto si la lleva. */
function outMV(x: MV): number | string {
  return hasM(x) ? fmtMV(x) : clean(x[1]);
}

function asRecord(body: unknown, message: string): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SolverError(message);
  return body as Record<string, unknown>;
}

function toNumber(raw: unknown, what: string): number {
  let n = NaN;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && raw.trim() !== "") n = Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(n)) throw new SolverError(`${what} debe ser un número.`);
  return n;
}

function isReserved(name: string): boolean {
  const k = name.trim().toLowerCase();
  return k === DUMMY_SOURCE.toLowerCase() || k === DUMMY_DEST.toLowerCase();
}

function quantities(raw: unknown, kind: "oferta" | "demanda"): Record<string, number> {
  const who = kind === "oferta" ? "origen" : "destino";
  const o = asRecord(raw ?? {}, `La ${kind} debe ser un objeto { ${who}: cantidad }.`);
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(o)) {
    if (!name.trim()) throw new SolverError(`Hay un ${who} sin nombre.`);
    if (isReserved(name)) throw new SolverError(`«${name}» es un nombre reservado; usa otro nombre de ${who}.`);
    const n = toNumber(value, `La ${kind} de «${name}»`);
    if (n < 0) throw new SolverError(`La ${kind} de «${name}» no puede ser negativa.`);
    out[name] = n;
  }
  if (!Object.keys(out).length) throw new SolverError(`Agrega al menos un ${who} con su ${kind}.`);
  return out;
}

export function parseTransportRequest(body: unknown): TransportRequest {
  const o = asRecord(body, "El modelo debe ser un objeto JSON.");
  const supply = quantities(o.supply, "oferta");
  const demand = quantities(o.demand, "demanda");
  assertLimit(
    Object.keys(supply).length <= LIMITS.transportDim && Object.keys(demand).length <= LIMITS.transportDim,
    `Transporte limitado a ${LIMITS.transportDim}×${LIMITS.transportDim} en el plan Free`,
  );

  const forbidden: [string, string][] = [];
  if (o.forbidden_routes != null) {
    if (!Array.isArray(o.forbidden_routes)) {
      throw new SolverError("forbidden_routes debe ser una lista de pares [origen, destino].");
    }
    for (const pair of o.forbidden_routes) {
      if (!Array.isArray(pair) || pair.length < 2) {
        throw new SolverError("Cada ruta prohibida debe ser un par [origen, destino].");
      }
      const src = String(pair[0]);
      const dst = String(pair[1]);
      if (!(src in supply) || !(dst in demand)) {
        throw new SolverError(`La ruta prohibida ${src} -> ${dst} no corresponde a un origen y un destino del modelo.`);
      }
      if (!forbidden.some(([a, b]) => a === src && b === dst)) forbidden.push([src, dst]);
    }
  }
  const isForbidden = (i: string, j: string) => forbidden.some(([a, b]) => a === i && b === j);

  const costsRaw = asRecord(o.costs ?? {}, "Los costos deben ser un objeto { origen: { destino: costo } }.");
  const costs: Record<string, Record<string, number>> = {};
  for (const i of Object.keys(supply)) {
    const row = costsRaw[i];
    const rowObj = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : {};
    costs[i] = {};
    for (const j of Object.keys(demand)) {
      if (isForbidden(i, j)) continue;
      const raw = rowObj[j];
      if (raw == null || raw === "") {
        throw new SolverError(`Falta el costo de la ruta ${i} -> ${j}. Escribe un número o márcala como prohibida.`);
      }
      costs[i][j] = toNumber(raw, `El costo de ${i} -> ${j}`);
    }
  }

  const totalS = Object.values(supply).reduce((a, b) => a + b, 0);
  const totalD = Object.values(demand).reduce((a, b) => a + b, 0);
  if (totalS <= 0) throw new SolverError("La oferta total es 0: no hay nada que enviar.");
  if (totalD <= 0) throw new SolverError("La demanda total es 0: ningún destino necesita unidades.");

  const method = METHODS.includes(o.method as TransportMethod) ? (o.method as TransportMethod) : "modi_auto";
  return {
    supply,
    demand,
    costs,
    method,
    objective: o.objective === "maximize" ? "maximize" : "minimize",
    forbidden_routes: forbidden,
  };
}

type Problem = {
  sources: string[];
  dests: string[];
  supply: number[];
  demand: number[];
  /** Costo en espacio de minimización (a·M + b). */
  cost: MV[][];
  /** Costo original; null = ruta prohibida. */
  orig: (number | null)[][];
  sign: 1 | -1;
  dummyRow: boolean;
  dummyCol: boolean;
  tolQ: number;
  tolC: number;
};

type State = { alloc: number[][]; basis: Cell[] };

function zeros(m: number, n: number): number[][] {
  return Array.from({ length: m }, () => Array.from({ length: n }, () => 0));
}

function routeName(p: Problem, [r, c]: Cell): string {
  return `${p.sources[r]}->${p.dests[c]}`;
}

function routeLabel(p: Problem, [r, c]: Cell): string {
  return `${p.sources[r]} -> ${p.dests[c]}`;
}

function costLabel(p: Problem, [r, c]: Cell): string {
  const o = p.orig[r][c];
  return o == null ? "M" : fmtNum(o);
}

function isDummy(p: Problem, [r, c]: Cell): boolean {
  return (p.dummyRow && r === p.sources.length - 1) || (p.dummyCol && c === p.dests.length - 1);
}

function inBasis(basis: Cell[], r: number, c: number): boolean {
  return basis.some(([a, b]) => a === r && b === c);
}

function allocCost(p: Problem, alloc: number[][]): MV {
  let total: MV = [0, 0];
  alloc.forEach((row, r) =>
    row.forEach((q, c) => {
      if (q !== 0) total = mvAdd(total, mvScale(p.cost[r][c], q));
    }),
  );
  return total;
}

function objectiveValue(p: Problem, alloc: number[][]): number {
  let total = 0;
  alloc.forEach((row, r) =>
    row.forEach((q, c) => {
      const o = p.orig[r][c];
      if (o != null && q > p.tolQ) total += q * o;
    }),
  );
  return clean(total);
}

function tableau(
  p: Problem,
  st: State,
  opts: { supplyLeft?: number[]; demandLeft?: number[]; u?: MV[]; v?: MV[]; reduced?: (MV | null)[][] },
): (number | string)[][] {
  const withRem = opts.supplyLeft != null;
  const header: (number | string)[] = ["", ...p.dests];
  if (withRem) header.push("Oferta");
  if (opts.u) header.push("u");
  const rows: (number | string)[][] = [header];
  p.sources.forEach((name, r) => {
    const row: (number | string)[] = [name];
    p.dests.forEach((_, c) => {
      const cost = costLabel(p, [r, c]);
      if (inBasis(st.basis, r, c)) row.push(`${fmtNum(st.alloc[r][c])} (${cost})`);
      else {
        const d = opts.reduced?.[r]?.[c];
        row.push(d ? `(${cost}) d=${fmtMV(d)}` : `(${cost})`);
      }
    });
    if (withRem) row.push(clean(opts.supplyLeft![r]));
    if (opts.u) row.push(fmtMV(opts.u[r]));
    rows.push(row);
  });
  if (opts.demandLeft) {
    const dem: (number | string)[] = ["Demanda", ...opts.demandLeft.map(clean)];
    if (withRem) dem.push("");
    rows.push(dem);
  }
  if (opts.v) {
    const vrow: (number | string)[] = ["v", ...opts.v.map(fmtMV)];
    if (opts.u) vrow.push("");
    rows.push(vrow);
  }
  return rows;
}

function snapshot(st: State): { alloc: number[][]; basis: Cell[] } {
  return { alloc: st.alloc.map((row) => row.map(clean)), basis: st.basis.map(([r, c]) => [r, c] as Cell) };
}

type InitialStep = {
  cell: Cell;
  qty: number;
  reason: string;
  rowPen?: (MV | null)[];
  colPen?: (MV | null)[];
};

/** Asignación común: descuenta, decide qué línea se tacha y registra el paso. */
function runInitial(
  p: Problem,
  method: "northwest" | "least_cost" | "vogel",
  pick: (s: number[], d: number[], rows: Set<number>, cols: Set<number>) => Omit<InitialStep, "qty">,
): { state: State; steps: IterationStep[] } {
  const m = p.sources.length;
  const n = p.dests.length;
  const s = [...p.supply];
  const d = [...p.demand];
  const st: State = { alloc: zeros(m, n), basis: [] };
  const rows = new Set(Array.from({ length: m }, (_, i) => i));
  const cols = new Set(Array.from({ length: n }, (_, j) => j));
  const steps: IterationStep[] = [];
  while (rows.size && cols.size) {
    const choice = pick(s, d, rows, cols);
    const [r, c] = choice.cell;
    const qty = Math.min(s[r], d[c]);
    st.alloc[r][c] += qty;
    if (!inBasis(st.basis, r, c)) st.basis.push([r, c]);
    s[r] -= qty;
    d[c] -= qty;
    const rowDone = s[r] <= p.tolQ;
    const colDone = d[c] <= p.tolQ;
    if (rowDone) s[r] = 0;
    if (colDone) d[c] = 0;
    // Si se agotan fila y columna a la vez, solo se tacha una: la otra queda
    // con 0 y recibirá una asignación básica de 0 (degeneración controlada).
    let crossed: "row" | "col" | "both";
    if (rows.size === 1 && cols.size === 1) crossed = "both";
    else if (rowDone && (!colDone || rows.size > 1)) crossed = "row";
    else crossed = "col";
    if (crossed !== "col") rows.delete(r);
    if (crossed !== "row") cols.delete(c);

    const label = routeLabel(p, [r, c]);
    const crossedText =
      crossed === "both"
        ? "Se completan la última fila y la última columna."
        : crossed === "row"
          ? `Se agota la oferta de ${p.sources[r]}; se tacha su fila.`
          : `Se cubre la demanda de ${p.dests[c]}; se tacha su columna.`;
    const snap = snapshot(st);
    steps.push({
      index: 0,
      method,
      title: `${METHOD_LABEL[method]}: ${fmtNum(qty)} unidades a ${label} (costo ${costLabel(p, [r, c])})`,
      tableau: tableau(p, st, { supplyLeft: s, demandLeft: d }),
      meta: {
        phase: "initial",
        cell: [r, c],
        route: routeName(p, [r, c]),
        qty: clean(qty),
        cost: p.orig[r][c] ?? "M",
        reason:
          `${choice.reason} Se asignan min(${fmtNum(s[r] + qty)}, ${fmtNum(d[c] + qty)}) = ${fmtNum(qty)} unidades. ${crossedText}` +
          (qty <= p.tolQ ? " Es una asignación de 0: la celda queda en la base para completar m + n - 1 celdas básicas." : ""),
        crossed,
        row_penalties: choice.rowPen ? choice.rowPen.map((x) => (x ? outMV(x) : null)) : undefined,
        col_penalties: choice.colPen ? choice.colPen.map((x) => (x ? outMV(x) : null)) : undefined,
        supply_left: s.map(clean),
        demand_left: d.map(clean),
        alloc: snap.alloc,
        basis: snap.basis,
        sources: p.sources,
        dests: p.dests,
      },
    });
  }
  return { state: st, steps };
}

function northwest(p: Problem) {
  return runInitial(p, "northwest", (_s, _d, rows, cols) => {
    const r = Math.min(...rows);
    const c = Math.min(...cols);
    return {
      cell: [r, c],
      reason: `La esquina superior izquierda disponible es ${routeLabel(p, [r, c])}.`,
    };
  });
}

function cheapest(
  p: Problem,
  rows: Iterable<number>,
  cols: Iterable<number>,
  s: number[],
  d: number[],
): Cell {
  let best: Cell | null = null;
  let bestQty = -1;
  for (const r of rows) {
    for (const c of cols) {
      const qty = Math.min(s[r], d[c]);
      if (!best) {
        best = [r, c];
        bestQty = qty;
        continue;
      }
      const cmp = mvCmp(p.cost[r][c], p.cost[best[0]][best[1]], p.tolC);
      if (cmp < 0 || (cmp === 0 && qty > bestQty + p.tolQ)) {
        best = [r, c];
        bestQty = qty;
      }
    }
  }
  return best!;
}

function leastCost(p: Problem) {
  return runInitial(p, "least_cost", (s, d, rows, cols) => {
    const cell = cheapest(p, [...rows].sort((a, b) => a - b), [...cols].sort((a, b) => a - b), s, d);
    return {
      cell,
      reason: `${routeLabel(p, cell)} es la ruta disponible más ${p.sign === 1 ? "barata" : "rentable"} (costo ${costLabel(p, cell)}).`,
    };
  });
}

function penalty(values: MV[], eps: number): MV {
  const sorted = [...values].sort((a, b) => mvCmp(a, b, eps));
  return mvSub(sorted[1], sorted[0]);
}

function vogel(p: Problem) {
  const m = p.sources.length;
  const n = p.dests.length;
  return runInitial(p, "vogel", (s, d, rows, cols) => {
    const R = [...rows].sort((a, b) => a - b);
    const C = [...cols].sort((a, b) => a - b);
    if (R.length === 1 || C.length === 1) {
      const cell = cheapest(p, R, C, s, d);
      return {
        cell,
        reason: `Solo queda una ${R.length === 1 ? "fila" : "columna"}: se asigna en su celda más ${
          p.sign === 1 ? "barata" : "rentable"
        }, ${routeLabel(p, cell)}.`,
      };
    }
    const rowPen: (MV | null)[] = Array.from({ length: m }, () => null);
    const colPen: (MV | null)[] = Array.from({ length: n }, () => null);
    for (const r of R) rowPen[r] = penalty(C.map((c) => p.cost[r][c]), p.tolC);
    for (const c of C) colPen[c] = penalty(R.map((r) => p.cost[r][c]), p.tolC);

    type Line = { kind: "row" | "col"; idx: number; pen: MV; min: MV };
    const lines: Line[] = [
      ...R.map((r) => ({
        kind: "row" as const,
        idx: r,
        pen: rowPen[r]!,
        min: C.map((c) => p.cost[r][c]).sort((a, b) => mvCmp(a, b, p.tolC))[0],
      })),
      ...C.map((c) => ({
        kind: "col" as const,
        idx: c,
        pen: colPen[c]!,
        min: R.map((r) => p.cost[r][c]).sort((a, b) => mvCmp(a, b, p.tolC))[0],
      })),
    ];
    // Mayor penalización; empate → la línea con el costo mínimo más bajo; luego filas antes que columnas.
    let best = lines[0];
    for (const line of lines.slice(1)) {
      const byPen = mvCmp(line.pen, best.pen, p.tolC);
      if (byPen > 0 || (byPen === 0 && mvCmp(line.min, best.min, p.tolC) < 0)) best = line;
    }
    const cell = best.kind === "row" ? cheapest(p, [best.idx], C, s, d) : cheapest(p, R, [best.idx], s, d);
    const where = best.kind === "row" ? `la fila ${p.sources[best.idx]}` : `la columna ${p.dests[best.idx]}`;
    return {
      cell,
      rowPen,
      colPen,
      reason: `La mayor penalización es ${fmtMV(best.pen)}, en ${where}. Se asigna en su celda más ${
        p.sign === 1 ? "barata" : "rentable"
      }, ${routeLabel(p, cell)} (costo ${costLabel(p, cell)}).`,
    };
  });
}

/** Completa la base a m+n-1 celdas sin formar ciclos (red de seguridad). */
function completeBasis(p: Problem, st: State): void {
  const m = p.sources.length;
  const n = p.dests.length;
  const parent = Array.from({ length: m + n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const kept: Cell[] = [];
  for (const [r, c] of st.basis) {
    const a = find(r);
    const b = find(m + c);
    if (a !== b) {
      parent[a] = b;
      kept.push([r, c]);
    }
  }
  st.basis = kept;
  if (kept.length >= m + n - 1) return;
  const candidates: Cell[] = [];
  for (let r = 0; r < m; r++) for (let c = 0; c < n; c++) if (!inBasis(kept, r, c)) candidates.push([r, c]);
  candidates.sort((x, y) => mvCmp(p.cost[x[0]][x[1]], p.cost[y[0]][y[1]], p.tolC));
  for (const [r, c] of candidates) {
    const a = find(r);
    const b = find(m + c);
    if (a !== b) {
      parent[a] = b;
      st.basis.push([r, c]);
      if (st.basis.length >= m + n - 1) break;
    }
  }
}

function duals(p: Problem, basis: Cell[]): { u: MV[]; v: MV[] } {
  const m = p.sources.length;
  const n = p.dests.length;
  const u: (MV | null)[] = Array.from({ length: m }, () => null);
  const v: (MV | null)[] = Array.from({ length: n }, () => null);
  u[0] = [0, 0];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [r, c] of basis) {
      if (u[r] && !v[c]) {
        v[c] = mvSub(p.cost[r][c], u[r]!);
        changed = true;
      } else if (v[c] && !u[r]) {
        u[r] = mvSub(p.cost[r][c], v[c]!);
        changed = true;
      }
    }
  }
  if (u.some((x) => !x) || v.some((x) => !x)) {
    throw new SolverError("No se pudieron calcular los multiplicadores uᵢ, vⱼ (base incompleta).");
  }
  return { u: u as MV[], v: v as MV[] };
}

function reducedCosts(p: Problem, basis: Cell[], u: MV[], v: MV[]): (MV | null)[][] {
  return p.cost.map((row, r) => row.map((c, j) => (inBasis(basis, r, j) ? null : mvSub(mvSub(c, u[r]), v[j]))));
}

/** Camino en el árbol de la base desde la fila r0 hasta la columna c0. */
function treePath(p: Problem, basis: Cell[], r0: number, c0: number): Cell[] {
  const m = p.sources.length;
  const target = m + c0;
  const prev = new Map<number, { node: number; cell: Cell }>();
  const seen = new Set([r0]);
  const queue = [r0];
  while (queue.length) {
    const node = queue.shift()!;
    if (node === target) break;
    for (const [r, c] of basis) {
      let next = -1;
      if (node < m && r === node) next = m + c;
      else if (node >= m && c === node - m) next = r;
      if (next < 0 || seen.has(next)) continue;
      seen.add(next);
      prev.set(next, { node, cell: [r, c] });
      queue.push(next);
    }
  }
  const path: Cell[] = [];
  let cur = target;
  while (cur !== r0) {
    const link = prev.get(cur);
    if (!link) throw new SolverError("No se encontró el ciclo de mejora (base inválida).");
    path.unshift(link.cell);
    cur = link.node;
  }
  return path;
}

type ModiOutcome = { state: State; steps: IterationStep[]; pivots: number; converged: boolean };

function modi(p: Problem, start: State, record: boolean): ModiOutcome {
  const st: State = { alloc: start.alloc.map((row) => [...row]), basis: start.basis.map(([r, c]) => [r, c] as Cell) };
  const steps: IterationStep[] = [];
  let pivots = 0;
  for (;;) {
    const { u, v } = duals(p, st.basis);
    const reduced = reducedCosts(p, st.basis, u, v);
    let enter: Cell | null = null;
    for (let r = 0; r < reduced.length; r++) {
      for (let c = 0; c < reduced[r].length; c++) {
        const d = reduced[r][c];
        if (!d || mvCmp(d, [0, 0], p.tolC) >= 0) continue;
        if (!enter) enter = [r, c];
        else if (pivots < BLAND_AFTER && mvCmp(d, reduced[enter[0]][enter[1]]!, p.tolC) < 0) enter = [r, c];
      }
    }
    const before = allocCost(p, st.alloc);
    if (!enter || pivots >= MAX_PIVOTS) {
      if (record) steps.push(modiStep(p, st, u, v, reduced, null, [], 0, null, pivots));
      return { state: st, steps, pivots, converged: !enter };
    }
    const path = treePath(p, st.basis, enter[0], enter[1]);
    const cycle: [number, number, 1 | -1][] = [
      [enter[0], enter[1], 1],
      ...path.map(([r, c], k) => [r, c, k % 2 === 0 ? -1 : 1] as [number, number, 1 | -1]),
    ];
    const minus = cycle.filter(([, , sgn]) => sgn === -1);
    const theta = Math.min(...minus.map(([r, c]) => st.alloc[r][c]));
    // Sale la primera celda con signo - que llega a 0; con Bland, la de menor índice.
    const ties = minus.filter(([r, c]) => st.alloc[r][c] <= theta + p.tolQ);
    const n = p.dests.length;
    const leaveCell =
      pivots < BLAND_AFTER ? ties[0] : ties.reduce((a, b) => (b[0] * n + b[1] < a[0] * n + a[1] ? b : a));
    const leave: Cell = [leaveCell[0], leaveCell[1]];
    if (record) steps.push(modiStep(p, st, u, v, reduced, enter, cycle, theta, leave, pivots, before));
    for (const [r, c, sgn] of cycle) {
      st.alloc[r][c] += sgn * theta;
      if (Math.abs(st.alloc[r][c]) <= p.tolQ) st.alloc[r][c] = 0;
    }
    st.alloc[leave[0]][leave[1]] = 0;
    st.basis = st.basis.filter(([r, c]) => !(r === leave[0] && c === leave[1]));
    st.basis.push(enter);
    pivots++;
  }
}

function modiStep(
  p: Problem,
  st: State,
  u: MV[],
  v: MV[],
  reduced: (MV | null)[][],
  enter: Cell | null,
  cycle: [number, number, 1 | -1][],
  theta: number,
  leave: Cell | null,
  pivot: number,
  before?: MV,
): IterationStep {
  const sign = p.sign;
  const snap = snapshot(st);
  const shown = (x: MV) => mvScale(x, sign);
  const reducedOut = reduced.map((row, r) =>
    row.map((d, c) => (d == null || p.orig[r][c] == null ? null : outMV(shown(d)))),
  );
  const costNow = objectiveValue(p, st.alloc);
  let title: string;
  let reason: string;
  if (enter) {
    const delta = shown(reduced[enter[0]][enter[1]]!);
    const change = clean(theta * delta[1]);
    title = `MODI ${pivot + 1}: entra ${routeLabel(p, enter)}, sale ${routeLabel(p, leave!)} (theta = ${fmtNum(theta)})`;
    reason =
      `${routeLabel(p, enter)} tiene el costo reducido ${p.sign === 1 ? "más negativo" : "más positivo"} (${fmtMV(delta)}): ` +
      `cada unidad enviada por ahí ${p.sign === 1 ? "baja el costo" : "sube la ganancia"} en ${fmtMV(mvScale(delta, -sign))}. ` +
      `En el ciclo, la menor cantidad de las celdas con signo - es theta = ${fmtNum(theta)}, en ${routeLabel(p, leave!)}, que sale de la base.` +
      (theta <= p.tolQ
        ? " Como theta = 0 el cambio es degenerado: la base cambia pero el costo no."
        : ` El ${p.sign === 1 ? "costo" : "valor"} pasa de ${fmtNum(costNow)} a ${fmtNum(costNow + change)}.`);
  } else {
    title = "MODI: todos los costos reducidos cumplen la condición de óptimo";
    reason =
      p.sign === 1
        ? "Ningún costo reducido es negativo: ninguna ruta sin usar puede bajar el costo total. La solución es óptima."
        : "Ningún costo reducido es positivo: ninguna ruta sin usar puede subir la ganancia total. La solución es óptima.";
  }
  return {
    index: 0,
    method: "modi",
    title,
    tableau: tableau(p, st, { u, v, reduced }),
    meta: {
      phase: "modi",
      u: u.map((x) => outMV(shown(x))),
      v: v.map((x) => outMV(shown(x))),
      reduced: reducedOut,
      enter,
      delta: enter ? outMV(shown(reduced[enter[0]][enter[1]]!)) : null,
      cycle,
      theta: clean(theta),
      leave,
      cost: before && hasM(before) ? fmtMV(mvScale(before, sign)) : costNow,
      reason,
      alloc: snap.alloc,
      basis: snap.basis,
      sources: p.sources,
      dests: p.dests,
    },
  };
}

function buildProblem(req: TransportRequest, warnings: string[]): Problem {
  const sources = Object.keys(req.supply);
  const dests = Object.keys(req.demand);
  const supply = sources.map((i) => req.supply[i]);
  const demand = dests.map((j) => req.demand[j]);
  const totalS = supply.reduce((a, b) => a + b, 0);
  const totalD = demand.reduce((a, b) => a + b, 0);
  const tolQ = 1e-9 * Math.max(1, totalS, totalD);
  let dummyRow = false;
  let dummyCol = false;
  if (totalS > totalD + tolQ) {
    dests.push(DUMMY_DEST);
    demand.push(totalS - totalD);
    dummyCol = true;
    warnings.push(
      `La oferta total (${fmtNum(totalS)}) supera la demanda total (${fmtNum(totalD)}): se agregó un destino ficticio con costo 0 que recibe las ${fmtNum(totalS - totalD)} unidades que no se envían.`,
    );
  } else if (totalD > totalS + tolQ) {
    sources.push(DUMMY_SOURCE);
    supply.push(totalD - totalS);
    dummyRow = true;
    warnings.push(
      `La demanda total (${fmtNum(totalD)}) supera la oferta total (${fmtNum(totalS)}): se agregó un origen ficticio con costo 0; ${fmtNum(totalD - totalS)} unidades de demanda quedarán sin cubrir.`,
    );
  }
  const sign: 1 | -1 = req.objective === "maximize" ? -1 : 1;
  const forbidden = new Set(req.forbidden_routes.map(([i, j]) => `${i}\u0000${j}`));
  const orig = sources.map((i, r) =>
    dests.map((j, c) => {
      if ((dummyRow && r === sources.length - 1) || (dummyCol && c === dests.length - 1)) return 0;
      if (forbidden.has(`${i}\u0000${j}`)) return null;
      return req.costs[i][j];
    }),
  );
  const cost = orig.map((row) => row.map((o): MV => (o == null ? [1, 0] : [0, sign * o])));
  const maxAbs = Math.max(1, ...orig.flat().map((o) => Math.abs(o ?? 0)));
  return {
    sources,
    dests,
    supply,
    demand,
    cost,
    orig,
    sign,
    dummyRow,
    dummyCol,
    tolQ,
    tolC: 1e-9 * maxAbs,
  };
}

export function solve(body: unknown): ModuleResult {
  const req = parseTransportRequest(body);
  const warnings: string[] = [];
  const p = buildProblem(req, warnings);
  const m = p.sources.length;
  const n = p.dests.length;
  const initialMethod = req.method === "modi_auto" ? "vogel" : req.method;

  const init = initialMethod === "northwest" ? northwest(p) : initialMethod === "least_cost" ? leastCost(p) : vogel(p);
  completeBasis(p, init.state);
  const iterations: IterationStep[] = [...init.steps];

  let final: State;
  let converged = true;
  let pivots = 0;
  let optimal: State | null = null;
  if (req.method === "modi_auto") {
    const out = modi(p, init.state, true);
    final = out.state;
    converged = out.converged;
    pivots = out.pivots;
    iterations.push(...out.steps);
  } else {
    final = init.state;
    // Prueba de optimalidad sobre la solución inicial y óptimo de referencia.
    const { u, v } = duals(p, final.basis);
    iterations.push(modiCheckStep(p, final, u, v));
    const best = modi(p, final, false);
    if (best.converged) optimal = best.state;
  }
  iterations.forEach((step, k) => {
    step.index = k;
  });

  const alloc = final.alloc;
  const used = forbiddenUsed(p, alloc);
  const value = objectiveValue(p, alloc);
  const optimalCost = optimal && !forbiddenUsed(p, optimal.alloc).length ? objectiveValue(p, optimal.alloc) : null;
  const lead: string[] = [];
  let status: "optimal" | "feasible" | "infeasible" = "optimal";
  const blocked = req.method === "modi_auto" ? used : optimal ? forbiddenUsed(p, optimal.alloc) : used;
  const blockedAlloc = req.method === "modi_auto" || !optimal ? alloc : optimal.alloc;
  if (blocked.length) {
    status = "infeasible";
    const units = fmtNum(blocked.reduce((t, [r, c]) => t + blockedAlloc[r][c], 0));
    const srcs = new Set(blocked.map(([r]) => r));
    const dsts = new Set(blocked.map(([, c]) => c));
    const detail =
      dsts.size === 1
        ? `${units} unidades hacia ${p.dests[blocked[0][1]]} solo podrían llegar por rutas prohibidas`
        : srcs.size === 1
          ? `${units} unidades de ${p.sources[blocked[0][0]]} solo podrían salir por rutas prohibidas`
          : `haría falta enviar ${blocked
              .map((cell) => `${fmtNum(blockedAlloc[cell[0]][cell[1]])} por ${routeLabel(p, cell)}`)
              .join(", ")}`;
    lead.push(
      `No hay forma de cubrir la demanda sin usar rutas prohibidas: ${detail}. Habilita alguna ruta o revisa la oferta y la demanda.`,
    );
  } else if (req.method !== "modi_auto") {
    const label = METHOD_LABEL[req.method];
    const better = p.sign === 1 ? "el costo óptimo es" : "el valor óptimo es";
    if (used.length) {
      status = "feasible";
      lead.push(
        `La solución inicial de ${label} usa rutas prohibidas (${used.map((cell) => routeLabel(p, cell)).join(", ")}), así que no es válida.` +
          (optimalCost != null ? ` Con MODI se evitan y ${better} ${fmtNum(optimalCost)}.` : ""),
      );
    } else if (optimalCost != null && Math.abs(optimalCost - value) > 1e-9 * Math.max(1, Math.abs(value), Math.abs(optimalCost))) {
      status = "feasible";
      lead.push(
        `Esta es la solución inicial de ${label} y no es óptima: con MODI el ${
          p.sign === 1 ? "costo baja" : "valor sube"
        } de ${fmtNum(value)} a ${fmtNum(optimalCost)} (${fmtNum(Math.abs(value - optimalCost))} de diferencia).`,
      );
    }
  } else if (!converged) {
    status = "feasible";
    lead.push(`MODI se detuvo tras ${MAX_PIVOTS} iteraciones sin confirmar el óptimo.`);
  }
  warnings.unshift(...lead);

  const positive = final.basis.filter(([r, c]) => alloc[r][c] > p.tolQ).length;
  if (status !== "infeasible" && positive < m + n - 1) {
    warnings.push(
      `Solución degenerada: ${positive} rutas con envío y m + n - 1 = ${m + n - 1}. Se usaron celdas básicas con 0 para calcular los multiplicadores.`,
    );
  }

  const { u, v } = duals(p, final.basis);
  const reduced = reducedCosts(p, final.basis, u, v);
  const sensitivity = buildSensitivity(p, u, v, reduced);
  if (status === "optimal") {
    const alt: string[] = [];
    reduced.forEach((row, r) =>
      row.forEach((d, c) => {
        if (d && p.orig[r][c] != null && !isDummy(p, [r, c]) && mvCmp(d, [0, 0], p.tolC) === 0) {
          alt.push(routeLabel(p, [r, c]));
        }
      }),
    );
    if (alt.length) {
      warnings.push(
        `Hay óptimos alternativos: ${alt.slice(0, 5).join(", ")}${alt.length > 5 ? "…" : ""} ${
          alt.length === 1 ? "tiene" : "tienen"
        } costo reducido 0; se pueden usar sin cambiar el ${p.sign === 1 ? "costo" : "valor"} total.`,
      );
    }
  }

  const shipments: Record<string, number> = {};
  const shipRows: (string | number)[][] = [];
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < n; c++) {
      const q = alloc[r][c];
      if (q <= p.tolQ) continue;
      shipments[routeName(p, [r, c])] = clean(q);
      const unit = p.orig[r][c];
      shipRows.push([p.sources[r], p.dests[c], clean(q), unit ?? "M", unit == null ? "M" : clean(q * unit)]);
    }
  }

  const realM = p.dummyRow ? m - 1 : m;
  const realN = p.dummyCol ? n - 1 : n;
  const sum = (xs: number[]) => clean(xs.reduce((a, b) => a + b, 0));
  const sourceRows = p.sources.slice(0, realM).map((name, r) => {
    const sent = sum(alloc[r].slice(0, realN));
    return [name, clean(p.supply[r]), sent, clean(p.supply[r] - sent)];
  });
  const destRows = p.dests.slice(0, realN).map((name, c) => {
    const got = sum(alloc.slice(0, realM).map((row) => row[c]));
    return [name, clean(p.demand[c]), got, clean(p.demand[c] - got)];
  });
  const costRows: (string | number)[][] = p.sources.map((name, r) => [
    name,
    ...p.orig[r].map((o) => o ?? "M"),
    clean(p.supply[r]),
  ]);
  costRows.push(["Demanda", ...p.demand.map(clean), ""]);
  const tables: NamedTable[] = [
    { name: "costos", columns: ["origen", ...p.dests, "oferta"], rows: costRows },
    { name: "envios", columns: ["origen", "destino", "cantidad", "costo_unitario", "subtotal"], rows: shipRows },
    { name: "resumen_origenes", columns: ["origen", "oferta", "enviado", "sin_enviar"], rows: sourceRows },
    { name: "resumen_destinos", columns: ["destino", "demanda", "recibido", "faltante"], rows: destRows },
  ];

  const metrics: Record<string, number> = {
    basic_cells: positive,
    routes_used: shipRows.filter((row) => row[0] !== DUMMY_SOURCE && row[1] !== DUMMY_DEST).length,
    units_shipped: sum(sourceRows.map((row) => Number(row[2]))),
    unused_supply: sum(sourceRows.map((row) => Number(row[3]))),
    unmet_demand: sum(destRows.map((row) => Number(row[3]))),
  };
  if (!used.length) metrics.total_cost = value;
  if (req.method === "modi_auto") metrics.modi_iterations = pivots;
  if (optimalCost != null) {
    metrics.optimal_cost = optimalCost;
    metrics.gap = clean(Math.abs(value - optimalCost));
  }

  const graph: GraphMatrix = {
    type: "matrix",
    row_labels: p.sources,
    col_labels: p.dests,
    values: alloc.map((row) => row.map(clean)),
    title: "Matriz de envíos (transporte)",
    subtitle: "Cantidad enviada de cada origen a cada destino",
    value_label: "Cantidad enviada",
  };

  return okResult("transport", {
    status,
    variables: shipments,
    objective_value: status === "infeasible" || used.length ? null : value,
    objective_sense: p.sign === 1 ? "min" : "max",
    metrics,
    iterations,
    sensitivity,
    graph,
    tables,
    warnings,
  });
}

function forbiddenUsed(p: Problem, alloc: number[][]): Cell[] {
  const out: Cell[] = [];
  alloc.forEach((row, r) =>
    row.forEach((q, c) => {
      if (p.orig[r][c] == null && q > p.tolQ) out.push([r, c]);
    }),
  );
  return out;
}

function modiCheckStep(p: Problem, st: State, u: MV[], v: MV[]): IterationStep {
  const reduced = reducedCosts(p, st.basis, u, v);
  const step = modiStep(p, st, u, v, reduced, null, [], 0, null, 0);
  let worst: Cell | null = null;
  for (let r = 0; r < reduced.length; r++) {
    for (let c = 0; c < reduced[r].length; c++) {
      const d = reduced[r][c];
      if (!d || mvCmp(d, [0, 0], p.tolC) >= 0) continue;
      if (!worst || mvCmp(d, reduced[worst[0]][worst[1]]!, p.tolC) < 0) worst = [r, c];
    }
  }
  step.method = "modi_check";
  step.meta.phase = "check";
  if (worst) {
    const delta = mvScale(reduced[worst[0]][worst[1]]!, p.sign);
    step.title = `Prueba de optimalidad: ${routeLabel(p, worst)} todavía puede mejorar`;
    step.meta.enter = worst;
    step.meta.delta = outMV(delta);
    step.meta.reason =
      `Con los multiplicadores uᵢ + vⱼ = costo de cada celda básica, ${routeLabel(p, worst)} tiene costo reducido ${fmtMV(delta)}: ` +
      `${p.sign === 1 ? "usarla bajaría el costo" : "usarla subiría la ganancia"}. ` +
      "La solución inicial no es óptima; elige «Vogel + MODI» para llegar al óptimo.";
  } else {
    step.title = "Prueba de optimalidad: la solución inicial ya es óptima";
  }
  return step;
}

function buildSensitivity(p: Problem, u: MV[], v: MV[], reduced: (MV | null)[][]): SensitivityBlock {
  const sign = p.sign;
  const rows: Record<string, unknown>[] = [];
  reduced.forEach((row, r) =>
    row.forEach((d, c) => {
      if (!d || p.orig[r][c] == null) return;
      rows.push({
        variable: routeName(p, [r, c]),
        origen: p.sources[r],
        destino: p.dests[c],
        costo_unitario: p.orig[r][c],
        reduced_cost: outMV(mvScale(d, sign)),
        u_i: outMV(mvScale(u[r], sign)),
        v_j: outMV(mvScale(v[c], sign)),
      });
    }),
  );
  const shadow: Record<string, unknown>[] = [
    ...p.sources.map((name, r) => ({ restriccion: `Oferta ${name}`, tipo: "u", nombre: name, valor: outMV(mvScale(u[r], sign)) })),
    ...p.dests.map((name, c) => ({ restriccion: `Demanda ${name}`, tipo: "v", nombre: name, valor: outMV(mvScale(v[c], sign)) })),
  ];
  return { ...emptySensitivity(), reduced_costs: rows, shadow_prices: shadow };
}
