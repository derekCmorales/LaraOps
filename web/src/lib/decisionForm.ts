import { parseDecimalDraft } from "../components/FormFields";

export const DECISION_LIMITS = { alternatives: 20, states: 12, signals: 12, nodes: 40 } as const;

export type DecisionMode = "payoff_table" | "utility" | "decision_tree" | "bayes";
export type Criterion =
  | "expected_value"
  | "maximax"
  | "maximin"
  | "minimax_regret"
  | "hurwicz"
  | "laplace"
  | "all";
export type UtilityKind = "linear" | "exponential" | "table";
export type NodeKind = "decision" | "chance" | "terminal";

export type TreeChildForm = { to: string; label: string; probability: string };
export type TreeNodeForm = { id: string; kind: NodeKind; value: string; children: TreeChildForm[] };

export type DecisionForm = {
  mode: DecisionMode;
  alternatives: string[];
  states: string[];
  payoff: string[][];
  useProbabilities: boolean;
  probabilities: string[];
  criterion: Criterion;
  hurwiczAlpha: string;
  utilityKind: UtilityKind;
  riskTolerance: string;
  utilities: string[][];
  rootId: string;
  tree: TreeNodeForm[];
  actions: string[];
  bayesStates: string[];
  prior: string[];
  bayesPayoff: string[][];
  signals: string[];
  likelihood: string[][];
  sampleCost: string;
};

export type DecisionReport = {
  errors: string[];
  hints: string[];
  body: Record<string, unknown> | null;
};

const CRITERIA: Criterion[] = [
  "expected_value",
  "maximax",
  "maximin",
  "minimax_regret",
  "hurwicz",
  "laplace",
  "all",
];

export function formatDraft(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("es-MX", { useGrouping: false, maximumFractionDigits: 12 });
}

function parseQty(raw: string): number | null {
  const parsed = parseDecimalDraft(raw.trim());
  if (parsed.invalid || parsed.value == null) return null;
  return parsed.value;
}

function fitNames(list: string[], count: number, make: (index: number) => string): string[] {
  const next = list.slice(0, count);
  while (next.length < count) next.push(make(next.length));
  return next;
}

function fitMatrix(matrix: string[][], rows: number, cols: number): string[][] {
  const next = matrix.slice(0, rows).map((row) => {
    const copy = row.slice(0, cols);
    while (copy.length < cols) copy.push("");
    return copy;
  });
  while (next.length < rows) next.push(Array.from({ length: cols }, () => ""));
  return next;
}

function clampCount(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(max, Math.round(value)));
}

export function blankDecisionForm(): DecisionForm {
  return {
    mode: "payoff_table",
    alternatives: ["Alternativa 1", "Alternativa 2"],
    states: ["Estado 1", "Estado 2"],
    payoff: [
      ["", ""],
      ["", ""],
    ],
    useProbabilities: true,
    probabilities: ["0.5", "0.5"],
    criterion: "all",
    hurwiczAlpha: "0.5",
    utilityKind: "exponential",
    riskTolerance: "50",
    utilities: [
      ["", ""],
      ["", ""],
    ],
    rootId: "D1",
    tree: [
      {
        id: "D1",
        kind: "decision",
        value: "",
        children: [
          { to: "T1", label: "Elegir", probability: "" },
          { to: "T2", label: "No hacer nada", probability: "" },
        ],
      },
      { id: "T1", kind: "terminal", value: "10", children: [] },
      { id: "T2", kind: "terminal", value: "0", children: [] },
    ],
    actions: ["Construir", "No construir"],
    bayesStates: ["Alta", "Baja"],
    prior: ["0.5", "0.5"],
    bayesPayoff: [
      ["", ""],
      ["", ""],
    ],
    signals: ["Favorable", "Desfavorable"],
    likelihood: [
      ["0.5", "0.5"],
      ["0.5", "0.5"],
    ],
    sampleCost: "0",
  };
}

