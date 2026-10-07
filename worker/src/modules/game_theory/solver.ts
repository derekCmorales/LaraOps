import { SolverError } from "../../errors";
import type { GraphXY, IterationStep, ModuleResult, NamedTable } from "../../schema";
import { okResult } from "../../schema";
import { solve as solveLp } from "../lp/solver";

/** Estrategias por jugador. El plan del módulo no pasa de una matriz 12×12. */
const MAX_STRATEGIES = 12;
const TOL = 1e-9;
const SUPPORT = 1e-8;

export type GameRequest = {
  row_strategies: string[];
  col_strategies: string[];
  payoff: number[][];
};

type Mix = { x: number[]; y: number[]; value: number };

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("Los datos del juego deben ser un objeto JSON.");
  }
  return body as Record<string, unknown>;
}

function strategyNames(value: unknown, kind: "fila" | "columna"): string[] {
  const who = kind === "fila" ? "fila" : "columna";
  if (!Array.isArray(value) || value.length === 0) {
    throw new SolverError(`Agrega al menos una estrategia de ${who}.`);
  }
  if (value.length > MAX_STRATEGIES) {
    throw new SolverError(
      `Hay ${value.length} estrategias de ${who} y el máximo es ${MAX_STRATEGIES}.`,
    );
  }
  const seen = new Set<string>();
  return value.map((item, i) => {
    const name = String(item ?? "").trim();
    if (!name) throw new SolverError(`Falta el nombre de la estrategia de ${who} ${i + 1}.`);
    if (seen.has(name)) {
      throw new SolverError(`«${name}» está repetido en las estrategias de ${who}. Usa nombres distintos.`);
    }
    seen.add(name);
    return name;
  });
}

function cellNumber(cell: unknown, row: string, col: string): number {
  if (typeof cell === "number" && Number.isFinite(cell)) return cell;
  if (typeof cell === "string") {
    const t = cell.trim().replace(",", ".");
    if (t && Number.isFinite(Number(t))) return Number(t);
  }
  throw new SolverError(`El pago de «${row}» contra «${col}» no es un número.`);
}

function payoffMatrix(value: unknown, rows: string[], cols: string[]): number[][] {
  if (!Array.isArray(value) || value.length !== rows.length) {
    throw new SolverError(
      `La matriz de pagos no es rectangular: debe tener ${rows.length} filas y ${cols.length} columnas.`,
    );
  }
  return value.map((row, i) => {
    if (!Array.isArray(row) || row.length !== cols.length) {
      const got = Array.isArray(row) ? row.length : 0;
      throw new SolverError(
        `La matriz de pagos no es rectangular: la fila «${rows[i]}» tiene ${got} pagos y hay ${cols.length} estrategias de columna.`,
      );
    }
    return row.map((cell, j) => cellNumber(cell, rows[i], cols[j]));
  });
}

export function parseGameRequest(body: unknown): GameRequest {
  const o = asRecord(body);
  const row_strategies = strategyNames(o.row_strategies, "fila");
  const col_strategies = strategyNames(o.col_strategies, "columna");
  return {
    row_strategies,
    col_strategies,
    payoff: payoffMatrix(o.payoff, row_strategies, col_strategies),
  };
}

function snap(x: number): number {
  if (!Number.isFinite(x)) return x;
  if (Math.abs(x) < 1e-12) return 0;
  const r = Math.round(x);
  if (Math.abs(x - r) < 1e-9 * Math.max(1, Math.abs(x))) return r;
  return Number(x.toPrecision(12));
}

function rowMinsOf(A: number[][]): number[] {
  return A.map((row) => row.reduce((m, v) => (v < m ? v : m), Number.POSITIVE_INFINITY));
}

function colMaxsOf(A: number[][]): number[] {
  const n = A[0]?.length ?? 0;
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    let m = Number.NEGATIVE_INFINITY;
    for (const row of A) if (row[j] > m) m = row[j];
    out.push(m);
  }
  return out;
}

