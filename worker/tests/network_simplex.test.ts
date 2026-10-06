import { describe, expect, it } from "vitest";
import { solve as lp } from "../src/modules/lp/solver";
import { solve } from "../src/modules/networks/solver";
import { assertClose } from "./helpers";

type Edge = { source: string; target: string; weight: number; capacity: number | null };

/** Costo mínimo por PL: min Σ c f, conservación de flujo y capacidades. */
function lpCost(nodes: string[], edges: Edge[], supply: Record<string, number>): number | null {
  const objective: Record<string, number> = {};
  const constraints: { id: string; coeffs: Record<string, number>; sense: "<=" | ">=" | "="; rhs: number }[] = [];
  edges.forEach((e, i) => {
    objective[`f${i}`] = e.weight;
    if (e.capacity != null) constraints.push({ id: `cap${i}`, coeffs: { [`f${i}`]: 1 }, sense: "<=", rhs: e.capacity });
  });
  const excess = Object.values(supply).reduce((a, b) => a + b, 0);
  for (const n of nodes) {
    const coeffs: Record<string, number> = {};
    edges.forEach((e, i) => {
      if (e.source === n) coeffs[`f${i}`] = (coeffs[`f${i}`] ?? 0) + 1;
      if (e.target === n) coeffs[`f${i}`] = (coeffs[`f${i}`] ?? 0) - 1;
    });
    const b = supply[n] ?? 0;
    constraints.push({ id: `b_${n}`, coeffs, sense: b > 0 && excess > 0 ? "<=" : "=", rhs: b });
  }
  const res = lp({ sense: "min", objective, constraints, include_iterations: false, include_graph: false, include_sensitivity: false });
  return res.status === "optimal" ? res.solution.objective_value : null;
}

