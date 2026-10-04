import { describe, expect, it } from "vitest";
import { DUMMY_DEST, DUMMY_SOURCE, solve } from "../src/modules/transport/solver";
import app from "../src/app";
import { assertClose, loadFixture } from "./helpers";

type Fixture = { request: Record<string, unknown>; expect: Record<string, unknown> };

function fixture(name: string): Fixture {
  return loadFixture(name) as unknown as Fixture;
}

describe("transport", () => {
  it("balances and matches textbook cost", () => {
    const data = fixture("transport_01.json");
    const result = solve(data.request);
    const expectData = data.expect as { objective_value: number; shipments: Record<string, number> };
    expect(result.status).toBe("optimal");
    expect(result.module).toBe("transport");
    assertClose(result.solution.objective_value ?? NaN, expectData.objective_value, 1e-4);
    expect(result.iterations?.length).toBeGreaterThan(0);
    for (const [key, qty] of Object.entries(expectData.shipments)) {
      assertClose(result.solution.variables[key] ?? NaN, qty, 1e-9);
    }
    expect(result.sensitivity?.reduced_costs.length).toBeGreaterThan(0);
    expect(result.tables?.map((t) => t.name)).toEqual(["costos", "envios", "resumen_origenes", "resumen_destinos"]);
  });

  it.each(["northwest", "least_cost", "vogel"])("%s matches the textbook initial cost and reports the gap", (method) => {
    const data = fixture("transport_02.json");
    const initial = (data.expect.initial_cost as Record<string, number>)[method];
    const result = solve({ ...data.request, method });
    expect(result.status).toBe("feasible");
    assertClose(result.solution.objective_value ?? NaN, initial);
    assertClose(result.solution.metrics.optimal_cost, 435);
    assertClose(result.solution.metrics.gap, initial - 435);
    expect(result.warnings[0]).toContain("no es óptima");
    const steps = result.iterations ?? [];
    expect(steps.at(-1)?.meta.phase).toBe("check");
    expect(steps.at(-1)?.meta.enter).not.toBeNull();
  });

  it("MODI reaches the textbook optimum and describes each cycle", () => {
    const result = solve(fixture("transport_02.json").request);
    expect(result.status).toBe("optimal");
    assertClose(result.solution.objective_value ?? NaN, 435);
    const pivots = (result.iterations ?? []).filter((s) => s.meta.phase === "modi" && s.meta.enter);
    expect(pivots.length).toBeGreaterThan(0);
    const signs = (pivots[0].meta.cycle as [number, number, number][]).map(([, , sgn]) => sgn);
    expect(signs).toEqual(signs.map((_, k) => (k % 2 === 0 ? 1 : -1)));
    const last = result.iterations!.at(-1)!;
    expect(last.meta.enter).toBeNull();
    for (const row of last.meta.reduced as (number | null)[][]) {
      for (const d of row) if (d != null) expect(d).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("Vogel records the degenerate zero allocation", () => {
    const result = solve({ ...fixture("transport_02.json").request, method: "vogel" });
    const steps = (result.iterations ?? []).filter((s) => s.meta.phase === "initial");
    expect(steps).toHaveLength(6);
    expect(steps.some((s) => s.meta.qty === 0)).toBe(true);
    expect(steps.at(-1)?.meta.basis).toHaveLength(6);
  });

  it("matches the LP optimum on the cross-check cases", () => {
    const data = loadFixture("transport_lp_cross_check.json") as {
      cases: { request: Record<string, unknown>; optimal: number | null }[];
    };
    for (const { request, optimal } of data.cases) {
      const result = solve(request);
      if (optimal == null) {
        expect(result.status).toBe("infeasible");
        expect(result.solution.objective_value).toBeNull();
        continue;
      }
      expect(result.status).not.toBe("infeasible");
      const got =
        request.method === "modi_auto" || result.status === "optimal"
          ? result.solution.objective_value
          : result.solution.metrics.optimal_cost;
      assertClose(got ?? NaN, optimal, 1e-6);
    }
  });

  it("adds a named dummy destination when supply exceeds demand", () => {
    const result = solve({
      supply: { A: 30, B: 30 },
      demand: { X: 20, Y: 25 },
      costs: { A: { X: 4, Y: 6 }, B: { X: 5, Y: 3 } },
    });
    expect(result.graph?.type === "matrix" && result.graph.col_labels.at(-1)).toBe(DUMMY_DEST);
    expect(result.warnings[0]).toContain("destino ficticio");
    assertClose(result.solution.metrics.unused_supply, 15);
    assertClose(result.solution.objective_value ?? NaN, 20 * 4 + 25 * 3);
  });

  it("reports unmet demand with a dummy source", () => {
    const result = solve({ supply: { A: 10 }, demand: { X: 8, Y: 7 }, costs: { A: { X: 1, Y: 2 } } });
    expect(result.graph?.type === "matrix" && result.graph.row_labels.at(-1)).toBe(DUMMY_SOURCE);
    assertClose(result.solution.metrics.unmet_demand, 5);
  });

  it("avoids forbidden routes and flags forced ones as infeasible", () => {
    const ok = solve({
      supply: { A: 10, B: 10 },
      demand: { X: 10, Y: 10 },
      costs: { A: { Y: 5 }, B: { X: 7, Y: 1 } },
      forbidden_routes: [["A", "X"]],
    });
    expect(ok.status).toBe("optimal");
    expect(ok.solution.variables["A->X"]).toBeUndefined();
    assertClose(ok.solution.objective_value ?? NaN, 120);

    const bad = solve({
      supply: { A: 10 },
      demand: { X: 5, Y: 5 },
      costs: { A: { X: 1 } },
      forbidden_routes: [["A", "Y"]],
    });
    expect(bad.status).toBe("infeasible");
    expect(bad.solution.objective_value).toBeNull();
  });

  it("maximizes profit and reports reduced costs in the original sense", () => {
    const result = solve({
      supply: { A: 20, B: 30 },
      demand: { X: 10, Y: 40 },
      costs: { A: { X: 2, Y: 3 }, B: { X: 4, Y: 1 } },
      objective: "maximize",
    });
    expect(result.solution.objective_sense).toBe("max");
    assertClose(result.solution.objective_value ?? NaN, 120);
    for (const r of result.sensitivity!.reduced_costs) expect(Number(r.reduced_cost)).toBeLessThanOrEqual(1e-9);
  });

  it.each([
    [{ supply: { A: 5 }, demand: { X: 5 }, costs: { A: {} } }, "Falta el costo de la ruta A -> X"],
    [{ supply: { A: -1 }, demand: { X: 5 }, costs: { A: { X: 1 } } }, "no puede ser negativa"],
    [{ supply: {}, demand: { X: 5 }, costs: {} }, "al menos un origen"],
    [{ supply: { A: 0 }, demand: { X: 0 }, costs: { A: { X: 1 } } }, "oferta total es 0"],
    [{ supply: { A: 5 }, demand: { X: 5 }, costs: { A: { X: "abc" } } }, "debe ser un número"],
    [{ supply: { A: 5 }, demand: { X: 5 }, costs: { A: { X: 1 } }, forbidden_routes: [["Z", "X"]] }, "no corresponde"],
  ])("rejects invalid models with a readable message", (payload, message) => {
    expect(() => solve(payload)).toThrow(message);
  });

  it("returns 400 from the API for an invalid model", async () => {
    const res = await app.request("/api/v1/modules/transport/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ supply: { A: 5 }, demand: { X: 5 }, costs: { A: {} } }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { detail: string }).detail).toContain("Falta el costo");
  });
});
