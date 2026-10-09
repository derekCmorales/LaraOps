import { describe, expect, it } from "vitest";
import { solve } from "../src/modules/networks/solver";

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const names = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}

function randomMatrix(r: () => number, n: number, asym: boolean): number[][] {
  const D = Array.from({ length: n }, () => Array.from({ length: n }, () => 1 + Math.floor(r() * 30)));
  for (let i = 0; i < n; i++) {
    D[i][i] = 0;
    if (!asym) for (let j = 0; j < i; j++) D[i][j] = D[j][i];
  }
  return D;
}

describe("TSP", () => {
  it("exacto: coincide con la fuerza bruta (simétrico y asimétrico)", () => {
    const r = rng(21);
    for (let k = 0; k < 60; k++) {
      const n = 3 + Math.floor(r() * 5);
      const D = randomMatrix(r, n, k % 2 === 1);
      let best = Infinity;
      for (const p of permutations(Array.from({ length: n - 1 }, (_, i) => i + 1))) {
        const t = [0, ...p, 0];
        best = Math.min(best, t.slice(0, -1).reduce((s, x, i) => s + D[x][t[i + 1]], 0));
      }
      const res = solve({ problem: "tsp", nodes: names(n), distance_matrix: D, tsp_method: "exact" });
      expect(res.solution.metrics.tour_length, `caso ${k}`).toBe(best);
    }
  });

  it("heurística: recorrido válido, longitud coherente y casi siempre óptimo (también asimétrico)", () => {
    const r = rng(5);
    let optimal = 0;
    const total = 80;
    for (let k = 0; k < total; k++) {
      const n = 4 + Math.floor(r() * 5);
      const D = randomMatrix(r, n, k % 2 === 1);
      const exact = solve({ problem: "tsp", nodes: names(n), distance_matrix: D, tsp_method: "exact" });
      const heur = solve({ problem: "tsp", nodes: names(n), distance_matrix: D, tsp_method: "heuristic" });
      const rows = heur.tables![0].rows as [number, string, number, number][];
      const tour = rows.map((row) => row[1]);
      expect(tour[0]).toBe("A");
      expect(tour.at(-1)).toBe("A");
      expect([...tour.slice(0, -1)].sort()).toEqual(names(n));
      const len = tour.slice(0, -1).reduce((s, x, i) => s + D[x.charCodeAt(0) - 65][tour[i + 1].charCodeAt(0) - 65], 0);
      expect(heur.solution.metrics.tour_length).toBe(len);
      expect(rows.at(-1)![3]).toBe(len);
      expect(len).toBeGreaterThanOrEqual(exact.solution.metrics.tour_length);
      if (len === exact.solution.metrics.tour_length) optimal++;
    }
    expect(optimal / total).toBeGreaterThan(0.85);
  });

  it("heurística con 25 ciudades termina y da un ciclo completo", () => {
    const r = rng(8);
    const D = randomMatrix(r, 25, true);
    const res = solve({ problem: "tsp", nodes: names(25), distance_matrix: D, tsp_method: "heuristic" });
    expect(res.tables![0].rows).toHaveLength(26);
    expect(res.iterations!.length).toBeGreaterThan(0);
  });

  it("el gráfico lista los nodos en orden de recorrido", () => {
    const res = solve({
      problem: "tsp",
      nodes: ["A", "B", "C", "D"],
      distance_matrix: [
        [0, 1, 9, 1],
        [1, 0, 1, 9],
        [9, 1, 0, 1],
        [1, 9, 1, 0],
      ],
    });
    const g = res.graph as unknown as { nodes: { id: string; kind: string }[]; layout: string };
    expect(res.solution.metrics.tour_length).toBe(4);
    expect(g.layout).toBe("circle");
    expect(g.nodes[0]).toMatchObject({ id: "A", kind: "inicio" });
    expect(g.nodes).toHaveLength(4);
  });

  it("rechaza lista de nodos y matriz de distinto tamaño", () => {
    expect(() =>
      solve({ problem: "tsp", nodes: ["A", "B"], distance_matrix: [[0, 1, 2], [1, 0, 3], [2, 3, 0]] }),
    ).toThrow(/mismo tamaño/);
  });
});