export function exampleDecision(kind: "payoff" | "utility" | "tree" | "bayes"): DecisionForm {
  const base = blankDecisionForm();
  if (kind === "payoff") {
    return {
      ...base,
      mode: "payoff_table",
      alternatives: ["A", "B", "C"],
      states: ["s1", "s2", "s3"],
      payoff: [
        ["10", "5", "2"],
        ["8", "7", "6"],
        ["4", "9", "12"],
      ],
      useProbabilities: true,
      probabilities: ["0.3", "0.5", "0.2"],
      criterion: "all",
      hurwiczAlpha: "0.5",
      utilities: [
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
      ],
    };
  }
  if (kind === "utility") {
    return {
      ...base,
      mode: "utility",
      alternatives: ["Arriesgada", "Segura"],
      states: ["bueno", "malo"],
      payoff: [
        ["100", "0"],
        ["40", "40"],
      ],
      useProbabilities: true,
      probabilities: ["0.5", "0.5"],
      criterion: "all",
      utilityKind: "exponential",
      riskTolerance: "50",
      utilities: [
        ["", ""],
        ["", ""],
      ],
    };
  }
  if (kind === "tree") {
    return {
      ...base,
      mode: "decision_tree",
      rootId: "d1",
      tree: [
        {
          id: "d1",
          kind: "decision",
          value: "",
          children: [
            { to: "c1", label: "invertir", probability: "" },
            { to: "t_none", label: "no hacer nada", probability: "" },
          ],
        },
        {
          id: "c1",
          kind: "chance",
          value: "",
          children: [
            { to: "t_good", label: "bueno", probability: "0.6" },
            { to: "t_bad", label: "malo", probability: "0.4" },
          ],
        },
        { id: "t_good", kind: "terminal", value: "100", children: [] },
        { id: "t_bad", kind: "terminal", value: "-20", children: [] },
        { id: "t_none", kind: "terminal", value: "0", children: [] },
      ],
    };
  }
  return {
    ...base,
    mode: "bayes",
    actions: ["Construir", "No construir"],
    bayesStates: ["Alta", "Baja"],
    prior: ["0.4", "0.6"],
    bayesPayoff: [
      ["100", "-40"],
      ["0", "0"],
    ],
    signals: ["Favorable", "Desfavorable"],
    likelihood: [
      ["0.7", "0.2"],
      ["0.3", "0.8"],
    ],
    sampleCost: "5",
  };
}

function numMatrix(value: unknown): string[][] | null {
  if (!Array.isArray(value)) return null;
  return value.map((row) =>
    Array.isArray(row)
      ? row.map((cell) => (typeof cell === "number" ? formatDraft(cell) : cell == null ? "" : String(cell)))
      : [],
  );
}

function numList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((cell) => (typeof cell === "number" ? formatDraft(cell) : cell == null ? "" : String(cell)));
}

function treeFrom(value: unknown): TreeNodeForm[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((raw, index) => {
    const node = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const kind: NodeKind = node.kind === "chance" || node.kind === "terminal" ? node.kind : "decision";
    const children = Array.isArray(node.children)
      ? node.children.map((child) => {
          const edge = child && typeof child === "object" ? (child as Record<string, unknown>) : {};
          const probability =
            edge.probability == null || edge.probability === ""
              ? ""
              : typeof edge.probability === "number"
                ? formatDraft(edge.probability)
                : String(edge.probability);
          return { to: String(edge.to ?? ""), label: edge.label == null ? "" : String(edge.label), probability };
        })
      : [];
    return {
      id: String(node.id ?? `n${index + 1}`),
      kind,
      value: node.value == null || node.value === "" ? "" : typeof node.value === "number" ? formatDraft(node.value) : String(node.value),
      children: kind === "terminal" ? [] : children,
    };
  });
}

