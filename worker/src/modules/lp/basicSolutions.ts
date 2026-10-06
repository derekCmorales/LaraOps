import { columns, invert, matvec } from "../../linalg";
import type { NamedTable } from "../../schema";
import { snap } from "./mnum";
import type { StdForm } from "./simplex";

export const BASIC_SOLUTIONS_MAX = 300;

function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

function* combinations(n: number, k: number): Generator<number[]> {
  const idx = Array.from({ length: k }, (_, i) => i);
  if (k > n) return;
  while (true) {
    yield idx.slice();
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

/**
 * Método algebraico: todas las soluciones básicas de la forma estándar (sin artificiales).
 * Se fijan en 0 las no básicas y se resuelve el sistema para las básicas. Las factibles son
 * los vértices de la región factible.
 */
export function basicSolutionsTable(
  form: StdForm,
  costs: number[],
  optimum: number | null,
): { table: NamedTable | null; note: string | null } {
  const cols = form.colNames.map((_, j) => j).filter((j) => form.kinds[j] !== "artificial");
  const m = form.A.length;
  const n = cols.length;
  if (m === 0 || m > n) return { table: null, note: null };
  const total = binom(n, m);
  if (total > BASIC_SOLUTIONS_MAX) {
    return {
      table: null,
      note: `El método algebraico tendría ${total} combinaciones de ${m} variables básicas entre ${n}; solo se lista con ${BASIC_SOLUTIONS_MAX} o menos.`,
    };
  }
  const names = cols.map((j) => form.colNames[j]);
  const rows: (string | number)[][] = [];
  let k = 0;
  for (const pick of combinations(n, m)) {
    k++;
    const basis = pick.map((p) => cols[p]);
    let xB: number[];
    try {
      const B = columns(form.A, basis);
      xB = matvec(invert(B), form.b).map(snap);
      if (xB.some((v) => !Number.isFinite(v))) throw new Error("singular");
    } catch {
      rows.push([k, pick.map((p) => names[p]).join(", "), ...names.map(() => "—"), "sin solución única", "—"]);
      continue;
    }
    const x = Array(n).fill(0);
    pick.forEach((p, i) => {
      x[p] = xB[i];
    });
    const feasible = xB.every((v) => v >= -1e-9);
    const z = snap(cols.reduce((s, j, p) => s + (j < form.nDecision ? costs[j] * x[p] : 0), 0));
    const isOpt = feasible && optimum != null && Math.abs(z - optimum) <= 1e-7 * Math.max(1, Math.abs(optimum));
    rows.push([
      k,
      pick.map((p) => names[p]).join(", "),
      ...x,
      feasible ? (isOpt ? "sí (óptima)" : "sí") : "no",
      feasible ? z : "—",
    ]);
  }
  return {
    table: { name: "soluciones_basicas", columns: ["solucion", "basicas", ...names, "factible", "Z"], rows },
    note: null,
  };
}
