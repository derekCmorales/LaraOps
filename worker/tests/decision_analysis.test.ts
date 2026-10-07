import { describe, expect, it } from "vitest";
import { SolverError } from "../src/errors";
import { solve } from "../src/modules/decision_analysis/solver";
import type { ModuleResult, NamedTable } from "../src/schema";
import { assertClose, loadFixture } from "./helpers";

function table(result: ModuleResult, name: string): NamedTable {
  const found = result.tables?.find((item) => item.name === name);
  if (!found) throw new Error(`falta la tabla ${name}`);
  return found;
}

function row(result: ModuleResult, name: string, key: unknown): unknown[] {
  const found = table(result, name).rows.find((item) => item[0] === key);
  if (!found) throw new Error(`falta la fila ${String(key)} en ${name}`);
  return found;
}

describe("decision_analysis payoff", () => {
  it("decision_01: el VE es 8.1 y la mejor es C (índice 2)", () => {
    const data = loadFixture("decision_01.json");
    const result = solve(data.request);
    expect(result.status).toBe("ok");
    expect(result.module).toBe("decision_analysis");
    assertClose(result.solution.metrics.EV, 8.1, 1e-6);
    expect(result.solution.variables.expected_value).toBe(2);
    expect(row(result, "decisions", "expected_value")[1]).toBe("C");

    // Índices en variables y valores en metrics, como el solver Python.
    expect(result.solution.variables.maximax).toBe(2);
    assertClose(result.solution.metrics.maximax_payoff, 12);
    expect(result.solution.variables.maximin).toBe(1);
    assertClose(result.solution.metrics.maximin_payoff, 6);
    expect(result.solution.variables.minimax_regret).toBe(1);
    assertClose(result.solution.metrics.minimax_regret, 6);
    expect(result.solution.variables.hurwicz).toBe(2);
    assertClose(result.solution.metrics.hurwicz_payoff, 8);
    expect(result.solution.variables.laplace).toBe(2);
    assertClose(result.solution.metrics.laplace_payoff, 25 / 3);
    assertClose(result.solution.metrics.EVwPI, 9.9);
    assertClose(result.solution.metrics.EVPI, 1.8);
    assertClose(result.solution.metrics.EOL, 1.8);
    expect(result.graph).toBeNull();

    const sens = table(result, "sensibilidad_probabilidad");
    expect(sens.columns).toEqual(["estado", "p_desde", "p_hasta", "alternativa"]);
    for (const state of ["s1", "s2", "s3"]) {
      const segs = sens.rows.filter((item) => item[0] === state);
      expect(segs[0][1]).toBeCloseTo(0);
      expect(segs[segs.length - 1][2]).toBeCloseTo(1);
      const probs = [0.3, 0.5, 0.2];
      const p = probs[["s1", "s2", "s3"].indexOf(state)];
      const hit = segs.find((item) => (item[1] as number) - 1e-9 <= p && p <= (item[2] as number) + 1e-9);
      expect(hit?.[3]).toBe("C");
    }
  });

  it("decision_02 conserva el VE y el VEIP", () => {
    const data = loadFixture("decision_02.json");
    const expectData = data.expect as { EV: number };
    const result = solve(data.request);
    assertClose(result.solution.metrics.EV, expectData.EV, 1e-6);
    expect(result.solution.metrics.EVPI).toBeTypeOf("number");
    expect(result.solution.variables.maximax).toBeUndefined();
    expect(result.solution.variables.expected_value).toBe(0);
  });

  it("decision_03 Hurwicz y Laplace", () => {
    const data = loadFixture("decision_03.json");
    const expectData = data.expect as {
      hurwicz_payoff: number;
      hurwicz_best: string;
      laplace_payoff: number;
      laplace_best: string;
    };
    const request = data.request as { alternatives: string[] };
    const result = solve(data.request);
    assertClose(result.solution.metrics.hurwicz_payoff, expectData.hurwicz_payoff);
    assertClose(result.solution.metrics.laplace_payoff, expectData.laplace_payoff);
    expect(request.alternatives[result.solution.variables.hurwicz]).toBe(expectData.hurwicz_best);
    expect(request.alternatives[result.solution.variables.laplace]).toBe(expectData.laplace_best);
    expect(result.solution.metrics.EV).toBeUndefined();
    expect(table(result, "decisions").rows.some((item) => item[0] === "sensibilidad_probabilidad")).toBe(false);
    expect(result.tables?.some((item) => item.name === "sensibilidad_probabilidad")).toBe(false);
  });

  it("decision_04 punto de indiferencia y gráfico de dos estados", () => {
    const data = loadFixture("decision_04.json");
    const expectData = data.expect as {
      EV: number;
      EVPI: number;
      best: string;
      breakeven_vs_none: number;
    };
    const request = data.request as { alternatives: string[] };
    const result = solve(data.request);
    assertClose(result.solution.metrics.EV, expectData.EV);
    assertClose(result.solution.metrics.EVPI, expectData.EVPI);
    expect(request.alternatives[result.solution.variables.expected_value]).toBe(expectData.best);
    const ranges = result.sensitivity?.objective_ranges ?? [];
    const none = ranges.find((row) => row.competitor === "None");
    assertClose(none?.breakeven_probability_state1 as number, expectData.breakeven_vs_none);

    expect(result.graph?.type).toBe("xy");
    if (result.graph?.type !== "xy") return;
    const small = result.graph.series.find((series) => series.name === "Small") as { x: number[]; y: number[] };
    const envelope = result.graph.series.find((series) => series.name === "Envolvente") as { y: number[] };
    const at = (p: number) => {
      const index = small.x.findIndex((value) => Math.abs(value - p) < 1e-12);
      return { small: small.y[index], envelope: envelope.y[index] };
    };
    expect(at(0).small).toBeCloseTo(-20000);
    expect(at(0).envelope).toBeCloseTo(0);
    expect(at(1).envelope).toBeCloseTo(200000);
    expect(result.graph.title).toMatch(/Valor esperado/);
  });

  it("normaliza probabilidades que no suman 1", () => {
    const result = solve({
      alternatives: ["A", "B"],
      states: ["s1", "s2"],
      payoff: [
        [10, 0],
        [0, 10],
      ],
      probabilities: [1, 1],
      criterion: "expected_value",
    });
    expect(result.warnings).toContain("Las probabilidades no suman 1; se normalizaron");
    assertClose(result.solution.metrics.EV, 5);
    expect(result.solution.variables.expected_value).toBe(0);
  });

  it("el valor esperado sin probabilidades es un error", () => {
    expect(() =>
      solve({
        alternatives: ["A"],
        states: ["s1"],
        payoff: [[1]],
        criterion: "expected_value",
      }),
    ).toThrow(SolverError);
    expect(() =>
      solve({
        alternatives: ["A"],
        states: ["s1"],
        payoff: [[1]],
        criterion: "expected_value",
      }),
    ).toThrow(/probabilidades/);
  });
});

