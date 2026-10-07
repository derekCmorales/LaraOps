import { parseDecimalDraft } from "../components/FormFields";

export type McMode = "rng" | "variates" | "monte_carlo";
export type DistFamily = "uniform" | "exponential" | "normal" | "triangular" | "discrete" | "empirical";

export const MODES: { value: McMode; label: string; hint: string }[] = [
  {
    value: "rng",
    label: "Números U(0, 1)",
    hint: "Genera uniformes U(0, 1). Elige el congruencial lineal para seguir el método del libro paso a paso, o Mulberry32 para muestras grandes. Con muchas muestras la media se acerca a 1/2 y la varianza a 1/12.",
  },
  {
    value: "variates",
    label: "Variables aleatorias",
    hint: "Transforma esos uniformes en una distribución: inversa para la mayoría y Box-Muller para la normal.",
  },
  {
    value: "monte_carlo",
    label: "Monte Carlo",
    hint: "Defines variables independientes y una fórmula. Cada réplica sortea las variables y evalúa el resultado.",
  },
];

export const FAMILIES: { value: DistFamily; label: string }[] = [
  { value: "uniform", label: "Uniforme" },
  { value: "exponential", label: "Exponencial" },
  { value: "normal", label: "Normal" },
  { value: "triangular", label: "Triangular" },
  { value: "discrete", label: "Discreta" },
  { value: "empirical", label: "Empírica" },
];

const FAMILY_VALUES = FAMILIES.map((f) => f.value);
const RESERVED = new Set(["min", "max", "abs", "sqrt", "floor", "ceil"]);
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type DistForm = {
  family: DistFamily;
  min: string;
  max: string;
  lambda: string;
  mean: string;
  std: string;
  low: string;
  mode: string;
  high: string;
  values: string;
  probabilities: string;
  data: string;
};

export type VarForm = { name: string; distribution: DistForm };

export type RngMethod = "lcg" | "mulberry32";

export type McForm = {
  mode: McMode;
  /** Generador del modo «Números U(0, 1)». */
  rngMethod: RngMethod;
  lcgA: string;
  lcgC: string;
  lcgM: string;
  seed: string;
  n: string;
  replications: string;
  distribution: DistForm;
  variables: VarForm[];
  expression: string;
};

export type DistBody = Record<string, unknown>;

export type McBody =
  | { mode: "rng"; seed: number; n: number; method: "mulberry32" }
  | { mode: "rng"; seed: number; n: number; method: "lcg"; a: number; c: number; m: number }
  | { mode: "variates"; seed: number; n: number; distribution: DistBody }
  | {
      mode: "monte_carlo";
      seed: number;
      replications: number;
      variables: { name: string; distribution: DistBody }[];
      expression: string;
    };

export type McReport = {
  errors: Record<string, string>;
  hints: Record<string, string>;
  body: McBody | null;
};

/** Suma PERT (a+4m+b)/6 de las tres actividades de la plantilla. */
export const PERT_EXPECTED = (3 + 4 * 5 + 9) / 6 + (4 + 4 * 7 + 12) / 6 + (2 + 4 * 3 + 8) / 6;

export const ORDER_NOTE =
  "Precio 20, pedido 70, costo 12 y salvamento 5. Ganancia = 20·min(demanda, 70) − 840 + 5·max(70 − demanda, 0). La demanda es discreta.";

export function blankDist(): DistForm {
  return {
    family: "uniform",
    min: "",
    max: "",
    lambda: "",
    mean: "",
    std: "",
    low: "",
    mode: "",
    high: "",
    values: "",
    probabilities: "",
    data: "",
  };
}

export function blankMonteCarloForm(): McForm {
  return {
    mode: "monte_carlo",
    // Parámetros de Numerical Recipes: periodo completo 2³² y cualquier semilla sirve.
    rngMethod: "lcg",
    lcgA: "1664525",
    lcgC: "1013904223",
    lcgM: "4294967296",
    seed: "42",
    n: "2000",
    replications: "2000",
    distribution: blankDist(),
    variables: [{ name: "demanda", distribution: blankDist() }],
    expression: "",
  };
}

function withDist(partial: Partial<DistForm>): DistForm {
  return { ...blankDist(), ...partial };
}

export function templateOrderProfit(): McForm {
  return {
    ...blankMonteCarloForm(),
    mode: "monte_carlo",
    seed: "42",
    replications: "4000",
    variables: [
      {
        name: "demanda",
        distribution: withDist({
          family: "discrete",
          values: "40; 55; 70; 85; 100",
          probabilities: "0.1; 0.25; 0.3; 0.25; 0.1",
        }),
      },
    ],
    expression: "20*min(demanda, 70) - 12*70 + 5*max(70-demanda, 0)",
  };
}

