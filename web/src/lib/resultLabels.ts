/** Etiquetas amigables en español para claves del API y la UI. */

const LABELS: Record<string, string> = {
  // Estado / objetivo
  optimal: "Óptimo",
  ok: "Óptimo",
  infeasible: "Infactible",
  unbounded: "No acotado",
  feasible: "Factible",
  error: "Error",
  min: "minimización",
  max: "maximización",
  objective_value: "Valor objetivo (Z)",
  objective_sense: "Sentido del objetivo",

  // LP / sensibilidad
  shadow_price: "Precio sombra",
  shadow_prices: "Precios sombra",
  reduced_cost: "Costo reducido",
  reduced_costs: "Costos reducidos",
  constraint_id: "Restricción",
  constraint_analysis: "Análisis de restricciones",
  lhs: "Lado izquierdo",
  sense: "Sentido",
  rhs: "Lado derecho",
  slack_or_surplus: "Holgura o exceso",
  allowable_min_rhs: "LD mín. permitido",
  allowable_max_rhs: "LD máx. permitido",
  min_coef: "Coef. mínimo",
  max_coef: "Coef. máximo",
  coeff: "Coef. actual",
  variable: "Variable",
  allowable_increase: "Aumento permitido",
  allowable_decrease: "Disminución permitida",
  objective_ranges: "Rangos de optimalidad",
  rhs_ranges: "Rangos de factibilidad (LD)",
  current: "Actual",
  actual: "Serie real",
  lower: "Mínimo",
  upper: "Máximo",
  basic: "Básicas",
  nonbasic: "No básicas",
  pivot: "Pivote",
  phase: "Fase",
  z: "Z",
  enter: "Entra",
  leave: "Sale",
  relaxation_objective: "Objetivo de relajación",
  branch_variable: "Variable de ramificación",
  pruned_reason: "Motivo de poda",
  children: "Hijos",
  parent_id: "Padre",
  depth: "Profundidad",
  node_id: "Nodo",
  status_node: "Estado del nodo",
  bound: "Cota",
  integer: "Entero",
  infeasible_node: "Infactible",
  unbounded_node: "No acotado",
  row_min: "Mínimo por fila",
  col_min: "Mínimo por columna",
  cover_rows: "Filas cubiertas",
  cover_cols: "Columnas cubiertas",
  delta: "Ajuste",
  rows: "Filas",
  cols: "Columnas",
  goals: "Metas",
  priority: "Prioridad",
  variables_meta: "Variables",
  objective: "Objetivo",

  // Colas
  lambda: "Tasa de llegada (λ)",
  mu: "Tasa de servicio (μ)",
  rho: "Utilización (ρ)",
  Lq: "Clientes en cola (Lq)",
  L: "Clientes en el sistema (L)",
  Wq: "Espera en cola (Wq)",
  W: "Espera en el sistema (W)",
  Pn: "Probabilidad Pn",
  P0: "Prob. sistema vacío (P₀)",
  lambda_eff: "Tasa efectiva de llegada (λeff)",
  cost_waiting: "Costo de espera",
  cost_server: "Costo de servidores",
  cost_total: "Costo total",
  servidores: "Servidores",
  costo_espera: "Costo de espera",
  costo_servidor: "Costo de servidores",
  costo_total: "Costo total",
  óptimo: "Óptimo",
  s: "Servidores",
  c: "Defectos (c)",
  served: "Atendidos",
  rejected: "Rechazados",
  utilization: "Utilización",
  n: "n",
  num_servers: "Servidores",

  // Inventarios
  Q: "Cantidad de pedido (Q*)",
  Q_star: "Cantidad óptima (Q*)",
  EOQ: "Cantidad económica (EOQ)",
  TC: "Costo total",
  D: "Demanda anual (D)",
  S: "Costo de ordenar (S)",
  H: "Costo de mantener (H)",
  C: "Costo unitario (C)",
  ROP: "Punto de reorden",
  total_deviation: "Desviación total",
  priorities: "Prioridades",
  game_value: "Valor del juego",
  maximin: "Máximin",
  minimax: "Mínimax",
  maximax: "Máximax",
  minimax_regret: "Mínimo arrepentimiento (Minimax)",
  laplace: "Laplace (equiprobable)",
  hurwicz: "Hurwicz",
  expected_value: "Valor esperado",
  EOL_choice: "Mejor arrepentimiento esperado (EOL)",
  EV: "Valor esperado (VE)",
  EVwPI: "VE con información perfecta (VEIP)",
  EVPI: "Valor de la información perfecta (VIP)",
  EVwSI: "VE con información muestral (VEIM)",
  EVSI: "Valor de la información muestral (VIM)",
  EOL: "Arrepentimiento esperado (EOL)",
  maximax_payoff: "Pago máximax",
  maximin_payoff: "Pago máximin",
  hurwicz_payoff: "Pago Hurwicz",
  hurwicz_alpha: "α Hurwicz",
  laplace_payoff: "Pago Laplace",
  EV_root: "VE en la raíz",
  best_child_count: "Nodos de decisión resueltos",
  root: "Valor en la raíz",
  best_prior_action: "Mejor acción (sin muestra)",
  signal: "Señal",
  "P(signal)": "P(señal)",
  best_action: "Mejor acción",
  "EV|signal": "VE | señal",
  current_best: "Mejor alternativa actual",
  competitor: "Competidor",
  breakeven_probability_state1: "Punto de indiferencia P(estado 1)",
  decision: "Decisión",
  chance: "Azar",
  terminal: "Terminal",
  tipo: "Tipo",
  mejor_hijo: "Mejor hijo",

  // Pronósticos
  naive: "Ingenuo",
  moving_average: "Media móvil",
  exponential: "Suavizado exponencial",
  holt: "Holt",
  winters: "Holt-Winters",
  mape: "MAPE (%)",
  mae: "Error absoluto medio (MAE)",
  mse: "Error cuadrático medio (MSE)",
  rmse: "Raíz del ECM (RMSE)",
  forecast: "Pronóstico",
  fitted: "Ajuste",
  series: "Serie",
  periodo: "Periodo",
  método: "Método",
  fuerza_laboral: "Fuerza laboral",
  contrataciones: "Contrataciones",
  despidos: "Despidos",
  faltante: "Faltante",
  criterio: "Criterio",
  alternativa: "Alternativa",
  origen: "Origen",
  destino: "Destino",
  flujo: "Flujo",
  capacidad: "Capacidad",
  costo_unitario: "Costo unitario",
  ítem: "Ítem",
  término: "Término",
  coeficiente: "Coeficiente",
  best_mape: "Mejor MAPE",
  best_mad: "Mejor MAD",

  // Gráficas — ejes y series frecuentes
  Units: "Unidades",
  units: "Unidades",
  Money: "Dinero ($)",
  money: "Dinero ($)",
  Cost: "Costo",
  time: "Tiempo",
  Time: "Tiempo",
  subgroup: "Subgrupo",
  sample: "Muestra",
  bin_center: "Centro del intervalo",
  histogram: "Histograma",
  histograma: "Histograma",
  demand: "Demanda",
  production: "Producción",
  inventory: "Inventario",
  ordering: "Costo de ordenar",
  holding: "Costo de mantener",
  queue: "Cola",
  queue_length: "Longitud de cola",
  longitud_cola: "Longitud de cola",
  xbar: "Media muestral (X̄)",
  UCL: "Límite superior de control (LSC)",
  LCL: "Límite inferior de control (LIC)",
  CL: "Línea central (LC)",
  OC_Pa: "Curva OC (Pa)",
  AOQ: "Calidad promedio de salida (AOQ)",
  ATI: "Tamaño promedio de inspección (ATI)",
  "p (fraction defective)": "Fracción defectuosa (p)",
  "Pa / AOQ": "Pa / AOQ",
  TR: "Ingreso total (IT)",
  data: "Datos",
  fit: "Ajuste (recta)",
  optimum: "Punto óptimo",
  objective_level: "Línea de nivel de Z",
  feasible_region: "Región factible",
  vertices: "Vértices",
  vertices_feasible: "Vértices de la región factible",
  optimo: "Óptimo",
  x1_path: "Trayectoria de x₁",
  "n (clientes en el sistema)": "n (clientes en el sistema)",
  "P(estrategia)": "Probabilidad de la estrategia",
  "Pago esperado": "Pago esperado",
  p: "Proporción defectuosa (p)",
  u: "Defectos por unidad (u)",
  "Nivel de inventario": "Nivel de inventario",
  "Punto de reorden": "Punto de reorden",
  "Q usado": "Cantidad usada (Q)",
  "Costo total anual": "Costo total anual",
  makespan: "Tiempo total (makespan)",

  // PERT / redes
  IT: "Inicio temprano (IT)",
  FT: "Fin temprano (FT)",
  ITa: "Inicio tardío (ITa)",
  FTa: "Fin tardío (FTa)",
  holgura: "Holgura",
  crítica: "Crítica",
  varianza: "Varianza",
  trabajo: "Trabajo",
  inicio: "Inicio",
  fin: "Fin",
  retraso: "Retraso",
  te: "Tiempo esperado (te)",
  end: "Fin",
  workforce: "Fuerza laboral",
  hire: "Contrataciones",
  fire: "Despidos",
  shortage: "Faltante",
  item: "Ítem",
  stage: "Etapa",
  state: "Estado",
  relaxation_z: "Z de relajación",
  integer_z: "Z entero",
  stage_i: "Etapa i",
  capacity_w: "Capacidad w",
  "f_i(w)": "fᵢ(w)",
  x_star: "Decisión óptima",
  "f_n(s)": "fₙ(s)",
  duration: "Duración",
  early_start: "Inicio temprano",
  early_finish: "Fin temprano",
  late_start: "Inicio tardío",
  late_finish: "Fin tardío",
  slack: "Holgura",
  critical: "Crítica",
  flow: "Flujo",
  weight: "Peso",
  path: "Ruta",
  order: "Orden",
  node: "Nodo",
  source: "Origen",
  target: "Destino",
  unit_cost: "Costo unitario",
  capacity: "Capacidad",
  u_edge: "Origen",
  v_edge: "Destino",

  // Métodos
  simplex: "Simplex",
  modi: "MODI",
  vogel: "Vogel",
  hungarian: "Método húngaro",
  branch_and_bound: "Ramificación y acotamiento",
  branch_bound: "Ramificación y acotamiento",
  northwest: "Esquina noroeste",
  least_cost: "Costo mínimo",
  preemptive_gp: "Programación por metas preemptiva",

  // Tablas / miscelánea
  assignment_steps: "Pasos del método húngaro",
  iteration: "Iteración",
  iterations: "Iteraciones",
  solution: "Solución",
  metrics: "Métricas",
  variables: "Variables",
  constraints: "Restricciones",
  value: "Valor",
  name: "Nombre",
  id: "Id",
  status: "Estado",
  cost: "Costo",
  profit: "Utilidad",
  probability: "Probabilidad",
  mean: "Media",
  std: "Desviación estándar",
  variance: "Varianza",
  median: "Mediana",
  mode: "Moda",
  count: "Frecuencia",
  sum: "Suma",
  min_value: "Mínimo",
  max_value: "Máximo",
  intercept: "Intercepto",
  slope: "Pendiente",
  r2: "R²",
  p_value: "Valor p",
  t_stat: "Estadístico t",
  z_stat: "Estadístico z",
  breakeven: "Punto de equilibrio",
  contribution: "Margen de contribución",
  fixed_cost: "Costo fijo",
  variable_cost: "Costo variable",
  price: "Precio",
  volume: "Volumen",
  yes: "sí",
  no: "no",
  achieved: "Cumplida",
  d_plus: "Desviación positiva (d⁺)",
  d_minus: "Desviación negativa (d⁻)",
  metas: "Metas",
  meta: "Meta",
  goal: "Meta",
  objetivo: "Objetivo",
  d_mas: "Desviación positiva (d⁺)",
  d_menos: "Desviación negativa (d⁻)",
  cumplida: "Cumplida",
  agente: "Agente",
  tarea: "Tarea",
  fila: "Fila",
  columna: "Columna",
  estrategia: "Estrategia",
  probabilidad: "Probabilidad",
  punto_silla_puro: "Punto de silla puro",
  estrategia_mixta: "Estrategia mixta",
  ruta: "Ruta",
  orden: "Orden",
  nodo: "Nodo",
  aristas_mst: "Aristas del árbol mínimo",
  recorrido: "Recorrido",
  resumen: "Resumen",
  métrica: "Métrica",
  valor: "Valor",
  agent: "Agente",
  task: "Tarea",
  job: "Trabajo",
  start: "Inicio",
  completion: "Fin",
  tardiness: "Retraso",
  row: "Fila",
  col: "Columna",
  strategy: "Estrategia",
  criterion: "Criterio",
  alternative: "Alternativa",
  payoff: "Matriz de pagos",
  matriz_pagos: "Matriz de pagos",
  reduced_payoff: "Matriz reducida",
  pure_saddle: "Punto de silla puro",
  mixed_strategy: "Estrategia mixta",
  schedule: "Cronograma",
  critical_path: "Ruta crítica",
  gantt: "Gantt",
  durations_after_crash: "Duraciones tras aceleración",
  flows: "Flujos",
  min_cut: "Corte mínimo",
  tour: "Recorrido",
  mst_edges: "Aristas del árbol mínimo",
  assignment: "Asignación",
  bb_nodes: "Nodos de ramificación y acotamiento",
  oc_aoq: "Curva OC y AOQ",
  summary: "Resumen",
  descriptive: "Estadística descriptiva",
  regression: "Regresión",
  coefficients: "Coeficientes",
  distribution: "Distribución",
  ttest: "Prueba t",
  ztest: "Prueba z",
  error_comparison: "Comparación de errores",
  forecasts: "Pronósticos",
  best_method: "Mejor método",
  method: "Método",
  detail: "Detalle",
  plan: "Plan",
  sites: "Sitios",
  stations: "Estaciones",
  decisions: "Decisiones",
  tree_fold: "Árbol plegado",
  bayes: "Bayes",
  transient: "Estados transitorios",
  steady_state: "Estado estacionario",
  transition_power_n: "Potencia de transición (n pasos)",
  rewards: "Recompensas",
  fundamental_matrix: "Matriz fundamental",
  absorption_probabilities: "Probabilidades de absorción",
  expected_steps_to_absorption: "Pasos esperados hasta absorción",
  expected_reward_to_absorption: "Recompensa esperada hasta absorción",
  cost_by_s: "Costo por número de servidores",
  alternatives: "Alternativas",
  xbar_r: "Carta X̄–R",
  p_chart: "Carta p",
  c_chart: "Carta c",
  u_chart: "Carta u",
  OOC: "Fuera de control",
  selected: "Seleccionados",
  recursion: "Recursión",
  stage_decisions: "Decisiones por etapa",
  node_limit_reached: "Límite de nodos alcanzado",
  producer_risk_realized: "Riesgo del productor (realizado)",
  consumer_risk_realized: "Riesgo del consumidor (realizado)",
  Pa_at_AQL: "Pa en AQL",
  Pa_at_LTPD: "Pa en LTPD",
  Pa_at_0_05: "Pa en p=0.05",
  Pa_at_0_10: "Pa en p=0.10",
  AOQL: "AOQL",
  AOQL_p: "p del AOQL",
  N: "Tamaño del lote (N)",
  BEP_units: "Punto de equilibrio (unidades)",
  Cp: "Cp",
  Cpk: "Cpk",
  out_of_control: "Puntos fuera de control",
  metric: "Métrica",
  Pa: "Probabilidad de aceptación (Pa)",
  ATI_full: "Tamaño promedio de inspección",
  linear_programming: "Programación lineal",
  integer_programming: "Programación entera",
  goal_programming: "Programación por metas",
  quadratic_programming: "Programación cuadrática",
  nonlinear_programming: "Programación no lineal",
  transport: "Transporte",
  assignment_module: "Asignación",
  networks: "Redes",
  pert_cpm: "PERT / CPM",
  queues: "Teoría de colas",
  queuing_simulation: "Simulación de colas",
  markov: "Cadenas de Markov",
  eoq: "EOQ",
  mrp: "MRP",
  aggregate_planning: "Planeación agregada",
  facility_location: "Localización y layout",
  forecasting: "Pronósticos",
  decision_analysis: "Análisis de decisiones",
  game_theory: "Teoría de juegos",
  quality_control: "Control de calidad",
  acceptance_sampling: "Muestreo de aceptación",
  statistics: "Estadística",
  breakeven_module: "Punto de equilibrio",
  job_scheduling: "Programación de tareas",
  dynamic_programming: "Programación dinámica",
};

