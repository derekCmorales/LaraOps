import { useEffect, useMemo, useState } from "react";
import type { ModuleResult } from "../api/client";
import { translateWarning } from "../lib/resultLabels";
import Explainer from "./Explainer";

type Props = { result: ModuleResult };

type Cell = number | string;

type Step = {
  index: number;
  title: string;
  tableau?: Cell[][] | null;
  meta?: Record<string, unknown>;
};

type Layout = {
  rowLabels: string[];
  colLabels: string[];
  nAgents: number;
  nTasks: number;
  sense: "min" | "max";
};

function fmt(v: unknown): string {
  if (v === "M") return "M";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "—");
  if (Math.abs(n) >= 1e8) return "M";
  return n.toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

function key(r: number, c: number) {
  return `${r}:${c}`;
}

function pairSet(v: unknown): Set<string> {
  return new Set(Array.isArray(v) ? (v as [number, number][]).map(([r, c]) => key(r, c)) : []);
}

function numList(v: unknown): number[] {
  return Array.isArray(v) ? (v as number[]) : [];
}

function stepsOf(result: ModuleResult): Step[] {
  return [...((result.iterations ?? []) as Step[])].sort((a, b) => a.index - b.index);
}

function layoutOf(result: ModuleResult): Layout {
  const first = stepsOf(result)[0]?.meta ?? {};
  const graph = result.graph as { row_labels?: string[]; col_labels?: string[] } | null;
  const costs = result.tables?.find((t) => t.name === "matriz_original");
  const agents = costs ? costs.rows.map((r) => String(r[0])) : graph?.row_labels ?? [];
  const tasks = costs ? costs.columns.slice(1) : graph?.col_labels ?? [];
  const rowLabels = (first.row_labels as string[] | undefined) ?? agents;
  const colLabels = (first.col_labels as string[] | undefined) ?? tasks;
  return {
    rowLabels,
    colLabels,
    nAgents: agents.length || rowLabels.length,
    nTasks: tasks.length || colLabels.length,
    sense: result.solution.objective_sense === "max" ? "max" : "min",
  };
}

function valueWords(sense: "min" | "max") {
  return sense === "max"
    ? { value: "ganancia", values: "ganancias", total: "Ganancia total máxima" }
    : { value: "costo", values: "costos", total: "Costo total mínimo" };
}

function costMatrix(result: ModuleResult): { agents: string[]; tasks: string[]; values: Cell[][] } | null {
  const t = result.tables?.find((x) => x.name === "matriz_original");
  if (!t) return null;
  return {
    agents: t.rows.map((r) => String(r[0])),
    tasks: t.columns.slice(1),
    values: t.rows.map((r) => r.slice(1) as Cell[]),
  };
}

function pairsFromTable(result: ModuleResult, name: string): [string, string, number][] {
  const t = result.tables?.find((x) => x.name === name);
  return (t?.rows ?? []).map((r) => [String(r[0]), String(r[1]), Number(r[2])]);
}