export function templatePert(): McForm {
  return {
    ...blankMonteCarloForm(),
    mode: "monte_carlo",
    seed: "42",
    replications: "3000",
    variables: [
      { name: "diseno", distribution: withDist({ family: "triangular", low: "3", mode: "5", high: "9" }) },
      { name: "construccion", distribution: withDist({ family: "triangular", low: "4", mode: "7", high: "12" }) },
      { name: "prueba", distribution: withDist({ family: "triangular", low: "2", mode: "3", high: "8" }) },
    ],
    expression: "diseno + construccion + prueba",
  };
}

export function exampleForm(mode: McMode): McForm {
  // Ejemplo de libro: a = 5, c = 3, m = 16, x₀ = 7 cumple Hull-Dobell y repite cada 16.
  if (mode === "rng") {
    return { ...blankMonteCarloForm(), mode: "rng", rngMethod: "lcg", lcgA: "5", lcgC: "3", lcgM: "16", seed: "7", n: "20" };
  }
  if (mode === "variates") {
    return {
      ...blankMonteCarloForm(),
      mode: "variates",
      seed: "42",
      n: "5000",
      distribution: withDist({ family: "exponential", lambda: "2" }),
    };
  }
  return templateOrderProfit();
}

function draft(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (value == null || value === "" || !Number.isFinite(n)) return "";
  return n.toLocaleString("es-MX", { useGrouping: false, maximumFractionDigits: 12 });
}

function listDraft(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((item) => draft(item)).filter(Boolean).join("; ");
}

function distFromUnknown(raw: unknown): DistForm {
  const base = blankDist();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  const family = FAMILY_VALUES.includes(o.family as DistFamily) ? (o.family as DistFamily) : "uniform";
  return {
    ...base,
    family,
    min: draft(o.min),
    max: draft(o.max),
    lambda: draft(o.lambda),
    mean: draft(o.mean),
    std: draft(o.std),
    low: draft(o.low),
    mode: draft(o.mode),
    high: draft(o.high),
    values: listDraft(o.values),
    probabilities: listDraft(o.probabilities),
    data: listDraft(o.data),
  };
}

export function formFromBody(body: unknown): McForm {
  if (!body || typeof body !== "object" || Array.isArray(body)) return blankMonteCarloForm();
  const o = body as Record<string, unknown>;
  const mode: McMode = o.mode === "rng" || o.mode === "variates" || o.mode === "monte_carlo" ? o.mode : "monte_carlo";
  const form = blankMonteCarloForm();
  const variables = Array.isArray(o.variables)
    ? o.variables.map((item) => {
        const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        return {
          name: typeof row.name === "string" ? row.name : "",
          distribution: distFromUnknown(row.distribution),
        };
      })
    : form.variables;
  const lcg = o.method === "lcg" || o.method === "congruencial";
  return {
    ...form,
    mode,
    rngMethod: mode === "rng" && !lcg ? "mulberry32" : "lcg",
    lcgA: draft(o.a) || form.lcgA,
    lcgC: draft(o.c) || form.lcgC,
    lcgM: draft(o.m) || form.lcgM,
    seed: draft(o.seed) || form.seed,
    n: draft(o.n) || form.n,
    replications: draft(o.replications) || form.replications,
    distribution: o.distribution ? distFromUnknown(o.distribution) : form.distribution,
    variables: variables.length ? variables.slice(0, 8) : form.variables,
    expression: typeof o.expression === "string" ? o.expression : "",
  };
}

type Parsed = { empty: boolean; invalid: boolean; value: number | null };

function parseNum(text: string): Parsed {
  const t = text.trim();
  if (!t) return { empty: true, invalid: false, value: null };
  const p = parseDecimalDraft(t);
  if (p.invalid || p.value == null) return { empty: false, invalid: true, value: null };
  return { empty: false, invalid: false, value: p.value };
}

export function parseNumberList(text: string): { values: number[] | null; error?: string } {
  const raw = text.trim();
  if (!raw) return { values: null, error: "Escribe al menos un número." };
  const parts = raw.split(/[;\n]+|(?:,\s+)|\s+/).map((s) => s.trim()).filter(Boolean);
  const values: number[] = [];
  for (const part of parts) {
    const p = parseDecimalDraft(part);
    if (p.invalid || p.value == null || p.partial) {
      return {
        values: null,
        error: `«${part}» no es un número. Separa con punto y coma (1,5; 2) o con espacio.`,
      };
    }
    values.push(p.value);
  }
  if (!values.length) return { values: null, error: "Escribe al menos un número." };
  return { values };
}

