import type { MNum } from "./mnum";
import { ZERO, add, cmp, fmtM, fmtPlain, hasM, isZero, mnum, scale, sign, snap, snapFast, sub } from "./mnum";

/** Tipo de cada columna de la forma estándar. */
export type ColKind = "decision" | "slack" | "surplus" | "artificial";

export type StdForm = {
  colNames: string[];
  kinds: ColKind[];
  /** Restricción (índice) que originó la columna; -1 para variables de decisión. */
  colRow: number[];
  /** Coeficientes de la forma estándar (filas normalizadas con LD >= 0). */
  A: number[][];
  b: number[];
  initialBasis: number[];
  /** Fila multiplicada por -1 porque el LD era negativo. */
  flipped: boolean[];
  nDecision: number;
};

export type Ratio = number | null;

/** Foto de una tabla simplex para el reporte. */
export type Snapshot = {
  phase: "bigm" | "phase1" | "phase2" | "simplex";
  kind: "initial" | "adjust" | "iteration" | "optimal" | "unbounded" | "infeasible" | "phase_end" | "drive_out" | "alternative";
  title: string;
  objectiveLabel: "Z" | "W";
  sense: "max" | "min";
  colNames: string[];
  basicNames: string[];
  /** Fila de cada restricción en la tabla (índice original de la restricción). */
  rowIds: number[];
  rows: number[][];
  rhs: number[];
  row0: MNum[];
  z: MNum;
  entering?: string;
  leaving?: string;
  pivot?: { row: number; col: number; value: number };
  ratios?: Ratio[];
  enteringTies?: string[];
  leavingTies?: string[];
  rule?: "dantzig" | "bland";
  /** Operaciones de renglón que produjeron esta tabla. */
  operations?: string[];
  note?: string;
};

type Tab = {
  T: number[][];
  rhs: number[];
  basic: number[];
  rowIds: number[];
  cost: MNum[];
  active: boolean[];
  sense: "max" | "min";
};

export type EngineOutcome = {
  status: "optimal" | "unbounded" | "infeasible" | "iteration_limit";
  tab: Tab;
  snapshots: Snapshot[];
  warnings: string[];
  /** Variable que puede crecer sin límite cuando el problema no está acotado. */
  unboundedVar?: string;
  /** Artificiales que quedan positivas cuando el problema es infactible. */
  positiveArtificials?: { name: string; row: number; value: number }[];
  ties: { entering: number; leaving: number };
  cycling: boolean;
  pivots: number;
};

const PIVOT_TOL = 1e-9;
const FEAS_TOL = 1e-7;

function maxIterations(form: StdForm): number {
  return Math.max(100, 25 * (form.A.length + form.colNames.length));
}

function clone(tab: Tab): Tab {
  return {
    T: tab.T.map((r) => r.slice()),
    rhs: tab.rhs.slice(),
    basic: tab.basic.slice(),
    rowIds: tab.rowIds.slice(),
    cost: tab.cost.slice(),
    active: tab.active.slice(),
    sense: tab.sense,
  };
}

function activeCols(tab: Tab): number[] {
  return tab.active.map((on, j) => (on ? j : -1)).filter((j) => j >= 0);
}

/** Coeficientes de la fila Z: zj - cj. */
export function row0Of(tab: Tab): MNum[] {
  const n = tab.cost.length;
  const za = new Float64Array(n);
  const zm = new Float64Array(n);
  tab.basic.forEach((bc, i) => {
    const cb = tab.cost[bc];
    if (cb.a === 0 && cb.m === 0) return;
    const row = tab.T[i];
    for (let j = 0; j < n; j++) {
      const t = row[j];
      if (t === 0) continue;
      za[j] += cb.a * t;
      zm[j] += cb.m * t;
    }
  });
  const out: MNum[] = new Array(n);
  for (let j = 0; j < n; j++) out[j] = mnum(za[j] - tab.cost[j].a, zm[j] - tab.cost[j].m);
  return out;
}

function zOf(tab: Tab): MNum {
  let z: MNum = ZERO;
  tab.basic.forEach((bc, i) => {
    if (tab.rhs[i] !== 0) z = add(z, scale(tab.cost[bc], tab.rhs[i]));
  });
  return z;
}

/** Fila Z "cruda": la ecuación Z - Σ cj xj = 0 antes de eliminar las básicas. */
function rawRow0(tab: Tab): MNum[] {
  return tab.cost.map((cj) => scale(cj, -1));
}

