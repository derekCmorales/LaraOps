import { SolverError } from "../../errors";
import type { IterationStep, ModuleResult, NamedTable, SensitivityBlock } from "../../schema";
import { okResult } from "../../schema";
import { basicSolutionsTable } from "./basicSolutions";
import { buildDual, linearText } from "./dual";
import { verticesNamedTable } from "./graph2d";
import { buildLpGraph } from "./graphNd";
import { cell, fmtM, fmtPlain, hasM, snap } from "./mnum";
import { computeSensitivity } from "./sensitivity";
import {
  alternativeOptimum,
  finalBasisWithoutArtificials,
  runSimplex,
  solutionOf,
  type ColKind,
  type EngineOutcome,
  type Snapshot,
  type StdForm,
} from "./simplex";
import { collectVarNames, parseLpRequest, type LPConstraint, type LPRequest } from "./types";

export function solve(body: unknown): ModuleResult {
  return solveLp(parseLpRequest(body));
}

/** Convierte las cotas de variables en restricciones explícitas. */
function applyBounds(req: LPRequest, varNames: string[]): LPRequest {
  if (!req.bounds) return req;
  const extra: LPConstraint[] = [];
  for (const [name, [lo, hi]] of Object.entries(req.bounds)) {
    if (!varNames.includes(name)) continue;
    if (lo == null || lo < 0) {
      throw new SolverError(
        `La variable ${name} tiene cota inferior negativa o libre. Este módulo trabaja con variables no negativas: sustituye ${name} = ${name}⁺ − ${name}⁻ con ambas ≥ 0.`,
      );
    }
    if (lo > 0) extra.push({ id: `cota_inf_${name}`, coeffs: { [name]: 1 }, sense: ">=", rhs: lo });
    if (hi != null) {
      if (hi < lo) throw new SolverError(`La cota superior de ${name} es menor que la inferior.`);
      extra.push({ id: `cota_sup_${name}`, coeffs: { [name]: 1 }, sense: "<=", rhs: hi });
    }
  }
  return { ...req, constraints: [...req.constraints, ...extra], bounds: null };
}

function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  while (taken.has(name)) name = `${name}'`;
  taken.add(name);
  return name;
}

/** Forma estándar: LD >= 0, holguras (s), excesos (e) y artificiales (a). */
function buildStdForm(constraints: LPConstraint[], varNames: string[]): StdForm {
  const n = varNames.length;
  const taken = new Set(varNames);
  const colNames = [...varNames];
  const kinds: ColKind[] = varNames.map(() => "decision");
  const colRow: number[] = varNames.map(() => -1);
  const m = constraints.length;
  const rows: number[][] = [];
  const b: number[] = [];
  const flipped: boolean[] = [];
  const senses: string[] = [];
  constraints.forEach((c) => {
    let row = varNames.map((v) => c.coeffs[v] ?? 0);
    let rhs = c.rhs;
    let sense = c.sense;
    const flip = rhs < 0;
    if (flip) {
      row = row.map((x) => (x === 0 ? 0 : -x));
      rhs = -rhs;
      if (sense === "<=") sense = ">=";
      else if (sense === ">=") sense = "<=";
    }
    rows.push(row);
    b.push(rhs);
    flipped.push(flip);
    senses.push(sense);
  });
  const extra: number[][] = []; // columnas extra (cada una de largo m)
  const initialBasis: number[] = Array(m).fill(-1);
  const addCol = (name: string, kind: ColKind, row: number, value: number) => {
    const col = Array(m).fill(0);
    col[row] = value;
    extra.push(col);
    colNames.push(uniqueName(name, taken));
    kinds.push(kind);
    colRow.push(row);
    return colNames.length - 1;
  };
  senses.forEach((sense, i) => {
    if (sense === "<=") initialBasis[i] = addCol(`s${i + 1}`, "slack", i, 1);
    else if (sense === ">=") {
      addCol(`e${i + 1}`, "surplus", i, -1);
      initialBasis[i] = addCol(`a${i + 1}`, "artificial", i, 1);
    } else initialBasis[i] = addCol(`a${i + 1}`, "artificial", i, 1);
  });
  const A = rows.map((row, i) => [...row, ...extra.map((col) => col[i])]);
  return { colNames, kinds, colRow, A, b, initialBasis, flipped, nDecision: n };
}

