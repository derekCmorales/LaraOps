import { columns, invert, pinv, matvec, vecmat, cloneMat } from "../../linalg";
import type { IterationStep, ModuleResult, SensitivityBlock } from "../../schema";
import { okResult } from "../../schema";
import { verticesNamedTable } from "./graph2d";
import { buildLpGraph } from "./graphNd";
import { computeSensitivity } from "./sensitivity";
import { collectVarNames, parseLpRequest, type LPRequest } from "./types";

type SimplexStatus = "optimal" | "unbounded";

export function solve(body: unknown): ModuleResult {
  return solveLp(parseLpRequest(body));
}

export function solveLp(req: LPRequest): ModuleResult {
  const varNames = collectVarNames(req);
  const n = varNames.length;
  const maximize = req.sense === "max";
  const cUser = varNames.map((v) => req.objective[v] ?? 0);
  const cObj = maximize ? cUser.slice() : cUser.map((x) => -x);

  let constraintIds = req.constraints.map((c) => c.id);
  const rows: number[][] = [];
  const rhsList: number[] = [];
  const senses: string[] = [];

  for (const cons of req.constraints) {
    let row = varNames.map((v) => cons.coeffs[v] ?? 0);
    let bVal = cons.rhs;
    let sense = cons.sense;
    if (bVal < 0) {
      row = row.map((x) => -x);
      bVal = -bVal;
      if (sense === "<=") sense = ">=";
      else if (sense === ">=") sense = "<=";
    }
    rows.push(row);
    rhsList.push(bVal);
    senses.push(sense);
  }

  const warnings: string[] = [];
  const iterations: IterationStep[] = [];

  if (!rows.length) {
    if (cObj.some((x) => Math.abs(x) > 1e-12)) {
      return resultOf(req, "unbounded", Object.fromEntries(varNames.map((v) => [v, 0])), null, [], null, warnings);
    }
    return resultOf(req, "optimal", Object.fromEntries(varNames.map((v) => [v, 0])), 0, [], null, warnings);
  }

  const ACore = rows.map((r) => r.slice());
  let bOriginal = rhsList.slice();
  const m0 = rows.length;
  const extraCols: number[][] = [];
  let colNames = [...varNames];
  const basic = Array(m0).fill(-1);
  const artIndices: number[] = [];

  senses.forEach((sense, i) => {
    if (sense === "<=") {
      const col = Array(m0).fill(0);
      col[i] = 1;
      extraCols.push(col);
      colNames.push(`s_${constraintIds[i]}`);
      basic[i] = n + extraCols.length - 1;
    } else if (sense === ">=") {
      const surplus = Array(m0).fill(0);
      surplus[i] = -1;
      extraCols.push(surplus);
      colNames.push(`e_${constraintIds[i]}`);
      const art = Array(m0).fill(0);
      art[i] = 1;
      extraCols.push(art);
      colNames.push(`a_${constraintIds[i]}`);
      basic[i] = n + extraCols.length - 1;
      artIndices.push(basic[i]);
    } else {
      const art = Array(m0).fill(0);
      art[i] = 1;
      extraCols.push(art);
      colNames.push(`a_${constraintIds[i]}`);
      basic[i] = n + extraCols.length - 1;
      artIndices.push(basic[i]);
    }
  });

  let AWork = extraCols.length ? hstack(ACore, extraCols) : cloneMat(ACore);
  let b = bOriginal.slice();
  const totalCols = AWork[0].length;
  let AStd = cloneMat(AWork);

  let cPhase2: number[];
  if (artIndices.length) {
    const cPhase1 = Array(totalCols).fill(0);
    for (const ai of artIndices) cPhase1[ai] = -1;
    const p1 = simplexLoop(AWork, b, cPhase1, basic, colNames, "Fase I", 0);
    AWork = p1.A;
    b = p1.b;
    if (req.include_iterations) iterations.push(...p1.iterations);
    let artSum = 0;
    for (const ai of artIndices) {
      const idx = basic.indexOf(ai);
      if (idx >= 0) artSum += b[idx];
    }
    if (artSum > 1e-7) {
      return resultOf(
        req,
        "infeasible",
        Object.fromEntries(varNames.map((v) => [v, 0])),
        null,
        req.include_iterations ? iterations : [],
        null,
        warnings,
      );
    }
    const artSet = new Set(artIndices);
    const rowsBefore = AWork.length;
    const ejected = ejectArtificials(AWork, b, basic, artSet);
    AWork = ejected.A;
    b = ejected.b;
    if (ejected.keepRows.length < rowsBefore) {
      AStd = ejected.keepRows.map((i) => AStd[i]);
      bOriginal = ejected.keepRows.map((i) => bOriginal[i]);
      constraintIds = ejected.keepRows.map((i) => constraintIds[i]);
      warnings.push("Restricciones redundantes detectadas y eliminadas tras la Fase I");
    }
    const keep = [...Array(AWork[0].length).keys()].filter((j) => !artSet.has(j));
    const oldToNew = new Map(keep.map((old, neu) => [old, neu]));
    AWork = AWork.map((row) => keep.map((j) => row[j]));
    AStd = AStd.map((row) => keep.map((j) => row[j]));
    colNames = keep.map((j) => colNames[j]);
    const remapped = basic.map((bi) => oldToNew.get(bi)).filter((v): v is number => v !== undefined);
    basic.length = 0;
    basic.push(...remapped);
    cPhase2 = Array(keep.length).fill(0);
    for (const [jOld, jNew] of oldToNew) {
      if (jOld < n) cPhase2[jNew] = cObj[jOld];
    }
  } else {
    cPhase2 = Array(totalCols).fill(0);
    for (let j = 0; j < n; j++) cPhase2[j] = cObj[j];
  }

  const p2 = simplexLoop(AWork, b, cPhase2, basic, colNames, "Fase II", iterations.length);
  AWork = p2.A;
  b = p2.b;
  if (req.include_iterations) iterations.push(...p2.iterations);
  if (p2.status === "unbounded") {
    return resultOf(
      req,
      "unbounded",
      Object.fromEntries(varNames.map((v) => [v, 0])),
      null,
      req.include_iterations ? iterations : [],
      null,
      warnings,
    );
  }

  const xFull = Array(colNames.length).fill(0);
  basic.forEach((col, row) => {
    xFull[col] = b[row];
  });
  const variables = Object.fromEntries(varNames.map((v, i) => [v, xFull[i] ?? 0]));
  const zInternal = cPhase2.reduce((s, c, j) => s + c * xFull[j], 0);
  const zUser = maximize ? zInternal : -zInternal;

  for (let row = 0; row < basic.length; row++) {
    if (Math.abs(b[row]) < 1e-9 && basic[row] < n) {
      warnings.push(`Degeneración: variable básica ${colNames[basic[row]]} = 0`);
      break;
    }
  }

  try {
    const BInv = invert(columns(AStd, basic));
    const y = vecmat(
      basic.map((j) => cPhase2[j]),
      BInv,
    );
    const reduced = cPhase2.map((cj, j) => cj - y.reduce((s, yi, i) => s + yi * AStd[i][j], 0));
    const nonbasic = [...Array(colNames.length).keys()].filter((j) => !basic.includes(j));
    const alt = nonbasic.filter((j) => j < n && Math.abs(reduced[j]) < 1e-8).map((j) => colNames[j]);
    if (alt.length) {
      warnings.push(`Óptimos múltiples: variables no básicas con costo reducido ≈ 0: ${alt.join(", ")}`);
    }
  } catch {
    /* ignore */
  }

  let sensitivity: SensitivityBlock | null = null;
  if (req.include_sensitivity) {
    sensitivity = computeSensitivity({
      A: AStd,
      bOriginal,
      cInternal: cPhase2,
      basic: [...basic],
      varNames,
      constraintIds,
      constraints: req.constraints,
      variables,
      nDecision: n,
      maximize,
      cUser,
      warnings,
    });
  }

  let graph = null;
  let tables = null;
  if (req.include_graph) {
    const built = buildLpGraph(req, variables, zUser);
    graph = built.graph;
    warnings.push(...built.warnings);
    if (graph) {
      const xName = graph.x_label ?? varNames[0];
      const yName = graph.y_label ?? varNames[1];
      const oz = graph.z_label ? (variables[graph.z_label] ?? 0) : undefined;
      const vertexTable = verticesNamedTable(graph, variables[xName] ?? 0, variables[yName] ?? 0, maximize, oz);
      tables = vertexTable ? [vertexTable] : null;
    }
  }

  return okResult("linear_programming", {
    status: "optimal",
    variables,
    objective_value: zUser,
    objective_sense: req.sense,
    metrics: {},
    iterations: req.include_iterations ? iterations : null,
    sensitivity,
    graph,
    tables,
    warnings,
  });
}