/**
 * Elimina una estrategia estrictamente dominada por ronda: primero filas, luego columnas.
 * Fila i dominada por k si A[k] gana o empata en todas las columnas vivas y gana en alguna.
 * Columna j dominada por c si A[·,c] es menor o igual en todas las filas vivas y menor en alguna.
 */
function eliminateDominated(
  A: number[][],
  rowNames: string[],
  colNames: string[],
): { rows: number[]; cols: number[]; iterations: IterationStep[] } {
  let rows = A.map((_, i) => i);
  let cols = (A[0] ?? []).map((_, j) => j);
  const iterations: IterationStep[] = [];
  let step = 0;
  let changed = true;
  while (changed && rows.length > 1 && cols.length > 1) {
    changed = false;
    const rowHit = dominatedRow(A, rows, cols);
    if (rowHit) {
      step += 1;
      iterations.push({
        index: step,
        method: "dominance",
        title: `Fila '${rowNames[rowHit.loser]}' eliminada (dominada por '${rowNames[rowHit.by]}')`,
        tableau: null,
        meta: { eliminated: "row", strategy: rowNames[rowHit.loser], dominated_by: rowNames[rowHit.by] },
      });
      rows = rows.filter((i) => i !== rowHit.loser);
      changed = true;
      continue;
    }
    const colHit = dominatedCol(A, rows, cols);
    if (colHit) {
      step += 1;
      iterations.push({
        index: step,
        method: "dominance",
        title: `Columna '${colNames[colHit.loser]}' eliminada (dominada por '${colNames[colHit.by]}')`,
        tableau: null,
        meta: { eliminated: "col", strategy: colNames[colHit.loser], dominated_by: colNames[colHit.by] },
      });
      cols = cols.filter((j) => j !== colHit.loser);
      changed = true;
    }
  }
  return { rows, cols, iterations };
}

function dominatedRow(
  A: number[][],
  rows: number[],
  cols: number[],
): { loser: number; by: number } | null {
  for (const i of rows) {
    for (const k of rows) {
      if (i === k) continue;
      let better = false;
      let ok = true;
      for (const j of cols) {
        if (A[k][j] < A[i][j] - TOL) {
          ok = false;
          break;
        }
        if (A[k][j] > A[i][j] + TOL) better = true;
      }
      if (ok && better) return { loser: i, by: k };
    }
  }
  return null;
}

function dominatedCol(
  A: number[][],
  rows: number[],
  cols: number[],
): { loser: number; by: number } | null {
  for (const j of cols) {
    for (const c of cols) {
      if (j === c) continue;
      let better = false;
      let ok = true;
      for (const i of rows) {
        if (A[i][c] > A[i][j] + TOL) {
          ok = false;
          break;
        }
        if (A[i][c] < A[i][j] - TOL) better = true;
      }
      if (ok && better) return { loser: j, by: c };
    }
  }
  return null;
}

function solve2x2(A: number[][]): Mix | null {
  const a = A[0][0];
  const b = A[0][1];
  const c = A[1][0];
  const d = A[1][1];
  const denom = a - b - c + d;
  if (Math.abs(denom) < 1e-12) return null;
  const p = Math.min(1, Math.max(0, (d - c) / denom));
  const q = Math.min(1, Math.max(0, (d - b) / denom));
  return { x: [p, 1 - p], y: [q, 1 - q], value: (a * d - b * c) / denom };
}

/** K = 1 − min(0, min A), de modo que A+K tiene entradas ≥ 1 y el valor auxiliar es ≥ 0. */
function shiftK(A: number[][]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const row of A) for (const v of row) if (v < min) min = v;
  return 1 - Math.min(0, min);
}

function valueName(taken: string[]): string {
  if (!taken.includes("v")) return "v";
  let k = 2;
  while (taken.includes(`v${k}`)) k += 1;
  return `v${k}`;
}

