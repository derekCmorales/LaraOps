import { useId, useMemo } from "react";
import type { ModuleResult } from "../api/client";
import ChartViews from "./ChartViews";
import SolutionTable from "./SolutionTable";
import StatusBand from "./StatusBand";

type Props = { result: ModuleResult };
type Table = NonNullable<ModuleResult["tables"]>[number];
type Cell = string | number | boolean | null;

const INK = "#0A1628";
const BASIC = "#0A6B9A";
const PIVOT = "#C4166B";
const PAPER = "#F5F8FC";
const MUTED = "#5A6F87";

const CRITERION_LABEL: Record<string, string> = {
  maximax: "Maximax (optimista)",
  maximin: "Maximin (pesimista)",
  minimax_regret: "Arrepentimiento minimax",
  hurwicz: "Hurwicz",
  laplace: "Laplace (equiprobable)",
  expected_value: "Valor esperado",
  EOL_choice: "Menor pérdida de oportunidad",
};

function findTable(result: ModuleResult, name: string): Table | undefined {
  return result.tables?.find((item) => item.name === name);
}

function fmt(value: number | null | undefined, digits = 4): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-MX", { maximumFractionDigits: digits });
}

function cells(row: unknown[]): Cell[] {
  return row.map((cell) => {
    if (cell == null) return null;
    if (typeof cell === "number" || typeof cell === "string" || typeof cell === "boolean") return cell;
    return String(cell);
  });
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type Kind = "decision" | "chance" | "terminal";

type VNode = {
  id: string;
  kind: Kind;
  label: string;
  value: number | null;
  politica: string;
  root: boolean;
};

type VEdge = {
  from: string;
  to: string;
  label: string;
  probability: number | null;
  optimal: boolean;
  flow: number | null;
};

function asKind(value: unknown): Kind {
  return value === "chance" || value === "terminal" ? value : "decision";
}

function networkOf(result: ModuleResult): { nodes: VNode[]; edges: VEdge[] } | null {
  if (result.graph?.type !== "network") return null;
  const nodes = (result.graph.nodes ?? []).map((raw) => {
    const node = raw as Record<string, unknown>;
    return {
      id: String(node.id ?? ""),
      kind: asKind(node.kind),
      label: String(node.label ?? node.id ?? ""),
      value: num(node.value),
      politica: typeof node.politica === "string" ? node.politica : "",
      root: node.root === true,
    };
  });
  const edges = (result.graph.edges ?? []).map((raw) => {
    const edge = raw as Record<string, unknown>;
    return {
      from: String(edge.source ?? ""),
      to: String(edge.target ?? ""),
      label: edge.label == null ? "" : String(edge.label),
      probability: num(edge.probability),
      optimal: edge.critical === true,
      flow: num(edge.flow),
    };
  });
  return { nodes: nodes.filter((node) => node.id), edges };
}

function auxiliaryOf(rows: unknown[][]): { nodes: VNode[]; edges: VEdge[] } {
  const nodes = new Map<string, VNode>();
  const edges: VEdge[] = [];
  const ensure = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind: "terminal", label: id, value: null, politica: "", root: id === "Previa" });
  };
  for (const row of rows) {
    const from = String(row[0] ?? "");
    const to = String(row[1] ?? "");
    if (!from || !to) continue;
    ensure(from);
    ensure(to);
    nodes.get(from)!.kind = "chance";
    edges.push({
      from,
      to,
      label: row[2] == null ? "" : String(row[2]),
      probability: num(row[3]),
      optimal: false,
      flow: null,
    });
  }
  for (const edge of edges) {
    const node = nodes.get(edge.to);
    if (node && edge.label && node.kind === "terminal") node.label = edge.label;
  }
  const previa = nodes.get("Previa");
  if (previa) previa.label = "Previa";
  return { nodes: [...nodes.values()], edges };
}

