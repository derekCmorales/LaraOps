import { SolverError } from "../../errors";
import { LIMITS, assertLimit } from "../../limits";
import type { GraphMatrix, IterationStep, ModuleResult } from "../../schema";
import { okResult } from "../../schema";

const BIG_M = 1e9;
const ZERO = 1e-12;

export type AssignmentRequest = {
  agents: string[];
  tasks: string[];
  costs: number[][];
  sense: "min" | "max";
  forbidden_assignments: [string, string][];
};

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("payload debe ser un objeto JSON");
  }
  return body as Record<string, unknown>;
}

function stringList(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.length === 0) {
    throw new SolverError(`${name} debe ser una lista no vacía`);
  }
  return v.map((item, i) => {
    const s = String(item ?? "").trim();
    if (!s) throw new SolverError(`${name}[${i}] no puede estar vacío`);
    return s;
  });
}

function numMatrix(v: unknown, rows: number, cols: number): number[][] {
  if (!Array.isArray(v) || v.length !== rows) {
    throw new SolverError("costs matrix dimensions must match agents x tasks");
  }
  return v.map((row, i) => {
    if (!Array.isArray(row) || row.length !== cols) {
      throw new SolverError("costs matrix dimensions must match agents x tasks");
    }
    return row.map((cell, j) => {
      const n = Number(cell);
      if (!Number.isFinite(n)) throw new SolverError(`costo inválido en [${i}][${j}]`);
      return n;
    });
  });
}

export function parseAssignmentRequest(body: unknown): AssignmentRequest {
  const o = asRecord(body);
  const agents = stringList(o.agents, "agents");
  const tasks = stringList(o.tasks, "tasks");
  assertLimit(
    agents.length <= LIMITS.assignmentDim && tasks.length <= LIMITS.assignmentDim,
    `Asignación limitada a ${LIMITS.assignmentDim}×${LIMITS.assignmentDim} en el plan Free`,
  );
  const forbidden: [string, string][] = [];
  if (Array.isArray(o.forbidden_assignments)) {
    for (const pair of o.forbidden_assignments) {
      if (Array.isArray(pair) && pair.length >= 2) forbidden.push([String(pair[0]), String(pair[1])]);
    }
  }
  const sense = o.sense === "max" ? "max" : "min";
  return {
    agents,
    tasks,
    costs: numMatrix(o.costs, agents.length, tasks.length),
    sense,
    forbidden_assignments: forbidden,
  };
}

function cloneMat(m: number[][]): number[][] {
  return m.map((row) => row.slice());
}

/** Kuhn–Munkres (O(n³)) for square minimization. Returns row/col indices of the matching. */
export function linearSumAssignment(cost: number[][]): { rows: number[]; cols: number[] } {
  const n = cost.length;
  if (n === 0) return { rows: [], cols: [] };
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    const minv = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(n + 1).fill(false);
    let j0 = 0;
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const pairs: [number, number][] = [];
  for (let j = 1; j <= n; j++) pairs.push([p[j] - 1, j - 1]);
  pairs.sort((a, b) => a[0] - b[0]);
  return { rows: pairs.map((p0) => p0[0]), cols: pairs.map((p0) => p0[1]) };
}

/** Greedy line cover of zeros — didactic, matches the Python solver. */
function minLineCover(zeros: boolean[][]): { coverRows: number[]; coverCols: number[] } {
  const n = zeros.length;
  const uncovered = zeros.map((row) => row.slice());
  const coverRows: number[] = [];
  const coverCols: number[] = [];
  const hasUncovered = () => uncovered.some((row) => row.some(Boolean));
  while (hasUncovered()) {
    const rowCounts = uncovered.map((row) => row.reduce((a, z) => a + (z ? 1 : 0), 0));
    const colCounts = Array.from({ length: n }, (_, j) => uncovered.reduce((a, row) => a + (row[j] ? 1 : 0), 0));
    const rowMax = Math.max(...rowCounts);
    const colMax = Math.max(...colCounts);
    if (rowMax >= colMax) {
      const i = rowCounts.indexOf(rowMax);
      coverRows.push(i);
      for (let j = 0; j < n; j++) uncovered[i][j] = false;
    } else {
      const j = colCounts.indexOf(colMax);
      coverCols.push(j);
      for (let i = 0; i < n; i++) uncovered[i][j] = false;
    }
    if (coverRows.length + coverCols.length >= n) break;
  }
  return { coverRows, coverCols };
}

function zerosOf(mat: number[][]): boolean[][] {
  return mat.map((row) => row.map((v) => v < ZERO));
}

