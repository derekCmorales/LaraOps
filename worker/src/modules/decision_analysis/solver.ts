import { SolverError } from "../../errors";
import type { GraphNetwork, GraphXY, ModuleResult, NamedTable, SensitivityBlock } from "../../schema";
import { emptySensitivity, okResult } from "../../schema";

/** Límites del módulo (no viven en limits.ts: ese archivo lo toca otro agente). */
const MAX_ALTS = 20;
const MAX_STATES = 12;
const MAX_SIGNALS = 12;
const MAX_NODES = 40;

const CRITERIA = [
  "expected_value",
  "maximax",
  "maximin",
  "minimax_regret",
  "hurwicz",
  "laplace",
  "all",
] as const;

type Criterion = (typeof CRITERIA)[number];
type Mode = "payoff_table" | "utility" | "decision_tree" | "bayes";
type NodeKind = "decision" | "chance" | "terminal";

type TreeEdge = { to: string; label: string; probability?: number };
type TreeNode = { id: string; kind: NodeKind; value?: number; children: TreeEdge[] };

type UtilityBlock = {
  kind: "linear" | "exponential" | "table";
  riskTolerance?: number;
  utilities?: number[][];
};

type Sense = "max" | "min";

type PayoffRequest = {
  sense: Sense;
  alternatives: string[];
  states: string[];
  payoff: number[][];
  probabilities: number[] | null;
  criterion: Criterion;
  hurwiczAlpha: number;
  utility: UtilityBlock | null;
  warnings: string[];
};

type BayesRequest = {
  actions: string[];
  states: string[];
  prior: number[];
  payoff: number[][];
  signals: string[];
  likelihood: number[][];
  sampleCost: number;
};

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("El cuerpo debe ser un objeto JSON.");
  }
  return body as Record<string, unknown>;
}

function num(value: unknown, message: string): number {
  if (typeof value === "boolean" || value == null || value === "") throw new SolverError(message);
  const raw = typeof value === "string" ? value.trim().replace(",", ".") : value;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) throw new SolverError(message);
  return n;
}

function formatLoose(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const s = n.toFixed(8).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

function names(value: unknown, what: string, limit: number): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SolverError(`Agrega al menos un nombre de ${what}.`);
  }
  if (value.length > limit) {
    throw new SolverError(`Hay demasiados ${what}: el máximo es ${limit}.`);
  }
  const seen = new Set<string>();
  return value.map((item, i) => {
    const s = String(item ?? "").trim();
    if (!s) throw new SolverError(`El ${what} ${i + 1} no tiene nombre.`);
    if (seen.has(s)) {
      throw new SolverError(`El nombre «${s}» está repetido. Cada ${what} necesita un nombre distinto.`);
    }
    seen.add(s);
    return s;
  });
}

function matrix(
  value: unknown,
  rowNames: string[],
  colNames: string[],
  what: string,
): number[][] {
  if (!Array.isArray(value) || value.length !== rowNames.length) {
    throw new SolverError(`${what} debe tener ${rowNames.length} filas y ${colNames.length} columnas.`);
  }
  return value.map((row, i) => {
    if (!Array.isArray(row) || row.length !== colNames.length) {
      throw new SolverError(
        `La fila de «${rowNames[i]}» en ${what} debe tener ${colNames.length} valores.`,
      );
    }
    return row.map((cell, j) =>
      num(cell, `El valor de «${rowNames[i]}» en «${colNames[j]}» (${what}) no es un número finito.`),
    );
  });
}

function argmax(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[best]) best = i;
  }
  return best;
}

function argmin(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[best]) best = i;
  }
  return best;
}

function parseMode(value: unknown): Mode {
  if (value == null || value === "") return "payoff_table";
  if (value === "payoff_table" || value === "utility" || value === "decision_tree" || value === "bayes") {
    return value;
  }
  throw new SolverError(
    "Modo desconocido. Usa payoff_table, utility, decision_tree o bayes.",
  );
}

function parseCriterion(value: unknown): Criterion {
  if (value == null || value === "") return "all";
  if (typeof value === "string" && (CRITERIA as readonly string[]).includes(value)) return value as Criterion;
  throw new SolverError(
    "El criterio no es válido. Usa expected_value, maximax, maximin, minimax_regret, hurwicz, laplace o all.",
  );
}

function parseSense(value: unknown): Sense {
  if (value == null || value === "" || value === "max") return "max";
  if (value === "min") return "min";
  throw new SolverError("El sentido debe ser «max» (los valores son ganancias) o «min» (los valores son costos).");
}

function parseAlpha(value: unknown): number {
  if (value == null || value === "") return 0.5;
  const alpha = num(value, "El coeficiente α de Hurwicz debe ser un número entre 0 y 1.");
  if (alpha < 0 || alpha > 1) {
    throw new SolverError("El coeficiente α de Hurwicz debe estar entre 0 y 1.");
  }
  return alpha;
}

function parseProbabilities(value: unknown, n: number, warnings: string[], normalizeMessage: string): number[] {
  if (!Array.isArray(value) || value.length !== n) {
    throw new SolverError("La lista de probabilidades debe tener un valor por cada estado.");
  }
  const raw = value.map((p, j) => num(p, `La probabilidad del estado ${j + 1} no es un número.`));
  if (raw.some((p) => p < 0)) {
    throw new SolverError("Las probabilidades no pueden ser negativas.");
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) {
    throw new SolverError("Las probabilidades suman 0; no se pueden normalizar.");
  }
  if (Math.abs(sum - 1) > 1e-6) {
    warnings.push(normalizeMessage);
    return raw.map((p) => p / sum);
  }
  return raw.slice();
}

