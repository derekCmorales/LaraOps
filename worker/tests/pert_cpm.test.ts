import { describe, expect, it } from "vitest";
import { solve } from "../src/modules/pert_cpm/solver";
import { SolverError } from "../src/errors";
import { assertClose, loadFixture } from "./helpers";

describe("pert_cpm", () => {
  it("CPM diamond textbook", () => {
    const data = loadFixture("pert_01.json");
    const result = solve(data.request);
    const exp = data.expect as { project_duration: number; critical_path: string[] };
    expect(result.status).toBe("ok");
    expect(result.module).toBe("pert_cpm");
    assertClose(result.solution.metrics.project_duration, exp.project_duration);
    const cp = result.tables?.find((t) => t.name === "critical_path");
    expect(cp).toBeTruthy();
    expect(cp!.rows.map((r) => r[1])).toEqual(exp.critical_path);
    expect(result.graph?.type).toBe("network");
  });

  it("cycle raises", () => {
    expect(() =>
      solve({
        mode: "cpm",
        activities: [
          { id: "A", predecessors: ["B"], duration: 1 },
          { id: "B", predecessors: ["A"], duration: 1 },
        ],
      }),
    ).toThrow(SolverError);
  });

  it("crashing reduces duration", () => {
    const result = solve({
      mode: "cpm",
      crash: true,
      crash_target: 10,
      activities: [
        { id: "A", predecessors: [], duration: 3, crash_time: 3, normal_cost: 50, crash_cost: 50 },
        { id: "B", predecessors: ["A"], duration: 4, crash_time: 2, normal_cost: 100, crash_cost: 200 },
        { id: "C", predecessors: ["A"], duration: 2, crash_time: 2, normal_cost: 40, crash_cost: 40 },
        { id: "D", predecessors: ["B", "C"], duration: 5, crash_time: 5, normal_cost: 80, crash_cost: 80 },
      ],
    });
    expect(result.status).toBe("ok");
    expect(result.solution.metrics.project_duration).toBeLessThanOrEqual(10 + 1e-6);
    expect(result.solution.metrics.crash_total_cost).toBeGreaterThan(0);
    expect(result.iterations?.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects the spreadsheet invalid-number token", () => {
    expect(() =>
      solve({
        mode: "cpm",
        activities: [{ id: "A", predecessors: [], duration: "Invalid Number" }],
      }),
    ).toThrow(/número válido/i);
  });

  it("accepts comma decimals in duration", () => {
    const result = solve({
      mode: "cpm",
      activities: [
        { id: "A", predecessors: [], duration: "1,5" },
        { id: "B", predecessors: ["A"], duration: "2.5" },
      ],
    });
    expect(result.solution.metrics.project_duration).toBeCloseTo(4);
    const cp = result.tables?.find((t) => t.name === "critical_path");
    expect(cp?.rows.map((r) => r[1])).toEqual(["A", "B"]);
  });

  it("PERT probability uses expected time", () => {
    const result = solve({
      mode: "pert",
      target_time: 2,
      activities: [{ id: "A", predecessors: [], a: 1, m: 2, b: 3 }],
    });
    expect(result.solution.metrics.project_te).toBeCloseTo(2);
    expect(result.solution.metrics.project_variance).toBeCloseTo(1 / 9);
    expect(result.solution.metrics.prob_meet_target).toBeCloseTo(0.5, 2);
  });

  it("does not pay to crash past a parallel activity that cannot be shortened", () => {
    const result = solve({
      mode: "cpm",
      crash: true,
      crash_target: 5,
      activities: [
        { id: "A", predecessors: [], duration: 10, crash_time: 0, normal_cost: 0, crash_cost: 50 },
        { id: "B", predecessors: [], duration: 8 },
      ],
    });
    expect(result.status).toBe("infeasible");
    expect(result.solution.metrics.project_duration).toBeCloseTo(8);
    expect(result.solution.metrics.crash_total_cost).toBeCloseTo(10);
  });

  it("crashes parallel critical paths together", () => {
    const result = solve({
      mode: "cpm",
      crash: true,
      crash_target: 8,
      activities: [
        { id: "A", predecessors: [], duration: 10, crash_time: 6, normal_cost: 0, crash_cost: 20 },
        { id: "B", predecessors: [], duration: 10, crash_time: 6, normal_cost: 0, crash_cost: 40 },
      ],
    });
    expect(result.status).toBe("ok");
    expect(result.solution.metrics.project_duration).toBeCloseTo(8);
    expect(result.solution.metrics.crash_total_cost).toBeCloseTo(30);
    expect(result.iterations?.[0]?.meta?.activity).toBe("A, B");
  });

  it("crash infeasible status", () => {
    const result = solve({
      mode: "cpm",
      crash: true,
      crash_target: 1,
      activities: [{ id: "A", predecessors: [], duration: 5, crash_time: 4, normal_cost: 10, crash_cost: 20 }],
    });
    expect(result.status).toBe("infeasible");
    expect(result.solution.metrics.project_duration).toBeGreaterThan(1);
  });
});