function snapshot(
  tab: Tab,
  form: StdForm,
  base: Pick<Snapshot, "phase" | "kind" | "title" | "objectiveLabel"> & Partial<Snapshot>,
  row0Override?: MNum[],
  zOverride?: MNum,
): Snapshot {
  const cols = activeCols(tab);
  const row0 = row0Override ?? row0Of(tab);
  return {
    sense: tab.sense,
    colNames: cols.map((j) => form.colNames[j]),
    basicNames: tab.basic.map((j) => form.colNames[j]),
    rowIds: tab.rowIds.slice(),
    rows: tab.T.map((r) => cols.map((j) => snapFast(r[j]))),
    rhs: tab.rhs.map(snap),
    row0: cols.map((j) => row0[j]),
    z: zOverride ?? zOf(tab),
    ...base,
  };
}

function rowLabel(i: number): string {
  return `R${i + 1}`;
}

function factorText(f: MNum): string {
  const t = fmtM(f);
  return hasM(f) && Math.abs(f.a) > PIVOT_TOL ? `(${t})` : t;
}

function opText(target: string, factor: MNum, source: string): string {
  // target <- target - factor * source
  const s = sign(factor);
  if (s === 0) return "";
  const mag = s < 0 ? scale(factor, -1) : factor;
  const magText = Math.abs(mag.a - 1) < PIVOT_TOL && !hasM(mag) ? "" : `${factorText(mag)}·`;
  return `${target} ← ${target} ${s < 0 ? "+" : "-"} ${magText}${source}`;
}

/** Pivotea en (p, e) y devuelve las operaciones de renglón (eliminación de Gauss-Jordan). */
function pivotOn(tab: Tab, p: number, e: number, row0: MNum[]): string[] {
  const ops: string[] = [];
  const pv = tab.T[p][e];
  if (Math.abs(pv - 1) > PIVOT_TOL) ops.push(`${rowLabel(p)} ← ${rowLabel(p)} ÷ ${fmtPlain(pv)}`);
  tab.T[p] = tab.T[p].map((v) => snapFast(v / pv));
  tab.rhs[p] = snapFast(tab.rhs[p] / pv);
  tab.T[p][e] = 1;
  const f0 = row0[e];
  const op0 = opText("R0", f0, rowLabel(p));
  if (op0) ops.push(op0);
  for (let i = 0; i < tab.T.length; i++) {
    if (i === p) continue;
    const f = tab.T[i][e];
    if (Math.abs(f) < 1e-12) continue;
    ops.push(opText(rowLabel(i), mnum(f), rowLabel(p)));
    tab.T[i] = tab.T[i].map((v, j) => snapFast(v - f * tab.T[p][j]));
    tab.rhs[i] = snapFast(tab.rhs[i] - f * tab.rhs[p]);
    tab.T[i][e] = 0;
  }
  tab.basic[p] = e;
  return ops;
}

type Choice = {
  entering: number | null;
  enteringTies: number[];
};

function chooseEntering(tab: Tab, row0: MNum[], bland: boolean): Choice {
  const dir = tab.sense === "max" ? 1 : -1;
  const candidates = activeCols(tab).filter((j) => !tab.basic.includes(j) && sign(scale(row0[j], dir)) < 0);
  if (!candidates.length) return { entering: null, enteringTies: [] };
  if (bland) return { entering: candidates[0], enteringTies: [] };
  let best = candidates[0];
  for (const j of candidates) if (cmp(scale(row0[j], dir), scale(row0[best], dir)) < 0) best = j;
  const ties = candidates.filter((j) => cmp(scale(row0[j], dir), scale(row0[best], dir)) === 0);
  return { entering: best, enteringTies: ties.length > 1 ? ties : [] };
}

function ratiosFor(tab: Tab, e: number): Ratio[] {
  return tab.T.map((row, i) => (row[e] > PIVOT_TOL ? snap(tab.rhs[i] / row[e]) : null));
}

