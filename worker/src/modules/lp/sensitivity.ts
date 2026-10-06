import { columns, invert, matvec, pinv, vecmat } from "../../linalg";
import type { SensitivityBlock } from "../../schema";
import { snap } from "./mnum";
import type { StdForm } from "./simplex";
import type { LPConstraint } from "./types";

/** Valor infinito en los rangos. Se muestra como "∞" / "-∞". */
export const INF_TEXT = "∞";
export const NEG_INF_TEXT = "-∞";

function bound(value: number): number | string {
  if (value === Number.POSITIVE_INFINITY) return INF_TEXT;
  if (value === Number.NEGATIVE_INFINITY) return NEG_INF_TEXT;
  return snap(value);
}

/**
 * Sensibilidad a partir de la base óptima (sin artificiales).
 *
 * - Precio sombra: cambio de Z por unidad de aumento del LD tal como lo escribió el usuario.
 * - Costo reducido (convención de Solver/WinQSB): cj - zj en el sentido del usuario.
 * - Rangos: intervalo donde la base actual sigue siendo óptima (coeficientes) o factible (LD).
 */
export function computeSensitivity(args: {
  form: StdForm;
  basic: number[];
  rows: number[];
  costs: number[];
  maximize: boolean;
  varNames: string[];
  constraints: LPConstraint[];
  variables: Record<string, number>;
  warnings: string[];
}): SensitivityBlock {
  const { form, basic, rows, costs, maximize, varNames, constraints, variables, warnings } = args;
  const realCols = form.colNames.map((_, j) => j).filter((j) => form.kinds[j] !== "artificial");
  const colPos = new Map(realCols.map((j, k) => [j, k]));
  const A = rows.map((i) => realCols.map((j) => form.A[i][j]));
  const b = rows.map((i) => form.b[i]);
  const basicPos = basic.map((j) => colPos.get(j) ?? -1);
  // Costos en forma "maximizar": para minimizar se usa -c.
  const c = realCols.map((j) => (j < form.nDecision ? (maximize ? costs[j] : -costs[j]) : 0));

  let BInv: number[][];
  try {
    BInv = invert(columns(A, basicPos));
  } catch {
    warnings.push("La base óptima es casi singular: los rangos pueden ser imprecisos.");
    BInv = pinv(columns(A, basicPos));
  }
  const y = vecmat(
    basicPos.map((k) => c[k]),
    BInv,
  );
  // d_j = c_j - z_j en forma máx.: <= 0 en el óptimo.
  const d = c.map((cj, k) => snap(cj - y.reduce((s, yi, i) => s + yi * A[i][k], 0)));
  const xB = matvec(BInv, b);
  const alpha = (k: number) => matvec(BInv, A.map((row) => row[k]));

  const userSign = maximize ? 1 : -1;
  const shadowPrices: Record<string, unknown>[] = [];
  const shadowByRow = new Map<number, number>();
  rows.forEach((origRow, i) => {
    const flip = form.flipped[origRow] ? -1 : 1;
    const sp = snap(userSign * y[i] * flip);
    shadowByRow.set(origRow, sp);
    shadowPrices.push({ constraint_id: constraints[origRow].id, shadow_price: sp });
  });

  const reducedCosts = varNames.map((name, j) => ({
    variable: name,
    reduced_cost: snap(userSign * d[colPos.get(j)!]),
  }));

  const nonbasic = realCols.map((_, k) => k).filter((k) => !basicPos.includes(k));
  const objectiveRanges: Record<string, unknown>[] = varNames.map((name, j) => {
    const k = colPos.get(j)!;
    let up = Number.POSITIVE_INFINITY; // cuánto puede subir el coef. en forma máx.
    let down = Number.POSITIVE_INFINITY; // cuánto puede bajar
    if (!basicPos.includes(k)) {
      // No básica: puede bajar sin límite; subir hasta que d_j llegue a 0.
      up = Math.max(0, -d[k]);
    } else {
      const r = basicPos.indexOf(k);
      for (const nk of nonbasic) {
        const a = alpha(nk)[r];
        if (Math.abs(a) < 1e-12) continue;
        const ratio = Math.abs(d[nk] / a);
        // Nuevo d_nk = d_nk - delta * a <= 0.
        if (a > 0) down = Math.min(down, ratio);
        else up = Math.min(up, ratio);
      }
    }
    const coeff = costs[j];
    // En minimización el coeficiente del usuario es -c: subir en forma máx. = bajar para el usuario.
    const inc = maximize ? up : down;
    const dec = maximize ? down : up;
    return {
      variable: name,
      coeff,
      allowable_increase: bound(inc),
      allowable_decrease: bound(dec),
      min_coef: bound(coeff - dec),
      max_coef: bound(coeff + inc),
    };
  });

  const rhsRanges: Record<string, unknown>[] = [];
  const constraintAnalysis: Record<string, unknown>[] = [];
  rows.forEach((origRow, i) => {
    const col = BInv.map((row) => row[i]);
    let inc = Number.POSITIVE_INFINITY;
    let dec = Number.POSITIVE_INFINITY;
    for (let r = 0; r < basicPos.length; r++) {
      if (col[r] > 1e-12) dec = Math.min(dec, Math.max(0, xB[r]) / col[r]);
      else if (col[r] < -1e-12) inc = Math.min(inc, Math.max(0, xB[r]) / -col[r]);
    }
    const cons = constraints[origRow];
    // Si la fila se multiplicó por -1, aumentar el LD del usuario es disminuir el normalizado.
    const userInc = form.flipped[origRow] ? dec : inc;
    const userDec = form.flipped[origRow] ? inc : dec;
    rhsRanges.push({
      constraint_id: cons.id,
      rhs: cons.rhs,
      allowable_increase: bound(userInc),
      allowable_decrease: bound(userDec),
    });
    const lhs = snap(varNames.reduce((s, v) => s + (cons.coeffs[v] ?? 0) * (variables[v] ?? 0), 0));
    let slack = 0;
    if (cons.sense === "<=") slack = cons.rhs - lhs;
    else if (cons.sense === ">=") slack = lhs - cons.rhs;
    else slack = Math.abs(lhs - cons.rhs);
    constraintAnalysis.push({
      constraint_id: cons.id,
      lhs,
      sense: cons.sense,
      rhs: cons.rhs,
      slack_or_surplus: snap(slack),
      shadow_price: shadowByRow.get(origRow) ?? 0,
      allowable_min_rhs: bound(cons.rhs - userDec),
      allowable_max_rhs: bound(cons.rhs + userInc),
    });
  });

  // Restricciones redundantes eliminadas: precio sombra 0 y sin rango.
  constraints.forEach((cons, origRow) => {
    if (rows.includes(origRow)) return;
    const lhs = snap(varNames.reduce((s, v) => s + (cons.coeffs[v] ?? 0) * (variables[v] ?? 0), 0));
    shadowPrices.push({ constraint_id: cons.id, shadow_price: 0 });
    constraintAnalysis.push({
      constraint_id: cons.id,
      lhs,
      sense: cons.sense,
      rhs: cons.rhs,
      slack_or_surplus: 0,
      shadow_price: 0,
      allowable_min_rhs: "—",
      allowable_max_rhs: "—",
    });
  });

  return {
    shadow_prices: shadowPrices,
    reduced_costs: reducedCosts,
    objective_ranges: objectiveRanges,
    rhs_ranges: rhsRanges,
    constraint_analysis: constraintAnalysis,
  };
}
