import { describe, expect, it } from "vitest";
import { solve } from "../src/modules/transport/solver";
import { assertClose, loadFixture } from "./helpers";

describe("transport", () => {
  it("balances and matches textbook cost", () => {
    const data = loadFixture("transport_01.json");
    const result = solve(data.request);
    const expectData = data.expect as { objective_value: number };
    expect(result.status).toBe("optimal");
    expect(result.module).toBe("transport");
    assertClose(result.solution.objective_value ?? NaN, expectData.objective_value, 1e-4);
    expect(result.iterations?.length).toBeGreaterThan(0);
    const ship = result.solution.variables;
    assertClose((ship["A->X"] ?? 0) + (ship["A->Y"] ?? 0), 20, 1e-4);
    assertClose((ship["B->X"] ?? 0) + (ship["B->Y"] ?? 0), 30, 1e-4);
    assertClose((ship["A->X"] ?? 0) + (ship["B->X"] ?? 0), 10, 1e-4);
    assertClose((ship["A->Y"] ?? 0) + (ship["B->Y"] ?? 0), 40, 1e-4);
    expect(result.sensitivity?.reduced_costs.length).toBeGreaterThan(0);
  });

  it("least_cost records iterations", () => {
    const data = loadFixture("transport_01.json");
    const req = { ...(data.request as object), method: "least_cost" };
    const result = solve(req);
    expect(result.status).toBe("optimal");
    expect(result.iterations?.some((s) => s.method === "least_cost")).toBe(true);
  });
});
