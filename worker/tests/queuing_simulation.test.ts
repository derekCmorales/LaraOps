import { describe, expect, it } from "vitest";
import { SolverError } from "../src/errors";
import { solve } from "../src/modules/queuing_simulation/solver";

describe("queuing simulation", () => {
  it("repite la misma semilla", () => {
    const body = {
      arrival_rate: 2,
      service_rate: 3,
      num_servers: 1,
      simulation_time: 250,
      warmup: 25,
      seed: 5,
    };
    const a = solve(body);
    const b = solve(body);
    expect(a.module).toBe("queuing_simulation");
    expect(a.status).toBe("ok");
    expect(a.solution.metrics).toEqual(b.solution.metrics);
    expect(a.tables).toEqual(b.tables);
  });

  it("en un sistema estable cumple la ley de Little de forma aproximada", () => {
    const result = solve({
      arrival_rate: 4,
      service_rate: 5,
      num_servers: 1,
      simulation_time: 8000,
      warmup: 1000,
      seed: 11,
    });
    const m = result.solution.metrics;
    expect(m.served).toBeGreaterThan(1000);
    expect(m.rejected).toBe(0);
    expect(m.W).toBeGreaterThanOrEqual(0);
    expect(m.Wq).toBeGreaterThanOrEqual(0);
    expect(m.W + 1e-9).toBeGreaterThanOrEqual(m.Wq);
    expect(m.L).toBeGreaterThanOrEqual(0);
    expect(m.Lq).toBeGreaterThanOrEqual(0);
    expect(m.utilization).toBeGreaterThanOrEqual(0);
    expect(m.utilization).toBeLessThanOrEqual(1);
    expect(m.utilization).toBeGreaterThan(0.5);
    expect(m.utilization).toBeLessThan(0.95);

    const predicted = m.lambda_eff * m.W;
    expect(Math.abs(m.L - predicted) / Math.max(Math.abs(predicted), 1e-9)).toBeLessThan(0.15);

    const graph = result.graph as { type: string; series: { x: number[]; y: number[] }[] };
    expect(graph.type).toBe("xy");
    expect(graph.series[0].x.length).toBe(graph.series[0].y.length);
    expect(graph.series[0].x.length).toBeGreaterThan(2);
    expect(result.tables!.some((t) => t.name === "resumen")).toBe(true);
  });

  it("rechaza clientes cuando la llegada satura un cupo de 1", () => {
    const result = solve({
      arrival_rate: 40,
      service_rate: 1,
      num_servers: 1,
      capacity: 1,
      simulation_time: 80,
      warmup: 0,
      seed: 3,
    });
    const m = result.solution.metrics;
    expect(m.rejected).toBeGreaterThan(0);
    expect(m.rejected).toBeGreaterThan(m.served);
    expect(m.W).toBeGreaterThanOrEqual(0);
    expect(m.Wq).toBeGreaterThanOrEqual(0);
    expect(m.utilization).toBeGreaterThanOrEqual(0);
    expect(m.utilization).toBeLessThanOrEqual(1);
  });

  it("rechaza tasas, servidores y tiempos que no tienen sentido", () => {
    const base = { arrival_rate: 1, service_rate: 1, num_servers: 1, simulation_time: 10, seed: 1 };
    expect(() => solve({ ...base, arrival_rate: 0 })).toThrow(/llegada/);
    expect(() => solve({ ...base, arrival_rate: -2 })).toThrow(/llegada/);
    expect(() => solve({ ...base, service_rate: 0 })).toThrow(/servicio/);
    expect(() => solve({ ...base, num_servers: 0 })).toThrow(/servidores/);
    expect(() => solve({ ...base, num_servers: 1.5 })).toThrow(/servidores/);
    expect(() => solve({ ...base, simulation_time: 0 })).toThrow(/tiempo/);
    expect(() => solve({ ...base, simulation_time: -5 })).toThrow(/tiempo/);
    expect(() => solve({ ...base, warmup: -1 })).toThrow(/calentamiento/);
    expect(() => solve({ ...base, capacity: 0 })).toThrow(/capacidad/);
    expect(() => solve({ ...base, seed: "no" })).toThrow(SolverError);
  });
});
