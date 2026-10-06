import { parseDecimalDraft } from "../components/FormFields";

export const CHAIN_MAX_STATES = 20;
export const MDP_MAX_STATES = 8;
export const MDP_MAX_ACTIONS = 6;
export const HORIZON_MAX = 200;

export type MarkovMode = "chain" | "mdp";
export type ExampleId = "oz" | "ruin" | "maintenance";
export type Sense = "min" | "max";
export type Criterion = "average" | "discounted";

export type ExampleInfo = { id: ExampleId; label: string; text: string };

export const EXAMPLES: ExampleInfo[] = [
  {
    id: "oz",
    label: "Tierra de Oz",
    text: "El clima de Oz (Kemeny y Snell): una sola clase recurrente y una distribución de largo plazo.",
  },
  {
    id: "ruin",
    label: "Ruina del jugador",
    text: "Capital de 0 a 4, con probabilidad 1/2 de subir o bajar. 0 y 4 son absorbentes.",
  },
  {
    id: "maintenance",
    label: "Mantenimiento",
    text: "Máquina buena o mala. Conviene seguir si está bien y reemplazarla si está mal.",
  },
];

export type ActionDraft = {
  name: string;
  cost: string;
  transitions: string[];
};

export type ChainDraft = {
  states: string[];
  transition: string[][];
  initial: string[];
  steps: string;
  nPower: string;
  useRewards: boolean;
  rewards: string[];
};

export type MdpDraft = {
  states: string[];
  sense: Sense;
  criterion: Criterion;
  discount: string;
  actions: ActionDraft[][];
};

export type MarkovForm = {
  example: ExampleId;
  mode: MarkovMode;
  chain: ChainDraft;
  mdp: MdpDraft;
};

export type ChainBody = {
  mode: "chain";
  states: string[];
  transition: number[][];
  initial?: number[];
  steps: number;
  n_power?: number;
  rewards?: number[];
};

export type MdpBody = {
  mode: "mdp";
  states: string[];
  sense: Sense;
  criterion: Criterion;
  discount?: number;
  decisions: { state: string; action: string; cost: number; transitions: number[] }[];
  /**
   * El panel JSON del módulo exige `transition` y `steps`.
   * Con mode "mdp" el solver no los usa: son la primera acción de cada estado,
   * para poder volver a cargar el mismo JSON.
   */
  transition: number[][];
  steps: number;
};

export type MarkovReport = {
  errors: Record<string, string>;
  body: ChainBody | MdpBody | null;
};

function draft(value: number): string {
  if (!Number.isFinite(value)) return "";
  const text = value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 12 });
  return text === "-0" ? "0" : text;
}

function ozDraft(): ChainDraft {
  return {
    states: ["Rainy", "Nice", "Snowy"],
    transition: [
      ["0.5", "0.25", "0.25"],
      ["0.5", "0", "0.5"],
      ["0.25", "0.25", "0.5"],
    ],
    initial: ["1", "0", "0"],
    steps: "10",
    nPower: "10",
    useRewards: false,
    rewards: ["0", "0", "0"],
  };
}

function ruinDraft(): ChainDraft {
  return {
    states: ["0", "1", "2", "3", "4"],
    transition: [
      ["1", "0", "0", "0", "0"],
      ["0.5", "0", "0.5", "0", "0"],
      ["0", "0.5", "0", "0.5", "0"],
      ["0", "0", "0.5", "0", "0.5"],
      ["0", "0", "0", "0", "1"],
    ],
    initial: ["0", "0", "1", "0", "0"],
    steps: "10",
    nPower: "10",
    useRewards: false,
    rewards: ["0", "0", "0", "0", "0"],
  };
}

function maintenanceDraft(): MdpDraft {
  return {
    states: ["Bueno", "Malo"],
    sense: "min",
    criterion: "average",
    discount: "0.9",
    actions: [
      [
        { name: "seguir", cost: "1", transitions: ["0.8", "0.2"] },
        { name: "reemplazar", cost: "5", transitions: ["1", "0"] },
      ],
      [
        { name: "seguir", cost: "4", transitions: ["0.1", "0.9"] },
        { name: "reemplazar", cost: "5", transitions: ["1", "0"] },
      ],
    ],
  };
}

export function blankMarkovForm(): MarkovForm {
  return { example: "oz", mode: "chain", chain: ozDraft(), mdp: maintenanceDraft() };
}

