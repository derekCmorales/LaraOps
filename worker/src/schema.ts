export type SolveStatus = "optimal" | "ok" | "infeasible" | "unbounded" | "error";

export type SolutionBlock = {
  variables: Record<string, number>;
  objective_value: number | null;
  objective_sense: "min" | "max" | null;
  metrics: Record<string, number>;
};

export type SensitivityBlock = {
  shadow_prices: Record<string, unknown>[];
  reduced_costs: Record<string, unknown>[];
  objective_ranges: Record<string, unknown>[];
  rhs_ranges: Record<string, unknown>[];
  constraint_analysis: Record<string, unknown>[];
};

export type NamedTable = {
  name: string;
  columns: string[];
  rows: unknown[][];
};

export type GraphXY = {
  type: "xy";
  series: Record<string, unknown>[];
  x_label?: string;
  y_label?: string;
  z_label?: string;
  title?: string;
  subtitle?: string;
  kind?: string;
};

export type GraphNetwork = {
  type: "network";
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  title?: string;
  subtitle?: string;
};

export type GraphGantt = {
  type: "gantt";
  bars: Record<string, unknown>[];
  title?: string;
  subtitle?: string;
  x_label?: string;
};

export type GraphMatrix = {
  type: "matrix";
  row_labels: string[];
  col_labels: string[];
  values: (number | null)[][];
  title?: string;
  subtitle?: string;
  value_label?: string;
};

export type GraphPayload = GraphXY | GraphNetwork | GraphGantt | GraphMatrix;

export type IterationStep = {
  index: number;
  method: string;
  title: string;
  tableau: (number | string)[][] | null;
  meta: Record<string, unknown>;
};

export type ModuleResult = {
  module: string;
  status: SolveStatus;
  solution: SolutionBlock;
  iterations: IterationStep[] | null;
  sensitivity: SensitivityBlock | null;
  graph: GraphPayload | null;
  tables: NamedTable[] | null;
  warnings: string[];
};

export function emptySensitivity(): SensitivityBlock {
  return {
    shadow_prices: [],
    reduced_costs: [],
    objective_ranges: [],
    rhs_ranges: [],
    constraint_analysis: [],
  };
}

export function okResult(
  module: string,
  partial: {
    status?: SolveStatus;
    variables?: Record<string, number>;
    objective_value?: number | null;
    objective_sense?: "min" | "max" | null;
    metrics?: Record<string, number>;
    iterations?: IterationStep[] | null;
    sensitivity?: SensitivityBlock | null;
    graph?: GraphPayload | null;
    tables?: NamedTable[] | null;
    warnings?: string[];
  },
): ModuleResult {
  return {
    module,
    status: partial.status ?? "ok",
    solution: {
      variables: partial.variables ?? {},
      objective_value: partial.objective_value ?? null,
      objective_sense: partial.objective_sense ?? null,
      metrics: partial.metrics ?? {},
    },
    iterations: partial.iterations ?? null,
    sensitivity: partial.sensitivity ?? null,
    graph: partial.graph ?? null,
    tables: partial.tables ?? null,
    warnings: partial.warnings ?? [],
  };
}
