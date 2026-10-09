import { SolverError } from "../../errors";
import type { IterationStep } from "../../schema";
import { ZERO, add, cell, cmp, fmtM, mnum, scale, sign, sub, type MNum } from "../lp/mnum";

/** Arco de una red de flujo de costo mínimo. `cap` null = sin límite. */
export type FlowArc = { from: string; to: string; cost: number; cap: number | null; label?: string };

export type NetworkSimplexResult = {
  status: "optimal" | "infeasible" | "unbounded";
  flows: number[];
  cost: number;
  potentials: Record<string, number>;
  reduced: number[];
  iterations: IterationStep[];
  /** Estado de los arcos reales al inicio de cada iteración (alineado con `iterations`). */
  frames: SimplexFrame[];
  warnings: string[];
};

export type SimplexFrame = { flow: number[]; tree: boolean[]; enter: number; leave: number };

const ROOT = "__raiz";
const EPS = 1e-9;

type Arc = { from: string; to: string; cost: MNum; cap: number; artificial: boolean; label: string };

function fmt(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "-∞";
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return String(Number(n.toFixed(4)));
}

function clean(n: number): number {
  if (Math.abs(n) < 1e-10) return 0;
  const r = Math.round(n);
  return Math.abs(n - r) < 1e-9 * Math.max(1, Math.abs(n)) ? r : n;
}

/**
 * Método simplex de redes con cotas superiores (Hillier, cap. 10).
 * Arranca con un árbol de arcos artificiales hacia un nodo raíz con costo M grande; si al
 * final algún artificial lleva flujo, el problema no es factible.
 */