export function formFromBody(body: unknown): DecisionForm {
  const form = blankDecisionForm();
  if (!body || typeof body !== "object" || Array.isArray(body)) return form;
  const o = body as Record<string, unknown>;
  if (o.mode === "payoff_table" || o.mode === "utility" || o.mode === "decision_tree" || o.mode === "bayes") {
    form.mode = o.mode;
  } else if (Array.isArray(o.tree)) form.mode = "decision_tree";
  else if (o.bayes && typeof o.bayes === "object") form.mode = "bayes";
  else if (o.utility) form.mode = "utility";

  if (Array.isArray(o.alternatives) && o.alternatives.length) {
    form.alternatives = o.alternatives.map((name, i) => String(name ?? "").trim() || `Alternativa ${i + 1}`);
  }
  if (Array.isArray(o.states) && o.states.length) {
    form.states = o.states.map((name, i) => String(name ?? "").trim() || `Estado ${i + 1}`);
  }
  const payoff = numMatrix(o.payoff);
  if (payoff) {
    form.payoff = fitMatrix(payoff, form.alternatives.length, form.states.length);
  } else {
    form.payoff = fitMatrix(form.payoff, form.alternatives.length, form.states.length);
  }
  if (Array.isArray(o.probabilities)) {
    form.useProbabilities = true;
    form.probabilities = fitNames(numList(o.probabilities) ?? [], form.states.length, () => "");
  } else if (!("probabilities" in o)) {
    form.useProbabilities = form.mode === "payoff_table" || form.mode === "utility" ? form.useProbabilities : false;
    if (form.mode === "payoff_table" || form.mode === "utility") form.useProbabilities = false;
    form.probabilities = fitNames(form.probabilities, form.states.length, () => "");
  }
  if (typeof o.criterion === "string" && (CRITERIA as string[]).includes(o.criterion)) {
    form.criterion = o.criterion as Criterion;
  }
  if (typeof o.hurwicz_alpha === "number") form.hurwiczAlpha = formatDraft(o.hurwicz_alpha);
  else if (typeof o.hurwicz_alpha === "string") form.hurwiczAlpha = o.hurwicz_alpha;

  if (o.utility && typeof o.utility === "object") {
    const utility = o.utility as Record<string, unknown>;
    if (form.mode === "payoff_table") form.mode = "utility";
    if (utility.kind === "linear" || utility.kind === "exponential" || utility.kind === "table") {
      form.utilityKind = utility.kind;
    }
    if (typeof utility.risk_tolerance === "number") form.riskTolerance = formatDraft(utility.risk_tolerance);
    else if (typeof utility.risk_tolerance === "string") form.riskTolerance = utility.risk_tolerance;
    const utilities = numMatrix(utility.utilities);
    if (utilities) form.utilities = fitMatrix(utilities, form.alternatives.length, form.states.length);
  }
  form.utilities = fitMatrix(form.utilities, form.alternatives.length, form.states.length);

  const tree = treeFrom(o.tree);
  if (tree && tree.length) {
    form.tree = tree;
    form.rootId = typeof o.root_id === "string" && o.root_id.trim() ? o.root_id.trim() : tree[0].id;
  }

  if (o.bayes && typeof o.bayes === "object") {
    const bayes = o.bayes as Record<string, unknown>;
    if (Array.isArray(bayes.actions) && bayes.actions.length) {
      form.actions = bayes.actions.map((name, i) => String(name ?? "").trim() || `Acción ${i + 1}`);
    }
    if (Array.isArray(bayes.states) && bayes.states.length) {
      form.bayesStates = bayes.states.map((name, i) => String(name ?? "").trim() || `Estado ${i + 1}`);
    }
    if (Array.isArray(bayes.signals) && bayes.signals.length) {
      form.signals = bayes.signals.map((name, i) => String(name ?? "").trim() || `Señal ${i + 1}`);
    }
    const prior = numList(bayes.prior);
    if (prior) form.prior = fitNames(prior, form.bayesStates.length, () => "");
    const bayesPayoff = numMatrix(bayes.payoff);
    if (bayesPayoff) form.bayesPayoff = fitMatrix(bayesPayoff, form.actions.length, form.bayesStates.length);
    const likelihood = numMatrix(bayes.likelihood);
    if (likelihood) form.likelihood = fitMatrix(likelihood, form.signals.length, form.bayesStates.length);
    const cost = bayes.sample_cost ?? o.sample_cost;
    if (typeof cost === "number") form.sampleCost = formatDraft(cost);
    else if (typeof cost === "string") form.sampleCost = cost;
  }
  form.prior = fitNames(form.prior, form.bayesStates.length, () => "");
  form.bayesPayoff = fitMatrix(form.bayesPayoff, form.actions.length, form.bayesStates.length);
  form.likelihood = fitMatrix(form.likelihood, form.signals.length, form.bayesStates.length);
  return form;
}