type LpConstraint = { id: string; coeffs: Record<string, number>; sense: "<=" | ">=" | "="; rhs: number };

function runLp(body: {
  sense: "min" | "max";
  objective: Record<string, number>;
  constraints: LpConstraint[];
  variable_names: string[];
}): ModuleResult | null {
  try {
    const result = solveLp({
      ...body,
      include_iterations: false,
      include_sensitivity: false,
      include_graph: false,
      include_dual: false,
      include_basic_solutions: false,
      method: "two_phase",
    });
    if (result.status !== "optimal" || result.solution.objective_value == null) return null;
    return result;
  } catch (err) {
    if (err instanceof SolverError) return null;
    throw err;
  }
}

function readProbs(result: ModuleResult, names: string[]): number[] {
  return names.map((name) => result.solution.variables[name] ?? 0);
}

/** Programa directo: max/min v con la matriz desplazada, suma de probabilidades = 1 y variables ≥ 0. */
function solveDirect(A: number[][], rowNames: string[], colNames: string[], K: number): Mix | null {
  const m = A.length;
  const n = colNames.length;
  const Ap = A.map((row) => row.map((v) => v + K));
  const vRow = valueName(rowNames);
  const rowConstraints: LpConstraint[] = Ap[0].map((_, j) => ({
    id: `col_${j + 1}`,
    coeffs: {
      ...Object.fromEntries(rowNames.map((name, i) => [name, Ap[i][j]])),
      [vRow]: -1,
    },
    sense: ">=",
    rhs: 0,
  }));
  rowConstraints.push({
    id: "suma_x",
    coeffs: Object.fromEntries(rowNames.map((name) => [name, 1])),
    sense: "=",
    rhs: 1,
  });
  const rowRes = runLp({
    sense: "max",
    objective: { [vRow]: 1 },
    constraints: rowConstraints,
    variable_names: [...rowNames, vRow],
  });
  if (!rowRes || rowRes.solution.objective_value == null) return null;

  const vCol = valueName(colNames);
  const colConstraints: LpConstraint[] = Ap.map((row, i) => ({
    id: `fila_${i + 1}`,
    coeffs: {
      ...Object.fromEntries(colNames.map((name, j) => [name, row[j]])),
      [vCol]: -1,
    },
    sense: "<=",
    rhs: 0,
  }));
  colConstraints.push({
    id: "suma_y",
    coeffs: Object.fromEntries(colNames.map((name) => [name, 1])),
    sense: "=",
    rhs: 1,
  });
  const colRes = runLp({
    sense: "min",
    objective: { [vCol]: 1 },
    constraints: colConstraints,
    variable_names: [...colNames, vCol],
  });
  if (!colRes || colRes.solution.objective_value == null) return null;

  const valueRow = rowRes.solution.objective_value - K;
  const valueCol = colRes.solution.objective_value - K;
  if (Math.abs(valueRow - valueCol) > 1e-3) return null;
  return {
    x: readProbs(rowRes, rowNames),
    y: readProbs(colRes, colNames),
    value: (valueRow + valueCol) / 2,
  };
}

/**
 * Forma equivalente con v' > 0: X = x / v', se minimiza la suma de X sujeta a A'X ≥ 1.
 * El jugador columna maximiza la suma de Y sujeta a A'Y ≤ 1. Sirve si el programa con v no cierra.
 */
