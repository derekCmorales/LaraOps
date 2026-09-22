import { describe, expect, it } from "vitest";
import { solve } from "../src/modules/lp/solver";
import { assertClose, assertCloseMap, loadFixture } from "./helpers";

const ATOL = 1e-4;

describe("lp", () => {
  it("product mix textbook", () => {
    const data = loadFixture("lp_01.json");
    const result = solve(data.request);
    const expectData = data.expect as { objective_value: number; variables: Record<string, number> };
    expect(result.status).toBe("optimal");
    expect(result.module).toBe("linear_programming");
    assertClose(result.solution.objective_value ?? NaN, expectData.objective_value, ATOL);
    assertCloseMap(result.solution.variables, expectData.variables, ATOL);
    expect(result.iterations?.length).toBeGreaterThan(0);
    expect(result.sensitivity).toBeTruthy();
    expect(result.sensitivity!.shadow_prices).toHaveLength(3);
    expect(result.sensitivity!.constraint_analysis).toHaveLength(3);
    const byId = Object.fromEntries(
      result.sensitivity!.constraint_analysis.map((r) => [String(r.constraint_id), r]),
    );
    assertClose(Number(byId.c1.lhs), 100, ATOL);
    assertClose(Number(byId.c1.slack_or_surplus), 0, ATOL);
    expect(Number(byId.c1.shadow_price)).toBeGreaterThan(0);
    assertClose(Number(byId.c3.lhs), 20, ATOL);
    assertClose(Number(byId.c3.slack_or_surplus), 20, ATOL);
    expect(Math.abs(Number(byId.c3.shadow_price))).toBeLessThan(1e-8);
  });

  it("infeasible fixture", () => {
    const data = loadFixture("lp_infeasible.json");
    expect(solve(data.request).status).toBe("infeasible");
  });

  it("unbounded fixture", () => {
    const data = loadFixture("lp_unbounded.json");
    expect(solve(data.request).status).toBe("unbounded");
  });

  it("empty constraints unbounded", () => {
    const result = solve({ sense: "max", objective: { x: 1 }, constraints: [] });
    expect(result.status).toBe("unbounded");
  });

  it("contradictory constraints infeasible", () => {
    const result = solve({
      sense: "max",
      objective: { x: 1 },
      constraints: [
        { id: "c1", coeffs: { x: 1 }, sense: "<=", rhs: 1 },
        { id: "c2", coeffs: { x: 1 }, sense: ">=", rhs: 2 },
      ],
    });
    expect(result.status).toBe("infeasible");
  });

  it("equality phase I artificial in basis", () => {
    const result = solve({
      sense: "min",
      objective: { x1: 2, x2: 6, x3: 6, x4: 2, x5: 1, x6: 2, x7: 5, x8: 7 },
      constraints: [
        { id: "R1", coeffs: { x1: 1, x2: 1, x3: 1, x4: 1 }, sense: "=", rhs: 5000 },
        { id: "R2", coeffs: { x5: 1, x6: 1, x7: 1, x8: 1 }, sense: "=", rhs: 1600 },
        { id: "R3", coeffs: { x1: 1, x5: 1 }, sense: "=", rhs: 1400 },
        { id: "R4", coeffs: { x2: 1, x6: 1 }, sense: "=", rhs: 3200 },
        { id: "R5", coeffs: { x3: 1, x7: 1 }, sense: "=", rhs: 2000 },
        { id: "R6", coeffs: { x4: 1, x8: 1 }, sense: "=", rhs: 0 },
      ],
      variable_names: ["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"],
    });
    expect(result.status).toBe("optimal");
    assertClose(result.solution.objective_value ?? NaN, 27600, ATOL);
  });

  it("two-constraint intersection and vertices table", () => {
    const result = solve({
      sense: "max",
      objective: { A: 2, B: 3 },
      constraints: [
        { id: "R1", coeffs: { A: 1, B: 3 }, sense: "<=", rhs: 6 },
        { id: "R2", coeffs: { A: 5, B: 3 }, sense: "<=", rhs: 15 },
      ],
    });
    expect(result.status).toBe("optimal");
    assertClose(result.solution.objective_value ?? NaN, 8.25, ATOL);
    assertCloseMap(result.solution.variables, { A: 2.25, B: 1.25 }, ATOL);
    const table = result.tables?.find((t) => t.name === "vertices_feasible");
    expect(table).toBeTruthy();
    const intersection = table!.rows.find(
      (row) => Math.abs(Number(row[0]) - 2.25) < ATOL && Math.abs(Number(row[1]) - 1.25) < ATOL,
    );
    expect(intersection).toBeTruthy();
    expect(String(intersection![3])).toContain("R1");
    expect(String(intersection![3])).toContain("R2");
    const optIdx = table!.columns.indexOf("optimo");
    expect(String(intersection![optIdx]).toLowerCase()).toMatch(/sí|si|yes|1/);
  });

  it("draws a 3D polyhedron for three variables", () => {
    const result = solve({
      sense: "max",
      objective: { x: 1, y: 1, z: 1 },
      constraints: [
        { id: "Rx", coeffs: { x: 1 }, sense: "<=", rhs: 1 },
        { id: "Ry", coeffs: { y: 1 }, sense: "<=", rhs: 1 },
        { id: "Rz", coeffs: { z: 1 }, sense: "<=", rhs: 1 },
      ],
      variable_names: ["x", "y", "z"],
    });
    expect(result.status).toBe("optimal");
    const graph = result.graph;
    if (!graph || graph.type !== "xy") throw new Error("se esperaba un gráfico xy");
    expect(graph.kind).toBe("lp3d");
    expect(graph.z_label).toBe("z");
    const vertices = graph.series.find((s) => s.name === "vertices");
    const meta = (vertices?.meta as { x: number; y: number; z: number }[] | undefined) ?? [];
    expect(meta).toHaveLength(8);
    const table = result.tables?.find((t) => t.name === "vertices_feasible");
    expect(table?.columns.slice(0, 4)).toEqual(["x", "y", "z", "Z"]);
    const marked = table?.rows.filter((row) => row[row.length - 1] === "sí");
    expect(marked).toHaveLength(1);
  });

  it("slices four variables through the optimum", () => {
    const result = solve({
      sense: "max",
      objective: { x: 3, y: 2, z: 1, w: 4 },
      constraints: [
        { id: "R1", coeffs: { x: 1, y: 1, z: 1, w: 1 }, sense: "<=", rhs: 6 },
        { id: "Rx", coeffs: { x: 1 }, sense: "<=", rhs: 2 },
        { id: "Ry", coeffs: { y: 1 }, sense: "<=", rhs: 2 },
        { id: "Rz", coeffs: { z: 1 }, sense: "<=", rhs: 2 },
        { id: "Rw", coeffs: { w: 1 }, sense: "<=", rhs: 2 },
      ],
      variable_names: ["x", "y", "z", "w"],
      graph_variables: ["x", "y", "z"],
    });
    const graph = result.graph;
    if (!graph || graph.type !== "xy") throw new Error("se esperaba un gráfico xy");
    expect(graph.kind).toBe("lp3d");
    expect(graph.title).toBe("Corte 3D por el óptimo");
    expect(graph.subtitle ?? "").toContain("w = 2");
    assertClose(result.solution.objective_value ?? NaN, 18, ATOL);
  });
});