function parseUtility(
  value: unknown,
  alternatives: string[],
  states: string[],
  payoff: number[][],
  warnings: string[],
): UtilityBlock {
  const o = asRecord(value);
  const kind = o.kind;
  if (kind !== "linear" && kind !== "exponential" && kind !== "table") {
    throw new SolverError("El tipo de utilidad debe ser linear, exponential o table.");
  }
  if (kind === "linear") return { kind };
  if (kind === "exponential") {
    if (o.risk_tolerance == null || o.risk_tolerance === "") {
      throw new SolverError("La utilidad exponencial necesita la tolerancia al riesgo R (distinta de 0).");
    }
    const R = num(o.risk_tolerance, "La tolerancia al riesgo R debe ser un número distinto de 0.");
    if (R === 0) throw new SolverError("La tolerancia al riesgo R no puede ser 0.");
    if (R < 0) {
      warnings.push(
        "Con R negativo la utilidad 1 − exp(−x/R) decrece cuando el pago crece. El equivalente cierto sigue siendo −R·ln(1−U). Revisa que el signo de R sea el que quieres.",
      );
    }
    return { kind, riskTolerance: R };
  }
  const utilities = matrix(o.utilities, alternatives, states, "la matriz de utilidades");
  for (let i = 0; i < alternatives.length; i++) {
    let reversed = false;
    for (let j = 0; j < states.length && !reversed; j++) {
      for (let k = j + 1; k < states.length; k++) {
        const dx = payoff[i][j] - payoff[i][k];
        const du = utilities[i][j] - utilities[i][k];
        if (dx * du < -1e-9) {
          reversed = true;
          break;
        }
      }
    }
    if (reversed) {
      warnings.push(
        `En «${alternatives[i]}» la utilidad no respeta el orden de los pagos: un pago mayor tiene utilidad menor.`,
      );
    }
  }
  return { kind, utilities };
}

function parsePayoff(body: Record<string, unknown>, requireUtility: boolean): PayoffRequest {
  const alternatives = names(body.alternatives, "alternativa", MAX_ALTS);
  const states = names(body.states, "estado", MAX_STATES);
  if (body.payoff == null) {
    throw new SolverError("La tabla de pagos necesita alternativas, estados y la matriz de pagos.");
  }
  const payoff = matrix(body.payoff, alternatives, states, "la matriz de pagos");
  const warnings: string[] = [];
  const utility =
    body.utility != null
      ? parseUtility(body.utility, alternatives, states, payoff, warnings)
      : null;
  if (requireUtility && !utility) {
    throw new SolverError("El modo utilidad necesita el bloque utility.");
  }
  const sense = parseSense(body.sense);
  if (sense === "min" && utility) {
    throw new SolverError(
      "La utilidad trabaja con ganancias. Si tus valores son costos, escríbelos como ganancias negativas o quita el bloque de utilidad.",
    );
  }
  const criterion = parseCriterion(body.criterion);
  let probabilities: number[] | null = null;
  if (body.probabilities != null) {
    probabilities = parseProbabilities(
      body.probabilities,
      states.length,
      warnings,
      "Las probabilidades no suman 1; se normalizaron",
    );
  } else if (criterion === "expected_value") {
    throw new SolverError("El criterio de valor esperado necesita las probabilidades de los estados.");
  }
  return {
    sense,
    alternatives,
    states,
    payoff,
    probabilities,
    criterion,
    hurwiczAlpha: parseAlpha(body.hurwicz_alpha),
    utility,
    warnings,
  };
}

function expUtility(x: number, R: number): number {
  const z = -x / R;
  if (z > 709) return Number.NEGATIVE_INFINITY;
  if (z < -745) return 1;
  return 1 - Math.exp(z);
}

function utilityMatrix(payoff: number[][], utility: UtilityBlock, alternatives: string[], states: string[]): number[][] {
  if (utility.kind === "linear") return payoff.map((row) => row.slice());
  if (utility.kind === "table") return utility.utilities!.map((row) => row.slice());
  const R = utility.riskTolerance!;
  return payoff.map((row, i) =>
    row.map((x, j) => {
      const u = expUtility(x, R);
      if (!Number.isFinite(u)) {
        throw new SolverError(
          `La utilidad de «${alternatives[i]}» en «${states[j]}» se desbordó. Usa una tolerancia R de un tamaño parecido a los pagos.`,
        );
      }
      return u;
    }),
  );
}

function invertUtility(
  utility: UtilityBlock,
  ue: number,
  payoffs: number[],
  utils: number[],
): number | null {
  if (!Number.isFinite(ue)) return null;
  if (utility.kind === "linear") return ue;
  if (utility.kind === "exponential") {
    const R = utility.riskTolerance!;
    if (!(ue < 1)) return null;
    const oneMinus = 1 - ue;
    if (!(oneMinus > 0)) return null;
    const ce = -R * Math.log(oneMinus);
    return Number.isFinite(ce) ? ce : null;
  }
  const pts = utils.map((u, j) => ({ u, x: payoffs[j] })).sort((a, b) => a.u - b.u || a.x - b.x);
  const grouped: { u: number; xs: number[] }[] = [];
  for (const p of pts) {
    const last = grouped[grouped.length - 1];
    if (last && Math.abs(last.u - p.u) <= 1e-9) last.xs.push(p.x);
    else grouped.push({ u: p.u, xs: [p.x] });
  }
  const merged = grouped.map((g) => ({ u: g.u, x: g.xs.reduce((sum, x) => sum + x, 0) / g.xs.length }));
  if (!merged.length) return null;
  if (merged.length === 1) return Math.abs(merged[0].u - ue) <= 1e-8 ? merged[0].x : null;
  const lerp = (a: { u: number; x: number }, b: { u: number; x: number }, u: number) => {
    const den = b.u - a.u;
    if (Math.abs(den) < 1e-15) return (a.x + b.x) / 2;
    return a.x + ((u - a.u) / den) * (b.x - a.x);
  };
  if (ue <= merged[0].u) return lerp(merged[0], merged[1], ue);
  const last = merged[merged.length - 1];
  if (ue >= last.u) return lerp(merged[merged.length - 2], last, ue);
  for (let i = 0; i < merged.length - 1; i++) {
    if (ue <= merged[i + 1].u + 1e-15) return lerp(merged[i], merged[i + 1], ue);
  }
  return null;
}

