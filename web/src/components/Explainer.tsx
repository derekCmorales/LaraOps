import type { ModuleResult } from "../api/client";
import { senseLabel } from "../lib/resultLabels";

type Props = {
  result: ModuleResult;
};

function fmtNum(value: unknown): string {
  return Number(value).toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

function explainPert(result: ModuleResult): string {
  const metrics = result.solution.metrics || {};
  const duration = metrics.project_duration;
  const bits: string[] = [];
  if (result.status.toLowerCase() === "infeasible") {
    bits.push(
      `No se alcanza la duración pedida. Con los tiempos crash disponibles el proyecto queda en ${fmtNum(duration)}.`
    );
  } else if (duration != null && Number.isFinite(Number(duration))) {
    bits.push(
      `La duración del proyecto es ${fmtNum(duration)}. Es el camino más largo: cualquier retraso en la ruta crítica retrasa el fin.`
    );
  }
  if (metrics.project_std != null && Number.isFinite(Number(metrics.project_std))) {
    bits.push(
      `En PERT el tiempo esperado de esa ruta es ${fmtNum(metrics.project_te)} y la desviación estándar es ${fmtNum(metrics.project_std)}.`
    );
  }
  if (metrics.prob_meet_target != null && Number.isFinite(Number(metrics.prob_meet_target))) {
    const pct = Number(metrics.prob_meet_target).toLocaleString("es-MX", {
      style: "percent",
      maximumFractionDigits: 1,
    });
    bits.push(`La probabilidad de terminar en el tiempo objetivo, o antes, es ${pct}.`);
  }
  if (metrics.duration_for_probability != null && Number.isFinite(Number(metrics.duration_for_probability))) {
    bits.push(
      `Para la probabilidad pedida haría falta una duración de ${fmtNum(metrics.duration_for_probability)}.`
    );
  }
  if (metrics.crash_total_cost != null && Number.isFinite(Number(metrics.crash_total_cost))) {
    bits.push(
      `Acelerar cuesta ${fmtNum(metrics.crash_total_cost)} extra. El costo del proyecto queda en ${fmtNum(metrics.project_cost)}.`
    );
  }
  if (result.warnings.some((warning) => /varias rutas críticas/i.test(warning))) {
    bits.push("Hay más de una ruta crítica. Un retraso en cualquiera de ellas mueve la fecha de fin.");
  }
  if (!bits.length) {
    bits.push("El cronograma muestra inicio y fin temprano, inicio y fin tardío, y la holgura de cada actividad.");
  }
  return bits.join(" ");
}

function explainEoq(result: ModuleResult): string {
  const m = result.solution.metrics || {};
  const q = m.Q_star ?? result.solution.variables.Q;
  const bits: string[] = [];
  bits.push(
    `Pedir ${fmtNum(q)} unidades cada vez minimiza la suma del costo de ordenar y el de mantener inventario.`
  );
  if (m.TC_ordering != null && m.TC_holding != null) {
    bits.push(
      `En Q* ambos costos son iguales (${fmtNum(m.TC_ordering)} cada uno): con pedidos más chicos se ordena más seguido y sube el costo de ordenar; con pedidos más grandes sube el costo de mantener.`
    );
  }
  if (m.purchase_cost != null && m.purchase_cost > 0) {
    bits.push(
      `El costo de compra (${fmtNum(m.purchase_cost)}) se paga igual con cualquier tamaño de pedido, por eso no cambia Q*.`
    );
  }
  bits.push(
    "La curva de costo es plana cerca del óptimo: redondear Q* o pedir en múltiplos de caja casi no cambia el costo."
  );
  if (m.reorder_point != null) {
    bits.push(
      `Coloca cada pedido cuando el inventario baje a ${fmtNum(m.reorder_point)} unidades: es la demanda que se consume durante el tiempo de entrega.`
    );
  }
  bits.push("El modelo supone demanda constante, sin faltantes y entrega completa de cada pedido.");
  return bits.join(" ");
}

function explainAssignment(result: ModuleResult): string {
  const isMax = result.solution.objective_sense === "max";
  const word = isMax ? "ganancia" : "costo";
  if (result.status.toLowerCase() === "infeasible") {
    return "Las celdas prohibidas (M) dejan al menos a un agente sin opciones suficientes, así que no hay forma de dar una tarea distinta a cada uno. Quita alguna prohibición o agrega tareas para que exista solución.";
  }
  const m = result.solution.metrics || {};
  const bits: string[] = [];
  bits.push(
    `Cada agente hace a lo más una tarea y cada tarea la hace a lo más un agente. Ninguna otra combinación logra un${isMax ? "a ganancia total mayor" : " costo total menor"} que ${fmtNum(result.solution.objective_value)}.`
  );
  if (isMax) {
    bits.push("Para maximizar, el método trabaja con la pérdida de oportunidad (el mayor valor menos cada celda) y la minimiza.");
  }
  const adjustments = Number(m.n_adjustments ?? 0);
  bits.push(
    adjustments === 0
      ? "Bastó con restar el mínimo de cada fila y de cada columna para encontrar un cero por fila y columna."
      : `Después de reducir filas y columnas hizo falta ajustar la matriz ${adjustments === 1 ? "una vez" : `${adjustments} veces`} hasta que el número de líneas que cubren los ceros igualó al número de filas.`
  );
  if (result.warnings.some((w) => /no cuadrada/i.test(w))) {
    bits.push(`Como la matriz no era cuadrada se agregaron ficticios con ${word} 0; quien queda en un ficticio se queda sin pareja real.`);
  }
  if (result.warnings.some((w) => /óptimos múltiples/i.test(w))) {
    bits.push("Hay otra asignación con el mismo total: puedes elegir cualquiera de las dos según otros criterios.");
  }
  bits.push("Revisa la pestaña Iteraciones para seguir el método húngaro paso a paso.");
  return bits.join(" ");
}

function explainQueues(result: ModuleResult): string {
  const m = result.solution.metrics || {};
  const L = m.L;
  if (L == null || !Number.isFinite(Number(L))) {
    return "Cuando llegan clientes más rápido de lo que se pueden atender (ρ ≥ 1), la fila nunca se vacía y crece indefinidamente; por eso no hay promedios finitos. En la práctica la gente se desespera y se va, o se agregan servidores. Ajusta μ o s hasta que ρ sea menor que 1.";
  }
  const bits: string[] = [];
  bits.push(
    "La espera no crece en línea recta con la carga: con utilización ρ la fila promedio crece aproximadamente como ρ/(1 − ρ), así que pasar de 80 % a 90 % de ocupación duplica con creces la espera, y de 90 % a 95 % la vuelve a duplicar."
  );
  if (Number(m.rho) >= 0.85) {
    bits.push(`Con ρ = ${fmtNum(m.rho)} estás en la zona donde un pequeño aumento de clientes dispara la espera (mira la curva en Gráficos).`);
  } else if (Number(m.rho) < 0.5) {
    bits.push(`Con ρ = ${fmtNum(m.rho)} los servidores pasan más de la mitad del tiempo libres: hay holgura para atender más clientes.`);
  }
  bits.push(
    "La ley de Little (L = λ·W) conecta cuántos clientes hay con cuánto tiempo pasan: si reduces el tiempo de servicio, bajan las dos."
  );
  if (m.s_optimal != null) {
    bits.push(
      `Al comparar costos, cada servidor extra cuesta lo mismo pero ahorra cada vez menos espera; el punto donde la suma es mínima es s = ${fmtNum(m.s_optimal)}.`
    );
  }
  if (m.P_block != null) {
    bits.push("Con cupo limitado la fila nunca se desborda, pero el costo es que algunos clientes se van; revisa si esa pérdida es aceptable.");
  }
  bits.push("Los resultados son promedios de largo plazo: en un momento dado la fila puede ser más larga o más corta (revisa Pn en Gráficos).");
  return bits.join(" ");
}

function explain(result: ModuleResult): string {
  if (result.module === "pert_cpm") return explainPert(result);
  if (result.module === "queues") return explainQueues(result);
  if (result.module === "eoq") return explainEoq(result);
  if (result.module === "assignment") return explainAssignment(result);
  const s = result.status.toLowerCase();
  const z = result.solution.objective_value;
  const warnings = result.warnings || [];
  const sense = senseLabel(result.solution.objective_sense);

  if (s === "infeasible") {
    return "No existe solución que cumpla todas las restricciones. Revisa los signos, el lado derecho (LD) y las cotas: suele haber un conflicto entre dos o más restricciones.";
  }
  if (s === "unbounded") {
    return "El valor de Z crece (o decrece) sin límite. Suele indicar que falta una restricción que acote la región factible.";
  }

  const bits: string[] = [];
  if (z != null && Number.isFinite(z)) {
    bits.push(
      `El valor de la función objetivo es ${z.toLocaleString("es-MX", { maximumFractionDigits: 4 })}${sense ? ` (${sense})` : ""}.`
    );
  }

  const sens = result.sensitivity as
    | {
        shadow_prices?: { constraint_id?: string; shadow_price?: number }[];
      }
    | null
    | undefined;

  if (sens?.shadow_prices?.length) {
    const active = sens.shadow_prices.filter((p) => Math.abs(Number(p.shadow_price ?? 0)) > 1e-8);
    if (active.length) {
      const top = active[0];
      bits.push(
        `El precio sombra de la restricción ${top.constraint_id ?? "activa"} es ${Number(top.shadow_price).toLocaleString("es-MX", { maximumFractionDigits: 4 })}: una unidad más de ese recurso cambia Z en esa cantidad (dentro del rango de factibilidad).`
      );
    }
  }

  const metrics = result.solution.metrics || {};
  if (metrics.rho != null) {
    const rho = Number(metrics.rho);
    bits.push(
      `La utilización del sistema es ρ = ${rho.toLocaleString("es-MX", { maximumFractionDigits: 3 })} (proporción del tiempo que los servidores están ocupados).`
    );
  }
  if (metrics.Lq != null && Number.isFinite(Number(metrics.Lq))) {
    bits.push(
      `En promedio hay ${Number(metrics.Lq).toLocaleString("es-MX", { maximumFractionDigits: 3 })} clientes esperando en cola.`
    );
  }
  if (metrics.W != null && Number.isFinite(Number(metrics.W))) {
    bits.push(
      `El tiempo promedio en el sistema es W = ${Number(metrics.W).toLocaleString("es-MX", { maximumFractionDigits: 3 })}.`
    );
  }
  if (metrics.cost_total != null && Number.isFinite(Number(metrics.cost_total))) {
    bits.push(
      `El costo total (espera más servidores) es ${Number(metrics.cost_total).toLocaleString("es-MX", { maximumFractionDigits: 2 })}.`
    );
  }
  if (metrics.Q != null || metrics.Q_star != null || metrics.EOQ != null) {
    const q = metrics.Q_star ?? metrics.Q ?? metrics.EOQ;
    bits.push(
      `La cantidad económica de pedido es Q* = ${Number(q).toLocaleString("es-MX", { maximumFractionDigits: 2 })}.`
    );
  }
  const table = (name: string) => result.tables?.find((t) => t.name === name);
  if (metrics.path_length != null && Number.isFinite(Number(metrics.path_length))) {
    const route = table("ruta")?.rows.map((r) => String(r[1])).join(" → ");
    bits.push(
      `${route ? `La ruta más corta es ${route} y` : "La ruta más corta"} tiene longitud ${fmtNum(metrics.path_length)}.`
    );
  }
  if (metrics.mst_weight != null && Number.isFinite(Number(metrics.mst_weight))) {
    const n = table("aristas_mst")?.rows.length;
    bits.push(
      `El árbol de expansión mínima${n ? ` usa ${n} aristas y` : ""} pesa ${fmtNum(metrics.mst_weight)}: es la forma más barata de conectar todos los nodos sin ciclos.`
    );
  }
  if (metrics.max_flow != null && Number.isFinite(Number(metrics.max_flow))) {
    bits.push(`El flujo máximo del origen al destino es ${fmtNum(metrics.max_flow)}.`);
  }
  if (metrics.min_cut_value != null && Number.isFinite(Number(metrics.min_cut_value))) {
    const cut = table("min_cut")?.rows.map((r) => `${r[0]} → ${r[1]}`).join(", ");
    bits.push(
      `El corte mínimo vale ${fmtNum(metrics.min_cut_value)} (teorema max-flow min-cut)${cut ? `: los arcos que lo forman, ${cut}, son el cuello de botella; aumentar su capacidad es la única forma de enviar más` : ""}.`
    );
  }
  if (metrics.tour_length != null && Number.isFinite(Number(metrics.tour_length))) {
    const route = table("recorrido")?.rows.map((r) => String(r[1])).join(" → ");
    bits.push(`El recorrido del viajante${route ? ` es ${route} y` : ""} tiene longitud ${fmtNum(metrics.tour_length)}.`);
  }
  if (result.module === "networks" && metrics.total_cost != null && Number.isFinite(Number(metrics.total_cost))) {
    bits.push(
      `El costo total del transbordo es ${Number(metrics.total_cost).toLocaleString("es-MX", { maximumFractionDigits: 4 })}.`
    );
  }

  if (result.module === "decision_analysis") {
    const fmt = (n: unknown) =>
      Number(n).toLocaleString("es-MX", { maximumFractionDigits: 4 });
    if (metrics.EV != null) {
      bits.push(
        `El valor esperado (VE) de la mejor alternativa es ${fmt(metrics.EV)}.`
      );
    }
    if (metrics.EVPI != null) {
      bits.push(
        `El valor de la información perfecta (VIP) es ${fmt(metrics.EVPI)}: es el máximo que conviene pagar por conocer el estado real con certeza.`
      );
    }
    if (metrics.EVwPI != null) {
      bits.push(
        `Con información perfecta, el valor esperado sería ${fmt(metrics.EVwPI)} (VEIP).`
      );
    }
    if (metrics.EVSI != null) {
      bits.push(
        `El valor de la información muestral (VIM) es ${fmt(metrics.EVSI)}: beneficio esperado de observar la señal antes de decidir.`
      );
    }
    if (metrics.EVwSI != null) {
      bits.push(
        `Con información muestral, el valor esperado es ${fmt(metrics.EVwSI)} (VEIM).`
      );
    }
    if (metrics.EOL != null) {
      bits.push(
        `El arrepentimiento esperado (EOL) de la mejor alternativa es ${fmt(metrics.EOL)}.`
      );
    }
    if (metrics.maximax_payoff != null) {
      bits.push(
        `Bajo el criterio máximax (optimista), el mejor pago posible es ${fmt(metrics.maximax_payoff)}.`
      );
    }
    if (metrics.maximin_payoff != null) {
      bits.push(
        `Bajo el criterio máximin (pesimista), el mejor de los peores casos es ${fmt(metrics.maximin_payoff)}.`
      );
    }
    if (metrics.hurwicz_payoff != null) {
      bits.push(
        `Bajo Hurwicz (α = ${fmt(metrics.hurwicz_alpha ?? 0.5)}), el pago ponderado es ${fmt(metrics.hurwicz_payoff)}.`
      );
    }
    if (metrics.laplace_payoff != null) {
      bits.push(
        `Bajo Laplace (estados equiprobables), el valor esperado es ${fmt(metrics.laplace_payoff)}.`
      );
    }
    if (metrics.EV_root != null) {
      bits.push(
        `El valor esperado en la raíz del árbol es ${fmt(metrics.EV_root)}.`
      );
    }
  }

  if (warnings.some((w) => /degener/i.test(w))) {
    bits.push(
      "Hay degeneración: una variable básica vale 0. La solución sigue siendo válida, pero los precios sombra pueden no ser únicos."
    );
  }
  if (warnings.some((w) => /múltipl|multiple|óptimos múltiples/i.test(w))) {
    bits.push(
      "Existen óptimos múltiples. Cualquier combinación de los vértices óptimos también es óptima."
    );
  }
  if (warnings.some((w) => /inestabl|rho\s*>=/i.test(w))) {
    bits.push(
      "El sistema de colas es inestable (ρ ≥ 1): la cola crece sin límite. Aumenta el número de servidores o reduce la tasa de llegada."
    );
  }

  if (result.graph?.kind === "lp3d") {
    const slice = (result.graph.subtitle ?? "").includes("Fijas en el óptimo");
    bits.push(
      slice
        ? "El gráfico es un corte tridimensional por el óptimo: se dibujan tres variables y las demás quedan fijas en su valor óptimo. Cada cara es una restricción. La tabla de vértices evalúa Z en cada esquina de ese corte."
        : "El gráfico muestra el poliedro factible en tres variables. Cada cara es una restricción y el plano de color es el nivel de Z en el óptimo. La tabla de vértices evalúa Z en cada esquina."
    );
  } else if (result.tables?.some((t) => t.name === "vertices_feasible")) {
    bits.push(
      "La tabla de vértices evalúa Z en cada esquina de la región factible (método gráfico: intersección de rectas). El óptimo es la fila marcada."
    );
  }

  if (!bits.length) {
    bits.push(
      "Revisa la pestaña Solución para ver variables y métricas. En Iteraciones puedes seguir el procedimiento paso a paso."
    );
  }
  return bits.join(" ");
}

export default function Explainer({ result }: Props) {
  return (
    <aside className="explainer">
      <h3>Qué significa</h3>
      <p>{explain(result)}</p>
    </aside>
  );
}
