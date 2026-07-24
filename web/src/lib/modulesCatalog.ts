export type ModuleMeta = {
  slug: string;
  path: string;
  name: string;
  methods: string;
  group: string;
  keywords: string[];
  api: string;
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
    methods: "Simplex, sensibilidad, gráfico con 2 variables",
    group: "Optimización",
    keywords: ["lp", "simplex", "lineal", "sensibilidad", "ranging", "precio sombra"],
    api: "lp",
  },
  {
    slug: "ilp",
    path: "/ilp",
    name: "Programación entera",
    methods: "Ramificación y acotamiento, enteras mixtas",
    group: "Optimización",
    keywords: ["ilp", "entera", "branch", "bound", "binaria", "mip"],
    api: "ilp",
  },
  {
    slug: "goal",
    path: "/goal",
    name: "Programación por metas",
    methods: "Metas con prioridades",
    group: "Optimización",
    keywords: ["goal", "metas", "gp", "prioridades"],
    api: "goal_programming",
  },
  {
    slug: "qp",
    path: "/qp",
    name: "Programación cuadrática",
    methods: "Cuadrática con restricciones lineales",
    group: "Optimización",
    keywords: ["cuadrática", "qp", "quadratic"],
    api: "quadratic_programming",
  },
  {
    slug: "nlp",
    path: "/nlp",
    name: "Programación no lineal",
    methods: "Óptimo local y trayectoria",
    group: "Optimización",
    keywords: ["no lineal", "nlp", "nonlinear"],
    api: "nonlinear_programming",
  },
  {
    slug: "dp",
    path: "/dp",
    name: "Programación dinámica",
    methods: "Mochila, diligencia por etapas",
    group: "Optimización",
    keywords: ["dp", "dinámica", "mochila", "knapsack", "stagecoach", "etapas"],
    api: "dynamic_programming",
  },
  {
    slug: "transport",
    path: "/transport",
    name: "Transporte",
    methods: "Vogel, noroeste, costo mínimo, MODI",
    group: "Redes y flujo",
    keywords: ["transporte", "vogel", "modi", "noroeste", "vam"],
    api: "transport",
  },
  {
    slug: "assignment",
    path: "/assignment",
    name: "Asignación",
    methods: "Método húngaro",
    group: "Redes y flujo",
    keywords: ["asignación", "húngaro", "hungarian"],
    api: "assignment",
  },
  {
    slug: "networks",
    path: "/networks",
    name: "Redes",
    methods: "Ruta corta, árbol mínimo, flujo máximo, viajante",
    group: "Redes y flujo",
    keywords: ["redes", "dijkstra", "kruskal", "flujo", "tsp", "árbol"],
    api: "networks",
  },
  {
    slug: "pert-cpm",
    path: "/pert-cpm",
    name: "PERT/CPM",
    methods: "Ruta crítica, Gantt, aceleración",
    group: "Proyectos",
    keywords: ["pert", "cpm", "ruta crítica", "gantt", "proyecto", "crashing"],
    api: "pert_cpm",
  },
  {
    slug: "jobs",
    path: "/jobs",
    name: "Programación de tareas",
    methods: "SPT, EDD, Johnson",
    group: "Proyectos",
    keywords: ["job", "scheduling", "spt", "edd", "johnson", "makespan"],
    api: "job_scheduling",
  },
  {
    slug: "queues",
    path: "/queues",
    name: "Teoría de colas",
    methods: "M/M/1, M/M/s, M/G/1, costos",
    group: "Aleatoriedad y espera",
    keywords: ["colas", "waiting", "mm1", "rho", "lq", "wq"],
    api: "queues",
  },
  {
    slug: "qss",
    path: "/qss",
    name: "Simulación de colas",
    methods: "Eventos discretos, réplicas",
    group: "Aleatoriedad y espera",
    keywords: ["simulación", "colas", "qss", "eventos"],
    api: "queuing_simulation",
  },
  {
    slug: "markov",
    path: "/markov",
    name: "Cadenas de Markov",
    methods: "Estado estable, absorbentes",
    group: "Aleatoriedad y espera",
    keywords: ["markov", "transición", "absorbente", "estado estable"],
    api: "markov",
  },
  {
    slug: "eoq",
    path: "/eoq",
    name: "EOQ",
    methods: "Cantidad económica de pedido",
    group: "Inventarios y producción",
    keywords: ["eoq", "pedido", "inventario básico"],
    api: "eoq",
  },
  {
    slug: "inventory",
    path: "/inventory",
    name: "Inventarios",
    methods: "EOQ, descuentos, EPQ, vendedor de periódicos",
    group: "Inventarios y producción",
    keywords: ["inventario", "epq", "newsvendor", "wagner", "backorder"],
    api: "inventory",
  },
  {
    slug: "mrp",
    path: "/mrp",
    name: "MRP",
    methods: "Explosión de materiales, liberaciones planeadas",
    group: "Inventarios y producción",
    keywords: ["mrp", "bom", "materiales"],
    api: "mrp",
  },
  {
    slug: "aggregate",
    path: "/aggregate",
    name: "Planeación agregada",
    methods: "Persecución, nivel constante, mixta",
    group: "Inventarios y producción",
    keywords: ["agregada", "aggregate", "chase", "level"],
    api: "aggregate_planning",
  },
  {
    slug: "facility",
    path: "/facility",
    name: "Localización y layout",
    methods: "Centro de gravedad, balanceo de línea",
    group: "Inventarios y producción",
    keywords: ["localización", "layout", "gravedad", "balanceo"],
    api: "facility_location",
  },
  {
    slug: "forecasting",
    path: "/forecasting",
    name: "Pronósticos",
    methods: "Media móvil, Holt, Winters, tendencia",
    group: "Predicción y decisión",
    keywords: ["pronóstico", "holt", "winters", "mape", "forecast"],
    api: "forecasting",
  },
  {
    slug: "decision",
    path: "/decision",
    name: "Análisis de decisiones",
    methods: "Tabla de pagos, árbol, Bayes, Hurwicz",
    group: "Predicción y decisión",
    keywords: ["decisión", "árbol", "emv", "evpi", "hurwicz", "bayes"],
    api: "decision_analysis",
  },
  {
    slug: "game",
    path: "/game",
    name: "Teoría de juegos",
    methods: "Punto silla, estrategias mixtas",
    group: "Predicción y decisión",
    keywords: ["juegos", "silla", "mixta", "dominada"],
    api: "game_theory",
  },
  {
    slug: "quality",
    path: "/quality",
    name: "Control de calidad",
    methods: "Cartas X̄-R, p, c, u; Cp/Cpk",
    group: "Calidad y estadística",
    keywords: ["calidad", "carta", "xbar", "cpk", "control"],
    api: "quality_control",
  },
  {
    slug: "asa",
    path: "/asa",
    name: "Muestreo de aceptación",
    methods: "Curva OC, AOQ, diseño de plan",
    group: "Calidad y estadística",
    keywords: ["muestreo", "asa", "oc", "aql", "ltpd"],
    api: "acceptance_sampling",
  },
  {
    slug: "statistics",
    path: "/statistics",
    name: "Estadística",
    methods: "Descriptiva, regresión, pruebas, distribuciones",
    group: "Calidad y estadística",
    keywords: ["estadística", "regresión", "ttest", "normal"],
    api: "statistics",
  },
  {
    slug: "breakeven",
    path: "/breakeven",
    name: "Punto de equilibrio",
    methods: "Costo-volumen-utilidad, alternativas",
    group: "Calidad y estadística",
    keywords: ["equilibrio", "breakeven", "cvp", "contribución"],
    api: "breakeven",
  },
];

export function searchModules(query: string): ModuleMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return MODULES;
  return MODULES.filter((m) => {
    const hay = [m.name, m.methods, m.group, ...m.keywords].join(" ").toLowerCase();
    return hay.includes(q) || q.split(/\s+/).every((tok) => hay.includes(tok));
  });
}

export function moduleByPath(path: string): ModuleMeta | undefined {
  return MODULES.find((m) => m.path === path || m.slug === path.replace(/^\//, ""));
}
