export type Cell = string | number | null;
export type SheetMatrix = Cell[][];

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

function isHeaderMatch(cell: string, ...aliases: string[]): boolean {
  const n = cell.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return aliases.some((a) => n === a.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""));
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

/** Plantilla vacía transporte: 1 origen, 1 destino. */
export function emptyTransportSheet(): SheetMatrix {
  return [
    ["Origen", "D1", "Oferta"],
    ["O1", 0, 0],
    ["Demanda", 0, ""],
  ];
}

/** Plantilla vacía asignación: 2×2 con sentido en hoja. */
export function emptyAssignmentSheet(): SheetMatrix {
  return [
    ["Sentido", "Min"],
    ["Agente", "T1", "T2"],
    ["A1", 0, 0],
    ["A2", 0, 0],
  ];
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
    ["A1", "", 0, "", "", "", "", "", ""],
  ];
}

export type TransportBody = {
  supply: Record<string, number>;
  demand: Record<string, number>;
  costs: Record<string, Record<string, number>>;
  method: string;
};

/** Transporte: orígenes × destinos; última col Oferta; última fila Demanda */
export function transportToSheet(body: TransportBody): SheetMatrix {
  const sources = Object.keys(body.supply);
  const dests = Object.keys(body.demand);
  const header: Cell[] = ["Origen", ...dests, "Oferta"];
  const rows = sources.map((s) => [
    s,
    ...dests.map((d) => body.costs[s]?.[d] ?? 0),
    body.supply[s] ?? 0,
  ]);
  const demandRow: Cell[] = ["Demanda", ...dests.map((d) => body.demand[d] ?? 0), ""];
  return [header, ...rows, demandRow];
}

export function sheetToTransport(matrix: SheetMatrix, method = "modi_auto"): TransportBody {
  if (matrix.length < 3) throw new Error("La hoja necesita encabezado, orígenes y fila de Demanda");
  const header = matrix[0].map(str);
  const dests = header.slice(1, -1);
  const dataRows = matrix.slice(1, -1);
  const demandRow = matrix[matrix.length - 1];
  const supply: Record<string, number> = {};
  const demand: Record<string, number> = {};
  const costs: Record<string, Record<string, number>> = {};
  for (const row of dataRows) {
    const s = str(row[0]);
    if (!s || isHeaderMatch(s, "demanda", "demand")) continue;
    supply[s] = num(row[row.length - 1]);
    costs[s] = {};
    dests.forEach((d, i) => {
      costs[s][d] = num(row[i + 1]);
    });
  }
  dests.forEach((d, i) => {
    demand[d] = num(demandRow[i + 1]);
  });
  return { supply, demand, costs, method };
}

export type AssignmentBody = {
  agents: string[];
  tasks: string[];
  costs: number[][];
  sense: "min" | "max";
};

export function assignmentToSheet(body: AssignmentBody): SheetMatrix {
  const senseLabel = body.sense === "max" ? "Max" : "Min";
  const header: Cell[] = ["Agente", ...body.tasks];
  const rows = body.agents.map((a, i) => [a, ...(body.costs[i] ?? body.tasks.map(() => 0))]);
  return [["Sentido", senseLabel], header, ...rows];
}

function parseAssignmentSense(raw: string): "min" | "max" {
  const k = normKey(raw);
  return k.startsWith("max") ? "max" : "min";
}

export function sheetToAssignment(matrix: SheetMatrix, senseFallback: "min" | "max" = "min"): AssignmentBody {
  let offset = 0;
  let sense = senseFallback;
  if (matrix.length > 0 && normKey(str(matrix[0][0])) === "sentido") {
    sense = parseAssignmentSense(str(matrix[0][1]));
    offset = 1;
  }
  if (matrix.length < offset + 2) throw new Error("La hoja necesita encabezado y filas de agentes");
  const tasks = matrix[offset].slice(1).map(str);
  const agents: string[] = [];
  const costs: number[][] = [];
  for (const row of matrix.slice(offset + 1)) {
    const a = str(row[0]);
    if (!a || normKey(a) === "sentido") continue;
    agents.push(a);
    costs.push(tasks.map((_, i) => num(row[i + 1])));
  }
  return { agents, tasks, costs, sense };
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
      const durationRaw = str(r[2]);
      const aRaw = str(r[3]);
      const mRaw = str(r[4]);
      const bRaw = str(r[5]);
      const crashRaw = str(r[6]);
      const nCostRaw = str(r[7]);
      const cCostRaw = str(r[8]);
      return {
        id: str(r[0]),
        predecessors: preds,
        duration: durationRaw === "" ? null : num(r[2]),
        a: aRaw === "" ? null : num(r[3]),
        m: mRaw === "" ? null : num(r[4]),
        b: bRaw === "" ? null : num(r[5]),
        crash_time: crashRaw === "" ? null : num(r[6]),
        normal_cost: nCostRaw === "" ? null : num(r[7]),
        crash_cost: cCostRaw === "" ? null : num(r[8]),
      };
    });
  return { mode, activities };
}