type CriteriaOut = {
  variables: Record<string, number>;
  metrics: Record<string, number>;
  rows: unknown[][];
  evs: number[] | null;
  bestEvIdx: number | null;
  regret: number[][];
  maxRegret: number[];
};

function want(criterion: Criterion, name: Criterion): boolean {
  return criterion === "all" || criterion === name;
}

/** Criterios sobre una matriz (dinero o utilidad). Replica el orden de filas del solver Python. */
function criteriaOf(
  matrixValues: number[][],
  alternatives: string[],
  probs: number[] | null,
  criterion: Criterion,
  alpha: number,
): CriteriaOut {
  const m = alternatives.length;
  const n = matrixValues[0]?.length ?? 0;
  const rowMax = matrixValues.map((row) => Math.max(...row));
  const rowMin = matrixValues.map((row) => Math.min(...row));
  const maximaxIdx = argmax(rowMax);
  const maximinIdx = argmax(rowMin);
  const colBest = Array.from({ length: n }, (_, j) => Math.max(...matrixValues.map((row) => row[j])));
  const regret = matrixValues.map((row) => row.map((v, j) => colBest[j] - v));
  const maxRegret = regret.map((row) => Math.max(...row));
  const minimaxIdx = argmin(maxRegret);
  const hurwiczValues = rowMax.map((mx, i) => alpha * mx + (1 - alpha) * rowMin[i]);
  const hurwiczIdx = argmax(hurwiczValues);
  const laplaceValues = matrixValues.map((row) => row.reduce((s, v) => s + v / n, 0));
  const laplaceIdx = argmax(laplaceValues);

  const variables: Record<string, number> = {};
  const metrics: Record<string, number> = {};
  const rows: unknown[][] = [];

  if (want(criterion, "maximax")) {
    variables.maximax = maximaxIdx;
    metrics.maximax_payoff = rowMax[maximaxIdx];
    rows.push(["maximax", alternatives[maximaxIdx], rowMax[maximaxIdx]]);
  }
  if (want(criterion, "maximin")) {
    variables.maximin = maximinIdx;
    metrics.maximin_payoff = rowMin[maximinIdx];
    rows.push(["maximin", alternatives[maximinIdx], rowMin[maximinIdx]]);
  }
  if (want(criterion, "minimax_regret")) {
    variables.minimax_regret = minimaxIdx;
    metrics.minimax_regret = maxRegret[minimaxIdx];
    rows.push(["minimax_regret", alternatives[minimaxIdx], maxRegret[minimaxIdx]]);
  }
  if (want(criterion, "hurwicz")) {
    variables.hurwicz = hurwiczIdx;
    metrics.hurwicz_alpha = alpha;
    metrics.hurwicz_payoff = hurwiczValues[hurwiczIdx];
    rows.push(["hurwicz", alternatives[hurwiczIdx], hurwiczValues[hurwiczIdx]]);
    alternatives.forEach((alt, i) => rows.push([`hurwicz:${alt}`, alt, hurwiczValues[i]]));
  }
  if (want(criterion, "laplace")) {
    variables.laplace = laplaceIdx;
    metrics.laplace_payoff = laplaceValues[laplaceIdx];
    rows.push(["laplace", alternatives[laplaceIdx], laplaceValues[laplaceIdx]]);
    alternatives.forEach((alt, i) => rows.push([`laplace:${alt}`, alt, laplaceValues[i]]));
  }

  let evs: number[] | null = null;
  let bestEvIdx: number | null = null;
  if (probs) {
    evs = matrixValues.map((row) => row.reduce((s, v, j) => s + v * probs[j], 0));
    bestEvIdx = argmax(evs);
    const evBest = evs[bestEvIdx];
    const evwpi = colBest.reduce((s, v, j) => s + v * probs[j], 0);
    const eols = regret.map((row) => row.reduce((s, v, j) => s + v * probs[j], 0));
    const bestEolIdx = argmin(eols);
    if (want(criterion, "expected_value")) {
      variables.expected_value = bestEvIdx;
      metrics.EV = evBest;
      metrics.EVwPI = evwpi;
      metrics.EVPI = evwpi - evBest;
      metrics.EOL = eols[bestEolIdx];
      rows.push(["expected_value", alternatives[bestEvIdx], evBest]);
      rows.push(["EOL_choice", alternatives[bestEolIdx], eols[bestEolIdx]]);
    }
    alternatives.forEach((alt, i) => rows.push([`EV:${alt}`, alt, evs![i]]));
  }

  return { variables, metrics, rows, evs, bestEvIdx, regret, maxRegret };
}

/** Claves de pago (no de arrepentimiento) que cambian de signo al volver a costos. */
const PAYOFF_METRICS = ["maximax_payoff", "maximin_payoff", "hurwicz_payoff", "laplace_payoff", "EV", "EVwPI"];
const PAYOFF_ROWS = /^(maximax|maximin|hurwicz|laplace|expected_value|EV:|hurwicz:|laplace:)/;

/**
 * Con costos se resuelve sobre −C (minimizar C es maximizar −C) y aquí se devuelven
 * los pagos a su signo. El arrepentimiento, el VEIP y la pérdida esperada ya son ≥ 0.
 */
function restoreCostSign(out: CriteriaOut): CriteriaOut {
  for (const key of PAYOFF_METRICS) {
    if (out.metrics[key] != null) out.metrics[key] = -out.metrics[key];
  }
  const rows = out.rows.map((row) =>
    typeof row[0] === "string" && PAYOFF_ROWS.test(row[0]) && typeof row[2] === "number" ? [row[0], row[1], -row[2]] : row,
  );
  return { ...out, rows, evs: out.evs ? out.evs.map((v) => -v) : null };
}

