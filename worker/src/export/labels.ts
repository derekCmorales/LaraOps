const LABELS: Record<string, string> = {
  module: "módulo",
  status: "estado",
  variable: "variable",
  value: "valor",
  objective_value: "valor objetivo",
  objective_sense: "sentido del objetivo",
  metric: "métrica",
  metrics: "métricas",
  warnings: "advertencias",
  index: "índice",
  method: "método",
  title: "título",
  meta: "meta",
  shadow_prices: "precios sombra",
  reduced_costs: "costos reducidos",
  objective_ranges: "rangos de optimalidad",
  rhs_ranges: "rangos de factibilidad",
  constraint_analysis: "análisis de restricciones",
  lhs: "lado izquierdo",
  sense: "sentido",
  rhs: "lado derecho",
  slack_or_surplus: "holgura o exceso",
  shadow_price: "precio sombra",
  allowable_min_rhs: "LD mín. permitido",
  allowable_max_rhs: "LD máx. permitido",
  coeff: "coef. actual",
  reduced_cost: "costo reducido",
  min_coef: "coef. mínimo",
  max_coef: "coef. máximo",
  allowable_increase: "aumento permitido",
  allowable_decrease: "disminución permitida",
  schedule: "cronograma",
  critical_path: "ruta crítica",
  gantt: "gantt",
  flows: "flujos",
  min_cut: "corte mínimo",
  vertices_feasible: "Vértices de la región factible",
  optimo: "óptimo",
  infeasible: "infactible",
  unbounded: "no acotado",
  min: "minimización",
  max: "maximización",
  durations_after_crash: "Duraciones tras aceleración",
  cost_by_s: "costo por servidores",
  Pn: "Pn",
  path_length: "longitud de la ruta",
  mst_weight: "peso del árbol mínimo",
  max_flow: "flujo máximo",
  min_cut_value: "valor del corte mínimo",
  tour_length: "longitud del recorrido",
  total_cost: "costo total",
  costo_unitario: "costo unitario",
  peso: "peso",
  ruta: "ruta",
  aristas_mst: "aristas del árbol mínimo",
  recorrido: "recorrido",
  lambda: "tasa de llegada (λ)",
  mu: "tasa de servicio (μ)",
  rho: "utilización (ρ)",
  Lq: "clientes en cola (Lq)",
  L: "clientes en el sistema (L)",
  Wq: "espera en cola (Wq)",
  W: "espera en el sistema (W)",
  P0: "prob. sistema vacío (P₀)",
  lambda_eff: "tasa efectiva de llegada (λeff)",
  cost_waiting: "costo de espera",
  cost_server: "costo de servidores",
  cost_total: "costo total",
  servidores: "servidores",
  costo_espera: "costo de espera",
  costo_servidor: "costo de servidores",
  costo_total: "costo total",
  óptimo: "óptimo",
};

export function labelKey(key: string): string {
  const k = key.trim();
  if (!k) return "—";
  if (LABELS[k]) return LABELS[k];
  const lower = k.toLowerCase();
  if (LABELS[lower]) return LABELS[lower];
  return k.replaceAll("_", " ");
}

export function labelColumns(columns: string[]): string[] {
  return columns.map(labelKey);
}

export function labelTableName(name: string): string {
  return labelKey(name);
}