export function resizeAlternatives(form: DecisionForm, count: number): DecisionForm {
  const n = clampCount(count, DECISION_LIMITS.alternatives);
  return {
    ...form,
    alternatives: fitNames(form.alternatives, n, (i) => `Alternativa ${i + 1}`),
    payoff: fitMatrix(form.payoff, n, form.states.length),
    utilities: fitMatrix(form.utilities, n, form.states.length),
  };
}

export function resizeStates(form: DecisionForm, count: number): DecisionForm {
  const n = clampCount(count, DECISION_LIMITS.states);
  return {
    ...form,
    states: fitNames(form.states, n, (i) => `Estado ${i + 1}`),
    payoff: fitMatrix(form.payoff, form.alternatives.length, n),
    utilities: fitMatrix(form.utilities, form.alternatives.length, n),
    probabilities: fitNames(form.probabilities, n, () => ""),
  };
}

export function resizeActions(form: DecisionForm, count: number): DecisionForm {
  const n = clampCount(count, DECISION_LIMITS.alternatives);
  return {
    ...form,
    actions: fitNames(form.actions, n, (i) => `Acción ${i + 1}`),
    bayesPayoff: fitMatrix(form.bayesPayoff, n, form.bayesStates.length),
  };
}

export function resizeBayesStates(form: DecisionForm, count: number): DecisionForm {
  const n = clampCount(count, DECISION_LIMITS.states);
  return {
    ...form,
    bayesStates: fitNames(form.bayesStates, n, (i) => `Estado ${i + 1}`),
    prior: fitNames(form.prior, n, () => ""),
    bayesPayoff: fitMatrix(form.bayesPayoff, form.actions.length, n),
    likelihood: fitMatrix(form.likelihood, form.signals.length, n),
  };
}

export function resizeSignals(form: DecisionForm, count: number): DecisionForm {
  const n = clampCount(count, DECISION_LIMITS.signals);
  return {
    ...form,
    signals: fitNames(form.signals, n, (i) => `Señal ${i + 1}`),
    likelihood: fitMatrix(form.likelihood, n, form.bayesStates.length),
  };
}

function uniqueNodeId(tree: TreeNodeForm[]): string {
  const used = new Set(tree.map((node) => node.id));
  let n = tree.length + 1;
  while (used.has(`N${n}`)) n += 1;
  return `N${n}`;
}

export function addTreeNode(form: DecisionForm): DecisionForm {
  if (form.tree.length >= DECISION_LIMITS.nodes) return form;
  const id = uniqueNodeId(form.tree);
  return { ...form, tree: [...form.tree, { id, kind: "terminal", value: "0", children: [] }] };
}

export function removeTreeNode(form: DecisionForm, index: number): DecisionForm {
  if (form.tree.length <= 1) return form;
  const removed = form.tree[index]?.id;
  const tree = form.tree.filter((_, i) => i !== index);
  const rootId = form.rootId === removed ? tree[0]?.id ?? "" : form.rootId;
  return { ...form, tree, rootId };
}

