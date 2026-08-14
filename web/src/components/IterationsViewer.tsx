import { useEffect, useMemo, useState } from "react";
import { formatMetaValue, labelOf, methodLabel, translateTitle } from "../lib/resultLabels";

export type IterationStepView = {
  index: number;
  method: string;
  title: string;
  tableau?: (number | string)[][] | null;
  meta?: Record<string, unknown>;
};

type Props = {
  steps: IterationStepView[];
};

function cellKey(r: number, c: number) {
  return `${r}:${c}`;
}

const META_SKIP = new Set([
  "enter",
  "leave",
  "pivot",
  "z",
  "relaxation_objective",
  "objective",
  "branch_variable",
  "pruned_reason",
]);

function MetaPanel({ meta }: { meta: Record<string, unknown> }) {
  const entries = Object.entries(meta).filter(([k]) => !META_SKIP.has(k));
  if (!entries.length) {
    return <p className="field-hint">Sin detalle adicional en este paso.</p>;
  }
  return (
    <table className="data-table">
      <caption className="section-label">Detalle del paso</caption>
      <thead>
        <tr>
          <th scope="col">Campo</th>
          <th scope="col">Valor</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td className="col-text">{labelOf(k)}</td>
            <td>
              {formatMetaValue(k, v)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function IterationsViewer({ steps }: Props) {
  const sorted = useMemo(() => [...steps].sort((a, b) => a.index - b.index), [steps]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stack, setStack] = useState(false);
  const [flash, setFlash] = useState<Set<string>>(new Set());

  const step = sorted[Math.min(idx, sorted.length - 1)];
  const prev = idx > 0 ? sorted[idx - 1] : null;

  useEffect(() => {
    setIdx(0);
  }, [sorted.length]);

  useEffect(() => {
    if (!playing || sorted.length < 2) return;
    const id = window.setInterval(() => {
      setIdx((i) => {
        if (i >= sorted.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1200);
    return () => window.clearInterval(id);
  }, [playing, sorted.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIdx((i) => Math.min(sorted.length - 1, i + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sorted.length]);

  useEffect(() => {
    if (!step?.tableau || !prev?.tableau) {
      setFlash(new Set());
      return;
    }
    const changed = new Set<string>();
    const a = prev.tableau;
    const b = step.tableau;
    for (let r = 0; r < b.length; r++) {
      for (let c = 0; c < (b[r]?.length ?? 0); c++) {
        if (String(a[r]?.[c] ?? "") !== String(b[r]?.[c] ?? "")) {
          changed.add(cellKey(r, c));
        }
      }
    }
    setFlash(changed);
    const t = window.setTimeout(() => setFlash(new Set()), 450);
    return () => window.clearTimeout(t);
  }, [idx, step, prev]);

  if (!sorted.length) return <p className="empty-results">No hay iteraciones para este resultado.</p>;

  const meta = (step.meta || {}) as Record<string, unknown>;
  const pivot = meta.pivot as { enter?: string; leave?: string; row?: number; col?: number } | null;
  const enter =
    (meta.enter as string) ||
    (meta.branch_variable as string) ||
    pivot?.enter ||
    undefined;
  const leave = (meta.leave as string) || pivot?.leave;
  const z = meta.z ?? meta.relaxation_objective ?? meta.objective;
  const isLast = idx === sorted.length - 1;

  const why =
    (meta.pruned_reason as string) ||
    (isLast && !enter
      ? "No hay variable que mejore Z. Este es el tableau óptimo; el valor final está en la banda de estado."
      : enter
        ? `Entra ${enter}${leave ? `; sale ${leave}` : ""} según la regla del método.`
        : translateTitle(step.title));

  if (stack) {
    return (
      <div className="iter-stack">
        <div className="iter-scrubber">
          <button type="button" className="btn btn-ghost" onClick={() => setStack(false)}>
            Vista paso a paso
          </button>
        </div>
        {sorted.map((s, si) => (
          <details key={s.index} open={si === sorted.length - 1}>
            <summary>
              Paso {s.index + 1}: {methodLabel(s.method)} — {translateTitle(s.title)}
              {si === sorted.length - 1 ? " · óptimo" : ""}
            </summary>
            {s.tableau ? (
              <Tableau table={s.tableau} flash={new Set()} pivot={null} caption={`Iteración ${s.index + 1}`} />
            ) : (
              <MetaPanel meta={(s.meta || {}) as Record<string, unknown>} />
            )}
          </details>
        ))}
      </div>
    );
  }

  return (
    <div className="iter-viewer">
      <aside className="iter-rail">
        <h3>Estado</h3>
        <dl>
          <dt>Iteración</dt>
          <dd>
            {idx + 1} de {sorted.length}
            {isLast ? " · óptima" : " · intermedia"}
          </dd>
          <dt>Método</dt>
          <dd>{methodLabel(step.method)}</dd>
          {enter != null && enter !== "" && (
            <>
              <dt>Entra</dt>
              <dd>{String(enter)}</dd>
            </>
          )}
          {leave != null && leave !== "" && (
            <>
              <dt>Sale</dt>
              <dd>{String(leave)}</dd>
            </>
          )}
          {pivot?.row != null && pivot?.col != null && (
            <>
              <dt>Pivote</dt>
              <dd>
                fila {pivot.row}, col. {pivot.col}
              </dd>
            </>
          )}
          {z != null && (
            <>
              <dt>Z de esta iteración</dt>
              <dd>{Number(z).toLocaleString("es-MX", { maximumFractionDigits: 4 })}</dd>
            </>
          )}
        </dl>
        {!isLast ? (
          <p className="iter-step-note">
            Paso intermedio. El óptimo está en el último tableau; Z final aparece arriba en la
            banda de estado.
          </p>
        ) : (
          <p className="iter-step-note iter-step-note--opt">Tableau óptimo.</p>
        )}
        <div className="iter-why">
          <strong>¿Por qué?</strong>
          <div>{why}</div>
        </div>
      </aside>

      <div className="iter-main">
        <p className="section-label" style={{ marginTop: 0 }}>
          {translateTitle(step.title)}
        </p>
        {step.tableau ? (
          <Tableau
            table={step.tableau}
            flash={flash}
            pivot={pivot}
            caption={`Tabla — iteración ${idx + 1}`}
          />
        ) : (
          <MetaPanel meta={meta} />
        )}

        <div className="iter-scrubber">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0}
            aria-label="Iteración anterior"
          >
            ◀
          </button>
          <input
            type="range"
            min={0}
            max={sorted.length - 1}
            value={idx}
            onChange={(e) => setIdx(Number(e.target.value))}
            aria-label="Barra de iteraciones"
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setIdx((i) => Math.min(sorted.length - 1, i + 1))}
            disabled={idx >= sorted.length - 1}
            aria-label="Iteración siguiente"
          >
            ▶
          </button>
          <span className="iter-scrubber-label">
            {idx + 1}/{sorted.length}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => setPlaying((p) => !p)}>
            {playing ? "Pausar" : "Reproducir"}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setStack(true)}>
            Ver todas
          </button>
        </div>
      </div>
    </div>
  );
}

function Tableau({
  table,
  flash,
  pivot,
  caption,
}: {
  table: (number | string)[][];
  flash: Set<string>;
  pivot: { row?: number; col?: number } | null;
  caption: string;
}) {
  const isTextbook =
    table.length > 1 &&
    String(table[0]?.[0] ?? "") === "Cj" &&
    String(table[1]?.[0] ?? "") === "Base";

  if (isTextbook) {
    const cjRow = table[0];
    const headerRow = table[1];
    const bodyRows = table.slice(2, -1);
    const zjRow = table[table.length - 1];

    return (
      <div style={{ overflowX: "auto" }}>
        <table className="data-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {cjRow.map((cell, c) => (
                <th key={`cj-${c}`} scope="col" className={c === 0 ? "col-text" : ""}>
                  {String(cell)}
                </th>
              ))}
            </tr>
            <tr>
              {headerRow.map((cell, c) => (
                <th key={`hdr-${c}`} scope="col" className={c <= 1 ? "col-text" : ""}>
                  {String(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, ri) => {
              const r = ri + 2;
              return (
                <tr key={ri}>
                  {row.map((cell, c) => {
                    const isPivot = pivot && pivot.row === r && pivot.col === c;
                    const cls = [
                      c <= 1 ? "col-text" : "",
                      isPivot ? "cell-pivot" : "",
                      flash.has(`${r}:${c}`) ? "cell-flash cell-basic" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    const display =
                      typeof cell === "number"
                        ? cell.toLocaleString("es-MX", { maximumFractionDigits: 4 })
                        : String(cell);
                    return (
                      <td key={c} className={cls}>
                        {isPivot ? `[${display}]` : display}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="tableau-zj-row">
              {zjRow.map((cell, c) => {
                const r = table.length - 1;
                const cls = [
                  c <= 1 ? "col-text" : "",
                  flash.has(`${r}:${c}`) ? "cell-flash cell-basic" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                const display =
                  typeof cell === "number"
                    ? cell.toLocaleString("es-MX", { maximumFractionDigits: 4 })
                    : String(cell);
                return (
                  <td key={c} className={cls}>
                    {display}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  const hasHeader =
    table.length > 0 && table[0].every((c) => typeof c === "string");
  const body = hasHeader ? table.slice(1) : table;
  const header = hasHeader ? table[0] : null;

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        {header && (
          <thead>
            <tr>
              {header.map((cell, c) => (
                <th key={c} scope="col">
                  {String(cell)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, ri) => {
            const r = hasHeader ? ri + 1 : ri;
            return (
              <tr key={ri}>
                {row.map((cell, c) => {
                  const isPivot = pivot && pivot.row === r && pivot.col === c;
                  const cls = [
                    c === 0 ? "col-text" : "",
                    isPivot ? "cell-pivot" : "",
                    flash.has(`${r}:${c}`) ? "cell-flash cell-basic" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const display =
                    typeof cell === "number"
                      ? cell.toLocaleString("es-MX", { maximumFractionDigits: 4 })
                      : String(cell);
                  return (
                    <td
                      key={c}
                      className={cls}
                      {...(isPivot ? { "aria-label": `Celda pivote, valor ${display}` } : {})}
                    >
                      {isPivot ? `[${display}]` : display}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
