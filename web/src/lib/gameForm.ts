import { parseDecimalDraft } from "../components/FormFields";

export const GAME_MAX = 12;

export type GameBody = {
  row_strategies: string[];
  col_strategies: string[];
  payoff: number[][];
};

/** Los pagos se guardan como texto para distinguir vacío de 0 y aceptar coma decimal. */
export type GameForm = {
  rowStrategies: string[];
  colStrategies: string[];
  cells: string[][];
};

export type GameReport = {
  cells: Record<string, string>;
  rows: Record<number, string>;
  cols: Record<number, string>;
  messages: string[];
  body: GameBody | null;
  maximin: number | null;
  minimax: number | null;
  saddle: boolean | null;
};

/** Clásico sin punto de silla: el valor es 0.2 mezclando las dos estrategias. */
export const GAME_MIXED_EXAMPLE: GameBody = {
  row_strategies: ["R1", "R2"],
  col_strategies: ["C1", "C2"],
  payoff: [
    [2, -1],
    [-1, 1],
  ],
};

/** La fila se garantiza 2 jugando R1 y la columna se lo impide jugando C2. */
export const GAME_SADDLE_EXAMPLE: GameBody = {
  row_strategies: ["R1", "R2"],
  col_strategies: ["C1", "C2"],
  payoff: [
    [4, 2],
    [3, 1],
  ],
};

export function cellKey(r: number, c: number): string {
  return `${r}:${c}`;
}

export function fmtGame(value: number, digits = 4): string {
  return value.toLocaleString("es-MX", { maximumFractionDigits: digits });
}

export function fmtProb(value: number): string {
  const dec = value.toLocaleString("es-MX", { maximumFractionDigits: 4 });
  const pct = value.toLocaleString("es-MX", { style: "percent", maximumFractionDigits: 2 });
  return `${dec} (${pct})`;
}

function draftCell(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("es-MX", { useGrouping: false, maximumFractionDigits: 12 });
  }
  if (typeof value === "string") return value;
  return "";
}

export function nextStrategyName(prefix: string, taken: string[]): string {
  const used = new Set(taken.map((name) => name.trim()));
  for (let k = 1; ; k++) {
    const name = `${prefix}${k}`;
    if (!used.has(name)) return name;
  }
}

export function blankGameForm(): GameForm {
  return {
    rowStrategies: ["F1", "F2"],
    colStrategies: ["C1", "C2"],
    cells: [
      ["", ""],
      ["", ""],
    ],
  };
}

export function formFromBody(body: unknown): GameForm {
  if (!body || typeof body !== "object" || Array.isArray(body)) return blankGameForm();
  const o = body as Partial<GameBody>;
  const hasRows = Array.isArray(o.row_strategies);
  const hasCols = Array.isArray(o.col_strategies);
  const hasPay = Array.isArray(o.payoff);
  if (!hasRows && !hasCols && !hasPay) return blankGameForm();

  const rowStrategies = (hasRows ? o.row_strategies! : ["F1"]).map((name) => String(name ?? ""));
  const colStrategies = (hasCols ? o.col_strategies! : ["C1"]).map((name) => String(name ?? ""));
  const raw = hasPay ? (o.payoff as unknown[]) : [];
  const width = Math.max(colStrategies.length, ...raw.map((row) => (Array.isArray(row) ? row.length : 0)), 1);
  const height = Math.max(rowStrategies.length, raw.length, 1);
  const rows = rowStrategies.slice(0, height);
  while (rows.length < height) rows.push("");
  const cols = colStrategies.slice(0, width);
  while (cols.length < width) cols.push("");
  const cells = Array.from({ length: height }, (_, i) =>
    Array.from({ length: width }, (_, j) => {
      const row = raw[i];
      return draftCell(Array.isArray(row) ? row[j] : "");
    }),
  );
  return { rowStrategies: rows, colStrategies: cols, cells };
}

export function resizeGameForm(form: GameForm, rows: number, cols: number): GameForm {
  const r = Math.max(1, rows);
  const c = Math.max(1, cols);
  const rowStrategies = form.rowStrategies.slice(0, r);
  while (rowStrategies.length < r) rowStrategies.push(nextStrategyName("F", rowStrategies));
  const colStrategies = form.colStrategies.slice(0, c);
  while (colStrategies.length < c) colStrategies.push(nextStrategyName("C", colStrategies));
  return {
    rowStrategies,
    colStrategies,
    cells: Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => form.cells[i]?.[j] ?? "")),
  };
}