function readRequired(
  text: string,
  key: string,
  missing: string,
  errors: Record<string, string>,
  check?: (n: number) => string | null,
): number | null {
  const p = parseNum(text);
  if (p.empty) {
    errors[key] = missing;
    return null;
  }
  if (p.invalid || p.value == null) {
    errors[key] = "Escribe un número válido.";
    return null;
  }
  const msg = check?.(p.value);
  if (msg) {
    errors[key] = msg;
    return null;
  }
  return p.value;
}

function readList(text: string, key: string, missing: string, errors: Record<string, string>): number[] | null {
  if (!text.trim()) {
    errors[key] = missing;
    return null;
  }
  const parsed = parseNumberList(text);
  if (!parsed.values) {
    errors[key] = parsed.error ?? missing;
    return null;
  }
  if (parsed.values.length > 10000) {
    errors[key] = "Hay demasiados números (máximo 10000).";
    return null;
  }
  return parsed.values;
}

function distributionBody(
  dist: DistForm,
  prefix: string,
  errors: Record<string, string>,
  hints: Record<string, string>,
): DistBody | null {
  const key = (field: string) => `${prefix}:${field}`;
  const family = dist.family;

  if (family === "uniform") {
    const min = readRequired(dist.min, key("min"), "Indica el mínimo.", errors);
    const max = readRequired(dist.max, key("max"), "Indica el máximo.", errors);
    if (min != null && max != null && min > max) errors[key("max")] = "El máximo no puede ser menor que el mínimo.";
    if (min == null || max == null || min > max) return null;
    return { family, min, max };
  }

  if (family === "exponential") {
    const lambda = readRequired(dist.lambda, key("lambda"), "Indica la tasa λ.", errors, (n) =>
      n > 0 ? null : "La tasa λ debe ser mayor que 0.",
    );
    if (lambda == null) return null;
    return { family, lambda };
  }

  if (family === "normal") {
    const mean = readRequired(dist.mean, key("mean"), "Indica la media.", errors);
    const std = readRequired(dist.std, key("std"), "Indica la desviación estándar.", errors, (n) =>
      n > 0 ? null : "La desviación estándar debe ser mayor que 0.",
    );
    if (mean == null || std == null) return null;
    return { family, mean, std };
  }

  if (family === "triangular") {
    const low = readRequired(dist.low, key("low"), "Indica el mínimo.", errors);
    const mode = readRequired(dist.mode, key("mode"), "Indica la moda.", errors);
    const high = readRequired(dist.high, key("high"), "Indica el máximo.", errors);
    const ordered = low != null && mode != null && high != null && low < high && low <= mode && mode <= high;
    if (low != null && mode != null && high != null && !ordered) {
      errors[key("mode")] = "Se necesita mínimo ≤ moda ≤ máximo, con mínimo < máximo.";
    }
    if (low == null || mode == null || high == null || !ordered) return null;
    return { family, low, mode, high };
  }

  if (family === "discrete") {
    const values = readList(dist.values, key("values"), "Indica los valores separados por punto y coma.", errors);
    const probabilities = readList(
      dist.probabilities,
      key("probabilities"),
      "Indica las probabilidades separadas por punto y coma.",
      errors,
    );
    if (!values || !probabilities) return null;
    if (values.length !== probabilities.length) {
      errors[key("probabilities")] = "Debe haber una probabilidad por cada valor.";
      return null;
    }
    if (probabilities.some((p) => p < 0)) {
      errors[key("probabilities")] = "Las probabilidades no pueden ser negativas.";
      return null;
    }
    const sum = probabilities.reduce((acc, p) => acc + p, 0);
    if (!(sum > 0)) {
      errors[key("probabilities")] = "Las probabilidades no pueden ser todas cero.";
      return null;
    }
    if (Math.abs(sum - 1) > 1e-3) {
      hints[key("probabilities")] = `Suman ${fmtNum(sum)}. Al resolver se normalizan para que sumen 1.`;
    }
    return { family, values, probabilities };
  }

  const data = readList(dist.data, key("data"), "Indica los datos separados por punto y coma.", errors);
  if (!data) return null;
  return { family: "empirical", data };
}

function readCount(
  text: string,
  key: string,
  missing: string,
  label: string,
  min: number,
  max: number,
  errors: Record<string, string>,
): number | null {
  const p = parseNum(text);
  if (p.empty) {
    errors[key] = missing;
    return null;
  }
  if (p.invalid || p.value == null || !Number.isInteger(p.value)) {
    errors[key] = `${label} debe ser un entero.`;
    return null;
  }
  if (p.value < min || p.value > max) {
    errors[key] = `${label} debe estar entre ${min} y ${max}.`;
    return null;
  }
  return p.value;
}

