import { invert, pinv, columns, matvec, vecmat, column } from "../../linalg";
import type { SensitivityBlock } from "../../schema";
import type { LPConstraint } from "./types";

const INF = 1e12;
const INF_THRESHOLD = 1e9;

function formatRhsBound(value: number): number | string {
  if (value >= INF_THRESHOLD) return "M";
  return value;
}

export function computeSensitivity(args: {
  A: number[][];
  bOriginal: number[];
  cInternal: number[];
  basic: number[];
  varNames: string[];
  constraintIds: string[];
  constraints: LPConstraint[];
  variables: Record<string, number>;
  nDecision: number;
  maximize: boolean;
  cUser: number[];
  warnings: string[];
}): SensitivityBlock {
  const {
    A,
    bOriginal,
    cInternal,
    basic,
    varNames,
    constraintIds,
    constraints,
    variables,
    nDecision,
    maximize,
    cUser,
    warnings,
  } = args;

  let BInv: number[][];
  try {
    BInv = invert(columns(A, basic));
  } catch {
    warnings.push("Sensitivity ranging numerically unstable; returning shadow prices and reduced costs only.");
    BInv = pinv(columns(A, basic));
  }

  const cB = basic.map((j) => cInternal[j]);
  const y = vecmat(cB, BInv);
  const reduced = cInternal.map((cj, j) => cj - y.reduce((s, yi, i) => s + yi * A[i][j], 0));

  const shadowPrices: Record<string, unknown>[] = [];
  const shadowById: Record<string, number> = {};
  constraintIds.forEach((cid, i) => {
    const sp = maximize ? y[i] : -y[i];
    shadowPrices.push({ constraint_id: cid, shadow_price: sp });
    shadowById[cid] = sp;
  });

  const reducedCosts = varNames.map((name, j) => {
    let rc = reduced[j];
    if (!maximize) rc = -rc;
    return { variable: name, reduced_cost: rc };
  });

  const objectiveRanges: Record<string, unknown>[] = [];
  const rhsRanges: Record<string, unknown>[] = [];
  const constraintAnalysis: Record<string, unknown>[] = [];

  try {
    const nonbasic = [...Array(A[0].length).keys()].filter((j) => !basic.includes(j));
    for (let j = 0; j < nDecision; j++) {
      const coeff = cUser[j];
      let inc = INF;
      let dec = INF;
      if (!basic.includes(j)) {
        const rc = reduced[j];
        if (maximize) {
          inc = Math.max(0, -rc);
          dec = INF;
        } else {
          inc = INF;
          dec = Math.max(0, -rc);
        }
      } else {
        const row = basic.indexOf(j);
        inc = INF;
        dec = INF;
        for (const nj of nonbasic) {
          const aij = matvec(BInv, column(A, nj))[row];
          const rcN = reduced[nj];
          if (maximize) {
            if (aij > 1e-12) dec = Math.min(dec, rcN / aij);
            else if (aij < -1e-12) inc = Math.min(inc, rcN / aij);
          } else {
            if (aij > 1e-12) inc = Math.min(inc, -rcN / aij);
            else if (aij < -1e-12) dec = Math.min(dec, -rcN / aij);
          }
        }
        inc = Number.isFinite(inc) ? Math.max(0, Math.abs(inc)) : INF;
        dec = Number.isFinite(dec) ? Math.max(0, Math.abs(dec)) : INF;
      }
      const incF = Number.isFinite(inc) ? inc : INF;
      const decF = Number.isFinite(dec) ? dec : INF;
      objectiveRanges.push({
        variable: varNames[j],
        coeff,
        allowable_increase: incF,
        allowable_decrease: decF,
        min_coef: coeff - decF,
        max_coef: coeff + incF,
      });
    }

    const xB = matvec(BInv, bOriginal);
    constraintIds.forEach((cid, i) => {
      const col = BInv.map((row) => row[i]);
      let inc = INF;
      let dec = INF;
      for (let r = 0; r < basic.length; r++) {
        if (col[r] > 1e-12) dec = Math.min(dec, xB[r] / col[r]);
        else if (col[r] < -1e-12) inc = Math.min(inc, -xB[r] / col[r]);
      }
      const incF = Number.isFinite(inc) ? inc : INF;
      const decF = Number.isFinite(dec) ? dec : INF;
      rhsRanges.push({
        constraint_id: cid,
        rhs: bOriginal[i],
        allowable_increase: incF,
        allowable_decrease: decF,
      });
    });

    const consById = Object.fromEntries(constraints.map((c) => [c.id, c]));
    constraintIds.forEach((cid, i) => {
      const cons = consById[cid];
      if (!cons) return;
      const lhs = varNames.reduce((s, v) => s + (cons.coeffs[v] ?? 0) * (variables[v] ?? 0), 0);
      const sense = cons.sense;
      const userRhs = cons.rhs;
      let slack = 0;
      if (sense === "<=") slack = userRhs - lhs;
      else if (sense === ">=") slack = lhs - userRhs;
      else slack = Math.abs(lhs - userRhs);
      const rr = rhsRanges[i];
      const normRhs = Number(rr.rhs);
      const decF = Number(rr.allowable_decrease);
      const incF = Number(rr.allowable_increase);
      const normMin = normRhs - decF;
      const normMax = normRhs + incF;
      let dispMin = normMin;
      let dispMax = normMax;
      if (Math.abs(userRhs + normRhs) > 1e-6 && userRhs < 0) {
        dispMin = -normMax;
        dispMax = -normMin;
      }
      constraintAnalysis.push({
        constraint_id: cid,
        lhs,
        sense,
        rhs: userRhs,
        slack_or_surplus: slack,
        shadow_price: shadowById[cid] ?? 0,
        allowable_min_rhs: formatRhsBound(dispMin),
        allowable_max_rhs: formatRhsBound(dispMax),
      });
    });
  } catch {
    warnings.push("Partial sensitivity: ranging skipped due to numerical issues.");
  }

  return {
    shadow_prices: shadowPrices,
    reduced_costs: reducedCosts,
    objective_ranges: objectiveRanges,
    rhs_ranges: rhsRanges,
    constraint_analysis: constraintAnalysis,
  };
}