/** Un empate cambia la lectura: el criterio no distingue entre esas alternativas. */
function tieWarnings(out: CriteriaOut, alternatives: string[], warnings: string[]) {
  if (!out.evs || out.bestEvIdx == null) return;
  const best = out.evs[out.bestEvIdx];
  const tied = alternatives.filter((_, i) => Math.abs(out.evs![i] - best) <= 1e-9 * (1 + Math.abs(best)));
  if (tied.length > 1) {
    warnings.push(
      `Empate en el valor esperado entre ${tied.map((a) => `«${a}»`).join(" y ")}. Se reporta la primera; cualquiera de ellas es óptima con estas probabilidades.`,
    );
  }
}

function expectedValues(payoff: number[][], probs: number[]): number[] {
  return payoff.map((row) => row.reduce((s, v, j) => s + v * probs[j], 0));
}

/** Cruces del caso de dos estados, igual que _probability_breakeven_points. */
function breakevenPoints(
  payoff: number[][],
  alternatives: string[],
  bestIdx: number,
): Record<string, unknown>[] {
  const [aBest, bBest] = payoff[bestIdx];
  const crossings: Record<string, unknown>[] = [];
  alternatives.forEach((alt, i) => {
    if (i === bestIdx) return;
    const [a, b] = payoff[i];
    const denom = aBest - bBest - (a - b);
    if (Math.abs(denom) < 1e-12) return;
    const p = (b - bBest) / denom;
    if (p >= -1e-9 && p <= 1 + 1e-9) {
      crossings.push({
        current_best: alternatives[bestIdx],
        competitor: alt,
        breakeven_probability_state1: Math.min(1, Math.max(0, p)),
      });
    }
  });
  return crossings;
}

function probabilitySegments(
  payoff: number[][],
  alternatives: string[],
  probs: number[],
  k: number,
): { from: number; to: number; alt: string }[] {
  const n = probs.length;
  const others: number[] = [];
  let rest = 0;
  for (let j = 0; j < n; j++) {
    if (j === k) continue;
    others.push(j);
    rest += probs[j];
  }
  const weight = new Map<number, number>();
  if (rest <= 1e-15) {
    const w = 1 / others.length;
    others.forEach((j) => weight.set(j, w));
  } else {
    others.forEach((j) => weight.set(j, probs[j] / rest));
  }
  const lines = payoff.map((row) => {
    let intercept = 0;
    for (const j of others) intercept += row[j] * (weight.get(j) ?? 0);
    const slope = row[k] - intercept;
    return { intercept, slope };
  });
  const points = [0, 1];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const denom = lines[i].slope - lines[j].slope;
      if (Math.abs(denom) < 1e-12) continue;
      const t = (lines[j].intercept - lines[i].intercept) / denom;
      if (t > 1e-9 && t < 1 - 1e-9) points.push(t);
    }
  }
  points.sort((a, b) => a - b);
  const cuts = [0];
  for (const t of points) {
    if (t - cuts[cuts.length - 1] > 1e-8 && t < 1 - 1e-12) cuts.push(t);
  }
  if (cuts[cuts.length - 1] < 1) cuts.push(1);

  const evAt = (t: number) => lines.map((line) => line.intercept + line.slope * t);
  const merged: { from: number; to: number; alt: string }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const mid = (cuts[i] + cuts[i + 1]) / 2;
    const alt = alternatives[argmax(evAt(mid))];
    const prev = merged[merged.length - 1];
    if (prev && prev.alt === alt) prev.to = cuts[i + 1];
    else merged.push({ from: cuts[i], to: cuts[i + 1], alt });
  }
  return merged;
}

function finiteOrNull(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) < 1e-9) return 0;
  return value;
}

function payoffSensitivityRows(
  payoff: number[][],
  alternatives: string[],
  states: string[],
  probs: number[],
): unknown[][] {
  const evs = expectedValues(payoff, probs);
  const best = argmax(evs);
  const rows: unknown[][] = [];
  for (let i = 0; i < alternatives.length; i++) {
    for (let j = 0; j < states.length; j++) {
      const p = probs[j];
      let down: number | null = null;
      let up: number | null = null;
      if (p > 1e-15) {
        if (i === best) {
          let second = Number.NEGATIVE_INFINITY;
          for (let k = 0; k < evs.length; k++) if (k !== best) second = Math.max(second, evs[k]);
          down = finiteOrNull(evs.length === 1 ? Number.POSITIVE_INFINITY : (evs[best] - second) / p);
          up = null;
        } else {
          up = finiteOrNull((evs[best] - evs[i]) / p);
          down = null;
        }
      }
      rows.push([alternatives[i], states[j], payoff[i][j], down, up]);
    }
  }
  return rows;
}

function xyGraph(payoff: number[][], alternatives: string[], stateName: string, sense: Sense): GraphXY {
  const xs = new Set<number>();
  for (let i = 0; i <= 40; i++) xs.add(i / 40);
  for (let i = 0; i < payoff.length; i++) {
    for (let k = i + 1; k < payoff.length; k++) {
      const [a1, b1] = payoff[i];
      const [a2, b2] = payoff[k];
      const denom = a1 - b1 - (a2 - b2);
      if (Math.abs(denom) < 1e-12) continue;
      const p = (b2 - b1) / denom;
      if (p > 0 && p < 1) xs.add(p);
    }
  }
  const x = [...xs].sort((a, b) => a - b);
  const series = alternatives.map((name, i) => ({
    name,
    x,
    y: x.map((p) => payoff[i][0] * p + payoff[i][1] * (1 - p)),
  }));
  series.push({
    name: "Envolvente",
    x,
    y: x.map((p) => {
      let best = sense === "min" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      for (let i = 0; i < payoff.length; i++) {
        const v = payoff[i][0] * p + payoff[i][1] * (1 - p);
        best = sense === "min" ? Math.min(best, v) : Math.max(best, v);
      }
      return best;
    }),
  });
  return {
    type: "xy",
    series,
    x_label: `P(${stateName})`,
    y_label: sense === "min" ? "Costo esperado" : "Valor esperado",
    title: `${sense === "min" ? "Costo" : "Valor"} esperado contra P(${stateName})`,
    subtitle: `Cada recta es una alternativa. La envolvente es el ${sense === "min" ? "menor costo" : "mejor valor"} esperado en cada probabilidad.`,
    kind: "line",
  };
}