export function solve(body: unknown): ModuleResult {
  const req = parseAssignmentRequest(body);
  const nAgents = req.agents.length;
  const nTasks = req.tasks.length;
  const warnings: string[] = [];

  const cost = cloneMat(req.costs);
  const agentIdx = new Map(req.agents.map((a, i) => [a, i]));
  const taskIdx = new Map(req.tasks.map((t, j) => [t, j]));
  for (const [a, t] of req.forbidden_assignments) {
    if (!agentIdx.has(a) || !taskIdx.has(t)) {
      throw new SolverError(`forbidden assignment unknown: ${a}->${t}`);
    }
    cost[agentIdx.get(a)!][taskIdx.get(t)!] = BIG_M;
    warnings.push(`Asignación prohibida ${a}->${t}`);
  }

  const n = Math.max(nAgents, nTasks);
  const agents = req.agents.concat(Array.from({ length: n - nAgents }, (_, k) => `_dummy_agent_${k}`));
  const tasks = req.tasks.concat(Array.from({ length: n - nTasks }, (_, k) => `_dummy_task_${k}`));
  if (n !== nAgents || n !== nTasks) {
    warnings.push(`Matriz no cuadrada: relleno a ${n}×${n} con ficticios de costo 0`);
  }
  const padded = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < nAgents; i++) {
    for (let j = 0; j < nTasks; j++) padded[i][j] = cost[i][j];
  }
  const costOrig = cloneMat(padded);

  let work = cloneMat(padded);
  if (req.sense === "max") {
    const finite = work.flat().filter((v) => v < BIG_M / 2);
    const mx = finite.length ? Math.max(...finite) : 0;
    work = work.map((row) => row.map((v) => (v < BIG_M / 2 ? mx - v : v)));
  }

  const iterations: IterationStep[] = [];
  const rowMin = work.map((row) => Math.min(...row));
  let reduced = work.map((row, i) => row.map((v) => v - rowMin[i]));
  iterations.push({
    index: 0,
    method: "hungarian",
    title: "Reducción por filas",
    tableau: cloneMat(reduced),
    meta: { row_min: rowMin },
  });
  const colMin = Array.from({ length: n }, (_, j) => Math.min(...reduced.map((row) => row[j])));
  reduced = reduced.map((row) => row.map((v, j) => v - colMin[j]));
  iterations.push({
    index: 1,
    method: "hungarian",
    title: "Reducción por columnas",
    tableau: cloneMat(reduced),
    meta: { col_min: colMin },
  });

  let mat = cloneMat(reduced);
  let step = 2;
  for (let _ = 0; _ < n * 2; _++) {
    const { coverRows, coverCols } = minLineCover(zerosOf(mat));
    const coverRowSet = new Set(coverRows);
    const coverColSet = new Set(coverCols);
    iterations.push({
      index: step,
      method: "hungarian",
      title: `Cobertura de ceros (${coverRows.length} filas + ${coverCols.length} columnas)`,
      tableau: cloneMat(mat),
      meta: { cover_rows: coverRows, cover_cols: coverCols },
    });
    step += 1;
    if (coverRows.length + coverCols.length >= n) break;
    const uncovered: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (!coverRowSet.has(i) && !coverColSet.has(j)) uncovered.push(mat[i][j]);
      }
    }
    if (!uncovered.length) break;
    const delta = Math.min(...uncovered);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (!coverRowSet.has(i) && !coverColSet.has(j)) mat[i][j] -= delta;
        else if (coverRowSet.has(i) && coverColSet.has(j)) mat[i][j] += delta;
      }
    }
    iterations.push({
      index: step,
      method: "hungarian",
      title: `Ajuste de celdas no cubiertas en ${delta}`,
      tableau: cloneMat(mat),
      meta: { delta },
    });
    step += 1;
  }

  const { rows, cols } = linearSumAssignment(work);
  iterations.push({
    index: step,
    method: "hungarian",
    title: "Asignación óptima",
    tableau: null,
    meta: { rows, cols },
  });

  const variables: Record<string, number> = {};
  let total = 0;
  const pairs: (string | number)[][] = [];
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    const c = cols[k];
    if (agents[r].startsWith("_dummy") || tasks[c].startsWith("_dummy")) continue;
    if (costOrig[r][c] >= BIG_M / 2) {
      warnings.push(`Asignación ${agents[r]}->${tasks[c]} usa ruta de costo M (revisar factibilidad)`);
    }
    const key = `${agents[r]}->${tasks[c]}`;
    variables[key] = 1;
    total += costOrig[r][c];
    pairs.push([agents[r], tasks[c], costOrig[r][c]]);
  }

  const graph: GraphMatrix = {
    type: "matrix",
    row_labels: req.agents,
    col_labels: req.tasks,
    values: req.agents.map((a) => req.tasks.map((t) => (variables[`${a}->${t}`] ? 1 : 0))),
    title: "Matriz de asignación óptima",
    subtitle: "1 = pareja asignada · 0 = sin asignación",
    value_label: "Asignado",
  };

  return okResult("assignment", {
    status: "optimal",
    variables,
    objective_value: total,
    objective_sense: req.sense,
    metrics: { total, n_assignments: pairs.length },
    iterations,
    graph,
    tables: [{ name: "assignment", columns: ["agente", "tarea", "costo"], rows: pairs }],
    warnings,
  });
}