export function loadExample(current: MarkovForm, id: ExampleId): MarkovForm {
  if (id === "maintenance") return { ...current, example: id, mode: "mdp", mdp: maintenanceDraft() };
  if (id === "ruin") return { ...current, example: id, mode: "chain", chain: ruinDraft() };
  return { ...current, example: "oz", mode: "chain", chain: ozDraft() };
}

function nextName(existing: string[], prefix: string): string {
  for (let n = 1; n < existing.length + 40; n++) {
    const candidate = `${prefix}${n}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${prefix}${existing.length + 1}`;
}

type Parsed = { value: number | null; empty: boolean; invalid: boolean };

function parseCell(text: string): Parsed {
  const t = text.trim();
  if (!t) return { value: null, empty: true, invalid: false };
  const parsed = parseDecimalDraft(t);
  if (parsed.invalid || parsed.partial || parsed.value == null) return { value: null, empty: false, invalid: true };
  return { value: parsed.value, empty: false, invalid: false };
}

function loose(text: string): number | null {
  const parsed = parseCell(text);
  return parsed.value;
}

export function addChainState(form: MarkovForm): MarkovForm {
  const chain = form.chain;
  if (chain.states.length >= CHAIN_MAX_STATES) return form;
  const n = chain.states.length;
  const row = Array(n + 1).fill("0");
  row[n] = "1";
  return {
    ...form,
    chain: {
      ...chain,
      states: [...chain.states, nextName(chain.states, "E")],
      transition: [...chain.transition.map((line) => [...line, "0"]), row],
      initial: [...chain.initial, "0"],
      rewards: [...chain.rewards, "0"],
    },
  };
}

export function removeChainState(form: MarkovForm, index: number): MarkovForm {
  const chain = form.chain;
  if (chain.states.length <= 2 || index < 0 || index >= chain.states.length) return form;
  // La probabilidad que salía hacia el estado borrado se queda en el mismo estado,
  // para que la fila siga sumando 1.
  const transition = chain.transition
    .filter((_, i) => i !== index)
    .map((row, newI) => {
      const removed = loose(row[index]) ?? 0;
      const next = row.filter((_, j) => j !== index);
      const current = loose(next[newI]);
      if (current != null) next[newI] = draft(current + removed);
      else if (removed !== 0) next[newI] = draft(removed);
      return next;
    });
  return {
    ...form,
    chain: {
      ...chain,
      states: chain.states.filter((_, i) => i !== index),
      transition,
      initial: chain.initial.filter((_, i) => i !== index),
      rewards: chain.rewards.filter((_, i) => i !== index),
    },
  };
}

export function addMdpState(form: MarkovForm): MarkovForm {
  const mdp = form.mdp;
  if (mdp.states.length >= MDP_MAX_STATES) return form;
  const n = mdp.states.length;
  const self = Array(n + 1).fill("0");
  self[n] = "1";
  return {
    ...form,
    mdp: {
      ...mdp,
      states: [...mdp.states, nextName(mdp.states, "E")],
      actions: [
        ...mdp.actions.map((list) => list.map((action) => ({ ...action, transitions: [...action.transitions, "0"] }))),
        [{ name: "seguir", cost: "0", transitions: self }],
      ],
    },
  };
}

export function removeMdpState(form: MarkovForm, index: number): MarkovForm {
  const mdp = form.mdp;
  if (mdp.states.length <= 2 || index < 0 || index >= mdp.states.length) return form;
  const actions = mdp.actions
    .filter((_, i) => i !== index)
    .map((list, newI) =>
      list.map((action) => {
        const removed = loose(action.transitions[index]) ?? 0;
        const transitions = action.transitions.filter((_, j) => j !== index);
        const current = loose(transitions[newI]);
        if (current != null) transitions[newI] = draft(current + removed);
        return { ...action, transitions };
      }),
    );
  return {
    ...form,
    mdp: { ...mdp, states: mdp.states.filter((_, i) => i !== index), actions },
  };
}

export function addAction(form: MarkovForm, stateIndex: number): MarkovForm {
  const mdp = form.mdp;
  const list = mdp.actions[stateIndex];
  if (!list || list.length >= MDP_MAX_ACTIONS) return form;
  const transitions = mdp.states.map((_, j) => (j === stateIndex ? "1" : "0"));
  const actions = mdp.actions.map((row, i) =>
        i === stateIndex ? [...row, { name: nextName(row.map((a) => a.name), "opción "), cost: "0", transitions }] : row,
  );
  return { ...form, mdp: { ...mdp, actions } };
}

export function removeAction(form: MarkovForm, stateIndex: number, actionIndex: number): MarkovForm {
  const list = form.mdp.actions[stateIndex];
  if (!list || list.length <= 1) return form;
  const actions = form.mdp.actions.map((row, i) => (i === stateIndex ? row.filter((_, j) => j !== actionIndex) : row));
  return { ...form, mdp: { ...form.mdp, actions } };
}

function readNames(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const names = raw.map((item) => {
    if (typeof item === "number" && Number.isFinite(item)) return String(item);
    if (typeof item === "string") return item.trim();
    return "";
  });
  if (names.length < 2 || names.some((name) => !name)) return null;
  return names;
}

function readMatrix(raw: unknown, n: number): string[][] {
  const rows = Array.isArray(raw) ? raw : [];
  return Array.from({ length: n }, (_, i) => {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    return Array.from({ length: n }, (_, j) => {
      const value = row[j];
      if (typeof value === "number" && Number.isFinite(value)) return draft(value);
      if (typeof value === "string") return value;
      return "";
    });
  });
}

function readVector(raw: unknown, n: number, empty: string): string[] {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: n }, (_, i) => {
    const value = list[i];
    if (typeof value === "number" && Number.isFinite(value)) return draft(value);
    if (typeof value === "string") return value;
    return empty;
  });
}