export function renameTreeNode(form: DecisionForm, index: number, id: string): DecisionForm {
  const previous = form.tree[index]?.id ?? "";
  const occurrences = form.tree.filter((node) => node.id === previous).length;
  const retarget = (child: TreeChildForm) =>
    occurrences === 1 && previous && previous !== id && child.to === previous ? { ...child, to: id } : child;
  const tree = form.tree.map((node, i) => ({
    ...node,
    id: i === index ? id : node.id,
    children: node.children.map(retarget),
  }));
  const rootId = occurrences === 1 && form.rootId === previous ? id : form.rootId;
  return { ...form, tree, rootId };
}

function cycleFrom(tree: TreeNodeForm[]): string | null {
  const byId = new Map<string, TreeNodeForm[]>();
  for (const node of tree) {
    const id = node.id.trim();
    const list = byId.get(id);
    if (list) list.push(node);
    else byId.set(id, [node]);
  }
  const color = new Map<string, number>();
  function visit(id: string, stack: string[]): string | null {
    if (stack.includes(id)) return id;
    if (color.get(id) === 2) return null;
    color.set(id, 1);
    const nextStack = [...stack, id];
    for (const node of byId.get(id) ?? []) {
      if (node.kind === "terminal") continue;
      for (const child of node.children) {
        const to = child.to.trim();
        if (!to || !byId.has(to)) continue;
        const hit = visit(to, nextStack);
        if (hit) return hit;
      }
    }
    color.set(id, 2);
    return null;
  }
  for (const id of byId.keys()) {
    const hit = visit(id, []);
    if (hit) return hit;
  }
  return null;
}

function readMatrix(
  matrix: string[][],
  rowNames: string[],
  colNames: string[],
  what: string,
  errors: string[],
): number[][] | null {
  let ok = true;
  const values = rowNames.map((rowName, i) =>
    colNames.map((colName, j) => {
      const raw = matrix[i]?.[j] ?? "";
      if (!raw.trim()) {
        errors.push(`Falta ${what} de «${rowName}» en «${colName}».`);
        ok = false;
        return 0;
      }
      const value = parseQty(raw);
      if (value == null) {
        errors.push(`${what} de «${rowName}» en «${colName}» no es un número.`);
        ok = false;
        return 0;
      }
      return value;
    }),
  );
  return ok ? values : null;
}

function readNames(list: string[], what: string, max: number, errors: string[]): boolean {
  if (!list.length) {
    errors.push(`Agrega al menos un ${what}.`);
    return false;
  }
  if (list.length > max) {
    errors.push(`Hay demasiados ${what}: el máximo es ${max}.`);
    return false;
  }
  let ok = true;
  list.forEach((name, i) => {
    if (!name.trim()) {
      errors.push(`El ${what} ${i + 1} no tiene nombre.`);
      ok = false;
    }
  });
  return ok;
}