const SENSE: Record<string, string> = {
  min: "minimización",
  max: "maximización",
  minimize: "minimización",
  maximize: "maximización",
};

const STATUS: Record<string, string> = {
  optimal: "Óptimo encontrado",
  ok: "Óptimo encontrado",
  infeasible: "Infactible",
  unbounded: "No acotado",
  feasible: "Factible",
  error: "Error de cálculo",
};

const WARNING_PATTERNS: [RegExp, string][] = [
  [/No pure-strategy saddle/i, "No hay punto de silla en estrategias puras; se calcula el equilibrio en estrategias mixtas."],
  [/OC uses hypergeometric/i, "La curva OC usa la distribución hipergeométrica (lote finito); M = redondeo(p·N) defectuosos en el lote."],
  [/Simulación de eventos discretos M\/M\/s/i, "Simulación de eventos discretos tipo M/M/s (aproximada; una réplica)."],
  [/Multiple critical paths/i, "Existen varias rutas críticas; se seleccionó la secuencia lexicográficamente menor."],
  [/probabilities do not sum to 1/i, "Las probabilidades no suman 1; se normalizaron."],
  [/exact TSP is limited/i, "El TSP exacto está limitado a ≤10 nodos; se usa heurística."],
  [/falling back to heuristic/i, "se usa heurística como respaldo."],
  [/Balanced with dummy source/i, "Se balanceó con origen ficticio"],
  [/Balanced with dummy dest/i, "Se balanceó con destino ficticio"],
  [/Maximización convertida/i, "Maximización convertida a minimización de costos negados."],
  [/Solución degenerada/i, "Solución degenerada"],
  [/linprog cross-check skipped/i, "Verificación cruzada con linprog omitida"],
  [/linprog cross-check objective mismatch/i, "Discrepancia en verificación cruzada con linprog"],
  [/likelihood column for state/i, "Columna de verosimilitud para el estado"],
  [/GP preemptivo/i, "Programación por metas preemptiva: optimiza P1, luego P2 sin empeorar P1, etc."],
  [/PuLP status at priority/i, "Estado de PuLP en prioridad"],
  [/Crash iteration limit/i, "Se alcanzó el límite de iteraciones de aceleración."],
  [/activity .+ requires a,m,b/i, "La actividad requiere tiempos optimista (a), más probable (m) y pesimista (b) en modo PERT."],
  [/node_supply is required/i, "Se requiere oferta/demanda por nodo para transbordo."],
  [/node_supply keys must match/i, "Las claves de oferta/demanda deben coincidir exactamente con los nodos."],
];

