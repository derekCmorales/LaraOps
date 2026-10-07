import { describe, expect, it } from "vitest";
import { SolverError } from "../src/errors";
import { solve } from "../src/modules/markov/solver";
import { assertClose, loadFixture } from "./helpers";

function table(result: ReturnType<typeof solve>, name: string) {
  const found = result.tables?.find((item) => item.name === name);
  if (!found) throw new Error(`falta la tabla ${name}`);
  return found;
}

function rowByState(result: ReturnType<typeof solve>, tableName: string, state: string) {
  const found = table(result, tableName).rows.find((row) => row[0] === state);
  if (!found) throw new Error(`falta la fila ${state} en ${tableName}`);
  return found;
}

describe("markov chain", () => {
  it("reproduces Land of Oz (markov_01)", () => {
    const data = loadFixture("markov_01.json");
    const result = solve(data.request);
    expect(result.status).toBe("ok");
    expect(result.module).toBe("markov");
    const steady = (data.expect as { steady_state: Record<string, number> }).steady_state;
    for (const [state, prob] of Object.entries(steady)) {
      assertClose(result.solution.variables[state], prob, 1e-6);
      assertClose(result.solution.metrics[`steady_${state}`], prob, 1e-6);
    }
    expect(table(result, "transition_power_n").rows).toHaveLength(3);
    expect(table(result, "transient").rows).toHaveLength(11);
    expect(result.graph?.type).toBe("network");
    expect(result.graph && "title" in result.graph && result.graph.title).toMatch(/Markov/);
    const classes = table(result, "classes");
    expect(classes.rows).toHaveLength(1);
    expect(classes.rows[0][1]).toBe("recurrente");
    expect(classes.rows[0][2]).toBe(1);
    expect(result.solution.metrics.is_absorbing_chain).toBe(0);
    expect(result.solution.metrics.num_recurrent_classes).toBe(1);
    for (const row of table(result, "classification").rows) {
      expect(row[2]).toBe("recurrente");
      expect(row[3]).toBe(1);
    }
  });

  it("solves the two-state chain with stationary 5/6 and 1/6", () => {
    const result = solve({
      states: ["A", "B"],
      transition: [
        [0.9, 0.1],
        [0.5, 0.5],
      ],
      initial: [1, 0],
      steps: 5,
    });
    assertClose(result.solution.variables.A, 5 / 6, 1e-6);
    assertClose(result.solution.variables.B, 1 / 6, 1e-6);
    expect(result.solution.metrics.long_run_expected_reward).toBeUndefined();
    const withReward = solve({
      states: ["A", "B"],
      transition: [
        [0.9, 0.1],
        [0.5, 0.5],
      ],
      initial: [1, 0],
      steps: 5,
      rewards: [10, 0],
    });
    // π = (5/6, 1/6) ⇒ recompensa de largo plazo = 10 · 5/6.
    assertClose(withReward.solution.metrics.long_run_expected_reward, 10 * (5 / 6), 1e-6);
    const rewards = table(withReward, "rewards");
    expect(rewards.columns).toEqual(["estado", "recompensa", "peso_estacionario", "contribución"]);
  });

  it("rejects a row that does not sum to 1", () => {
    expect(() =>
      solve({
        states: ["A", "B"],
        transition: [
          [0.5, 0.4],
          [0.5, 0.5],
        ],
      }),
    ).toThrow(SolverError);
    expect(() =>
      solve({
        states: ["A", "B"],
        transition: [
          [0.5, 0.4],
          [0.5, 0.5],
        ],
      }),
    ).toThrow(/debe sumar 1/);
  });

  it("rejects negative probabilities", () => {
    expect(() =>
      solve({
        states: ["A", "B"],
        transition: [
          [-0.1, 1.1],
          [0.5, 0.5],
        ],
      }),
    ).toThrow(/negativ/);
  });

  it("classifies a period-2 class and a transient that splits 50/50", () => {
    // A ↔ B es una sola clase recurrente de periodo 2. C es transitorio y
    // entra a esa clase con probabilidad 1. Dentro de la clase la
    // estacionaria condicional es 1/2, 1/2, así que desde C el largo plazo
    // es (1/2, 1/2, 0): el 50/50 vive en la clase, no en dos absorbentes.
    const result = solve({
      states: ["A", "B", "C"],
      transition: [
        [0, 1, 0],
        [1, 0, 0],
        [0.5, 0.5, 0],
      ],
      initial: [0, 0, 1],
      steps: 4,
    });
    const classOf = (state: string) => rowByState(result, "classification", state);
    expect(classOf("A")[2]).toBe("recurrente");
    expect(classOf("B")[2]).toBe("recurrente");
    expect(classOf("A")[3]).toBe(2);
    expect(classOf("B")[3]).toBe(2);
    expect(classOf("A")[1]).toBe(classOf("B")[1]);
    expect(classOf("C")[2]).toBe("transitorio");
    expect(classOf("C")[3]).toBe("—");
    expect(classOf("A")[4]).toBe("A, B");
    expect(String(classOf("C")[4])).toContain("A");
    expect(String(classOf("C")[4])).toContain("B");
    expect(String(classOf("C")[4])).toContain("C");

    assertClose(result.solution.variables.A, 0.5, 1e-8);
    assertClose(result.solution.variables.B, 0.5, 1e-8);
    assertClose(result.solution.variables.C, 0, 1e-8);

    const absorption = table(result, "absorption_probabilities");
    expect(absorption.columns).toEqual(["estado", classOf("A")[1]]);
    const fromC = absorption.rows.find((row) => row[0] === "C");
    expect(fromC).toBeTruthy();
    assertClose(Number(fromC?.[1]), 1, 1e-8);
    assertClose(result.solution.metrics.expected_steps_C, 1, 1e-8);
    expect(result.solution.metrics.is_absorbing_chain).toBe(0);
    expect(result.solution.metrics.num_absorbing_states).toBe(0);
    expect(result.solution.metrics.num_recurrent_classes).toBe(1);
    expect(result.solution.metrics.is_periodic).toBe(1);
    expect(result.warnings.some((warning) => /periódica/.test(warning))).toBe(true);

    const t0 = table(result, "transient").rows[0];
    assertClose(Number(t0[1]), 0, 1e-12);
    assertClose(Number(t0[2]), 0, 1e-12);
    assertClose(Number(t0[3]), 1, 1e-12);
  });

  it("reproduces gambler's ruin (markov_02)", () => {
    const data = loadFixture("markov_02.json");
    const result = solve(data.request);
    expect(result.status).toBe("ok");
    expect(result.solution.metrics.is_absorbing_chain).toBe(1);
    assertClose(result.solution.metrics.num_absorbing_states, 2, 1e-12);
    expect(result.solution.metrics.num_recurrent_classes).toBe(2);
    const expectData = data.expect as {
      absorption_from_2: Record<string, number>;
      expected_steps_from_2: number;
    };
    assertClose(result.solution.metrics.expected_steps_2, expectData.expected_steps_from_2, 1e-6);
    // Con p = 1/2 y capital total 4, los pasos esperados desde k son k·(4−k).
    assertClose(result.solution.metrics.expected_steps_1, 3, 1e-6);
    assertClose(result.solution.metrics.expected_steps_3, 3, 1e-6);

    const absorption = table(result, "absorption_probabilities");
    expect(absorption.columns.slice(1)).toEqual(["0", "4"]);
    const row = absorption.rows.find((item) => item[0] === "2");
    expect(row).toBeTruthy();
    const probs = Object.fromEntries(absorption.columns.slice(1).map((col, i) => [col, Number(row?.[i + 1])]));
    for (const [state, prob] of Object.entries(expectData.absorption_from_2)) {
      assertClose(probs[state], prob, 1e-6);
    }
    // Desde 1 la probabilidad de caer en 0 es 3/4 (no 1/2): así se ve que
    // las columnas no quedaron intercambiadas.
    const from1 = absorption.rows.find((item) => item[0] === "1");
    assertClose(Number(from1?.[1]), 0.75, 1e-6);
    assertClose(Number(from1?.[2]), 0.25, 1e-6);

    expect(rowByState(result, "classification", "0")[2]).toBe("absorbente");
    expect(rowByState(result, "classification", "4")[2]).toBe("absorbente");
    expect(rowByState(result, "classification", "2")[2]).toBe("transitorio");
    // La inicial está en 2, así que el largo plazo es 1/2 en cada absorbente.
    assertClose(result.solution.variables["0"], 0.5, 1e-6);
    assertClose(result.solution.variables["1"], 0, 1e-6);
    assertClose(result.solution.variables["2"], 0, 1e-6);
    assertClose(result.solution.variables["3"], 0, 1e-6);
    assertClose(result.solution.variables["4"], 0.5, 1e-6);
    expect(result.warnings.some((warning) => /absorbente/.test(warning))).toBe(true);

    const withReward = solve({
      ...(data.request as object),
      rewards: [0, 1, 1, 1, 0],
    });
    // En los transitorios la recompensa es 1, así que N·r coincide con los pasos esperados.
    const rewardRow = table(withReward, "expected_reward_to_absorption").rows.find((item) => item[0] === "2");
    assertClose(Number(rewardRow?.[1]), 4, 1e-6);
  });

  it("normalizes an initial distribution that does not sum to 1", () => {
    const result = solve({
      states: ["A", "B"],
      transition: [
        [0.9, 0.1],
        [0.5, 0.5],
      ],
      initial: [2, 0],
      steps: 1,
    });
    assertClose(result.solution.variables.A, 5 / 6, 1e-6);
    expect(result.warnings.some((warning) => /normal|dividió|suma/.test(warning))).toBe(true);
    const t0 = table(result, "transient").rows[0];
    assertClose(Number(t0[1]), 1, 1e-8);
    assertClose(Number(t0[2]), 0, 1e-8);
  });
});