function chooseLeaving(tab: Tab, ratios: Ratio[], bland: boolean): { row: number | null; ties: number[] } {
  let best: number | null = null;
  for (let i = 0; i < ratios.length; i++) {
    const r = ratios[i];
    if (r == null) continue;
    if (best == null || r < (ratios[best] as number) - 1e-9) best = i;
  }
  if (best == null) return { row: null, ties: [] };
  const min = ratios[best] as number;
  const ties = ratios
    .map((r, i) => (r != null && Math.abs(r - min) <= 1e-9 * Math.max(1, Math.abs(min)) ? i : -1))
    .filter((i) => i >= 0);
  if (bland && ties.length > 1) {
    best = ties.reduce((a, b) => (tab.basic[a] <= tab.basic[b] ? a : b));
  }
  return { row: best, ties: ties.length > 1 ? ties : [] };
}

function basisKey(tab: Tab): string {
  return [...tab.basic].sort((a, b) => a - b).join(",");
}

type EngineState = {
  warnings: string[];
  ties: { entering: number; leaving: number };
  cycling: boolean;
  pivots: number;
};

type LoopResult = {
  status: "optimal" | "unbounded" | "iteration_limit";
  unboundedVar?: string;
};

/** Itera el simplex desde la tabla actual (ya ajustada). */
function loop(
  tab: Tab,
  form: StdForm,
  phase: Snapshot["phase"],
  objectiveLabel: "Z" | "W",
  snaps: Snapshot[] | null,
  state: EngineState,
  pendingOps: string[] | undefined,
  labelPrefix: string,
): LoopResult {
  const seen = new Set<string>([basisKey(tab)]);
  let bland = false;
  let ops = pendingOps;
  const limit = maxIterations(form);
  for (let k = 0; k <= limit; k++) {
    const row0 = row0Of(tab);
    const enter = chooseEntering(tab, row0, bland);
    const titleBase =
      k === 0
        ? `${labelPrefix}Tabla inicial${pendingOps?.length ? ` (fila ${objectiveLabel} ajustada)` : ""}`
        : `${labelPrefix}Iteración ${k}`;
    if (enter.entering == null) {
      snaps?.push(
        snapshot(tab, form, {
          phase,
          kind: "optimal",
          title: `${titleBase} — óptima`,
          objectiveLabel,
          operations: ops,
          rule: bland ? "bland" : "dantzig",
        }),
      );
      return { status: "optimal" };
    }
    const e = enter.entering;
    const ratios = ratiosFor(tab, e);
    const leave = chooseLeaving(tab, ratios, bland);
    if (enter.enteringTies.length) state.ties.entering++;
    if (leave.ties.length) state.ties.leaving++;
    if (leave.row == null) {
      snaps?.push(
        snapshot(tab, form, {
          phase,
          kind: "unbounded",
          title: `${titleBase} — no acotada`,
          objectiveLabel,
          operations: ops,
          entering: form.colNames[e],
          ratios,
          enteringTies: enter.enteringTies.map((j) => form.colNames[j]),
          rule: bland ? "bland" : "dantzig",
        }),
      );
      return { status: "unbounded", unboundedVar: form.colNames[e] };
    }
    const p = leave.row;
    const cols = activeCols(tab);
    snaps?.push(
      snapshot(tab, form, {
        phase,
        kind: k === 0 ? "initial" : "iteration",
        title: `${titleBase}: entra ${form.colNames[e]}, sale ${form.colNames[tab.basic[p]]}`,
        objectiveLabel,
        operations: ops,
        entering: form.colNames[e],
        leaving: form.colNames[tab.basic[p]],
        pivot: { row: p, col: cols.indexOf(e), value: snap(tab.T[p][e]) },
        ratios,
        enteringTies: enter.enteringTies.map((j) => form.colNames[j]),
        leavingTies: leave.ties.map((i) => form.colNames[tab.basic[i]]),
        rule: bland ? "bland" : "dantzig",
      }),
    );
    ops = pivotOn(tab, p, e, row0);
    state.pivots++;
    const key = basisKey(tab);
    if (seen.has(key) && !bland) {
      bland = true;
      state.cycling = true;
      state.warnings.push(
        "Ciclaje: la base se repitió por degeneración. Desde ese punto se usa la regla de Bland (entra y sale la variable de menor índice) para garantizar que el método termine.",
      );
    }
    seen.add(key);
  }
  return { status: "iteration_limit" };
}

function newTab(form: StdForm, cost: MNum[], sense: "max" | "min"): Tab {
  return {
    T: form.A.map((r) => r.slice()),
    rhs: form.b.slice(),
    basic: form.initialBasis.slice(),
    rowIds: form.A.map((_, i) => i),
    cost,
    active: form.colNames.map(() => true),
    sense,
  };
}

