export type ModuleMeta = {
  slug: string;
  path: string;
  name: string;
  methods: string;
  group: string;
  keywords: string[];
  api: string;
  /** Visible en home y búsqueda (workbench migrado). */
  migrated: boolean;
  /** Palabras del problema (no del método) para que la búsqueda entienda «fila en el banco». */
  problems?: string[];
};

export const MODULE_GROUPS = [
  "Optimización",
  "Redes y flujo",
  "Proyectos",
  "Aleatoriedad y espera",
  "Inventarios y producción",
  "Predicción y decisión",
  "Calidad y estadística",
] as const;

export const MODULES: ModuleMeta[] = [
  {
    slug: "lp",
    path: "/lp",
    name: "Programación lineal",
    methods: "Simplex, sensibilidad, gráfico 2D y 3D",
    group: "Optimización",
    keywords: ["lp", "simplex", "lineal", "sensibilidad", "ranging", "precio sombra"],
    api: "lp",
    migrated: true,
    problems: ["producción", "recursos", "mezcla", "dieta", "ganancia", "utilidad máxima", "costo mínimo", "restricciones", "horas de máquina"],
  },
  {
    slug: "ilp",
    path: "/ilp",
    name: "Programación entera",
    methods: "Ramificación y acotamiento, enteras mixtas",
    group: "Optimización",
    keywords: ["ilp", "entera", "branch", "bound", "binaria", "mip"],
    api: "ilp",
    migrated: false,
  },
  {
    slug: "goal",
    path: "/goal",
    name: "Programación por metas",
    methods: "Metas con prioridades",
    group: "Optimización",
    keywords: ["goal", "metas", "gp", "prioridades"],
    api: "goal_programming",
    migrated: false,
  },
  {
    slug: "qp",
    path: "/qp",
    name: "Programación cuadrática",
    methods: "Cuadrática con restricciones lineales",
    group: "Optimización",
    keywords: ["cuadrática", "qp", "quadratic"],
    api: "quadratic_programming",
    migrated: false,
  },
  {
    slug: "nlp",
    path: "/nlp",
    name: "Programación no lineal",
    methods: "Óptimo local y trayectoria",
    group: "Optimización",
    keywords: ["no lineal", "nlp", "nonlinear"],
    api: "nonlinear_programming",
    migrated: false,
  },
  {
    slug: "dp",
    path: "/dp",
    name: "Programación dinámica",
    methods: "Mochila, diligencia por etapas",
    group: "Optimización",
    keywords: ["dp", "dinámica", "mochila", "knapsack", "stagecoach", "etapas"],
    api: "dynamic_programming",
    migrated: false,
  },
  {
    slug: "transport",
    path: "/transport",
    name: "Transporte",
    methods: "Vogel, noroeste, costo mínimo, MODI",
    group: "Redes y flujo",
    keywords: ["transporte", "vogel", "modi", "noroeste", "vam"],
    api: "transport",
    migrated: true,
    problems: ["envío", "enviar", "fábricas", "plantas", "almacenes", "bodegas", "flete", "distribución", "oferta", "demanda"],
  },
  {
    slug: "assignment",
    path: "/assignment",
    name: "Asignación",
    methods: "Método húngaro",
    group: "Redes y flujo",
    keywords: ["asignación", "húngaro", "hungarian", "asignar", "trabajadores", "máquinas", "tareas"],
    api: "assignment",
    migrated: true,
    problems: ["personas", "operarios", "empleados", "turnos", "uno a uno", "repartir tareas"],
  },
  {
    slug: "networks",
    path: "/networks",
    name: "Redes",
    methods: "Ruta corta, árbol mínimo, flujo máximo, transbordo, viajante",
    group: "Redes y flujo",
    keywords: ["redes", "dijkstra", "kruskal", "flujo", "tsp", "árbol", "transbordo"],
    api: "networks",
    migrated: true,
    problems: ["ruta", "camino", "distancia", "conectar", "cable", "tubería", "red", "ciudades", "flujo máximo"],
  },
  {
    slug: "pert-cpm",
    path: "/pert-cpm",
    name: "PERT/CPM",
    methods: "Ruta crítica, PERT, Gantt, aceleración",
    group: "Proyectos",
    keywords: ["pert", "cpm", "ruta crítica", "gantt", "proyecto", "crashing"],
    api: "pert_cpm",
    migrated: true,
    problems: ["actividades", "obra", "cronograma", "plazo", "precedencia", "holgura", "atraso"],
  },
  {
    slug: "jobs",
    path: "/jobs",
    name: "Programación de tareas",
    methods: "SPT, EDD, Johnson",
    group: "Proyectos",
    keywords: ["job", "scheduling", "spt", "edd", "johnson", "makespan"],
    api: "job_scheduling",
    migrated: false,
  },
  {
    slug: "queues",
    path: "/queues",
    name: "Teoría de colas",
    methods: "M/M/1, M/M/s, capacidad K, población finita, M/G/1, costos",
    group: "Aleatoriedad y espera",
    keywords: ["colas", "fila", "espera", "waiting", "mm1", "mms", "erlang", "servidores", "rho", "lq", "wq", "little"],
    api: "queues",
    migrated: true,
    problems: ["fila", "banco", "cajas", "clientes esperando", "tiempo de espera", "llegadas", "servicio"],
  },
  {
    slug: "qss",
    path: "/qss",
    name: "Simulación de colas",
    methods: "Eventos discretos M/M/s, cupo y calentamiento",
    group: "Aleatoriedad y espera",
    keywords: ["simulación", "colas", "qss", "eventos", "discreta"],
    api: "queuing_simulation",
    migrated: true,
    problems: ["fila simulada", "eventos discretos", "comparar con teoría"],
  },
  {
    slug: "monte-carlo",
    path: "/monte-carlo",
    name: "Simulación Monte Carlo",
    methods: "Números aleatorios, variables y réplicas",
    group: "Aleatoriedad y espera",
    keywords: ["monte carlo", "simulación", "aleatorio", "semilla", "réplicas", "uniforme", "exponencial"],
    api: "monte_carlo",
    migrated: true,
    problems: ["riesgo", "incertidumbre", "estimar", "aleatorios", "congruencial", "probabilidad"],
  },
  {
    slug: "markov",
    path: "/markov",
    name: "Cadenas de Markov",
    methods: "Clases, estado estable, absorción y decisiones",
    group: "Aleatoriedad y espera",
    keywords: ["markov", "transición", "absorbente", "estado estable", "recurrente", "política"],
    api: "markov",
    migrated: true,
    problems: ["cambio de marca", "clima", "estados", "probabilidad de transición", "largo plazo", "mantenimiento"],
  },
  {
    slug: "eoq",
    path: "/eoq",
    name: "EOQ",
    methods: "Cantidad económica de pedido",
    group: "Inventarios y producción",
    keywords: ["eoq", "pedido", "inventario básico"],
    api: "eoq",
    migrated: true,
    problems: ["cuánto pedir", "lote", "compras", "almacenar", "reorden", "inventario"],
  },
  {
    slug: "inventory",
    path: "/inventory",
    name: "Inventarios",
    methods: "EOQ, descuentos, EPQ, vendedor de periódicos",
    group: "Inventarios y producción",
    keywords: ["inventario", "epq", "newsvendor", "wagner", "backorder"],
    api: "inventory",
    migrated: false,
  },
  {
    slug: "mrp",
    path: "/mrp",
    name: "MRP",
    methods: "Explosión de materiales, liberaciones planeadas",
    group: "Inventarios y producción",
    keywords: ["mrp", "bom", "materiales"],
    api: "mrp",
    migrated: false,
  },
  {
    slug: "aggregate",
    path: "/aggregate",
    name: "Planeación agregada",
    methods: "Persecución, nivel constante, mixta",
    group: "Inventarios y producción",
    keywords: ["agregada", "aggregate", "chase", "level"],
    api: "aggregate_planning",
    migrated: false,
  },
  {
    slug: "facility",
    path: "/facility",
    name: "Localización y layout",
    methods: "Centro de gravedad, balanceo de línea",
    group: "Inventarios y producción",
    keywords: ["localización", "layout", "gravedad", "balanceo"],
    api: "facility_location",
    migrated: false,
  },
  {
    slug: "forecasting",
    path: "/forecasting",
    name: "Pronósticos",
    methods: "Media móvil, Holt, Winters, tendencia",
    group: "Predicción y decisión",
    keywords: ["pronóstico", "holt", "winters", "mape", "forecast"],
    api: "forecasting",
    migrated: false,
  },
  {
    slug: "decision",
    path: "/decision",
    name: "Análisis de decisiones",
    methods: "Tabla de pagos, utilidad, árbol, Bayes",
    group: "Predicción y decisión",
    keywords: ["decisión", "árbol", "emv", "evpi", "hurwicz", "bayes", "utilidad"],
    api: "decision_analysis",
    migrated: true,
    problems: ["incertidumbre", "riesgo", "elegir", "alternativas", "pagos", "costos", "información perfecta", "veip"],
  },
  {
    slug: "game",
    path: "/game",
    name: "Teoría de juegos",
    methods: "Punto silla, mixtas y formulación lineal",
    group: "Predicción y decisión",
    keywords: ["juegos", "silla", "mixta", "dominada", "maximin"],
    api: "game_theory",
    migrated: true,
    problems: ["rival", "competencia", "competidor", "adversario", "suma cero", "estrategias"],
  },
  {
    slug: "quality",
    path: "/quality",
    name: "Control de calidad",
    methods: "Cartas X̄-R, p, c, u; Cp/Cpk",
    group: "Calidad y estadística",
    keywords: ["calidad", "carta", "xbar", "cpk", "control"],
    api: "quality_control",
    migrated: false,
  },
  {
    slug: "asa",
    path: "/asa",
    name: "Muestreo de aceptación",
    methods: "Curva OC, AOQ, diseño de plan",
    group: "Calidad y estadística",
    keywords: ["muestreo", "asa", "oc", "aql", "ltpd"],
    api: "acceptance_sampling",
    migrated: false,
  },
  {
    slug: "statistics",
    path: "/statistics",
    name: "Estadística",
    methods: "Descriptiva, regresión, pruebas, distribuciones",
    group: "Calidad y estadística",
    keywords: ["estadística", "regresión", "ttest", "normal"],
    api: "statistics",
    migrated: false,
  },
  {
    slug: "breakeven",
    path: "/breakeven",
    name: "Punto de equilibrio",
    methods: "Costo-volumen-utilidad, alternativas",
    group: "Calidad y estadística",
    keywords: ["equilibrio", "breakeven", "cvp", "contribución"],
    api: "breakeven",
    migrated: false,
  },
];

