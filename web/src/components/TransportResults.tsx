import { useState } from "react";
import type { ModuleResult } from "../api/client";
import {
  finalMeta,
  fmt,
  isDummyDest,
  isDummySource,
  modelFromResult,
  numeric,
  pretty,
  routeText,
  type Num,
  type TransportSensitivityData,
} from "../lib/transportResult";
import SolutionTable from "./SolutionTable";
import TransportTableau from "./TransportTableau";

type Props = { result: ModuleResult };

const METHOD_TEXT: Record<string, string> = {
  modi: "Vogel + MODI",
  modi_check: "",
  vogel: "Vogel",
  least_cost: "Costo mínimo",
  northwest: "Esquina noroeste",
};

function initialMethod(result: ModuleResult): string {
  const steps = (result.iterations ?? []) as { method: string }[];
  const first = steps[0]?.method ?? "";
  const usedModi = steps.some((s) => s.method === "modi");
  if (usedModi) return "Vogel + MODI";
  return METHOD_TEXT[first] ?? first;
}

function tableRows(result: ModuleResult, name: string): (string | number)[][] {
  return (result.tables?.find((t) => t.name === name)?.rows ?? []) as (string | number)[][];
}

function isMax(result: ModuleResult): boolean {
  return result.solution.objective_sense === "max";
}

/** Envío con nombre legible cuando involucra un nodo ficticio. */
function shipmentLabel(from: string, to: string): string {
  if (isDummyDest(to)) return `Se queda en ${from} (oferta sin enviar)`;
  if (isDummySource(from)) return `${to} no recibe (demanda sin cubrir)`;
  return routeText(from, to);
}

