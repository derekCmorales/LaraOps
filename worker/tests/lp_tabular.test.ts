import { describe, expect, it } from "vitest";
import { invert, matvec } from "../src/linalg";
import { solve } from "../src/modules/lp/solver";
import type { LPConstraint } from "../src/modules/lp/types";
import { assertClose } from "./helpers";

type Sense = "<=" | ">=" | "=";
type Model = {
  sense: "max" | "min";
  objective: Record<string, number>;
  constraints: LPConstraint[];
  variable_names: string[];
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Óptimo por enumeración de vértices (n restricciones activas entre las m + n). */
function bruteForce(model: Model): { status: "optimal" | "infeasible"; z: number | null } {
  const names = model.variable_names;
  const n = names.length;
  const rows: { a: number[]; b: number; sense: Sense }[] = model.constraints.map((c) => ({
    a: names.map((v) => c.coeffs[v] ?? 0),
    b: c.rhs,
    sense: c.sense,
  }));
  names.forEach((_, j) => rows.push({ a: names.map((__, k) => (k === j ? 1 : 0)), b: 0, sense: ">=" }));
  const c = names.map((v) => model.objective[v] ?? 0);
  let best: number | null = null;
  const pick: number[] = [];
  const rec = (start: number) => {
    if (pick.length === n) {
      const A = pick.map((i) => rows[i].a);
      let x: number[];
      try {
        x = matvec(invert(A), pick.map((i) => rows[i].b));
      } catch {
        return;
      }
      if (x.some((v) => !Number.isFinite(v))) return;
      const ok = rows.every((r) => {
        const lhs = r.a.reduce((s, a, j) => s + a * x[j], 0);
        if (r.sense === "<=") return lhs <= r.b + 1e-7;
        if (r.sense === ">=") return lhs >= r.b - 1e-7;
        return Math.abs(lhs - r.b) <= 1e-7;
      });
      if (!ok) return;
      const z = c.reduce((s, cj, j) => s + cj * x[j], 0);
      if (best == null || (model.sense === "max" ? z > best : z < best)) best = z;
      return;
    }
    for (let i = start; i < rows.length; i++) {
      pick.push(i);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
  return best == null ? { status: "infeasible", z: null } : { status: "optimal", z: best };
}

/** Problema acotado (caja x <= U) con restricciones mezcladas. */
function randomModel(r: () => number, withMixed: boolean): Model {
  const n = 2 + Math.floor(r() * 2);
  const m = 2 + Math.floor(r() * 3);
  const names = Array.from({ length: n }, (_, j) => `x${j + 1}`);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const constraints: LPConstraint[] = [];
  for (let i = 0; i < m; i++) {
    const coeffs: Record<string, number> = {};
    names.forEach((v) => {
      coeffs[v] = int(withMixed ? -2 : 0, 6);
    });
    let sense: Sense = "<=";
    if (withMixed) {
      const t = r();
      sense = t < 0.5 ? "<=" : t < 0.85 ? ">=" : "=";
    }
    constraints.push({ id: `R${i + 1}`, coeffs, sense, rhs: int(withMixed ? -4 : 2, 30) });
  }
  names.forEach((v) => constraints.push({ id: `U_${v}`, coeffs: { [v]: 1 }, sense: "<=", rhs: 20 }));
  const objective: Record<string, number> = {};
  names.forEach((v) => {
    objective[v] = int(-3, 9);
  });
  return { sense: r() < 0.5 ? "max" : "min", objective, constraints, variable_names: names };
}

function z(model: Model): number | null {
  const res = solve({ ...model, include_iterations: false, include_graph: false });
  return res.status === "optimal" ? res.solution.objective_value : null;
}

describe("simplex tabular", () => {
  it("coincide con la enumeración de vértices en 400 problemas (Gran M y dos fases)", () => {
    const r = rng(7);
    let infeasible = 0;
    for (let k = 0; k < 400; k++) {
      const model = randomModel(r, k % 2 === 1);
      const ref = bruteForce(model);
      for (const method of ["big_m", "two_phase"] as const) {
        const res = solve({ ...model, method, include_graph: false });
        if (ref.status === "infeasible") {
          expect(res.status, `caso ${k} ${method}`).toBe("infeasible");
        } else {
          expect(res.status, `caso ${k} ${method}`).toBe("optimal");
          assertClose(res.solution.objective_value ?? NaN, ref.z!, 1e-6);
          // Factibilidad de la solución reportada.
          for (const c of model.constraints) {
            const lhs = model.variable_names.reduce((s, v) => s + (c.coeffs[v] ?? 0) * res.solution.variables[v], 0);
            if (c.sense === "<=") expect(lhs).toBeLessThanOrEqual(c.rhs + 1e-6);
            if (c.sense === ">=") expect(lhs).toBeGreaterThanOrEqual(c.rhs - 1e-6);
            if (c.sense === "=") assertClose(lhs, c.rhs, 1e-6);
          }
        }
      }
      if (ref.status === "infeasible") infeasible++;
    }
    expect(infeasible).toBeGreaterThan(10);
  });

  it("dualidad fuerte: W* = Z* y holgura complementaria", () => {
    const r = rng(11);
    for (let k = 0; k < 150; k++) {
      const model = randomModel(r, k % 2 === 1);
      const res = solve({ ...model, include_graph: false });
      if (res.status !== "optimal") continue;
      assertClose(res.solution.metrics.dual_objective, res.solution.objective_value!, 1e-6);
      const sol = res.tables!.find((t) => t.name === "dual_solucion")!;
      for (const row of sol.rows) assertClose(Number(row[4]), 0, 1e-6);
      const cons = res.tables!.find((t) => t.name === "dual_restricciones")!;
      for (const row of cons.rows) assertClose(Number(row[5]), 0, 1e-6);
    }
  });

  it("los precios sombra son la derivada de Z respecto al LD", () => {
    const r = rng(23);
    let checked = 0;
    for (let k = 0; k < 150; k++) {
      const model = randomModel(r, k % 2 === 1);
      const res = solve({ ...model, include_graph: false });
      if (res.status !== "optimal") continue;
      const analysis = res.sensitivity!.constraint_analysis;
      model.constraints.forEach((c, i) => {
        const row = analysis.find((a) => a.constraint_id === c.id)!;
        const lo = Number(row.allowable_min_rhs);
        const hi = Number(row.allowable_max_rhs);
        const sp = Number(row.shadow_price);
        // Movimiento pequeño dentro del rango de factibilidad.
        const room = Math.min(Number.isFinite(hi) ? hi - c.rhs : 1, 1);
        if (!(room > 1e-3)) return;
        const delta = room / 2;
        const moved = { ...model, constraints: model.constraints.map((cc, ii) => (ii === i ? { ...cc, rhs: cc.rhs + delta } : cc)) };
        const z2 = z(moved);
        expect(z2).not.toBeNull();
        assertClose(z2!, res.solution.objective_value! + sp * delta, 1e-6);
        void lo;
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("los rangos de optimalidad dejan el valor de la solución actual como óptimo", () => {
    const r = rng(5);
    let inside = 0;
    let outside = 0;
    for (let k = 0; k < 150; k++) {
      const model = randomModel(r, k % 2 === 1);
      const res = solve({ ...model, include_graph: false });
      if (res.status !== "optimal") continue;
      const x = res.solution.variables;
      const degenerate = res.warnings.some((w) => /^(Degeneración|Óptimos múltiples|Empate en la razón)/.test(w));
      for (const range of res.sensitivity!.objective_ranges) {
        const v = String(range.variable);
        const lo = typeof range.min_coef === "number" ? range.min_coef : null;
        const hi = typeof range.max_coef === "number" ? range.max_coef : null;
        const at = (coef: number) => {
          const obj = { ...model.objective, [v]: coef };
          const zz = z({ ...model, objective: obj });
          const zx = model.variable_names.reduce((s, name) => s + (obj[name] ?? 0) * x[name], 0);
          return { zz: zz!, zx };
        };
        for (const edge of [lo, hi]) {
          if (edge == null) continue;
          const coef = Number(range.coeff);
          const span = Math.abs(edge - coef);
          if (span < 1e-6) continue;
          // Dentro del rango la solución actual sigue siendo óptima.
          const mid = at(coef + (edge - coef) * 0.5);
          assertClose(mid.zz, mid.zx, 1e-6);
          inside++;
          // Fuera del rango existe una solución estrictamente mejor (si el vértice no es
          // degenerado; en uno degenerado el rango de la base es conservador).
          if (degenerate) continue;
          const out = at(edge + Math.sign(edge - coef) * 0.5);
          const better = model.sense === "max" ? out.zz - out.zx : out.zx - out.zz;
          expect(better).toBeGreaterThan(1e-7);
          outside++;
        }
      }
    }
    expect(inside).toBeGreaterThan(100);
    expect(outside).toBeGreaterThan(60);
  });

  it("rangos de LD: dentro del rango Z cambia al ritmo del precio sombra", () => {
    const r = rng(31);
    let checked = 0;
    for (let k = 0; k < 150; k++) {
      const model = randomModel(r, k % 2 === 1);
      const res = solve({ ...model, include_graph: false });
      if (res.status !== "optimal") continue;
      for (const row of res.sensitivity!.constraint_analysis) {
        const i = model.constraints.findIndex((c) => c.id === row.constraint_id);
        const c = model.constraints[i];
        const sp = Number(row.shadow_price);
        for (const edge of [row.allowable_min_rhs, row.allowable_max_rhs]) {
          if (typeof edge !== "number") continue;
          const target = c.rhs + (edge - c.rhs) * 0.9;
          if (Math.abs(target - c.rhs) < 1e-6) continue;
          const moved = { ...model, constraints: model.constraints.map((cc, ii) => (ii === i ? { ...cc, rhs: target } : cc)) };
          const z2 = z(moved);
          expect(z2, `caso ${k} ${c.id}`).not.toBeNull();
          assertClose(z2!, res.solution.objective_value! + sp * (target - c.rhs), 1e-6);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("Wyndor (Hillier): tablas, pivotes y Z = 36", () => {
    const res = solve({
      sense: "max",
      objective: { x1: 3, x2: 5 },
      constraints: [
        { id: "R1", coeffs: { x1: 1 }, sense: "<=", rhs: 4 },
        { id: "R2", coeffs: { x2: 2 }, sense: "<=", rhs: 12 },
        { id: "R3", coeffs: { x1: 3, x2: 2 }, sense: "<=", rhs: 18 },
      ],
    });
    expect(res.status).toBe("optimal");
    expect(res.solution.objective_value).toBe(36);
    expect(res.solution.variables).toEqual({ x1: 2, x2: 6 });
    const steps = res.iterations!;
    expect(steps).toHaveLength(3);
    expect(steps[0].meta.enter).toBe("x2");
    expect(steps[0].meta.leave).toBe("s2");
    expect(steps[0].meta.ratios).toEqual([null, 6, 9]);
    expect(steps[1].meta.enter).toBe("x1");
    expect(steps[1].meta.leave).toBe("s3");
    expect(steps[1].meta.operations).toEqual(["R2 ← R2 ÷ 2", "R0 ← R0 + 5·R2", "R3 ← R3 - 2·R2"]);
    // Fila Z final de Hillier: 0, 0, 0, 3/2, 1 | 36
    const last = steps[2].tableau!;
    expect(last[1].slice(2)).toEqual([0, 0, 0, 1.5, 1, 36]);
    expect(steps[2].meta.kind).toBe("optimal");
    const sp = Object.fromEntries(res.sensitivity!.shadow_prices.map((s) => [s.constraint_id, s.shadow_price]));
    expect(sp).toEqual({ R1: 0, R2: 1.5, R3: 1 });
    expect(res.solution.metrics.iterations).toBe(2);
  });

  it("Terapia de radiación (Hillier) con Gran M: fila Z ajustada 1.1M - 0.4", () => {
    const model = {
      sense: "min" as const,
      objective: { x1: 0.4, x2: 0.5 },
      constraints: [
        { id: "R1", coeffs: { x1: 0.3, x2: 0.1 }, sense: "<=" as const, rhs: 2.7 },
        { id: "R2", coeffs: { x1: 0.5, x2: 0.5 }, sense: "=" as const, rhs: 6 },
        { id: "R3", coeffs: { x1: 0.6, x2: 0.4 }, sense: ">=" as const, rhs: 6 },
      ],
    };
    const res = solve({ ...model, method: "big_m" });
    expect(res.status).toBe("optimal");
    assertClose(res.solution.objective_value!, 5.25);
    assertClose(res.solution.variables.x1, 7.5);
    assertClose(res.solution.variables.x2, 4.5);
    const steps = res.iterations!;
    expect(steps[0].meta.kind).toBe("adjust");
    expect(steps[0].tableau![0]).toEqual(["Básica", "Z", "x1", "x2", "s1", "a2", "e3", "a3", "LD"]);
    // Sin ajustar: -0.4, -0.5 y -M en las artificiales.
    expect(steps[0].tableau![1].slice(2, 8)).toEqual([-0.4, -0.5, 0, "-M", 0, "-M"]);
    // Ajustada: x1 -> 1.1M - 0.4, x2 -> 0.9M - 0.5, e3 -> -M; Z = 12M.
    expect(steps[1].tableau![1].slice(2, 9)).toEqual(["1.1M - 0.4", "0.9M - 0.5", 0, 0, "-M", 0, "12M"]);
    expect(steps[1].meta.operations).toEqual(["R0 ← R0 + M·R2", "R0 ← R0 + M·R3"]);
    expect(steps[1].meta.enter).toBe("x1");
    expect(steps[1].meta.leave).toBe("s1");

    const twoPhase = solve({ ...model, method: "two_phase" });
    assertClose(twoPhase.solution.objective_value!, 5.25);
    expect(twoPhase.iterations!.some((s) => String(s.title).startsWith("Fase II"))).toBe(true);
  });

  it("Beale: detecta el ciclaje y termina con la regla de Bland", () => {
    const res = solve({
      sense: "max",
      objective: { x1: 0.75, x2: -20, x3: 0.5, x4: -6 },
      constraints: [
        { id: "R1", coeffs: { x1: 0.25, x2: -8, x3: -1, x4: 9 }, sense: "<=", rhs: 0 },
        { id: "R2", coeffs: { x1: 0.5, x2: -12, x3: -0.5, x4: 3 }, sense: "<=", rhs: 0 },
        { id: "R3", coeffs: { x3: 1 }, sense: "<=", rhs: 1 },
      ],
    });
    expect(res.status).toBe("optimal");
    assertClose(res.solution.objective_value!, 1.25);
    expect(res.warnings.some((w) => w.startsWith("Ciclaje"))).toBe(true);
  });

  it("LD negativo: precio sombra y rango en los términos del usuario", () => {
    const res = solve({
      sense: "min",
      objective: { x1: 1, x2: 2 },
      constraints: [
        { id: "R1", coeffs: { x1: -1, x2: -1 }, sense: "<=", rhs: -2 },
        { id: "R2", coeffs: { x1: 1 }, sense: "<=", rhs: 10 },
      ],
    });
    const r1 = res.sensitivity!.constraint_analysis.find((r) => r.constraint_id === "R1")!;
    // -x1 - x2 <= -3 obliga a x1 + x2 >= 3: Z sube 1 cuando el LD baja 1.
    expect(r1.shadow_price).toBe(-1);
    expect(r1.allowable_min_rhs).toBe(-10);
    expect(r1.allowable_max_rhs).toBe(0);
    const std = res.tables!.find((t) => t.name === "forma_estandar")!;
    expect(String(std.rows[1][2])).toContain("multiplicó por -1");
  });

  it("óptimos múltiples con holgura: reporta la solución alterna", () => {
    const res = solve({
      sense: "max",
      objective: { x1: 1, x2: 1 },
      constraints: [
        { id: "R1", coeffs: { x1: 1, x2: 1 }, sense: "<=", rhs: 4 },
        { id: "R2", coeffs: { x1: 1 }, sense: "<=", rhs: 3 },
      ],
    });
    expect(res.warnings.some((w) => w.startsWith("Óptimos múltiples"))).toBe(true);
    const alt = res.tables!.find((t) => t.name === "solucion_alternativa")!;
    const x = Object.fromEntries(alt.rows.map((r) => [r[0], [r[1], r[2]]]));
    expect(x.x1).toEqual([3, 0]);
    expect(x.x2).toEqual([1, 4]);
    expect(res.iterations!.at(-1)!.meta.kind).toBe("alternative");
  });

  it("empates en la razón mínima y en la variable que entra", () => {
    const res = solve({
      sense: "max",
      objective: { x1: 2, x2: 2 },
      constraints: [
        { id: "R1", coeffs: { x1: 1 }, sense: "<=", rhs: 4 },
        { id: "R2", coeffs: { x1: 2, x2: 1 }, sense: "<=", rhs: 8 },
        { id: "R3", coeffs: { x2: 1 }, sense: "<=", rhs: 6 },
      ],
    });
    expect(res.status).toBe("optimal");
    expect(res.iterations![0].meta.entering_ties).toEqual(["x1", "x2"]);
    expect(res.iterations![0].meta.leaving_ties).toEqual(["s1", "s2"]);
    expect(res.warnings.some((w) => w.startsWith("Empate en la razón mínima"))).toBe(true);
    expect(res.warnings.some((w) => w.startsWith("Empate en la variable que entra"))).toBe(true);
  });

  it("método algebraico: lista las soluciones básicas y marca la óptima", () => {
    const res = solve({
      sense: "max",
      objective: { x1: 3, x2: 5 },
      constraints: [
        { id: "R1", coeffs: { x1: 1 }, sense: "<=", rhs: 4 },
        { id: "R2", coeffs: { x2: 2 }, sense: "<=", rhs: 12 },
        { id: "R3", coeffs: { x1: 3, x2: 2 }, sense: "<=", rhs: 18 },
      ],
    });
    const t = res.tables!.find((tt) => tt.name === "soluciones_basicas")!;
    // C(5,3) = 10 combinaciones; 5 factibles (los vértices de Wyndor).
    expect(t.rows).toHaveLength(10);
    const feasible = t.rows.filter((r) => String(r[r.length - 2]).startsWith("sí"));
    expect(feasible).toHaveLength(5);
    const opt = t.rows.filter((r) => r[r.length - 2] === "sí (óptima)");
    expect(opt).toHaveLength(1);
    expect(opt[0][opt[0].length - 1]).toBe(36);
  });

  it("problema dual de Wyndor", () => {
    const res = solve({
      sense: "max",
      objective: { x1: 3, x2: 5 },
      constraints: [
        { id: "R1", coeffs: { x1: 1 }, sense: "<=", rhs: 4 },
        { id: "R2", coeffs: { x2: 2 }, sense: "<=", rhs: 12 },
        { id: "R3", coeffs: { x1: 3, x2: 2 }, sense: "<=", rhs: 18 },
      ],
    });
    const model = res.tables!.find((t) => t.name === "dual_modelo")!;
    expect(model.rows.map((r) => r[1])).toEqual([
      "Min W = 4y1 + 12y2 + 18y3",
      "y1 + 3y3 ≥ 3",
      "2y2 + 2y3 ≥ 5",
      "y1 ≥ 0, y2 ≥ 0, y3 ≥ 0",
    ]);
    expect(res.solution.metrics.dual_objective).toBe(36);
  });

  it("dual de un problema de minimizar con restricciones mixtas", () => {
    const res = solve({
      sense: "min",
      objective: { x1: 0.4, x2: 0.5 },
      constraints: [
        { id: "R1", coeffs: { x1: 0.3, x2: 0.1 }, sense: "<=", rhs: 2.7 },
        { id: "R2", coeffs: { x1: 0.5, x2: 0.5 }, sense: "=", rhs: 6 },
        { id: "R3", coeffs: { x1: 0.6, x2: 0.4 }, sense: ">=", rhs: 6 },
      ],
    });
    const model = res.tables!.find((t) => t.name === "dual_modelo")!;
    expect(model.rows[0][1]).toBe("Max W = 2.7y1 + 6y2 + 6y3");
    expect(model.rows[3][1]).toBe("y1 ≤ 0, y2 libre, y3 ≥ 0");
    assertClose(res.solution.metrics.dual_objective, 5.25);
  });

  it("infactible y no acotado traen explicación y gráfico", () => {
    const inf = solve({
      sense: "max",
      objective: { x1: 1, x2: 1 },
      constraints: [
        { id: "R1", coeffs: { x1: 1, x2: 1 }, sense: "<=", rhs: 2 },
        { id: "R2", coeffs: { x1: 1, x2: 1 }, sense: ">=", rhs: 5 },
      ],
    });
    expect(inf.status).toBe("infeasible");
    expect(inf.warnings[0]).toContain("a2");
    expect(inf.graph).toBeTruthy();
    expect(inf.iterations!.at(-1)!.meta.kind).toBe("infeasible");

    const unb = solve({
      sense: "max",
      objective: { x1: 1, x2: 2 },
      constraints: [{ id: "R1", coeffs: { x1: 1, x2: -1 }, sense: "<=", rhs: 2 }],
    });
    expect(unb.status).toBe("unbounded");
    expect(unb.warnings[0]).toContain("x2");
    expect(unb.graph).toBeTruthy();
  });

  it("cotas de variables se respetan", () => {
    const res = solve({
      sense: "max",
      objective: { x1: 1, x2: 1 },
      constraints: [{ id: "R1", coeffs: { x1: 1, x2: 1 }, sense: "<=", rhs: 10 }],
      bounds: { x1: [1, 3], x2: [0, 2] },
    });
    expect(res.solution.variables).toEqual({ x1: 3, x2: 2 });
    expect(() =>
      solve({ sense: "max", objective: { x1: 1 }, constraints: [], bounds: { x1: [null, 3] } }),
    ).toThrow(/no negativas/);
  });

  it("sin restricciones: minimizar con costos positivos da 0", () => {
    expect(solve({ sense: "min", objective: { x: 2 }, constraints: [] }).status).toBe("optimal");
    expect(solve({ sense: "max", objective: { x: 2 }, constraints: [] }).status).toBe("unbounded");
  });
});