describe("sensibilidad con 3 estados", () => {
  const body = {
    alternatives: ["A", "B"],
    states: ["s1", "s2", "s3"],
    payoff: [
      [10, 0, 0],
      [0, 8, 8],
    ],
    probabilities: [0.2, 0.4, 0.4],
    criterion: "expected_value",
  };

  it("al variar s1 la alternativa óptima cambia", () => {
    const result = solve(body);
    expect(result.solution.variables.expected_value).toBe(1);
    assertClose(result.solution.metrics.EV, 6.4);
    const segs = table(result, "sensibilidad_probabilidad").rows.filter((item) => item[0] === "s1");
    expect(segs.length).toBeGreaterThan(1);
    expect(segs.map((item) => item[3])).toEqual(["B", "A"]);
    expect(segs[0][1]).toBeCloseTo(0);
    expect(segs[0][2]).toBeCloseTo(4 / 9, 6);
    expect(segs[1][2]).toBeCloseTo(1);
  });

  it("el pago de la mejor alternativa admite una baja finita y una subida sin límite", () => {
    const result = solve(body);
    const rows = table(result, "sensibilidad_pago").rows;
    const bS1 = rows.find((item) => item[0] === "B" && item[1] === "s1");
    const aS1 = rows.find((item) => item[0] === "A" && item[1] === "s1");
    expect(bS1?.[2]).toBe(0);
    expect(bS1?.[3]).toBeCloseTo(22);
    expect(bS1?.[4]).toBeNull();
    expect(aS1?.[3]).toBeNull();
    expect(aS1?.[4]).toBeCloseTo(22);
  });
});

