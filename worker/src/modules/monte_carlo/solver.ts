import { SolverError } from "../../errors";
import type { GraphXY, ModuleResult, NamedTable } from "../../schema";
import { okResult } from "../../schema";
import {
  describeDistribution,
  inverseFormula,
  parseDistribution,
  sampleDistribution,
  theoreticalMoments,
  type Distribution,
} from "./distributions";
import { RESERVED_NAMES, compileExpression } from "./expr";
import { MULBERRY_INCREMENT, createRng, nextUnit, seedToUint32 } from "./rng";

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Réplicas que se listan una por una: alcanza para revisar a mano un ejercicio de clase. */
const SAMPLE_ROWS = 50;

type Variable = { name: string; distribution: Distribution };

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("El cuerpo debe ser un objeto JSON.");
  }
  return body as Record<string, unknown>;
}

function requireSeed(value: unknown): number {
  if (value == null || value === "") throw new SolverError("Indica la semilla (un número).");
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SolverError("La semilla debe ser un número.");
  }
  return value;
}

function requireInt(value: unknown, missing: string, invalid: string, min: number, max: number): number {
  if (value == null || value === "") throw new SolverError(missing);
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new SolverError(invalid);
  }
  return value;
}

type Bin = { bin: number; freq: number; from: number; to: number; center: number };

function histogram(values: number[], bins: number): Bin[] {
  const nBins = Math.max(1, bins);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  if (!(hi > lo)) {
    const pad = lo === 0 ? 0.5 : Math.abs(lo) * 0.05 || 0.5;
    lo -= pad;
    hi += pad;
  }
  const width = (hi - lo) / nBins;
  const freq = Array.from({ length: nBins }, () => 0);
  for (const v of values) {
    let idx = Math.floor((v - lo) / width);
    if (idx < 0) idx = 0;
    if (idx >= nBins) idx = nBins - 1;
    freq[idx] += 1;
  }
  return freq.map((count, i) => {
    const from = lo + i * width;
    const to = from + width;
    return { bin: i + 1, freq: count, from, to, center: (from + to) / 2 };
  });
}

function histogramTable(bins: Bin[]): NamedTable {
  return {
    name: "histogram",
    columns: ["bin", "frecuencia", "desde", "hasta"],
    rows: bins.map((b) => [b.bin, b.freq, b.from, b.to]),
  };
}

function histogramGraph(bins: Bin[], title: string, subtitle: string): GraphXY {
  return {
    type: "xy",
    kind: "histogram",
    title,
    subtitle,
    x_label: "Centro del intervalo",
    y_label: "Frecuencia",
    series: [{ name: "histograma", x: bins.map((b) => b.center), y: bins.map((b) => b.freq) }],
  };
}