function asObject(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const nested = record.request;
  if (nested && typeof nested === "object" && !Array.isArray(nested) && !("states" in record) && "states" in nested) {
    return nested as Record<string, unknown>;
  }
  return record;
}

export function formFromBody(body: unknown, current: MarkovForm): MarkovForm {
  const record = asObject(body);
  if (!record) return current;
  const names = readNames(record.states);
  if (!names) return current;
  const wantsMdp =
    record.mode === "mdp" || (record.mode !== "chain" && Array.isArray(record.decisions) && !Array.isArray(record.transition));
  if (wantsMdp) {
    const grouped: ActionDraft[][] = names.map(() => []);
    const byName = new Map(names.map((name, i) => [name, i]));
    if (Array.isArray(record.decisions)) {
      for (const item of record.decisions) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const decision = item as Record<string, unknown>;
        const state = typeof decision.state === "string" ? decision.state.trim() : "";
        const index = byName.get(state);
        if (index == null) continue;
        const action = typeof decision.action === "string" ? decision.action : "";
        const cost = typeof decision.cost === "number" ? draft(decision.cost) : typeof decision.cost === "string" ? decision.cost : "";
        grouped[index].push({
          name: action,
          cost,
          transitions: readVector(decision.transitions, names.length, ""),
        });
      }
    }
    grouped.forEach((list, i) => {
      if (list.length === 0) {
        const transitions = names.map((_, j) => (j === i ? "1" : "0"));
        list.push({ name: "seguir", cost: "0", transitions });
      }
    });
    const sense = record.sense === "max" ? "max" : "min";
    const criterion = record.criterion === "discounted" ? "discounted" : "average";
    const discount =
      typeof record.discount === "number" ? draft(record.discount) : typeof record.discount === "string" ? record.discount : current.mdp.discount;
    return {
      ...current,
      mode: "mdp",
      example: "maintenance",
      mdp: { states: names, sense, criterion, discount, actions: grouped },
    };
  }
  const steps = typeof record.steps === "number" ? String(record.steps) : typeof record.steps === "string" ? record.steps : "10";
  const nPower =
    typeof record.n_power === "number" ? String(record.n_power) : typeof record.n_power === "string" ? record.n_power : steps;
  const rewards = Array.isArray(record.rewards) ? readVector(record.rewards, names.length, "0") : names.map(() => "0");
  return {
    ...current,
    mode: "chain",
    chain: {
      states: names,
      transition: readMatrix(record.transition, names.length),
      initial: Array.isArray(record.initial) ? readVector(record.initial, names.length, "") : names.map(() => ""),
      steps,
      nPower,
      useRewards: Array.isArray(record.rewards),
      rewards,
    },
  };
}

