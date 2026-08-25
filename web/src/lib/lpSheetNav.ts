import type { Cell, SheetMatrix } from "./sheetAdapters";

export const CONSTRAINT_SENSES = ["≤", "=", "≥"] as const;
export const OBJECTIVE_SENSES = ["Máx", "Mín"] as const;

export type SenseValue = (typeof CONSTRAINT_SENSES)[number] | (typeof OBJECTIVE_SENSES)[number];

export type LpCellKind =
  | "header-label"
  | "header-var"
  | "header-sense"
  | "header-rhs"
  | "obj-label"
  | "obj-coef"
  | "obj-sense"
  | "obj-rhs"
  | "con-label"
  | "con-coef"
  | "con-sense"
  | "con-rhs";

export type SenseChoice = {
  value: string;
  symbol: string;
  caption: string;
  keys: string;
};

export const CONSTRAINT_CHOICES: SenseChoice[] = [
  { value: "≤", symbol: "≤", caption: "Menor o igual", keys: "<  ," },
  { value: "=", symbol: "=", caption: "Igual", keys: "=" },
  { value: "≥", symbol: "≥", caption: "Mayor o igual", keys: ">" },
];

export const OBJECTIVE_CHOICES: SenseChoice[] = [
  { value: "Máx", symbol: "Máx", caption: "Maximizar Z", keys: "1  +" },
  { value: "Mín", symbol: "Mín", caption: "Minimizar Z", keys: "2  −" },
];

export function isEmptyCell(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return String(value).trim() === "";
}

export function classifyLpCell(rowIndex: number, colIndex: number, colCount: number): LpCellKind {
  const senseCol = colCount - 2;
  const rhsCol = colCount - 1;
  if (rowIndex === 0) {
    if (colIndex === 0) return "header-label";
    if (colIndex === senseCol) return "header-sense";
    if (colIndex === rhsCol) return "header-rhs";
    return "header-var";
  }
  if (rowIndex === 1) {
    if (colIndex === 0) return "obj-label";
    if (colIndex === senseCol) return "obj-sense";
    if (colIndex === rhsCol) return "obj-rhs";
    return "obj-coef";
  }
  if (colIndex === 0) return "con-label";
  if (colIndex === senseCol) return "con-sense";
  if (colIndex === rhsCol) return "con-rhs";
  return "con-coef";
}

export function defaultLpValue(kind: LpCellKind, colIndex: number, rowIndex: number): Cell {
  switch (kind) {
    case "header-label":
      return "Fila";
    case "header-var":
      return `x${colIndex}`;
    case "header-sense":
      return "Sentido";
    case "header-rhs":
      return "LD";
    case "obj-label":
      return "Objetivo (Z)";
    case "obj-coef":
      return 0;
    case "obj-sense":
      return "Máx";
    case "obj-rhs":
      return "";
    case "con-label":
      return `R${Math.max(1, rowIndex - 1)}`;
    case "con-coef":
      return 0;
    case "con-sense":
      return "≤";
    case "con-rhs":
      return 0;
  }
}

export function matchSenseInput(raw: string, isObjective: boolean): string | null {
  const t = raw.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (!t) return null;
  if (isObjective) {
    if (["1", "+", "x", "max", "maximo", "maximizar"].includes(t)) return "Máx";
    if (["2", "-", "n", "min", "minimo", "minimizar"].includes(t)) return "Mín";
    if (t === "máx" || t === "max") return "Máx";
    if (t === "mín" || t === "min") return "Mín";
    return null;
  }
  if (["1", "<", "<=", "=<", "≤", ",", "l", "le"].includes(t)) return "≤";
  if (["2", "=", "==", "e", "eq"].includes(t)) return "=";
  if (["3", ">", ">=", "=>", "≥", ".", "g", "ge"].includes(t)) return "≥";
  return null;
}

export function coerceLpValue(kind: LpCellKind, raw: unknown, colIndex: number, rowIndex: number): Cell {
  if (isEmptyCell(raw)) {
    return defaultLpValue(kind, colIndex, rowIndex);
  }
  if (kind === "obj-sense" || kind === "con-sense") {
    const parsed = matchSenseInput(String(raw), kind === "obj-sense");
    return parsed ?? defaultLpValue(kind, colIndex, rowIndex);
  }
  if (kind === "obj-coef" || kind === "con-coef" || kind === "con-rhs") {
    const n = Number(String(raw).trim().replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  if (kind === "header-var" || kind === "con-label") {
    return String(raw).trim();
  }
  return raw as Cell;
}

export function senseChoicesForRow(rowIndex: number): SenseChoice[] {
  if (rowIndex === 1) return OBJECTIVE_CHOICES;
  return CONSTRAINT_CHOICES;
}

export function blankLpConstraintRow(colCount: number, constraintNumber: number): Cell[] {
  const varCount = Math.max(0, colCount - 3);
  return [`R${constraintNumber}`, ...Array.from({ length: varCount }, () => 0), "≤", 0];
}

export function fillLpMatrixEmpties(matrix: SheetMatrix): SheetMatrix {
  const width = Math.max(1, ...matrix.map((r) => r.length));
  return matrix.map((row, ri) => {
    const next: Cell[] = Array.from({ length: width }, (_, ci) => row[ci] ?? "");
    return next.map((cell, ci) => {
      const kind = classifyLpCell(ri, ci, width);
      if (kind === "obj-rhs") return isEmptyCell(cell) ? "" : cell;
      return isEmptyCell(cell) ? defaultLpValue(kind, ci, ri) : cell;
    });
  });
}
