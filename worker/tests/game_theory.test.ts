import { describe, expect, it } from "vitest";
import { SolverError } from "../src/errors";
import { solve } from "../src/modules/game_theory/solver";
import type { ModuleResult } from "../src/schema";
import { assertClose, loadFixture } from "./helpers";

function table(result: ModuleResult, name: string) {
  const found = result.tables?.find((t) => t.name === name);
  expect(found, name).toBeTruthy();
  return found!;
}

function tableText(result: ModuleResult, name: string): string {
  return table(result, name)
    .rows.map((row) => row.map((cell) => String(cell)).join(" "))
    .join("\n");
}

function probSum(result: ModuleResult, prefix: "p:" | "q:"): number {
  return Object.entries(result.solution.variables)
    .filter(([key]) => key.startsWith(prefix))
    .reduce((sum, [, value]) => sum + value, 0);
}

describe("game theory", () => {
  it("game_01 equilibrio mixto 2x2", () => {
    const data = loadFixture("game_01.json");
    const result = solve(data.request);
    expect(result.status).toBe("ok");
    expect(result.module).toBe("game_theory");
    expect(result.tables?.some((t) => t.name === "estrategia_mixta")).toBe(true);
    expect(result.solution.metrics.game_value).toBeTypeOf("number");
    assertClose(result.solution.metrics.game_value, 0.2, 1e-9);
    assertClose(result.solution.objective_value ?? NaN, 0.2, 1e-9);
    expect(result.solution.objective_sense).toBe("max");
    assertClose(result.solution.variables["p:R1"], 0.4, 1e-9);
    assertClose(result.solution.variables["p:R2"], 0.6, 1e-9);
    assertClose(result.solution.variables["q:C1"], 0.4, 1e-9);
    assertClose(result.solution.variables["q:C2"], 0.6, 1e-9);
    assertClose(probSum(result, "p:"), 1, 1e-9);
    assertClose(probSum(result, "q:"), 1, 1e-9);
  });

  it("game_02 punto de silla puro", () => {
    const data = loadFixture("game_02.json");
    const result = solve(data.request);
    const expectData = data.expect as { game_value: number };
    assertClose(result.solution.metrics.game_value, expectData.game_value);
    expect(Object.keys(result.solution.variables).some((key) => key.startsWith("pure:"))).toBe(true);
    expect(result.solution.variables["pure:R1->C2"]).toBe(1);
    assertClose(result.solution.metrics.maximin, 2);
    assertClose(result.solution.metrics.minimax, 2);
    expect(result.solution.objective_sense).toBe("max");
  });

  it("game_03 piedra papel tijera por programación lineal", () => {
    const data = loadFixture("game_03.json");
    const result = solve(data.request);
    const expectData = data.expect as { game_value: number; p: Record<string, number> };
    assertClose(result.solution.metrics.game_value, expectData.game_value, 1e-4);
    for (const [strategy, prob] of Object.entries(expectData.p)) {
      assertClose(result.solution.variables[`p:${strategy}`], prob, 1e-4);
    }
    assertClose(probSum(result, "p:"), 1, 1e-6);
    assertClose(probSum(result, "q:"), 1, 1e-6);
  });

  it("game_04 elimina la fila dominada y deja el valor 2.5", () => {
    const data = loadFixture("game_04.json");
    const result = solve(data.request);
    const expectData = data.expect as { game_value: number; eliminated_row: string };
    assertClose(result.solution.metrics.game_value, expectData.game_value, 1e-4);
    expect(result.iterations?.length).toBeGreaterThan(0);
    const eliminated = (result.iterations ?? [])
      .filter((step) => step.method === "dominance")
      .map((step) => String(step.meta.strategy));
    expect(eliminated).toContain(expectData.eliminated_row);
    const reduced = table(result, "reduced_payoff");
    expect(reduced.rows.map((row) => row[0])).not.toContain("R2");
  });

  it("juego 2xn grafica solo las columnas que sobreviven", () => {
    const result = solve({
      row_strategies: ["R1", "R2"],
      col_strategies: ["C1", "C2", "C3"],
      payoff: [
        [4, 2, 6],
        [1, 5, 3],
      ],
    });
    expect(result.graph?.type).toBe("xy");
    if (result.graph?.type !== "xy") throw new Error("se esperaba un gráfico xy");
    const series = result.graph.series.map((s) => ({
      name: String(s.name),
      x: s.x as number[],
      y: s.y as number[],
    }));
    // C1 = [4, 1] domina a C3 = [6, 3] porque es menor en las dos filas. C2 no está dominada.
    // Después de las rectas vienen la envolvente inferior y el punto óptimo.
    expect(series).toHaveLength(4);
    expect(series.slice(0, 2).map((s) => s.name)).toEqual(["C1", "C2"]);
    expect(series[2].name).toMatch(/^Envolvente inferior/);
    expect(series[3].name).toBe("Óptimo");
    // La fila juega R1 con 2/3: ahí la envolvente toca su pico, que es el valor 3.
    assertClose(series[3].x[0], 2 / 3, 1e-9);
    assertClose(series[3].y[0], 3, 1e-9);
    const peak = Math.max(...series[2].y);
    assertClose(peak, 3, 1e-9);
    expect(series[0].x).toEqual([0, 1]);
    expect(series[0].y).toEqual([1, 4]);
    expect(series[1].y).toEqual([5, 2]);
    expect(result.graph && "x_label" in result.graph && result.graph.x_label).toBe("P(R1)");
    expect(result.graph && "y_label" in result.graph && result.graph.y_label).toBe("Pago esperado");
    assertClose(result.solution.metrics.game_value, 3, 1e-6);
  });

  it("pagos negativos: el desplazamiento no cambia el valor", () => {
    const base = solve({
      row_strategies: ["R1", "R2"],
      col_strategies: ["C1", "C2", "C3"],
      payoff: [
        [4, 2, 3],
        [1, 5, 3],
      ],
    });
    const shifted = solve({
      row_strategies: ["R1", "R2"],
      col_strategies: ["C1", "C2", "C3"],
      payoff: [
        [0, -2, -1],
        [-3, 1, -1],
      ],
    });
    assertClose(base.solution.metrics.game_value, 3, 1e-4);
    assertClose(shifted.solution.metrics.game_value, -1, 1e-4);
    assertClose(shifted.solution.variables["p:R1"], 2 / 3, 1e-4);
    assertClose(probSum(shifted, "p:"), 1, 1e-6);
    assertClose(probSum(shifted, "q:"), 1, 1e-6);
    const note = tableText(shifted, "formulacion_lp");
    expect(note).toMatch(/Desplazamiento/);
    expect(note).toContain("v'");
  });

  it("varias sillas puras", () => {
    const result = solve({
      row_strategies: ["R1", "R2"],
      col_strategies: ["C1", "C2", "C3"],
      payoff: [
        [1, 2, 1],
        [0, 3, 0],
      ],
    });
    assertClose(result.solution.metrics.game_value, 1);
    expect(result.solution.variables["pure:R1->C1"]).toBe(1);
    expect(result.solution.variables["pure:R1->C3"]).toBe(1);
    expect(result.solution.variables["pure:R1->C2"]).toBeUndefined();
    const saddles = table(result, "punto_silla_puro");
    expect(saddles.rows).toHaveLength(2);
  });

  it("elimina solo si hay mejora estricta en alguna columna", () => {
    const weak = solve({
      row_strategies: ["A", "B"],
      col_strategies: ["X", "Y"],
      payoff: [
        [1, 2],
        [1, 3],
      ],
    });
    const eliminated = (weak.iterations ?? []).filter((step) => step.method === "dominance").map((step) => String(step.meta.strategy));
    expect(eliminated).toContain("A");
    expect(eliminated).not.toContain("B");
  });

  it("dominancia débil no elimina", () => {
    const equal = solve({
      row_strategies: ["A", "B"],
      col_strategies: ["X", "Y"],
      payoff: [
        [3, 3],
        [3, 3],
      ],
    });
    expect(equal.iterations ?? []).toHaveLength(0);

    const cross = solve({
      row_strategies: ["A", "B"],
      col_strategies: ["X", "Y"],
      payoff: [
        [1, 4],
        [3, 2],
      ],
    });
    expect(cross.iterations ?? []).toHaveLength(0);
    expect(cross.solution.variables["p:A"]).toBeTypeOf("number");
    expect(cross.solution.variables["p:B"]).toBeTypeOf("number");
  });

  it("pago esperado del soporte iguala el valor del juego", () => {
    const data = loadFixture("game_01.json");
    const result = solve(data.request);
    const value = result.solution.metrics.game_value;
    const supportCols = new Set(
      Object.entries(result.solution.variables)
        .filter(([key, prob]) => key.startsWith("q:") && prob > 1e-8)
        .map(([key]) => key.slice(2)),
    );
    expect(supportCols.size).toBeGreaterThan(0);
    const rows = table(result, "pago_esperado").rows.filter((row) => row[0] === "fila");
    for (const row of rows) {
      if (!supportCols.has(String(row[1]))) continue;
      assertClose(Number(row[2]), value, 1e-6);
      expect(row[3]).toBe("sí");
    }
  });

  it("formulacion_lp contiene v y los nombres, también con punto de silla", () => {
    const mixed = solve(loadFixture("game_01.json").request);
    const text = tableText(mixed, "formulacion_lp");
    expect(text).toContain("v");
    expect(text).toContain("max v");
    expect(text).toContain("R1");
    expect(text).toContain("R2");
    expect(text).toContain("C1");
    expect(text).toContain("C2");

    const saddle = solve(loadFixture("game_02.json").request);
    const saddleText = tableText(saddle, "formulacion_lp");
    expect(saddleText).toContain("v");
    expect(saddleText).toContain("R1");
    expect(saddleText).toContain("C2");
  });

  it("rechaza una matriz que no es rectangular", () => {
    expect(() =>
      solve({
        row_strategies: ["A", "B"],
        col_strategies: ["X", "Y"],
        payoff: [[1, 2], [3]],
      }),
    ).toThrow(SolverError);
    try {
      solve({
        row_strategies: ["A", "B"],
        col_strategies: ["X", "Y"],
        payoff: [[1, 2], [3]],
      });
    } catch (err) {
      expect(err).toBeInstanceOf(SolverError);
      expect((err as Error).message).toMatch(/rectangular/i);
    }
  });

  it("rechaza nombres vacíos, duplicados y celdas que no son números", () => {
    expect(() =>
      solve({ row_strategies: ["A", ""], col_strategies: ["X"], payoff: [[1], [2]] }),
    ).toThrow(SolverError);
    expect(() =>
      solve({ row_strategies: ["A", "A"], col_strategies: ["X"], payoff: [[1], [2]] }),
    ).toThrow(SolverError);
    expect(() =>
      solve({ row_strategies: ["A"], col_strategies: ["X"], payoff: [["no"]] }),
    ).toThrow(SolverError);
    expect(() =>
      solve({
        row_strategies: Array.from({ length: 13 }, (_, i) => `F${i}`),
        col_strategies: ["C"],
        payoff: Array.from({ length: 13 }, () => [1]),
      }),
    ).toThrow(SolverError);
  });
});

describe("game theory: método gráfico m×2", () => {
  it("la envolvente superior baja hasta el valor en la mezcla de la columna", () => {
    const result = solve({
      row_strategies: ["R1", "R2", "R3"],
      col_strategies: ["C1", "C2"],
      payoff: [
        [3, -1],
        [-2, 4],
        [0, 1],
      ],
    });
    if (result.graph?.type !== "xy") throw new Error("se esperaba un gráfico xy");
    const env = result.graph.series.find((s) => String(s.name).startsWith("Envolvente superior"));
    const opt = result.graph.series.find((s) => s.name === "Óptimo");
    expect(env).toBeTruthy();
    expect(opt).toBeTruthy();
    const value = result.solution.metrics.game_value;
    assertClose(Math.min(...(env!.y as number[])), value, 1e-9);
    assertClose((opt!.y as number[])[0], value, 1e-9);
  });
});