function wrap(text: string, size = 18): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > size && current) {
      lines.push(current);
      current = word.length > size ? `${word.slice(0, size - 1)}…` : word;
    } else {
      current = next.length > size ? `${next.slice(0, size - 1)}…` : next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

function layoutTree(nodes: VNode[], edges: VEdge[]): {
  pos: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
} {
  const children = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const node of nodes) {
    children.set(node.id, []);
    incoming.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!children.has(edge.from) || !incoming.has(edge.to)) continue;
    const list = children.get(edge.from)!;
    if (!list.includes(edge.to)) list.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  let roots = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  if (!roots.length && nodes.length) roots = [nodes[0].id];

  const widthOf = new Map<string, number>();
  const visiting = new Set<string>();
  function subtree(id: string): number {
    const cached = widthOf.get(id);
    if (cached != null) return cached;
    if (visiting.has(id)) return 1;
    visiting.add(id);
    const kids = children.get(id) ?? [];
    const width = kids.length ? kids.reduce((sum, kid) => sum + subtree(kid), 0) : 1;
    visiting.delete(id);
    widthOf.set(id, Math.max(1, width));
    return Math.max(1, width);
  }

  const unit = new Map<string, { x: number; y: number }>();
  function place(id: string, left: number, depth: number) {
    if (unit.has(id)) return;
    const kids = children.get(id) ?? [];
    if (!kids.length) {
      unit.set(id, { x: left + subtree(id) / 2, y: depth });
      return;
    }
    let cursor = left;
    for (const kid of kids) {
      place(kid, cursor, depth + 1);
      cursor += subtree(kid);
    }
    const xs = kids.map((kid) => unit.get(kid)?.x).filter((value): value is number => value != null);
    unit.set(id, { x: xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : left + subtree(id) / 2, y: depth });
  }
  let cursor = 0;
  for (const root of roots) {
    place(root, cursor, 0);
    cursor += subtree(root);
  }
  for (const node of nodes) {
    if (!unit.has(node.id)) {
      place(node.id, cursor, 0);
      cursor += subtree(node.id);
    }
  }

  const colW = 168;
  const rowH = 176;
  const padX = 24;
  const padY = 20;
  let maxDepth = 0;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [id, point] of unit) {
    maxDepth = Math.max(maxDepth, point.y);
    pos.set(id, { x: padX + point.x * colW, y: padY + 36 + point.y * rowH });
  }
  return {
    pos,
    width: Math.max(360, padX * 2 + Math.max(cursor, 1) * colW),
    height: padY * 2 + (maxDepth + 1) * rowH + 8,
  };
}

function shapeHalf(kind: Kind): { w: number; h: number } {
  if (kind === "chance") return { w: 32, h: 32 };
  if (kind === "terminal") return { w: 58, h: 26 };
  return { w: 40, h: 36 };
}

