import { MODULES, type ModuleMeta } from "./modulesCatalog";

/**
 * Lo que la página de inicio necesita para guiar: situaciones reales que llevan a un
 * método, dos rutas de estudio en el orden del curso y el historial de quien la usa.
 */

export type Situation = {
  /** El problema dicho como lo diría quien lo tiene, no con el nombre del método. */
  problem: string;
  example: string;
  slug: string;
};

export const SITUATIONS: Situation[] = [
  {
    problem: "Repartir recursos limitados para ganar más o gastar menos",
    example: "Cuánto producir de cada producto con horas de máquina contadas",
    slug: "lp",
  },
  {
    problem: "Enviar mercancía de varios orígenes a varios destinos",
    example: "Plantas que abastecen almacenes al menor costo de flete",
    slug: "transport",
  },
  {
    problem: "Asignar personas o máquinas a tareas, una a una",
    example: "Qué operario hace qué trabajo para terminar más rápido",
    slug: "assignment",
  },
  {
    problem: "Encontrar la ruta más corta, conectar puntos o mover un flujo",
    example: "Tender cable a todas las sucursales con el menor tramo",
    slug: "networks",
  },
  {
    problem: "Planear un proyecto con actividades que dependen unas de otras",
    example: "Cuándo termina la obra y qué actividades no pueden atrasarse",
    slug: "pert-cpm",
  },
  {
    problem: "Decidir cuánto pedir y cada cuándo",
    example: "Lote de compra que equilibra costo de pedir y de guardar",
    slug: "eoq",
  },
  {
    problem: "Elegir sin saber qué va a pasar",
    example: "Qué tamaño de planta construir si la demanda es incierta",
    slug: "decision",
  },
  {
    problem: "Competir contra un rival que también elige",
    example: "Dos empresas que fijan su estrategia de precios",
    slug: "game",
  },
  {
    problem: "Un sistema que cambia de estado con ciertas probabilidades",
    example: "Clientes que cambian de marca mes con mes",
    slug: "markov",
  },
  {
    problem: "Clientes que esperan en una fila",
    example: "Cuántas cajas abrir para que nadie espere más de 5 minutos",
    slug: "queues",
  },
  {
    problem: "Estimar un resultado cuando los datos son aleatorios",
    example: "Ganancia probable de un pedido con demanda incierta",
    slug: "monte-carlo",
  },
];

export type TrackStep = { slug: string; learn: string };
export type Track = { id: string; title: string; subtitle: string; steps: TrackStep[] };

export const TRACKS: Track[] = [
  {
    id: "io1",
    title: "Investigación de Operaciones I",
    subtitle: "Modelos deterministas: los datos se conocen",
    steps: [
      { slug: "lp", learn: "Modelar, método gráfico, simplex y dualidad" },
      { slug: "transport", learn: "Solución inicial (Vogel) y mejora con MODI" },
      { slug: "assignment", learn: "Método húngaro y costos de oportunidad" },
      { slug: "networks", learn: "Ruta corta, árbol mínimo y flujo máximo" },
      { slug: "pert-cpm", learn: "Ruta crítica, holguras y aceleración" },
      { slug: "eoq", learn: "Lote económico y punto de reorden" },
    ],
  },
  {
    id: "io2",
    title: "Investigación de Operaciones II",
    subtitle: "Modelos probabilísticos: hay incertidumbre",
    steps: [
      { slug: "decision", learn: "Criterios de decisión, VEIP, árboles y Bayes" },
      { slug: "game", learn: "Punto silla, estrategias mixtas y su programa lineal" },
      { slug: "markov", learn: "Clasificación de estados, estado estable y absorción" },
      { slug: "queues", learn: "Fórmulas M/M/1 y M/M/s y la ley de Little" },
      { slug: "monte-carlo", learn: "Números aleatorios, variables y réplicas" },
      { slug: "qss", learn: "Simulación de eventos discretos contra la teoría" },
    ],
  },
];

export function moduleBySlug(slug: string): ModuleMeta | undefined {
  return MODULES.find((m) => m.slug === slug);
}

/** Paso de una ruta y sus vecinos, para sugerir qué sigue al terminar un módulo. */
export function trackPosition(slug: string): { track: Track; index: number } | null {
  for (const track of TRACKS) {
    const index = track.steps.findIndex((step) => step.slug === slug);
    if (index >= 0) return { track, index };
  }
  return null;
}

/* ——— Historial en el navegador ———
   Solo comodidad de cada persona: si el almacenamiento falla, la página funciona igual. */

const RECENT_KEY = "laraops:recent";
const VISITED_KEY = "laraops:visited";
const RECENT_MAX = 4;

function readList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* sin almacenamiento: no se recuerda, y no pasa nada */
  }
}

export function recordVisit(slug: string) {
  if (!moduleBySlug(slug)?.migrated) return;
  writeList(RECENT_KEY, [slug, ...readList(RECENT_KEY).filter((item) => item !== slug)].slice(0, RECENT_MAX));
  const visited = readList(VISITED_KEY);
  if (!visited.includes(slug)) writeList(VISITED_KEY, [...visited, slug]);
}

export function recentModules(): ModuleMeta[] {
  return readList(RECENT_KEY)
    .map((slug) => moduleBySlug(slug))
    .filter((m): m is ModuleMeta => !!m && m.migrated);
}

export function visitedSlugs(): Set<string> {
  return new Set(readList(VISITED_KEY));
}

export function clearHistory() {
  writeList(RECENT_KEY, []);
  writeList(VISITED_KEY, []);
}
