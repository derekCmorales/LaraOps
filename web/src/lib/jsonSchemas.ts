/** Esquemas JSON esperados por módulo (importación y documentación). */

export type JsonSchemaDoc = {
  module: string;
  title: string;
  required: string[];
  example: Record<string, unknown>;
  notes?: string;
};

export const JSON_SCHEMAS: Record<string, JsonSchemaDoc> = {
  lp: {
    module: "lp",
    title: "Programación lineal",
    required: ["sense", "objective", "constraints"],
    example: {
      sense: "max",
      objective: { x1: 3, x2: 2 },
      constraints: [{ id: "R1", coeffs: { x1: 2, x2: 1 }, sense: "<=", rhs: 10 }],
    },
  },
  assignment: {
    module: "assignment",
    title: "Asignación",
    required: ["agents", "tasks", "costs"],
    example: { agents: ["A1"], tasks: ["T1"], costs: [[0]], sense: "min" },
  },
  queues: {
    module: "queues",
    title: "Teoría de colas",
    required: ["model", "lambda", "mu"],
    example: { model: "M/M/1", lambda: 10, mu: 15, s: 2 },
    notes: "model: M/M/1, M/M/s, M/M/1/K, M/M/s/K, M/M/s/N, M/G/1, M/D/1",
  },
  inventory: {
    module: "inventory",
    title: "Inventarios",
    required: ["model"],
    example: { model: "eoq", D: 1000, S: 10, H: 0.5, C: 5 },
    notes: "model: eoq, epq, backorder, newsvendor, lot_sizing",
  },
  forecasting: {
    module: "forecasting",
    title: "Pronósticos",
    required: ["series"],
    example: { series: [10, 12, 13, 15], window: 3, alpha: 0.3, horizon: 3 },
  },
  decision: {
    module: "decision_analysis",
    title: "Análisis de decisiones",
    required: ["mode"],
    example: {
      mode: "payoff_table",
      alternatives: ["A1"],
      states: ["S1"],
      payoff: [[0]],
      probabilities: [1],
    },
    notes: "mode: payoff_table, decision_tree, bayes",
  },
  game: {
    module: "game_theory",
    title: "Teoría de juegos",
    required: ["row_strategies", "col_strategies", "payoff"],
    example: { row_strategies: ["A"], col_strategies: ["X"], payoff: [[3]] },
  },
  ilp: {
    module: "ilp",
    title: "Programación entera",
    required: ["sense", "objective", "constraints", "integer_vars"],
    example: {
      sense: "max",
      objective: { x: 3, y: 2 },
      constraints: [{ id: "c1", coeffs: { x: 2, y: 1 }, sense: "<=", rhs: 10 }],
      integer_vars: ["x", "y"],
    },
    notes: "constraints.sense: <=, >=, =",
  },
  qp: {
    module: "quadratic_programming",
    title: "Programación cuadrática",
    required: ["Q", "c"],
    example: { Q: [[2, 0], [0, 2]], c: [-2, -5], bounds: [[-1, 1], [-1, 1]] },
  },
  nlp: {
    module: "nonlinear_programming",
    title: "Programación no lineal",
    required: ["quadratic_diag", "linear", "x0"],
    example: { quadratic_diag: [1, 1], linear: [0, 0], x0: [1, -1] },
  },
  networks: {
    module: "networks",
    title: "Redes",
    required: ["problem", "nodes"],
    example: {
      problem: "shortest_path",
      nodes: ["A", "B", "C", "D"],
      edges: [
        { source: "A", target: "B", weight: 4 },
        { source: "A", target: "C", weight: 2 },
        { source: "B", target: "C", weight: 1 },
        { source: "B", target: "D", weight: 5 },
        { source: "C", target: "D", weight: 3 },
      ],
      source: "A",
      sink: "D",
    },
    notes: "problem: shortest_path, mst, max_flow, transshipment, tsp. TSP usa distance_matrix; transbordo usa node_supply.",
  },
  jobs: {
    module: "job_scheduling",
    title: "Programación de tareas",
    required: ["rule", "jobs"],
    example: { rule: "spt", jobs: [{ id: "J1", times: [3], due_date: 10 }] },
    notes: "rule: spt, edd, johnson",
  },
  markov: {
    module: "markov",
    title: "Cadenas de Markov",
    required: ["states", "transition", "steps"],
    example: { states: ["A", "B"], transition: [[0.7, 0.3], [0.4, 0.6]], initial: [1, 0], steps: 5 },
  },
  goal: {
    module: "goal_programming",
    title: "Programación por metas",
    required: ["goals"],
    example: {
      variable_names: ["x1", "x2"],
      hard_constraints: [],
      goals: [{ id: "g1", coeffs: { x1: 1 }, sense: "=", target: 10, priority: 1, weight_pos: 1, weight_neg: 1 }],
    },
  },
  dp: {
    module: "dynamic_programming",
    title: "Programación dinámica",
    required: ["problem", "capacity", "items"],
    example: {
      problem: "knapsack",
      capacity: 10,
      items: [{ id: "a", weight: 4, value: 5 }],
    },
  },
  mrp: {
    module: "mrp",
    title: "MRP",
    required: ["items", "bom"],
    example: {
      items: ["A", "B"],
      bom: [{ parent: "A", component: "B", qty_per: 2 }],
      gross_requirements: { A: [0, 50] },
      on_hand: { A: 5, B: 20 },
      lead_times: { A: 1, B: 2 },
    },
  },
  quality: {
    module: "quality_control",
    title: "Control de calidad",
    required: ["chart", "samples"],
    example: { chart: "xbar_r", samples: [[10.1, 10.2, 9.9, 10.0]] },
  },
  breakeven: {
    module: "breakeven",
    title: "Punto de equilibrio",
    required: ["fixed_cost", "variable_cost", "price"],
    example: { fixed_cost: 1000, variable_cost: 5, price: 15, volume: 200 },
  },
  statistics: {
    module: "statistics",
    title: "Estadística",
    required: ["analysis", "data"],
    example: { analysis: "descriptive", data: [2, 4, 4, 5, 7] },
  },
  asa: {
    module: "acceptance_sampling",
    title: "Muestreo de aceptación",
    required: ["plan", "N", "n", "c"],
    example: { plan: "attributes_single", N: 1000, n: 50, c: 2 },
  },
  qss: {
    module: "queue_simulation",
    title: "Simulación de colas",
    required: ["arrival_rate", "service_rate", "num_servers"],
    example: { arrival_rate: 8, service_rate: 10, num_servers: 2, simulation_time: 500 },
  },
  aggregate: {
    module: "aggregate_planning",
    title: "Planeación agregada",
    required: ["demand", "strategy"],
    example: {
      demand: [100, 120, 110],
      initial_workforce: 10,
      production_per_worker: 10,
      cost_hire: 500,
      cost_fire: 800,
      cost_hold: 2,
      strategy: "level",
    },
  },
  facility: {
    module: "facility_location",
    title: "Localización y layout",
    required: ["mode"],
    example: {
      mode: "center_of_gravity",
      points: [{ name: "C1", x: 10, y: 20, volume: 100 }],
    },
    notes: "mode: center_of_gravity, line_balance",
  },
};