function solvePayoff(body: Record<string, unknown>, requireUtility: boolean): ModuleResult {
  const req = parsePayoff(body, requireUtility);
  const warnings = req.warnings;
  const probs = req.probabilities;
  const utility = req.utility;
  const minimize = req.sense === "min";
  // Con costos todo se resuelve sobre −C; los pagos se devuelven con su signo al final.
  const work = minimize ? req.payoff.map((row) => row.map((v) => -v)) : req.payoff;

  const rawMonetary = criteriaOf(work, req.alternatives, probs, req.criterion, req.hurwiczAlpha);
  const monetary = minimize ? restoreCostSign(rawMonetary) : rawMonetary;
  const analysis = utility
    ? criteriaOf(
        utilityMatrix(req.payoff, utility, req.alternatives, req.states),
        req.alternatives,
        probs,
        req.criterion,
        req.hurwiczAlpha,
      )
    : monetary;
  if (minimize) analysis.metrics.minimize = 1;
  tieWarnings(analysis, req.alternatives, warnings);

  const tables: NamedTable[] = [
    { name: "decisions", columns: ["criterio", "alternativa", "valor"], rows: analysis.rows },
    {
      name: "payoff",
      columns: ["alternativa", ...req.states],
      rows: req.alternatives.map((alt, i) => [alt, ...req.payoff[i]]),
    },
    {
      name: "arrepentimiento",
      columns: ["alternativa", ...req.states, "maximo"],
      rows: req.alternatives.map((alt, i) => [alt, ...analysis.regret[i], analysis.maxRegret[i]]),
    },
  ];

  if (utility && probs && analysis.evs && monetary.evs) {
    const U = utilityMatrix(req.payoff, utility, req.alternatives, req.states);
    const best = analysis.bestEvIdx!;
    const rows = req.alternatives.map((alt, i) => {
      const ve = monetary.evs![i];
      const ue = analysis.evs![i];
      const ce = invertUtility(utility, ue, req.payoff[i], U[i]);
      const premium = ce == null ? null : ve - ce;
      return [alt, ve, ue, ce, premium, i === best ? "sí" : "no"];
    });
    tables.push({
      name: "utilidad",
      columns: ["alternativa", "VE", "UE", "equivalente_cierto", "prima_riesgo", "elegida"],
      rows,
    });
    const chosen = rows[best];
    const ce = chosen[3];
    if (typeof ce === "number" && Number.isFinite(ce)) {
      analysis.metrics.best_certainty_equivalent = ce;
    } else {
      warnings.push(
        "No se pudo calcular el equivalente cierto de la alternativa elegida (la utilidad esperada no está en el dominio de la inversa).",
      );
    }
    if (monetary.metrics.EV != null) analysis.metrics.EV_dinero = monetary.metrics.EV;
    if (monetary.metrics.EVPI != null) analysis.metrics.EVPI_dinero = monetary.metrics.EVPI;
    if (monetary.evs) analysis.metrics.VE_elegida = monetary.evs[best];
  } else if (utility && !probs) {
    tables.push({
      name: "utilidad",
      columns: ["alternativa", "VE", "UE", "equivalente_cierto", "prima_riesgo", "elegida"],
      rows: req.alternatives.map((alt) => [alt, null, null, null, null, "no"]),
    });
  }

  let sensitivity: SensitivityBlock | null = null;
  let graph: GraphXY | null = null;
  if (probs && monetary.bestEvIdx != null) {
    if (req.states.length === 2) {
      const crossings = breakevenPoints(work, req.alternatives, monetary.bestEvIdx);
      if (crossings.length) {
        sensitivity = emptySensitivity();
        sensitivity.objective_ranges = crossings;
      }
    }
    if (req.states.length >= 2) {
      const rows: unknown[][] = [];
      for (let k = 0; k < req.states.length; k++) {
        for (const seg of probabilitySegments(work, req.alternatives, probs, k)) {
          rows.push([req.states[k], seg.from, seg.to, seg.alt]);
        }
      }
      tables.push({
        name: "sensibilidad_probabilidad",
        columns: ["estado", "p_desde", "p_hasta", "alternativa"],
        rows,
      });
    }
    tables.push({
      name: "sensibilidad_pago",
      columns: ["alternativa", "estado", "pago_actual", "disminucion_permitida", "aumento_permitido"],
      // Con costos, bajar −C es subir C: se intercambian las columnas y se restaura el signo.
      rows: payoffSensitivityRows(work, req.alternatives, req.states, probs).map((row) =>
        minimize ? [row[0], row[1], -(row[2] as number), row[4], row[3]] : row,
      ),
    });
  }
  if (req.states.length === 2) graph = xyGraph(req.payoff, req.alternatives, req.states[0], req.sense);

  return okResult("decision_analysis", {
    variables: analysis.variables,
    metrics: analysis.metrics,
    objective_sense: req.sense,
    sensitivity,
    graph,
    tables,
    warnings,
  });
}

