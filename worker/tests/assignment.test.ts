import { describe, expect, it } from "vitest";
import { linearSumAssignment, solve } from "../src/modules/assignment/solver";
import { SolverError } from "../src/errors";
import { assertClose } from "./helpers";

function bruteMin(costs: number[][]): number {
  const n = costs.length;
  const used = new Array(n).fill(false);
  let best = Number.POSITIVE_INFINITY;
  function rec(row: number, acc: number) {
    if (row === n) {
      best = Math.min(best, acc);
      return;
    }
    for (let col = 0; col < n; col++) {
      if (used[col]) continue;
      used[col] = true;
      rec(row + 1, acc + costs[row][col]);
      used[col] = false;
    }
  }
  rec(0, 0);
  return best;
}

describe("assignment", () => {
  it("matches hungarian optimum on 3x3 textbook", () => {
    const costs = [
      [9, 2, 7],
      [6, 4, 3],
      [5, 8, 1],
    ];
    const result = solve({
      agents: ["A", "B", "C"],
      tasks: ["X", "Y", "Z"],
      costs,
      sense: "min",
    });
    expect(result.status).toBe("optimal");
    expect(result.module).toBe("assignment");
    assertClose(result.solution.objective_value ?? NaN, 9, 1e-6);
    expect(result.solution.variables["A->Y"]).toBe(1);
    expect(result.solution.variables["B->X"]).toBe(1);
    expect(result.solution.variables["C->Z"]).toBe(1);
    expect(result.solution.metrics.n_assignments).toBe(3);
    expect(result.iterations?.some((s) => s.method === "hungarian")).toBe(true);
    expect(result.graph?.type).toBe("matrix");
  });

  it("matches brute-force on random 4x4", () => {
    const costs = [
      [14, 5, 8, 7],
      [2, 12, 6, 5],
      [7, 8, 3, 9],
      [2, 4, 6, 10],
    ];
    const { rows, cols } = linearSumAssignment(costs);
    const got = rows.reduce((s, r, i) => s + costs[r][cols[i]], 0);
    assertClose(got, bruteMin(costs), 1e-9);
  });

  it("pads non-square matrices", () => {
    const result = solve({
      agents: ["A", "B"],
      tasks: ["X"],
      costs: [[1], [2]],
    });
    expect(result.status).toBe("optimal");
    expect(result.warnings.some((w) => w.includes("no cuadrada"))).toBe(true);
    expect(result.solution.metrics.n_assignments).toBe(1);
    expect(result.solution.variables["A->X"]).toBe(1);
    assertClose(result.solution.objective_value ?? NaN, 1, 1e-6);
  });

  it("maximizes payoff", () => {
    const result = solve({
      agents: ["A", "B", "C"],
      tasks: ["X", "Y", "Z"],
      costs: [
        [9, 2, 7],
        [6, 4, 3],
        [5, 8, 1],
      ],
      sense: "max",
    });
    expect(result.solution.objective_sense).toBe("max");
    assertClose(result.solution.objective_value ?? NaN, 21, 1e-6);
    expect(result.solution.variables["A->Z"]).toBe(1);
    expect(result.solution.variables["B->X"]).toBe(1);
    expect(result.solution.variables["C->Y"]).toBe(1);
  });

  it("forbids a pair", () => {
    const result = solve({
      agents: ["A", "B", "C"],
      tasks: ["X", "Y", "Z"],
      costs: [
        [9, 2, 7],
        [6, 4, 3],
        [5, 8, 1],
      ],
      forbidden_assignments: [["A", "Y"]],
    });
    expect(result.warnings.some((w) => w.includes("A->Y"))).toBe(true);
    expect(result.solution.variables["A->Y"]).toBeUndefined();
    assertClose(result.solution.objective_value ?? NaN, 14, 1e-6);
    expect(result.solution.variables["C->Z"]).toBe(1);
  });

  it("rejects unknown forbidden pair", () => {
    expect(() =>
      solve({
        agents: ["A"],
        tasks: ["X"],
        costs: [[1]],
        forbidden_assignments: [["A", "Z"]],
      }),
    ).toThrow(SolverError);
  });
});