/** Matriz original con las parejas elegidas resaltadas. */
function AssignmentMatrix({
  result,
  highlight,
  caption,
}: {
  result: ModuleResult;
  highlight: [string, string, number][];
  caption: string;
}) {
  const m = costMatrix(result);
  if (!m) return null;
  const chosen = new Set(highlight.map(([a, t]) => `${a}\u0000${t}`));
  return (
    <div className="asg-matrix-wrap">
      <table className="asg-matrix">
        <caption className="section-label">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="asg-matrix-corner">
              <span className="sr-only">Agente / tarea</span>
            </th>
            {m.tasks.map((t) => (
              <th key={t} scope="col">
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.agents.map((a, i) => (
            <tr key={a}>
              <th scope="row">{a}</th>
              {m.tasks.map((t, j) => {
                const v = m.values[i]?.[j];
                const on = chosen.has(`${a}\u0000${t}`);
                const forbidden = v === "M";
                return (
                  <td
                    key={t}
                    className={[on ? "is-chosen" : "", forbidden ? "is-forbidden" : ""].filter(Boolean).join(" ") || undefined}
                    aria-label={`${a} en ${t}: ${forbidden ? "prohibida" : fmt(v)}${on ? ", asignada" : ""}`}
                  >
                    {fmt(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AssignmentResults({ result }: Props) {
  const layout = layoutOf(result);
  const words = valueWords(layout.sense);
  const pairs = pairsFromTable(result, "assignment");
  const alt = pairsFromTable(result, "asignacion_alternativa");
  const [showAlt, setShowAlt] = useState(false);
  const unassigned = (result.tables?.find((t) => t.name === "sin_asignar")?.rows ?? []).map((r) => ({
    kind: String(r[0]),
    name: String(r[1]),
  }));
  const m = result.solution.metrics;
  const total = result.solution.objective_value;
  const infeasible = result.status.toLowerCase() === "infeasible";
  const shown = showAlt && alt.length ? alt : pairs;

  if (infeasible) {
    const reason = (result.warnings[0] ?? "").replace(/^No existe una asignación que respete las prohibiciones:\s*/, "");
    return (
      <div className="asg-results">
        <div className="asg-infeasible" role="alert">
          <strong>No hay una asignación que respete las prohibiciones.</strong>
          <p>{reason}</p>
          <p className="field-hint">
            Quita alguna celda M, agrega otra tarea o agente, o revisa si alguna prohibición se escribió por error.
          </p>
        </div>
        <AssignmentMatrix result={result} highlight={[]} caption={`Matriz de ${words.values} (M = prohibida)`} />
        <Explainer result={result} />
      </div>
    );
  }

  const unassignedAgents = unassigned.filter((u) => u.kind === "agente");
  const unassignedTasks = unassigned.filter((u) => u.kind === "tarea");

  return (
    <div className="asg-results">
      {result.warnings?.length > 0 && (
        <ul className="warn-list">
          {result.warnings.map((w) => (
            <li key={w}>{translateWarning(w)}</li>
          ))}
        </ul>
      )}

      <div className="pert-kpis">
        <article className="pert-kpi eoq-kpi-main">
          <span>{words.total}</span>
          <strong>{fmt(total)}</strong>
          <small>{pairs.map(([, , v]) => fmt(v)).join(" + ") || "—"}</small>
        </article>
        <article className="pert-kpi">
          <span>Parejas asignadas</span>
          <strong>{pairs.length}</strong>
          <small>
            de {layout.nAgents} {layout.nAgents === 1 ? "agente" : "agentes"} y {layout.nTasks}{" "}
            {layout.nTasks === 1 ? "tarea" : "tareas"}
          </small>
        </article>
        <article className="pert-kpi">
          <span>Ajustes de la matriz</span>
          <strong>{fmt(m.n_adjustments ?? 0)}</strong>
          <small>{(m.n_adjustments ?? 0) === 0 ? "bastó con reducir filas y columnas" : "después de reducir"}</small>
        </article>
        {unassigned.length > 0 ? (
          <article className="pert-kpi is-warn">
            <span>Sin asignar</span>
            <strong>{unassigned.length}</strong>
            <small>{unassigned.map((u) => u.name).join(", ")}</small>
          </article>
        ) : null}
      </div>

      <section className="asg-who" aria-labelledby="asg-who-title">
        <div className="asg-who-head">
          <h3 id="asg-who-title" className="section-label">
            Quién hace qué
          </h3>
          {alt.length > 0 ? (
            <div className="eoq-toggle" role="group" aria-label="Solución mostrada">
              <button
                type="button"
                className={!showAlt ? "eoq-toggle-btn is-on" : "eoq-toggle-btn"}
                aria-pressed={!showAlt}
                onClick={() => setShowAlt(false)}
              >
                Solución
              </button>
              <button
                type="button"
                className={showAlt ? "eoq-toggle-btn is-on" : "eoq-toggle-btn"}
                aria-pressed={showAlt}
                onClick={() => setShowAlt(true)}
              >
                Alternativa (mismo total)
              </button>
            </div>
          ) : null}
        </div>
        <ul className="asg-pairs">
          {shown.map(([a, t, v]) => (
            <li key={`${a}-${t}`}>
              <span className="asg-pair-agent">{a}</span>
              <span className="asg-pair-arrow" aria-hidden>
                →
              </span>
              <span className="asg-pair-task">{t}</span>
              <span className="asg-pair-value">
                <span className="sr-only">{words.value} </span>
                {fmt(v)}
              </span>
            </li>
          ))}
          {!showAlt &&
            unassignedAgents.map((u) => (
              <li key={`ua-${u.name}`} className="is-idle">
                <span className="asg-pair-agent">{u.name}</span>
                <span className="asg-pair-arrow" aria-hidden>
                  →
                </span>
                <span className="asg-pair-task">sin tarea</span>
                <span className="asg-pair-value">—</span>
              </li>
            ))}
          {!showAlt &&
            unassignedTasks.map((u) => (
              <li key={`ut-${u.name}`} className="is-idle">
                <span className="asg-pair-agent">nadie</span>
                <span className="asg-pair-arrow" aria-hidden>
                  →
                </span>
                <span className="asg-pair-task">{u.name}</span>
                <span className="asg-pair-value">—</span>
              </li>
            ))}
        </ul>
      </section>

      <AssignmentMatrix
        result={result}
        highlight={shown}
        caption={`Matriz de ${words.values}: las celdas marcadas son la ${showAlt ? "alternativa" : "asignación óptima"}`}
      />

      <Explainer result={result} />
    </div>
  );
}

/* ——— Pasos del método húngaro ——— */

const KIND_LABEL: Record<string, string> = {
  initial: "Datos",
  regret: "Maximizar",
  row_reduction: "Filas",
  col_reduction: "Columnas",
  cover: "Líneas",
  adjust: "Ajuste",
  assignment: "Asignar",
};

function stepExplanation(step: Step, layout: Layout, result: ModuleResult): string {
  const meta = step.meta ?? {};
  const kind = String(meta.kind ?? "");
  const n = layout.rowLabels.length;
  const words = valueWords(layout.sense);
  if (kind === "initial") {
    const bits = [`Se arma la matriz de ${words.values}: una fila por agente y una columna por tarea.`];
    const dr = numList(meta.dummy_rows).length;
    const dc = numList(meta.dummy_cols).length;
    if (dr || dc) {
      const k = dr || dc;
      bits.push(
        dr
          ? `Como hay menos agentes que tareas, se ${k === 1 ? "agrega un agente ficticio" : `agregan ${k} agentes ficticios`} con 0: la tarea que le toque quedará sin hacer.`
          : `Como hay más agentes que tareas, se ${k === 1 ? "agrega una tarea ficticia" : `agregan ${k} tareas ficticias`} con 0: el agente que caiga ahí se queda sin tarea.`,
      );
    }
    if (numList(meta.forbidden).length) {
      bits.push("Las celdas M están prohibidas: valen un número enorme, así que el método nunca las elige.");
    }
    if (result.status.toLowerCase() === "infeasible") {
      bits.push("Con estas prohibiciones no existe una asignación completa, por eso el método no continúa.");
    }
    return bits.join(" ");
  }
  if (kind === "regret") {
    return `El método húngaro minimiza. Para maximizar, cada valor se resta del mayor (${fmt(meta.max_value)}): la matriz pasa a ser la pérdida de oportunidad, lo que se deja de ganar. Minimizar esa pérdida es lo mismo que maximizar la ganancia.`;
  }
  if (kind === "row_reduction") {
    return "A cada fila se le resta su valor más pequeño (columna «mín»). Así cada fila tiene al menos un cero. Restar lo mismo a toda una fila no cambia cuál asignación es la mejor, porque cada agente hace exactamente una tarea.";
  }
  if (kind === "col_reduction") {
    return "Ahora a cada columna se le resta su mínimo (fila «mín»). Las columnas que ya tenían un cero no cambian. Los ceros son las parejas más baratas en relación con el resto.";
  }
  if (kind === "cover") {
    const lines = Number(meta.lines ?? 0);
    if (lines >= n) {
      return `Hacen falta ${n} líneas para tapar todos los ceros, tantas como filas. Eso significa que hay ${n} ceros independientes (con círculo), uno por fila y columna: ya se puede asignar.`;
    }
    return `Bastan ${lines} ${lines === 1 ? "línea" : "líneas"} para tapar todos los ceros, pero se necesitan ${n}. Solo hay ${lines} ${lines === 1 ? "cero independiente" : "ceros independientes"} (con círculo): todavía no se puede dar un cero a cada fila, hay que ajustar.`;
  }
  if (kind === "adjust") {
    return `El menor valor sin cubrir es ${fmt(meta.delta)}. Se resta a todas las celdas no cubiertas (−), se suma donde se cruzan dos líneas (+) y las celdas tapadas por una sola línea quedan igual. Así aparece al menos un cero nuevo sin perder los que sirven.`;
  }
  if (kind === "assignment") {
    const pairs = pairsFromTable(result, "assignment");
    const sum = pairs.map(([, , v]) => fmt(v)).join(" + ");
    return `Se elige un cero en cada fila y en cada columna (círculos). Esas mismas posiciones en la matriz original dan el ${words.value} total: ${sum || "0"} = ${fmt(result.solution.objective_value)}.`;
  }
  return step.title;
}

function StepMatrix({ step, prev, layout }: { step: Step; prev: Step | null; layout: Layout }) {
  const meta = step.meta ?? {};
  const kind = String(meta.kind ?? "");
  const table = step.tableau ?? [];
  const coverRows = new Set(numList(meta.cover_rows));
  const coverCols = new Set(numList(meta.cover_cols));
  const circled = kind === "cover" ? pairSet(meta.independent_zeros) : kind === "assignment" ? pairSet(meta.assigned) : new Set<string>();
  const rowMin = kind === "row_reduction" ? numList(meta.row_min) : null;
  const colMin = kind === "col_reduction" ? numList(meta.col_min) : null;
  const showLines = kind === "cover" || kind === "adjust";
  const isDummyRow = (i: number) => i >= layout.nAgents;
  const isDummyCol = (j: number) => j >= layout.nTasks;

  return (
    <div className="asg-matrix-wrap">
      <table className={`asg-matrix asg-step-matrix${showLines ? " has-lines" : ""}`}>
        <caption className="sr-only">{step.title}</caption>
        <thead>
          <tr>
            <th scope="col" className="asg-matrix-corner">
              <span className="sr-only">Agente / tarea</span>
            </th>
            {layout.colLabels.map((label, j) => (
              <th
                key={j}
                scope="col"
                className={[isDummyCol(j) ? "is-dummy" : "", showLines && coverCols.has(j) ? "is-line" : ""]
                  .filter(Boolean)
                  .join(" ") || undefined}
                title={label}
              >
                {isDummyCol(j) ? `Ficticia ${j - layout.nTasks + 1}` : label}
              </th>
            ))}
            {rowMin ? (
              <th scope="col" className="asg-min-col">
                mín
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {table.map((row, i) => (
            <tr key={i}>
              <th
                scope="row"
                className={[isDummyRow(i) ? "is-dummy" : "", showLines && coverRows.has(i) ? "is-line" : ""]
                  .filter(Boolean)
                  .join(" ") || undefined}
                title={layout.rowLabels[i]}
              >
                {isDummyRow(i) ? `Ficticio ${i - layout.nAgents + 1}` : layout.rowLabels[i]}
              </th>
              {row.map((cell, j) => {
                const zero = cell === 0;
                const rowLine = showLines && coverRows.has(i);
                const colLine = showLines && coverCols.has(j);
                const changed = prev?.tableau && String(prev.tableau[i]?.[j]) !== String(cell);
                const mark =
                  kind === "adjust" && cell !== "M"
                    ? !rowLine && !colLine
                      ? "−"
                      : rowLine && colLine
                        ? "+"
                        : ""
                    : "";
                const cls = [
                  zero ? "is-zero" : "",
                  cell === "M" ? "is-forbidden" : "",
                  rowLine ? "is-row-line" : "",
                  colLine ? "is-col-line" : "",
                  rowLine && colLine ? "is-cross-line" : "",
                  circled.has(key(i, j)) ? (kind === "assignment" ? "is-chosen" : "is-starred") : "",
                  changed && kind !== "assignment" && kind !== "cover" ? "is-changed" : "",
                  isDummyRow(i) || isDummyCol(j) ? "is-dummy-cell" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <td key={j} className={cls || undefined}>
                    <span className="asg-val">{fmt(cell)}</span>
                    {mark ? (
                      <span className="asg-mark" aria-label={mark === "+" ? "se sumó" : "se restó"}>
                        {mark}
                      </span>
                    ) : null}
                  </td>
                );
              })}
              {rowMin ? <td className="asg-min-col">{fmt(rowMin[i])}</td> : null}
            </tr>
          ))}
          {colMin ? (
            <tr className="asg-min-row">
              <th scope="row">mín</th>
              {colMin.map((v, j) => (
                <td key={j}>{fmt(v)}</td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function HungarianSteps({ result }: Props) {
  const steps = useMemo(() => stepsOf(result), [result]);
  const layout = useMemo(() => layoutOf(result), [result]);
  const [idx, setIdx] = useState(0);
  const step = steps[Math.min(idx, steps.length - 1)];
  const prev = idx > 0 ? steps[idx - 1] : null;

  useEffect(() => setIdx(0), [steps]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIdx((i) => Math.min(steps.length - 1, i + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length]);

  if (!step) return <p className="empty-results">No hay pasos para este resultado.</p>;
  const kind = String(step.meta?.kind ?? "");
  const lines = Number(step.meta?.lines ?? 0);

  return (
    <div className="asg-steps">
      <ol className="asg-step-list" aria-label="Pasos del método húngaro">
        {steps.map((s, i) => {
          const k = String(s.meta?.kind ?? "");
          return (
            <li key={s.index}>
              <button
                type="button"
                className={i === idx ? "asg-step-btn is-on" : "asg-step-btn"}
                aria-current={i === idx ? "step" : undefined}
                onClick={() => setIdx(i)}
              >
                <span className="asg-step-num">{i + 1}</span>
                <span className="asg-step-text">
                  <span className="asg-step-kind">{KIND_LABEL[k] ?? "Paso"}</span>
                  <span className="asg-step-title">{s.title}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="asg-step-main">
        <p className="section-label" style={{ marginTop: 0 }}>
          Paso {idx + 1} de {steps.length} · {step.title}
        </p>
        <p className="asg-step-why">{stepExplanation(step, layout, result)}</p>
        {step.tableau ? <StepMatrix step={step} prev={prev} layout={layout} /> : null}
        <div className="asg-step-legend" aria-hidden>
          {kind === "cover" || kind === "adjust" ? (
            <>
              <span>
                <i className="asg-swatch asg-swatch-line" /> cubierta por una línea
              </span>
              <span>
                <i className="asg-swatch asg-swatch-cross" /> cruce de dos líneas
              </span>
            </>
          ) : null}
          {kind === "cover" ? (
            <span>
              <i className="asg-swatch asg-swatch-star" /> cero independiente ({lines})
            </span>
          ) : null}
          {kind === "assignment" ? (
            <span>
              <i className="asg-swatch asg-swatch-chosen" /> cero elegido
            </span>
          ) : null}
          {layout.rowLabels.length !== layout.nAgents || layout.colLabels.length !== layout.nTasks ? (
            <span>
              <i className="asg-swatch asg-swatch-dummy" /> ficticio
            </span>
          ) : null}
        </div>
        <div className="iter-scrubber">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0}
          >
            ◀ Anterior
          </button>
          <span className="iter-scrubber-label">
            {idx + 1}/{steps.length}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setIdx((i) => Math.min(steps.length - 1, i + 1))}
            disabled={idx >= steps.length - 1}
          >
            Siguiente ▶
          </button>
        </div>
      </div>
    </div>
  );
}

/* ——— Diagrama agentes → tareas ——— */

export function AssignmentDiagram({ result }: Props) {
  const layout = layoutOf(result);
  const words = valueWords(layout.sense);
  const pairs = pairsFromTable(result, "assignment");
  const agents = layout.rowLabels.slice(0, layout.nAgents);
  const tasks = layout.colLabels.slice(0, layout.nTasks);
  if (!agents.length || !tasks.length) return null;

  const rowGap = 52;
  const top = 36;
  const height = top + Math.max(agents.length, tasks.length) * rowGap + 8;
  const width = 640;
  const nodeW = 150;
  const leftX = 24;
  const rightX = width - 24 - nodeW;
  const yOf = (i: number, count: number) => {
    const offset = ((Math.max(agents.length, tasks.length) - count) * rowGap) / 2;
    return top + offset + i * rowGap + rowGap / 2;
  };
  const assignedAgents = new Set(pairs.map(([a]) => a));
  const assignedTasks = new Set(pairs.map(([, t]) => t));
  const valueByTask = new Map(pairs.map(([, t, v]) => [t, v]));
  const clip = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s);

  return (
    <figure className="chart-frame">
      <figcaption>
        <h3 className="chart-title">Asignación óptima</h3>
        <p className="chart-subtitle">
          Cada línea une a un agente con su tarea y muestra su {words.value}. {words.total}: {fmt(result.solution.objective_value)}.
        </p>
      </figcaption>
      <div className="asg-diagram" role="img" aria-label={pairs.map(([a, t, v]) => `${a} hace ${t} (${fmt(v)})`).join("; ")}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" preserveAspectRatio="xMidYMin meet">
          <text x={leftX} y={20} className="asg-dg-head">
            Agentes
          </text>
          <text x={rightX + nodeW} y={20} className="asg-dg-head" textAnchor="end">
            Tareas
          </text>
          {pairs.map(([a, t]) => {
            const y1 = yOf(agents.indexOf(a), agents.length);
            const y2 = yOf(tasks.indexOf(t), tasks.length);
            return <line key={`${a}-${t}`} x1={leftX + nodeW} y1={y1} x2={rightX} y2={y2} className="asg-dg-edge" />;
          })}
          {agents.map((a, i) => {
            const y = yOf(i, agents.length);
            const idle = !assignedAgents.has(a);
            return (
              <g key={`a-${a}`} className={idle ? "asg-dg-node is-idle" : "asg-dg-node"}>
                <rect x={leftX} y={y - 16} width={nodeW} height={32} rx={5} />
                <text x={leftX + 12} y={y + 4}>
                  {clip(a)}
                </text>
                {idle ? (
                  <text x={leftX + nodeW + 8} y={y + 4} className="asg-dg-idle">
                    sin tarea
                  </text>
                ) : null}
              </g>
            );
          })}
          {tasks.map((t, j) => {
            const y = yOf(j, tasks.length);
            const idle = !assignedTasks.has(t);
            return (
              <g key={`t-${t}`} className={idle ? "asg-dg-node is-idle" : "asg-dg-node"}>
                <rect x={rightX} y={y - 16} width={nodeW} height={32} rx={5} />
                <text x={rightX + nodeW - 12} y={y + 4} textAnchor="end">
                  {clip(t)}
                </text>
                {idle ? (
                  <text x={rightX - 8} y={y + 4} className="asg-dg-idle" textAnchor="end">
                    sin agente
                  </text>
                ) : (
                  <>
                    <rect x={rightX - 26} y={y - 11} width={52} height={22} rx={11} className="asg-dg-pill" />
                    <text x={rightX} y={y + 4} textAnchor="middle" className="asg-dg-pill-text">
                      {fmt(valueByTask.get(t))}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
