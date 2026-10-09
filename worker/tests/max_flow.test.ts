import { describe, expect, it } from "vitest";
import { solve } from "../src/modules/networks/solver";

type E = { source: string; target: string; capacity: number; weight: number };

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Corte mínimo por fuerza bruta: mínimo, sobre los subconjuntos que contienen S y no T, de la capacidad que sale. */
function bruteMinCut(nodes: string[], edges: E[], s: string, t: string, directed: boolean): number {
  const others = nodes.filter((n) => n !== s && n !== t);
  let best = Infinity;
  for (let mask = 0; mask < 1 << others.length; mask++) {
    const side = new Set([s, ...others.filter((_, i) => mask & (1 << i))]);
    let cut = 0;
    for (const e of edges) {
      if (e.source === e.target) continue;
      if (side.has(e.source) && !side.has(e.target)) cut += e.capacity;
      if (!directed && side.has(e.target) && !side.has(e.source)) cut += e.capacity;
    }
    best = Math.min(best, cut);
  }
  return best;
}

describe("flujo máximo: validación cruzada", () => {
  for (const directed of [true, false]) {
    it(`coincide con el corte mínimo por fuerza bruta y el flujo es factible (${directed ? "dirigida" : "no dirigida"})`, () => {
      const r = rng(directed ? 7 : 99);
      for (let k = 0; k < 400; k++) {
        const n = 3 + Math.floor(r() * 5);
        const nodes = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
        const edges: E[] = [];
        const m = 2 + Math.floor(r() * 12);
        for (let i = 0; i < m; i++) {
          const a = nodes[Math.floor(r() * n)];
          const b = nodes[Math.floor(r() * n)];
          const capacity = r() < 0.2 ? Math.round(r() * 40) / 8 : Math.floor(r() * 12);
          edges.push({ source: a, target: b, capacity, weight: capacity });
        }
        if (edges.every((e) => e.source === e.target)) continue;
        const s = nodes[0];
        const t = nodes[n - 1];
        const res = solve({ problem: "max_flow", nodes, edges, source: s, sink: t, directed });
        const expected = bruteMinCut(nodes, edges, s, t, directed);
        const label = `caso ${k}: ${JSON.stringify(edges)}`;
        expect(res.status, label).toBe("ok");
        expect(res.solution.metrics.max_flow, label).toBeCloseTo(expected, 9);
        expect(res.solution.metrics.min_cut_value, label).toBeCloseTo(expected, 9);

        // El flujo reportado es factible: capacidad por arco y conservación en cada nodo.
        const flows = (res.tables!.find((x) => x.name === "flows")!.rows as [string, string, number][]);
        const net: Record<string, number> = Object.fromEntries(nodes.map((x) => [x, 0]));
        const used = new Map<string, number>();
        for (const [u, v, f] of flows) {
          expect(f, label).toBeGreaterThan(0);
          net[u] -= f;
          net[v] += f;
          used.set(`${u}>${v}`, (used.get(`${u}>${v}`) ?? 0) + f);
        }
        for (const x of nodes) {
          if (x === s || x === t) continue;
          expect(Math.abs(net[x]), `${label} nodo ${x}`).toBeLessThan(1e-9);
        }
        expect(net[t], label).toBeCloseTo(expected, 9);
        const capOf = (u: string, v: string) =>
          edges.reduce(
            (a, e) =>
              a + ((e.source === u && e.target === v) || (!directed && e.source === v && e.target === u) ? e.capacity : 0),
            0,
          );
        for (const [key, f] of used) {
          const [u, v] = key.split(">");
          expect(f, `${label} arco ${key}`).toBeLessThanOrEqual(capOf(u, v) + 1e-9);
        }
        // El corte reportado suma el flujo máximo.
        const cut = res.tables!.find((x) => x.name === "min_cut")!.rows as [string, string, number][];
        expect(cut.reduce((a, row) => a + row[2], 0), label).toBeCloseTo(expected, 9);
        // El gráfico muestra el flujo de cada arista (en cualquier sentido).
        const g = res.graph as unknown as { edges: { source: string; target: string; flow: number }[] };
        const shown = g.edges.reduce((a, e) => a + e.flow, 0);
        const real = flows.reduce((a, row) => a + row[2], 0);
        expect(shown, `${label} (gráfico)`).toBeCloseTo(real, 9);
      }
    });
  }
});

