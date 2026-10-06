import { describe, expect, it } from "vitest";
import { solve as lp } from "../src/modules/lp/solver";
import { solve as pert } from "../src/modules/pert_cpm/solver";
import { assertClose } from "./helpers";

type Act = {
  id: string;
  predecessors: string[];
  duration: number;
  crash_time: number;
  normal_cost: number;
  crash_cost: number;
};

/** Costo mínimo de acelerar hasta `target` (formulación de PL de Hillier). */
function lpCrashCost(acts: Act[], target: number): number | null {
  const objective: Record<string, number> = {};
  const constraints: { id: string; coeffs: Record<string, number>; sense: "<=" | ">="; rhs: number }[] = [];
  for (const a of acts) {
    const span = a.duration - a.crash_time;
    objective[`y_${a.id}`] = span > 0 ? (a.crash_cost - a.normal_cost) / span : 0;
    objective[`S_${a.id}`] = 0;
    constraints.push({ id: `u_${a.id}`, coeffs: { [`y_${a.id}`]: 1 }, sense: "<=", rhs: span });
    for (const p of a.predecessors) {
      const pa = acts.find((x) => x.id === p)!;
      constraints.push({
        id: `p_${p}_${a.id}`,
        coeffs: { [`S_${a.id}`]: 1, [`S_${p}`]: -1, [`y_${p}`]: 1 },
        sense: ">=",
        rhs: pa.duration,
      });
    }
    constraints.push({ id: `T_${a.id}`, coeffs: { [`S_${a.id}`]: 1, [`y_${a.id}`]: -1 }, sense: "<=", rhs: target - a.duration });
  }
  const res = lp({ sense: "min", objective, constraints, include_iterations: false, include_graph: false, include_sensitivity: false });
  return res.status === "optimal" ? res.solution.objective_value : null;
}

describe("aceleración de proyectos", () => {
  it("acelera la actividad de la ruta crítica, no la de un arco que no es crítico", () => {
    const acts: Act[] = [
      { id: "A", predecessors: [], duration: 7, crash_time: 4, normal_cost: 109, crash_cost: 112 },
      { id: "B", predecessors: ["A"], duration: 8, crash_time: 8, normal_cost: 118, crash_cost: 118 },
      { id: "C", predecessors: [], duration: 7, crash_time: 7, normal_cost: 143, crash_cost: 143 },
      { id: "D", predecessors: ["C"], duration: 6, crash_time: 6, normal_cost: 112, crash_cost: 112 },
      { id: "E", predecessors: ["D"], duration: 7, crash_time: 5, normal_cost: 115, crash_cost: 117 },
      { id: "F", predecessors: ["A", "D", "E"], duration: 3, crash_time: 2, normal_cost: 105, crash_cost: 110 },
      { id: "G", predecessors: ["A", "B", "C", "D"], duration: 3, crash_time: 3, normal_cost: 149, crash_cost: 149 },
    ];
    const res = pert({ activities: acts, mode: "cpm", crash: true, crash_target: 22 });
    expect(res.status).toBe("ok");
    expect(res.solution.metrics.crash_total_cost).toBe(1);
    expect(res.iterations![0].meta.activity).toBe("E");
  });

  it("coincide con el costo mínimo de la PL en 300 redes aleatorias", () => {
    let seed = 41;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let compared = 0;
    for (let k = 0; k < 300; k++) {
      const n = 4 + Math.floor(r() * 5);
      const acts: Act[] = Array.from({ length: n }, (_, i) => {
        const preds = Array.from({ length: i }, (_, j) => String.fromCharCode(65 + j)).filter(() => r() < 0.4);
        const d = 3 + Math.floor(r() * 8);
        const c = Math.max(1, d - Math.floor(r() * 4));
        const nc = 100 + Math.floor(r() * 50);
        return {
          id: String.fromCharCode(65 + i),
          predecessors: preds,
          duration: d,
          crash_time: c,
          normal_cost: nc,
          crash_cost: nc + (d - c) * (1 + Math.floor(r() * 9)),
        };
      });
      const t0 = pert({ activities: acts, mode: "cpm" }).solution.objective_value!;
      const target = Math.max(1, t0 - 1 - Math.floor(r() * 6));
      const greedy = pert({ activities: acts, mode: "cpm", crash: true, crash_target: target });
      const best = lpCrashCost(acts, target);
      if (best == null) {
        expect(greedy.status, `caso ${k}`).toBe("infeasible");
        continue;
      }
      expect(greedy.status, `caso ${k}`).toBe("ok");
      assertClose(greedy.solution.metrics.crash_total_cost, best, 1e-6);
      compared++;
    }
    expect(compared).toBeGreaterThan(100);
  });
});
