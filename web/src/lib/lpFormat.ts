/** Formato de números para tablas simplex: decimales o fracciones, y expresiones con M. */

export type MNum = { a: number; m: number };

export type NumberMode = "decimal" | "fraction";

/** Aproxima x por una fracción con denominador <= maxDen (fracciones continuas). */
export function toFraction(x: number, maxDen = 1000): { num: number; den: number } | null {
  if (!Number.isFinite(x)) return null;
  if (Number.isInteger(x)) return { num: x, den: 1 };
  const sign = x < 0 ? -1 : 1;
  let v = Math.abs(x);
  let h0 = 0;
  let h1 = 1;
  let k0 = 1;
  let k1 = 0;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(v);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    if (Math.abs(Math.abs(x) - h1 / k1) < 1e-9 * Math.max(1, Math.abs(x))) {
      return { num: sign * h1, den: k1 };
    }
    const frac = v - a;
    if (frac < 1e-12) break;
    v = 1 / frac;
  }
  if (k1 > 0 && Math.abs(Math.abs(x) - h1 / k1) < 1e-9 * Math.max(1, Math.abs(x))) return { num: sign * h1, den: k1 };
  return null;
}

export function fmtNumber(x: number, mode: NumberMode = "decimal"): string {
  if (!Number.isFinite(x)) return x > 0 ? "∞" : "-∞";
  const v = Math.abs(x) < 1e-10 ? 0 : x;
  if (mode === "fraction") {
    const f = toFraction(v);
    if (f) return f.den === 1 ? String(f.num) : `${f.num}/${f.den}`;
  }
  return v.toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

function isMNum(v: unknown): v is MNum {
  return !!v && typeof v === "object" && "a" in (v as object) && "m" in (v as object);
}

/** "1.1M − 0.4", "−M", "3/2" ... */
export function fmtMNum(v: MNum, mode: NumberMode = "decimal"): string {
  const m = Math.abs(v.m) < 1e-10 ? 0 : v.m;
  const a = Math.abs(v.a) < 1e-10 ? 0 : v.a;
  if (m === 0) return fmtNumber(a, mode);
  const mag = Math.abs(m);
  let coef = Math.abs(mag - 1) < 1e-10 ? "" : fmtNumber(mag, mode);
  if (coef.includes("/")) coef = `(${coef})`;
  const head = `${m < 0 ? "−" : ""}${coef}M`;
  if (a === 0) return head;
  return `${head} ${a < 0 ? "−" : "+"} ${fmtNumber(Math.abs(a), mode)}`;
}

/** Formatea una celda de tabla que puede ser número, texto o {a, m}. */
export function fmtCell(v: unknown, mode: NumberMode = "decimal"): string {
  if (v == null || v === "") return "";
  if (typeof v === "number") return fmtNumber(v, mode);
  if (isMNum(v)) return fmtMNum(v, mode);
  return String(v).replace(/(^|\s)-(?=[\dM(])/g, "$1−");
}

/** Interpreta un rango del API: número o "∞" / "-∞". */
export function rangeValue(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (s === "∞" || s === "+∞" || s === "M") return Number.POSITIVE_INFINITY;
  if (s === "-∞" || s === "−∞" || s === "-M") return Number.NEGATIVE_INFINITY;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}
