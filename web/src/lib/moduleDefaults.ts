/** Estados iniciales vacíos (sin ejemplo precargado) para módulos con formulario. */

export const QUEUES_EMPTY = { model: "M/M/1", lambda: 0, mu: 0, s: 1, service_std_dev: 0 };
export const QUEUES_EX = { model: "M/M/1", lambda: 10, mu: 15, s: 2, service_std_dev: 0.1 };

export const INV_EMPTY = {
  model: "eoq",
  D: 0,
  S: 0,
  H: 0,
  C: 0,
  p: 0,
  Cs: 0,
  mean_demand: 0,
  std_demand: 0,
  Cu: 0,
  Co: 0,
};
export const INV_EX = {
  model: "eoq",
  D: 1000,
  S: 10,
  H: 0.5,
  C: 5,
  p: 5000,
  Cs: 5,
  mean_demand: 100,
  std_demand: 20,
  Cu: 8,
  Co: 2,
};

export const FC_EMPTY = { series: [0], window: 3, alpha: 0.3, beta: 0.3, horizon: 1 };
export const FC_EX = {
  series: [10, 12, 13, 15, 14, 16, 18, 17, 19, 20],
  window: 3,
  alpha: 0.3,
  beta: 0.3,
  horizon: 3,
};

export const DEC_EMPTY = {
  alternatives: ["A1"],
  states: ["S1"],
  payoff: [[0]],
  probabilities: [1],
  hurwicz_alpha: 0.5,
};
export const DEC_EX = {
  alternatives: ["Expandir", "Mantener", "Reducir"],
  states: ["Alta demanda", "Demanda media", "Baja demanda"],
  payoff: [
    [100, 50, -20],
    [60, 60, 10],
    [20, 40, 30],
  ],
  probabilities: [0.3, 0.5, 0.2],
  hurwicz_alpha: 0.6,
};

export const GAME_EMPTY = {
  row_strategies: ["F1", "F2"],
  col_strategies: ["C1", "C2"],
  payoff: [
    [0, 0],
    [0, 0],
  ],
};
export const GAME_EX = {
  row_strategies: ["A", "B"],
  col_strategies: ["X", "Y"],
  payoff: [
    [3, 1],
    [0, 2],
  ],
};

export const NET_EMPTY = {
  problem: "shortest_path",
  nodes: ["A", "B"],
  edges: [{ source: "A", target: "B", weight: 1, capacity: 0 }],
  source: "A",
  sink: "B",
};
export const NET_EX = {
  problem: "shortest_path",
  nodes: ["A", "B", "C", "D"],
  edges: [
    { source: "A", target: "B", weight: 4, capacity: 0 },
    { source: "A", target: "C", weight: 2, capacity: 0 },
    { source: "B", target: "C", weight: 1, capacity: 0 },
    { source: "B", target: "D", weight: 5, capacity: 0 },
    { source: "C", target: "D", weight: 3, capacity: 0 },
  ],
  source: "A",
  sink: "D",
};
export const NET_MST_EX = {
  problem: "mst",
  nodes: ["A", "B", "C"],
  edges: [
    { source: "A", target: "B", weight: 1, capacity: 0 },
    { source: "B", target: "C", weight: 2, capacity: 0 },
    { source: "A", target: "C", weight: 5, capacity: 0 },
  ],
  source: "A",
  sink: "C",
};
export const NET_FLOW_EX = {
  problem: "max_flow",
  nodes: ["S", "A", "T"],
  edges: [
    { source: "S", target: "A", weight: 10, capacity: 10 },
    { source: "A", target: "T", weight: 5, capacity: 5 },
  ],
  source: "S",
  sink: "T",
};
export const NET_TRANS_EX = {
  problem: "transshipment",
  nodes: ["S1", "S2", "T", "D1", "D2"],
  edges: [
    { source: "S1", target: "T", weight: 2, capacity: 60 },
    { source: "S2", target: "T", weight: 3, capacity: 60 },
    { source: "T", target: "D1", weight: 1, capacity: 50 },
    { source: "T", target: "D2", weight: 1, capacity: 70 },
  ],
  source: "S1",
  sink: "D1",
  node_supply: { S1: 50, S2: 40, T: 0, D1: -30, D2: -60 },
};
export const NET_TSP_EX = {
  problem: "tsp",
  nodes: ["A", "B", "C", "D", "E"],
  edges: [] as { source: string; target: string; weight: number; capacity: number }[],
  source: "A",
  sink: "A",
  distance_matrix: [
    [0, 10, 15, 20, 10],
    [10, 0, 35, 25, 20],
    [15, 35, 0, 30, 15],
    [20, 25, 30, 0, 25],
    [10, 20, 15, 25, 0],
  ],
};

