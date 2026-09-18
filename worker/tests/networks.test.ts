import { describe, expect, it } from "vitest";
import { solve } from "../src/modules/networks/solver";
import { SolverError } from "../src/errors";
import { assertClose, loadFixture } from "./helpers";

describe("networks", () => {
  it("shortest path A-B-C-D", () => {
    const result = solve({
      problem: "shortest_path",
      nodes: ["A", "B", "C", "D"],
      edges: [
        { source: "A", target: "B", weight: 1 },
        { source: "A", target: "C", weight: 4 },
        { source: "B", target: "C", weight: 2 },
        { source: "B", target: "D", weight: 5 },
        { source: "C", target: "D", weight: 1 },
      ],
      source: "A",
      sink: "D",
      directed: true,
    });
    expect(result.status).toBe("ok");
    assertClose(result.solution.metrics.path_length, 4);
  });

  it("mst", () => {
    const result = solve({
      problem: "mst",
      nodes: ["A", "B", "C"],
      edges: [
        { source: "A", target: "B", weight: 1 },
        { source: "B", target: "C", weight: 2 },
        { source: "A", target: "C", weight: 5 },
      ],
      directed: false,
    });
    assertClose(result.solution.metrics.mst_weight, 3);
  });

  it("max flow = min cut", () => {
    const result = solve({
      problem: "max_flow",
      nodes: ["S", "A", "T"],
      edges: [
        { source: "S", target: "A", capacity: 10, weight: 10 },
        { source: "A", target: "T", capacity: 5, weight: 5 },
      ],
      source: "S",
      sink: "T",
    });
    assertClose(result.solution.metrics.max_flow, 5);
    assertClose(result.solution.metrics.min_cut_value, 5);
    expect(result.iterations?.length).toBeGreaterThan(0);
    expect(result.tables?.some((t) => t.name === "min_cut")).toBe(true);
  });

  it("transshipment min-cost flow", () => {
    const data = loadFixture("networks_01.json");
    const result = solve(data.request);
    expect(result.status).toBe("ok");
    assertClose(result.solution.metrics.total_cost, (data.expect as { total_cost: number }).total_cost);
  });

  it("unbalanced transshipment raises", () => {
    expect(() =>
      solve({
        problem: "transshipment",
        nodes: ["A", "B"],
        node_supply: { A: 10, B: -5 },
        edges: [{ source: "A", target: "B", weight: 1 }],
      }),
    ).toThrow(SolverError);
  });

  it("tsp exact", () => {
    const data = loadFixture("networks_02.json");
    const result = solve(data.request);
    expect(result.status).toBe("ok");
    assertClose(result.solution.metrics.tour_length, (data.expect as { tour_length: number }).tour_length);
  });

  it("tsp heuristic matches small exact", () => {
    const data = loadFixture("networks_02.json");
    const result = solve({ ...(data.request as object), tsp_method: "heuristic" });
    assertClose(result.solution.metrics.tour_length, (data.expect as { tour_length: number }).tour_length);
  });
});