describe("markov decision process", () => {
  // Mantenimiento. Estados Bueno y Malo. Minimizar costo promedio.
  //
  // Acciones:
  //   Bueno/seguir      costo 1, P = [0.8, 0.2]
  //   Bueno/reemplazar  costo 5, P = [1, 0]
  //   Malo/seguir       costo 4, P = [0.1, 0.9]
  //   Malo/reemplazar   costo 5, P = [1, 0]
  //
  // Política seguir/seguir:
  //   π_B = 0.8 π_B + 0.1 π_M, π_M = 0.2 π_B + 0.9 π_M ⇒ π_M = 2 π_B
  //   π_B = 1/3, π_M = 2/3, g = 1/3 + 4·(2/3) = 3
  // Política seguir/reemplazar:
  //   π_M = 0.2 π_B, π_B + π_M = 1 ⇒ π_B = 5/6, π_M = 1/6
  //   g = 1·(5/6) + 5·(1/6) = 10/6 = 5/3
  // Política reemplazar/seguir: Bueno es absorbente con costo 5, g = 5
  // Política reemplazar/reemplazar: g = 5
  // Óptimo: seguir en Bueno y reemplazar en Malo, g = 5/3.
  const maintenance = {
    mode: "mdp" as const,
    states: ["Bueno", "Malo"],
    sense: "min" as const,
    criterion: "average" as const,
    decisions: [
      { state: "Bueno", action: "seguir", cost: 1, transitions: [0.8, 0.2] },
      { state: "Bueno", action: "reemplazar", cost: 5, transitions: [1, 0] },
      { state: "Malo", action: "seguir", cost: 4, transitions: [0.1, 0.9] },
      { state: "Malo", action: "reemplazar", cost: 5, transitions: [1, 0] },
    ],
  };

  it("finds the hand-checked average-cost optimum", () => {
    const result = solve(maintenance);
    expect(result.status).toBe("optimal");
    expect(result.solution.objective_sense).toBe("min");
    assertClose(result.solution.metrics.optimal_value, 5 / 3, 1e-6);
    assertClose(result.solution.objective_value ?? NaN, 5 / 3, 1e-6);
    assertClose(result.solution.variables.optimal_value, 5 / 3, 1e-6);

    const optimal = table(result, "optimal_policy");
    expect(optimal.columns.slice(0, 3)).toEqual(["estado", "accion", "costo"]);
    expect(optimal.rows.map((row) => [row[0], row[1]])).toEqual([
      ["Bueno", "seguir"],
      ["Malo", "reemplazar"],
    ]);

    const policies = table(result, "policies");
    expect(policies.columns).toEqual(["politica", "costo_promedio", "optima"]);
    expect(policies.rows).toHaveLength(4);
    const marked = policies.rows.filter((row) => row[2] === "sí");
    expect(marked).toHaveLength(1);
    expect(String(marked[0][0])).toContain("seguir");
    expect(String(marked[0][0])).toContain("reemplazar");
    assertClose(Number(marked[0][1]), 5 / 3, 1e-6);
    const best = Math.min(...policies.rows.map((row) => Number(row[1])));
    assertClose(result.solution.metrics.optimal_value, best, 1e-8);
    expect(result.graph?.type).toBe("network");
  });

  it("keeps the decision model when a transition matrix is also present", () => {
    const result = solve({
      ...maintenance,
      transition: [
        [1, 0],
        [0, 1],
      ],
      steps: 10,
    });
    assertClose(result.solution.metrics.optimal_value, 5 / 3, 1e-6);
    expect(table(result, "optimal_policy").rows.map((row) => row[1])).toEqual(["seguir", "reemplazar"]);
  });

  it("matches the Bellman equation for a known discount", () => {
    // Misma máquina, γ = 0.9. Para seguir/reemplazar:
    //   det(I − γP) = 59/500
    //   h_Bueno = 950/59, h_Malo = 1150/59
    //   promedio = 1050/59
    // y esa política es la de menor valor entre las cuatro.
    const gamma = 0.9;
    const result = solve({ ...maintenance, criterion: "discounted", discount: gamma });
    assertClose(result.solution.metrics.optimal_value, 1050 / 59, 1e-6);
    assertClose(result.solution.metrics.valor_Bueno, 950 / 59, 1e-6);
    assertClose(result.solution.metrics.valor_Malo, 1150 / 59, 1e-6);

    const optimal = table(result, "optimal_policy");
    const h = optimal.rows.map((row) => Number(row[3]));
    const chosen = [
      maintenance.decisions.find((d) => d.state === "Bueno" && d.action === optimal.rows[0][1])!,
      maintenance.decisions.find((d) => d.state === "Malo" && d.action === optimal.rows[1][1])!,
    ];
    chosen.forEach((action, i) => {
      const bellman = action.cost + gamma * action.transitions.reduce((sum, p, j) => sum + p * h[j], 0);
      assertClose(h[i], bellman, 1e-6);
    });

    const policies = table(result, "policies");
    expect(policies.columns[1]).toBe("valor_descontado");
    const best = Math.min(...policies.rows.map((row) => Number(row[1])));
    assertClose(result.solution.metrics.optimal_value, best, 1e-6);
    expect(policies.rows.filter((row) => row[2] === "sí").length).toBeGreaterThan(0);
  });

  it("rejects an action whose probabilities do not sum to 1", () => {
    expect(() =>
      solve({
        mode: "mdp",
        states: ["Bueno", "Malo"],
        decisions: [
          { state: "Bueno", action: "seguir", cost: 1, transitions: [0.8, 0.1] },
          { state: "Malo", action: "seguir", cost: 2, transitions: [0.5, 0.5] },
        ],
      }),
    ).toThrow(/deben sumar 1/);
  });
});
