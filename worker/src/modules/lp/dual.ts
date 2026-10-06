import type { NamedTable } from "../../schema";
import { fmtPlain, snap } from "./mnum";
import type { LPConstraint } from "./types";

function term(coef: number, name: string, first: boolean): string {
  const c = snap(coef);
  if (c === 0) return "";
  const mag = Math.abs(c);
  const body = mag === 1 ? name : `${fmtPlain(mag)}${name}`;
  if (first) return c < 0 ? `-${body}` : body;
  return c < 0 ? ` - ${body}` : ` + ${body}`;
}

export function linearText(coeffs: number[], names: string[]): string {
  let out = "";
  coeffs.forEach((c, i) => {
    out += term(c, names[i], out === "");
  });
  return out || "0";
}

export type DualOutput = {
  tables: NamedTable[];
  dualObjective: number | null;
};

/**
 * Problema dual (reglas SOB: sensato, raro, bizarro) y, si hay óptimo, su solución:
 * y_i = precio sombra de la restricción i y W* = Z*.
 */
export function buildDual(args: {
  sense: "max" | "min";
  varNames: string[];
  costs: number[];
  constraints: LPConstraint[];
  shadow: Map<string, number> | null;
  reduced: Map<string, number> | null;
  slacks: Map<string, number> | null;
  values: Record<string, number> | null;
}): DualOutput {
  const { sense, varNames, costs, constraints, shadow, reduced, slacks, values } = args;
  const maximize = sense === "max";
  const yNames = constraints.map((_, i) => `y${i + 1}`);
  const rhs = constraints.map((c) => c.rhs);

  const signOf = (c: LPConstraint): string => {
    if (c.sense === "=") return "libre";
    const natural = maximize ? c.sense === "<=" : c.sense === ">=";
    return natural ? "≥ 0" : "≤ 0";
  };
  const dualSense = maximize ? "Min" : "Max";
  const rows: (string | number)[][] = [
    ["Función objetivo", `${dualSense} W = ${linearText(rhs, yNames)}`],
  ];
  varNames.forEach((v, j) => {
    const coeffs = constraints.map((c) => c.coeffs[v] ?? 0);
    rows.push([`Restricción de ${v}`, `${linearText(coeffs, yNames)} ${maximize ? "≥" : "≤"} ${fmtPlain(costs[j])}`]);
  });
  rows.push([
    "Signo de las variables duales",
    constraints.map((c, i) => `${yNames[i]} ${signOf(c)}`).join(", "),
  ]);
  const tables: NamedTable[] = [{ name: "dual_modelo", columns: ["parte", "expresion"], rows }];

  if (!shadow) return { tables, dualObjective: null };

  const y = constraints.map((c) => shadow.get(c.id) ?? 0);
  const dualObjective = snap(y.reduce((s, yi, i) => s + yi * rhs[i], 0));
  tables.push({
    name: "dual_solucion",
    columns: ["variable_dual", "restriccion_primal", "valor_dual", "holgura_primal", "producto"],
    rows: constraints.map((c, i) => {
      const slack = slacks?.get(c.id) ?? 0;
      return [yNames[i], c.id, y[i], slack, snap(y[i] * slack)];
    }),
  });
  tables.push({
    name: "dual_restricciones",
    columns: ["variable_primal", "lado_izquierdo_dual", "costo", "holgura_dual", "valor_primal", "producto"],
    rows: varNames.map((v, j) => {
      const lhs = snap(constraints.reduce((s, c, i) => s + (c.coeffs[v] ?? 0) * y[i], 0));
      const rc = reduced?.get(v) ?? 0;
      // Holgura dual = |cj - zj|; en el óptimo es >= 0 y vale 0 para las variables básicas.
      const surplus = snap(Math.abs(rc));
      const x = values?.[v] ?? 0;
      return [v, lhs, costs[j], surplus, x, snap(x * surplus)];
    }),
  });
  return { tables, dualObjective };
}