function parseTree(body: Record<string, unknown>): { nodes: TreeNode[]; root: string } {
  if (!Array.isArray(body.tree) || body.tree.length === 0) {
    throw new SolverError("El modo de árbol de decisión necesita una lista de nodos.");
  }
  if (body.tree.length > MAX_NODES) {
    throw new SolverError(`El árbol admite como máximo ${MAX_NODES} nodos (hay ${body.tree.length}).`);
  }
  const nodes: TreeNode[] = body.tree.map((raw, index) => {
    const o = asRecord(raw);
    const id = String(o.id ?? "").trim();
    if (!id) throw new SolverError(`El nodo ${index + 1} no tiene identificador.`);
    const kind = o.kind;
    if (kind !== "decision" && kind !== "chance" && kind !== "terminal") {
      throw new SolverError(`El nodo «${id}» tiene un tipo desconocido. Usa decision, chance o terminal.`);
    }
    const childrenRaw = o.children == null ? [] : o.children;
    if (!Array.isArray(childrenRaw)) {
      throw new SolverError(`Los hijos del nodo «${id}» deben ser una lista.`);
    }
    const children: TreeEdge[] = childrenRaw.map((edgeRaw) => {
      const e = asRecord(edgeRaw);
      const to = String(e.to ?? "").trim();
      if (!to) throw new SolverError(`Un arco que sale de «${id}» no indica a qué nodo llega.`);
      const edge: TreeEdge = { to, label: e.label == null ? "" : String(e.label) };
      if (e.probability != null && e.probability !== "") {
        edge.probability = num(e.probability, `La probabilidad del arco «${id}» → «${to}» no es un número.`);
        if (edge.probability < 0 || edge.probability > 1) {
          throw new SolverError(
            `La probabilidad del arco «${id}» → «${to}» es ${formatLoose(edge.probability)}. Debe estar entre 0 y 1.`,
          );
        }
      }
      return edge;
    });
    const node: TreeNode = { id, kind, children };
    if (o.value != null && o.value !== "") {
      node.value = num(o.value, `El valor del nodo «${id}» no es un número.`);
    }
    return node;
  });
  const ids = nodes.map((n) => n.id);
  if (new Set(ids).size !== ids.length) {
    throw new SolverError("Hay identificadores de nodo repetidos en el árbol.");
  }
  const rootRaw = body.root_id == null || body.root_id === "" ? nodes[0].id : String(body.root_id).trim();
  if (!ids.includes(rootRaw)) throw new SolverError(`No existe el nodo raíz «${rootRaw}».`);
  return { nodes, root: rootRaw };
}

function solveTree(body: Record<string, unknown>): ModuleResult {
  const { nodes, root } = parseTree(body);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const values = new Map<string, number>();
  const choice = new Map<string, string>();
  const policy = new Map<string, string>();

  function evalNode(nid: string, stack: Set<string>): number {
    if (stack.has(nid)) {
      throw new SolverError(`Hay un ciclo en el árbol de decisión en el nodo «${nid}».`);
    }
    const cached = values.get(nid);
    if (cached != null) return cached;
    const node = byId.get(nid);
    if (!node) throw new SolverError(`No existe el nodo «${nid}».`);
    if (node.kind === "terminal") {
      if (node.value == null || !Number.isFinite(node.value)) {
        throw new SolverError(`El nodo terminal «${nid}» necesita un valor numérico.`);
      }
      values.set(nid, node.value);
      return node.value;
    }
    if (!node.children.length) {
      throw new SolverError(`El nodo «${nid}» no es terminal y no tiene hijos.`);
    }
    const next = new Set(stack);
    next.add(nid);
    if (node.kind === "decision") {
      let bestVal = 0;
      let bestTo = "";
      let bestLabel = "";
      let found = false;
      for (const edge of node.children) {
        if (!byId.has(edge.to)) {
          throw new SolverError(`El nodo «${nid}» apunta a un hijo desconocido: «${edge.to}».`);
        }
        const v = evalNode(edge.to, next);
        if (!found || v > bestVal) {
          found = true;
          bestVal = v;
          bestTo = edge.to;
          bestLabel = edge.label.trim() ? edge.label : edge.to;
        }
      }
      values.set(nid, bestVal);
      choice.set(nid, bestTo);
      policy.set(nid, bestLabel);
      return bestVal;
    }
    if (node.kind === "chance") {
      let totalP = 0;
      let ev = 0;
      for (const edge of node.children) {
        if (edge.probability == null || !Number.isFinite(edge.probability)) {
          throw new SolverError(`El arco de azar «${nid}» → «${edge.to}» necesita una probabilidad.`);
        }
        if (!byId.has(edge.to)) {
          throw new SolverError(`El nodo «${nid}» apunta a un hijo desconocido: «${edge.to}».`);
        }
        totalP += edge.probability;
        ev += edge.probability * evalNode(edge.to, next);
      }
      if (Math.abs(totalP - 1) > 1e-6) {
        throw new SolverError(
          `Las probabilidades del nodo de azar «${nid}» deben sumar 1 (suman ${formatLoose(totalP)}).`,
        );
      }
      values.set(nid, ev);
      return ev;
    }
    throw new SolverError(`El nodo «${nid}» tiene un tipo desconocido. Usa decision, chance o terminal.`);
  }

  const rootEv = evalNode(root, new Set());
  const foldRows = nodes.map((node) => [
    node.id,
    node.kind,
    values.has(node.id) ? values.get(node.id)! : "",
    choice.get(node.id) ?? "",
  ]);
  const policyRows = nodes
    .filter((node) => node.kind === "decision")
    .map((node) => [node.id, policy.get(node.id) ?? "", values.has(node.id) ? values.get(node.id)! : ""]);

  const graph: GraphNetwork = {
    type: "network",
    title: "Árbol de decisión",
    subtitle: "Arcos óptimos resaltados · etiquetas con probabilidad o decisión",
    directed: true,
    nodes: nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      value: values.has(node.id) ? values.get(node.id)! : null,
      root: node.id === root,
      label: node.id,
      politica: policy.get(node.id) ?? null,
    })),
    edges: nodes.flatMap((node) =>
      node.children.map((edge) => ({
        source: node.id,
        target: edge.to,
        label: edge.label,
        probability: edge.probability ?? null,
        critical: node.kind === "decision" && choice.get(node.id) === edge.to,
        flow: values.has(edge.to) ? values.get(edge.to)! : null,
      })),
    ),
  };

  return okResult("decision_analysis", {
    variables: { root: rootEv },
    objective_value: rootEv,
    objective_sense: "max",
    metrics: { EV_root: rootEv, best_child_count: choice.size },
    graph,
    tables: [
      { name: "tree_fold", columns: ["id", "tipo", "valor", "mejor_hijo"], rows: foldRows },
      { name: "politica", columns: ["nodo", "decision_elegida", "valor"], rows: policyRows },
    ],
    warnings: [],
  });
}

