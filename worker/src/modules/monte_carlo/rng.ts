/**
 * Mulberry32 (Tommy Ettinger): generador congruencial de 32 bits.
 *
 * No usa Math.random. La misma semilla produce la misma sucesión.
 *
 * Estado: entero sin signo de 32 bits.
 *   s₀ = semilla convertida a uint32
 *   s ← (s + 0x6D2B79F5) mod 2³²
 * La constante 0x6D2B79F5 es 1 831 565 813.
 *
 * De cada estado se mezcla (xor y productos en 32 bits) y se devuelve
 *   U = t / 2³²  ∈ [0, 1).
 * El 0, si aparece, se sustituye al pedir un uniforme abierto para que
 * ln(1−U) esté definido.
 */

export const MULBERRY_INCREMENT = 0x6d2b79f5;

/** Entero de 32 bits sin signo. Los negativos y los decimales se truncan. */
export function seedToUint32(seed: number): number {
  return seed >>> 0;
}

export function createRng(seed: number): () => number {
  let s = seedToUint32(seed);
  return () => {
    s = (s + MULBERRY_INCREMENT) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniforme en (0, 1). Evita el 0 y el 1 para las transformaciones con logaritmo. */
export function nextUnit(rng: () => number): number {
  const u = rng();
  if (!(u > 0) || u >= 1) return 1 / 4294967296;
  return u;
}

/** Exponencial de tasa `rate` (media 1/rate): −ln(1−U) / rate. */
export function sampleExponential(rng: () => number, rate: number): number {
  return -Math.log(1 - nextUnit(rng)) / rate;
}
