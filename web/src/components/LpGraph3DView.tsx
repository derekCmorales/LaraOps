import { useEffect, useState, type ComponentType } from "react";
import type { ModuleResult } from "../api/client";
import { labelOf } from "../lib/resultLabels";

const C = {
  ink: "#0A1628",
  basic: "#0A6B9A",
  pivot: "#C4166B",
  warn: "#945800",
  grid: "#C8D4E4",
  paper: "#F5F8FC",
  muted: "#5A6F87",
};

const FACE_COLORS = [C.basic, "#2D6A4F", C.warn, "#7B2D8E", "#B08900", C.ink];

type PlotProps = {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
  config: Record<string, unknown>;
  useResizeHandler?: boolean;
  className?: string;
  style?: { width: string; height: number };
};

type Series3D = {
  name: string;
  role?: string;
  x: (number | null)[];
  y: (number | null)[];
  z?: (number | null)[];
  i?: number[];
  j?: number[];
  k?: number[];
  equation?: string;
  meta?: { x: number; y: number; z?: number; objective?: number; sources?: string[] }[];
};

function fmt(n: number): string {
  return n.toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

function sourceLabel(raw: string): string {
  if (raw.startsWith("eje ")) return `eje ${raw.slice(4)}`;
  if (raw.startsWith("cota ")) return raw;
  if (raw === "óptimo") return "óptimo";
  return raw;
}

export default function LpGraph3DView({ result }: { result: ModuleResult }) {
  const [Plot, setPlot] = useState<ComponentType<PlotProps> | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [plotlyMod, factoryMod] = await Promise.all([
        import("plotly.js-gl3d-dist"),
        import("react-plotly.js/factory"),
      ]);
      if (!alive) return;
      const create = factoryMod.default;
      setPlot(() => create(plotlyMod.default) as ComponentType<PlotProps>);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const graph = result.graph;
  const series = (graph?.series ?? []) as Series3D[];
  if (!series.length) {
    return (
      <p className="field-hint">
        Complete los parámetros del modelo y pulse Resolver para generar el gráfico.
      </p>
    );
  }

  const title = graph?.title?.trim() || "Región factible y punto óptimo";
  const subtitle = graph?.subtitle?.trim() || null;
  const xLabel = labelOf(graph?.x_label || "x");
  const yLabel = labelOf(graph?.y_label || "y");
  const zLabel = labelOf(graph?.z_label || "z");
  const sliced = Boolean(subtitle?.includes("Fijas en el óptimo"));

  const traces: Record<string, unknown>[] = [];
  let faceIndex = 0;

  for (const s of series) {
    const name = labelOf(s.name);
    if (s.role === "face") {
      const isObjective = s.name === "objective_plane";
      const isView = s.name === "view_limit";
      const color = isObjective
        ? C.pivot
        : isView
          ? C.grid
          : FACE_COLORS[faceIndex++ % FACE_COLORS.length];
      traces.push({
        type: "mesh3d",
        name,
        x: s.x,
        y: s.y,
        z: s.z,
        i: s.i,
        j: s.j,
        k: s.k,
        color,
        opacity: isView ? 0.16 : isObjective ? 0.38 : 0.55,
        flatshading: true,
        hovertemplate: s.equation ? `${name}<br>${s.equation}<extra></extra>` : `${name}<extra></extra>`,
        lighting: { ambient: 0.72, diffuse: 0.55, specular: 0.08, fresnel: 0.1 },
        showlegend: true,
      });
      continue;
    }
    if (s.role === "edges" || s.name === "edges") {
      traces.push({
        type: "scatter3d",
        mode: "lines",
        name,
        x: s.x,
        y: s.y,
        z: s.z,
        line: { color: C.ink, width: 4 },
        hoverinfo: "skip",
        showlegend: false,
      });
      continue;
    }
    if (s.role === "vertices" || s.name === "vertices") {
      const meta = s.meta ?? [];
      const showText = meta.length > 0 && meta.length <= 12;
      traces.push({
        type: "scatter3d",
        mode: showText ? "markers+text" : "markers",
        name,
        x: s.x,
        y: s.y,
        z: s.z,
        text: showText
          ? meta.map((m) => `(${fmt(m.x)}, ${fmt(m.y)}, ${fmt(m.z ?? 0)})`)
          : undefined,
        textposition: "top center",
        textfont: { size: 10, color: C.ink, family: "Manrope, sans-serif" },
        marker: { size: 5, color: C.ink, line: { color: "#FFFFFF", width: 1 } },
        customdata: meta.map((m) => {
          const sources = (m.sources ?? []).map(sourceLabel).join(" ∩ ");
          const zBit = m.objective != null && Number.isFinite(m.objective) ? `Z = ${fmt(m.objective)}` : "";
          return [sources, zBit].filter(Boolean).join(" · ");
        }),
        hovertemplate: "Vértice (%{x:.4g}, %{y:.4g}, %{z:.4g})<br>%{customdata}<extra></extra>",
        showlegend: false,
      });
      continue;
    }
    if (s.role === "point" || s.name === "optimum") {
      const objective = s.meta?.[0]?.objective;
      const zBit = objective != null && Number.isFinite(objective) ? `Z = ${fmt(objective)}` : "";
      traces.push({
        type: "scatter3d",
        mode: "markers",
        name,
        x: s.x,
        y: s.y,
        z: s.z,
        marker: { size: 8, color: C.pivot, symbol: "diamond", line: { color: "#FFFFFF", width: 1 } },
        hovertemplate: `Óptimo (%{x:.4g}, %{y:.4g}, %{z:.4g})${zBit ? `<br>${zBit}` : ""}<extra></extra>`,
        showlegend: true,
      });
    }
  }

  const axis = (text: string) => ({
    title: { text, font: { size: 12, color: C.ink, family: "Manrope, sans-serif" } },
    gridcolor: C.grid,
    zerolinecolor: C.ink,
    backgroundcolor: C.paper,
    tickfont: { size: 11, color: C.muted },
  });

  const layout = {
    autosize: true,
    margin: { t: 24, r: 16, b: 16, l: 16 },
    paper_bgcolor: "#FFFFFF",
    font: { family: "Manrope, sans-serif", color: C.ink, size: 12 },
    hoverlabel: {
      bgcolor: "#FFFFFF",
      bordercolor: C.grid,
      font: { family: "Manrope, sans-serif", size: 12, color: C.ink },
    },
    scene: {
      aspectmode: "data",
      xaxis: axis(xLabel),
      yaxis: axis(yLabel),
      zaxis: axis(zLabel),
      camera: { eye: { x: 1.55, y: 1.35, z: 0.85 } },
      bgcolor: "#FFFFFF",
    },
    legend: {
      orientation: "h",
      y: -0.02,
      x: 0,
      font: { size: 12 },
      bgcolor: "rgba(0,0,0,0)",
    },
    uirevision: subtitle || title,
  };

  const config = {
    displaylogo: false,
    scrollZoom: true,
    responsive: true,
    displayModeBar: true,
    toImageButtonOptions: { format: "png", filename: "region-factible-lp-3d" },
  };

  return (
    <figure className="chart-frame">
      <figcaption>
        <h3 className="chart-title">{title}</h3>
        {subtitle ? <p className="chart-subtitle">{subtitle}</p> : null}
      </figcaption>
      <div className="chart-wrap chart-wrap--lp chart-wrap--lp3d" role="region" aria-label={title}>
        {Plot ? (
          <Plot
            data={traces}
            layout={layout}
            config={config}
            useResizeHandler
            className="lp-plotly"
            style={{ width: "100%", height: 640 }}
          />
        ) : (
          <p className="field-hint">Cargando gráfico 3D…</p>
        )}
      </div>
      <p className="chart-footnote">
        Arrastra para rotar · rueda para acercar · doble clic restaura la vista.
        {sliced
          ? " Este dibujo es un corte: las variables que no están en los ejes quedan fijas en el óptimo."
          : " Con más de tres variables el gráfico pasa a ser un corte por el óptimo."}
      </p>
    </figure>
  );
}
