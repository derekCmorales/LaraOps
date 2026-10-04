import { SolverError } from "../../errors";
import { LIMITS, assertLimit } from "../../limits";
import type { GraphMatrix, IterationStep, ModuleResult, NamedTable } from "../../schema";
import { okResult } from "../../schema";

/** Costo de una celda prohibida. Se muestra como "M" en las tablas. */
const BIG_M = 1e9;

export type AssignmentRequest = {
  agents: string[];
  tasks: string[];
  costs: number[][];
  sense: "min" | "max";
  forbidden_assignments: [string, string][];
};

type Pair = [number, number];

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("Los datos deben ser un objeto JSON.");
  }
  return body as Record<string, unknown>;
}

function nameList(v: unknown, kind: "agent" | "task"): string[] {
  const one = kind === "agent" ? "un agente" : "una tarea";
  const of = kind === "agent" ? "del agente" : "de la tarea";
  const group = kind === "agent" ? "los agentes" : "las tareas";
  if (!Array.isArray(v) || v.length === 0) throw new SolverError(`Agrega al menos ${one}.`);
  const seen = new Set<string>();
  return v.map((item, i) => {
    const s = String(item ?? "").trim();
    if (!s) throw new SolverError(`Falta el nombre ${of} ${i + 1}.`);
    if (seen.has(s)) throw new SolverError(`«${s}» está repetido en ${group}. Usa nombres distintos.`);
    seen.add(s);
    return s;
  });
}

function numMatrix(v: unknown, agents: string[], tasks: string[]): number[][] {
  const rows = agents.length;
  const cols = tasks.length;
  if (!Array.isArray(v) || v.length !== rows) {
    throw new SolverError(`La matriz de costos debe tener ${rows} filas (una por agente) y ${cols} columnas (una por tarea).`);
  }
  return v.map((row, i) => {
    if (!Array.isArray(row) || row.length !== cols) {
      throw new SolverError(`La fila de «${agents[i]}» debe tener ${cols} valores, uno por tarea.`);
    }
    return row.map((cell, j) => {
      const n = cell === null || cell === "" ? NaN : Number(cell);
      if (!Number.isFinite(n)) {
        throw new SolverError(`El valor de «${agents[i]}» en «${tasks[j]}» no es un número.`);
      }
      if (Math.abs(n) >= BIG_M / 1000) {
        throw new SolverError(`El valor de «${agents[i]}» en «${tasks[j]}» es demasiado grande. Usa una celda prohibida en lugar de un costo enorme.`);
      }
      return n;
    });
  });
}