export const MARKOV_EMPTY = {
  states: ["S1", "S2"],
  transition: [
    [0.5, 0.5],
    [0.5, 0.5],
  ],
  initial: [1, 0],
  steps: 3,
};
export const MARKOV_EX = {
  states: ["B", "M", "A"],
  transition: [
    [0.9, 0.1, 0],
    [0.2, 0.6, 0.2],
    [0, 0.1, 0.9],
  ],
  initial: [1, 0, 0],
  steps: 5,
};

export const QC_EMPTY = {
  chart: "xbar_r",
  samples: [[0]],
  USL: 0,
  LSL: 0,
};
export const QC_EX = {
  chart: "xbar_r",
  samples: [
    [10.1, 10.2, 9.9, 10.0],
    [10.0, 9.8, 10.1, 10.2],
    [9.9, 10.0, 10.1, 9.8],
  ],
  USL: 10.5,
  LSL: 9.5,
};

export const GOAL_EMPTY = {
  goalId: "g1",
  varName: "x1",
  coeff: 0,
  sense: "=",
  target: 0,
  priority: 1,
};
export const GOAL_EX = {
  goalId: "g1",
  varName: "x1",
  coeff: 1,
  sense: "=",
  target: 10,
  priority: 1,
};

export const GOAL_BODY_EX = {
  variable_names: ["x1", "x2"],
  hard_constraints: [{ id: "c1", coeffs: { x1: 2, x2: 1 }, sense: "<=", rhs: 20 }],
  goals: [
    {
      id: "g1",
      coeffs: { x1: 1 },
      sense: "=",
      target: 10,
      priority: 1,
      weight_pos: 1,
      weight_neg: 1,
    },
    {
      id: "g2",
      coeffs: { x2: 1 },
      sense: ">=",
      target: 5,
      priority: 2,
      weight_pos: 1,
      weight_neg: 1,
    },
  ],
};

export const DP_EMPTY = {
  problem: "knapsack",
  capacity: 0,
  items: [{ id: "a", weight: 0, value: 0 }],
};
export const DP_EX = {
  problem: "knapsack",
  capacity: 5,
  items: [
    { id: "a", weight: 4, value: 5 },
    { id: "b", weight: 3, value: 4 },
    { id: "c", weight: 5, value: 7 },
  ],
};

export const MRP_EMPTY = {
  items: ["A"],
  bom: [{ parent: "A", component: "B", qty_per: 1 }],
  grossA: [0],
  onHandA: 0,
  onHandB: 0,
  ltA: 0,
  ltB: 0,
};
export const MRP_EX = {
  items: ["A", "B"],
  bom: [{ parent: "A", component: "B", qty_per: 2 }],
  grossA: [0, 0, 50, 0],
  onHandA: 5,
  onHandB: 20,
  ltA: 1,
  ltB: 2,
};

export const BE_EMPTY = { fixed_cost: 0, variable_cost: 0, price: 0, volume: 0 };
export const BE_EX = { fixed_cost: 1000, variable_cost: 5, price: 15, volume: 200 };