function parseBayes(body: Record<string, unknown>): BayesRequest {
  if (body.bayes == null) throw new SolverError("El modo Bayes necesita el bloque bayes.");
  const b = asRecord(body.bayes);
  const actions = names(b.actions, "acción", MAX_ALTS);
  const states = names(b.states, "estado", MAX_STATES);
  const signals = names(b.signals, "señal", MAX_SIGNALS);
  const payoff = matrix(b.payoff, actions, states, "la matriz de pagos");
  const likelihood = matrix(b.likelihood, signals, states, "la verosimilitud");
  likelihood.forEach((row, i) =>
    row.forEach((value, j) => {
      if (value < 0 || value > 1) {
        throw new SolverError(
          `La verosimilitud P(${signals[i]} | ${states[j]}) es ${formatLoose(value)}. Debe estar entre 0 y 1.`,
        );
      }
    }),
  );
  const warnings: string[] = [];
  const prior = parseProbabilities(
    b.prior,
    states.length,
    warnings,
    "Las probabilidades previas se normalizaron para sumar 1",
  );
  // parseProbabilities ya avisó; se reaplicará en solveBayes para conservar el aviso. Aquí solo validamos.
  void warnings;
  const costRaw = b.sample_cost ?? body.sample_cost ?? 0;
  const sampleCost = num(costRaw, "El costo de la muestra debe ser un número.");
  return { actions, states, prior, payoff, signals, likelihood, sampleCost };
}

type BuiltNode = {
  id: string;
  kind: NodeKind;
  label: string;
  terminal?: number;
  children: { to: string; label: string; probability?: number }[];
  value?: number;
  politica?: string;
  choice?: string;
};