function security(payoff: number[][]): { maximin: number; minimax: number; saddle: boolean } {
  const rowMins = payoff.map((row) => Math.min(...row));
  const colMaxs = payoff[0].map((_, j) => Math.max(...payoff.map((row) => row[j])));
  const maximin = Math.max(...rowMins);
  const minimax = Math.min(...colMaxs);
  return { maximin, minimax, saddle: Math.abs(maximin - minimax) < 1e-9 };
}

export function validateGameForm(form: GameForm): GameReport {
  const cells: Record<string, string> = {};
  const rowErrors: Record<number, string> = {};
  const colErrors: Record<number, string> = {};
  const messages: string[] = [];

  if (form.rowStrategies.length < 1) messages.push("Agrega al menos una estrategia de fila.");
  if (form.colStrategies.length < 1) messages.push("Agrega al menos una estrategia de columna.");
  if (form.rowStrategies.length > GAME_MAX || form.colStrategies.length > GAME_MAX) {
    messages.push(`El juego está limitado a ${GAME_MAX}×${GAME_MAX} estrategias.`);
  }

  const checkNames = (names: string[], into: Record<number, string>, kind: "fila" | "columna") => {
    const seen = new Map<string, number>();
    names.forEach((raw, i) => {
      const name = raw.trim();
      if (!name) {
        into[i] = `Falta el nombre de la estrategia de ${kind} ${i + 1}.`;
        return;
      }
      if (seen.has(name)) {
        const msg = `«${name}» está repetido en las estrategias de ${kind}. Usa nombres distintos.`;
        into[i] = msg;
        into[seen.get(name)!] = msg;
      } else {
        seen.set(name, i);
      }
    });
  };
  checkNames(form.rowStrategies, rowErrors, "fila");
  checkNames(form.colStrategies, colErrors, "columna");

  const payoff: number[][] = [];
  let empty = 0;
  let invalid = 0;
  let jagged = false;
  form.rowStrategies.forEach((rowName, i) => {
    const row = form.cells[i] ?? [];
    if (row.length !== form.colStrategies.length) jagged = true;
    const nums: number[] = [];
    form.colStrategies.forEach((colName, j) => {
      const text = row[j] ?? "";
      const parsed = parseDecimalDraft(text);
      const who = `${rowName.trim() || `fila ${i + 1}`} contra ${colName.trim() || `columna ${j + 1}`}`;
      if (!text.trim() || parsed.partial) {
        empty += 1;
        cells[cellKey(i, j)] = `Falta el pago de ${who}.`;
        nums.push(Number.NaN);
      } else if (parsed.invalid || parsed.value == null) {
        invalid += 1;
        cells[cellKey(i, j)] = `«${text.trim()}» no es un número (${who}).`;
        nums.push(Number.NaN);
      } else {
        nums.push(parsed.value);
      }
    });
    payoff.push(nums);
  });

  for (const msg of new Set([...Object.values(rowErrors), ...Object.values(colErrors)])) messages.push(msg);
  if (jagged) messages.push("La matriz de pagos no es rectangular: cada fila necesita un pago por columna.");
  if (empty === 1) messages.push(Object.values(cells).find((msg) => msg.startsWith("Falta el pago")) ?? "Falta un pago.");
  else if (empty > 1) messages.push(`Faltan ${empty} pagos en la matriz. Escribe 0 cuando el pago sea cero.`);
  if (invalid === 1) {
    messages.push(Object.values(cells).find((msg) => msg.includes("no es un número")) ?? "Hay un pago que no es un número.");
  } else if (invalid > 1) {
    messages.push(`${invalid} pagos no son números. Usa punto o coma decimal, por ejemplo 1.5 o -2.`);
  }

  const ok = messages.length === 0;
  const levels = ok ? security(payoff) : null;
  return {
    cells,
    rows: rowErrors,
    cols: colErrors,
    messages,
    body: ok
      ? {
          row_strategies: form.rowStrategies.map((name) => name.trim()),
          col_strategies: form.colStrategies.map((name) => name.trim()),
          payoff,
        }
      : null,
    maximin: levels?.maximin ?? null,
    minimax: levels?.minimax ?? null,
    saddle: levels?.saddle ?? null,
  };
}