function adjustOps(tab: Tab, raw: MNum[]): string[] {
  const ops: string[] = [];
  tab.basic.forEach((bc, i) => {
    const f = raw[bc];
    if (!isZero(f)) ops.push(opText("R0", f, rowLabel(i)));
  });
  return ops;
}

/** Saca de la base las artificiales con valor 0 (pivote degenerado) o elimina la fila redundante. */
function driveOutArtificials(
  tab: Tab,
  form: StdForm,
): { ops: string[]; removedRows: number[] } {
  const ops: string[] = [];
  const removedRows: number[] = [];
  let i = 0;
  while (i < tab.basic.length) {
    const bc = tab.basic[i];
    if (form.kinds[bc] !== "artificial" || Math.abs(tab.rhs[i]) > FEAS_TOL) {
      i++;
      continue;
    }
    const enter = activeCols(tab).find(
      (j) => form.kinds[j] !== "artificial" && !tab.basic.includes(j) && Math.abs(tab.T[i][j]) > PIVOT_TOL,
    );
    if (enter != null) {
      ops.push(`Sale ${form.colNames[bc]} (vale 0) y entra ${form.colNames[enter]}: pivote degenerado.`);
      pivotOn(tab, i, enter, row0Of(tab));
      i++;
    } else {
      ops.push(`La restricción ${tab.rowIds[i] + 1} es redundante: se elimina su fila.`);
      removedRows.push(tab.rowIds[i]);
      tab.T.splice(i, 1);
      tab.rhs.splice(i, 1);
      tab.basic.splice(i, 1);
      tab.rowIds.splice(i, 1);
    }
  }
  return { ops, removedRows };
}

function positiveArtificials(tab: Tab, form: StdForm) {
  return tab.basic
    .map((bc, i) => ({ bc, i }))
    .filter(({ bc, i }) => form.kinds[bc] === "artificial" && tab.rhs[i] > FEAS_TOL)
    .map(({ bc, i }) => ({ name: form.colNames[bc], row: tab.rowIds[i], value: snap(tab.rhs[i]) }));
}

function phaseOneFeasible(form: StdForm): boolean {
  const cost = form.kinds.map((k) => (k === "artificial" ? mnum(1) : ZERO));
  const tab = newTab(form, cost, "min");
  const state: EngineState = { warnings: [], ties: { entering: 0, leaving: 0 }, cycling: false, pivots: 0 };
  const res = loop(tab, form, "phase1", "W", null, state, undefined, "");
  return res.status === "optimal" && positiveArtificials(tab, form).length === 0;
}

/**
 * Corre el simplex tabular. `costs` son los coeficientes del usuario (en su sentido) para las
 * variables de decisión; holguras y excesos valen 0.
 */