describe("utilidad exponencial", () => {
  // A mano, R = 50, U(x) = 1 − exp(−x/50), p = 0.5 / 0.5.
  // Arriesgada: pagos 100 y 0. VE = 50.
  //   U(100) = 1 − e^(−2) ≈ 0.8646647168, U(0) = 0, UE ≈ 0.4323323584
  //   EC = −50 ln(1 − UE) ≈ 28.31095848, prima ≈ 21.68904152
  // Segura: pago 40 seguro. VE = UE en dinero = 40, U(40) ≈ 0.5506710359, EC = 40, prima = 0.
  // El valor esperado elige Arriesgada; la utilidad esperada elige Segura.
  const body = {
    mode: "utility",
    alternatives: ["Arriesgada", "Segura"],
    states: ["bueno", "malo"],
    payoff: [
      [100, 0],
      [40, 40],
    ],
    probabilities: [0.5, 0.5],
    criterion: "all",
    utility: { kind: "exponential", risk_tolerance: 50 },
  };

  it("la utilidad esperada y el valor esperado no eligen lo mismo", () => {
    const result = solve(body);
    const utilidad = table(result, "utilidad");
    const risky = utilidad.rows[0];
    const safe = utilidad.rows[1];
    expect(risky[0]).toBe("Arriesgada");
    expect(risky[5]).toBe("no");
    expect(safe[5]).toBe("sí");
    assertClose(risky[1] as number, 50);
    assertClose(safe[1] as number, 40);
    assertClose(risky[2] as number, 0.43233235838169365, 1e-9);
    assertClose(safe[2] as number, 0.5506710358827784, 1e-9);
    assertClose(risky[3] as number, 28.310958475848636, 1e-8);
    assertClose(safe[3] as number, 40, 1e-9);
    assertClose(risky[4] as number, 21.689041524151364, 1e-8);
    assertClose(safe[4] as number, 0, 1e-9);
    expect(result.solution.variables.expected_value).toBe(1);
    assertClose(result.solution.metrics.best_certainty_equivalent, 40, 1e-9);
    assertClose(result.solution.metrics.EV, 0.5506710358827784, 1e-9);
    assertClose(result.solution.metrics.EV_dinero, 50);
    expect(result.solution.variables.maximax).toBe(0);
    expect(result.solution.variables.maximin).toBe(1);
  });

  it("sin bloque de utilidad el valor esperado monetario no cambia", () => {
    const result = solve({
      alternatives: ["Arriesgada", "Segura"],
      states: ["bueno", "malo"],
      payoff: [
        [100, 0],
        [40, 40],
      ],
      probabilities: [0.5, 0.5],
      criterion: "expected_value",
    });
    expect(result.solution.variables.expected_value).toBe(0);
    assertClose(result.solution.metrics.EV, 50);
    expect(result.tables?.some((item) => item.name === "utilidad")).toBe(false);
  });

  it("rechaza R = 0 y avisa si la tabla de utilidad invierte un pago", () => {
    expect(() =>
      solve({
        mode: "utility",
        alternatives: ["A"],
        states: ["s1", "s2"],
        payoff: [
          [1, 2],
        ],
        probabilities: [0.5, 0.5],
        utility: { kind: "exponential", risk_tolerance: 0 },
      }),
    ).toThrow(/no puede ser 0/);

    const result = solve({
      mode: "payoff_table",
      alternatives: ["A"],
      states: ["s1", "s2"],
      payoff: [[0, 10]],
      probabilities: [0.5, 0.5],
      criterion: "expected_value",
      utility: { kind: "table", utilities: [[5, 1]] },
    });
    expect(result.warnings.some((warning) => warning.includes("no respeta el orden"))).toBe(true);
    expect(result.solution.variables.expected_value).toBe(0);
  });

  it("la utilidad lineal deja la prima en cero", () => {
    const data = loadFixture("decision_01.json");
    const request = data.request as Record<string, unknown>;
    const result = solve({ ...request, utility: { kind: "linear" } });
    assertClose(result.solution.metrics.EV, 8.1, 1e-6);
    expect(result.solution.variables.expected_value).toBe(2);
    assertClose(result.solution.metrics.best_certainty_equivalent, 8.1, 1e-6);
    const premiums = table(result, "utilidad").rows.map((item) => item[4] as number);
    for (const premium of premiums) assertClose(premium, 0, 1e-9);
  });
});

