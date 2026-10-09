/** Cuadro de un paso de iteración sobre el grafo del resultado (ver `IterationView` en el Worker). */
export type Tone = "crit" | "flow" | "warn" | "idle";

export type IterationView = {
  node_tone?: (Tone | null)[];
  node_sub?: (string | null)[];
  edge_flow?: number[];
  edge_on?: boolean[];
  edge_hot?: boolean[];
  edge_dashed?: boolean[];
  edges?: Record<string, unknown>[];
  subtitle?: string;
  legend?: { label: string; tone: Tone }[];
};

type Item = Record<string, unknown>;
type NetGraph = { type: "network"; nodes: Item[]; edges: Item[]; [key: string]: unknown };

/**
 * Devuelve una copia del grafo tal como se ve en ese paso. Lo que el paso no define se borra
 * (marcas del resultado final: ruta, corte, flujo) para que no se cuele en pasos intermedios.
 */
export function applyIterationView<G extends { type: string }>(graph: G, view: IterationView): G {
  const base = graph as unknown as NetGraph;
  const nodes = base.nodes.map((node, i) => {
    const next: Item = { ...node };
    delete next.critical;
    delete next.tone;
    if (view.node_tone) {
      const tone = view.node_tone[i];
      if (tone) next.tone = tone;
    } else {
      if (node.critical) next.critical = node.critical;
      if (node.tone) next.tone = node.tone;
    }
    if (view.node_sub) {
      const sub = view.node_sub[i];
      if (sub) next.kind = sub;
      else delete next.kind;
    }
    return next;
  });
  const sourceEdges = view.edges ?? base.edges;
  const edges = sourceEdges.map((edge, j) => {
    const next: Item = { ...edge };
    if (!view.edges) {
      delete next.critical;
      delete next.min_cut;
      delete next.on;
      delete next.dashed;
    }
    if (view.edge_flow) {
      const raw = view.edge_flow[j];
      if (raw < 0) {
        // Red no dirigida: el flujo va en sentido contrario al dibujado en el gráfico final.
        next.source = edge.target;
        next.target = edge.source;
      }
      next.flow = Math.abs(raw);
    }
    if (view.edge_on?.[j]) next.on = true;
    if (view.edge_hot?.[j]) next.critical = true;
    if (view.edge_dashed?.[j]) next.dashed = true;
    return next;
  });
  const out: Item = { ...base, nodes, edges };
  if (view.subtitle != null) out.subtitle = view.subtitle;
  if (view.legend) out.legend = view.legend;
  else delete out.legend;
  return out as unknown as G;
}