/** Percentil por interpolación lineal (tipo 7). `p` está en 0..1. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - h) + sorted[hi] * (h - lo);
}

function sampleStats(values: number[]): { mean: number; variance: number; std: number; min: number; max: number } {
  const n = values.length;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  let ss = 0;
  for (const v of values) {
    const d = v - mean;
    ss += d * d;
  }
  const variance = n > 1 ? ss / (n - 1) : 0;
  return { mean, variance, std: Math.sqrt(variance), min, max };
}

function rngMethodTable(seed32: number): NamedTable {
  return {
    name: "metodo",
    columns: ["concepto", "detalle"],
    rows: [
      ["Método", "Mulberry32: un contador de 32 bits cuyos bits se mezclan. No usa el azar del navegador. Para seguir a mano el método de libro (xᵢ = (a·xᵢ₋₁ + c) mod m) elige el congruencial lineal."],
      [
        "Recurrencia",
        `El estado s es un entero de 32 bits. Se parte de s₀ = ${seed32} (la semilla pasada a 32 bits sin signo) y cada número hace s ← (s + ${MULBERRY_INCREMENT}) módulo 2³². ${MULBERRY_INCREMENT} es el hexadecimal 6D2B79F5.`,
      ],
      [
        "De estado a uniforme",
        "No se devuelve s crudo. Se mezcla: t = (s xor (s desplazado 15 bits)) × (s or 1), en 32 bits; luego t = t xor (t + (t xor (t desplazado 7 bits)) × (t or 61)); U = (t xor (t desplazado 14 bits)) / 2³². U cae en [0, 1). Si sale exactamente 0, la muestra lo cambia por 1/2³² para que ln(1−U) exista.",
      ],
      [
        "Qué esperar",
        "Si U es uniforme en (0, 1), la media teórica es 1/2 y la varianza es 1/12 ≈ 0.083333. Con muchas muestras, la media y la varianza muestral se acercan a esos valores. La misma semilla repite la misma lista.",
      ],
    ],
  };
}

function solveRng(o: Record<string, unknown>): ModuleResult {
  const seed = requireSeed(o.seed);
  const n = requireInt(
    o.n,
    "Indica cuántos números U(0, 1) generar (n).",
    "n debe ser un entero entre 1 y 5000.",
    1,
    5000,
  );
  const method = o.method ?? "mulberry32";
  if (method === "lcg" || method === "congruencial") return solveLcg(o, n);
  if (method !== "mulberry32") {
    throw new SolverError("El método debe ser «lcg» (congruencial lineal con a, c y m) o «mulberry32».");
  }
  const seed32 = seedToUint32(seed);
  const rng = createRng(seed);
  const values: number[] = [];
  for (let i = 0; i < n; i++) values.push(nextUnit(rng));
  const stats = sampleStats(values);
  const bins = histogram(values, 10);
  const metrics = {
    mean: stats.mean,
    variance: stats.variance,
    std: stats.std,
    min: stats.min,
    max: stats.max,
    n,
    theoretical_mean: 0.5,
    theoretical_variance: 1 / 12,
  };
  const sampleRows = values.slice(0, Math.min(n, 30)).map((u, i) => [i + 1, u]);
  return okResult("monte_carlo", {
    objective_value: stats.mean,
    objective_sense: null,
    variables: { ...metrics },
    metrics,
    graph: histogramGraph(bins, "Histograma de U(0, 1)", `${n} números · semilla ${seed32}`),
    tables: [
      { name: "contexto", columns: ["clave", "valor"], rows: [["modo", "rng"], ["semilla", seed32], ["n", n], ["metodo", "mulberry32"]] },
      { name: "muestra", columns: ["i", "u"], rows: sampleRows },
      histogramTable(bins),
      rngMethodTable(seed32),
    ],
    warnings: [],
  });
}

const LCG_M_MAX = 2 ** 32;

function lcgParam(value: unknown, name: string, fallback: number, min: number, max: number): number {
  if (value == null || value === "") return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new SolverError(`${name} debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}

function gcdInt(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

function primeFactors(m: number): number[] {
  const out: number[] = [];
  let rest = m;
  for (let p = 2; p * p <= rest; p++) {
    if (rest % p === 0) {
      out.push(p);
      while (rest % p === 0) rest /= p;
    }
  }
  if (rest > 1) out.push(rest);
  return out;
}

/**
 * Congruencial lineal de libro: xᵢ = (a·xᵢ₋₁ + c) mod m y Uᵢ = xᵢ / m.
 * Se calcula con BigInt para que a·x no pierda dígitos aunque m llegue a 2³².
 * Por omisión usa los parámetros de Numerical Recipes (a = 1664525, c = 1013904223, m = 2³²).
 */