describe("árbol de decisión", () => {
  it("pliega el árbol y marca el arco óptimo", () => {
    const result = solve({
      mode: "decision_tree",
      root_id: "D1",
      tree: [
        {
          id: "D1",
          kind: "decision",
          children: [
            { to: "T_A", label: "A" },
            { to: "C1", label: "B" },
          ],
        },
        { id: "T_A", kind: "terminal", value: 100 },
        {
          id: "C1",
          kind: "chance",
          children: [
            { to: "T_low", label: "low", probability: 0.5 },
            { to: "T_high", label: "high", probability: 0.5 },
          ],
        },
        { id: "T_low", kind: "terminal", value: 40 },
        { id: "T_high", kind: "terminal", value: 200 },
      ],
    });
    expect(result.status).toBe("ok");
    assertClose(result.solution.metrics.EV_root, 120);
    assertClose(result.solution.variables.root, 120);
    expect(row(result, "tree_fold", "D1")[3]).toBe("C1");
    expect(row(result, "politica", "D1")).toEqual(["D1", "B", 120]);
    expect(result.graph?.type).toBe("network");
    if (result.graph?.type !== "network") return;
    const critical = result.graph.edges.filter((edge) => edge.critical);
    expect(critical).toHaveLength(1);
    expect(critical[0].target).toBe("C1");
  });

  it("elige invertir cuando el valor esperado es 52", () => {
    const result = solve({
      mode: "decision_tree",
      root_id: "d1",
      tree: [
        {
          id: "d1",
          kind: "decision",
          children: [
            { to: "c1", label: "invest" },
            { to: "t_none", label: "do nothing" },
          ],
        },
        {
          id: "c1",
          kind: "chance",
          children: [
            { to: "t_good", label: "good", probability: 0.6 },
            { to: "t_bad", label: "bad", probability: 0.4 },
          ],
        },
        { id: "t_good", kind: "terminal", value: 100 },
        { id: "t_bad", kind: "terminal", value: -20 },
        { id: "t_none", kind: "terminal", value: 0 },
      ],
    });
    assertClose(result.solution.variables.root, 52);
    expect(row(result, "politica", "d1")[1]).toBe("invest");
    if (result.graph?.type !== "network") throw new Error("falta el grafo");
    const critical = result.graph.edges.filter((edge) => edge.critical);
    expect(critical).toHaveLength(1);
    expect(critical[0].target).toBe("c1");
  });

  it("un subárbol compartido no se confunde con un ciclo", () => {
    const result = solve({
      mode: "decision_tree",
      root_id: "D",
      tree: [
        {
          id: "D",
          kind: "decision",
          children: [
            { to: "T", label: "segura" },
            { to: "C", label: "lotería" },
          ],
        },
        { id: "T", kind: "terminal", value: 10 },
        {
          id: "C",
          kind: "chance",
          children: [
            { to: "L", label: "baja", probability: 0.5 },
            { to: "H", label: "alta", probability: 0.5 },
          ],
        },
        { id: "L", kind: "terminal", value: 0 },
        { id: "H", kind: "terminal", value: 100 },
      ],
    });
    assertClose(result.solution.metrics.EV_root, 50);
    expect(row(result, "politica", "D")[1]).toBe("lotería");
  });

  it("un ciclo es un error", () => {
    expect(() =>
      solve({
        mode: "decision_tree",
        root_id: "a",
        tree: [
          { id: "a", kind: "decision", children: [{ to: "b", label: "sigue" }] },
          { id: "b", kind: "chance", children: [{ to: "a", label: "vuelve", probability: 1 }] },
        ],
      }),
    ).toThrow(/ciclo/);
  });

  it("un nodo de azar cuyas probabilidades no suman 1 es un error", () => {
    expect(() =>
      solve({
        mode: "decision_tree",
        root_id: "c",
        tree: [
          {
            id: "c",
            kind: "chance",
            children: [
              { to: "t1", label: "a", probability: 0.5 },
              { to: "t2", label: "b", probability: 0.2 },
            ],
          },
          { id: "t1", kind: "terminal", value: 1 },
          { id: "t2", kind: "terminal", value: 2 },
        ],
      }),
    ).toThrow(/deben sumar 1/);
  });

  it("rechaza terminal sin valor, hijo desconocido e identificadores repetidos", () => {
    expect(() =>
      solve({
        mode: "decision_tree",
        tree: [{ id: "t", kind: "terminal" }],
      }),
    ).toThrow(/valor/);
    expect(() =>
      solve({
        mode: "decision_tree",
        tree: [{ id: "d", kind: "decision", children: [{ to: "no-existe", label: "x" }] }],
      }),
    ).toThrow(/desconocido/);
    expect(() =>
      solve({
        mode: "decision_tree",
        tree: [
          { id: "a", kind: "terminal", value: 1 },
          { id: "a", kind: "terminal", value: 2 },
        ],
      }),
    ).toThrow(/repetidos/);
  });
});