export const STAT_EMPTY = {
  analysis: "descriptive",
  data: [0],
  x: [0],
  y: [0],
};
export const STAT_EX = {
  analysis: "descriptive",
  data: [2, 4, 4, 4, 5, 5, 7, 9],
  x: [1, 2, 3, 4, 5],
  y: [2, 3, 5, 4, 6],
};

export const ASA_EMPTY = { plan: "attributes_single", N: 0, n: 0, c: 0 };
export const ASA_EX = { plan: "attributes_single", N: 1000, n: 50, c: 2 };

export const ILP_EMPTY = {
  sense: "max",
  objX: 0,
  objY: 0,
  c1x: 0,
  c1y: 0,
  c1rhs: 0,
};
export const ILP_EX = {
  sense: "max",
  objX: 3,
  objY: 2,
  c1x: 2,
  c1y: 1,
  c1rhs: 10,
};

export const QP_EMPTY = {
  Q: [
    [1, 0],
    [0, 1],
  ],
  c: [0, 0],
  boundsLow: [-1, -1],
  boundsHigh: [1, 1],
  constraints: [] as { coeffs: number[]; rhs: number }[],
};
export const QP_EX = {
  Q: [
    [2, 0],
    [0, 2],
  ],
  c: [-2, -5],
  boundsLow: [-1, -1],
  boundsHigh: [1, 1],
  constraints: [] as { coeffs: number[]; rhs: number }[],
};

export const NLP_EMPTY = {
  quadratic_diag: [1, 1],
  linear: [0, 0],
  x0: [0, 0],
  boundsLow: [-5, -5],
  boundsHigh: [5, 5],
  constraints: [] as { coeffs: number[]; rhs: number }[],
};
export const NLP_EX = {
  quadratic_diag: [1, 1],
  linear: [0, 0],
  x0: [1, -1],
  boundsLow: [-5, -5],
  boundsHigh: [5, 5],
  constraints: [] as { coeffs: number[]; rhs: number }[],
};

export const QSS_EMPTY = {
  arrival_rate: 0,
  service_rate: 0,
  num_servers: 1,
  simulation_time: 100,
  warmup: 0,
  seed: 42,
};
export const QSS_EX = {
  arrival_rate: 8,
  service_rate: 10,
  num_servers: 2,
  simulation_time: 500,
  warmup: 50,
  seed: 42,
};

export const JOBS_EMPTY = {
  rule: "spt",
  jobs: [{ id: "J1", time: 0, due_date: 0 }],
};
export const JOBS_EX = {
  rule: "spt",
  jobs: [
    { id: "J1", time: 3, due_date: 10 },
    { id: "J2", time: 5, due_date: 12 },
    { id: "J3", time: 2, due_date: 8 },
    { id: "J4", time: 4, due_date: 15 },
  ],
};

export const AGG_EMPTY = {
  demand: [0],
  initial_workforce: 0,
  production_per_worker: 0,
  cost_hire: 0,
  cost_fire: 0,
  cost_hold: 0,
  strategy: "level",
};
export const AGG_EX = {
  demand: [100, 120, 110, 130],
  initial_workforce: 10,
  production_per_worker: 10,
  cost_hire: 500,
  cost_fire: 800,
  cost_hold: 2,
  strategy: "level",
};

export const FAC_EMPTY = {
  mode: "center_of_gravity",
  points: [{ name: "C1", x: 0, y: 0, volume: 0 }],
  cycleTime: 0,
  tasks: [{ id: "T1", time: 0, predecessors: "" }],
};
export const FAC_EX = {
  mode: "center_of_gravity",
  points: [
    { name: "C1", x: 10, y: 20, volume: 100 },
    { name: "C2", x: 30, y: 40, volume: 200 },
    { name: "C3", x: 50, y: 10, volume: 150 },
  ],
  cycleTime: 10,
  tasks: [
    { id: "A", time: 3, predecessors: "" },
    { id: "B", time: 4, predecessors: "A" },
    { id: "C", time: 2, predecessors: "A" },
  ],
};
