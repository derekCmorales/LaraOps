import { useEffect, useMemo, useState } from "react";
import type { ModuleResult } from "../api/client";
import { fmt, modelFromResult, pretty, routeText, stepMetas, type TransportStepMeta } from "../lib/transportResult";
import TransportTableau from "./TransportTableau";

type Props = { result: ModuleResult };

const PHASE: Record<TransportStepMeta["phase"], string> = {
  initial: "Solución inicial",
  modi: "Mejora con MODI",
  check: "Prueba de optimalidad",
};

const METHOD: Record<string, string> = {
  northwest: "Esquina noroeste",
  least_cost: "Costo mínimo",
  vogel: "Vogel",
  modi: "MODI",
  modi_check: "MODI",
};

/** Filas y columnas tachadas hasta el paso k (incluido); k = -1 no tacha nada. */
function crossedUntil(steps: { meta: TransportStepMeta }[], k: number) {
  const rows = new Set<number>();
  const cols = new Set<number>();
  for (let i = 0; i <= k; i++) {
    const meta = steps[i].meta;
    if (meta.phase !== "initial" || !meta.cell) continue;
    if (meta.crossed !== "col") rows.add(meta.cell[0]);
    if (meta.crossed !== "row") cols.add(meta.cell[1]);
  }
  return { rows, cols };
}

export default function TransportIterations({ result }: Props) {
  const model = useMemo(() => modelFromResult(result), [result]);
  const steps = useMemo(() => stepMetas(result), [result]);
  const [idx, setIdx] = useState(0);
  const max = result.solution.objective_sense === "max";

  useEffect(() => setIdx(0), [steps.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIdx((i) => Math.min(steps.length - 1, i + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length]);

  if (!model || !steps.length) return <p className="empty-results">No hay iteraciones para este resultado.</p>;

  const k = Math.min(idx, steps.length - 1);
  const step = steps[k];
  const meta = step.meta;
  const crossed = meta.phase === "initial" ? crossedUntil(steps, k - 1) : null;
  const pick = meta.cell ?? null;
  const firstModi = steps.findIndex((s) => s.meta.phase !== "initial");
  const initialCount = firstModi < 0 ? steps.length : firstModi;

  return (
    <div className="iter-viewer transport-iter">
      <aside className="iter-rail">
        <h3>
          Paso {k + 1} de {steps.length}
        </h3>
        <dl>
          <dt>Fase</dt>
          <dd>
            {PHASE[meta.phase]}
            {meta.phase === "initial" ? ` · ${METHOD[step.method] ?? step.method}` : ""}
          </dd>
          {meta.phase === "initial" && pick ? (
            <>
              <dt>Asignación</dt>
              <dd>
                {fmt(meta.qty)} a {routeText(meta.sources[pick[0]], meta.dests[pick[1]])}
              </dd>
            </>
          ) : null}
          {meta.enter ? (
            <>
              <dt>{meta.phase === "check" ? "Puede mejorar" : "Entra"}</dt>
              <dd>
                {routeText(meta.sources[meta.enter[0]], meta.dests[meta.enter[1]])} (d = {fmt(meta.delta)})
              </dd>
            </>
          ) : null}
          {meta.phase === "modi" && meta.leave ? (
            <>
              <dt>Sale</dt>
              <dd>{routeText(meta.sources[meta.leave[0]], meta.dests[meta.leave[1]])}</dd>
              <dt>θ</dt>
              <dd>{fmt(meta.theta)}</dd>
            </>
          ) : null}
          {meta.phase !== "initial" && meta.cost != null ? (
            <>
              <dt>{max ? "Ganancia" : "Costo"} de esta tabla</dt>
              <dd>{fmt(meta.cost)}</dd>
            </>
          ) : null}
        </dl>
        {meta.reason ? (
          <div className="iter-why">
            <strong>¿Por qué?</strong>
            <div>{pretty(meta.reason)}</div>
          </div>
        ) : null}
      </aside>

      <div className="iter-main">
        <p className="section-label" style={{ marginTop: 0 }}>
          {pretty(step.title)}
        </p>
        <TransportTableau
          model={model}
          alloc={meta.alloc}
          basis={meta.basis}
          caption={`Tabla de transporte, paso ${k + 1}`}
          supply={meta.supply_left}
          demand={meta.demand_left}
          marginLabel={meta.supply_left ? { supply: "Queda", demand: "Queda" } : undefined}
          u={meta.u}
          v={meta.v}
          reduced={meta.reduced}
          rowPenalties={meta.row_penalties}
          colPenalties={meta.col_penalties}
          maximize={max}
          highlight={{
            picked: meta.phase === "initial" ? pick : null,
            enter: meta.enter ?? null,
            leave: meta.phase === "modi" ? meta.leave ?? null : null,
            cycle: meta.phase === "modi" ? meta.cycle : undefined,
            crossedRows: crossed?.rows,
            crossedCols: crossed?.cols,
          }}
        />
        <p className="field-hint transport-legend">
          {meta.phase === "initial"
            ? "Celda resaltada: asignación de este paso. Filas y columnas atenuadas: se completaron en pasos anteriores. «Queda»: oferta y demanda pendientes tras este paso."
            : meta.phase === "modi" && meta.enter
              ? "Contorno: ruta que entra. Las celdas con + reciben θ unidades y las de − las ceden; la marcada con línea discontinua sale de la base."
              : "En las celdas vacías aparece el costo reducido: costo − uᵢ − vⱼ."}
        </p>

        <div className="iter-scrubber">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setIdx(Math.max(0, k - 1))}
            disabled={k === 0}
            aria-label="Paso anterior"
          >
            ◀
          </button>
          <input
            type="range"
            min={0}
            max={steps.length - 1}
            value={k}
            onChange={(e) => setIdx(Number(e.target.value))}
            aria-label="Paso"
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setIdx(Math.min(steps.length - 1, k + 1))}
            disabled={k >= steps.length - 1}
            aria-label="Paso siguiente"
          >
            ▶
          </button>
          <span className="iter-scrubber-label">
            {k + 1}/{steps.length}
          </span>
        </div>
        <div className="transport-phases" role="group" aria-label="Ir a una fase">
          <button type="button" className="btn btn-quiet" onClick={() => setIdx(0)} disabled={k === 0}>
            Inicio ({initialCount} {initialCount === 1 ? "asignación" : "asignaciones"})
          </button>
          {firstModi >= 0 ? (
            <button type="button" className="btn btn-quiet" onClick={() => setIdx(firstModi)} disabled={k === firstModi}>
              {steps[firstModi].meta.phase === "check" ? "Prueba de optimalidad" : "Primer ciclo MODI"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setIdx(steps.length - 1)}
            disabled={k === steps.length - 1}
          >
            Tabla final
          </button>
        </div>
      </div>
    </div>
  );
}
