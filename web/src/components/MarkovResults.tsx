import type { ModuleResult } from "../api/client";
import { fmtNum } from "../lib/markovForm";
import ChartViews from "./ChartViews";
import SolutionTable from "./SolutionTable";
import StatusBand from "./StatusBand";

type Props = { result: ModuleResult };
type Table = NonNullable<ModuleResult["tables"]>[number];

const TEXT = new Set([
  "estado",
  "clase",
  "tipo",
  "periodo",
  "accesibles",
  "estados",
  "politica",
  "optima",
  "accion",
  "paso",
]);

const HEADERS: Record<string, string> = {
  estado: "Estado",
  clase: "Clase",
  tipo: "Tipo",
  periodo: "Periodo",
  accesibles: "Puede llegar a",
  estados: "Estados",
  probabilidad: "Probabilidad",
  t: "Paso t",
  recompensa: "Recompensa",
  peso_estacionario: "Peso en el largo plazo",
  contribución: "Aporte",
  pasos_esperados: "Pasos esperados",
  recompensa_esperada: "Recompensa esperada hasta absorberse",
  politica: "Política",
  costo_promedio: "Costo promedio",
  valor_descontado: "Valor descontado",
  optima: "¿Óptima?",
  accion: "Acción",
  costo: "Costo inmediato",
  valor: "Valor",
  paso: "Paso",
};

function findTable(result: ModuleResult, name: string): Table | undefined {
  return result.tables?.find((item) => item.name === name);
}

function cells(row: unknown[]): (string | number | null)[] {
  return row.map((cell) => {
    if (cell == null) return null;
    if (typeof cell === "number" || typeof cell === "string") return cell;
    if (typeof cell === "boolean") return cell ? "sí" : "no";
    return String(cell);
  });
}

function header(column: string): string {
  return HEADERS[column] ?? column;
}

function Named({
  table,
  caption,
  active,
}: {
  table: Table;
  caption: string;
  active?: number[];
}) {
  const textColumns = table.columns.map((column, index) => (TEXT.has(column) ? index : -1)).filter((index) => index >= 0);
  return (
    <div className="matrix-editor">
      <SolutionTable
        caption={caption}
        columns={table.columns.map(header)}
        rows={table.rows.map(cells)}
        textColumns={textColumns}
        activeRowIndexes={active ?? []}
      />
    </div>
  );
}

function pct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("es-MX", { style: "percent", maximumFractionDigits: 2 });
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