const TITLE_PATTERNS: [RegExp, (...m: string[]) => string][] = [
  [/^Phase I — Iteration (\d+)$/i, (k) => `Fase I — Iteración ${k}`],
  [/^Phase II — Iteration (\d+)$/i, (k) => `Fase II — Iteración ${k}`],
  [/^Fase I — Iteración (\d+)$/i, (k) => `Fase I — Iteración ${k}`],
  [/^Fase II — Iteración (\d+)$/i, (k) => `Fase II — Iteración ${k}`],
  [/^Row reduction$/i, () => "Reducción por filas"],
  [/^Column reduction$/i, () => "Reducción por columnas"],
  [/^Zero cover \((\d+) rows \+ (\d+) cols\)$/i, (r, c) => `Cobertura de ceros (${r} filas + ${c} columnas)`],
  [/^Adjust uncovered by (.+)$/i, (d) => `Ajuste de celdas no cubiertas en ${d}`],
  [/^Optimal assignment$/i, () => "Asignación óptima"],
  [/^NW corner \(([^)]+)\)=(.+)$/i, (p, q) => `Esquina noroeste (${p}) = ${q}`],
  [/^Least cost \(([^)]+)\)=(.+) c=(.+)$/i, (p, q, c) => `Costo mínimo (${p}) = ${q}, c = ${c}`],
  [/^Vogel \(([^)]+)\)=(.+)$/i, (p, q) => `Vogel (${p}) = ${q}`],
  [/^MODI cycle (.+)$/i, (t) => `Ciclo MODI ${t}`],
  [/^Priority P(\d+) — deviation=(.+)$/i, (p, d) => `Prioridad P${p} — desviación = ${d}`],
  [/^Crash (.+) by (.+)$/i, (a, amt) => `Acelerar ${a} en ${amt}`],
  [/^Fila '(.+)' eliminada \(dominada por '(.+)'\)$/i, (r, k) => `Fila «${r}» eliminada (dominada por «${k}»)`],
  [/^Columna '(.+)' eliminada \(dominada por '(.+)'\)$/i, (c, k) => `Columna «${c}» eliminada (dominada por «${k}»)`],
  [/^Camino de aumento (.+) \(cuello de botella = (.+)\)$/i, (path, b) => `Camino de aumento ${path} (cuello de botella = ${b})`],
  [/^Nodo (\d+) — (.+)$/i, (n, rest) => `Nodo ${n} — ${rest}`],
];