function standardFormTable(
  req: LPRequest,
  form: StdForm,
  varNames: string[],
  costs: number[],
  method: "big_m" | "two_phase",
): NamedTable {
  const maximize = req.sense === "max";
  const hasArt = form.kinds.includes("artificial");
  const objNames = [...varNames];
  const objCoefs = [...costs];
  let objText = `${maximize ? "Max" : "Min"} Z = ${linearText(objCoefs, objNames)}`;
  if (hasArt && method === "big_m") {
    const arts = form.colNames.filter((_, j) => form.kinds[j] === "artificial");
    objText += arts.map((a) => ` ${maximize ? "-" : "+"} M${a}`).join("");
  }
  const rows: (string | number)[][] = [["Función objetivo", objText, ""]];
  req.constraints.forEach((c, i) => {
    const original = `${linearText(varNames.map((v) => c.coeffs[v] ?? 0), varNames)} ${c.sense === "<=" ? "≤" : c.sense === ">=" ? "≥" : "="} ${fmtPlain(c.rhs)}`;
    const coeffs = form.A[i];
    const std = `${linearText(coeffs, form.colNames)} = ${fmtPlain(form.b[i])}`;
    const added = form.colNames
      .map((name, j) => (form.colRow[j] === i ? `${name} (${kindLabel(form.kinds[j])})` : ""))
      .filter(Boolean)
      .join(", ");
    const note = form.flipped[i] ? `LD negativo: se multiplicó por -1. ${added}` : added;
    rows.push([`${c.id}: ${original}`, std, note]);
  });
  rows.push([
    "No negatividad",
    `${form.colNames.join(", ")} ≥ 0`,
    "",
  ]);
  if (hasArt && method === "two_phase") {
    const arts = form.colNames.filter((_, j) => form.kinds[j] === "artificial");
    rows.splice(1, 0, ["Fase I", `Min W = ${arts.join(" + ")}`, "Al llegar a W = 0 se pasa a la Fase II con Z original."]);
  }
  return { name: "forma_estandar", columns: ["modelo", "forma_estandar", "variables_agregadas"], rows };
}

function kindLabel(kind: ColKind): string {
  if (kind === "slack") return "holgura";
  if (kind === "surplus") return "exceso";
  if (kind === "artificial") return "artificial";
  return "decisión";
}

function stepOf(s: Snapshot, index: number): IterationStep {
  const ratioCol = !!s.ratios;
  const header: (number | string)[] = ["Básica", s.objectiveLabel, ...s.colNames, "LD"];
  if (ratioCol) header.push("Razón");
  const row0: (number | string)[] = [s.objectiveLabel, 1, ...s.row0.map(cell), cell(s.z)];
  if (ratioCol) row0.push("");
  const body = s.rows.map((r, i) => {
    const line: (number | string)[] = [s.basicNames[i], 0, ...r, s.rhs[i]];
    if (ratioCol) line.push(s.ratios![i] == null ? "—" : s.ratios![i]!);
    return line;
  });
  return {
    index,
    method: "simplex",
    title: s.title,
    tableau: [header, row0, ...body],
    meta: {
      phase: s.phase,
      kind: s.kind,
      sense: s.sense,
      objective_label: s.objectiveLabel,
      row_ids: s.rowIds,
      row0: s.row0,
      z: hasM(s.z) ? fmtM(s.z) : snap(s.z.a),
      z_m: s.z,
      ratios: s.ratios ?? null,
      enter: s.entering ?? null,
      leave: s.leaving ?? null,
      pivot: s.pivot
        ? { row: s.pivot.row + 2, col: s.pivot.col + 2, value: s.pivot.value, enter: s.entering, leave: s.leaving, tableau_row: s.pivot.row, tableau_col: s.pivot.col }
        : null,
      entering_ties: s.enteringTies?.length ? s.enteringTies : null,
      leaving_ties: s.leavingTies?.length ? s.leavingTies : null,
      rule: s.rule ?? null,
      operations: s.operations?.length ? s.operations : null,
      note: s.note ?? null,
    },
  };
}