function TreeSvg({
  title,
  subtitle,
  nodes,
  edges,
  footnote,
}: {
  title: string;
  subtitle: string;
  nodes: VNode[];
  edges: VEdge[];
  footnote?: string;
}) {
  const marker = useId().replace(/:/g, "");
  const laid = useMemo(() => layoutTree(nodes, edges), [nodes, edges]);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  if (!nodes.length) return <p className="field-hint">Este resultado no trae nodos para dibujar.</p>;

  return (
    <figure className="chart-frame">
      <figcaption>
        <h3 className="chart-title">{title}</h3>
        <p className="chart-subtitle">{subtitle}</p>
      </figcaption>
      <p className="chart-legend">
        <span style={{ color: INK }}>■ Decisión</span>
        <span style={{ color: BASIC }}> ● Azar</span>
        <span style={{ color: "#945800" }}> ▭ Terminal</span>
        <span className="legend-crit"> — arco óptimo</span>
      </p>
      <div className="chart-wrap" style={{ overflowX: "auto" }}>
        <svg
          width={laid.width}
          height={laid.height}
          viewBox={`0 0 ${laid.width} ${laid.height}`}
          role="img"
          aria-label={`${title}. ${subtitle}`}
        >
          <defs>
            <marker id={`${marker}-a`} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6 Z" fill={MUTED} />
            </marker>
            <marker id={`${marker}-c`} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6 Z" fill={PIVOT} />
            </marker>
          </defs>
          {edges
            .map((edge, index) => ({ edge, index }))
            .sort((a, b) => Number(a.edge.optimal) - Number(b.edge.optimal))
            .map(({ edge, index }) => {
            const source = laid.pos.get(edge.from);
            const target = laid.pos.get(edge.to);
            const fromNode = byId.get(edge.from);
            const toNode = byId.get(edge.to);
            if (!source || !target || !fromNode || !toNode) return null;
            const start = { x: source.x, y: source.y + shapeHalf(fromNode.kind).h + 44 };
            const end = { x: target.x, y: target.y - shapeHalf(toNode.kind).h };
            const mx = (start.x + end.x) / 2;
            const my = (start.y + end.y) / 2;
            const parts = [
              edge.label,
              edge.probability != null ? `p = ${fmt(edge.probability, 3)}` : "",
              edge.flow != null ? fmt(edge.flow, 2) : "",
            ].filter(Boolean);
            return (
              <g key={`${edge.from}-${edge.to}-${index}`}>
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={edge.optimal ? PIVOT : "#8AA0B8"}
                  strokeWidth={edge.optimal ? 2.6 : 1.4}
                  markerEnd={`url(#${marker}-${edge.optimal ? "c" : "a"})`}
                />
                {parts.length ? (
                  <text
                    x={mx}
                    y={my}
                    textAnchor="middle"
                    fontSize="10"
                    fill={edge.optimal ? PIVOT : INK}
                    stroke="#fff"
                    strokeWidth="4"
                    paintOrder="stroke"
                    style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace" }}
                  >
                    {parts.join(" · ")}
                  </text>
                ) : null}
              </g>
            );
          })}
          {nodes.map((node) => {
            const point = laid.pos.get(node.id);
            if (!point) return null;
            const half = shapeHalf(node.kind);
            const lines = wrap(node.label || node.id, 16);
            const value = node.value != null ? fmt(node.value, 2) : "";
            const policy = node.kind === "decision" && node.politica ? node.politica : "";
            const tip = [node.label || node.id, value ? `flujo ${value}` : "", policy ? `elige ${policy}` : ""]
              .filter(Boolean)
              .join(". ");
            return (
              <g key={node.id}>
                <title>{tip}</title>
                {node.kind === "chance" ? (
                  <circle cx={point.x} cy={point.y} r={half.w} fill="#E7F3FA" stroke={BASIC} strokeWidth="1.8" />
                ) : (
                  <rect
                    x={point.x - half.w}
                    y={point.y - half.h}
                    width={half.w * 2}
                    height={half.h * 2}
                    rx={node.kind === "terminal" ? 14 : 2}
                    fill={node.kind === "terminal" ? "#F8F1E3" : PAPER}
                    stroke={node.kind === "terminal" ? "#945800" : INK}
                    strokeWidth={node.kind === "decision" ? 1.8 : 1.5}
                  />
                )}
                <text
                  x={point.x}
                  y={point.y + 4}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="700"
                  fill={INK}
                  style={{ fontFamily: "IBM Plex Mono, ui-monospace, monospace" }}
                >
                  {value || "·"}
                </text>
                <text
                  x={point.x}
                  y={point.y + half.h + 16}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="700"
                  fill={INK}
                  style={{ fontFamily: "Sora, Manrope, sans-serif" }}
                >
                  {lines.map((line, lineIndex) => (
                    <tspan key={lineIndex} x={point.x} dy={lineIndex === 0 ? 0 : 13}>
                      {line}
                    </tspan>
                  ))}
                  {policy ? (
                    <tspan x={point.x} dy="14" fontSize="10" fontWeight="600" fill={PIVOT}>
                      {wrap(`elige ${policy}`, 22)[0]}
                    </tspan>
                  ) : null}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {footnote ? <p className="chart-footnote">{footnote}</p> : null}
    </figure>
  );
}

function Kpi({ label, value, note, main }: { label: string; value: string; note?: string; main?: boolean }) {
  return (
    <article className={main ? "pert-kpi eoq-kpi-main" : "pert-kpi"}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </article>
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="warn-list">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}

function PayoffView({ result }: Props) {
  const metrics = result.solution.metrics;
  const decisions = findTable(result, "decisions");
  const payoff = findTable(result, "payoff");
  const utilidad = findTable(result, "utilidad");
  const prob = findTable(result, "sensibilidad_probabilidad");
  const pago = findTable(result, "sensibilidad_pago");
  const ranges = (result.sensitivity as { objective_ranges?: Record<string, unknown>[] } | null)?.objective_ranges ?? [];
  const summary = (decisions?.rows ?? []).filter((row) => !String(row[0] ?? "").includes(":"));
  const chosenUtility = utilidad?.rows.findIndex((row) => row[5] === "sí") ?? -1;
  const stateName = payoff?.columns[1] ?? "el primer estado";
  const breakdowns = (decisions?.rows ?? []).filter((row) => String(row[0] ?? "").includes(":"));
  const detailGroups = [
    { prefix: "EV:", title: utilidad ? "Utilidad esperada de cada alternativa" : "Valor esperado de cada alternativa" },
    { prefix: "laplace:", title: "Laplace de cada alternativa" },
    { prefix: "hurwicz:", title: "Hurwicz de cada alternativa" },
  ];

  return (
    <>
      <div className="pert-kpis">
        {utilidad ? (
          <Kpi label="Equivalente cierto" value={fmt(metrics.best_certainty_equivalent)} note="de la mayor utilidad esperada" main />
        ) : metrics.EV != null ? (
          <Kpi label="Valor esperado" value={fmt(metrics.EV)} note="mejor alternativa" main />
        ) : null}
        {metrics.EVPI_dinero != null ? <Kpi label="VEIP en dinero" value={fmt(metrics.EVPI_dinero)} /> : null}
        {!utilidad && metrics.EVPI != null ? <Kpi label="VEIP" value={fmt(metrics.EVPI)} note="tope a pagar por información perfecta" /> : null}
        {metrics.EVwPI != null && !utilidad ? <Kpi label="VE con información perfecta" value={fmt(metrics.EVwPI)} /> : null}
        {metrics.EOL != null && !utilidad ? <Kpi label="Pérdida de oportunidad" value={fmt(metrics.EOL)} /> : null}
        {utilidad && metrics.VE_elegida != null ? <Kpi label="VE en dinero de la elegida" value={fmt(metrics.VE_elegida)} /> : null}
      </div>

      {metrics.EVPI != null && !utilidad ? (
        <p className="eoq-policy">
          El VEIP es <strong>{fmt(metrics.EVPI)}</strong>. Es lo máximo que conviene pagar por conocer el estado de la
          naturaleza antes de decidir: la diferencia entre el valor esperado con información perfecta y el mejor valor
          esperado sin ella.
        </p>
      ) : null}
      {utilidad && metrics.EVPI_dinero != null ? (
        <p className="eoq-policy">
          En dinero, el VEIP es <strong>{fmt(metrics.EVPI_dinero)}</strong>: lo máximo que pagaría quien decide por valor
          esperado para conocer el estado antes de elegir. Con utilidad, la elegida es la de mayor utilidad esperada y su
          equivalente cierto es <strong>{fmt(metrics.best_certainty_equivalent)}</strong>.
        </p>
      ) : null}

      {summary.length ? (
        <>
          <p className="field-hint">
            Maximax se queda con el mejor pago posible. Maximin mira el peor pago de cada alternativa y elige el menos
            malo. El arrepentimiento minimax reduce la pena de no haber acertado el estado. Hurwicz mezcla el mejor y el
            peor pago con el peso α. Laplace supone estados igual de probables. El valor esperado pondera cada pago por
            su probabilidad.
            {utilidad ? " Con utilidad, esos criterios se calculan sobre U, no sobre el dinero." : ""}
          </p>
          <SolutionTable
            caption="Qué recomienda cada criterio"
            columns={["Criterio", "Alternativa", "Valor"]}
            rows={summary.map((row) => [CRITERION_LABEL[String(row[0])] ?? String(row[0]), row[1], row[2]] as Cell[])}
            textColumns={[0, 1]}
            activeRowIndexes={summary
              .map((row, index) => (row[0] === "expected_value" ? index : -1))
              .filter((index) => index >= 0)}
          />
          {detailGroups.map((group) => {
            const rows = breakdowns.filter((row) => String(row[0]).startsWith(group.prefix));
            if (!rows.length) return null;
            return (
              <SolutionTable
                key={group.prefix}
                caption={group.title}
                columns={["Alternativa", "Valor"]}
                rows={rows.map((row) => [row[1], row[2]] as Cell[])}
                textColumns={[0]}
              />
            );
          })}
        </>
      ) : null}

      {payoff ? (
        <SolutionTable
          caption="Tabla de pagos"
          columns={payoff.columns}
          rows={payoff.rows.map(cells)}
          textColumns={[0]}
        />
      ) : null}

      {utilidad ? (
        <>
          <p className="field-hint">
            El equivalente cierto es el pago seguro que da la misma utilidad que la alternativa con riesgo. La prima de
            riesgo es valor esperado en dinero menos ese equivalente: lo que la persona sacrifica por quitarse el riesgo.
            Si es positiva, hay aversión al riesgo.
          </p>
          <SolutionTable
            caption="Utilidad, equivalente cierto y prima"
            columns={["Alternativa", "VE", "UE", "Equivalente cierto", "Prima de riesgo", "Elegida"]}
            rows={utilidad.rows.map(cells)}
            textColumns={[0, 5]}
            activeRowIndexes={chosenUtility >= 0 ? [chosenUtility] : []}
          />
        </>
      ) : null}

      {ranges.length || prob || pago ? (
        <>
          <h3 className="section-label">Sensibilidad del valor esperado en dinero</h3>
          <p className="field-hint">
            {prob
              ? "Para cada estado se mueve su probabilidad de 0 a 1 y el resto se reparte en la misma proporción que hoy. Si las demás probabilidades suman 0, el resto se reparte por igual."
              : "Estos rangos dicen hasta dónde puede moverse un dato sin cambiar la alternativa de mayor valor esperado."}
          </p>
          {ranges.length ? (
            <SolutionTable
              caption={`Puntos de indiferencia al mover P(${stateName})`}
              columns={["Mejor ahora", "Competidora", `P(${stateName}) de empate`]}
              rows={ranges.map((range) => [
                String(range.current_best ?? ""),
                String(range.competitor ?? ""),
                num(range.breakeven_probability_state1),
              ])}
              textColumns={[0, 1]}
            />
          ) : null}
          {prob ? (
            <SolutionTable
              caption="Tramos de probabilidad"
              columns={["Estado", "P desde", "P hasta", "Alternativa"]}
              rows={prob.rows.map(cells)}
              textColumns={[0, 3]}
            />
          ) : null}
          {pago ? (
            <>
              <p className="field-hint">
                Cuánto puedes subir o bajar un pago, sin tocar el resto, antes de que el valor esperado recomiende otra
                alternativa. «Sin límite» significa que ese lado no le quita el primer lugar.
              </p>
              <SolutionTable
                caption="Rango de cada pago"
                columns={["Alternativa", "Estado", "Pago actual", "Disminución permitida", "Aumento permitido"]}
                rows={pago.rows.map((row) =>
                  row.map((cell, index) => (index >= 3 && cell == null ? "sin límite" : cell)),
                ) as Cell[][]}
                textColumns={[0, 1, 3, 4]}
              />
            </>
          ) : null}
        </>
      ) : null}

      {result.graph?.type === "xy" ? (
        <>
          {utilidad ? (
            <p className="field-hint">
              El gráfico es el valor esperado en dinero al mover la probabilidad del primer estado. La tabla de utilidad
              puede elegir otra alternativa.
            </p>
          ) : null}
          <ChartViews result={result} />
        </>
      ) : null}
    </>
  );
}

function TreeView({ result }: Props) {
  const network = networkOf(result);
  const policy = findTable(result, "politica");
  const fold = findTable(result, "tree_fold");
  const root = network?.nodes.find((node) => node.root);
  return (
    <>
      <div className="pert-kpis">
        <Kpi label="Valor del árbol" value={fmt(result.solution.metrics.EV_root ?? result.solution.objective_value)} main />
        {root?.politica ? <Kpi label={`En ${root.label}`} value={root.politica} note="decisión de la raíz" /> : null}
      </div>
      <p className="eoq-policy">
        El repliegue asigna a cada nodo de azar la suma de probabilidad por valor, y a cada decisión el hijo de mayor
        valor. El arco magenta es esa elección. El número del nodo es su flujo.
      </p>
      {network ? (
        <TreeSvg
          title={result.graph?.title || "Árbol de decisión"}
          subtitle={result.graph?.subtitle || "De arriba hacia abajo. El arco resaltado es la política de ese nodo."}
          nodes={network.nodes}
          edges={network.edges}
          footnote="La etiqueta del arco lleva la decisión o el estado, su probabilidad y el flujo del nodo al que llega."
        />
      ) : null}
      {policy ? (
        <SolutionTable
          caption="Política de cada decisión"
          columns={["Nodo", "Decisión elegida", "Valor"]}
          rows={policy.rows.map(cells)}
          textColumns={[0, 1]}
        />
      ) : null}
      {fold ? (
        <details>
          <summary className="section-label">Repliegue de todos los nodos</summary>
          <SolutionTable columns={["Id", "Tipo", "Valor", "Mejor hijo"]} rows={fold.rows.map(cells)} textColumns={[0, 1, 3]} />
        </details>
      ) : null}
    </>
  );
}

function BayesView({ result }: Props) {
  const metrics = result.solution.metrics;
  const bayes = findTable(result, "bayes");
  const summary = findTable(result, "summary");
  const aux = findTable(result, "bayes_arbol_auxiliar");
  const nodos = findTable(result, "bayes_nodos");
  const arcos = findTable(result, "bayes_arcos");
  const network = networkOf(result);
  const cost = metrics.sample_cost ?? 0;
  const evsi = metrics.EVSI ?? 0;
  const buys = cost < evsi - 1e-8;
  const tie = Math.abs(cost - evsi) <= 1e-8;
  const policy = tie
    ? "La muestra cuesta lo mismo que aporta. Da igual comprarla o no; el árbol se queda sin comprar."
    : buys
      ? `Conviene comprar la información. El VEIM es ${fmt(evsi)} y la muestra cuesta ${fmt(cost)}, así que el valor neto es ${fmt(evsi - cost)}.`
      : `No conviene comprar la información: cuesta ${fmt(cost)} y el valor de la muestra solo es ${fmt(evsi)}.`;
  const auxiliary = aux ? auxiliaryOf(aux.rows) : null;

  return (
    <>
      <div className="pert-kpis">
        <Kpi label="Valor esperado sin muestra" value={fmt(metrics.EV)} main />
        <Kpi label="VEIP" value={fmt(metrics.EVPI)} note="tope con información perfecta" />
        <Kpi label="VEIM" value={fmt(metrics.EVSI)} note="valor de la muestra, sin restar su costo" />
        <Kpi label="Costo de la muestra" value={fmt(cost)} />
        <Kpi label="VEIM neto" value={fmt(metrics.EVSI_neto)} note="valor de la rama con información menos el VE" />
      </div>
      <p className="eoq-policy">
        {policy} El valor esperado con información muestral es <strong>{fmt(metrics.EVwSI)}</strong>, la suma de
        P(señal) por el valor esperado de la mejor acción en esa señal.
      </p>
      <p className="field-hint">
        El VEIP ({fmt(metrics.EVPI)}) es lo máximo que conviene pagar por conocer el estado antes de decidir. El VEIM no
        puede superarlo: la muestra es una información imperfecta.
      </p>
      {bayes ? (
        <SolutionTable
          caption="Posterior y mejor acción por señal"
          columns={bayes.columns.map((column) =>
            column === "signal"
              ? "Señal"
              : column === "P(signal)"
                ? "P(señal)"
                : column === "best_action"
                  ? "Mejor acción"
                  : column === "EV|signal"
                    ? "VE | señal"
                    : column,
          )}
          rows={bayes.rows.map(cells)}
          textColumns={[0, 2]}
        />
      ) : null}
      {network ? (
        <TreeSvg
          title="Árbol de decisión: ¿comprar la información?"
          subtitle="Arriba la decisión de comprar o no. Abajo, acciones, señales y estados. El arco magenta es la política de cada cuadrado."
          nodes={network.nodes}
          edges={network.edges}
          footnote="En la rama de comprar, el pago terminal ya resta el costo de la muestra. El número dentro del nodo es el flujo al replegar el árbol."
        />
      ) : null}
      {auxiliary ? (
        <TreeSvg
          title="Árbol auxiliar de probabilidades"
          subtitle="De la previa salen las señales con P(señal) y, de cada señal, el estado con su probabilidad posterior."
          nodes={auxiliary.nodes}
          edges={auxiliary.edges}
          footnote="Este árbol no elige acciones: solo muestra cómo la señal actualiza la probabilidad de cada estado."
        />
      ) : null}
      {summary ? (
        <SolutionTable caption="Resumen" columns={["Métrica", "Valor"]} rows={summary.rows.map(cells)} textColumns={[0]} />
      ) : null}
      {nodos && arcos ? (
        <details>
          <summary className="section-label">Nodos y arcos del árbol de Bayes</summary>
          <SolutionTable
            caption="Nodos"
            columns={["Id", "Tipo", "Valor", "Política"]}
            rows={nodos.rows.map(cells)}
            textColumns={[0, 1, 3]}
          />
          <SolutionTable
            caption="Arcos"
            columns={["Desde", "Hacia", "Etiqueta", "Probabilidad", "Óptimo", "Flujo"]}
            rows={arcos.rows.map(cells)}
            textColumns={[0, 1, 2]}
          />
        </details>
      ) : null}
    </>
  );
}

export default function DecisionResults({ result }: Props) {
  const bayes = findTable(result, "bayes");
  const tree = findTable(result, "tree_fold");
  const headline = bayes
    ? result.solution.metrics.EV
    : tree
      ? (result.solution.metrics.EV_root ?? result.solution.objective_value)
      : findTable(result, "utilidad")
        ? result.solution.metrics.best_certainty_equivalent
        : result.solution.metrics.EV;
  const valueLabel = bayes ? "VE" : tree ? "VE del árbol" : findTable(result, "utilidad") ? "EC" : "VE";

  return (
    <div className="eoq-results">
      <StatusBand
        status={result.status}
        statusText="Cálculo listo"
        objectiveValue={headline}
        objectiveSense={result.solution.objective_sense}
        valueLabel={valueLabel}
        warnings={result.warnings}
      />
      <Warnings warnings={result.warnings ?? []} />
      {bayes ? <BayesView result={result} /> : tree ? <TreeView result={result} /> : <PayoffView result={result} />}
    </div>
  );
}