function resultOf(
  req: LPRequest,
  status: "optimal" | "infeasible" | "unbounded",
  variables: Record<string, number>,
  objective: number | null,
  iterations: IterationStep[],
  sensitivity: SensitivityBlock | null,
  warnings: string[],
): ModuleResult {
  return okResult("linear_programming", {
    status,
    variables,
    objective_value: objective,
    objective_sense: req.sense,
    metrics: {},
    iterations: iterations.length ? iterations : null,
    sensitivity,
    warnings,
  });
}

function hstack(A: number[][], extra: number[][]): number[][] {
  return A.map((row, i) => [...row, ...extra.map((col) => col[i])]);
}

function pivotTableau(body: number[][], xB: number[], basic: number[], leaveRow: number, enter: number): void {
  const pivot = body[leaveRow][enter];
  for (let j = 0; j < body[leaveRow].length; j++) body[leaveRow][j] /= pivot;
  xB[leaveRow] /= pivot;
  for (let i = 0; i < body.length; i++) {
    if (i === leaveRow) continue;
    const factor = body[i][enter];
    for (let j = 0; j < body[i].length; j++) body[i][j] -= factor * body[leaveRow][j];
    xB[i] -= factor * xB[leaveRow];
  }
  basic[leaveRow] = enter;
}

