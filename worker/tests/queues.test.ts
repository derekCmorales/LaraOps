import { describe, expect, it } from "vitest";
import { solve } from "../src/modules/queues/solver";
import { assertClose, loadFixture } from "./helpers";

describe("queues", () => {
  it("M/M/1 textbook", () => {
    const data = loadFixture("queues_01.json");
    const result = solve(data.request);
    expect(result.status).toBe("ok");
    expect(result.module).toBe("queues");
    for (const [k, v] of Object.entries(data.expect as Record<string, number>)) {
      assertClose(result.solution.metrics[k], v, 1e-6);
    }
  });

  it("M/M/s", () => {
    const data = loadFixture("queues_02.json");
    const result = solve(data.request);
    const exp = data.expect as Record<string, number>;
    assertClose(result.solution.metrics.rho, exp.rho, 1e-6);
    assertClose(result.solution.metrics.P0, exp.P0, 1e-6);
    expect(result.tables).toBeTruthy();
    expect(result.graph).toBeTruthy();
  });

  it("M/G/1 Pollaczek", () => {
    const data = loadFixture("queues_03.json");
    const result = solve(data.request);
    for (const [k, v] of Object.entries(data.expect as Record<string, number>)) {
      assertClose(result.solution.metrics[k], v, 1e-6);
    }
    expect(result.warnings.some((w) => w.includes("Pollaczek"))).toBe(true);
  });

  it("M/D/1 matches zero-sigma M/G/1", () => {
    const data = loadFixture("queues_04.json");
    const result = solve(data.request);
    for (const [k, v] of Object.entries(data.expect as Record<string, number>)) {
      assertClose(result.solution.metrics[k], v, 1e-6);
    }
  });

  it("M/M/s/K Little's law", () => {
    const data = loadFixture("queues_05.json");
    const result = solve(data.request);
    const m = result.solution.metrics;
    for (const [k, v] of Object.entries(data.expect as Record<string, number>)) {
      assertClose(m[k], v, 1e-6);
    }
    assertClose(m.L, m.Lq + m.lambda_eff / 4, 1e-6);
    assertClose(m.W, m.L / m.lambda_eff, 1e-6);
    assertClose(m.Wq, m.Lq / m.lambda_eff, 1e-6);
  });

  it("unstable M/M/1 returns infinite metrics", () => {
    const result = solve({ model: "M/M/1", lambda: 10, mu: 8 });
    expect(result.solution.metrics.L).toBe(Number.POSITIVE_INFINITY);
    expect(result.solution.metrics.Wq).toBe(Number.POSITIVE_INFINITY);
    expect(result.warnings.some((w) => w.includes("inestable"))).toBe(true);
  });

  it("costs and optimize_s", () => {
    const result = solve({
      model: "M/M/s",
      lambda: 10,
      mu: 6,
      s: 2,
      cost_waiting_per_unit_time: 5,
      cost_server_per_unit_time: 20,
      optimize_s: true,
      s_max: 5,
    });
    expect("cost_total" in result.solution.metrics).toBe(true);
    const costTable = result.tables?.find((t) => t.name === "cost_by_s");
    expect(costTable).toBeTruthy();
    const optimal = costTable!.rows.filter((row) => row[row.length - 1] === true);
    expect(optimal).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("óptimo") || w.includes("optimo"))).toBe(true);
  });
});