/** Valida un body importado; devuelve mensaje de error en español o null si es válido. */
export function validateModuleJson(slug: string, body: unknown): string | null {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return "El JSON debe ser un objeto (no un arreglo ni un valor suelto).";
  }
  const doc = JSON_SCHEMAS[slug];
  if (!doc) return null;
  const obj = body as Record<string, unknown>;
  for (const key of doc.required) {
    if (!(key in obj) || obj[key] == null) {
      return `Falta el campo obligatorio «${key}».`;
    }
  }
  if (slug === "ilp" && obj.constraints != null && !Array.isArray(obj.constraints)) {
    return "El campo «constraints» debe ser un arreglo de restricciones.";
  }
  if (slug === "networks") {
    if (obj.problem !== "tsp" && obj.edges != null && !Array.isArray(obj.edges)) {
      return "El campo «edges» debe ser un arreglo de aristas {source, target, weight}.";
    }
    if (obj.problem !== "tsp" && !Array.isArray(obj.edges)) {
      return "Falta el campo obligatorio «edges».";
    }
  }
  if (slug === "jobs" && obj.jobs != null && !Array.isArray(obj.jobs)) {
    return "El campo «jobs» debe ser un arreglo de trabajos.";
  }
  if (slug === "decision" && obj.mode === "payoff_table") {
    if (!Array.isArray(obj.payoff)) return "En tabla de pagos, «payoff» debe ser una matriz.";
  }
  return null;
}

export function schemaHintFor(slug: string): string | undefined {
  return JSON_SCHEMAS[slug]?.notes;
}