describe("flujo máximo: casos especiales", () => {
  it("arcos paralelos: se suman en el flujo y el gráfico no los duplica", () => {
    const res = solve({
      problem: "max_flow",
      nodes: ["S", "T"],
      edges: [
        { source: "S", target: "T", capacity: 3, weight: 3 },
        { source: "S", target: "T", capacity: 4, weight: 4 },
      ],
      source: "S",
      sink: "T",
    });
    expect(res.solution.metrics.max_flow).toBe(7);
    const g = res.graph as unknown as { edges: { flow: number; capacity: number }[] };
    expect(g.edges).toEqual([expect.objectContaining({ source: "S", target: "T", flow: 7, capacity: 7 })]);
  });

  it("arcos en sentidos opuestos en una red dirigida son independientes", () => {
    const res = solve({
      problem: "max_flow",
      nodes: ["S", "A", "T"],
      edges: [
        { source: "S", target: "A", capacity: 5 },
        { source: "A", target: "S", capacity: 9 },
        { source: "A", target: "T", capacity: 4 },
        { source: "T", target: "A", capacity: 9 },
      ],
      source: "S",
      sink: "T",
    });
    expect(res.solution.metrics.max_flow).toBe(4);
    expect(res.solution.variables).toEqual({ "S->A": 4, "A->T": 4 });
  });

  it("red no dirigida: el gráfico orienta la arista en el sentido del flujo", () => {
    const res = solve({
      problem: "max_flow",
      nodes: ["S", "A", "T"],
      edges: [
        { source: "A", target: "S", capacity: 4 },
        { source: "T", target: "A", capacity: 3 },
      ],
      source: "S",
      sink: "T",
      directed: false,
    });
    expect(res.solution.metrics.max_flow).toBe(3);
    const g = res.graph as unknown as { edges: { source: string; target: string; flow: number }[] };
    expect(g.edges).toEqual([
      expect.objectContaining({ source: "S", target: "A", flow: 3 }),
      expect.objectContaining({ source: "A", target: "T", flow: 3 }),
    ]);
  });

  it("sin camino de origen a destino: flujo 0 con aviso", () => {
    const res = solve({
      problem: "max_flow",
      nodes: ["S", "A", "T"],
      edges: [{ source: "S", target: "A", capacity: 4 }],
      source: "S",
      sink: "T",
    });
    expect(res.solution.metrics.max_flow).toBe(0);
    expect(res.warnings[0]).toContain("No hay ningún camino");
  });

  it("decimales: sin ruido de punto flotante", () => {
    const res = solve({
      problem: "max_flow",
      nodes: ["S", "A", "B", "T"],
      edges: [
        { source: "S", target: "A", capacity: 0.1 },
        { source: "S", target: "B", capacity: 0.2 },
        { source: "A", target: "T", capacity: 1 },
        { source: "B", target: "T", capacity: 1 },
      ],
      source: "S",
      sink: "T",
    });
    expect(res.solution.metrics.max_flow).toBe(0.3);
  });

  it("red de la Seervada: flujo máximo 14 con iteraciones y tabla de arcos", () => {
    const res = solve({
      problem: "max_flow",
      nodes: ["O", "A", "B", "C", "D", "E", "T"],
      edges: [
        { source: "O", target: "A", capacity: 5 },
        { source: "O", target: "B", capacity: 7 },
        { source: "O", target: "C", capacity: 4 },
        { source: "A", target: "B", capacity: 1 },
        { source: "A", target: "D", capacity: 3 },
        { source: "B", target: "C", capacity: 2 },
        { source: "B", target: "D", capacity: 4 },
        { source: "B", target: "E", capacity: 5 },
        { source: "C", target: "E", capacity: 4 },
        { source: "D", target: "T", capacity: 9 },
        { source: "E", target: "D", capacity: 1 },
        { source: "E", target: "T", capacity: 6 },
      ],
      source: "O",
      sink: "T",
    });
    expect(res.solution.metrics.max_flow).toBe(14);
    expect(res.solution.metrics.min_cut_value).toBe(14);
    const last = res.iterations!.at(-1)!;
    expect(last.title).toContain("Sin caminos de aumento");
    expect(res.iterations![0].tableau![0]).toEqual(["Arco", "Capacidad", "Flujo", "Disponible"]);
  });

  it("rechaza capacidades no numéricas o negativas", () => {
    const base = { problem: "max_flow", nodes: ["S", "T"], source: "S", sink: "T" };
    expect(() => solve({ ...base, edges: [{ source: "S", target: "T", capacity: "abc" }] })).toThrow(/no es un número/);
    expect(() => solve({ ...base, edges: [{ source: "S", target: "T", capacity: -2 }] })).toThrow(/mayor o igual que 0/);
    expect(() => solve({ ...base, edges: [{ source: "S", target: "Z", capacity: 2 }] })).toThrow(/no está en la lista/);
    expect(() => solve({ ...base, edges: [{ target: "T", capacity: 2 }] })).toThrow(/origen y destino/);
  });
});
