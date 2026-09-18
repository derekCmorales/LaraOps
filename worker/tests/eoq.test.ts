import { describe, expect, it } from "vitest";
import { solve } from "../src/modules/eoq/solver";
import { SolverError } from "../src/errors";
import { assertClose, loadFixture } from "./helpers";

describe("eoq", () => {
  it("eoq_01 textbook", () => {
    const data = loadFixture("eoq_01.json");
    const result = solve(data.request);
    const expectData = data.expect as Record<string, number>;
    expect(result.status).toBe("ok");
    expect(result.module).toBe("eoq");
    expect(result.iterations).toBeNull();
    expect(result.sensitivity).toBeNull();
    assertClose(result.solution.metrics.Q_star, expectData.Q_star, 1e-6);
    assertClose(result.solution.metrics.TC, expectData.TC, 1e-6);
    assertClose(result.solution.metrics.orders_per_year, expectData.orders_per_year, 1e-6);
    assertClose(result.solution.metrics.TC_ordering, expectData.TC_ordering, 1e-6);
    assertClose(result.solution.metrics.TC_holding, expectData.TC_holding, 1e-6);
    assertClose(result.solution.variables.Q, expectData.Q_star, 1e-6);
    expect(result.graph?.type).toBe("xy");
    const names = new Set((result.graph as { series: { name: string }[] }).series.map((s) => s.name));
    expect(names).toEqual(new Set(["TC", "ordering", "holding"]));
  });

  it("eoq_02 textbook", () => {
    const data = loadFixture("eoq_02.json");
    const result = solve(data.request);
    const expectData = data.expect as Record<string, number>;
    assertClose(result.solution.metrics.Q_star, expectData.Q_star, 1e-6);
    assertClose(result.solution.metrics.TC, expectData.TC, 1e-6);
    assertClose(result.solution.metrics.orders_per_year, expectData.orders_per_year, 1e-6);
  });

  it("rejects D = 0", () => {
    expect(() => solve({ D: 0, S: 10, H: 0.5 })).toThrow(SolverError);
  });
});