export default function TransportResults({ result }: Props) {
  const [showDuals, setShowDuals] = useState(false);
  const model = modelFromResult(result);
  const meta = finalMeta(result);
  const m = result.solution.metrics;
  const max = isMax(result);
  const word = max ? "ganancia" : "costo";
  const Word = max ? "Ganancia" : "Costo";
  const status = result.status;
  const value = result.solution.objective_value;
  const ships = tableRows(result, "envios");
  const real = ships.filter((row) => !isDummySource(String(row[0])) && !isDummyDest(String(row[1])));
  const dummy = ships.filter((row) => isDummySource(String(row[0])) || isDummyDest(String(row[1])));
  const totalUnits = real.reduce((a, row) => a + (Number(row[2]) || 0), 0);
  const totalValue = real.reduce((a, row) => a + (Number(row[4]) || 0), 0);
  const possible = model ? (model.sources.length - (model.dummyRow ? 1 : 0)) * (model.dests.length - (model.dummyCol ? 1 : 0)) : 0;
  const [lead, ...rest] = result.warnings ?? [];
  const leadIsStatus = status !== "optimal" && lead;

  return (
    <div className="transport-results">
      {leadIsStatus ? (
        <div className={status === "infeasible" ? "transport-callout is-error" : "transport-callout is-warn"} role="status">
          <strong>{status === "infeasible" ? "Sin solución válida" : "Solución inicial, no óptima"}</strong>
          <p>{pretty(lead)}</p>
          {status === "feasible" && m.optimal_cost != null ? (
            <p className="field-hint">
              Elige el método <strong>Óptimo · Vogel + MODI</strong> en Datos para ver la solución de{" "}
              {max ? "mayor ganancia" : "menor costo"} y los ciclos de mejora.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="pert-kpis">
        <article className="pert-kpi eoq-kpi-main">
          <span>{Word} total</span>
          <strong>{value != null ? fmt(value) : "—"}</strong>
          <small>{status === "optimal" ? `${max ? "Máximo" : "Mínimo"} posible` : initialMethod(result)}</small>
        </article>
        {status === "feasible" && m.optimal_cost != null ? (
          <article className="pert-kpi is-warn">
            <span>Óptimo con MODI</span>
            <strong>{fmt(m.optimal_cost)}</strong>
            {m.gap != null && value != null ? (
              <small>
                {max ? "Ganarías" : "Ahorrarías"} {fmt(m.gap)} ({fmt((m.gap / Math.max(1e-9, Math.abs(value))) * 100, 1)} %)
              </small>
            ) : null}
          </article>
        ) : null}
        <article className="pert-kpi">
          <span>Rutas usadas</span>
          <strong>{fmt(m.routes_used, 0)}</strong>
          {possible ? <small>de {possible} posibles</small> : null}
        </article>
        <article className="pert-kpi">
          <span>Unidades enviadas</span>
          <strong>{fmt(m.units_shipped)}</strong>
        </article>
        {m.unused_supply > 1e-9 ? (
          <article className="pert-kpi">
            <span>Oferta sin enviar</span>
            <strong>{fmt(m.unused_supply)}</strong>
            <small>se queda en origen</small>
          </article>
        ) : null}
        {m.unmet_demand > 1e-9 ? (
          <article className="pert-kpi is-warn">
            <span>Demanda sin cubrir</span>
            <strong>{fmt(m.unmet_demand)}</strong>
            <small>falta oferta</small>
          </article>
        ) : null}
      </div>

      {(leadIsStatus ? rest : result.warnings ?? []).length > 0 ? (
        <ul className="warn-list">
          {(leadIsStatus ? rest : result.warnings).map((w) => (
            <li key={w}>{pretty(w)}</li>
          ))}
        </ul>
      ) : null}

      {real.length ? (
        <div className="transport-plan-wrap">
        <table className="data-table transport-plan">
          <caption className="section-label">Plan de envíos</caption>
          <thead>
            <tr>
              <th scope="col">Ruta</th>
              <th scope="col">Cantidad</th>
              <th scope="col">{max ? "Ganancia unitaria" : "Costo unitario"}</th>
              <th scope="col">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {real.map((row) => (
              <tr key={`${row[0]}-${row[1]}`}>
                <td className="col-text">{shipmentLabel(String(row[0]), String(row[1]))}</td>
                <td>{fmt(row[2] as Num, 4)}</td>
                <td>{fmt(row[3] as Num, 4)}</td>
                <td>{fmt(row[4] as Num, 4)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="col-text">
                Total
              </th>
              <td>{fmt(totalUnits, 4)}</td>
              <td />
              <td>{fmt(totalValue, 4)}</td>
            </tr>
          </tfoot>
        </table>
        </div>
      ) : (
        <p className="field-hint">No se envía ninguna unidad por rutas reales.</p>
      )}
      {dummy.length ? (
        <ul className="transport-dummy-list">
          {dummy.map((row) => (
            <li key={`${row[0]}-${row[1]}`}>
              <strong>{fmt(row[2] as Num)}</strong> {shipmentLabel(String(row[0]), String(row[1]))}
            </li>
          ))}
        </ul>
      ) : null}

      {model && meta ? (
        <>
          <div className="transport-section-head">
            <h3 className="section-label">Tabla de transporte</h3>
            {meta.u ? (
              <label className="transport-check">
                <input type="checkbox" checked={showDuals} onChange={(e) => setShowDuals(e.target.checked)} />
                Mostrar uᵢ, vⱼ y costos reducidos
              </label>
            ) : null}
          </div>
          <TransportTableau
            model={model}
            alloc={meta.alloc}
            basis={meta.basis}
            caption="Tabla de transporte de la solución"
            u={showDuals ? meta.u : undefined}
            v={showDuals ? meta.v : undefined}
            reduced={showDuals ? meta.reduced : undefined}
            maximize={max}
          />
          <p className="field-hint transport-legend">
            Número chico: {word} por unidad. Número grande: unidades enviadas.
            {showDuals
              ? ` En las celdas vacías aparece el costo reducido ${word === "costo" ? "(si es negativo, usar la ruta bajaría el costo)" : "(si es positivo, usar la ruta subiría la ganancia)"}.`
              : ""}
            {model.dummyRow || model.dummyCol ? " «Ficticio» equilibra oferta y demanda con costo 0." : ""}
          </p>
        </>
      ) : null}

      <div className="transport-summary">
        <div>
        <SolutionTable
          caption="Por origen"
          columns={["Origen", "Oferta", "Enviado", "Sin enviar"]}
          rows={tableRows(result, "resumen_origenes")}
          textColumns={[0]}
        />
        </div>
        <div>
        <SolutionTable
          caption="Por destino"
          columns={["Destino", "Demanda", "Recibido", "Faltante"]}
          rows={tableRows(result, "resumen_destinos")}
          textColumns={[0]}
        />
        </div>
      </div>
    </div>
  );
}

/** Pestaña Sensibilidad: costos reducidos con lectura en lenguaje claro y multiplicadores. */
export function TransportSensitivity({ result }: Props) {
  const max = isMax(result);
  const word = max ? "ganancia" : "costo";
  const sens = (result.sensitivity ?? {}) as TransportSensitivityData;
  const rows = sens.reduced_costs ?? [];
  const duals = sens.shadow_prices ?? [];
  if (result.status === "infeasible") {
    return <p className="field-hint">El modelo no tiene solución válida, así que no hay análisis de sensibilidad.</p>;
  }
  const real = rows
    .filter((r) => !isDummySource(String(r.origen)) && !isDummyDest(String(r.destino)))
    .sort((a, b) => Math.abs(numeric(a.reduced_cost) ?? Infinity) - Math.abs(numeric(b.reduced_cost) ?? Infinity));

  function reading(r: Record<string, Num>): string {
    const d = numeric(r.reduced_cost);
    const c = numeric(r.costo_unitario);
    if (d == null) return "El valor depende de M (hay una ruta prohibida en la base).";
    if (Math.abs(d) < 1e-9) return `Óptimo alternativo: usarla no cambia el ${word} total.`;
    const improves = max ? d > 0 : d < 0;
    if (improves) {
      return `Usarla ${max ? "sube la ganancia" : "baja el costo"} en ${fmt(Math.abs(d))} por unidad: la solución aún puede mejorar.`;
    }
    if (c == null) return `Cada unidad por aquí ${max ? "restaría" : "sumaría"} ${fmt(Math.abs(d))}.`;
    if (max) return `Convendría si su ganancia sube de ${fmt(c)} a más de ${fmt(c + Math.abs(d))}.`;
    const threshold = c - Math.abs(d);
    return threshold > 0
      ? `Convendría si su costo baja de ${fmt(c)} a menos de ${fmt(threshold)}.`
      : `Su costo tendría que bajar por debajo de ${fmt(threshold)}: en la práctica no conviene.`;
  }

  return (
    <div className="transport-sensitivity">
      <p className="pert-lead">
        El <strong>costo reducido</strong> de una ruta sin usar indica cuánto cambiaría el {word} total por cada unidad
        que se obligue a enviar por ella. Es el margen que debe moverse su {word} unitario para que convenga usarla.
      </p>
      {real.length ? (
        <SolutionTable
          caption="Rutas sin usar"
          columns={["Ruta", max ? "Ganancia unitaria" : "Costo unitario", "Costo reducido", "Lectura"]}
          rows={real.map((r) => [routeText(String(r.origen), String(r.destino)), r.costo_unitario ?? "—", fmt(r.reduced_cost), reading(r)])}
          textColumns={[0, 3]}
        />
      ) : (
        <p className="field-hint">Todas las rutas están en uso o prohibidas.</p>
      )}
      {duals.length ? (
        <>
          <SolutionTable
            caption="Multiplicadores (MODI)"
            columns={["Restricción", "Multiplicador"]}
            rows={duals.map((d) => [
              String(d.restriccion).replace(/^Oferta /, "Oferta de ").replace(/^Demanda /, "Demanda de "),
              `${d.tipo === "u" ? "u" : "v"} = ${fmt(d.valor)}`,
            ])}
            textColumns={[0]}
          />
          <p className="field-hint">
            En cada ruta usada se cumple uᵢ + vⱼ = {word} unitario (con u₁ = 0 como referencia). El costo reducido de una
            ruta vacía es su {word} − uᵢ − vⱼ.
          </p>
        </>
      ) : null}
    </div>
  );
}

/** Mapa de envíos: orígenes a la izquierda, destinos a la derecha, grosor según cantidad. */
export function TransportFlowMap({ result }: Props) {
  const model = modelFromResult(result);
  const ships = tableRows(result, "envios");
  if (!model || !ships.length) return null;
  const { sources, dests } = model;
  const rowH = 56;
  const height = Math.max(sources.length, dests.length) * rowH + 24;
  const width = 640;
  const left = 150;
  const right = width - 150;
  const ySrc = (i: number) => 12 + (height - 24) * ((i + 0.5) / sources.length);
  const yDst = (j: number) => 12 + (height - 24) * ((j + 0.5) / dests.length);
  const maxQ = Math.max(...ships.map((row) => Number(row[2]) || 0), 1);
  const short = (s: string) => (s.length > 16 ? `${s.slice(0, 15)}…` : s);
  const mx = (left + right) / 2;
  const bezier = (t: number, y1: number, y2: number) => {
    const a = (1 - t) ** 3;
    const b = 3 * (1 - t) ** 2 * t;
    const c = 3 * (1 - t) * t ** 2;
    const d = t ** 3;
    return { x: a * left + (b + c) * mx + d * right, y: (a + b) * y1 + (c + d) * y2 };
  };
  // Coloca cada etiqueta en el primer punto de la curva que no choque con otra.
  const placed: { x: number; y: number }[] = [];
  const labelAt = (y1: number, y2: number) => {
    for (const t of [0.5, 0.35, 0.65, 0.25, 0.75, 0.18, 0.82]) {
      const pt = bezier(t, y1, y2);
      if (placed.every((o) => Math.abs(o.x - pt.x) > 26 || Math.abs(o.y - pt.y) > 15)) {
        placed.push(pt);
        return pt;
      }
    }
    const pt = bezier(0.5, y1, y2);
    placed.push(pt);
    return pt;
  };

  return (
    <figure className="transport-flow">
      <figcaption>
        <strong>Mapa de envíos</strong>
        <span>El grosor de cada línea es proporcional a las unidades enviadas.</span>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Mapa de envíos de orígenes a destinos">
        {ships.map((row) => {
          const i = sources.indexOf(String(row[0]));
          const j = dests.indexOf(String(row[1]));
          if (i < 0 || j < 0) return null;
          const q = Number(row[2]) || 0;
          const dummy = isDummySource(sources[i]) || isDummyDest(dests[j]);
          const y1 = ySrc(i);
          const y2 = yDst(j);
          const w = 1.5 + (q / maxQ) * 12;
          const pt = labelAt(y1, y2);
          return (
            <g key={`${i}-${j}`} className={dummy ? "flow-edge is-dummy" : "flow-edge"}>
              <title>{`${shipmentLabel(sources[i], dests[j])}: ${fmt(q)} unidades`}</title>
              <path d={`M ${left} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${right} ${y2}`} strokeWidth={w} fill="none" />
              <text x={pt.x} y={pt.y + 4} textAnchor="middle" className="flow-qty">
                {fmt(q)}
              </text>
            </g>
          );
        })}
        {sources.map((s, i) => (
          <g key={`s${i}`} className={isDummySource(s) ? "flow-node is-dummy" : "flow-node"}>
            <circle cx={left} cy={ySrc(i)} r={6} />
            <text x={left - 12} y={ySrc(i) - 2} textAnchor="end" className="flow-name">
              {isDummySource(s) ? "Ficticio" : short(s)}
            </text>
            <text x={left - 12} y={ySrc(i) + 13} textAnchor="end" className="flow-sub">
              oferta {fmt(model.supply[i])}
            </text>
          </g>
        ))}
        {dests.map((d, j) => (
          <g key={`d${j}`} className={isDummyDest(d) ? "flow-node is-dummy" : "flow-node"}>
            <circle cx={right} cy={yDst(j)} r={6} />
            <text x={right + 12} y={yDst(j) - 2} className="flow-name">
              {isDummyDest(d) ? "Ficticio" : short(d)}
            </text>
            <text x={right + 12} y={yDst(j) + 13} className="flow-sub">
              demanda {fmt(model.demand[j])}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