function solveScaled(A: number[][], rowNames: string[], colNames: string[], K: number): Mix | null {
  const Ap = A.map((row) => row.map((v) => v + K));
  const rowRes = runLp({
    sense: "min",
    objective: Object.fromEntries(rowNames.map((name) => [name, 1])),
    constraints: Ap[0].map((_, j) => ({
      id: `col_${j + 1}`,
      coeffs: Object.fromEntries(rowNames.map((name, i) => [name, Ap[i][j]])),
      sense: ">=",
      rhs: 1,
    })),
    variable_names: rowNames,
  });
  const colRes = runLp({
    sense: "max",
    objective: Object.fromEntries(colNames.map((name) => [name, 1])),
    constraints: Ap.map((row, i) => ({
      id: `fila_${i + 1}`,
      coeffs: Object.fromEntries(colNames.map((name, j) => [name, row[j]])),
      sense: "<=",
      rhs: 1,
    })),
    variable_names: colNames,
  });
  if (!rowRes?.solution.objective_value || !colRes?.solution.objective_value) return null;
  const sumX = rowRes.solution.objective_value;
  const sumY = colRes.solution.objective_value;
  if (!(sumX > 1e-9) || !(sumY > 1e-9)) return null;
  const valueRow = 1 / sumX - K;
  const valueCol = 1 / sumY - K;
  if (Math.abs(valueRow - valueCol) > 1e-3) return null;
  return {
    x: readProbs(rowRes, rowNames).map((v) => v / sumX),
    y: readProbs(colRes, colNames).map((v) => v / sumY),
    value: (valueRow + valueCol) / 2,
  };
}

function normalizeProbs(raw: number[]): number[] {
  const clipped = raw.map((v) => (v < 1e-10 ? 0 : v));
  if (clipped.some((v) => v < -1e-6)) {
    throw new SolverError("Las probabilidades del equilibrio quedaron negativas. Revisa la matriz de pagos.");
  }
  const sum = clipped.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || Math.abs(sum - 1) > 1e-3) {
    throw new SolverError("Las probabilidades del equilibrio no suman 1. Revisa la matriz de pagos.");
  }
  const norm = clipped.map((v) => v / sum);
  const tidy = norm.map((v) => Math.max(0, snap(v)));
  const tidySum = tidy.reduce((a, b) => a + b, 0);
  const out = Math.abs(tidySum - 1) < 1e-12 ? tidy : tidy.map((v) => v / tidySum);
  const check = out.reduce((a, b) => a + b, 0);
  if (Math.abs(check - 1) > 1e-6) {
    throw new SolverError("Las probabilidades del equilibrio no suman 1.");
  }
  return out;
}

function payAgainstColumn(A: number[][], x: number[], j: number): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * A[i][j];
  return s;
}

function payAgainstRow(A: number[][], y: number[], i: number): number {
  let s = 0;
  for (let j = 0; j < y.length; j++) s += A[i][j] * y[j];
  return s;
}

function isEquilibrium(A: number[][], x: number[], y: number[], value: number, tol: number): boolean {
  if (x.length !== A.length || y.length !== (A[0]?.length ?? 0)) return false;
  for (let j = 0; j < y.length; j++) {
    const pay = payAgainstColumn(A, x, j);
    if (pay < value - tol) return false;
    if (y[j] > 1e-6 && Math.abs(pay - value) > tol) return false;
  }
  for (let i = 0; i < x.length; i++) {
    const pay = payAgainstRow(A, y, i);
    if (pay > value + tol) return false;
    if (x[i] > 1e-6 && Math.abs(pay - value) > tol) return false;
  }
  return true;
}

function finishMix(A: number[][], raw: Mix): Mix {
  const x = normalizeProbs(raw.x);
  const y = normalizeProbs(raw.y);
  const value = snap(raw.value);
  if (!isEquilibrium(A, x, y, value, 1e-4)) {
    throw new SolverError(
      "El equilibrio mixto no iguala el valor del juego en las estrategias del soporte. Revisa la matriz de pagos.",
    );
  }
  return { x, y, value };
}

