/**
 * Número de la forma a + b·M, con M "muy grande". Sirve para el método de la Gran M sin
 * fijar un valor numérico de M: se compara primero la parte en M y luego la constante.
 */
export type MNum = { a: number; m: number };

const TOL = 1e-9;

export const ZERO: MNum = { a: 0, m: 0 };

export function mnum(a: number, m = 0): MNum {
  return { a: snapFast(a), m: snapFast(m) };
}

/** Versión barata de snap para el bucle de pivoteo: ceros y enteros casi exactos. */
export function snapFast(x: number): number {
  if (Math.abs(x) < 1e-11) return 0;
  const r = Math.round(x);
  if (Math.abs(x - r) < 1e-9 * Math.max(1, Math.abs(x))) return r;
  return x;
}

export function snap(x: number): number {
  if (!Number.isFinite(x)) return x;
  if (Math.abs(x) < 1e-11) return 0;
  const r = Math.round(x);
  if (Math.abs(x - r) < 1e-9 * Math.max(1, Math.abs(x))) return r;
  // Quita colas de punto flotante (2.3999999999999995 -> 2.4).
  return Number(x.toPrecision(12));
}

export function add(x: MNum, y: MNum): MNum {
  return mnum(x.a + y.a, x.m + y.m);
}

export function sub(x: MNum, y: MNum): MNum {
  return mnum(x.a - y.a, x.m - y.m);
}

export function scale(x: MNum, k: number): MNum {
  return mnum(x.a * k, x.m * k);
}

/** Signo de x: compara primero la parte en M. */
export function sign(x: MNum, tol = TOL): -1 | 0 | 1 {
  if (x.m > tol) return 1;
  if (x.m < -tol) return -1;
  if (x.a > tol) return 1;
  if (x.a < -tol) return -1;
  return 0;
}

export function cmp(x: MNum, y: MNum, tol = TOL): -1 | 0 | 1 {
  return sign(sub(x, y), tol);
}

export function isZero(x: MNum, tol = TOL): boolean {
  return sign(x, tol) === 0;
}

export function hasM(x: MNum, tol = TOL): boolean {
  return Math.abs(x.m) > tol;
}

export function fmtPlain(x: number): string {
  const v = snap(x);
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toFixed(4)));
}

/** Texto legible: "3", "-M", "1.1M - 0.4", "2M". */
export function fmtM(x: MNum): string {
  const m = snap(x.m);
  const a = snap(x.a);
  if (Math.abs(m) < TOL) return fmtPlain(a);
  const coef = Math.abs(m);
  const mText = `${Math.abs(coef - 1) < TOL ? "" : fmtPlain(coef)}M`;
  const head = m < 0 ? `-${mText}` : mText;
  if (Math.abs(a) < TOL) return head;
  return `${head} ${a < 0 ? "-" : "+"} ${fmtPlain(Math.abs(a))}`;
}

/** Valor para tablas: número si no hay M, texto si lo hay. */
export function cell(x: MNum): number | string {
  return hasM(x) ? fmtM(x) : snap(x.a);
}
