import { describe, expect, it } from "vitest";
import { linearSumAssignment, minLineCover, solve } from "../src/modules/assignment/solver";
import { SolverError } from "../src/errors";
import { assertClose } from "./helpers";

/** Óptimo por fuerza bruta (rectangular, con celdas prohibidas = null). */
function brute(costs: (number | null)[][], sense: "min" | "max" = "min"): number | null {
  const rows = costs.length;
  const cols = costs[0].length;
  const k = Math.min(rows, cols);
  const better = (a: number, b: number) => (sense === "min" ? a < b : a > b);
  let best: number | null = null;
  const usedR = new Array(rows).fill(false);
  const usedC = new Array(cols).fill(false);
  // Se asignan k parejas; el lado mayor deja elementos sin pareja.
  function rec(depth: number, acc: number) {
    if (depth === k) {
      if (best == null || better(acc, best)) best = acc;
      return;
    }
    if (rows <= cols) {
      const r = depth;
      for (let c = 0; c < cols; c++) {
        if (usedC[c] || costs[r][c] == null) continue;
        usedC[c] = true;
        rec(depth + 1, acc + (costs[r][c] as number));
        usedC[c] = false;
      }
    } else {
      const c = depth;
      for (let r = 0; r < rows; r++) {
        if (usedR[r] || costs[r][c] == null) continue;
        usedR[r] = true;
        rec(depth + 1, acc + (costs[r][c] as number));
        usedR[r] = false;
      }
    }
  }
  rec(0, 0);
  return best;
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function names(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
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
    const kinds = result.iterations!.map((s) => s.meta.kind);
    expect(kinds[0]).toBe("initial");
    expect(kinds).toContain("row_reduction");
    expect(kinds).toContain("col_reduction");
    expect(kinds[kinds.length - 1]).toBe("assignment");
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
    assertClose(got, brute(costs)!, 1e-9);
    assertClose(solve({ agents: names("A", 4), tasks: names("T", 4), costs }).solution.objective_value!, 15, 1e-9);
  });

  it("needs an adjustment step on the classic 4x4", () => {
    // Taha: tras reducir filas y columnas solo 3 líneas cubren los ceros.
    const costs = [
      [15, 10, 9, 13],
      [9, 15, 10, 8],
      [10, 12, 8, 12],
      [8, 9, 14, 10],
    ];
    const result = solve({ agents: names("A", 4), tasks: names("T", 4), costs });
    assertClose(result.solution.objective_value!, brute(costs)!, 1e-9);
    const covers = result.iterations!.filter((s) => s.meta.kind === "cover");
    expect(covers.length).toBeGreaterThan(0);
    expect(covers[covers.length - 1].meta.lines).toBe(4);
  });

  it("didactic steps always end in a full assignment of zeros (random)", () => {
    const r = rng(7);
    for (let t = 0; t < 600; t++) {
      const rows = 1 + Math.floor(r() * 7);
      const cols = 1 + Math.floor(r() * 7);
      const costs: (number | null)[][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => Math.floor(r() * 12) - (t % 5 === 0 ? 4 : 0)),
      );
      const forbidden: [string, string][] = [];
      if (t % 3 === 0) {
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols; j++) {
            if (r() < 0.2) {
              forbidden.push([`A${i + 1}`, `T${j + 1}`]);
              costs[i][j] = null;
            }
          }
        }
      }
      const sense = t % 2 === 0 ? "min" : "max";
      const result = solve({
        agents: names("A", rows),
        tasks: names("T", cols),
        costs: costs.map((row) => row.map((v) => v ?? 1)),
        sense,
        forbidden_assignments: forbidden,
      });
      const expected = brute(costs, sense);
      if (expected == null) {
        expect(result.status).toBe("infeasible");
        continue;
      }
      expect(result.status).toBe("optimal");
      assertClose(result.solution.objective_value!, expected, 1e-9);
      expect(result.solution.metrics.n_assignments).toBe(Math.min(rows, cols));

      const steps = result.iterations!;
      const covers = steps.filter((s) => s.meta.kind === "cover");
      const lastCover = covers[covers.length - 1];
      const n = Math.max(rows, cols);
      expect(lastCover.meta.lines).toBe(n);
      const final = steps[steps.length - 1];
      const assigned = final.meta.assigned as [number, number][];
      expect(new Set(assigned.map(([, c]) => c)).size).toBe(n);
      for (const [i, j] of assigned) expect(final.tableau![i][j]).toBe(0);
      // Cada cobertura usa el mínimo de líneas y tapa todos los ceros.
      for (const step of covers) {
        const tab = step.tableau!;
        const cr = new Set(step.meta.cover_rows as number[]);
        const cc = new Set(step.meta.cover_cols as number[]);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (tab[i][j] === 0) expect(cr.has(i) || cc.has(j)).toBe(true);
          }
        }
        expect((step.meta.independent_zeros as unknown[]).length).toBe(cr.size + cc.size);
      }
    }
  });

  it("covers zeros with the minimum number of lines", () => {
    // Una cobertura voraz usa 3 líneas aquí; el mínimo es 2.
    const zeros = [
      [true, true, false],
      [true, false, false],
      [false, true, false],
    ].map((row) => row.map(Boolean));
    const { coverRows, coverCols } = minLineCover(zeros);
    expect(coverRows.length + coverCols.length).toBe(2);
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
    const left = result.tables!.find((t) => t.name === "sin_asignar");
    expect(left?.rows).toEqual([["agente", "B"]]);
    expect(result.iterations![0].meta.col_labels).toEqual(["X", "Tarea ficticia 1"]);
  });

  it("does not drop agents whose name looks like a dummy", () => {
    const result = solve({ agents: ["_dummy_agent_0"], tasks: ["X"], costs: [[3]] });
    expect(result.solution.variables["_dummy_agent_0->X"]).toBe(1);
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
    const regret = result.iterations!.find((s) => s.meta.kind === "regret");
    expect(regret?.meta.max_value).toBe(9);
    expect(result.tables![0].columns).toEqual(["agente", "tarea", "ganancia"]);
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
    expect(result.solution.variables["A->Y"]).toBeUndefined();
    assertClose(result.solution.objective_value ?? NaN, 14, 1e-6);
    expect(result.solution.variables["C->Z"]).toBe(1);
    expect(result.iterations![0].tableau![0][1]).toBe("M");
    expect(result.iterations![0].meta.forbidden).toEqual([[0, 1]]);
    const costs = result.tables!.find((t) => t.name === "matriz_original");
    expect(costs?.rows[0]).toEqual(["A", 9, "M", 7]);
  });

  it("reports infeasible forbidden patterns instead of using M", () => {
    const result = solve({
      agents: ["A", "B"],
      tasks: ["X", "Y"],
      costs: [
        [1, 2],
        [3, 4],
      ],
      forbidden_assignments: [
        ["A", "Y"],
        ["B", "Y"],
      ],
    });
    expect(result.status).toBe("infeasible");
    expect(result.solution.objective_value).toBeNull();
    expect(result.warnings[0]).toMatch(/«A» y «B» solo pueden ir a la tarea «X»/);

    const single = solve({
      agents: ["A", "B"],
      tasks: ["X", "Y"],
      costs: [
        [1, 2],
        [3, 4],
      ],
      forbidden_assignments: [
        ["A", "X"],
        ["A", "Y"],
      ],
    });
    expect(single.status).toBe("infeasible");
    expect(single.warnings[0]).toMatch(/«A» tiene prohibidas todas las tareas/);
  });

  it("allows an agent with every task forbidden when it can stay unassigned", () => {
    const result = solve({
      agents: ["A", "B"],
      tasks: ["X"],
      costs: [[1], [5]],
      forbidden_assignments: [["A", "X"]],
    });
    expect(result.status).toBe("optimal");
    expect(result.solution.variables["B->X"]).toBe(1);
    expect(result.tables!.find((t) => t.name === "sin_asignar")?.rows).toEqual([["agente", "A"]]);
  });

  it("detects alternative optima", () => {
    const result = solve({
      agents: ["A", "B"],
      tasks: ["X", "Y"],
      costs: [
        [1, 1],
        [1, 1],
      ],
    });
    expect(result.warnings.some((w) => /óptimos múltiples/.test(w))).toBe(true);
    const alt = result.tables!.find((t) => t.name === "asignacion_alternativa");
    expect(alt?.rows.length).toBe(2);
    const unique = solve({
      agents: ["A", "B", "C"],
      tasks: ["X", "Y", "Z"],
      costs: [
        [9, 2, 7],
        [6, 4, 3],
        [5, 8, 1],
      ],
    });
    expect(unique.warnings.some((w) => /óptimos múltiples/.test(w))).toBe(false);
  });

  it("handles decimal costs without float noise", () => {
    const result = solve({
      agents: ["A", "B", "C"],
      tasks: ["X", "Y", "Z"],
      costs: [
        [0.1, 0.2, 0.3],
        [0.3, 0.1, 0.2],
        [0.2, 0.3, 0.1],
      ],
    });
    assertClose(result.solution.objective_value!, 0.3, 1e-9);
    const last = result.iterations![result.iterations!.length - 1];
    expect(last.tableau!.flat().every((v) => typeof v === "number" && String(v).length < 12)).toBe(true);
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

  it("rejects duplicate names and bad cells with readable messages", () => {
    expect(() => solve({ agents: ["A", "A"], tasks: ["X", "Y"], costs: [[1, 2], [3, 4]] })).toThrow(/repetido/);
    expect(() => solve({ agents: ["A"], tasks: ["X"], costs: [[null]] })).toThrow(/«A» en «X» no es un número/);
    expect(() => solve({ agents: ["A"], tasks: ["X", "Y"], costs: [[1]] })).toThrow(/2 valores/);
    expect(() => solve({ agents: [], tasks: ["X"], costs: [] })).toThrow(/al menos un agente/);
  });
});
