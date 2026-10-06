import { describe, expect, it } from "vitest";
import { SolverError } from "../src/errors";
import { solve } from "../src/modules/monte_carlo/solver";

function metricsOf(body: unknown): Record<string, number> {
  return solve(body).solution.metrics;
}

describe("monte carlo", () => {
  it("repite la misma semilla en las métricas agregadas", () => {
    const body = { mode: "rng", seed: 123, n: 1000 };
    const a = solve(body);
    const b = solve(body);
    expect(a.solution.metrics).toEqual(b.solution.metrics);
    expect(a.tables).toEqual(b.tables);
    expect(a.module).toBe("monte_carlo");

    const mc = {
      mode: "monte_carlo",
      seed: 9,
      replications: 200,
      variables: [{ name: "u", distribution: { family: "uniform", min: 0, max: 1 } }],
      expression: "u * u",
    };
    expect(metricsOf(mc)).toEqual(metricsOf(mc));
  });

  it("acerca la media y la varianza de U(0,1) a 1/2 y 1/12", () => {
    const result = solve({ mode: "rng", seed: 42, n: 5000 });
    const m = result.solution.metrics;
    expect(Math.abs(m.mean - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(m.variance - 1 / 12)).toBeLessThan(0.008);
    expect(m.theoretical_mean).toBe(0.5);
    expect(m.theoretical_variance).toBeCloseTo(1 / 12, 12);

    const muestra = result.tables!.find((t) => t.name === "muestra")!;
    expect(muestra.columns).toEqual(["i", "u"]);
    expect(muestra.rows).toHaveLength(30);

    const hist = result.tables!.find((t) => t.name === "histogram")!;
    expect(hist.columns).toEqual(["bin", "frecuencia", "desde", "hasta"]);
    expect(hist.rows).toHaveLength(10);
    const freq = hist.rows.reduce((sum, row) => sum + Number(row[1]), 0);
    expect(freq).toBe(5000);

    const metodo = result.tables!.find((t) => t.name === "metodo")!;
    const text = metodo.rows.map((row) => String(row[1])).join(" ");
    expect(text).toMatch(/Mulberry32|congruencial/i);
    expect(text).toMatch(/1\/2|media teórica/i);
    expect(result.graph?.type).toBe("xy");
    expect(result.graph && "kind" in result.graph ? result.graph.kind : "").toBe("histogram");
  });

  it("estima la media exponencial cerca de 1/λ", () => {
    const result = solve({
      mode: "variates",
      seed: 99,
      n: 20000,
      distribution: { family: "exponential", lambda: 4 },
    });
    const mean = result.solution.metrics.mean;
    expect(Math.abs(mean - 0.25) / 0.25).toBeLessThan(0.05);
    expect(result.solution.metrics.theoretical_mean).toBeCloseTo(0.25, 12);
    expect(result.solution.metrics.theoretical_variance).toBeCloseTo(0.0625, 12);
    const muestra = result.tables!.find((t) => t.name === "muestra")!;
    expect(muestra.rows).toHaveLength(20);
    const metodo = result.tables!.find((t) => t.name === "metodo")!;
    expect(metodo.rows.map((row) => String(row[1])).join(" ")).toMatch(/−ln|ln\(1/);
  });

  it("da el valor exacto si la uniforme es una constante", () => {
    const result = solve({
      mode: "monte_carlo",
      seed: 7,
      replications: 100,
      variables: [
        { name: "x", distribution: { family: "uniform", min: 3, max: 3 } },
        { name: "y", distribution: { family: "uniform", min: 2, max: 2 } },
      ],
      expression: "x * y + 1",
    });
    const m = result.solution.metrics;
    expect(m.mean).toBe(7);
    expect(m.std).toBe(0);
    expect(m.min).toBe(7);
    expect(m.max).toBe(7);
    expect(result.solution.objective_value).toBe(7);
    expect(result.solution.objective_sense).toBeNull();
    expect(m.p05).toBe(7);
    expect(m.p50).toBe(7);
    expect(m.p95).toBe(7);
    expect(m.ci95_low).toBe(7);
    expect(m.ci95_high).toBe(7);
  });

  it("respeta potencia, funciones y paréntesis", () => {
    const power = solve({
      mode: "monte_carlo",
      seed: 1,
      replications: 100,
      variables: [],
      expression: "2^3^2",
    });
    expect(power.solution.metrics.mean).toBe(512);
    expect(solve({
      mode: "monte_carlo",
      seed: 1,
      replications: 100,
      variables: [],
      expression: "-2^2",
    }).solution.metrics.mean).toBe(-4);
    expect(solve({
      mode: "monte_carlo",
      seed: 1,
      replications: 100,
      variables: [],
      expression: "(2+3)*4",
    }).solution.metrics.mean).toBe(20);

    const fn = solve({
      mode: "monte_carlo",
      seed: 1,
      replications: 100,
      variables: [
        { name: "x", distribution: { family: "uniform", min: 5, max: 5 } },
        { name: "y", distribution: { family: "uniform", min: 5, max: 5 } },
        { name: "z", distribution: { family: "uniform", min: -3, max: -3 } },
        { name: "w", distribution: { family: "uniform", min: 9, max: 9 } },
      ],
      expression: "floor(x) + ceil(y) + abs(z) + sqrt(w)",
    });
    expect(fn.solution.metrics.mean).toBe(16);

    const pedido = solve({
      mode: "monte_carlo",
      seed: 1,
      replications: 100,
      variables: [{ name: "demanda", distribution: { family: "uniform", min: 70, max: 70 } }],
      expression: "20*min(demanda, 70) - 12*70 + 5*max(70-demanda, 0)",
    });
    expect(pedido.solution.metrics.mean).toBe(560);
  });

  it("rechaza expresiones prohibidas, vacías o con nombres desconocidos", () => {
    const base = {
      mode: "monte_carlo",
      seed: 1,
      replications: 100,
      variables: [{ name: "x", distribution: { family: "uniform", min: 0, max: 1 } }],
    };
    expect(() => solve({ ...base, expression: "" })).toThrow(SolverError);
    expect(() => solve({ ...base, expression: "   " })).toThrow(/vacía/);
    expect(() => solve({ ...base, expression: "z + 1" })).toThrow(/no es una variable/);
    expect(() => solve({ ...base, expression: "eval(x)" })).toThrow(/no es una función/);
    expect(() => solve({ ...base, expression: "alert(1)" })).toThrow(SolverError);
    expect(() => solve({ ...base, expression: "foo" })).toThrow(SolverError);
  });

  it("ordena percentiles y mete la media en el intervalo del 95%", () => {
    const m = metricsOf({
      mode: "monte_carlo",
      seed: 3,
      replications: 800,
      variables: [{ name: "u", distribution: { family: "uniform", min: 0, max: 1 } }],
      expression: "u",
    });
    expect(m.p05).toBeLessThanOrEqual(m.p50);
    expect(m.p50).toBeLessThanOrEqual(m.p95);
    expect(m.p25).toBeLessThanOrEqual(m.p50);
    expect(m.p50).toBeLessThanOrEqual(m.p75);
    expect(m.ci95_low).toBeLessThanOrEqual(m.mean);
    expect(m.ci95_high).toBeGreaterThanOrEqual(m.mean);
    expect(m.stderr).toBeCloseTo(m.std / Math.sqrt(m.valid_replications), 12);
    const table = solve({
      mode: "monte_carlo",
      seed: 3,
      replications: 200,
      variables: [{ name: "u", distribution: { family: "uniform", min: 0, max: 1 } }],
      expression: "u",
    }).tables!.find((t) => t.name === "percentiles")!;
    expect(table.rows.map((row) => row[0])).toEqual([5, 25, 50, 75, 95]);
  });

  it("cubre los casos límite de la simulación", () => {
    expect(() =>
      solve({
        mode: "monte_carlo",
        seed: 1,
        replications: 0,
        variables: [],
        expression: "1",
      }),
    ).toThrow(/réplicas/);
    expect(() => solve({ mode: "rng", seed: "hola", n: 10 })).toThrow(/semilla/);
    expect(() => solve({ mode: "rng", seed: Number.NaN, n: 10 })).toThrow(/semilla/);
    expect(() =>
      solve({
        mode: "monte_carlo",
        seed: 1,
        replications: 100,
        variables: [{ name: "x" }],
        expression: "x",
      }),
    ).toThrow(/distribución/);
    expect(() =>
      solve({
        mode: "variates",
        seed: 1,
        n: 10,
        distribution: { family: "triangular", low: 0, mode: 5, high: 1 },
      }),
    ).toThrow(/triangular|moda|orden/i);
    expect(() =>
      solve({
        mode: "variates",
        seed: 1,
        n: 10,
        distribution: { family: "normal", mean: 0, std: 0 },
      }),
    ).toThrow(/desviación/);
    expect(() =>
      solve({
        mode: "variates",
        seed: 1,
        n: 10,
        distribution: { family: "normal", mean: 0, std: -2 },
      }),
    ).toThrow(/desviación/);

    const normalized = solve({
      mode: "variates",
      seed: 1,
      n: 50,
      distribution: { family: "discrete", values: [0, 1], probabilities: [1, 3] },
    });
    expect(normalized.warnings.some((w) => /normaliz/i.test(w))).toBe(true);
    expect(normalized.solution.metrics.theoretical_mean).toBeCloseTo(0.75, 12);

    expect(() =>
      solve({
        mode: "monte_carlo",
        seed: 1,
        replications: 100,
        variables: [{ name: "x", distribution: { family: "uniform", min: 0, max: 0 } }],
        expression: "1/x",
      }),
    ).toThrow(/no numérico|infinito/);

    const partial = solve({
      mode: "monte_carlo",
      seed: 4,
      replications: 400,
      variables: [{ name: "x", distribution: { family: "uniform", min: -1, max: 1 } }],
      expression: "sqrt(x)",
    });
    expect(partial.warnings.some((w) => /no numérico|indefinido/i.test(w))).toBe(true);
    expect(Number.isFinite(partial.solution.metrics.mean)).toBe(true);
    expect(partial.solution.metrics.valid_replications).toBeGreaterThan(0);
    expect(partial.solution.metrics.valid_replications).toBeLessThan(400);
  });

  it("aproxima la ganancia esperada de un pedido discreto", () => {
    const result = solve({
      mode: "monte_carlo",
      seed: 21,
      replications: 4000,
      variables: [
        {
          name: "demanda",
          distribution: {
            family: "discrete",
            values: [40, 55, 70, 85, 100],
            probabilities: [0.1, 0.25, 0.3, 0.25, 0.1],
          },
        },
      ],
      expression: "20*min(demanda, 70) - 12*70 + 5*max(70-demanda, 0)",
    });
    const mean = result.solution.metrics.mean;
    expect(Math.abs(mean - 458.75) / 458.75).toBeLessThan(0.05);
    const muestra = result.tables!.find((t) => t.name === "muestra")!;
    expect(muestra.columns).toEqual(["réplica", "demanda", "resultado"]);
    expect(muestra.rows).toHaveLength(15);
  });
});
