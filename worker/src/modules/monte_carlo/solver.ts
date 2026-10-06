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
      ["Método", "Congruencial de 32 bits (Mulberry32). No se usa el azar del navegador."],
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
  if (o.method != null && o.method !== "congruencial") {
    throw new SolverError("El único método disponible es «congruencial» (Mulberry32).");
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
      { name: "contexto", columns: ["clave", "valor"], rows: [["modo", "rng"], ["semilla", seed32], ["n", n], ["metodo", "congruencial"]] },
      { name: "muestra", columns: ["i", "u"], rows: sampleRows },
      histogramTable(bins),
      rngMethodTable(seed32),
    ],
    warnings: [],
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
    "El número de réplicas debe ser un entero entre 100 y 20000.",
    100,
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
    if (r < 15) {
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