function ChainView({ result }: Props) {
  const metrics = result.solution.metrics;
  const steady = findTable(result, "steady_state");
  const classes = findTable(result, "classes");
  const classification = findTable(result, "classification");
  const transient = findTable(result, "transient");
  const power = findTable(result, "transition_power_n");
  const absorption = findTable(result, "absorption_probabilities");
  const steps = findTable(result, "expected_steps_to_absorption");
  const fundamental = findTable(result, "fundamental_matrix");
  const rewards = findTable(result, "rewards");
  const rewardToGo = findTable(result, "expected_reward_to_absorption");
  const recurrent = metrics.num_recurrent_classes ?? 0;
  const absorbing = metrics.num_absorbing_states ?? 0;
  const periodic = metrics.is_periodic === 1;
  const steadyText = steady?.rows.map((row) => `${row[0]} ${pct(Number(row[1]))}`).join(", ");

  return (
    <>
      <p>
        {recurrent <= 1
          ? "Hay una sola clase que no se abandona, así que la distribución de largo plazo es única."
          : `Hay ${fmtNum(recurrent, 0)} clases que no se abandonan, así que el largo plazo depende de dónde empieces.`}
        {absorbing > 0
          ? absorbing === recurrent
            ? absorbing === 1
              ? " Esa clase es un estado absorbente: al llegar, la cadena se queda ahí."
              : " Esas clases son estados absorbentes: al llegar, la cadena se queda ahí."
            : ` Hay ${fmtNum(absorbing, 0)} estados absorbentes, además de otras clases recurrentes.`
          : " Ningún estado es absorbente por sí solo."}
        {periodic ? " Además hay una clase periódica: la probabilidad del paso n puede seguir oscilando." : ""}
      </p>

      <h3 className="section-label">Qué tipo de estado es cada uno</h3>
      <p>
        <strong>Recurrente</strong> quiere decir que, si entras en esa clase, te quedas para siempre y puedes volver a cada uno de sus estados.
        Si la clase es un solo estado, es <strong>absorbente</strong>. <strong>Transitorio</strong> quiere decir que tarde o temprano lo dejas y no regresas.
        El <strong>periodo</strong> es el ciclo de una clase recurrente: 1 (aperiódica) no obliga a un ritmo; un periodo 2, como ir y volver entre dos estados, hace que el paso n alterne.
        «Puede llegar a» lista los estados a los que hay un camino, incluido él mismo.
      </p>
      {classification ? <Named table={classification} caption="Clasificación" /> : null}
      {classes ? <Named table={classes} caption="Clases" /> : null}

      <h3 className="section-label">Distribución de largo plazo</h3>
      <p>
        {recurrent <= 1
          ? "Si hoy las probabilidades son estas, mañana siguen iguales. En un estado transitorio el peso de largo plazo es cero."
          : "No es la única distribución que se queda quieta. Es la que corresponde a tu distribución inicial: cada clase recurrente aporta la suya, pesada por la probabilidad de caer en ella."}
        {steadyText ? ` Queda así: ${steadyText}.` : ""}
      </p>
      {steady ? <Named table={steady} caption="Estado estable" /> : null}
      {rewards ? (
        <>
          <p>
            El aporte de cada estado es su recompensa por la probabilidad de largo plazo. La recompensa esperada por paso, ya en el largo plazo, es{" "}
            {fmtNum(metrics.long_run_expected_reward)}.
          </p>
          <Named table={rewards} caption="Recompensas" />
        </>
      ) : null}

      {transient ? (
        <>
          <h3 className="section-label">Paso a paso</h3>
          <p>La fila t es la probabilidad de estar en cada estado después de t saltos. t = 0 es donde empiezas.</p>
          <div style={{ maxHeight: 360 }}>
            <Named table={transient} caption="Distribución transitoria" />
          </div>
        </>
      ) : null}

      {power ? (
        <>
          <h3 className="section-label">Matriz después de {fmtNum(metrics.n_power, 0)} pasos</h3>
          <p>La casilla de la fila i y la columna j es la probabilidad de estar en j dentro de n pasos si hoy estás seguro en i.</p>
          <Named table={power} caption={`P elevado a ${fmtNum(metrics.n_power, 0)}`} />
        </>
      ) : null}

      {absorption ? (
        <>
          <h3 className="section-label">Hasta salir de los transitorios</h3>
          <p>
            Desde un estado transitorio, la tabla dice la probabilidad de terminar en cada{" "}
            {absorbing > 0 && absorbing === recurrent ? "estado absorbente" : "clase recurrente"}. Si la columna es una clase (C1, C2…),
            los estados de esa clase están en la tabla de arriba. Los pasos esperados cuentan cuántos saltos pasan, en promedio, antes de
            salir. La matriz fundamental dice cuántas veces esperas visitar cada transitorio antes de eso.
          </p>
          <Named table={absorption} caption="Probabilidades de absorción" />
          {steps ? <Named table={steps} caption="Pasos esperados" /> : null}
          {fundamental ? <Named table={fundamental} caption="Matriz fundamental" /> : null}
          {rewardToGo ? (
            <>
              <p>La recompensa esperada suma lo que cobras en los estados transitorios antes de quedar atrapado en una clase recurrente.</p>
              <Named table={rewardToGo} caption="Recompensa esperada hasta la absorción" />
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function MdpView({ result }: Props) {
  const metrics = result.solution.metrics;
  const sense = result.solution.objective_sense === "max" ? "max" : "min";
  const policies = findTable(result, "policies");
  const optimal = findTable(result, "optimal_policy");
  const trace = findTable(result, "policy_iteration");
  const discounted = policies?.columns.includes("valor_descontado") || metrics.discount != null;
  const bestRows = policies?.rows.map((row, index) => (row[row.length - 1] === "sí" ? index : -1)).filter((index) => index >= 0) ?? [];
  const noun = sense === "max" ? "recompensa" : "costo";

  return (
    <>
      <p>
        Una política es elegir una acción en cada estado. Se compara con iteración de políticas: se evalúa la política actual y, en cada
        estado, se cambia a la acción que {sense === "max" ? "sube" : "baja"} el {noun}
        {discounted ? " descontado" : " de largo plazo"}.
        {policies
          ? " Como no hay demasiadas combinaciones, también se enumeraron todas: la óptima de la lista coincide con la de la iteración."
          : " Hay demasiadas combinaciones para listarlas; la tabla muestra el camino de la iteración."}
      </p>
      {discounted ? (
        <p>
          Con descuento γ = {fmtNum(metrics.discount, 4)}, el valor de un estado es el {noun} total esperado si empiezas ahí y sigues la
          política. Un {noun} que llega dentro de un paso pesa γ, y dentro de dos pasos pesa γ². El número de arriba es el promedio de
          esos valores si el estado inicial es igual de probable.
        </p>
      ) : (
        <p>
          {sense === "max" ? "La recompensa promedio" : "El costo promedio"} es lo que {sense === "max" ? "ganas" : "pagas"} por paso cuando
          ya pasó mucho tiempo. El valor que acompaña a cada estado es relativo: solo importan las diferencias, y uno de los estados quedó
          fijado en 0 para poder resolver el sistema. Sirve para comparar acciones, no como un total en dinero.
        </p>
      )}
      {optimal ? <Named table={optimal} caption="Política óptima" /> : null}
      {policies ? (
        <>
          <p>La fila resaltada es una política óptima. Si varias empatan, todas quedan marcadas con «sí».</p>
          <Named table={policies} caption="Comparación de políticas" active={bestRows} />
        </>
      ) : null}
      {trace ? <Named table={trace} caption="Iteración de políticas" /> : null}
    </>
  );
}

function valueLabel(result: ModuleResult, isMdp: boolean): string {
  if (!isMdp) return "Recompensa de largo plazo";
  const max = result.solution.objective_sense === "max";
  const discounted = findTable(result, "policies")?.columns.includes("valor_descontado") || result.solution.metrics.discount != null;
  if (discounted) return max ? "Recompensa descontada" : "Costo descontado";
  return max ? "Recompensa promedio" : "Costo promedio";
}

export default function MarkovResults({ result }: Props) {
  const isMdp = Boolean(findTable(result, "optimal_policy"));
  const reward = result.solution.metrics.long_run_expected_reward;
  const objective = isMdp ? result.solution.objective_value : reward ?? null;
  const recurrent = result.solution.metrics.num_recurrent_classes;
  const statusText = isMdp
    ? "Política óptima"
    : result.solution.metrics.is_periodic === 1
      ? "Cadena periódica"
      : recurrent != null && recurrent > 1
        ? "Varias clases recurrentes"
        : result.solution.metrics.is_absorbing_chain === 1
          ? "Cadena con absorción"
          : "Distribución estacionaria";

  return (
    <div>
      <StatusBand
        status={result.status}
        statusText={statusText}
        objectiveValue={objective}
        objectiveSense={isMdp ? result.solution.objective_sense : null}
        warnings={result.warnings}
        valueLabel={valueLabel(result, isMdp)}
      />
      <Warnings warnings={result.warnings} />
      {isMdp ? <MdpView result={result} /> : <ChainView result={result} />}
      <h3 className="section-label">Diagrama</h3>
      <p className="field-hint">
        {isMdp
          ? "Cada nodo muestra la acción de la política óptima. La flecha es la probabilidad de pasar al otro estado."
          : "Una flecha es un salto posible. El nodo marcado como absorbente es un estado del que ya no se sale."}
      </p>
      <ChartViews result={result} />
    </div>
  );
}
