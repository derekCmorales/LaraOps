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
    const names = new Set((result.graph as unknown as { series: { name: string }[] }).series.map((s) => s.name));
    expect(names).toEqual(new Set(["relevant_cost", "ordering", "holding"]));
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

  it("separates purchase cost from the plotted relevant cost", () => {
    const result = solve({ D: 1000, S: 10, H: 0.5, C: 5 });
    const m = result.solution.metrics;
    assertClose(m.relevant_cost, 100, 1e-9);
    assertClose(m.purchase_cost, 5000, 1e-9);
    assertClose(m.TC, 5100, 1e-9);
    assertClose(m.avg_inventory, 100, 1e-9);
    const graph = result.graph as unknown as { series: { name: string; x: number[]; y: number[] }[]; subtitle: string };
    const rel = graph.series.find((s) => s.name === "relevant_cost")!;
    const best = rel.y.indexOf(Math.min(...rel.y));
    assertClose(rel.x[best], 200, 1e-9);
    assertClose(rel.y[best], 100, 1e-9);
    expect(graph.subtitle).toContain("costo de compra");
  });

  it("computes the reorder point from lead time", () => {
    const result = solve({ D: 1000, S: 10, H: 0.5, lead_time: 5, working_days: 250 });
    const m = result.solution.metrics;
    assertClose(m.daily_demand, 4, 1e-9);
    assertClose(m.reorder_point, 20, 1e-9);
    assertClose(m.time_between_orders_days, 50, 1e-9);
    expect(result.warnings).toEqual([]);
    const labels = result.tables![0].rows.map((r) => String(r[0]));
    expect(labels.some((l) => l.includes("Punto de reorden"))).toBe(true);
  });

  it("omits the reorder point without lead time", () => {
    const result = solve({ D: 1000, S: 10, H: 0.5 });
    expect(result.solution.metrics.reorder_point).toBeUndefined();
    assertClose(result.solution.metrics.time_between_orders_days, 73, 1e-9);
  });

  it("warns when lead time exceeds the order cycle", () => {
    const result = solve({ D: 1000, S: 10, H: 0.5, lead_time: 80, working_days: 250 });
    assertClose(result.solution.metrics.reorder_point, 320, 1e-9);
    expect(result.warnings.some((w) => w.includes("más de un pedido en tránsito"))).toBe(true);
  });

  it("rejects missing or invalid inputs with readable messages", () => {
    expect(() => solve({ D: 1000, S: 10 })).toThrow(/costo de mantener \(H\) debe ser mayor que 0/);
    expect(() => solve({ D: 1000, S: 10, H: 0.5, lead_time: -1 })).toThrow(/tiempo de entrega no puede ser negativo/);
    expect(() => solve({ D: 1000, S: 10, H: 0.5, working_days: 400 })).toThrow(SolverError);
  });
});
