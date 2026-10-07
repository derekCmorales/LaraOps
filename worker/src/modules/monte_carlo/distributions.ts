import { SolverError } from "../../errors";
import { nextUnit, sampleExponential } from "./rng";

export const FAMILIES = ["uniform", "exponential", "normal", "triangular", "discrete", "empirical"] as const;
export type Family = (typeof FAMILIES)[number];

export type Distribution =
  | { family: "uniform"; min: number; max: number }
  | { family: "exponential"; lambda: number }
  | { family: "normal"; mean: number; std: number }
  | { family: "triangular"; low: number; mode: number; high: number }
  | { family: "discrete"; values: number[]; probabilities: number[] }
  | { family: "empirical"; data: number[] };

function scope(name: string): string {
  return name ? `En «${name}»` : "En la distribución";
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SolverError(`${scope(name)} falta la distribución (un objeto con family y sus parámetros).`);
  }
  return value as Record<string, unknown>;
}

function requireNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new SolverError(message);
  return value;
}

function numberList(value: unknown, message: string): number[] {
  if (!Array.isArray(value) || value.length === 0) throw new SolverError(message);
  if (value.length > 10000) throw new SolverError(`${message} Hay demasiados valores (máximo 10000).`);
  return value.map((item, index) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new SolverError(`${message} La posición ${index + 1} no es un número finito.`);
    }
    return item;
  });
}

function formatList(values: number[], digits = 4): string {
  const shown = values.slice(0, 8).map((v) => {
    const rounded = Math.round(v * 10 ** digits) / 10 ** digits;
    return String(rounded);
  });
  return values.length > 8 ? `${shown.join(", ")}, …` : shown.join(", ");
}

/**
 * Lee una distribución. Si las probabilidades discretas no suman 1, las normaliza
 * y deja un aviso en `warnings`.
 */
export function parseDistribution(raw: unknown, name: string, warnings: string[]): Distribution {
  const o = asRecord(raw, name);
  const family = o.family;
  if (typeof family !== "string" || !(FAMILIES as readonly string[]).includes(family)) {
    throw new SolverError(
      `${scope(name)} la familia no es válida. Usa uniform, exponential, normal, triangular, discrete o empirical.`,
    );
  }
  const where = scope(name);

  if (family === "uniform") {
    const min = requireNumber(o.min, `${where} falta el mínimo (min) de la uniforme, un número finito.`);
    const max = requireNumber(o.max, `${where} falta el máximo (max) de la uniforme, un número finito.`);
    if (min > max) throw new SolverError(`${where} el mínimo de la uniforme no puede ser mayor que el máximo.`);
    return { family, min, max };
  }

  if (family === "exponential") {
    const lambda = requireNumber(o.lambda, `${where} falta la tasa λ (lambda) de la exponencial.`);
    if (!(lambda > 0)) throw new SolverError(`${where} la tasa λ de la exponencial debe ser mayor que 0.`);
    return { family, lambda };
  }

  if (family === "normal") {
    const mean = requireNumber(o.mean, `${where} falta la media (mean) de la normal.`);
    const std = requireNumber(o.std, `${where} falta la desviación estándar (std) de la normal.`);
    if (!(std > 0)) throw new SolverError(`${where} la desviación estándar de la normal debe ser mayor que 0.`);
    return { family, mean, std };
  }

  if (family === "triangular") {
    const low = requireNumber(o.low, `${where} falta el mínimo (low) de la triangular.`);
    const mode = requireNumber(o.mode, `${where} falta la moda (mode) de la triangular.`);
    const high = requireNumber(o.high, `${where} falta el máximo (high) de la triangular.`);
    if (!(low < high) || mode < low || mode > high) {
      throw new SolverError(
        `${where} la triangular está mal ordenada: se necesita mínimo ≤ moda ≤ máximo, con mínimo < máximo.`,
      );
    }
    return { family, low, mode, high };
  }

  if (family === "discrete") {
    const values = numberList(o.values, `${where} indica los valores de la discreta (values).`);
    const rawProbs = numberList(o.probabilities, `${where} indica las probabilidades de la discreta (probabilities).`);
    if (values.length !== rawProbs.length) {
      throw new SolverError(`${where} la discreta necesita la misma cantidad de valores y de probabilidades.`);
    }
    if (rawProbs.some((p) => p < 0)) {
      throw new SolverError(`${where} las probabilidades de la discreta no pueden ser negativas.`);
    }
    const sum = rawProbs.reduce((acc, p) => acc + p, 0);
    if (!(sum > 0)) throw new SolverError(`${where} las probabilidades de la discreta no pueden ser todas cero.`);
    if (Math.abs(sum - 1) > 1e-3) {
      const shown = Math.round(sum * 1e6) / 1e6;
      warnings.push(
        `${where} las probabilidades sumaban ${shown} y no 1. Se normalizaron dividiendo entre ese total.`,
      );
    }
    const probabilities = rawProbs.map((p) => p / sum);
    return { family, values, probabilities };
  }

  const data = numberList(o.data, `${where} indica los datos de la empírica (data).`);
  return { family: "empirical", data };
}

