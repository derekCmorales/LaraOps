import { parseDecimalDraft } from "../components/FormFields";

export const ASSIGNMENT_MAX_DIM = 20;

export type AssignmentSense = "min" | "max";

/** Estado del editor. Las celdas se guardan como texto para distinguir "vacío" de 0 y "M" (prohibida). */
export type AssignmentForm = {
  sense: AssignmentSense;
  agents: string[];
  tasks: string[];
  cells: string[][];
};

export type AssignmentBody = {
  agents: string[];
  tasks: string[];
  costs: number[][];
  sense: AssignmentSense;
  forbidden_assignments?: [string, string][];
};

export type AssignmentReport = {
  /** Errores por celda, clave `fila:columna`. */
  cells: Record<string, string>;
  agents: Record<number, string>;
  tasks: Record<number, string>;
  /** Mensajes generales, en el orden en que conviene leerlos. */
  messages: string[];
  body: AssignmentBody | null;
  forbiddenCount: number;
  filledCount: number;
};

/** Trabajadores × trabajos: después de reducir hace falta un ajuste, así se ve el método completo. */
export const ASSIGNMENT_EXAMPLE: AssignmentBody = {
  agents: ["Ana", "Beto", "Carla", "Diego"],
  tasks: ["Corte", "Pintura", "Ensamble", "Empaque"],
  costs: [
    [14, 5, 8, 7],
    [2, 12, 6, 5],
    [7, 8, 3, 9],
    [2, 4, 6, 10],
  ],
  sense: "min",
};

// "-" solo no cuenta: es el inicio de un número negativo.
const FORBIDDEN_RE = /^(m|x|—|–|prohibid[oa]|n\/a)$/i;

export function isForbiddenText(text: string): boolean {
  return FORBIDDEN_RE.test(text.trim());
}

export function cellKey(r: number, c: number): string {
  return `${r}:${c}`;
}

function draft(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("es-MX", { useGrouping: false, maximumFractionDigits: 12 });
}

export function nextName(prefix: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.trim()));
  for (let k = 1; ; k++) {
    const name = `${prefix}${k}`;
    if (!used.has(name)) return name;
  }
}

export function blankAssignmentForm(rows = 3, cols = 3): AssignmentForm {
  return {
    sense: "min",
    agents: Array.from({ length: rows }, (_, i) => `A${i + 1}`),
    tasks: Array.from({ length: cols }, (_, j) => `T${j + 1}`),
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => "")),
  };
}

export function formFromBody(body: Partial<AssignmentBody>): AssignmentForm {
  const agents = (body.agents ?? []).map(String);
  const tasks = (body.tasks ?? []).map(String);
  if (!agents.length || !tasks.length) return blankAssignmentForm();
  const forbidden = new Set((body.forbidden_assignments ?? []).map(([a, t]) => `${a}\u0000${t}`));
  return {
    sense: String(body.sense ?? "min").toLowerCase().startsWith("max") ? "max" : "min",
    agents,
    tasks,
    cells: agents.map((a, i) =>
      tasks.map((t, j) => {
        if (forbidden.has(`${a}\u0000${t}`)) return "M";
        const v = body.costs?.[i]?.[j];
        return typeof v === "number" ? draft(v) : v == null ? "" : String(v);
      }),
    ),
  };
}

export function parseCell(text: string): { value: number | null; forbidden: boolean; empty: boolean; invalid: boolean } {
  const t = text.trim();
  if (!t) return { value: null, forbidden: false, empty: true, invalid: false };
  if (isForbiddenText(t)) return { value: null, forbidden: true, empty: false, invalid: false };
  const p = parseDecimalDraft(t);
  if (p.invalid || p.partial || p.value == null) return { value: null, forbidden: false, empty: false, invalid: true };
  return { value: p.value, forbidden: false, empty: false, invalid: false };
}