function solveLcg(o: Record<string, unknown>, n: number): ModuleResult {
  const m = lcgParam(o.m, "El módulo m", LCG_M_MAX, 2, LCG_M_MAX);
  const a = lcgParam(o.a, "El multiplicador a", m === LCG_M_MAX ? 1664525 : 1, 1, m - 1);
  const c = lcgParam(o.c, "El incremento c", m === LCG_M_MAX ? 1013904223 : 0, 0, m - 1);
  const seed = o.seed;
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed >= m) {
    throw new SolverError(`La semilla x₀ debe ser un entero entre 0 y m − 1 = ${m - 1}.`);
  }
  if (c === 0 && seed === 0) {
    throw new SolverError("Con c = 0 la semilla 0 produce siempre 0. Usa una semilla distinta de 0.");
  }
  const warnings: string[] = [];
  const A = BigInt(a);
  const Cb = BigInt(c);
  const M = BigInt(m);
  let x = BigInt(seed);
  const values: number[] = [];
  const steps: unknown[][] = [];
  const seenAt = new Map<bigint, number>([[x, 0]]);
  let period: number | null = null;
  for (let i = 1; i <= n; i++) {
    const raw = A * x + Cb;
    const next = raw % M;
    const u = Number(next) / m;
    values.push(u);
    if (i <= SAMPLE_ROWS) steps.push([i, Number(x), raw.toString(), Number(next), u]);
    x = next;
    if (period == null) {
      const first = seenAt.get(x);
      if (first != null) period = i - first;
      else seenAt.set(x, i);
    }
  }

  // Hull y Dobell: con c > 0 el periodo es m exactamente cuando se cumplen las tres condiciones.
  const factors = primeFactors(m);
  const conditions: unknown[][] = [];
  if (c > 0) {
    const coprime = gcdInt(c, m) === 1;
    const byPrimes = factors.every((p) => (a - 1) % p === 0);
    const byFour = m % 4 !== 0 || (a - 1) % 4 === 0;
    conditions.push(
      ["c y m sin factores comunes (mcd(c, m) = 1)", coprime ? "sí" : "no", `mcd(${c}, ${m}) = ${gcdInt(c, m)}`],
      [
        "a − 1 divisible entre cada primo que divide a m",
        byPrimes ? "sí" : "no",
        `primos de m: ${factors.join(", ")}; a − 1 = ${a - 1}`,
      ],
      ["si 4 divide a m, 4 divide a a − 1", byFour ? "sí" : "no", m % 4 === 0 ? `a − 1 = ${a - 1}` : "4 no divide a m"],
      ["Periodo completo (m)", coprime && byPrimes && byFour ? "sí" : "no", `m = ${m}`],
    );
  } else {
    conditions.push([
      "Multiplicativo (c = 0)",
      "—",
      "El periodo nunca llega a m porque el 0 no aparece; como máximo es m − 1, y solo si m es primo y a es raíz primitiva.",
    ]);
  }
  if (period != null && period < n) {
    warnings.push(
      `El generador se repite cada ${period} números: después del número ${period} la lista vuelve a empezar. Para más variedad usa un m más grande o parámetros con periodo completo.`,
    );
  }

  const stats = sampleStats(values);
  const bins = histogram(values, 10);
  const metrics: Record<string, number> = {
    mean: stats.mean,
    variance: stats.variance,
    std: stats.std,
    min: stats.min,
    max: stats.max,
    n,
    theoretical_mean: 0.5,
    theoretical_variance: 1 / 12,
    a,
    c,
    m,
  };
  if (period != null) metrics.period = period;
  return okResult("monte_carlo", {
    objective_value: stats.mean,
    objective_sense: null,
    variables: { ...metrics },
    metrics,
    graph: histogramGraph(bins, "Histograma de U(0, 1)", `${n} números · x₀ = ${seed} · a = ${a}, c = ${c}, m = ${m}`),
    tables: [
      {
        name: "contexto",
        columns: ["clave", "valor"],
        rows: [
          ["modo", "rng"],
          ["semilla", seed],
          ["n", n],
          ["metodo", "lcg"],
        ],
      },
      { name: "pasos_lcg", columns: ["i", "x_anterior", "a_x_mas_c", "x_i", "u_i"], rows: steps },
      { name: "muestra", columns: ["i", "u"], rows: values.slice(0, SAMPLE_ROWS).map((u, i) => [i + 1, u]) },
      histogramTable(bins),
      { name: "periodo", columns: ["condicion", "cumple", "detalle"], rows: conditions },
      {
        name: "metodo",
        columns: ["concepto", "detalle"],
        rows: [
          ["Método", "Congruencial lineal: xᵢ = (a·xᵢ₋₁ + c) mod m, y cada número es Uᵢ = xᵢ / m."],
          ["Parámetros", `a = ${a}, c = ${c}, m = ${m}, semilla x₀ = ${seed}.`],
          [
            "Periodo",
            period == null
              ? `En los ${n} números generados no se repitió ningún estado.`
              : `El estado se repite después de ${period} números: ese es el periodo observado.`,
          ],
          [
            "Qué esperar",
            "Si U es uniforme en (0, 1), la media teórica es 1/2 y la varianza es 1/12 ≈ 0.083333. Un m pequeño repite pronto la lista; por eso los generadores reales usan m grande.",
          ],
        ],
      },
    ],
    warnings,
  });
}