function integerIn(text: string, min: number, max: number): { value: number | null; error?: string } {
  const parsed = parseCell(text);
  if (parsed.empty) return { value: null, error: `Escribe un entero entre ${min} y ${max}.` };
  if (parsed.invalid || parsed.value == null || !Number.isInteger(parsed.value) || parsed.value < min || parsed.value > max) {
    return { value: null, error: `Debe ser un entero entre ${min} y ${max}.` };
  }
  return { value: parsed.value };
}

function validateNames(names: string[], max: number, errors: Record<string, string>, prefix: string) {
  if (names.length < 2) errors[prefix] = "Hacen falta al menos 2 estados.";
  if (names.length > max) errors[prefix] = `El máximo es ${max} estados.`;
  const seen = new Set<string>();
  names.forEach((name, i) => {
    const trimmed = name.trim();
    if (!trimmed) errors[`${prefix}-${i}`] = "Escribe un nombre para este estado.";
    else if (seen.has(trimmed)) errors[`${prefix}-${i}`] = `«${trimmed}» está repetido. Usa otro nombre.`;
    else seen.add(trimmed);
  });
}

function validateRow(
  row: string[],
  errors: Record<string, string>,
  key: (j: number) => string,
  rowKey: string,
  who: string,
): number[] | null {
  const values: number[] = [];
  let bad = false;
  row.forEach((cell, j) => {
    const parsed = parseCell(cell);
    if (parsed.empty) {
      errors[key(j)] = "Escribe la probabilidad.";
      bad = true;
      return;
    }
    if (parsed.invalid || parsed.value == null) {
      errors[key(j)] = "Ese valor no es un número. Usa 0.25 o 0,25.";
      bad = true;
      return;
    }
    if (parsed.value < -1e-9) {
      errors[key(j)] = "La probabilidad no puede ser negativa.";
      bad = true;
      return;
    }
    values.push(parsed.value < 0 ? 0 : parsed.value);
  });
  if (bad) {
    errors[rowKey] = `${who} tiene celdas vacías o que no son números.`;
    return null;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  if (Math.abs(sum - 1) > 1e-6) {
    errors[rowKey] = `${who}: la suma es ${fmtNum(sum)} y debe ser 1.`;
    return null;
  }
  return values;
}

export function fmtNum(value: number | null | undefined, digits = 4): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "-∞";
  return value.toLocaleString("es-MX", { maximumFractionDigits: digits });
}

/** Suma de una fila de textos. null si falta algún número. */
export function rowSum(row: string[]): number | null {
  let sum = 0;
  for (const cell of row) {
    const parsed = parseCell(cell);
    if (parsed.empty || parsed.invalid || parsed.value == null) return null;
    sum += parsed.value;
  }
  return sum;
}

export function sumIsOne(sum: number | null): boolean {
  return sum != null && Math.abs(sum - 1) <= 1e-6;
}

function validateChain(chain: ChainDraft): MarkovReport {
  const errors: Record<string, string> = {};
  validateNames(chain.states, CHAIN_MAX_STATES, errors, "state");
  const n = chain.states.length;
  const matrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = chain.transition[i] ?? [];
    if (row.length !== n) {
      errors[`row-${i}`] = "Esta fila no tiene una probabilidad por estado.";
      continue;
    }
    const values = validateRow(row, errors, (j) => `p-${i}-${j}`, `row-${i}`, `La fila de «${chain.states[i].trim() || "este estado"}»`);
    if (values) matrix.push(values);
  }
  const initialValues: number[] = [];
  const initialEmpty = chain.initial.length === n && chain.initial.every((cell) => parseCell(cell).empty);
  if (!initialEmpty) {
    if (chain.initial.length !== n) errors.initial = "La distribución inicial debe tener un número por estado.";
    let sum = 0;
    let ok = chain.initial.length === n;
    chain.initial.forEach((cell, i) => {
      const parsed = parseCell(cell);
      if (parsed.empty) {
        errors[`initial-${i}`] = "Escribe esta probabilidad o deja toda la fila vacía para usar la uniforme.";
        ok = false;
        return;
      }
      if (parsed.invalid || parsed.value == null) {
        errors[`initial-${i}`] = "Ese valor no es un número.";
        ok = false;
        return;
      }
      if (parsed.value < -1e-9) {
        errors[`initial-${i}`] = "No puede ser negativa.";
        ok = false;
        return;
      }
      const value = parsed.value < 0 ? 0 : parsed.value;
      initialValues.push(value);
      sum += value;
    });
    if (ok && !(sum > 1e-12)) errors.initial = "La distribución inicial suma 0. Escribe probabilidades o déjala vacía.";
  }
  const steps = integerIn(chain.steps, 1, HORIZON_MAX);
  if (steps.error) errors.steps = `Los pasos: ${steps.error.charAt(0).toLowerCase()}${steps.error.slice(1)}`;
  let nPower: number | undefined;
  if (chain.nPower.trim()) {
    const power = integerIn(chain.nPower, 1, HORIZON_MAX);
    if (power.error) errors.nPower = `La potencia n: ${power.error.charAt(0).toLowerCase()}${power.error.slice(1)}`;
    else nPower = power.value ?? undefined;
  }
  const rewardValues: number[] = [];
  if (chain.useRewards) {
    chain.rewards.forEach((cell, i) => {
      const parsed = parseCell(cell);
      if (parsed.empty || parsed.invalid || parsed.value == null) {
        errors[`reward-${i}`] = "Escribe la recompensa de este estado (puede ser negativa).";
      } else rewardValues.push(parsed.value);
    });
  }
  if (Object.keys(errors).length || matrix.length !== n || steps.value == null) {
    return { errors, body: null };
  }
  const states = chain.states.map((name) => name.trim());
  const body: ChainBody = { mode: "chain", states, transition: matrix, steps: steps.value };
  if (!initialEmpty) body.initial = initialValues;
  if (nPower != null) body.n_power = nPower;
  if (chain.useRewards && rewardValues.length === n) body.rewards = rewardValues;
  return { errors, body };
}