export function runSimplex(
  form: StdForm,
  costs: number[],
  sense: "max" | "min",
  method: "big_m" | "two_phase",
  record: boolean,
): EngineOutcome {
  const snaps: Snapshot[] | null = record ? [] : null;
  const state: EngineState = { warnings: [], ties: { entering: 0, leaving: 0 }, cycling: false, pivots: 0 };
  const hasArtificial = form.kinds.includes("artificial");
  const realCost = form.colNames.map((_, j) => mnum(j < form.nDecision ? costs[j] : 0));

  if (!hasArtificial || method === "big_m") {
    const bigM = sense === "max" ? -1 : 1;
    const cost = form.kinds.map((k, j) => (k === "artificial" ? mnum(0, bigM) : realCost[j]));
    const tab = newTab(form, cost, sense);
    const phase: Snapshot["phase"] = hasArtificial ? "bigm" : "simplex";
    let pending: string[] | undefined;
    if (hasArtificial && snaps) {
      const raw = rawRow0(tab);
      const zRaw: MNum = ZERO;
      snaps.push(
        snapshot(
          tab,
          form,
          {
            phase,
            kind: "adjust",
            title: "Tabla inicial con Gran M (fila Z sin ajustar)",
            objectiveLabel: "Z",
            note:
              sense === "max"
                ? "Cada artificial entra en Z con costo -M. Antes de iterar hay que dejar en 0 su coeficiente en la fila Z."
                : "Cada artificial entra en Z con costo +M. Antes de iterar hay que dejar en 0 su coeficiente en la fila Z.",
          },
          raw,
          zRaw,
        ),
      );
      pending = adjustOps(tab, raw);
    }
    const res = loop(tab, form, phase, "Z", snaps, state, pending, "");
    if (res.status === "iteration_limit") {
      return { status: "iteration_limit", tab, snapshots: snaps ?? [], warnings: state.warnings, ties: state.ties, cycling: state.cycling, pivots: state.pivots };
    }
    const pos = positiveArtificials(tab, form);
    if (res.status === "unbounded") {
      if (pos.length && !phaseOneFeasible(form)) {
        return { status: "infeasible", tab, snapshots: snaps ?? [], warnings: state.warnings, positiveArtificials: pos, ties: state.ties, cycling: state.cycling, pivots: state.pivots };
      }
      return { status: "unbounded", tab, snapshots: snaps ?? [], warnings: state.warnings, unboundedVar: res.unboundedVar, ties: state.ties, cycling: state.cycling, pivots: state.pivots };
    }
    if (pos.length) {
      if (snaps?.length) {
        const last = snaps[snaps.length - 1];
        last.kind = "infeasible";
        last.title = last.title.replace(/ — óptima$/, " — infactible");
        last.note = `Ninguna variable mejora Z, pero ${pos.map((p) => `${p.name} = ${fmtPlain(p.value)}`).join(", ")} sigue en la base: el problema original no tiene solución factible.`;
      }
      return { status: "infeasible", tab, snapshots: snaps ?? [], warnings: state.warnings, positiveArtificials: pos, ties: state.ties, cycling: state.cycling, pivots: state.pivots };
    }
    return { status: "optimal", tab, snapshots: snaps ?? [], warnings: state.warnings, ties: state.ties, cycling: state.cycling, pivots: state.pivots };
  }

  // Dos fases.
  const cost1 = form.kinds.map((k) => (k === "artificial" ? mnum(1) : ZERO));
  const tab = newTab(form, cost1, "min");
  let pending: string[] | undefined;
  if (snaps) {
    const raw = rawRow0(tab);
    snaps.push(
      snapshot(
        tab,
        form,
        {
          phase: "phase1",
          kind: "adjust",
          title: "Fase I — minimizar W = suma de artificiales (fila W sin ajustar)",
          objectiveLabel: "W",
          note: "La Fase I busca una solución factible: si el mínimo de W es 0, todas las artificiales salen y empieza la Fase II.",
        },
        raw,
        ZERO,
      ),
    );
    pending = adjustOps(tab, raw);
  }
  const r1 = loop(tab, form, "phase1", "W", snaps, state, pending, "Fase I — ");
  if (r1.status === "iteration_limit") {
    return { status: "iteration_limit", tab, snapshots: snaps ?? [], warnings: state.warnings, ties: state.ties, cycling: state.cycling, pivots: state.pivots };
  }
  const pos = positiveArtificials(tab, form);
  if (pos.length) {
    if (snaps?.length) {
      const last = snaps[snaps.length - 1];
      last.kind = "infeasible";
      last.title = last.title.replace(/ — óptima$/, " — W > 0: infactible");
      last.note = `El mínimo de W es ${fmtM(zOf(tab))} > 0: ${pos.map((p) => p.name).join(", ")} no puede salir de la base. El problema no tiene solución factible.`;
    }
    return { status: "infeasible", tab, snapshots: snaps ?? [], warnings: state.warnings, positiveArtificials: pos, ties: state.ties, cycling: state.cycling, pivots: state.pivots };
  }
  const driven = driveOutArtificials(tab, form);
  if (driven.removedRows.length) {
    state.warnings.push(
      `Restricciones redundantes: ${driven.removedRows.map((r) => r + 1).join(", ")}. Se eliminan al terminar la Fase I.`,
    );
  }
  form.kinds.forEach((k, j) => {
    if (k === "artificial") tab.active[j] = false;
  });
  tab.cost = realCost;
  tab.sense = sense;
  if (snaps) {
    const raw = rawRow0(tab);
    snaps.push(
      snapshot(
        tab,
        form,
        {
          phase: "phase2",
          kind: "phase_end",
          title: "Fase II — se quitan las artificiales y vuelve la función objetivo original (fila Z sin ajustar)",
          objectiveLabel: "Z",
          operations: driven.ops.length ? driven.ops : undefined,
          note: "W llegó a 0. Las variables básicas con costo distinto de 0 se eliminan de la fila Z antes de seguir.",
        },
        raw,
        ZERO,
      ),
    );
    pending = adjustOps(tab, raw);
  }
  const r2 = loop(tab, form, "phase2", "Z", snaps, state, pending, "Fase II — ");
  if (r2.status === "iteration_limit") {
    return { status: "iteration_limit", tab, snapshots: snaps ?? [], warnings: state.warnings, ties: state.ties, cycling: state.cycling, pivots: state.pivots };
  }
  if (r2.status === "unbounded") {
    return { status: "unbounded", tab, snapshots: snaps ?? [], warnings: state.warnings, unboundedVar: r2.unboundedVar, ties: state.ties, cycling: state.cycling, pivots: state.pivots };
  }
  return { status: "optimal", tab, snapshots: snaps ?? [], warnings: state.warnings, ties: state.ties, cycling: state.cycling, pivots: state.pivots };
}