describe("ruta más corta", () => {
  it("coincide con Floyd–Warshall (dirigida y no dirigida)", () => {
    const r = rng(33);
    for (let k = 0; k < 300; k++) {
      const directed = k % 2 === 0;
      const n = 3 + Math.floor(r() * 5);
      const nodes = names(n);
      const edges: { source: string; target: string; weight: number }[] = [];
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          if (i !== j && r() < 0.4) edges.push({ source: nodes[i], target: nodes[j], weight: Math.floor(r() * 9) });
      if (!edges.length) continue;
      const INF = Infinity;
      const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : INF)));
      for (const e of edges) {
        const i = e.source.charCodeAt(0) - 65;
        const j = e.target.charCodeAt(0) - 65;
        d[i][j] = Math.min(d[i][j], e.weight);
        if (!directed) d[j][i] = Math.min(d[j][i], e.weight);
      }
      for (let m = 0; m < n; m++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) d[i][j] = Math.min(d[i][j], d[i][m] + d[m][j]);
      const expected = d[0][n - 1];
      if (!Number.isFinite(expected)) {
        expect(() => solve({ problem: "shortest_path", nodes, edges, source: "A", sink: nodes[n - 1], directed })).toThrow(/No hay ruta/);
        continue;
      }
      const res = solve({ problem: "shortest_path", nodes, edges, source: "A", sink: nodes[n - 1], directed });
      expect(res.solution.metrics.path_length, `caso ${k}`).toBe(expected);
    }
  });

  it("pesos negativos: Bellman-Ford con pasadas y aviso", () => {
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
    expect(res.solution.metrics.path_length).toBe(1);
    expect(res.iterations!.length).toBeGreaterThan(0);
    expect(res.iterations![0].method).toBe("bellman_ford");
    expect(res.warnings.some((w) => w.includes("Bellman-Ford"))).toBe(true);
  });

  it("arcos de peso 0 también cuentan como rutas alternativas", () => {
    const res = solve({
      problem: "shortest_path",
      nodes: ["A", "B", "C", "T"],
      edges: [
        { source: "A", target: "B", weight: 0 },
        { source: "B", target: "T", weight: 3 },
        { source: "A", target: "C", weight: 1 },
        { source: "C", target: "T", weight: 2 },
      ],
      source: "A",
      sink: "T",
      directed: true,
    });
    expect(res.solution.metrics.path_length).toBe(3);
    expect(res.warnings[0]).toContain("A → B → T");
    expect(res.warnings[0]).toContain("A → C → T");
  });

  it("de varios arcos paralelos solo se resalta el más barato", () => {
    const res = solve({
      problem: "shortest_path",
      nodes: ["A", "B"],
      edges: [
        { source: "A", target: "B", weight: 5 },
        { source: "A", target: "B", weight: 2 },
      ],
      source: "A",
      sink: "B",
    });
    const g = res.graph as unknown as { edges: { weight: number; critical: boolean }[] };
    expect(g.edges.map((e) => [e.weight, e.critical])).toEqual([
      [5, false],
      [2, true],
    ]);
  });

  it("rechaza pesos que no son números", () => {
    expect(() =>
      solve({ problem: "shortest_path", nodes: ["A", "B"], edges: [{ source: "A", target: "B", weight: "x" }], source: "A", sink: "B" }),
    ).toThrow(/no es un número/);
  });
});

describe("árbol de expansión mínima", () => {
  it("coincide con Prim en grafos aleatorios", () => {
    const r = rng(77);
    for (let k = 0; k < 200; k++) {
      const n = 3 + Math.floor(r() * 6);
      const nodes = names(n);
      const edges: { source: string; target: string; weight: number }[] = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (r() < 0.6) edges.push({ source: nodes[i], target: nodes[j], weight: 1 + Math.floor(r() * 20) });
      // Prim
      const inTree = new Set([0]);
      let total = 0;
      let connected = true;
      while (inTree.size < n) {
        let best = Infinity;
        let pick = -1;
        for (const e of edges) {
          const a = e.source.charCodeAt(0) - 65;
          const b = e.target.charCodeAt(0) - 65;
          if (inTree.has(a) !== inTree.has(b) && e.weight < best) {
            best = e.weight;
            pick = inTree.has(a) ? b : a;
          }
        }
        if (pick < 0) {
          connected = false;
          break;
        }
        inTree.add(pick);
        total += best;
      }
      if (!connected) {
        expect(() => solve({ problem: "mst", nodes, edges, directed: false })).toThrow(/no es conexo/);
        continue;
      }
      expect(solve({ problem: "mst", nodes, edges, directed: false }).solution.metrics.mst_weight, `caso ${k}`).toBe(total);
    }
  });
});

describe("transbordo", () => {
  it("un nodo llamado «Ficticio» no choca con el destino ficticio", () => {
    const res = solve({
      problem: "transshipment",
      nodes: ["A", "Ficticio"],
      node_supply: { A: 10, Ficticio: -4 },
      edges: [{ source: "A", target: "Ficticio", weight: 2 }],
    });
    expect(res.status).toBe("ok");
    expect(res.solution.metrics.total_cost).toBe(8);
    expect(res.tables!.find((t) => t.name === "oferta_sin_enviar")!.rows).toEqual([["A", 6]]);
  });

  it("red no dirigida: el gráfico dibuja el flujo en su sentido real", () => {
    const res = solve({
      problem: "transshipment",
      nodes: ["A", "B"],
      node_supply: { A: -3, B: 3 },
      edges: [{ source: "A", target: "B", weight: 2 }],
      directed: false,
    });
    expect(res.solution.metrics.total_cost).toBe(6);
    const g = res.graph as unknown as { edges: { source: string; target: string; flow: number }[] };
    expect(g.edges).toEqual([expect.objectContaining({ source: "B", target: "A", flow: 3 })]);
  });

  it("rechaza ofertas que no son números", () => {
    expect(() =>
      solve({ problem: "transshipment", nodes: ["A", "B"], node_supply: { A: "x", B: -1 }, edges: [{ source: "A", target: "B", weight: 1 }] }),
    ).toThrow(/no es un número/);
  });
});