function solveVariates(o: Record<string, unknown>): ModuleResult {
  const seed = requireSeed(o.seed);
  const n = requireInt(
    o.n,
    "Indica el tamaño de la muestra (n).",
    "n debe ser un entero entre 1 y 20000.",
    1,
    20000,
  );
  const warnings: string[] = [];
  if (o.distribution == null) throw new SolverError("Indica la distribución (distribution).");
  const dist = parseDistribution(o.distribution, "", warnings);
  const seed32 = seedToUint32(seed);
  const rng = createRng(seed);
  const values: number[] = [];
  for (let i = 0; i < n; i++) values.push(sampleDistribution(dist, rng));
  const stats = sampleStats(values);
  const theory = theoreticalMoments(dist);
  const bins = histogram(values, 15);
  const metrics = {
    mean: stats.mean,
    std: stats.std,
    min: stats.min,
    max: stats.max,
    n,
    theoretical_mean: theory.mean,
    theoretical_variance: theory.variance,
  };
  return okResult("monte_carlo", {
    objective_value: stats.mean,
    objective_sense: null,
    variables: { ...metrics },
    metrics,
    graph: histogramGraph(
      bins,
      "Histograma de la muestra",
      `${describeDistribution(dist)} n = ${n}`,
    ),
    tables: [
      {
        name: "contexto",
        columns: ["clave", "valor"],
        rows: [
          ["modo", "variates"],
          ["semilla", seed32],
          ["n", n],
          ["familia", dist.family],
        ],
      },
      {
        name: "muestra",
        columns: ["i", "x"],
        rows: values.slice(0, Math.min(n, 20)).map((x, i) => [i + 1, x]),
      },
      histogramTable(bins),
      {
        name: "metodo",
        columns: ["concepto", "detalle"],
        rows: [
          ["Distribución", describeDistribution(dist)],
          ["Fórmula", inverseFormula(dist)],
          [
            "Teoría",
            `Media teórica ${theory.mean}. Varianza teórica ${theory.variance}. La media y la desviación de la tabla son las de la muestra (la desviación divide entre n−1).`,
          ],
        ],
      },
    ],
    warnings,
  });
}

/**
 * Tabla clásica de asignación de números aleatorios: a cada valor de una discreta le toca
 * el tramo de U entre la acumulada anterior y la suya.
 */
function rangeTables(variables: Variable[]): NamedTable[] {
  const rows: unknown[][] = [];
  for (const variable of variables) {
    const dist = variable.distribution;
    if (dist.family !== "discrete") continue;
    let acc = 0;
    dist.values.forEach((value, i) => {
      const from = acc;
      acc += dist.probabilities[i];
      const to = i === dist.values.length - 1 ? 1 : acc;
      rows.push([variable.name, value, dist.probabilities[i], to, from, to]);
    });
  }
  if (!rows.length) return [];
  return [
    {
      name: "rangos",
      columns: ["variable", "valor", "probabilidad", "acumulada", "u_desde", "u_hasta"],
      rows,
    },
  ];
}

function parseVariables(raw: unknown, warnings: string[]): Variable[] {
  if (!Array.isArray(raw)) throw new SolverError("Indica la lista de variables (puede ir vacía si la fórmula no usa azar).");
  if (raw.length > 8) throw new SolverError("Puedes definir como máximo 8 variables aleatorias.");
  const seen = new Set<string>();
  const variables: Variable[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new SolverError("Cada variable debe ser un objeto con name y distribution.");
    }
    const row = item as Record<string, unknown>;
    const name = row.name;
    if (typeof name !== "string" || !NAME_RE.test(name)) {
      throw new SolverError(
        "El nombre de cada variable debe empezar con letra o guion bajo y seguir con letras, números o guion bajo.",
      );
    }
    if (RESERVED_NAMES.has(name)) {
      throw new SolverError(`«${name}» es una función (min, max, abs, sqrt, floor, ceil). Elige otro nombre.`);
    }
    if (seen.has(name)) throw new SolverError(`El nombre «${name}» está repetido.`);
    seen.add(name);
    if (row.distribution == null) throw new SolverError(`La variable «${name}» no tiene distribución.`);
    variables.push({ name, distribution: parseDistribution(row.distribution, name, warnings) });
  }
  return variables;
}