/** Valores de todas las columnas en la solución básica actual. */
export function solutionOf(tab: Tab, nCols: number): number[] {
  const x = Array(nCols).fill(0);
  tab.basic.forEach((bc, i) => {
    x[bc] = snap(tab.rhs[i]);
  });
  return x;
}

/**
 * Busca una solución óptima alternativa: una no básica (no artificial) con zj - cj = 0.
 * Devuelve la nueva solución y la foto de la tabla, o la dirección si no hay fila que la limite.
 */
export function alternativeOptimum(
  outcome: EngineOutcome,
  form: StdForm,
): { columns: string[]; x: number[] | null; snapshot: Snapshot | null } | null {
  const tab = clone(outcome.tab);
  const row0 = row0Of(tab);
  const candidates = activeCols(tab).filter(
    (j) => form.kinds[j] !== "artificial" && !tab.basic.includes(j) && isZero(row0[j]),
  );
  if (!candidates.length) return null;
  for (const e of candidates) {
    const ratios = ratiosFor(tab, e);
    const leave = chooseLeaving(tab, ratios, false);
    if (leave.row == null) return { columns: [form.colNames[e]], x: null, snapshot: null };
    if ((ratios[leave.row] ?? 0) <= FEAS_TOL) continue; // pivote degenerado: misma solución
    const p = leave.row;
    const leaving = form.colNames[tab.basic[p]];
    const ops = pivotOn(tab, p, e, row0);
    const snapAlt = snapshot(tab, form, {
      phase: "simplex",
      kind: "alternative",
      title: `Solución óptima alternativa: entra ${form.colNames[e]} (zj - cj = 0), sale ${leaving}`,
      objectiveLabel: "Z",
      operations: ops,
      note: "Z no cambia porque el coeficiente de la variable que entra en la fila Z es 0. Cualquier punto del segmento entre ambas soluciones también es óptimo.",
    });
    return { columns: candidates.map((j) => form.colNames[j]), x: solutionOf(tab, form.colNames.length), snapshot: snapAlt };
  }
  return { columns: candidates.map((j) => form.colNames[j]), x: null, snapshot: null };
}

/**
 * Base final sin artificiales para el análisis de sensibilidad: saca las artificiales que
 * quedaron en 0 y quita filas redundantes.
 */
export function finalBasisWithoutArtificials(
  outcome: EngineOutcome,
  form: StdForm,
  costs: number[],
  sense: "max" | "min",
): { basic: number[]; rows: number[] } {
  const tab = clone(outcome.tab);
  driveOutArtificials(tab, form);
  form.kinds.forEach((k, j) => {
    if (k === "artificial") tab.active[j] = false;
  });
  tab.cost = form.colNames.map((_, j) => mnum(j < form.nDecision ? costs[j] : 0));
  tab.sense = sense;
  // Si al sacar una artificial (en 0) la base dejó de ser óptima, se reoptimiza: como la
  // solución ya es óptima, todos los pivotes son degenerados y los valores no cambian.
  const state: EngineState = { warnings: [], ties: { entering: 0, leaving: 0 }, cycling: false, pivots: 0 };
  loop(tab, form, "simplex", "Z", null, state, undefined, "");
  return { basic: tab.basic.slice(), rows: tab.rowIds.slice() };
}

export { fmtM };
