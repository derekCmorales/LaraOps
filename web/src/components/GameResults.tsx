import type { ModuleResult } from "../api/client";
import { fmtGame, fmtProb } from "../lib/gameForm";
import ChartViews from "./ChartViews";
import SolutionTable from "./SolutionTable";
import StatusBand from "./StatusBand";

type Props = { result: ModuleResult };

type Step = {
  index?: number;
  method?: string;
  title?: string;
  meta?: Record<string, unknown>;
};

function tableOf(result: ModuleResult, name: string) {
  return result.tables?.find((item) => item.name === name);
}

function stepsOf(result: ModuleResult): Step[] {
  if (!Array.isArray(result.iterations)) return [];
  return result.iterations.filter((step): step is Step => !!step && typeof step === "object");
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function strategyPhrase(player: string, entries: [string, number][]): string {
  const live = entries.filter(([, prob]) => prob > 1e-8);
  if (!live.length) return "";
  if (live.length === 1 && live[0][1] > 1 - 1e-8) {
    return `El jugador ${player} juega siempre ${live[0][0]}.`;
  }
  const parts = live.map(([name, prob]) => `${name} con probabilidad ${fmtProb(prob)}`);
  return `El jugador ${player} juega ${joinList(parts)}.`;
}

function purePairs(result: ModuleResult): { row: string; col: string }[] {
  return Object.keys(result.solution.variables)
    .filter((key) => key.startsWith("pure:"))
    .map((key) => {
      const rest = key.slice("pure:".length);
      const arrow = rest.indexOf("->");
      return {
        row: arrow >= 0 ? rest.slice(0, arrow) : rest,
        col: arrow >= 0 ? rest.slice(arrow + 2) : "",
      };
    });
}

function prose(result: ModuleResult, pure: boolean, value: number): string {
  const maximin = result.solution.metrics.maximin;
  const minimax = result.solution.metrics.minimax;
  const bounds =
    Number.isFinite(maximin) && Number.isFinite(minimax)
      ? ` El maximin de la fila es ${fmtGame(maximin)} y el minimax de la columna es ${fmtGame(minimax)}.`
      : "";
  if (pure) {
    const pairs = purePairs(result);
    if (pairs.length <= 1) {
      const one = pairs[0];
      const where = one ? ` en ${one.row} contra ${one.col}` : "";
      return `Hay un punto de silla${where}, con valor ${fmtGame(value)}. El jugador fila se garantiza ese pago y el jugador columna impide que sea mayor.${bounds}`;
    }
    const listed = pairs.map((pair) => `${pair.row} contra ${pair.col}`);
    return `Hay ${pairs.length} puntos de silla y todos valen ${fmtGame(value)}: ${joinList(listed)}. Cualquiera de esas celdas es un equilibrio en estrategias puras.${bounds}`;
  }
  const rowEntries = Object.entries(result.solution.variables)
    .filter(([key]) => key.startsWith("p:"))
    .map(([key, prob]) => [key.slice(2), prob] as [string, number]);
  const colEntries = Object.entries(result.solution.variables)
    .filter(([key]) => key.startsWith("q:"))
    .map(([key, prob]) => [key.slice(2), prob] as [string, number]);
  return `No hay punto de silla, así que el valor ${fmtGame(value)} se logra mezclando estrategias.${bounds} ${strategyPhrase("fila", rowEntries)} ${strategyPhrase("columna", colEntries)}`.trim();
}

function PayoffMatrix({ result }: Props) {
  const pay = tableOf(result, "matriz_pagos");
  if (!pay) return null;
  const cols = pay.columns.slice(1);
  const mins = new Map((tableOf(result, "minimos_fila")?.rows ?? []).map((row) => [String(row[0]), row]));
  const maxs = new Map((tableOf(result, "maximos_columna")?.rows ?? []).map((row) => [String(row[0]), row]));
  const saddles = new Set(purePairs(result).map((pair) => `${pair.row}\u0000${pair.col}`));

  return (
    <div className="q-table-scroll">
      <table className="data-table">
        <caption className="section-label">Matriz de pagos del jugador fila</caption>
        <thead>
          <tr>
            <th scope="col" className="col-text">
              Fila
            </th>
            {cols.map((col) => (
              <th key={col} scope="col">
                {col}
              </th>
            ))}
            <th scope="col">Mínimo</th>
            <th scope="col" className="col-text">
              Maximin
            </th>
          </tr>
        </thead>
        <tbody>
          {pay.rows.map((row) => {
            const name = String(row[0]);
            const info = mins.get(name);
            return (
              <tr key={name}>
                <th scope="row" className="col-text">
                  {name}
                </th>
                {cols.map((col, j) => {
                  const saddle = saddles.has(`${name}\u0000${col}`);
                  return (
                    <td key={col} className={saddle ? "cell-pivot" : undefined}>
                      {fmtGame(Number(row[j + 1]))}
                      {saddle ? <span className="sr-only"> punto de silla</span> : null}
                    </td>
                  );
                })}
                <td>{info ? fmtGame(Number(info[1])) : "—"}</td>
                <td className="col-text">{info ? String(info[2]) : "—"}</td>
              </tr>
            );
          })}
          <tr>
            <th scope="row" className="col-text">
              Máximo
            </th>
            {cols.map((col) => (
              <td key={col}>{maxs.get(col) ? fmtGame(Number(maxs.get(col)?.[1])) : "—"}</td>
            ))}
            <td />
            <td />
          </tr>
          <tr>
            <th scope="row" className="col-text">
              Minimax
            </th>
            {cols.map((col) => (
              <td key={col} className="col-text">
                {maxs.get(col) ? String(maxs.get(col)?.[2]) : "—"}
              </td>
            ))}
            <td />
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Formulation({ result }: Props) {
  const rows = tableOf(result, "formulacion_lp")?.rows ?? [];
  if (!rows.length) return null;
  const blocks = [
    { id: "fila", title: "Jugador fila (maximiza v)" },
    { id: "columna", title: "Jugador columna (minimiza v)" },
  ];
  return (
    <section>
      <h3 className="section-label">Programa lineal</h3>
      <p className="field-hint">
        El jugador fila maximiza v y el jugador columna lo minimiza. Las restricciones usan los nombres y los pagos originales de la matriz.
      </p>
      {blocks.map((block) => {
        const lines = rows.filter((row) => row[0] === block.id);
        if (!lines.length) return null;
        return (
          <div key={block.id}>
            <p className="section-label">{block.title}</p>
            <ol>
              {lines.map((line, index) => (
                <li key={`${block.id}-${index}`} className="q-math">
                  {String(line[1])}
                </li>
              ))}
            </ol>
          </div>
        );
      })}
      {rows
        .filter((row) => row[0] === "nota")
        .map((row) => (
          <p key={String(row[1])} className="field-hint">
            {String(row[1])}
          </p>
        ))}
    </section>
  );
}

export default function GameResults({ result }: Props) {
  const value = result.solution.objective_value ?? result.solution.metrics.game_value;
  const pure = Object.keys(result.solution.variables).some((key) => key.startsWith("pure:"));
  const finiteValue = typeof value === "number" && Number.isFinite(value) ? value : null;
  const dominance = stepsOf(result).filter((step) => step.method === "dominance");
  const reduced = tableOf(result, "reduced_payoff");
  const expected = tableOf(result, "pago_esperado");
  const saddles = tableOf(result, "punto_silla_puro");
  const strategies = Object.entries(result.solution.variables)
    .filter(([key]) => key.startsWith("p:") || key.startsWith("q:"))
    .map(([key, prob]) => [key.startsWith("p:") ? "Fila" : "Columna", key.slice(2), prob]);

  return (
    <div>
      <StatusBand
        status={result.status}
        objectiveValue={finiteValue}
        objectiveSense={result.solution.objective_sense}
        warnings={result.warnings}
        valueLabel="Valor del juego"
        statusText={pure ? "Punto de silla en estrategias puras" : "Equilibrio en estrategias mixtas"}
      />

      <div className="eoq-preview">
        <span className="eoq-preview-label">{pure ? "Estrategias puras" : "Estrategias mixtas"}</span>
        <p className="eoq-preview-facts">{finiteValue == null ? "No hay un valor del juego." : prose(result, pure, finiteValue)}</p>
      </div>

      <div className="pert-kpis">
        <article className="pert-kpi">
          <span>Maximin</span>
          <strong>{Number.isFinite(result.solution.metrics.maximin) ? fmtGame(result.solution.metrics.maximin) : "—"}</strong>
          <small>mejor piso del jugador fila</small>
        </article>
        <article className="pert-kpi">
          <span>Minimax</span>
          <strong>{Number.isFinite(result.solution.metrics.minimax) ? fmtGame(result.solution.metrics.minimax) : "—"}</strong>
          <small>mejor techo del jugador columna</small>
        </article>
      </div>

      <PayoffMatrix result={result} />
      <p className="field-hint">
        El mínimo de cada fila es lo peor que le puede pasar si la juega. Maximin marca las filas cuyo peor caso es el menos malo. El máximo de cada columna es lo más que paga el rival; minimax marca las columnas que mantienen ese pago lo más bajo posible.
        {pure ? " La celda resaltada es un punto de silla." : ""}
      </p>

      {pure && saddles ? (
        <>
          <SolutionTable
            caption="Puntos de silla"
            columns={["Fila", "Columna", "Valor"]}
            rows={saddles.rows.map((row) => [String(row[0]), String(row[1]), typeof row[2] === "number" ? row[2] : Number(row[2])])}
            textColumns={[0, 1]}
          />
          {saddles.rows.length > 1 ? (
            <p className="field-hint">
              Cada uno de estos pares es un equilibrio por sí solo y el valor es el mismo. Mezclarlos tampoco cambia el pago.
            </p>
          ) : null}
        </>
      ) : null}
      {strategies.length > 0 ? (
        <>
          <SolutionTable
            caption="Estrategias del equilibrio"
            columns={["Jugador", "Estrategia", "Probabilidad"]}
            rows={strategies}
            textColumns={[0, 1]}
          />
          <p className="field-hint">
            Las probabilidades de cada jugador suman 1. Es la fracción de veces que conviene jugar esa estrategia si el juego se repite.
          </p>
        </>
      ) : null}

      {expected ? (
        <>
          <SolutionTable
            caption="Pago esperado contra cada estrategia pura del rival"
            columns={["Jugador", "Estrategia del rival", "Pago esperado", "En el soporte"]}
            rows={expected.rows.map((row) => [
              row[0] === "fila" ? "Fila" : row[0] === "columna" ? "Columna" : String(row[0]),
              String(row[1]),
              typeof row[2] === "number" ? row[2] : Number(row[2]),
              String(row[3]),
            ])}
            textColumns={[0, 1, 3]}
          />
          <p className="field-hint">
            En el equilibrio, el pago contra las estrategias que el rival sí usa es el valor del juego. Contra las demás, el rival no mejora si se desvía.
          </p>
        </>
      ) : null}

      <Formulation result={result} />

      {dominance.length > 0 ? (
        <section>
          <h3 className="section-label">Estrategias dominadas</h3>
          <p className="field-hint">
            Se elimina una por vez, primero filas y luego columnas. Una fila sale si otra le gana o empata en todas las columnas vivas y le gana en alguna. Una columna sale si otra le deja a la fila un pago menor o igual en todas las filas y menor en alguna.
          </p>
          <ol>
            {dominance.map((step, index) => (
              <li key={step.index ?? index}>{step.title}</li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="field-hint">Todas las estrategias siguen en juego.</p>
      )}

      {reduced ? (
        <SolutionTable
          caption="Matriz reducida"
          columns={reduced.columns}
          rows={reduced.rows.map((row) => row.map((cell) => (typeof cell === "number" || typeof cell === "string" ? cell : String(cell))))}
          textColumns={[0]}
        />
      ) : null}

      {result.graph?.type === "xy" && result.graph.series?.length ? (
        <section>
          <h3 className="section-label">Gráfico</h3>
          <p className="field-hint">
            Cada recta es el pago esperado si el rival juega una estrategia pura. En el eje horizontal está la probabilidad de la primera estrategia que quedó viva.
          </p>
          <ChartViews result={result} />
        </section>
      ) : null}
    </div>
  );
}