export function networkSimplex(
  nodes: string[],
  arcsIn: FlowArc[],
  supply: Record<string, number>,
  record: boolean,
): NetworkSimplexResult {
  const arcs: Arc[] = arcsIn.map((a) => ({
    from: a.from,
    to: a.to,
    cost: mnum(a.cost),
    cap: a.cap == null ? Number.POSITIVE_INFINITY : a.cap,
    artificial: false,
    label: a.label ?? `${a.from}→${a.to}`,
  }));
  const flow: number[] = arcs.map(() => 0);
  const inTree: boolean[] = arcs.map(() => false);
  for (const n of nodes) {
    const b = supply[n] ?? 0;
    const out = b >= 0;
    arcs.push({
      from: out ? n : ROOT,
      to: out ? ROOT : n,
      cost: mnum(0, 1),
      cap: Number.POSITIVE_INFINITY,
      artificial: true,
      label: out ? `${n}→R (artificial)` : `R→${n} (artificial)`,
    });
    flow.push(Math.abs(b));
    inTree.push(true);
  }
  const allNodes = [...nodes, ROOT];
  const iterations: IterationStep[] = [];
  const frames: SimplexFrame[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let bland = false;
  let potentials: Record<string, MNum> = {};
  let reduced: MNum[] = [];
  const limit = Math.max(200, 20 * arcs.length);

  const treeKey = () => inTree.map((t, i) => (t ? i : -1)).filter((i) => i >= 0).join(",");

  for (let it = 0; it <= limit; it++) {
    // Potenciales: pi_R = 0 y c_ij - pi_i + pi_j = 0 en los arcos del árbol.
    potentials = { [ROOT]: ZERO };
    const adj = new Map<string, number[]>();
    for (const n of allNodes) adj.set(n, []);
    arcs.forEach((a, i) => {
      if (!inTree[i]) return;
      adj.get(a.from)!.push(i);
      adj.get(a.to)!.push(i);
    });
    const parentArc: Record<string, number> = {};
    const depth: Record<string, number> = { [ROOT]: 0 };
    const queue = [ROOT];
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      for (const i of adj.get(u)!) {
        const a = arcs[i];
        const v = a.from === u ? a.to : a.from;
        if (v in potentials) continue;
        potentials[v] = a.from === u ? sub(potentials[u], a.cost) : add(potentials[u], a.cost);
        parentArc[v] = i;
        depth[v] = depth[u] + 1;
        queue.push(v);
      }
    }
    if (queue.length !== allNodes.length) throw new SolverError("El árbol del simplex de redes quedó desconectado.");
    reduced = arcs.map((a) => add(sub(a.cost, potentials[a.from]), potentials[a.to]));

    // Variable que entra.
    let enter = -1;
    let best: MNum = ZERO;
    arcs.forEach((a, i) => {
      if (inTree[i]) return;
      const atLower = flow[i] <= EPS;
      const atUpper = flow[i] >= a.cap - EPS;
      let gain: MNum = ZERO;
      if (atLower && sign(reduced[i]) < 0) gain = scale(reduced[i], -1);
      else if (atUpper && sign(reduced[i]) > 0) gain = reduced[i];
      if (sign(gain) <= 0) return;
      if (bland) {
        if (enter < 0) enter = i;
      } else if (cmp(gain, best) > 0) {
        best = gain;
        enter = i;
      }
    });

    const rowsOf = (): (string | number)[][] =>
      arcs
        .map((a, i) => ({ a, i }))
        .filter(({ a, i }) => !a.artificial || inTree[i] || flow[i] > EPS)
        .map(({ a, i }) => [
          a.label,
          cell(a.cost),
          Number.isFinite(a.cap) ? a.cap : "∞",
          clean(flow[i]),
          inTree[i] ? "sí" : "no",
          inTree[i] ? 0 : cell(reduced[i]),
        ]);
    const header = ["Arco", "Costo", "Capacidad", "Flujo", "En el árbol", "Costo reducido"];
    const potText = nodes.map((n) => `${n}: ${fmtM(potentials[n])}`).join(", ");

    const frame = (enterIdx: number, leaveIdx: number): SimplexFrame => ({
      flow: flow.slice(0, arcsIn.length).map(clean),
      tree: inTree.slice(0, arcsIn.length),
      enter: enterIdx >= 0 && enterIdx < arcsIn.length ? enterIdx : -1,
      leave: leaveIdx >= 0 && leaveIdx < arcsIn.length ? leaveIdx : -1,
    });
    if (enter < 0) {
      if (record) {
        frames.push(frame(-1, -1));
        iterations.push({
          index: iterations.length,
          method: "network_simplex",
          title: `Iteración ${it}: ningún arco mejora el costo — solución óptima`,
          tableau: [header, ...rowsOf()],
          meta: {
            potenciales: potText,
            regla:
              "Óptimo: todo arco fuera del árbol en su cota inferior tiene costo reducido ≥ 0 y todo arco en su cota superior ≤ 0.",
          },
        });
      }
      break;
    }

    // Ciclo: se empuja flujo por el arco que entra y se regresa por el camino del árbol.
    const ea = arcs[enter];
    const increase = flow[enter] <= EPS;
    const s = increase ? ea.from : ea.to; // el flujo "virtual" va s -> t por el arco que entra
    const t = increase ? ea.to : ea.from;
    // Camino en el árbol de t a s.
    const pathFromT: { arc: number; forward: boolean }[] = [];
    const pathFromS: { arc: number; forward: boolean }[] = [];
    let x = t;
    let y = s;
    while (x !== y) {
      if (depth[x] >= depth[y]) {
        const i = parentArc[x];
        const a = arcs[i];
        // Recorremos de x hacia su padre: hacia adelante si el arco apunta x -> padre.
        pathFromT.push({ arc: i, forward: a.from === x });
        x = a.from === x ? a.to : a.from;
      } else {
        const i = parentArc[y];
        const a = arcs[i];
        // Este tramo se recorre desde el padre hacia y.
        pathFromS.push({ arc: i, forward: a.to === y });
        y = a.from === y ? a.to : a.from;
      }
    }
    const cycle = [{ arc: enter, forward: increase }, ...pathFromT, ...pathFromS.reverse()];
    let theta = Number.POSITIVE_INFINITY;
    let leave = -1;
    for (const step of cycle) {
      const a = arcs[step.arc];
      const room = step.forward ? a.cap - flow[step.arc] : flow[step.arc];
      if (room < theta - EPS || (bland && Math.abs(room - theta) <= EPS && leave >= 0 && step.arc < leave)) {
        theta = room;
        leave = step.arc;
      }
    }
    if (!Number.isFinite(theta)) {
      return {
        status: "unbounded",
        flows: flow.slice(0, arcsIn.length),
        cost: Number.NEGATIVE_INFINITY,
        potentials: numeric(potentials),
        reduced: reduced.slice(0, arcsIn.length).map((r) => r.a),
        iterations,
        frames,
        warnings: [
          `Hay un ciclo de costo negativo sin límite de capacidad (entra ${ea.label}): el costo puede bajar indefinidamente.`,
        ],
      };
    }
    theta = clean(theta);
    const cycleText = cycle
      .map((c) => `${arcs[c.arc].label}${c.forward ? " (+)" : " (−)"}`)
      .join(", ");
    if (record) {
      frames.push(frame(enter, leave));
      iterations.push({
        index: iterations.length,
        method: "network_simplex",
        title: `Iteración ${it}: entra ${ea.label}, sale ${arcs[leave].label}, θ = ${fmt(theta)}`,
        tableau: [header, ...rowsOf()],
        meta: {
          enter: ea.label,
          leave: arcs[leave].label,
          costo_reducido: cell(reduced[enter]),
          ciclo: cycleText,
          theta,
          potenciales: potText,
          regla: increase
            ? `${ea.label} está en 0 y su costo reducido es ${fmtM(reduced[enter])} < 0: aumentar su flujo baja el costo.`
            : `${ea.label} está en su capacidad y su costo reducido es ${fmtM(reduced[enter])} > 0: bajar su flujo baja el costo.`,
        },
      });
    }
    for (const step of cycle) flow[step.arc] = clean(flow[step.arc] + (step.forward ? theta : -theta));
    if (leave !== enter) {
      inTree[leave] = false;
      inTree[enter] = true;
    }
    const key = treeKey() + "|" + flow.map((f) => f.toFixed(6)).join(",");
    if (seen.has(key) && !bland) {
      bland = true;
      warnings.push("Ciclaje por degeneración: se aplicó la regla de Bland para terminar.");
    }
    seen.add(key);
    if (it === limit) throw new SolverError("El simplex de redes no terminó en el límite de iteraciones.");
  }

  const artificialFlow = arcs.reduce((s, a, i) => s + (a.artificial ? flow[i] : 0), 0);
  const realFlows = flow.slice(0, arcsIn.length);
  const cost = clean(arcsIn.reduce((s, a, i) => s + a.cost * realFlows[i], 0));
  if (artificialFlow > 1e-7) {
    const stuck = arcs
      .map((a, i) => ({ a, i }))
      .filter(({ a, i }) => a.artificial && flow[i] > 1e-7)
      .map(({ a }) => a.label.replace(/ \(artificial\)$/, "").replace(/→R|R→/g, ""));
    return {
      status: "infeasible",
      flows: realFlows,
      cost,
      potentials: numeric(potentials),
      reduced: reduced.slice(0, arcsIn.length).map((r) => r.a),
      iterations,
      frames,
      warnings: [
        `No hay forma de cumplir todas las ofertas y demandas con estos arcos y capacidades (quedan sin atender: ${stuck.join(", ")}).`,
      ],
    };
  }
  return {
    status: "optimal",
    flows: realFlows,
    cost,
    potentials: numeric(potentials),
    reduced: reduced.slice(0, arcsIn.length).map((r) => r.a),
    iterations,
    frames,
    warnings,
  };
}

function numeric(p: Record<string, MNum>): Record<string, number> {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.a]));
}
