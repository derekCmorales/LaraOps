import { describe, expect, it } from "vitest";
import { solve } from "../src/modules/networks/solver";
import type { IterationView } from "../src/schema";

type G = { nodes: { id: string }[]; edges: { source: string; target: string; flow?: number }[] };

const SEERVADA = [
  ["O", "A", 5], ["O", "B", 7], ["O", "C", 4], ["A", "B", 1], ["A", "D", 3], ["B", "C", 2],
  ["B", "D", 4], ["B", "E", 5], ["C", "E", 4], ["D", "T", 9], ["E", "D", 1], ["E", "T", 6],
] as const;
const NODES = ["O", "A", "B", "C", "D", "E", "T"];

/** Cada cuadro debe estar alineado con los nodos y arcos del gráfico final. */
function checkAlignment(res: ReturnType<typeof solve>) {
  const g = res.graph as unknown as G;
  expect(res.iterations!.length).toBeGreaterThan(0);
  for (const it of res.iterations!) {
    const v = it.view as IterationView | undefined;
    expect(v, it.title).toBeTruthy();
    for (const key of ["node_tone", "node_sub"] as const) if (v![key]) expect(v![key]!.length, `${it.title} ${key}`).toBe(g.nodes.length);
    if (!v!.edges) {
      for (const key of ["edge_flow", "edge_on", "edge_hot", "edge_dashed"] as const) {
        if (v![key]) expect(v![key]!.length, `${it.title} ${key}`).toBe(g.edges.length);
      }
    }
  }
}