/** Traduce una clave técnica a etiqueta visible. */
export function labelOf(key: string): string {
  if (!key) return "—";
  const k = key.trim();
  if (LABELS[k]) return LABELS[k];
  const lower = k.toLowerCase();
  if (LABELS[lower]) return LABELS[lower];

  // pure:A->B, p:Estrategia, q:Estrategia, d+_g1, node_0, step_2
  if (lower.startsWith("pure:")) {
    return `Estrategia pura: ${k.slice(5)}`;
  }
  if (lower.startsWith("p:")) {
    return `Prob. fila «${k.slice(2)}»`;
  }
  if (lower.startsWith("q:")) {
    return `Prob. columna «${k.slice(2)}»`;
  }
  if (lower.startsWith("d+_") || lower.startsWith("d-_")) {
    const sign = k.includes("+") ? "d⁺" : "d⁻";
    return `${sign} (${k.split("_").slice(1).join("_")})`;
  }
  const nodeMatch = /^node_(\d+)$/i.exec(k);
  if (nodeMatch) return `Nodo ${nodeMatch[1]}`;
  const stepMatch = /^step_(\d+)$/i.exec(k);
  if (stepMatch) return `Paso ${stepMatch[1]}`;
  const pSigMatch = /^P\((.+)\|sig\)$/i.exec(k);
  if (pSigMatch) return `P(${pSigMatch[1]}|señal)`;

  if (lower.startsWith("constraint:")) {
    return `Restricción ${k.slice(k.indexOf(":") + 1)}`;
  }
  if (lower.startsWith("tc_")) {
    return `Costo total (${k.slice(3)})`;
  }
  if (lower.startsWith("detail_")) {
    return `Detalle — ${labelOf(k.slice(7))}`;
  }
  if (lower.startsWith("mrp_")) {
    return `MRP — ${k.slice(4)}`;
  }
  if (k.includes("_")) {
    return k
      .split("_")
      .map((w) => LABELS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return k;
}

export function statusLabel(status: string): string {
  const s = status.toLowerCase();
  return STATUS[s] ?? LABELS[s] ?? status;
}

export function senseLabel(sense: string | null | undefined): string | null {
  if (!sense) return null;
  return SENSE[sense.toLowerCase()] ?? sense;
}

export function methodLabel(method: string): string {
  return LABELS[method] ?? LABELS[method.toLowerCase()] ?? labelOf(method);
}

export function translateTitle(title: string): string {
  if (!title) return title;
  for (const [re, fmt] of TITLE_PATTERNS) {
    const m = re.exec(title);
    if (m) return fmt(...m.slice(1));
  }
  return title;
}

export function translateWarning(w: string): string {
  let out = w;
  for (const [re, repl] of WARNING_PATTERNS) {
    if (re.test(out)) {
      out = out.replace(re, repl);
    }
  }
  // Traducciones parciales comunes
  out = out
    .replace(/\bbranch on\b/gi, "ramifica en")
    .replace(/\binfeasible\b/gi, "infactible")
    .replace(/\bunbounded\b/gi, "no acotado")
    .replace(/\binteger\b/gi, "entero")
    .replace(/\bbound\b/gi, "cota")
    .replace(/\brelaxation=/gi, "relajación =")
    .replace(/\brows\b/gi, "filas")
    .replace(/\bcols\b/gi, "columnas")
    .replace(/\byes\b/gi, "sí")
    .replace(/\bno\b/gi, "no");
  return out;
}

/** Traduce nombres de variables de solución. */
export function translateVariable(name: string): string {
  return labelOf(name);
}

/** Traduce valores de criterio / tipo en celdas de tablas de decisión. */
function translateDecisionCell(value: string): string | null {
  const lower = value.toLowerCase();
  const CRITERIA: Record<string, string> = {
    maximax: "Máximax",
    maximin: "Máximin",
    minimax_regret: "Mínimo arrepentimiento",
    hurwicz: "Hurwicz",
    laplace: "Laplace",
    expected_value: "Valor esperado",
    eol_choice: "Mejor arrepentimiento esperado (EOL)",
    decision: "Decisión",
    chance: "Azar",
    terminal: "Terminal",
  };
  if (CRITERIA[lower]) return CRITERIA[lower];

  const detail = /^(hurwicz|laplace|ev):(.+)$/i.exec(value);
  if (detail) {
    const labels: Record<string, string> = { hurwicz: "Hurwicz", laplace: "Laplace", ev: "VE" };
    return `${labels[detail[1].toLowerCase()]} — ${detail[2]}`;
  }
  return null;
}

/** Formatea un valor de celda o métrica para mostrar en español. */
export function formatDisplayValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return value > 0 ? "+∞" : value < 0 ? "−∞" : "—";
    return value.toLocaleString("es-MX", { maximumFractionDigits: 6 });
  }
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    const decisionCell = translateDecisionCell(value);
    if (decisionCell) return decisionCell;
    if (lower === "yes") return "sí";
    if (lower === "no") return "no";
    if (lower === "optimal") return "Óptimo";
    if (lower === "infeasible") return "Infactible";
    if (lower === "unbounded") return "No acotado";
    if (lower === "integer") return "Entero";
    if (lower === "bound") return "Cota";
    if (lower.startsWith("branch on ")) return `Ramifica en ${value.slice(10)}`;
    return value;
  }
  return String(value);
}