function solveMixed(A: number[][], rowNames: string[], colNames: string[]): Mix {
  const m = A.length;
  const n = A[0].length;
  if (m === 1 && n === 1) return { x: [1], y: [1], value: A[0][0] };
  if (m === 1) {
    let best = 0;
    for (let j = 1; j < n; j++) if (A[0][j] < A[0][best]) best = j;
    const y = Array(n).fill(0);
    y[best] = 1;
    return { x: [1], y, value: A[0][best] };
  }
  if (n === 1) {
    let best = 0;
    for (let i = 1; i < m; i++) if (A[i][0] > A[best][0]) best = i;
    const x = Array(m).fill(0);
    x[best] = 1;
    return { x, y: [1], value: A[best][0] };
  }
  if (m === 2 && n === 2) {
    const closed = solve2x2(A);
    if (closed) return finishMix(A, closed);
  }
  const K = shiftK(A);
  const direct = solveDirect(A, rowNames, colNames, K);
  if (direct) {
    try {
      return finishMix(A, direct);
    } catch {
      /* el programa con v no cerró el equilibrio; se intenta la forma escalada */
    }
  }
  const scaled = solveScaled(A, rowNames, colNames, K);
  if (!scaled) {
    throw new SolverError("No se pudo calcular el equilibrio en estrategias mixtas.");
  }
  return finishMix(A, scaled);
}

function fmtCoef(n: number): string {
  const x = snap(Math.abs(n));
  if (Number.isInteger(x)) return String(x);
  return x.toLocaleString("es-MX", { useGrouping: false, maximumFractionDigits: 6 });
}

function linearExpr(names: string[], coefs: number[]): string {
  const parts: string[] = [];
  names.forEach((name, i) => {
    const c = coefs[i];
    if (!Number.isFinite(c) || Math.abs(c) < 1e-12) return;
    const body = Math.abs(Math.abs(c) - 1) < 1e-12 ? name : `${fmtCoef(c)}·${name}`;
    if (!parts.length) parts.push(c < 0 ? `-${body}` : body);
    else parts.push(c < 0 ? `- ${body}` : `+ ${body}`);
  });
  return parts.join(" ") || "0";
}

function formulationTable(A: number[][], rowNames: string[], colNames: string[], K: number): NamedTable {
  const rows: unknown[][] = [["fila", "max v"]];
  colNames.forEach((col, j) => {
    const coefs = A.map((row) => row[j]);
    rows.push(["fila", `${linearExpr(rowNames, coefs)} >= v    (contra ${col})`]);
  });
  rows.push(["fila", `${rowNames.join(" + ")} = 1`]);
  rows.push(["fila", `${rowNames.join(", ")} >= 0`]);
  rows.push(["columna", "min v"]);
  rowNames.forEach((row, i) => {
    rows.push(["columna", `${linearExpr(colNames, A[i])} <= v    (contra ${row})`]);
  });
  rows.push(["columna", `${colNames.join(" + ")} = 1`]);
  rows.push(["columna", `${colNames.join(", ")} >= 0`]);
  if (K !== 0) {
    const kText = Number.isInteger(K) ? String(K) : K.toLocaleString("es-MX", { maximumFractionDigits: 6 });
    rows.push([
      "nota",
      `Desplazamiento: K = ${kText}. Los pagos se aumentan en K para que todos queden ≥ 1 y el valor auxiliar v' sea ≥ 0. El valor del juego es v = v' - K.`,
    ]);
  }
  return { name: "formulacion_lp", columns: ["jugador", "linea"], rows };
}

function securityWeights(levels: number[], target: number): number[] {
  const idx = levels
    .map((v, i) => (Math.abs(v - target) < TOL ? i : -1))
    .filter((i) => i >= 0);
  const w = levels.map(() => 0);
  if (!idx.length) {
    if (w.length) w[0] = 1;
    return w;
  }
  for (const i of idx) w[i] = 1 / idx.length;
  return w;
}

function expectedTable(
  A: number[][],
  rowNames: string[],
  colNames: string[],
  x: number[],
  y: number[],
): NamedTable {
  const rows: unknown[][] = [];
  colNames.forEach((col, j) => {
    rows.push(["fila", col, snap(payAgainstColumn(A, x, j)), y[j] > SUPPORT ? "sí" : "no"]);
  });
  rowNames.forEach((row, i) => {
    rows.push(["columna", row, snap(payAgainstRow(A, y, i)), x[i] > SUPPORT ? "sí" : "no"]);
  });
  return {
    name: "pago_esperado",
    columns: ["jugador", "estrategia_rival", "pago_esperado", "en_soporte"],
    rows,
  };
}