function solveMonteCarlo(o: Record<string, unknown>): ModuleResult {
  const seed = requireSeed(o.seed);
  const replications = requireInt(
    o.replications,
    "Indica el número de réplicas.",
    "El número de réplicas debe ser un entero entre 1 y 20000.",
    1,
    20000,
  );
  if (typeof o.expression !== "string") throw new SolverError("Indica la expresión del resultado.");
  const warnings: string[] = [];
  const variables = parseVariables(o.variables, warnings);
  const names = new Set(variables.map((v) => v.name));
  const compiled = compileExpression(o.expression, names);
  for (const variable of variables) {
    if (!compiled.used.includes(variable.name)) {
      warnings.push(
        `La variable «${variable.name}» no aparece en la fórmula. Igual se sortea en cada réplica, pero no cambia el resultado.`,
      );
    }
  }

  const seed32 = seedToUint32(seed);
  const rng = createRng(seed);
  const valid: number[] = [];
  let invalid = 0;
  const sampleRows: unknown[][] = [];
  for (let r = 0; r < replications; r++) {
    const env: Record<string, number> = {};
    for (const variable of variables) env[variable.name] = sampleDistribution(variable.distribution, rng);
    const y = compiled.evaluate(env);
    if (Number.isFinite(y)) valid.push(y);
    else invalid += 1;
    if (r < SAMPLE_ROWS) {
      sampleRows.push([
        r + 1,
        ...variables.map((variable) => env[variable.name]),
        Number.isFinite(y) ? y : "indefinido",
      ]);
    }
  }
  if (invalid > 0) {
    warnings.push(
      `${invalid} de ${replications} réplicas dieron un resultado no numérico (infinito o indefinido), por ejemplo una división entre cero o una raíz de un negativo. Esas réplicas no entran en la media ni en los percentiles.`,
    );
  }
  if (valid.length === 0) {
    throw new SolverError(
      "Todas las réplicas dieron un resultado no numérico (infinito o indefinido). Revisa divisiones entre cero y raíces de números negativos.",
    );
  }

  const stats = sampleStats(valid);
  const n = valid.length;
  if (n < 30) {
    warnings.push(
      `Solo hay ${n} réplica${n === 1 ? "" : "s"} válida${n === 1 ? "" : "s"}. Sirve para seguir el método a mano, pero el intervalo del 95% supone una muestra grande (30 o más) y aquí es solo orientativo.`,
    );
  }
  const stderr = stats.std / Math.sqrt(n);
  const sorted = [...valid].sort((a, b) => a - b);
  const p05 = percentile(sorted, 0.05);
  const p25 = percentile(sorted, 0.25);
  const p50 = percentile(sorted, 0.5);
  const p75 = percentile(sorted, 0.75);
  const p95 = percentile(sorted, 0.95);
  const metrics = {
    mean: stats.mean,
    std: stats.std,
    stderr,
    ci95_low: stats.mean - 1.96 * stderr,
    ci95_high: stats.mean + 1.96 * stderr,
    p05,
    p25,
    p50,
    p75,
    p95,
    min: stats.min,
    max: stats.max,
    replications,
    valid_replications: n,
  };
  const bins = histogram(valid, 15);
  const methodRows: unknown[][] = variables.map((variable) => [
    variable.name,
    `${describeDistribution(variable.distribution)} ${inverseFormula(variable.distribution)}`,
  ]);
  methodRows.push(["Fórmula", o.expression.trim()]);
  methodRows.push([
    "Estimación",
    "Las variables se sortean independientes en cada réplica. La media es el promedio de las réplicas válidas. El error estándar es s / √n y el intervalo del 95% es media ± 1.96 s / √n, con s la desviación muestral (divide entre n−1).",
  ]);

  return okResult("monte_carlo", {
    objective_value: stats.mean,
    objective_sense: null,
    variables: { ...metrics },
    metrics,
    graph: histogramGraph(
      bins,
      "Histograma del resultado",
      `${n} réplicas válidas · semilla ${seed32}`,
    ),
    tables: [
      {
        name: "contexto",
        columns: ["clave", "valor"],
        rows: [
          ["modo", "monte_carlo"],
          ["semilla", seed32],
          ["replicas", replications],
          ["expresion", o.expression.trim()],
        ],
      },
      {
        name: "muestra",
        columns: ["réplica", ...variables.map((variable) => variable.name), "resultado"],
        rows: sampleRows,
      },
      {
        name: "percentiles",
        columns: ["percentil", "valor"],
        rows: [
          [5, p05],
          [25, p25],
          [50, p50],
          [75, p75],
          [95, p95],
        ],
      },
      histogramTable(bins),
      ...rangeTables(variables),
      { name: "metodo", columns: ["elemento", "detalle"], rows: methodRows },
    ],
    warnings,
  });
}

export function solve(body: unknown): ModuleResult {
  const o = asRecord(body);
  const mode = o.mode;
  if (mode !== "rng" && mode !== "variates" && mode !== "monte_carlo") {
    throw new SolverError("El modo debe ser «rng», «variates» o «monte_carlo».");
  }
  if (mode === "rng") return solveRng(o);
  if (mode === "variates") return solveVariates(o);
  return solveMonteCarlo(o);
}