/** Formatea valores de meta de iteraciones sin volcar JSON crudo. */
export function formatMetaValue(_metaKey: string, value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number") return formatDisplayValue(value);
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (typeof value === "string") return formatDisplayValue(value);
  if (Array.isArray(value)) {
    if (value.every((x) => typeof x === "number" || typeof x === "string")) {
      return value.map((x) => formatDisplayValue(x)).join(", ");
    }
    return value.map((x) => formatDisplayValue(x)).join(" · ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length <= 8) {
      return entries.map(([k, v]) => `${labelOf(k)}: ${formatDisplayValue(v)}`).join(" · ");
    }
    return JSON.stringify(value);
  }
  return String(value);
}

/** Traduce claves de un objeto a filas [etiqueta, valor]. */
export function labeledEntries(
  obj: Record<string, unknown>
): [string, string | number][] {
  return Object.entries(obj).map(([k, v]) => {
    const val =
      typeof v === "number"
        ? v
        : typeof v === "boolean"
          ? v
            ? "sí"
            : "no"
          : v == null
            ? "—"
            : formatDisplayValue(v);
    return [labelOf(k), val as string | number];
  });
}

/** Traduce nombres de columnas de una tabla del API. */
export function labelColumns(columns: string[]): string[] {
  return columns.map(labelOf);
}

/** Traduce nombre de tabla del API. */
export function tableName(name: string): string {
  return labelOf(name);
}

/** Traduce filas de tabla (valores string como yes/no). */
export function labelTableRows(rows: unknown[][]): unknown[][] {
  return rows.map((row) =>
    row.map((cell) => {
      if (typeof cell === "string") return formatDisplayValue(cell);
      return cell;
    })
  );
}