export function parseAssignmentRequest(body: unknown): AssignmentRequest {
  const o = asRecord(body);
  const agents = nameList(o.agents, "agent");
  const tasks = nameList(o.tasks, "task");
  assertLimit(
    agents.length <= LIMITS.assignmentDim && tasks.length <= LIMITS.assignmentDim,
    `Asignación limitada a ${LIMITS.assignmentDim}×${LIMITS.assignmentDim} en el plan Free`,
  );
  const agentSet = new Set(agents);
  const taskSet = new Set(tasks);
  const forbidden: [string, string][] = [];
  const seen = new Set<string>();
  if (o.forbidden_assignments != null) {
    if (!Array.isArray(o.forbidden_assignments)) {
      throw new SolverError("forbidden_assignments debe ser una lista de pares [agente, tarea].");
    }
    for (const pair of o.forbidden_assignments) {
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw new SolverError("Cada asignación prohibida debe ser un par [agente, tarea].");
      }
      const a = String(pair[0] ?? "").trim();
      const t = String(pair[1] ?? "").trim();
      if (!agentSet.has(a) || !taskSet.has(t)) {
        throw new SolverError(`La asignación prohibida ${a}->${t} no corresponde a un agente y una tarea de la matriz.`);
      }
      const key = `${a}\u0000${t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      forbidden.push([a, t]);
    }
  }
  const sense = typeof o.sense === "string" && o.sense.trim().toLowerCase().startsWith("max") ? "max" : "min";
  return {
    agents,
    tasks,
    costs: numMatrix(o.costs, agents, tasks),
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

/**
 * Máximo emparejamiento bipartito (Kuhn) sobre las celdas permitidas.
 * Las filas con menos opciones se atienden primero, como se hace a mano.
 */
export function maxMatching(allowed: boolean[][]): { rowMatch: number[]; colMatch: number[]; size: number } {
  const n = allowed.length;
  const m = n ? allowed[0].length : 0;
  const rowMatch = new Array<number>(n).fill(-1);
  const colMatch = new Array<number>(m).fill(-1);
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => allowed[a].filter(Boolean).length - allowed[b].filter(Boolean).length || a - b,
  );
  function augment(i: number, seen: boolean[]): boolean {
    for (let j = 0; j < m; j++) {
      if (!allowed[i][j] || seen[j]) continue;
      seen[j] = true;
      if (colMatch[j] < 0 || augment(colMatch[j], seen)) {
        rowMatch[i] = j;
        colMatch[j] = i;
        return true;
      }
    }
    return false;
  }
  let size = 0;
  for (const i of order) {
    if (augment(i, new Array<boolean>(m).fill(false))) size += 1;
  }
  return { rowMatch, colMatch, size };
}

/** Filas y columnas alcanzables por caminos alternantes desde las filas libres (teorema de König). */
function alternatingReach(allowed: boolean[][], rowMatch: number[], colMatch: number[], from: number[]) {
  const n = allowed.length;
  const rowSeen = new Array<boolean>(n).fill(false);
  const colSeen = new Array<boolean>(n).fill(false);
  const queue = [...from];
  for (const r of from) rowSeen[r] = true;
  while (queue.length) {
    const i = queue.shift()!;
    for (let j = 0; j < n; j++) {
      if (!allowed[i][j] || colSeen[j] || rowMatch[i] === j) continue;
      colSeen[j] = true;
      const next = colMatch[j];
      if (next >= 0 && !rowSeen[next]) {
        rowSeen[next] = true;
        queue.push(next);
      }
    }
  }
  return { rowSeen, colSeen };
}

/**
 * Cobertura mínima de ceros. Por König, el número mínimo de líneas es igual al
 * máximo de ceros independientes, así que el método se detiene justo cuando hay
 * asignación completa.
 */
export function minLineCover(zeros: boolean[][]): { coverRows: number[]; coverCols: number[]; rowMatch: number[] } {
  const n = zeros.length;
  const { rowMatch, colMatch } = maxMatching(zeros);
  const free = rowMatch.map((j, i) => (j < 0 ? i : -1)).filter((i) => i >= 0);
  const { rowSeen, colSeen } = alternatingReach(zeros, rowMatch, colMatch, free);
  const coverRows: number[] = [];
  const coverCols: number[] = [];
  for (let i = 0; i < n; i++) if (!rowSeen[i]) coverRows.push(i);
  for (let j = 0; j < n; j++) if (colSeen[j]) coverCols.push(j);
  return { coverRows, coverCols, rowMatch };
}

function fmt(v: number): string {
  const s = v.toFixed(6).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

function listNames(names: string[]): string {
  const quoted = names.map((s) => `«${s}»`);
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} y ${quoted[quoted.length - 1]}`;
}

function pairsOf(rowMatch: number[]): Pair[] {
  return rowMatch.map((c, r) => [r, c] as Pair);
}

export function solve(body: unknown): ModuleResult {
  const req = parseAssignmentRequest(body);
  const nAgents = req.agents.length;
  const nTasks = req.tasks.length;
  const n = Math.max(nAgents, nTasks);
  const isMax = req.sense === "max";
  const valueCol = isMax ? "ganancia" : "costo";
  const warnings: string[] = [];

  const agentIdx = new Map(req.agents.map((a, i) => [a, i]));
  const taskIdx = new Map(req.tasks.map((t, j) => [t, j]));
  const forbidden = new Set<string>();
  for (const [a, t] of req.forbidden_assignments) forbidden.add(`${agentIdx.get(a)}:${taskIdx.get(t)}`);
  const isForbidden = (r: number, c: number) => forbidden.has(`${r}:${c}`);

  // Matriz cuadrada: los ficticios cuestan 0 y nunca están prohibidos.
  const dummyRows = Array.from({ length: n - nAgents }, (_, k) => nAgents + k);
  const dummyCols = Array.from({ length: n - nTasks }, (_, k) => nTasks + k);
  const rowLabels = req.agents.concat(dummyRows.map((_, k) => `Agente ficticio ${k + 1}`));
  const colLabels = req.tasks.concat(dummyCols.map((_, k) => `Tarea ficticia ${k + 1}`));
  const padded = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i < nAgents && j < nTasks ? req.costs[i][j] : 0)),
  );
  const forbiddenPairs: Pair[] = [];
  for (let i = 0; i < nAgents; i++) {
    for (let j = 0; j < nTasks; j++) if (isForbidden(i, j)) forbiddenPairs.push([i, j]);
  }
  if (dummyRows.length || dummyCols.length) {
    const k = dummyRows.length || dummyCols.length;
    const what = dummyRows.length
      ? `${k === 1 ? "un agente ficticio" : `${k} agentes ficticios`}`
      : `${k === 1 ? "una tarea ficticia" : `${k} tareas ficticias`}`;
    const effect = dummyRows.length
      ? `${k === 1 ? "una tarea queda" : `${k} tareas quedan`} sin agente`
      : `${k === 1 ? "un agente queda" : `${k} agentes quedan`} sin tarea`;
    warnings.push(`Matriz no cuadrada: se ${k === 1 ? "agregó" : "agregaron"} ${what} con ${valueCol} 0 para completar ${n}×${n}; ${effect}.`);
  }

  const scale = Math.max(1, ...padded.flat().map((v) => Math.abs(v)));
  const eps = 1e-9 * scale;
  const snap = (v: number) => (Math.abs(v) < eps ? 0 : v);
  const display = (m: number[][]): (number | string)[][] =>
    m.map((row, i) => row.map((v, j) => (i < nAgents && j < nTasks && isForbidden(i, j) ? "M" : Number(v.toPrecision(12)))));

  const iterations: IterationStep[] = [];
  const push = (title: string, tableau: (number | string)[][] | null, meta: Record<string, unknown>) => {
    iterations.push({ index: iterations.length, method: "hungarian", title, tableau, meta });
  };
  push(
    `Matriz de ${isMax ? "ganancias" : "costos"}${n !== nAgents || n !== nTasks ? " completada con ficticios" : ""}`,
    display(padded),
    {
      kind: "initial",
      sense: req.sense,
      row_labels: rowLabels,
      col_labels: colLabels,
      dummy_rows: dummyRows,
      dummy_cols: dummyCols,
      forbidden: forbiddenPairs,
    },
  );

  const costsTable: NamedTable = {
    name: "matriz_original",
    columns: ["agente", ...req.tasks],
    rows: req.agents.map((a, i) => [a, ...req.tasks.map((_, j) => (isForbidden(i, j) ? "M" : req.costs[i][j]))]),
  };

  // Factibilidad: con las prohibiciones, ¿cabe una asignación completa?
  const allowed = padded.map((row, i) => row.map((_, j) => !(i < nAgents && j < nTasks && isForbidden(i, j))));
  const feasible = maxMatching(allowed);
  if (feasible.size < n) {
    const free = feasible.rowMatch.map((c, r) => (c < 0 ? r : -1)).filter((r) => r >= 0).slice(0, 1);
    const { rowSeen, colSeen } = alternatingReach(allowed, feasible.rowMatch, feasible.colMatch, free);
    const stuckAgents = rowLabels.filter((_, i) => rowSeen[i]);
    const reachTasks = colLabels.filter((_, j) => colSeen[j] && j < nTasks);
    const reachDummy = dummyCols.some((j) => colSeen[j]);
    const options = reachTasks.length
      ? `${reachTasks.length === 1 ? "la tarea" : "las tareas"} ${listNames(reachTasks)}${reachDummy ? " o quedarse sin tarea" : ""}`
      : "quedarse sin tarea";
    const reason =
      stuckAgents.length === 1
        ? `${listNames(stuckAgents)} tiene prohibidas todas las tareas.`
        : `${listNames(stuckAgents)} solo pueden ir a ${options}: no alcanzan para todos.`;
    return okResult("assignment", {
      status: "infeasible",
      variables: {},
      objective_value: null,
      objective_sense: req.sense,
      metrics: {},
      iterations,
      graph: null,
      tables: [costsTable],
      warnings: [`No existe una asignación que respete las prohibiciones: ${reason}`, ...warnings],
    });
  }

  let work = cloneMat(padded);
  if (isMax) {
    const finite = padded.flatMap((row, i) => row.filter((_, j) => allowed[i][j]));
    const mx = Math.max(...finite);
    work = work.map((row, i) => row.map((v, j) => (allowed[i][j] ? mx - v : BIG_M)));
    push(`Maximizar: pérdida de oportunidad (${fmt(mx)} menos cada valor)`, display(work), { kind: "regret", max_value: mx });
  } else {
    work = work.map((row, i) => row.map((v, j) => (allowed[i][j] ? v : BIG_M)));
  }

  const rowMin = work.map((row) => Math.min(...row));
  let mat = work.map((row, i) => row.map((v) => snap(v - rowMin[i])));
  push("Reducción por filas: a cada fila se le resta su mínimo", display(mat), { kind: "row_reduction", row_min: rowMin });
  const colMin = Array.from({ length: n }, (_, j) => Math.min(...mat.map((row) => row[j])));
  mat = mat.map((row) => row.map((v, j) => snap(v - colMin[j])));
  push("Reducción por columnas: a cada columna se le resta su mínimo", display(mat), {
    kind: "col_reduction",
    col_min: colMin,
  });

  let assignment: number[] | null = null;
  let adjustments = 0;
  for (let guard = 0; guard < n * n + 2 * n + 4; guard++) {
    const zeros = mat.map((row) => row.map((v) => v === 0));
    const { coverRows, coverCols, rowMatch } = minLineCover(zeros);
    const lines = coverRows.length + coverCols.length;
    const independent = pairsOf(rowMatch).filter(([, c]) => c >= 0);
    push(
      lines >= n
        ? `Cubrir ceros: ${lines} líneas = ${n}, ya hay asignación óptima`
        : `Cubrir ceros: ${lines} ${lines === 1 ? "línea" : "líneas"} < ${n}, falta ajustar`,
      display(mat),
      { kind: "cover", cover_rows: coverRows, cover_cols: coverCols, lines, n, independent_zeros: independent },
    );
    if (lines >= n) {
      assignment = rowMatch;
      break;
    }
    const rowCov = new Set(coverRows);
    const colCov = new Set(coverCols);
    let delta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      if (rowCov.has(i)) continue;
      for (let j = 0; j < n; j++) if (!colCov.has(j)) delta = Math.min(delta, mat[i][j]);
    }
    mat = mat.map((row, i) =>
      row.map((v, j) => {
        if (!rowCov.has(i) && !colCov.has(j)) return snap(v - delta);
        if (rowCov.has(i) && colCov.has(j)) return snap(v + delta);
        return v;
      }),
    );
    adjustments += 1;
    push(`Ajuste con el mínimo no cubierto (${fmt(delta)})`, display(mat), {
      kind: "adjust",
      delta,
      cover_rows: coverRows,
      cover_cols: coverCols,
    });
  }
  if (!assignment) {
    // Red de seguridad numérica: no debería ocurrir con la cobertura mínima.
    const { cols } = linearSumAssignment(work);
    assignment = cols;
  }

  const finalPairs = pairsOf(assignment);
  push("Asignación óptima: un cero por fila y por columna", display(mat), { kind: "assignment", assigned: finalPairs });

  const isReal = (r: number, c: number) => r < nAgents && c < nTasks;
  const variables: Record<string, number> = {};
  let total = 0;
  const rows: (string | number)[][] = [];
  for (const [r, c] of finalPairs) {
    if (!isReal(r, c)) continue;
    variables[`${req.agents[r]}->${req.tasks[c]}`] = 1;
    total += req.costs[r][c];
    rows.push([req.agents[r], req.tasks[c], req.costs[r][c]]);
  }

  const tables: NamedTable[] = [{ name: "assignment", columns: ["agente", "tarea", valueCol], rows }];
  const unassigned: string[][] = [];
  for (const [r, c] of finalPairs) {
    if (r < nAgents && c >= nTasks) unassigned.push(["agente", req.agents[r]]);
    if (c < nTasks && r >= nAgents) unassigned.push(["tarea", req.tasks[c]]);
  }
  if (unassigned.length) tables.push({ name: "sin_asignar", columns: ["tipo", "nombre"], rows: unassigned });

  // Óptimos alternativos: otra asignación completa sobre los ceros finales.
  const finalZeros = mat.map((row) => row.map((v) => v === 0));
  for (const [r, c] of finalPairs) {
    if (!isReal(r, c)) continue;
    const banned = finalZeros.map((row, i) => row.map((z, j) => z && !(i === r && j === c)));
    const alt = maxMatching(banned);
    if (alt.size < n) continue;
    const altRows = pairsOf(alt.rowMatch)
      .filter(([ar, ac]) => isReal(ar, ac))
      .map(([ar, ac]) => [req.agents[ar], req.tasks[ac], req.costs[ar][ac]]);
    warnings.push(
      `Existen óptimos múltiples: otra asignación logra el mismo total de ${fmt(total)} (ver tabla Asignación alternativa).`,
    );
    tables.push({ name: "asignacion_alternativa", columns: ["agente", "tarea", valueCol], rows: altRows });
    break;
  }
  tables.push(costsTable);

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
    metrics: { total, n_assignments: rows.length, n_adjustments: adjustments },
    iterations,
    graph,
    tables,
    warnings,
  });
}