function emptyResult(
  req: LPRequest,
  varNames: string[],
  costs: number[],
): ModuleResult {
  const maximize = req.sense === "max";
  const improves = costs.some((c) => (maximize ? c > 1e-12 : c < -1e-12));
  const zeros = Object.fromEntries(varNames.map((v) => [v, 0]));
  return okResult("linear_programming", {
    status: improves ? "unbounded" : "optimal",
    variables: zeros,
    objective_value: improves ? null : 0,
    objective_sense: req.sense,
    warnings: improves
      ? ["Z no acotada: no hay restricciones que limiten a las variables con coeficiente favorable."]
      : [],
  });
}

export function solveLp(reqIn: LPRequest): ModuleResult {
  const varNames = collectVarNames(reqIn);
  const req = applyBounds(reqIn, varNames);
  const maximize = req.sense === "max";
  const costs = varNames.map((v) => req.objective[v] ?? 0);
  const method = req.method === "two_phase" ? "two_phase" : "big_m";
  const record = req.include_iterations === true;
  const wantDual = req.include_dual === true;
  const wantBasic = req.include_basic_solutions === true;

  if (!req.constraints.length) return emptyResult(req, varNames, costs);

  const form = buildStdForm(req.constraints, varNames);
  const outcome = runSimplex(form, costs, req.sense, method, record);
  const warnings: string[] = [];
  const tables: NamedTable[] = [];
  const iterations: IterationStep[] = outcome.snapshots.map((s, i) => stepOf(s, i));
  if (wantDual) tables.push(standardFormTable(req, form, varNames, costs, method));

  tieWarnings(outcome, warnings);
  warnings.push(...outcome.warnings);

  if (outcome.status === "iteration_limit") {
    warnings.push("El simplex alcanzó el límite de iteraciones sin terminar. Revisa el modelo (coeficientes muy grandes o muy pequeños).");
    return okResult("linear_programming", {
      status: "error",
      variables: Object.fromEntries(varNames.map((v) => [v, 0])),
      objective_sense: req.sense,
      iterations: record ? iterations : null,
      tables,
      warnings,
    });
  }

  if (outcome.status !== "optimal") {
    if (outcome.status === "infeasible") {
      const arts = outcome.positiveArtificials ?? [];
      const which = arts.map((a) => `${a.name} = ${fmtPlain(a.value)} (restricción ${req.constraints[a.row]?.id ?? a.row + 1})`);
      warnings.unshift(
        `Infactible: ninguna solución cumple todas las restricciones a la vez.${which.length ? ` La artificial ${which.join(", ")} no pudo salir de la base.` : ""}`,
      );
    } else {
      warnings.unshift(
        `Z no acotada: ${outcome.unboundedVar ?? "una variable"} puede crecer sin límite porque ninguna restricción la frena (su columna no tiene valores positivos para la razón).`,
      );
    }
    if (wantDual) {
      const dual = buildDual({ sense: req.sense, varNames, costs, constraints: req.constraints, shadow: null, reduced: null, slacks: null, values: null });
      tables.push(...dual.tables);
      warnings.push(
        outcome.status === "infeasible"
          ? "Teoría de la dualidad: si el primal es infactible, el dual es no acotado o también infactible."
          : "Teoría de la dualidad: si el primal es no acotado, el dual es infactible.",
      );
    }
    let graph = null;
    if (req.include_graph !== false && varNames.length === 2) {
      const built = buildLpGraph(req, {}, null);
      graph = built.graph;
    }
    return okResult("linear_programming", {
      status: outcome.status,
      variables: Object.fromEntries(varNames.map((v) => [v, 0])),
      objective_value: null,
      objective_sense: req.sense,
      metrics: { iterations: countPivots(outcome) },
      iterations: record ? iterations : null,
      graph,
      tables: tables.length ? tables : null,
      warnings,
    });
  }

  const xAll = solutionOf(outcome.tab, form.colNames.length);
  const variables = Object.fromEntries(varNames.map((v, j) => [v, xAll[j]]));
  const zUser = snap(costs.reduce((s, c, j) => s + c * xAll[j], 0));

  const degenerate = outcome.tab.basic
    .map((bc, i) => ({ bc, v: outcome.tab.rhs[i] }))
    .filter(({ bc, v }) => Math.abs(v) < 1e-9 && form.kinds[bc] !== "artificial")
    .map(({ bc }) => form.colNames[bc]);
  if (degenerate.length) {
    warnings.push(
      `Degeneración: la variable básica ${degenerate.join(", ")} vale 0. La solución es degenerada (hay restricciones de más pasando por el mismo vértice).`,
    );
  }

  const alt = alternativeOptimum(outcome, form);
  if (alt) {
    warnings.push(
      `Óptimos múltiples: ${alt.columns.join(", ")} no es básica y su coeficiente en la fila Z es 0, así que puede entrar sin cambiar Z.`,
    );
    if (alt.x) {
      tables.push({
        name: "solucion_alternativa",
        columns: ["variable", "solucion_1", "solucion_2"],
        rows: form.colNames
          .map((name, j) => (form.kinds[j] === "artificial" ? null : [name, xAll[j], alt.x![j]]))
          .filter((r): r is (string | number)[] => r !== null),
      });
      if (record && alt.snapshot) iterations.push(stepOf(alt.snapshot, iterations.length));
    } else {
      warnings.push("La solución alterna no tiene límite en esa dirección: hay infinitas soluciones óptimas sobre un rayo.");
    }
  }

  let sensitivity: SensitivityBlock | null = null;
  if (req.include_sensitivity) {
    const fb = finalBasisWithoutArtificials(outcome, form, costs, req.sense);
    sensitivity = computeSensitivity({
      form,
      basic: fb.basic,
      rows: fb.rows,
      costs,
      maximize,
      varNames,
      constraints: req.constraints,
      variables,
      warnings,
    });
  }

  const metrics: Record<string, number> = { iterations: countPivots(outcome) };
  if (wantDual) {
    const shadow = sensitivity
      ? new Map(sensitivity.shadow_prices.map((r) => [String(r.constraint_id), Number(r.shadow_price)]))
      : null;
    const reduced = sensitivity
      ? new Map(sensitivity.reduced_costs.map((r) => [String(r.variable), Number(r.reduced_cost)]))
      : null;
    const slacks = sensitivity
      ? new Map(sensitivity.constraint_analysis.map((r) => [String(r.constraint_id), Number(r.slack_or_surplus)]))
      : null;
    const dual = buildDual({ sense: req.sense, varNames, costs, constraints: req.constraints, shadow, reduced, slacks, values: variables });
    tables.push(...dual.tables);
    if (dual.dualObjective != null) metrics.dual_objective = dual.dualObjective;
  }

  if (wantBasic) {
    const basicSol = basicSolutionsTable(form, costs, zUser);
    if (basicSol.table) tables.push(basicSol.table);
    if (basicSol.note) warnings.push(basicSol.note);
  }

  let graph = null;
  if (req.include_graph) {
    const built = buildLpGraph(req, variables, zUser);
    graph = built.graph;
    warnings.push(...built.warnings);
    if (graph) {
      const xName = graph.x_label ?? varNames[0];
      const yName = graph.y_label ?? varNames[1];
      const oz = graph.z_label ? (variables[graph.z_label] ?? 0) : undefined;
      const vertexTable = verticesNamedTable(graph, variables[xName] ?? 0, variables[yName] ?? 0, maximize, oz);
      if (vertexTable) tables.unshift(vertexTable);
    }
  }

  return okResult("linear_programming", {
    status: "optimal",
    variables,
    objective_value: zUser,
    objective_sense: req.sense,
    metrics,
    iterations: record ? iterations : null,
    sensitivity,
    graph,
    tables: tables.length ? tables : null,
    warnings,
  });
}

function countPivots(outcome: EngineOutcome): number {
  return outcome.pivots;
}

function tieWarnings(outcome: EngineOutcome, warnings: string[]): void {
  if (outcome.ties.entering > 0) {
    warnings.push(
      "Empate en la variable que entra: dos o más columnas tenían el mismo coeficiente en la fila Z. Se eligió la primera de izquierda a derecha (cualquiera es válida).",
    );
  }
  if (outcome.ties.leaving > 0) {
    warnings.push(
      "Empate en la razón mínima: dos o más filas tenían la misma razón. Se eligió la de más arriba; la otra básica queda en 0 (solución degenerada).",
    );
  }
}
