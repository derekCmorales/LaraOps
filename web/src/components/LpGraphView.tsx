import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-basic-dist";
import type { ModuleResult } from "../api/client";
import { labelOf } from "../lib/resultLabels";

const Plot = createPlotlyComponent(Plotly);

const C = {
  ink: "#0A1628",
  basic: "#0A6B9A",
  pivot: "#C4166B",
  warn: "#945800",
  grid: "#C8D4E4",
  paper: "#F5F8FC",
  fill: "#EBF1F8",
  muted: "#5A6F87",
};

const LINE_COLORS = [C.ink, C.basic, C.warn, "#2D6A4F", "#7B2D8E", "#B08900"];

type GraphSeries = NonNullable<NonNullable<ModuleResult["graph"]>["series"]>[number];
type VertexMeta = NonNullable<GraphSeries["meta"]>[number];

function fmt(n: number): string {
  return n.toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

function sourceLabel(raw: string): string {
  if (raw.startsWith("eje ")) return `eje ${raw.slice(4)}`;
  if (raw.startsWith("cota ")) return raw;
  if (raw === "óptimo") return "óptimo";
  return raw;
}

function intersectionText(meta: VertexMeta): string {
  const sources = (meta.sources ?? []).map(sourceLabel).join(" ∩ ");
  const zBit = meta.z != null && Number.isFinite(meta.z) ? `Z = ${fmt(meta.z)}` : "";
  return [sources, zBit].filter(Boolean).join(" · ");
}

function axisTitle(text: string) {
  return { text, font: { size: 12, color: C.ink, family: "Manrope, sans-serif" } };
}

export default function LpGraphView({ result }: { result: ModuleResult }) {
  const graph = result.graph;
  const series = graph?.series ?? [];
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

  const traces: Record<string, unknown>[] = [];
  let lineIndex = 0;

  for (const s of series) {
    const name = labelOf(s.name);
    if (s.role === "fill" || s.name === "feasible_region") {
      traces.push({
        type: "scatter",
        mode: "lines",
        name,
        x: s.x,
        y: s.y,
        fill: "toself",
        fillcolor: C.fill,
        line: { color: C.fill, width: 0 },
        hoverinfo: "skip",
        showlegend: true,
      });
      continue;
    }
    if (s.role === "vertices" || s.name === "vertices") {
      const meta = s.meta ?? s.x.map((x, i) => ({ x, y: s.y[i], z: 0, sources: [] as string[] }));
      traces.push({
        type: "scatter",
        mode: "markers+text",
        name,
        x: s.x,
        y: s.y,
        text: meta.map((m) => `(${fmt(m.x)}, ${fmt(m.y)})\nZ = ${fmt(m.z ?? 0)}`),
        textposition: meta.map((_, i) => (i % 2 === 0 ? "top right" : "bottom left")),
        textfont: { size: 10, color: C.ink, family: "Manrope, sans-serif" },
        marker: { size: 8, color: C.ink, line: { color: "#FFFFFF", width: 1.5 } },
        customdata: meta.map((m) => [intersectionText(m)]),
        hovertemplate: "Vértice (%{x:.4g}, %{y:.4g})<br>%{customdata[0]}<extra></extra>",
        showlegend: false,
        cliponaxis: false,
      });
      continue;
    }
    if (s.role === "point" || s.name === "optimum") {
      const z = s.meta?.[0]?.z;
      const zBit = z != null && Number.isFinite(z) ? `Z = ${fmt(z)}` : "";
      traces.push({
        type: "scatter",
        mode: "markers",
        name,
        x: s.x,
        y: s.y,
        marker: {
          size: 12,
          color: C.pivot,
          symbol: "circle",
          line: { color: "#FFFFFF", width: 2 },
        },
        hovertemplate: `Óptimo (%{x:.4g}, %{y:.4g})${zBit ? `<br>${zBit}` : ""}<extra></extra>`,
        showlegend: true,
      });
      continue;
    }

    const dashed = s.name === "objective_level";
    const color = dashed ? C.pivot : LINE_COLORS[lineIndex++ % LINE_COLORS.length];
    traces.push({
      type: "scatter",
      mode: "lines",
      name,
      x: s.x,
      y: s.y,
      line: { color, width: dashed ? 2 : 2.5, dash: dashed ? "dash" : "solid" },
      hovertemplate: s.equation
        ? `${name}<br>${s.equation}<extra></extra>`
        : `${name}<extra></extra>`,
      showlegend: true,
    });
  }

  const layout = {
    autosize: true,
    margin: { t: 36, r: 72, b: 72, l: 64 },
    paper_bgcolor: "#FFFFFF",
    plot_bgcolor: C.paper,
    font: { family: "Manrope, sans-serif", color: C.ink, size: 12 },
    hoverlabel: {
      bgcolor: "#FFFFFF",
      bordercolor: C.grid,
      font: { family: "Manrope, sans-serif", size: 12, color: C.ink },
    },
    xaxis: {
      title: axisTitle(xLabel),
      fixedrange: false,
      zeroline: true,
      zerolinecolor: C.ink,
      gridcolor: C.grid,
      tickfont: { size: 11, color: C.muted },
      exponentformat: "none",
      separatethousands: true,
      hoverformat: ".4g",
    },
    yaxis: {
      title: axisTitle(yLabel),
      fixedrange: false,
      zeroline: true,
      zerolinecolor: C.ink,
      gridcolor: C.grid,
      tickfont: { size: 11, color: C.muted },
      exponentformat: "none",
      separatethousands: true,
      hoverformat: ".4g",
    },
    legend: {
      orientation: "h",
      y: -0.18,
      x: 0,
      font: { size: 12 },
      bgcolor: "rgba(0,0,0,0)",
    },
    hovermode: "closest",
    dragmode: "pan",
    uirevision: subtitle || title,
  };

  const config = {
    displaylogo: false,
    scrollZoom: true,
    responsive: true,
    displayModeBar: true,
    doubleClick: "reset",
    modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d"],
    toImageButtonOptions: { format: "png", filename: "region-factible-lp" },
  };

  return (
    <figure className="chart-frame">
      <figcaption>
        <h3 className="chart-title">{title}</h3>
        {subtitle ? <p className="chart-subtitle">{subtitle}</p> : null}
      </figcaption>
      <div
        className="chart-wrap chart-wrap--lp"
        role="region"
        aria-label={title}
        onWheel={(event) => event.stopPropagation()}
      >
        <Plot
          data={traces}
          layout={layout}
          config={config}
          useResizeHandler
          className="lp-plotly"
          style={{ width: "100%", minWidth: 880, height: 560 }}
        />
      </div>
      <p className="chart-footnote">
        Arrastra para moverte (también en horizontal) · rueda para acercar · recuadro en la barra
        para zoom de área · doble clic restaura.
      </p>
    </figure>
  );
}