/** Abscisas del método gráfico: una malla fina más los cruces entre rectas. */
function graphXs(lines: { a: number; b: number }[], extra: number): number[] {
  const xs = new Set<number>();
  for (let i = 0; i <= 40; i++) xs.add(i / 40);
  for (let i = 0; i < lines.length; i++) {
    for (let k = i + 1; k < lines.length; k++) {
      const den = lines[i].b - lines[i].a - (lines[k].b - lines[k].a);
      if (Math.abs(den) < 1e-12) continue;
      const t = (lines[k].a - lines[i].a) / den;
      if (t > 0 && t < 1) xs.add(snap(t));
    }
  }
  if (extra >= 0 && extra <= 1) xs.add(snap(extra));
  return [...xs].sort((a, b) => a - b);
}

/**
 * Método gráfico de un juego 2×n o m×2. Cada recta es el pago esperado contra una estrategia
 * pura del rival; la envolvente es lo que el jugador se garantiza y su pico (o valle) es el valor.
 */
function graph2xn(
  reduced: number[][],
  rowIdx: number[],
  colIdx: number[],
  rowNames: string[],
  colNames: string[],
  mix: Mix,
): GraphXY | null {
  const rowsGraph = reduced.length === 2;
  if (!rowsGraph && (reduced[0]?.length ?? 0) !== 2) return null;
  // Recta k: pago = a + (b − a)·t, con t = P(primera estrategia del jugador del eje).
  const lines = rowsGraph
    ? colIdx.map((col, j) => ({ name: colNames[col], a: reduced[1][j], b: reduced[0][j] }))
    : rowIdx.map((row, i) => ({ name: rowNames[row], a: reduced[i][1], b: reduced[i][0] }));
  const tStar = rowsGraph ? mix.x[0] : mix.y[0];
  const xs = graphXs(lines, tStar);
  const at = (line: { a: number; b: number }, t: number) => snap(line.a + (line.b - line.a) * t);
  const series: Record<string, unknown>[] = lines.map((line) => ({
    name: line.name,
    x: [0, 1],
    y: [line.a, line.b],
  }));
  series.push({
    name: rowsGraph ? "Envolvente inferior (lo que la fila se garantiza)" : "Envolvente superior (lo más que paga la columna)",
    x: xs,
    y: xs.map((t) => {
      const values = lines.map((line) => at(line, t));
      return rowsGraph ? Math.min(...values) : Math.max(...values);
    }),
  });
  series.push({ name: "Óptimo", x: [snap(tStar)], y: [snap(mix.value)] });
  return {
    type: "xy",
    series,
    x_label: rowsGraph ? `P(${rowNames[rowIdx[0]]})` : `P(${colNames[colIdx[0]]})`,
    y_label: "Pago esperado",
    title: rowsGraph
      ? "Método gráfico: pago esperado contra cada estrategia de columna"
      : "Método gráfico: pago esperado contra cada estrategia de fila",
    subtitle: rowsGraph
      ? "La fila elige la probabilidad donde la envolvente inferior es más alta (maximin)."
      : "La columna elige la probabilidad donde la envolvente superior es más baja (minimax).",
  };
}