export function validateDecisionForm(form: DecisionForm): DecisionReport {
  const errors: string[] = [];
  const hints: string[] = [];

  if (form.mode === "decision_tree") {
    if (!form.tree.length) errors.push("Agrega al menos un nodo al árbol.");
    if (form.tree.length > DECISION_LIMITS.nodes) {
      errors.push(`El árbol admite como máximo ${DECISION_LIMITS.nodes} nodos.`);
    }
    const ids = form.tree.map((node) => node.id.trim());
    if (new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length) {
      errors.push("Hay identificadores de nodo repetidos.");
    }
    form.tree.forEach((node, index) => {
      if (!node.id.trim()) errors.push(`El nodo ${index + 1} no tiene identificador.`);
    });
    const known = new Set(ids);
    if (form.rootId.trim() && !known.has(form.rootId.trim())) {
      errors.push(`No existe el nodo raíz «${form.rootId.trim()}».`);
    }
    if (!form.rootId.trim()) errors.push("Elige el nodo raíz del árbol.");
    form.tree.forEach((node) => {
      const id = node.id.trim() || "sin nombre";
      if (node.kind === "terminal") {
        if (parseQty(node.value) == null) errors.push(`El nodo terminal «${id}» necesita un valor numérico.`);
        return;
      }
      if (!node.children.length) errors.push(`El nodo «${id}» necesita al menos un hijo.`);
      node.children.forEach((child) => {
        if (!child.to.trim() || !known.has(child.to.trim())) {
          errors.push(`El nodo «${id}» apunta a un hijo desconocido${child.to.trim() ? `: «${child.to.trim()}»` : ""}.`);
        }
      });
      if (node.kind === "chance") {
        let sum = 0;
        let complete = true;
        node.children.forEach((child) => {
          const probability = parseQty(child.probability);
          if (probability == null) {
            errors.push(`El arco de azar «${id}» → «${child.to || "?"}» necesita una probabilidad.`);
            complete = false;
            return;
          }
          if (probability < 0 || probability > 1) {
            errors.push(`La probabilidad del arco «${id}» → «${child.to}» debe estar entre 0 y 1.`);
            complete = false;
          }
          sum += probability;
        });
        if (complete && node.children.length && Math.abs(sum - 1) > 1e-6) {
          errors.push(`Las probabilidades del nodo de azar «${id}» deben sumar 1 (suman ${formatDraft(sum) || sum}).`);
        }
      }
    });
    const cycle = cycleFrom(form.tree);
    if (cycle) errors.push(`Hay un ciclo en el árbol de decisión en el nodo «${cycle}».`);
    if (errors.length) return { errors, hints, body: null };
    return {
      errors,
      hints,
      body: {
        mode: "decision_tree",
        root_id: form.rootId.trim(),
        tree: form.tree.map((node) => ({
          id: node.id.trim(),
          kind: node.kind,
          ...(node.kind === "terminal" ? { value: parseQty(node.value) } : {}),
          children:
            node.kind === "terminal"
              ? []
              : node.children.map((child) => {
                  const edge: Record<string, unknown> = { to: child.to.trim(), label: child.label };
                  if (node.kind === "chance") edge.probability = parseQty(child.probability);
                  return edge;
                }),
        })),
      },
    };
  }

  if (form.mode === "bayes") {
    readNames(form.actions, "acción", DECISION_LIMITS.alternatives, errors);
    readNames(form.bayesStates, "estado", DECISION_LIMITS.states, errors);
    readNames(form.signals, "señal", DECISION_LIMITS.signals, errors);
    const payoff = readMatrix(form.bayesPayoff, form.actions, form.bayesStates, "el pago", errors);
    const likelihood = readMatrix(form.likelihood, form.signals, form.bayesStates, "la verosimilitud", errors);
    const prior: number[] = [];
    let priorOk = form.prior.length === form.bayesStates.length;
    form.bayesStates.forEach((state, j) => {
      const value = parseQty(form.prior[j] ?? "");
      if (value == null) {
        errors.push(`Falta la probabilidad previa de «${state}».`);
        priorOk = false;
        return;
      }
      if (value < 0) {
        errors.push(`La probabilidad previa de «${state}» no puede ser negativa.`);
        priorOk = false;
      }
      prior.push(value);
    });
    const priorSum = prior.reduce((a, b) => a + b, 0);
    if (priorOk && !(priorSum > 0)) errors.push("Las probabilidades previas suman 0.");
    else if (priorOk && Math.abs(priorSum - 1) > 1e-6) {
      hints.push(`Las probabilidades previas suman ${formatDraft(priorSum)}. Al resolver se normalizan para que sumen 1.`);
    }
    if (likelihood) {
      form.bayesStates.forEach((state, j) => {
        const col = likelihood.reduce((sum, row) => sum + row[j], 0);
        if (Math.abs(col - 1) > 1e-5) {
          hints.push(
            `P(señal | ${state}) suma ${formatDraft(col)}. No se normaliza: el cálculo la usa tal cual y muestra un aviso.`,
          );
        }
      });
    }
    let sampleCost = 0;
    if (form.sampleCost.trim()) {
      const cost = parseQty(form.sampleCost);
      if (cost == null) errors.push("El costo de la muestra debe ser un número.");
      else sampleCost = cost;
    }
    if (sampleCost < 0) hints.push("Un costo negativo significa que te pagan por observar la muestra.");
    hints.push("Si el costo supera el valor de la información muestral, la política óptima es no comprarla.");
    if (errors.length || !payoff || !likelihood) return { errors, hints, body: null };
    return {
      errors,
      hints,
      body: {
        mode: "bayes",
        bayes: {
          actions: form.actions.map((name) => name.trim()),
          states: form.bayesStates.map((name) => name.trim()),
          prior,
          payoff,
          signals: form.signals.map((name) => name.trim()),
          likelihood,
          sample_cost: sampleCost,
        },
      },
    };
  }

  readNames(form.alternatives, "alternativa", DECISION_LIMITS.alternatives, errors);
  readNames(form.states, "estado", DECISION_LIMITS.states, errors);
  const payoff = readMatrix(form.payoff, form.alternatives, form.states, "el pago", errors);
  const alpha = parseQty(form.hurwiczAlpha);
  if (alpha == null || alpha < 0 || alpha > 1) {
    errors.push("El coeficiente α de Hurwicz debe ser un número entre 0 y 1.");
  }
  let probabilities: number[] | null = null;
  if (form.useProbabilities) {
    const probs: number[] = [];
    let ok = true;
    form.states.forEach((state, j) => {
      const value = parseQty(form.probabilities[j] ?? "");
      if (value == null) {
        errors.push(`Falta la probabilidad de «${state}».`);
        ok = false;
        return;
      }
      if (value < 0) {
        errors.push(`La probabilidad de «${state}» no puede ser negativa.`);
        ok = false;
      }
      probs.push(value);
    });
    const sum = probs.reduce((a, b) => a + b, 0);
    if (ok && !(sum > 0)) errors.push("Las probabilidades suman 0.");
    else if (ok && Math.abs(sum - 1) > 1e-6) {
      hints.push(`Las probabilidades suman ${formatDraft(sum)}. Al resolver se normalizan para que sumen 1.`);
    }
    if (ok && sum > 0) probabilities = probs;
  } else if (form.criterion === "expected_value") {
    errors.push("El criterio de valor esperado necesita las probabilidades de los estados.");
  } else if (form.criterion === "all") {
    hints.push("Sin probabilidades se calculan los criterios sin dato (maximax, maximin, Hurwicz y Laplace), pero no el valor esperado ni el VEIP.");
  }

  let utility: Record<string, unknown> | null = null;
  if (form.mode === "utility") {
    if (form.utilityKind === "linear") utility = { kind: "linear" };
    else if (form.utilityKind === "exponential") {
      const R = parseQty(form.riskTolerance);
      if (R == null) errors.push("La tolerancia al riesgo R debe ser un número distinto de 0.");
      else if (R === 0) errors.push("La tolerancia al riesgo R no puede ser 0.");
      else {
        utility = { kind: "exponential", risk_tolerance: R };
        if (R < 0) {
          hints.push("Con R negativo la utilidad 1 − exp(−x/R) decrece si el pago crece. Revisa el signo antes de interpretar la elección.");
        }
      }
    } else {
      const utilities = readMatrix(form.utilities, form.alternatives, form.states, "la utilidad", errors);
      if (utilities) utility = { kind: "table", utilities };
    }
  }

  if (errors.length || !payoff || alpha == null) return { errors, hints, body: null };
  const body: Record<string, unknown> = {
    mode: form.mode,
    alternatives: form.alternatives.map((name) => name.trim()),
    states: form.states.map((name) => name.trim()),
    payoff,
    criterion: form.criterion,
    hurwicz_alpha: alpha,
  };
  if (probabilities) body.probabilities = probabilities;
  if (utility) body.utility = utility;
  return { errors, hints, body };
}