export const MIGRATED_MODULES = MODULES.filter((m) => m.migrated);

/** Minúsculas y sin acentos: «hungaro» encuentra «húngaro» y «asignacion» encuentra «Asignación». */
export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Palabras sueltas que no ayudan a distinguir un módulo de otro. */
const STOP = new Set(["de", "la", "el", "los", "las", "un", "una", "en", "y", "o", "a", "con", "para", "por", "que", "mi", "me", "se", "del", "al", "como", "cuanto", "cuantos", "cuantas"]);

/**
 * Puntaje de coincidencia. 0 = no aparece. El nombre pesa más que las palabras clave,
 * y éstas más que los métodos; así «colas» pone primero Teoría de colas.
 */
function scoreModule(module: ModuleMeta, query: string): number {
  const q = normalizeText(query.trim());
  if (!q) return 1;
  const name = normalizeText(module.name);
  const keys = normalizeText([...module.keywords, ...(module.problems ?? [])].join(" | "));
  const rest = normalizeText([module.methods, module.group].join(" "));
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  if (keys.includes(q)) return 50;
  if (rest.includes(q)) return 40;
  const tokens = q.split(/\s+/).filter((tok) => tok.length > 1 && !STOP.has(tok));
  if (!tokens.length) return 0;
  const hay = `${name} ${keys} ${rest}`;
  // Coincidencia por raíz: «almacenes» encuentra «almacén» y «filas» encuentra «fila».
  const hits = tokens.filter((tok) => hay.includes(tok) || (tok.length > 4 && hay.includes(tok.slice(0, -2))));
  if (!hits.length) return 0;
  return (hits.length / tokens.length) * 30;
}

function matchesQuery(module: ModuleMeta, query: string): boolean {
  return scoreModule(module, query) > 0;
}

export function searchModules(query: string): ModuleMeta[] {
  if (!query.trim()) return MIGRATED_MODULES;
  return MIGRATED_MODULES.map((m) => ({ m, score: scoreModule(m, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.m);
}

/** Módulos del catálogo que aún no aparecen como activos en el home. */
export function searchDisabledModules(query: string): ModuleMeta[] {
  return MODULES.filter((m) => !m.migrated && matchesQuery(m, query));
}

export function moduleByPath(path: string): ModuleMeta | undefined {
  return MODULES.find((m) => m.path === path || m.slug === path.replace(/^\//, ""));
}