describe("simplex de redes (flujo de costo mínimo)", () => {
  it("Distribution Unlimited (Hillier): costo 490", () => {
    const edges: Edge[] = [
      { source: "A", target: "B", weight: 2, capacity: 10 },
      { source: "A", target: "C", weight: 4, capacity: null },
      { source: "A", target: "D", weight: 9, capacity: null },
      { source: "B", target: "C", weight: 3, capacity: null },
      { source: "C", target: "E", weight: 1, capacity: 80 },
      { source: "D", target: "E", weight: 3, capacity: null },
      { source: "E", target: "D", weight: 2, capacity: null },
    ];
    const res = solve({
      problem: "transshipment",
      nodes: ["A", "B", "C", "D", "E"],
      edges,
      node_supply: { A: 50, B: 40, C: 0, D: -30, E: -60 },
    });
    expect(res.status).toBe("ok");
    expect(res.solution.metrics.total_cost).toBe(490);
    expect(res.solution.variables["C->E"]).toBe(80);
    expect(res.solution.variables["E->D"]).toBe(20);
    const steps = res.iterations!;
    expect(steps.length).toBeGreaterThan(1);
    expect(String(steps.at(-1)!.title)).toContain("óptima");
    expect(steps[0].meta.ciclo).toBeTruthy();
  });

  it("coincide con la PL en 300 redes aleatorias (con capacidades)", () => {
    let seed = 13;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let compared = 0;
    let infeasible = 0;
    for (let k = 0; k < 300; k++) {
      const n = 3 + Math.floor(r() * 4);
      const nodes = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
      const edges: Edge[] = [];
      for (const u of nodes) {
        for (const v of nodes) {
          if (u !== v && r() < 0.45) {
            edges.push({ source: u, target: v, weight: Math.floor(r() * 10), capacity: r() < 0.4 ? 1 + Math.floor(r() * 15) : null });
          }
        }
      }
      if (!edges.length) continue;
      const supply: Record<string, number> = Object.fromEntries(nodes.map((v) => [v, 0]));
      let total = 0;
      for (const v of nodes.slice(0, -1)) {
        supply[v] = Math.floor(r() * 21) - 8;
        total += supply[v];
      }
      supply[nodes[n - 1]] = -total + (r() < 0.3 ? Math.floor(r() * 5) : 0);
      const totalSupply = Object.values(supply).reduce((a, b) => a + b, 0);
      if (totalSupply < 0) continue;
      const ref = lpCost(nodes, edges, supply);
      const res = solve({ problem: "transshipment", nodes, edges, node_supply: supply });
      if (ref == null) {
        expect(res.status, `caso ${k}`).toBe("infeasible");
        infeasible++;
        continue;
      }
      expect(res.status, `caso ${k}`).toBe("ok");
      assertClose(res.solution.metrics.total_cost, ref, 1e-6);
      compared++;
    }
    expect(compared).toBeGreaterThan(100);
    expect(infeasible).toBeGreaterThan(5);
  });

  it("capacidades que no alcanzan: infactible con explicación", () => {
    const res = solve({
      problem: "transshipment",
      nodes: ["A", "B"],
      edges: [{ source: "A", target: "B", weight: 1, capacity: 3 }],
      node_supply: { A: 5, B: -5 },
    });
    expect(res.status).toBe("infeasible");
    expect(res.warnings[0]).toContain("No hay forma");
  });

  it("Dijkstra: tabla de iteraciones y distancias a todos los nodos", () => {
    const res = solve({
      problem: "shortest_path",
      nodes: ["O", "A", "B", "C", "T"],
      edges: [
        { source: "O", target: "A", weight: 2 },
        { source: "O", target: "B", weight: 5 },
        { source: "O", target: "C", weight: 4 },
        { source: "A", target: "B", weight: 2 },
        { source: "B", target: "C", weight: 1 },
        { source: "B", target: "T", weight: 7 },
        { source: "C", target: "T", weight: 9 },
      ],
      source: "O",
      sink: "T",
      directed: false,
    });
    expect(res.solution.metrics.path_length).toBe(11);
    const dist = res.tables!.find((t) => t.name === "distancias")!;
    expect(Object.fromEntries(dist.rows.map((r) => [r[0], r[1]]))).toEqual({ O: 0, A: 2, B: 4, C: 4, T: 11 });
    expect(res.iterations![0].title).toContain("A");
    expect(res.iterations).toHaveLength(4);
  });

  it("Seervada: avisa que hay dos rutas más cortas", () => {
    const res = solve({
      problem: "shortest_path",
      nodes: ["O", "A", "B", "C", "D", "E", "T"],
      edges: [
        { source: "O", target: "A", weight: 2 },
        { source: "O", target: "B", weight: 5 },
        { source: "O", target: "C", weight: 4 },
        { source: "A", target: "B", weight: 2 },
        { source: "A", target: "D", weight: 7 },
        { source: "B", target: "C", weight: 1 },
        { source: "B", target: "D", weight: 4 },
        { source: "B", target: "E", weight: 3 },
        { source: "C", target: "E", weight: 4 },
        { source: "D", target: "E", weight: 1 },
        { source: "D", target: "T", weight: 5 },
        { source: "E", target: "T", weight: 7 },
      ],
      source: "O",
      sink: "T",
      directed: false,
    });
    expect(res.solution.metrics.path_length).toBe(13);
    expect(res.warnings[0]).toContain("O → A → B → D → T");
    expect(res.warnings[0]).toContain("O → A → B → E → D → T");
  });

  it("flujo máximo en red no dirigida usa cada arista en ambos sentidos", () => {
    const res = solve({
      problem: "max_flow",
      nodes: ["S", "A", "T"],
      edges: [
        { source: "A", target: "S", weight: 0, capacity: 4 },
        { source: "T", target: "A", weight: 0, capacity: 3 },
      ],
      source: "S",
      sink: "T",
      directed: false,
    });
    expect(res.solution.metrics.max_flow).toBe(3);
  });
});