function ejectArtificials(
  A: number[][],
  b: number[],
  basic: number[],
  artSet: Set<number>,
  tol = 1e-9,
): { A: number[][]; b: number[]; keepRows: number[] } {
  const body = cloneMat(A);
  const xB = b.slice();
  const m = body.length;
  const n = body[0].length;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < m; i++) {
      const bi = basic[i];
      if (!artSet.has(bi) || Math.abs(xB[i]) > tol) continue;
      const nonbasic = [...Array(n).keys()].filter((j) => !basic.includes(j));
      const enter = nonbasic.find((j) => !artSet.has(j) && Math.abs(body[i][j]) > tol);
      if (enter == null) continue;
      pivotTableau(body, xB, basic, i, enter);
      changed = true;
      break;
    }
  }
  const keepRows = [...Array(body.length).keys()].filter((i) => !artSet.has(basic[i]) || Math.abs(xB[i]) > tol);
  if (keepRows.length < body.length) {
    const A2 = keepRows.map((i) => body[i]);
    const b2 = keepRows.map((i) => xB[i]);
    const basic2 = keepRows.map((i) => basic[i]);
    basic.length = 0;
    basic.push(...basic2);
    return { A: A2, b: b2, keepRows };
  }
  basic.splice(0, basic.length, ...basic);
  return { A: body, b: xB, keepRows };
}

function simplexLoop(
  AIn: number[][],
  bIn: number[],
  c: number[],
  basic: number[],
  colNames: string[],
  phaseLabel: string,
  startIndex: number,
  maxIters = 200,
): { status: SimplexStatus; A: number[][]; b: number[]; iterations: IterationStep[] } {
  const iterations: IterationStep[] = [];
  let A = cloneMat(AIn);
  let b = bIn.slice();
  const m = A.length;
  const n = A[0].length;

  for (let k = 0; k < maxIters; k++) {
    let BInv: number[][];
    try {
      BInv = invert(columns(A, basic));
    } catch {
      BInv = pinv(columns(A, basic));
    }
    let xB = matvec(BInv, b);
    xB = xB.map((v) => (Math.abs(v) < 1e-12 ? 0 : v));
    const cB = basic.map((j) => c[j]);
    const y = vecmat(cB, BInv);
    const reduced = c.map((cj, j) => cj - y.reduce((s, yi, i) => s + yi * A[i][j], 0));
    const z = cB.reduce((s, v, i) => s + v * xB[i], 0);
    const bodyFixed = BInv.map((bRow) =>
      Array.from({ length: n }, (_, j) => bRow.reduce((s, bij, t) => s + bij * A[t][j], 0)),
    );
    const nonbasic = [...Array(n).keys()].filter((j) => !basic.includes(j));
    const cjRow: (number | string)[] = ["Cj", "", ...c.map((v) => v)];
    const headerRow: (number | string)[] = ["Base", "Xb", ...colNames];
    const bodyRows: (number | string)[][] = [];
    for (let i = 0; i < m; i++) {
      const baseName = colNames[basic[i]] ?? `s${i}`;
      bodyRows.push([baseName, xB[i], ...bodyFixed[i].map((v) => v)]);
    }
    const zjRow: (number | string)[] = ["Zj−Cj", z, ...reduced.map((v) => v)];
    iterations.push({
      index: startIndex + k,
      method: "simplex",
      title: `${phaseLabel} — Iteración ${k}`,
      tableau: [cjRow, headerRow, ...bodyRows, zjRow],
      meta: {
        basic: basic.map((i) => colNames[i]),
        nonbasic: nonbasic.map((j) => colNames[j]),
        pivot: null,
        z,
        phase: phaseLabel,
      },
    });

    const enterCandidates = nonbasic.filter((j) => reduced[j] > 1e-9).map((j) => [reduced[j], j] as const);
    if (!enterCandidates.length) {
      return { status: "optimal", A: cloneMat(bodyFixed), b: xB.slice(), iterations };
    }
    const enter = enterCandidates.reduce((best, cur) => (cur[0] > best[0] ? cur : best))[1];
    const col = bodyFixed.map((row) => row[enter]);
    const ratios = col
      .map((v, i) => [v, i] as const)
      .filter(([v]) => v > 1e-12)
      .map(([v, i]) => [xB[i] / v, i] as const);
    if (!ratios.length) {
      return { status: "unbounded", A: cloneMat(bodyFixed), b: xB.slice(), iterations };
    }
    const leaveRow = ratios.reduce((best, cur) => (cur[0] < best[0] ? cur : best))[1];
    const leaveCol = basic[leaveRow];
    iterations[iterations.length - 1].meta.pivot = {
      row: leaveRow + 2,
      col: enter + 2,
      enter: colNames[enter],
      leave: colNames[leaveCol],
    };
    const work = cloneMat(bodyFixed);
    const xWork = xB.slice();
    pivotTableau(work, xWork, basic, leaveRow, enter);
    A = work;
    b = xWork;
  }
  return { status: "unbounded", A, b, iterations };
}