export function sampleDistribution(dist: Distribution, rng: () => number): number {
  switch (dist.family) {
    case "uniform":
      return dist.min + nextUnit(rng) * (dist.max - dist.min);
    case "exponential":
      return sampleExponential(rng, dist.lambda);
    case "normal": {
      // Box-Muller: dos uniformes por cada normal. Se usa solo una de las dos normales.
      const u1 = nextUnit(rng);
      const u2 = nextUnit(rng);
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return dist.mean + dist.std * z;
    }
    case "triangular": {
      const u = nextUnit(rng);
      const span = dist.high - dist.low;
      const c = (dist.mode - dist.low) / span;
      if (u < c || c === 1) return dist.low + Math.sqrt(u * span * (dist.mode - dist.low));
      return dist.high - Math.sqrt((1 - u) * span * (dist.high - dist.mode));
    }
    case "discrete": {
      const u = nextUnit(rng);
      let acc = 0;
      for (let i = 0; i < dist.values.length; i++) {
        acc += dist.probabilities[i];
        if (u <= acc) return dist.values[i];
      }
      return dist.values[dist.values.length - 1];
    }
    case "empirical": {
      const u = nextUnit(rng);
      const index = Math.min(dist.data.length - 1, Math.floor(u * dist.data.length));
      return dist.data[index];
    }
  }
}

export function theoreticalMoments(dist: Distribution): { mean: number; variance: number } {
  switch (dist.family) {
    case "uniform": {
      const mean = (dist.min + dist.max) / 2;
      const width = dist.max - dist.min;
      return { mean, variance: (width * width) / 12 };
    }
    case "exponential":
      return { mean: 1 / dist.lambda, variance: 1 / (dist.lambda * dist.lambda) };
    case "normal":
      return { mean: dist.mean, variance: dist.std * dist.std };
    case "triangular": {
      const { low: a, mode: b, high: c } = dist;
      const mean = (a + b + c) / 3;
      const variance = (a * a + b * b + c * c - a * b - a * c - b * c) / 18;
      return { mean, variance };
    }
    case "discrete": {
      let mean = 0;
      let second = 0;
      for (let i = 0; i < dist.values.length; i++) {
        const p = dist.probabilities[i];
        mean += p * dist.values[i];
        second += p * dist.values[i] * dist.values[i];
      }
      return { mean, variance: Math.max(0, second - mean * mean) };
    }
    case "empirical": {
      const n = dist.data.length;
      let mean = 0;
      for (const x of dist.data) mean += x;
      mean /= n;
      let second = 0;
      for (const x of dist.data) second += x * x;
      second /= n;
      return { mean, variance: Math.max(0, second - mean * mean) };
    }
  }
}

export function describeDistribution(dist: Distribution): string {
  switch (dist.family) {
    case "uniform":
      return `Uniforme continua entre ${dist.min} y ${dist.max}.`;
    case "exponential":
      return `Exponencial de tasa λ = ${dist.lambda} (media teórica 1/λ = ${1 / dist.lambda}).`;
    case "normal":
      return `Normal de media ${dist.mean} y desviación estándar ${dist.std}.`;
    case "triangular":
      return `Triangular con mínimo ${dist.low}, moda ${dist.mode} y máximo ${dist.high}.`;
    case "discrete":
      return `Discreta con valores ${formatList(dist.values)} y probabilidades ${formatList(dist.probabilities)}.`;
    case "empirical":
      return `Empírica: se remuestrea con reemplazo una lista de ${dist.data.length} datos.`;
  }
}

/** Fórmula de generación, en español, para la tabla «metodo». */
export function inverseFormula(dist: Distribution): string {
  switch (dist.family) {
    case "uniform":
      return "Transformación inversa: X = mínimo + U · (máximo − mínimo), con U uniforme en (0, 1). Si mínimo = máximo, X es esa constante.";
    case "exponential":
      return "Transformación inversa: X = −ln(1 − U) / λ. La media teórica es 1/λ y la varianza es 1/λ².";
    case "normal":
      return "Box-Muller con dos uniformes U1 y U2: Z = √(−2 ln U1) · cos(2π U2) y X = media + desviación · Z. Cada dato consume dos números aleatorios. La media teórica es μ y la varianza es σ².";
    case "triangular":
      return "Transformación inversa. Sea c = (moda − mínimo) / (máximo − mínimo). Si U < c, X = mínimo + √(U · (máximo − mínimo) · (moda − mínimo)); si no, X = máximo − √((1 − U) · (máximo − mínimo) · (máximo − moda)). La media teórica es (mínimo + moda + máximo) / 3.";
    case "discrete":
      return "Transformación inversa: se acumulan las probabilidades (ya normalizadas si no sumaban 1) y se elige el primer valor cuya acumulada alcanza a U.";
    case "empirical":
      return "Remuestreo con reemplazo: el índice es la parte entera de U · n sobre la lista de datos. Cada dato tiene la misma probabilidad.";
  }
}