function expressionError(expression: string, names: string[]): string | undefined {
  const text = expression.trim();
  if (!text) return "Escribe la fórmula del resultado.";
  if (text.length > 800) return "La fórmula es demasiado larga (máximo 800 caracteres).";
  if (/[^0-9A-Za-z_+\-*/^().,\seE]/.test(text)) {
    return "La fórmula solo admite números, nombres, + − * / ^ y paréntesis. Los decimales van con punto (1.5).";
  }
  const withoutNumbers = text.replace(/(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/g, " ");
  const ids = withoutNumbers.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  const known = new Set(names);
  for (const id of ids) {
    if (RESERVED.has(id) || known.has(id)) continue;
    return `«${id}» no es una variable definida ni una función permitida (min, max, abs, sqrt, floor, ceil).`;
  }
  return undefined;
}

export function validateMonteCarloForm(form: McForm): McReport {
  const errors: Record<string, string> = {};
  const hints: Record<string, string> = {};
  const seedParsed = parseNum(form.seed);
  let seed: number | null = null;
  if (seedParsed.empty) errors.seed = "Indica la semilla.";
  else if (seedParsed.invalid || seedParsed.value == null) errors.seed = "La semilla debe ser un número.";
  else seed = seedParsed.value;

  if (form.mode === "rng" || form.mode === "variates") {
    const max = form.mode === "rng" ? 5000 : 20000;
    const n = readCount(form.n, "n", "Indica cuántos números generar.", "La cantidad", 1, max, errors);
    if (form.mode === "rng") {
      if (form.rngMethod === "mulberry32") {
        if (seed == null || n == null) return { errors, hints, body: null };
        return { errors, hints, body: { mode: "rng", seed, n, method: "mulberry32" } };
      }
      const m = readCount(form.lcgM, "lcgM", "Indica el módulo m.", "El módulo m", 2, 2 ** 32, errors);
      const top = m ?? 2 ** 32;
      const a = readCount(form.lcgA, "lcgA", "Indica el multiplicador a.", "El multiplicador a", 1, top - 1, errors);
      const c = readCount(form.lcgC, "lcgC", "Indica el incremento c (0 si es multiplicativo).", "El incremento c", 0, top - 1, errors);
      if (seed != null && (!Number.isInteger(seed) || seed < 0 || seed >= top)) {
        errors.seed = `En el congruencial la semilla x₀ es un entero entre 0 y ${top - 1}.`;
      } else if (seed === 0 && c === 0) {
        errors.seed = "Con c = 0 la semilla 0 da siempre 0. Usa otra semilla.";
      }
      if (seed == null || n == null || m == null || a == null || c == null || errors.seed) {
        return { errors, hints, body: null };
      }
      return { errors, hints, body: { mode: "rng", seed, n, method: "lcg", a, c, m } };
    }
    const distribution = distributionBody(form.distribution, "dist", errors, hints);
    if (seed == null || n == null || !distribution || Object.keys(errors).length) return { errors, hints, body: null };
    return { errors, hints, body: { mode: "variates", seed, n, distribution } };
  }

  const replications = readCount(
    form.replications,
    "replications",
    "Indica el número de réplicas.",
    "Las réplicas",
    1,
    20000,
    errors,
  );
  if (form.variables.length > 8) errors.variables = "Puedes definir como máximo 8 variables.";
  const variables: { name: string; distribution: DistBody }[] = [];
  const seen = new Set<string>();
  form.variables.forEach((variable, index) => {
    const nameKey = `var:${index}:name`;
    const name = variable.name.trim();
    if (!name) errors[nameKey] = "Ponle un nombre a la variable.";
    else if (!NAME_RE.test(name)) errors[nameKey] = "Empieza con letra o _ y sigue con letras, números o _.";
    else if (RESERVED.has(name)) errors[nameKey] = "Ese nombre es una función. Elige otro.";
    else if (seen.has(name)) errors[nameKey] = "Ese nombre ya está usado.";
    else seen.add(name);
    const distribution = distributionBody(variable.distribution, `var:${index}`, errors, hints);
    if (name && NAME_RE.test(name) && !errors[nameKey] && distribution) {
      variables.push({ name, distribution });
    }
  });
  const expr = expressionError(form.expression, [...seen]);
  if (expr) errors.expression = expr;

  if (seed == null || replications == null || Object.keys(errors).length) return { errors, hints, body: null };
  return {
    errors,
    hints,
    body: { mode: "monte_carlo", seed, replications, variables, expression: form.expression.trim() },
  };
}

export function fmtNum(value: number | null | undefined, digits = 4): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (!Number.isFinite(value)) return "∞";
  return value.toLocaleString("es-MX", { maximumFractionDigits: digits });
}
