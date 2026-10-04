export type Cell = string | number | null;
export type SheetMatrix = Cell[][];

function pertNumber(v: Cell, label: string): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`${label} no es un número válido. Escribe un valor como 4 o 1,5.`);
    return v;
  }
  const t = String(v).trim();
  if (!t) return null;
  if (/invalid number|número no válido|numero no valido/i.test(t)) {
    throw new Error(`${label} no es un número válido. Vuelve a escribirla, por ejemplo 4 o 1,5.`);
  }
  const n = Number(t.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`${label} no es un número válido. Escribe un valor como 4 o 1,5.`);
  return n;
}

function num(v: Cell, fallback = 0): number {
  if (v === null || v === "") return fallback;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Número inválido: ${v}`);
    return v;
  }
  const t = String(v).trim();
  if (t === "") return fallback;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`La celda "${t}" no es un número`);
  return n;
}

function str(v: Cell): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** EOQ: Parámetro | Valor */
export function eoqToSheet(body: { D: number; S: number; H: number; C: number }): SheetMatrix {
  return [
    ["Parámetro", "Valor"],
    ["D (demanda anual)", body.D],
    ["S (costo de ordenar)", body.S],
    ["H (costo de mantener)", body.H],
    ["C (costo unitario)", body.C],
  ];
}

export function sheetToEoq(matrix: SheetMatrix): { D: number; S: number; H: number; C: number } {
  const map: Record<string, number> = {};
  for (const row of matrix.slice(1)) {
    if (!row?.length) continue;
    const key = str(row[0]).toUpperCase();
    const letter = key.charAt(0);
    if ("DSHC".includes(letter)) map[letter] = num(row[1]);
  }
  return {
    D: map.D ?? 0,
    S: map.S ?? 0,
    H: map.H ?? 0,
    C: map.C ?? 0,
  };
}

export type LpBody = {
  sense: "min" | "max";
  objective: Record<string, number>;
  constraints: { id: string; coeffs: Record<string, number>; sense: string; rhs: number }[];
  variable_names?: string[];
  include_iterations?: boolean;
  include_sensitivity?: boolean;
  include_graph?: boolean;
  graph_variables?: string[];
};

const LP_OBJECTIVE_LABEL = "Objetivo (Z)";

function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
}

function parseObjectiveSense(raw: string): "min" | "max" {
  const k = normKey(raw);
  if (["min", "minimo", "minimizar", "minimizacion"].includes(k)) return "min";
  return "max";
}

function formatObjectiveSense(sense: "min" | "max"): string {
  return sense === "min" ? "Mín" : "Máx";
}

function parseConstraintSense(raw: string): string {
  const t = raw.trim();
  if (t === "≤" || t === "<=" || t === "=<") return "<=";
  if (t === "≥" || t === ">=" || t === "=>") return ">=";
  if (t === "=" || t === "==") return "=";
  const k = normKey(raw);
  if (k.includes("menor") || k === "le") return "<=";
  if (k.includes("mayor") || k === "ge") return ">=";
  if (k.includes("igual") || k === "eq") return "=";
  return "<=";
}

function formatConstraintSense(sense: string): string {
  if (sense === "<=") return "≤";
  if (sense === ">=") return "≥";
  if (sense === "=") return "=";
  return sense;
}

function isObjectiveRowLabel(cell: string): boolean {
  const k = normKey(cell);
  return k.startsWith("z") || k.includes("objetivo");
}

/** Plantilla vacía LP: 2 variables, 1 restricción. */
export function emptyLpSheet(varCount = 2, constraintCount = 1): SheetMatrix {
  const vars = Array.from({ length: varCount }, (_, i) => `x${i + 1}`);
  const header: Cell[] = ["Fila", ...vars, "Sentido", "LD"];
  const obj: Cell[] = [LP_OBJECTIVE_LABEL, ...vars.map(() => 0), "Máx", ""];
  const rows = Array.from({ length: constraintCount }, (_, i) => [
    `R${i + 1}`,
    ...vars.map(() => 0),
    "≤",
    0,
  ]);
  return [header, obj, ...rows];
}

/** LP: Fila | vars… | Sentido | LD — renombra variables en la fila 1 (encabezado). */
export function lpToSheet(body: LpBody): SheetMatrix {
  const vars: string[] = Object.keys(body.objective);
  for (const c of body.constraints) {
    for (const v of Object.keys(c.coeffs)) {
      if (!vars.includes(v)) vars.push(v);
    }
  }
  const header: Cell[] = ["Fila", ...vars, "Sentido", "LD"];
  const obj: Cell[] = [
    LP_OBJECTIVE_LABEL,
    ...vars.map((v) => body.objective[v] ?? 0),
    formatObjectiveSense(body.sense),
    "",
  ];
  const rows = body.constraints.map((c) => [
    c.id,
    ...vars.map((v) => c.coeffs[v] ?? 0),
    formatConstraintSense(c.sense),
    c.rhs,
  ]);
  return [header, obj, ...rows];
}

export function sheetToLp(matrix: SheetMatrix): LpBody {
  if (matrix.length < 2) throw new Error("La hoja necesita encabezado y fila de objetivo");
  const header = matrix[0].map(str);
  const varNames = header.slice(1, -2).map(str).filter(Boolean);
  if (!varNames.length) throw new Error("Define al menos una variable en la fila de encabezado");
  const seen = new Set<string>();
  for (const v of varNames) {
    if (seen.has(v)) throw new Error(`Nombre de variable duplicado: «${v}»`);
    seen.add(v);
  }
  const senseIdx = header.length - 2;
  const rhsIdx = header.length - 1;
  const objRow = matrix[1];
  const sense = parseObjectiveSense(str(objRow[senseIdx]));
  const objective: Record<string, number> = {};
  varNames.forEach((v, i) => {
    objective[v] = num(objRow[i + 1]);
  });
  const constraints = matrix
    .slice(2)
    .filter((r) => {
      const label = str(r[0]);
      return label && !isObjectiveRowLabel(label);
    })
    .map((r) => {
      const coeffs: Record<string, number> = {};
      varNames.forEach((v, i) => {
        coeffs[v] = num(r[i + 1]);
      });
      const id = str(r[0]);
      const allZero = Object.values(coeffs).every((c) => Math.abs(c) < 1e-12);
      if (allZero) {
        throw new Error(`La restricción «${id}» tiene todos los coeficientes en cero`);
      }
      return {
        id,
        coeffs,
        sense: parseConstraintSense(str(r[senseIdx]) || "≤"),
        rhs: num(r[rhsIdx]),
      };
    });
  if (!constraints.length) {
    throw new Error("Agrega al menos una restricción con coeficientes distintos de cero");
  }
  return { sense, objective, constraints, variable_names: varNames };
}

/** Plantilla vacía EOQ. */
export function emptyEoqSheet(): SheetMatrix {
  return [
    ["Parámetro", "Valor"],
    ["D (demanda anual)", 0],
    ["S (costo de ordenar)", 0],
    ["H (costo de mantener)", 0],
    ["C (costo unitario)", 0],
  ];
}

/** Plantilla vacía PERT/CPM: 1 actividad. */
export function emptyPertSheet(): SheetMatrix {
  return [
    [
      "Actividad",
      "Predecesores",
      "Duración",
      "Optimista (a)",
      "Más probable (m)",
      "Pesimista (b)",
      "Tiempo crash",
      "Costo normal",
      "Costo crash",
    ],
    ["A", "", "", "", "", "", "", "", ""],
  ];
}

export type PertBody = {
  mode: "cpm" | "pert";
  activities: {
    id: string;
    predecessors: string[];
    duration?: number | null;
    a?: number | null;
    m?: number | null;
    b?: number | null;
    crash_time?: number | null;
    normal_cost?: number | null;
    crash_cost?: number | null;
  }[];
  target_time?: number | null;
  target_probability?: number | null;
  crash?: boolean;
  crash_target?: number | null;
};

export function pertToSheet(body: PertBody): SheetMatrix {
  const header: Cell[] = [
    "Actividad",
    "Predecesores",
    "Duración",
    "Optimista (a)",
    "Más probable (m)",
    "Pesimista (b)",
    "Tiempo crash",
    "Costo normal",
    "Costo crash",
  ];
  const rows = body.activities.map((act) => [
    act.id,
    (act.predecessors ?? []).join(", "),
    act.duration ?? "",
    act.a ?? "",
    act.m ?? "",
    act.b ?? "",
    act.crash_time ?? "",
    act.normal_cost ?? "",
    act.crash_cost ?? "",
  ]);
  return [header, ...rows];
}

export function sheetToPert(matrix: SheetMatrix, mode: "cpm" | "pert" = "cpm"): PertBody {
  const activities = matrix
    .slice(1)
    .filter((r) => str(r[0]))
    .map((r) => {
      const preds = str(r[1])
        .split(/[,;\s]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      const id = str(r[0]);
      return {
        id,
        predecessors: preds,
        duration: pertNumber(r[2], `La duración de «${id}»`),
        a: pertNumber(r[3], `El optimista de «${id}»`),
        m: pertNumber(r[4], `El más probable de «${id}»`),
        b: pertNumber(r[5], `El pesimista de «${id}»`),
        crash_time: pertNumber(r[6], `El tiempo crash de «${id}»`),
        normal_cost: pertNumber(r[7], `El costo normal de «${id}»`),
        crash_cost: pertNumber(r[8], `El costo crash de «${id}»`),
      };
    });
  return { mode, activities };
}