export function validateAssignmentForm(form: AssignmentForm): AssignmentReport {
  const report: AssignmentReport = {
    cells: {},
    agents: {},
    tasks: {},
    messages: [],
    body: null,
    forbiddenCount: 0,
    filledCount: 0,
  };
  const checkNames = (names: string[], into: Record<number, string>, kind: "agente" | "tarea") => {
    const group = kind === "agente" ? "los agentes" : "las tareas";
    const seen = new Map<string, number>();
    names.forEach((raw, i) => {
      const name = raw.trim();
      if (!name) {
        into[i] = `Falta el nombre ${kind === "agente" ? "del agente" : "de la tarea"} ${i + 1}.`;
        return;
      }
      if (seen.has(name)) {
        into[i] = `«${name}» está repetido en ${group}. Usa nombres distintos.`;
        into[seen.get(name)!] = into[i];
      } else {
        seen.set(name, i);
      }
    });
  };
  checkNames(form.agents, report.agents, "agente");
  checkNames(form.tasks, report.tasks, "tarea");

  const costs: number[][] = [];
  const forbidden: [string, string][] = [];
  let empty = 0;
  let invalid = 0;
  form.agents.forEach((agent, i) => {
    const row: number[] = [];
    form.tasks.forEach((task, j) => {
      const p = parseCell(form.cells[i]?.[j] ?? "");
      const who = `${agent.trim() || `agente ${i + 1}`} en ${task.trim() || `tarea ${j + 1}`}`;
      if (p.empty) {
        empty += 1;
        report.cells[cellKey(i, j)] = `Falta el valor de ${who}.`;
        row.push(0);
      } else if (p.invalid) {
        invalid += 1;
        report.cells[cellKey(i, j)] = `«${form.cells[i][j].trim()}» no es un número (${who}). Usa un número o M para prohibir.`;
        row.push(0);
      } else if (p.forbidden) {
        report.forbiddenCount += 1;
        forbidden.push([agent.trim(), task.trim()]);
        row.push(0);
      } else {
        report.filledCount += 1;
        row.push(p.value as number);
      }
    });
    costs.push(row);
  });

  for (const msg of new Set([...Object.values(report.agents), ...Object.values(report.tasks)])) {
    report.messages.push(msg);
  }
  if (empty) {
    report.messages.push(
      empty === 1
        ? `${Object.values(report.cells).find((m) => m.startsWith("Falta"))} Escribe 0 si no cuesta nada.`
        : `Faltan ${empty} valores en la matriz. Una celda vacía no es cero: escribe 0 si no cuesta nada.`,
    );
  }
  if (invalid) {
    report.messages.push(
      invalid === 1
        ? (Object.values(report.cells).find((m) => m.includes("no es un número")) as string)
        : `${invalid} celdas no son números. Usa números (1,5 o 1.5) o M para prohibir una asignación.`,
    );
  }
  if (!form.agents.length || !form.tasks.length) report.messages.push("Agrega al menos un agente y una tarea.");

  if (!report.messages.length) {
    report.body = {
      agents: form.agents.map((a) => a.trim()),
      tasks: form.tasks.map((t) => t.trim()),
      costs,
      sense: form.sense,
      ...(forbidden.length ? { forbidden_assignments: forbidden } : {}),
    };
  }
  return report;
}

/** Texto copiado de Excel/Sheets: filas por salto de línea, columnas por tabulador (o ; si no hay tabs). */
export function parseClipboardGrid(text: string): string[][] | null {
  const clean = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!clean.includes("\t") && !clean.includes("\n")) return null;
  const sep = clean.includes("\t") ? "\t" : /;/.test(clean) ? ";" : null;
  return clean.split("\n").map((line) => (sep ? line.split(sep) : [line]).map((cell) => cell.trim()));
}

function looksNumeric(text: string): boolean {
  const t = text.trim();
  return t === "" || isForbiddenText(t) || !parseCell(t).invalid;
}

/**
 * Si la tabla pegada trae encabezados (primera fila y primera columna con nombres),
 * reemplaza toda la matriz. Devuelve null cuando son solo números.
 */