describe("pasos con grafo", () => {
  const maxFlow = (directed = true) =>
    solve({
      problem: "max_flow",
      nodes: NODES,
      edges: SEERVADA.map(([source, target, capacity]) => ({ source, target, capacity })),
      source: "O",
      sink: "T",
      directed,
    });

  it("flujo máximo: el flujo crece paso a paso hasta el del gráfico final", () => {
    const res = maxFlow();
    checkAlignment(res);
    const steps = res.iterations!;
    expect(steps[0].view!.edge_flow!.every((f) => f === 0)).toBe(true);
    expect(steps[0].title).toContain("Red inicial");
    for (let i = 1; i < steps.length - 1; i++) {
      expect(steps[i].view!.edge_hot!.some(Boolean), steps[i].title).toBe(true);
      expect(steps[i].view!.node_tone!.filter((t) => t === "crit").length).toBeGreaterThanOrEqual(2);
    }
    const g = res.graph as unknown as G;
    const last = steps.at(-1)!.view!.edge_flow!;
    expect(last).toEqual(g.edges.map((e) => e.flow));
    // El flujo que sale del origen en el último cuadro es el flujo máximo.
    const out = g.edges.reduce((a, e, j) => a + (e.source === "O" ? last[j] : e.target === "O" ? -last[j] : 0), 0);
    expect(out).toBe(14);
  });

  it("flujo máximo no dirigido: los cuadros usan el mismo sentido que el gráfico (negativo = al revés)", () => {
    const res = maxFlow(false);
    checkAlignment(res);
    const g = res.graph as unknown as G;
    const last = res.iterations!.at(-1)!.view!.edge_flow!;
    expect(last.map(Math.abs)).toEqual(g.edges.map((e) => e.flow));
    expect(last.every((f) => f >= 0)).toBe(true); // el gráfico final ya se orienta según el flujo
  });

  it("un camino de aumento puede devolver flujo: el arco cancelado va punteado", () => {
    const res = solve({
      problem: "max_flow",
      nodes: ["S", "A", "B", "T", "X", "Y"],
      edges: [
        { source: "S", target: "A", capacity: 1 },
        { source: "S", target: "X", capacity: 1 },
        { source: "A", target: "B", capacity: 1 },
        { source: "A", target: "Y", capacity: 1 },
        { source: "X", target: "B", capacity: 1 },
        { source: "B", target: "T", capacity: 1 },
        { source: "Y", target: "T", capacity: 1 },
      ],
      source: "S",
      sink: "T",
    });
    checkAlignment(res);
    expect(res.solution.metrics.max_flow).toBe(2);
    const g = res.graph as unknown as G;
    const ab = g.edges.findIndex((e) => e.source === "A" && e.target === "B");
    const steps = res.iterations!;
    // Paso 1: S→A→B→T (A→B lleva 1). Paso 2: S→X→B→A→Y→T devuelve ese flujo.
    expect(steps[1].title).toContain("S → A → B → T");
    expect(steps[1].view!.edge_flow![ab]).toBe(1);
    expect(steps[2].title).toContain("S → X → B → A → Y → T");
    expect(steps[2].view!.edge_flow![ab]).toBe(0);
    expect(steps[2].view!.edge_dashed![ab]).toBe(true);
    expect(steps[2].view!.edge_hot![ab]).toBe(true);
  });

  it("Dijkstra: en cada paso hay un nodo recién resuelto y el árbol crece", () => {
    const res = solve({
      problem: "shortest_path",
      nodes: NODES,
      edges: [
        ["O", "A", 2], ["O", "B", 5], ["O", "C", 4], ["A", "B", 2], ["A", "D", 7], ["B", "C", 1],
        ["B", "D", 4], ["B", "E", 3], ["C", "E", 4], ["D", "E", 1], ["D", "T", 5], ["E", "T", 7],
      ].map(([source, target, weight]) => ({ source, target, weight })),
      source: "O",
      sink: "T",
      directed: false,
    });
    checkAlignment(res);
    res.iterations!.forEach((it, i) => {
      const v = it.view!;
      expect(v.node_tone!.filter((t) => t === "crit")).toHaveLength(1);
      expect(v.node_tone!.filter((t) => t === "flow" || t === "crit")).toHaveLength(i + 2);
      expect(v.edge_hot!.filter(Boolean)).toHaveLength(1);
      expect(v.edge_on!.filter(Boolean)).toHaveLength(i);
    });
  });

  it("Bellman-Ford: cuadros alineados", () => {
    const res = solve({
      problem: "shortest_path",
      nodes: ["A", "B", "C", "D"],
      edges: [
        { source: "A", target: "B", weight: 4 },
        { source: "A", target: "C", weight: 2 },
        { source: "C", target: "B", weight: -3 },
        { source: "B", target: "D", weight: 2 },
      ],
      source: "A",
      sink: "D",
      directed: true,
    });
    checkAlignment(res);
  });

  it("Kruskal: aristas aceptadas, la actual y su decisión", () => {
    const res = solve({
      problem: "mst",
      nodes: NODES,
      edges: [
        ["O", "A", 2], ["O", "B", 5], ["O", "C", 4], ["A", "B", 2], ["A", "D", 7], ["B", "C", 1],
        ["B", "D", 4], ["B", "E", 3], ["C", "E", 4], ["D", "E", 1], ["D", "T", 5], ["E", "T", 7],
      ].map(([source, target, weight]) => ({ source, target, weight })),
      directed: false,
    });
    checkAlignment(res);
    expect(res.solution.metrics.mst_weight).toBe(14);
    const steps = res.iterations!;
    expect(steps[0].tableau![0]).toEqual(["Arista", "Peso", "Decisión"]);
    steps.forEach((it, i) => {
      expect(it.view!.edge_hot!.filter(Boolean), it.title).toHaveLength(1);
      expect(it.view!.edge_hot![i]).toBe(true);
      expect(it.view!.edge_dashed![i]).toBe(it.title.startsWith("Rechaza"));
    });
    const last = steps.at(-1)!;
    expect(last.view!.edge_on!.filter(Boolean).length + (last.title.startsWith("Acepta") ? 1 : 0)).toBe(6);
  });

  it("transbordo (simplex de redes): el último cuadro tiene el flujo óptimo", () => {
    const res = solve({
      problem: "transshipment",
      nodes: ["A", "B", "C", "D", "E"],
      edges: [
        { source: "A", target: "B", weight: 2, capacity: 10 },
        { source: "A", target: "C", weight: 4 },
        { source: "A", target: "D", weight: 9 },
        { source: "B", target: "C", weight: 3 },
        { source: "C", target: "E", weight: 1, capacity: 80 },
        { source: "D", target: "E", weight: 3 },
        { source: "E", target: "D", weight: 2 },
      ],
      node_supply: { A: 50, B: 40, C: 0, D: -30, E: -60 },
    });
    checkAlignment(res);
    const g = res.graph as unknown as G;
    const steps = res.iterations!;
    expect(steps.at(-1)!.view!.edge_flow).toEqual(g.edges.map((e) => e.flow));
    for (const it of steps.slice(0, -1)) {
      expect(it.view!.edge_hot!.some(Boolean), it.title).toBe(true);
    }
    expect(steps[0].view!.node_sub![0]).toBe("oferta 50");
  });

  it("viajante heurístico: cada paso trae el recorrido completo", () => {
    let seed = 3;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const n = 12;
    const D = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 1 + Math.floor(r() * 40))));
    const res = solve({ problem: "tsp", nodes: Array.from({ length: n }, (_, i) => `N${i}`), distance_matrix: D, tsp_method: "heuristic" });
    expect(res.iterations!.length).toBeGreaterThan(1);
    for (const it of res.iterations!) {
      expect(it.view!.edges).toHaveLength(n);
      expect(it.view!.edges!.filter((e) => e.critical).length).toBeGreaterThan(0);
    }
    expect(res.iterations![0].view!.edges!.every((e) => e.critical)).toBe(true);
  });
});