function solveBayes(body: Record<string, unknown>): ModuleResult {
  const req = parseBayes(body);
  const warnings: string[] = [];
  const prior = parseProbabilities(
    asRecord(body.bayes).prior,
    req.states.length,
    warnings,
    "Las probabilidades previas se normalizaron para sumar 1",
  );
  const { actions, states, payoff, signals, likelihood, sampleCost } = req;
  const m = actions.length;
  const n = states.length;
  const sCount = signals.length;

  for (let j = 0; j < n; j++) {
    const col = likelihood.reduce((sum, row) => sum + row[j], 0);
    if (Math.abs(col - 1) > 1e-5) {
      warnings.push(
        `La columna de verosimilitud del estado ${states[j]} suma ${formatLoose(col)}; se usa tal cual`,
      );
    }
  }

  const evs = expectedValues(payoff, prior);
  const bestIdx = argmax(evs);
  const ev = evs[bestIdx];
  const colBest = Array.from({ length: n }, (_, j) => Math.max(...payoff.map((row) => row[j])));
  const evwpi = colBest.reduce((sum, v, j) => sum + v * prior[j], 0);
  const evpi = evwpi - ev;

  const pSignal: number[] = [];
  const posteriors: number[][] = [];
  const bestAction: string[] = [];
  const evPerSignal: number[] = [];
  const stateProbsForTree: number[][] = [];

  for (let i = 0; i < sCount; i++) {
    const ps = likelihood[i].reduce((sum, like, j) => sum + like * prior[j], 0);
    pSignal.push(ps);
    if (ps <= 1e-15) {
      posteriors.push(Array(n).fill(0));
      bestAction.push(actions[bestIdx]);
      evPerSignal.push(ev);
      stateProbsForTree.push(prior.slice());
      warnings.push(
        `La señal «${signals[i]}» tiene probabilidad casi 0; en el árbol de esa rama se usa la probabilidad previa.`,
      );
      continue;
    }
    const post = likelihood[i].map((like, j) => (like * prior[j]) / ps);
    posteriors.push(post);
    const evsSig = expectedValues(payoff, post);
    const aBest = argmax(evsSig);
    bestAction.push(actions[aBest]);
    evPerSignal.push(evsSig[aBest]);
    stateProbsForTree.push(post);
  }

  const evwsi = pSignal.reduce((sum, ps, i) => sum + ps * evPerSignal[i], 0);
  const evsi = evwsi - ev;

  const bayesRows = signals.map((sig, i) => [
    sig,
    pSignal[i],
    bestAction[i],
    evPerSignal[i],
    ...posteriors[i],
  ]);

  const built = new Map<string, BuiltNode>();
  const order: string[] = [];
  function add(node: BuiltNode) {
    built.set(node.id, node);
    order.push(node.id);
    return node;
  }

  add({ id: "raiz", kind: "decision", label: "¿Comprar la información?", children: [] });
  add({ id: "sin_informacion", kind: "decision", label: "Sin información", children: [] });
  add({ id: "con_informacion", kind: "chance", label: "Señales", children: [] });

  for (let a = 0; a < m; a++) {
    const chanceId = `sin_accion_${a}`;
    add({ id: chanceId, kind: "chance", label: actions[a], children: [] });
    built.get("sin_informacion")!.children.push({ to: chanceId, label: actions[a] });
    for (let j = 0; j < n; j++) {
      const termId = `sin_term_${a}_${j}`;
      add({ id: termId, kind: "terminal", label: `${actions[a]} · ${states[j]}`, terminal: payoff[a][j], children: [] });
      built.get(chanceId)!.children.push({ to: termId, label: states[j], probability: prior[j] });
    }
  }

  for (let i = 0; i < sCount; i++) {
    const decId = `senal_${i}`;
    add({ id: decId, kind: "decision", label: `Señal ${signals[i]}`, children: [] });
    built.get("con_informacion")!.children.push({ to: decId, label: signals[i], probability: pSignal[i] });
    for (let a = 0; a < m; a++) {
      const chanceId = `con_accion_${i}_${a}`;
      add({ id: chanceId, kind: "chance", label: actions[a], children: [] });
      built.get(decId)!.children.push({ to: chanceId, label: actions[a] });
      for (let j = 0; j < n; j++) {
        const termId = `con_term_${i}_${a}_${j}`;
        add({
          id: termId,
          kind: "terminal",
          label: `${signals[i]} · ${actions[a]} · ${states[j]}`,
          terminal: payoff[a][j] - sampleCost,
          children: [],
        });
        built.get(chanceId)!.children.push({
          to: termId,
          label: states[j],
          probability: stateProbsForTree[i][j],
        });
      }
    }
  }

  built.get("raiz")!.children.push(
    { to: "sin_informacion", label: "Sin información" },
    { to: "con_informacion", label: "Comprar información" },
  );

  const memo = new Map<string, number>();
  function fold(id: string): number {
    const hit = memo.get(id);
    if (hit != null) return hit;
    const node = built.get(id)!;
    if (node.kind === "terminal") {
      node.value = node.terminal ?? 0;
      memo.set(id, node.value);
      return node.value;
    }
    if (node.kind === "decision") {
      let bestVal = 0;
      let bestTo = "";
      let bestLabel = "";
      let found = false;
      for (const edge of node.children) {
        const v = fold(edge.to);
        if (!found || v > bestVal) {
          found = true;
          bestVal = v;
          bestTo = edge.to;
          bestLabel = edge.label;
        }
      }
      node.value = bestVal;
      node.choice = bestTo;
      node.politica = bestLabel;
      memo.set(id, bestVal);
      return bestVal;
    }
    let total = 0;
    let pSum = 0;
    for (const edge of node.children) {
      total += (edge.probability ?? 0) * fold(edge.to);
      pSum += edge.probability ?? 0;
    }
    // Los terminales de la rama con información ya restan el costo. Si las señales no
    // suman 1, se cobra el costo una sola vez para que la rama valga EVwSI − sample_cost.
    if (id === "con_informacion") {
      if (Math.abs(pSum - 1) > 1e-6) {
        warnings.push(
          `Las probabilidades de las señales suman ${formatLoose(pSum)}. El valor de comprar la información es EVwSI menos el costo de la muestra, pagado una sola vez.`,
        );
      }
      total -= sampleCost * (1 - pSum);
    }
    node.value = total;
    memo.set(id, total);
    return total;
  }

  fold("raiz");
  const infoValue = built.get("con_informacion")!.value ?? 0;
  const evsiNeto = infoValue - ev;

  const metrics: Record<string, number> = {
    EV: ev,
    EVwPI: evwpi,
    EVPI: evpi,
    EVwSI: evwsi,
    EVSI: evsi,
    sample_cost: sampleCost,
    EVSI_neto: evsiNeto,
  };

  const auxRows: unknown[][] = [];
  for (let i = 0; i < sCount; i++) {
    const signalId = `Señal: ${signals[i]}`;
    auxRows.push(["Previa", signalId, signals[i], pSignal[i]]);
    for (let j = 0; j < n; j++) {
      auxRows.push([signalId, `${signals[i]} | ${states[j]}`, states[j], posteriors[i][j]]);
    }
  }

  const nodeRows = order.map((id) => {
    const node = built.get(id)!;
    return [node.id, node.kind, node.value ?? null, node.politica ?? ""];
  });
  const arcRows: unknown[][] = [];
  for (const id of order) {
    const node = built.get(id)!;
    for (const edge of node.children) {
      const child = built.get(edge.to)!;
      const optimal = node.kind === "decision" && node.choice === edge.to;
      arcRows.push([node.id, edge.to, edge.label, edge.probability ?? null, optimal, child.value ?? null]);
    }
  }

  const graph: GraphNetwork = {
    type: "network",
    title: "Árbol de decisión con información muestral",
    subtitle: "Cuadrados: decisiones. Círculos: azar. El arco magenta es lo que elegiría ese nodo.",
    directed: true,
    nodes: order.map((id) => {
      const node = built.get(id)!;
      return {
        id: node.id,
        kind: node.kind,
        value: node.value ?? null,
        root: node.id === "raiz",
        label: node.label,
        politica: node.politica ?? null,
      };
    }),
    edges: arcRows.map((row) => ({
      source: row[0],
      target: row[1],
      label: row[2],
      probability: row[3],
      critical: row[4] === true,
      flow: row[5],
    })),
  };

  const summaryRows: unknown[][] = [
    ["EV", metrics.EV],
    ["EVwPI", metrics.EVwPI],
    ["EVPI", metrics.EVPI],
    ["EVwSI", metrics.EVwSI],
    ["EVSI", metrics.EVSI],
    ["best_prior_action", actions[bestIdx]],
    ["sample_cost", sampleCost],
    ["EVSI_neto", evsiNeto],
    ["politica", built.get("raiz")!.politica ?? ""],
  ];

  return okResult("decision_analysis", {
    variables: { best_prior_action: bestIdx },
    objective_value: evwsi,
    objective_sense: "max",
    metrics,
    graph,
    tables: [
      {
        name: "bayes",
        columns: ["signal", "P(signal)", "best_action", "EV|signal", ...states.map((st) => `P(${st}|sig)`)],
        rows: bayesRows,
      },
      { name: "summary", columns: ["métrica", "valor"], rows: summaryRows },
      {
        name: "bayes_arbol_auxiliar",
        columns: ["desde", "hacia", "etiqueta", "probabilidad"],
        rows: auxRows,
      },
      { name: "bayes_nodos", columns: ["id", "tipo", "valor", "politica"], rows: nodeRows },
      {
        name: "bayes_arcos",
        columns: ["desde", "hacia", "etiqueta", "probabilidad", "optimo", "flujo"],
        rows: arcRows,
      },
    ],
    warnings,
  });
}

export function solve(body: unknown): ModuleResult {
  const record = asRecord(body);
  const mode = parseMode(record.mode);
  if (mode === "decision_tree") return solveTree(record);
  if (mode === "bayes") return solveBayes(record);
  return solvePayoff(record, mode === "utility");
}