function validateMdp(mdp: MdpDraft): MarkovReport {
  const errors: Record<string, string> = {};
  validateNames(mdp.states, MDP_MAX_STATES, errors, "mstate");
  const n = mdp.states.length;
  const decisions: MdpBody["decisions"] = [];
  const firstRows: number[][] = [];
  mdp.states.forEach((state, i) => {
    const list = mdp.actions[i] ?? [];
    if (list.length === 0) errors[`mactions-${i}`] = `«${state.trim() || "Este estado"}» necesita al menos una acción.`;
    if (list.length > MDP_MAX_ACTIONS) errors[`mactions-${i}`] = `El máximo es ${MDP_MAX_ACTIONS} acciones por estado.`;
    const seen = new Set<string>();
    list.forEach((action, k) => {
      const name = action.name.trim();
      if (!name) errors[`aname-${i}-${k}`] = "Escribe el nombre de la acción.";
      else if (seen.has(name)) errors[`aname-${i}-${k}`] = `«${name}» está repetida en este estado.`;
      else seen.add(name);
      const cost = parseCell(action.cost);
      if (cost.empty || cost.invalid || cost.value == null) {
        errors[`acost-${i}-${k}`] = mdp.sense === "max" ? "Escribe la recompensa de esta acción." : "Escribe el costo de esta acción.";
      }
      const probs = validateRow(
        action.transitions,
        errors,
        (j) => `ap-${i}-${k}-${j}`,
        `arow-${i}-${k}`,
        `Las probabilidades de «${name || "esta acción"}»`,
      );
      if (name && cost.value != null && probs && !errors[`aname-${i}-${k}`]) {
        decisions.push({ state: state.trim(), action: name, cost: cost.value, transitions: probs });
        if (k === 0) firstRows.push(probs);
      }
    });
  });
  let discount: number | undefined;
  if (mdp.criterion === "discounted") {
    const parsed = parseCell(mdp.discount);
    if (parsed.empty || parsed.invalid || parsed.value == null || !(parsed.value > 0) || !(parsed.value < 1)) {
      errors.discount = "γ debe ser mayor que 0 y menor que 1. Por ejemplo 0.9.";
    } else discount = parsed.value;
  }
  const expected = mdp.actions.reduce((sum, list) => sum + list.length, 0);
  if (Object.keys(errors).length || decisions.length !== expected || firstRows.length !== n) {
    return { errors, body: null };
  }
  const body: MdpBody = {
    mode: "mdp",
    states: mdp.states.map((name) => name.trim()),
    sense: mdp.sense,
    criterion: mdp.criterion,
    decisions,
    transition: firstRows,
    steps: 10,
  };
  if (discount != null) body.discount = discount;
  return { errors, body };
}

export function validateMarkovForm(form: MarkovForm): MarkovReport {
  return form.mode === "mdp" ? validateMdp(form.mdp) : validateChain(form.chain);
}