export function formFromLabeledGrid(grid: string[][], sense: AssignmentSense): AssignmentForm | null {
  if (grid.length < 2 || grid[0].length < 2) return null;
  const header = grid[0].slice(1);
  const firstCol = grid.slice(1).map((row) => row[0] ?? "");
  const headerIsText = header.some((h) => h && !looksNumeric(h));
  const colIsText = firstCol.some((a) => a && !looksNumeric(a));
  if (!headerIsText || !colIsText) return null;
  const cols = Math.min(header.length, ASSIGNMENT_MAX_DIM);
  const rows = Math.min(firstCol.length, ASSIGNMENT_MAX_DIM);
  return {
    sense,
    agents: firstCol.slice(0, rows),
    tasks: header.slice(0, cols),
    cells: grid.slice(1, rows + 1).map((row) => Array.from({ length: cols }, (_, j) => row[j + 1] ?? "")),
  };
}

/** Pega un bloque de números a partir de una celda, agrandando la matriz si hace falta. */
export function pasteBlock(form: AssignmentForm, r0: number, c0: number, grid: string[][]): AssignmentForm {
  const rows = Math.min(ASSIGNMENT_MAX_DIM, Math.max(form.agents.length, r0 + grid.length));
  const cols = Math.min(ASSIGNMENT_MAX_DIM, Math.max(form.tasks.length, c0 + Math.max(...grid.map((g) => g.length))));
  const resized = resizeForm(form, rows, cols);
  const cells = resized.cells.map((row) => row.slice());
  grid.forEach((line, dr) => {
    line.forEach((value, dc) => {
      const r = r0 + dr;
      const c = c0 + dc;
      if (r < rows && c < cols) cells[r][c] = value;
    });
  });
  return { ...resized, cells };
}

export function resizeForm(form: AssignmentForm, rows: number, cols: number): AssignmentForm {
  const r = Math.max(1, Math.min(ASSIGNMENT_MAX_DIM, rows));
  const c = Math.max(1, Math.min(ASSIGNMENT_MAX_DIM, cols));
  const agents = form.agents.slice(0, r);
  while (agents.length < r) agents.push(nextName("A", agents));
  const tasks = form.tasks.slice(0, c);
  while (tasks.length < c) tasks.push(nextName("T", tasks));
  const cells = Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => form.cells[i]?.[j] ?? ""));
  return { ...form, agents, tasks, cells };
}

export function removeAgent(form: AssignmentForm, index: number): AssignmentForm {
  if (form.agents.length <= 1) return form;
  return {
    ...form,
    agents: form.agents.filter((_, i) => i !== index),
    cells: form.cells.filter((_, i) => i !== index),
  };
}

export function removeTask(form: AssignmentForm, index: number): AssignmentForm {
  if (form.tasks.length <= 1) return form;
  return {
    ...form,
    tasks: form.tasks.filter((_, j) => j !== index),
    cells: form.cells.map((row) => row.filter((_, j) => j !== index)),
  };
}

/** Resumen de forma: cuadrada o cuántos ficticios se agregan. */
export function shapeSummary(rows: number, cols: number): string {
  if (rows === cols) return `Matriz cuadrada ${rows}×${cols}: cada agente recibe exactamente una tarea.`;
  const diff = Math.abs(rows - cols);
  if (rows > cols) {
    return diff === 1
      ? `Hay un agente más que tareas: se agrega una tarea ficticia de valor 0 y un agente quedará sin tarea.`
      : `Hay ${diff} agentes más que tareas: se agregan ${diff} tareas ficticias de valor 0 y ${diff} agentes quedarán sin tarea.`;
  }
  return diff === 1
    ? `Hay una tarea más que agentes: se agrega un agente ficticio de valor 0 y una tarea quedará sin hacer.`
    : `Hay ${diff} tareas más que agentes: se agregan ${diff} agentes ficticios de valor 0 y ${diff} tareas quedarán sin hacer.`;
}