describe("Bayes", () => {
  const classic = {
    mode: "bayes" as const,
    bayes: {
      actions: ["build", "no"],
      states: ["high", "low"],
      prior: [0.4, 0.6],
      payoff: [
        [100, -20],
        [0, 0],
      ],
      signals: ["good", "bad"],
      likelihood: [
        [0.7, 0.2],
        [0.3, 0.8],
      ],
    },
  };

  it("el VEIM no es negativo y EVwSI es la suma P(señal)·VE|señal", () => {
    const result = solve(classic);
    expect(result.status).toBe("ok");
    expect(result.solution.metrics.EVSI).toBeGreaterThanOrEqual(-1e-9);
    expect(result.solution.metrics.EVPI).toBeGreaterThanOrEqual(-1e-9);
    assertClose(result.solution.metrics.EV, 28);
    assertClose(result.solution.metrics.EVPI, 12);
    const bayes = table(result, "bayes");
    let evwsi = 0;
    for (const item of bayes.rows) evwsi += (item[1] as number) * (item[3] as number);
    assertClose(evwsi, result.solution.metrics.EVwSI, 1e-9);
    assertClose(result.solution.metrics.EVwSI, 28);
    expect(table(result, "bayes_nodos").rows.length).toBeGreaterThan(0);
    expect(table(result, "bayes_arcos").rows.length).toBeGreaterThan(0);
    expect(table(result, "bayes_arbol_auxiliar").rows[0][0]).toBe("Previa");
    expect(result.graph?.type).toBe("network");
  });

  it("si el costo supera el VEIM no se compra la información", () => {
    // Construir paga 100 o −40. VE = 16. Con la muestra:
    // P(favorable) = 0.4, VE|favorable = 58; P(desfavorable) = 0.6, VE|desfavorable = 0.
    // EVwSI = 23.2 y VEIM = 7.2. Un costo de 10 no se compra; uno de 5 sí.
    const bayes = {
      actions: ["Construir", "No construir"],
      states: ["Alta", "Baja"],
      prior: [0.4, 0.6],
      payoff: [
        [100, -40],
        [0, 0],
      ],
      signals: ["Favorable", "Desfavorable"],
      likelihood: [
        [0.7, 0.2],
        [0.3, 0.8],
      ],
    };
    const costly = solve({ mode: "bayes", bayes: { ...bayes, sample_cost: 10 } });
    assertClose(costly.solution.metrics.EV, 16);
    assertClose(costly.solution.metrics.EVwSI, 23.2);
    assertClose(costly.solution.metrics.EVSI, 7.2);
    assertClose(costly.solution.metrics.sample_cost, 10);
    assertClose(costly.solution.metrics.EVSI_neto, 7.2 - 10);
    const root = row(costly, "bayes_nodos", "raiz");
    expect(root[3]).toBe("Sin información");
    assertClose(root[2] as number, 16);
    const buyArc = table(costly, "bayes_arcos").rows.find(
      (item) => item[0] === "raiz" && item[2] === "Comprar información",
    );
    assertClose(buyArc?.[5] as number, 23.2 - 10);
    expect(buyArc?.[4]).toBe(false);
    const info = row(costly, "bayes_nodos", "con_informacion");
    assertClose(info[2] as number, 23.2 - 10);
    expect(table(costly, "bayes_nodos").rows.some((item) => item[1] === "terminal")).toBe(true);
    expect(table(costly, "bayes_nodos").rows.some((item) => item[1] === "chance")).toBe(true);
    expect(table(costly, "bayes_nodos").rows.some((item) => item[1] === "decision")).toBe(true);
    if (costly.graph?.type !== "network") throw new Error("falta el grafo");
    const rootEdge = costly.graph.edges.find((edge) => edge.source === "raiz" && edge.critical);
    expect(rootEdge?.target).toBe("sin_informacion");
    expect(costly.graph.nodes.every((node) => node.kind && "value" in node)).toBe(true);

    const cheap = solve({ mode: "bayes", bayes: { ...bayes, sample_cost: 5 } });
    expect(row(cheap, "bayes_nodos", "raiz")[3]).toBe("Comprar información");
    assertClose(row(cheap, "bayes_nodos", "raiz")[2] as number, 23.2 - 5);
    const bayesTable = table(cheap, "bayes");
    let weighted = 0;
    for (const item of bayesTable.rows) weighted += (item[1] as number) * (item[3] as number);
    assertClose(weighted, cheap.solution.metrics.EVwSI, 1e-9);
  });

  it("avisa si una columna de verosimilitud no suma 1 y no la normaliza", () => {
    const result = solve({
      mode: "bayes",
      bayes: {
        actions: ["build", "no"],
        states: ["high", "low"],
        prior: [0.2, 0.2],
        payoff: [
          [100, -20],
          [0, 0],
        ],
        signals: ["good", "bad"],
        likelihood: [
          [0.7, 0.2],
          [0.2, 0.2],
        ],
      },
    });
    expect(result.warnings.some((warning) => warning.includes("se normalizaron"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("high") && warning.includes("tal cual"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("low") && warning.includes("tal cual"))).toBe(true);
    const good = table(result, "bayes").rows.find((item) => item[0] === "good");
    // Previa normalizada a 0.5/0.5. P(good) = 0.7*0.5 + 0.2*0.5 = 0.45, sin tocar la verosimilitud.
    assertClose(good?.[1] as number, 0.45);
  });
});

describe("decision analysis: auditoría", () => {
  it("con costos (sense min) cada criterio elige el menor costo", () => {
    // Costos: A = [10, 2], B = [6, 6], C = [3, 12]; P = [0.5, 0.5].
    const result = solve({
      alternatives: ["A", "B", "C"],
      states: ["s1", "s2"],
      payoff: [
        [10, 2],
        [6, 6],
        [3, 12],
      ],
      probabilities: [0.5, 0.5],
      sense: "min",
    });
    const m = result.solution.metrics;
    expect(result.solution.objective_sense).toBe("min");
    expect(m.minimize).toBe(1);
    // Optimista con costos = mínimo de los mínimos: A tiene 2.
    expect(result.solution.variables.maximax).toBe(0);
    expect(m.maximax_payoff).toBe(2);
    // Pesimista = el menor de los peores costos: B con 6.
    expect(result.solution.variables.maximin).toBe(1);
    expect(m.maximin_payoff).toBe(6);
    // Costo esperado: A 6, B 6, C 7.5 → A (primera en el empate) con 6.
    assertClose(m.EV, 6, 1e-12);
    // Con información perfecta: 0.5·3 + 0.5·2 = 2.5; VEIP = 6 − 2.5.
    assertClose(m.EVwPI, 2.5, 1e-12);
    assertClose(m.EVPI, 3.5, 1e-12);
    // Arrepentimiento: costo menos el mínimo de la columna.
    const regret = table(result, "arrepentimiento");
    expect(regret.rows).toEqual([
      ["A", 7, 0, 7],
      ["B", 3, 4, 4],
      ["C", 0, 10, 10],
    ]);
    expect(result.warnings.some((w) => /Empate/.test(w))).toBe(true);
    if (result.graph?.type !== "xy") throw new Error("se esperaba gráfico");
    const env = result.graph.series.find((s) => s.name === "Envolvente")!;
    // En p = 0 la envolvente es el menor costo de s2 (2), no el mayor.
    expect((env.y as number[])[0]).toBe(2);
  });

  it("la tabla de arrepentimiento acompaña a la tabla de ganancias", () => {
    const result = solve({
      alternatives: ["A", "B"],
      states: ["s1", "s2"],
      payoff: [
        [10, 2],
        [4, 8],
      ],
    });
    expect(table(result, "arrepentimiento").rows).toEqual([
      ["A", 0, 6, 6],
      ["B", 6, 0, 6],
    ]);
  });

  it("rechaza costos con utilidad, nombres repetidos y probabilidades fuera de [0, 1]", () => {
    expect(() =>
      solve({
        mode: "utility",
        alternatives: ["A"],
        states: ["s"],
        payoff: [[1]],
        sense: "min",
        utility: { kind: "linear" },
      }),
    ).toThrow(/utilidad/);
    expect(() =>
      solve({ alternatives: ["A", "A"], states: ["s1"], payoff: [[1], [2]] }),
    ).toThrow(/repetido/);
    expect(() =>
      solve({
        mode: "decision_tree",
        tree: [
          { id: "c", kind: "chance", children: [{ to: "t1", probability: 1.5 }, { to: "t2", probability: -0.5 }] },
          { id: "t1", kind: "terminal", value: 1 },
          { id: "t2", kind: "terminal", value: 0 },
        ],
      }),
    ).toThrow(/entre 0 y 1/);
    expect(() =>
      solve({
        mode: "bayes",
        bayes: {
          actions: ["a"],
          states: ["s1", "s2"],
          prior: [0.5, 0.5],
          payoff: [[1, 0]],
          signals: ["+", "-"],
          likelihood: [
            [1.2, 0.3],
            [-0.2, 0.7],
          ],
        },
      }),
    ).toThrow(/verosimilitud/);
  });
});
