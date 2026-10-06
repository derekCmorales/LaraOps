import { describe, expect, it } from "vitest";
import { solve } from "../src/modules/queues/solver";
import { assertClose, loadFixture } from "./helpers";

function table(result: ReturnType<typeof solve>, name: string) {
  const t = result.tables?.find((x) => x.name === name);
  if (!t) throw new Error(`falta la tabla ${name}`);
  return t;
}

describe("queues", () => {
  it("M/M/1 textbook", () => {
    const data = loadFixture("queues_01.json");
    const result = solve(data.request);
    expect(result.status).toBe("ok");
    expect(result.module).toBe("queues");
    for (const [k, v] of Object.entries(data.expect as Record<string, number>)) {
      assertClose(result.solution.metrics[k], v, 1e-6);
    }
    assertClose(result.solution.metrics.Pw, 2 / 3, 1e-12);
  });

  it("M/M/s", () => {
    const data = loadFixture("queues_02.json");
    const result = solve(data.request);
    const exp = data.expect as Record<string, number>;
    const m = result.solution.metrics;
    assertClose(m.rho, exp.rho, 1e-6);
    assertClose(m.P0, exp.P0, 1e-6);
    assertClose(m.Lq, 125 / 33, 1e-9);
    assertClose(m.Pw, 25 / 33, 1e-9);
    expect(result.tables).toBeTruthy();
    expect(result.graph).toBeTruthy();
  });

  it("M/G/1 Pollaczek", () => {
    const data = loadFixture("queues_03.json");
    const result = solve(data.request);
    for (const [k, v] of Object.entries(data.expect as Record<string, number>)) {
      assertClose(result.solution.metrics[k], v, 1e-6);
    }
    expect(table(result, "formulas").rows.some((row) => String(row[0]).includes("Pollaczek"))).toBe(true);
    expect(result.warnings).toEqual([]);
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
    assertClose(m.lambda_lost, 6 * m.P_block, 1e-12);
  });

  it("M/M/1/K closed form", () => {
    const [lam, mu, K] = [3, 4, 5];
    const r = lam / mu;
    const result = solve({ model: "M/M/1/K", lambda: lam, mu, K });
    const m = result.solution.metrics;
    const p0 = (1 - r) / (1 - r ** (K + 1));
    assertClose(m.P0, p0, 1e-12);
    assertClose(m.P_block, p0 * r ** K, 1e-12);
    assertClose(m.rho, 1 - p0, 1e-12);
    const pn = table(result, "Pn");
    expect(pn.rows).toHaveLength(K + 1);
    assertClose(pn.rows[K][2] as number, 1, 1e-12);
  });

  it("finite capacity does not overflow", () => {
    const m = solve({ model: "M/M/1/K", lambda: 100, mu: 1, K: 500 }).solution.metrics;
    expect(Object.values(m).every((v) => Number.isFinite(v))).toBe(true);
    assertClose(m.P_block, 0.99, 1e-9);
    assertClose(m.lambda_eff, 1, 1e-9);
    expect(m.Pw).toBeLessThanOrEqual(1);
    expect(m.rho).toBeLessThanOrEqual(1);
  });

  it("finite population (machine repair)", () => {
    const result = solve({ model: "M/M/s/N", lambda: 0.1, mu: 0.5, s: 2, N: 10 });
    const m = result.solution.metrics;
    assertClose(m.lambda_eff, 0.1 * (10 - m.L), 1e-12);
    assertClose(m.customers_outside, 10 - m.L, 1e-12);
    assertClose(m.W, m.L / m.lambda_eff, 1e-12);
    expect(table(result, "Pn").rows).toHaveLength(11);
  });

  it("unstable M/M/1 returns infinite metrics", () => {
    const result = solve({ model: "M/M/1", lambda: 10, mu: 8 });
    expect(result.solution.metrics.L).toBe(Number.POSITIVE_INFINITY);
    expect(result.solution.metrics.Wq).toBe(Number.POSITIVE_INFINITY);
    expect(result.solution.metrics.s_min_stable).toBe(2);
    expect(result.warnings.some((w) => w.includes("inestable"))).toBe(true);
    expect(result.graph).toBeNull();
  });

  it("wait probabilities match closed forms", () => {
    const [lam, mu, t] = [10, 15, 0.1];
    const m = solve({ model: "M/M/1", lambda: lam, mu, wait_threshold: t }).solution.metrics;
    assertClose(m.P_w_gt_t, Math.exp(-mu * (1 - lam / mu) * t), 1e-12);
    assertClose(m.P_wq_gt_t, (lam / mu) * Math.exp(-mu * (1 - lam / mu) * t), 1e-12);
  });

  it("large capacity matches the infinite model", () => {
    const base = { lambda: 10, mu: 6, s: 2, wait_threshold: 0.3 };
    const inf = solve({ model: "M/M/s", ...base }).solution.metrics;
    const fin = solve({ model: "M/M/s/K", K: 400, ...base }).solution.metrics;
    for (const k of ["L", "Lq", "W", "Wq", "P0", "Pw", "P_wq_gt_t", "P_w_gt_t"]) {
      assertClose(fin[k], inf[k], 1e-8);
    }
  });

  it("single-server models charge one server", () => {
    const m = solve({
      model: "M/M/1",
      lambda: 10,
      mu: 15,
      s: 2,
      cost_waiting_per_unit_time: 1,
      cost_server_per_unit_time: 10,
    }).solution.metrics;
    expect(m.cost_server).toBe(10);
    assertClose(m.cost_total, 12, 1e-9);
  });

  it("waiting cost on the queue", () => {
    const m = solve({
      model: "M/M/1",
      lambda: 10,
      mu: 15,
      cost_waiting_per_unit_time: 3,
      cost_server_per_unit_time: 0,
      waiting_cost_basis: "queue",
    }).solution.metrics;
    assertClose(m.cost_waiting, 4, 1e-9);
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
    const costTable = table(result, "cost_by_s");
    expect(costTable.rows.map((row) => row[0])).toEqual([2, 3, 4, 5]);
    const optimal = costTable.rows.filter((row) => row[row.length - 1] === true);
    expect(optimal).toHaveLength(1);
    const best = [...costTable.rows].sort((a, b) => (a[9] as number) - (b[9] as number))[0];
    expect(result.solution.metrics.s_optimal).toBe(best[0]);
  });

  it("Pn table reaches the tail", () => {
    const result = solve({ model: "M/M/1", lambda: 9, mu: 10 });
    const pn = table(result, "Pn");
    expect(pn.columns).toEqual(["n", "Pn", "acumulada"]);
    expect(pn.rows[pn.rows.length - 1][2] as number).toBeGreaterThanOrEqual(0.999);
    expect(result.warnings.some((w) => w.includes("muy cargado"))).toBe(true);
  });

  it("congestion curve", () => {
    const curve = table(solve({ model: "M/M/s", lambda: 10, mu: 6, s: 2 }), "curva_congestion");
    const lambdas = curve.rows.map((row) => row[0] as number);
    expect(lambdas).toEqual([...lambdas].sort((a, b) => a - b));
    expect(lambdas).toContain(10);
    expect(curve.rows.every((row) => (row[1] as number) < 1)).toBe(true);
  });

  it.each([
    [{ model: "M/M/9" }, "no soportado"],
    [{ model: "M/M/1", mu: 5 }, "tasa de llegada"],
    [{ model: "M/M/1", lambda: 5, mu: 0 }, "μ debe ser mayor que 0"],
    [{ model: "M/M/s", lambda: 5, mu: 3 }, "número de servidores"],
    [{ model: "M/M/s", lambda: 5, mu: 3, s: 2.5 }, "entero"],
    [{ model: "M/M/s", lambda: 5, mu: 3, s: 0 }, "entero"],
    [{ model: "M/M/s", lambda: 5, mu: 3, s: "x" }, "entero"],
    [{ model: "M/M/s", lambda: 5, mu: 3, s: 41 }, "no puede superar"],
    [{ model: "M/M/1/K", lambda: 5, mu: 3 }, "capacidad máxima K"],
    [{ model: "M/M/s/K", lambda: 5, mu: 3, s: 3, K: 2 }, "al menos igual"],
    [{ model: "M/M/s/N", lambda: 5, mu: 3, s: 1 }, "población N"],
    [{ model: "M/G/1", lambda: 5, mu: 6 }, "desviación estándar"],
    [{ model: "M/G/1", lambda: 5, mu: 6, service_std_dev: -1 }, "negativa"],
    [{ model: "M/M/1", lambda: 5, mu: 6, cost_waiting_per_unit_time: -1 }, "negativo"],
  ])("validates %j", (body, message) => {
    expect(() => solve(body)).toThrow(message);
  });
});