export function solve(body: unknown): ModuleResult {
  const req = parseGameRequest(body);
  const A = req.payoff;
  const rowNames = req.row_strategies;
  const colNames = req.col_strategies;
  const m = rowNames.length;
  const n = colNames.length;

  const { rows, cols, iterations } = eliminateDominated(A, rowNames, colNames);
  const reduced = rows.map((i) => cols.map((j) => A[i][j]));
  const rowMin = rowMinsOf(A);
  const colMax = colMaxsOf(A);
  const maximin = rowMin.reduce((best, v) => (v > best ? v : best), Number.NEGATIVE_INFINITY);
  const minimax = colMax.reduce((best, v) => (v < best ? v : best), Number.POSITIVE_INFINITY);

  const metrics: Record<string, number> = { maximin: snap(maximin), minimax: snap(minimax) };
  const variables: Record<string, number> = {};
  const warnings: string[] = [];
  const pureRows: unknown[][] = [];
  const mixedRows: unknown[][] = [];
  let xFull = Array(m).fill(0);
  let yFull = Array(n).fill(0);
  let graph: GraphXY | null = null;

  if (Math.abs(maximin - minimax) < TOL) {
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        if (
          Math.abs(A[i][j] - maximin) < TOL &&
          Math.abs(rowMin[i] - maximin) < TOL &&
          Math.abs(colMax[j] - minimax) < TOL
        ) {
          variables[`pure:${rowNames[i]}->${colNames[j]}`] = 1;
          metrics.game_value = snap(A[i][j]);
          pureRows.push([rowNames[i], colNames[j], snap(A[i][j])]);
        }
      }
    }
    if (metrics.game_value == null) metrics.game_value = snap(maximin);
    xFull = securityWeights(rowMin, maximin);
    yFull = securityWeights(colMax, minimax);
  } else {
    warnings.push(
      "No hay punto de silla en estrategias puras; se calcula el equilibrio en estrategias mixtas.",
    );
    const mix = solveMixed(
      reduced,
      rows.map((i) => rowNames[i]),
      cols.map((j) => colNames[j]),
    );
    metrics.game_value = mix.value;
    rows.forEach((idx, i) => {
      xFull[idx] = mix.x[i];
      variables[`p:${rowNames[idx]}`] = mix.x[i];
      mixedRows.push([rowNames[idx], mix.x[i]]);
    });
    cols.forEach((idx, j) => {
      yFull[idx] = mix.y[j];
      variables[`q:${colNames[idx]}`] = mix.y[j];
      mixedRows.push([colNames[idx], mix.y[j]]);
    });
    if (reduced.length === 2 || (reduced[0]?.length ?? 0) === 2) {
      graph = graph2xn(reduced, rows, cols, rowNames, colNames, mix);
    }
  }

  const tables: NamedTable[] = [
    {
      name: "matriz_pagos",
      columns: ["fila", ...colNames],
      rows: rowNames.map((name, i) => [name, ...A[i]]),
    },
    {
      name: "minimos_fila",
      columns: ["estrategia", "minimo", "es_maximin"],
      rows: rowNames.map((name, i) => [name, snap(rowMin[i]), Math.abs(rowMin[i] - maximin) < TOL ? "sí" : "no"]),
    },
    {
      name: "maximos_columna",
      columns: ["estrategia", "maximo", "es_minimax"],
      rows: colNames.map((name, j) => [name, snap(colMax[j]), Math.abs(colMax[j] - minimax) < TOL ? "sí" : "no"]),
    },
  ];
  if (rows.length < m || cols.length < n) {
    tables.push({
      name: "reduced_payoff",
      columns: ["fila", ...cols.map((j) => colNames[j])],
      rows: rows.map((i) => [rowNames[i], ...cols.map((j) => A[i][j])]),
    });
  }
  if (pureRows.length) {
    tables.push({ name: "punto_silla_puro", columns: ["fila", "columna", "valor"], rows: pureRows });
  }
  if (mixedRows.length) {
    tables.push({ name: "estrategia_mixta", columns: ["estrategia", "probabilidad"], rows: mixedRows });
  }
  tables.push(expectedTable(A, rowNames, colNames, xFull, yFull));
  tables.push(formulationTable(A, rowNames, colNames, shiftK(A)));

  return okResult("game_theory", {
    status: "ok",
    variables,
    metrics,
    objective_value: metrics.game_value,
    objective_sense: "max",
    iterations: iterations.length ? iterations : null,
    graph,
    tables,
    warnings,
  });
}
