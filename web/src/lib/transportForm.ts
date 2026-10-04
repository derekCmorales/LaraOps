/** Formulario de transporte: estado editable, validación por celda y conversión al cuerpo del API. */

export type TransportMethod = "modi_auto" | "vogel" | "least_cost" | "northwest";
export type TransportObjective = "minimize" | "maximize";

export type TransportBody = {
  supply: Record<string, number>;
  demand: Record<string, number>;
  costs: Record<string, Record<string, number>>;
  method: TransportMethod;
  objective: TransportObjective;
  forbidden_routes: [string, string][];
};

export type TransportForm = {
  sources: string[];
  dests: string[];
  /** Texto crudo por celda; «M» marca una ruta prohibida. */
  costs: string[][];
  supply: string[];
  demand: string[];
  method: TransportMethod;
  objective: TransportObjective;
};

export type TransportErrors = {
  sources: Record<number, string>;
  dests: Record<number, string>;
  costs: Record<string, string>;
  supply: Record<number, string>;
  demand: Record<number, string>;
  general: string[];
};

export type TransportReport = {
  body: TransportBody | null;
  errors: TransportErrors;
  /** Mensajes en orden de lectura, para el resumen arriba del formulario. */
  messages: string[];
  totalSupply: number | null;
  totalDemand: number | null;
  forbiddenCount: number;
};

export const MAX_DIM = 20;
export const DUMMY_SOURCE = "Origen ficticio";
export const DUMMY_DEST = "Destino ficticio";

const FORBIDDEN_MARKS = new Set(["m", "x", "-", "—", "–", "∞", "inf"]);

export function isForbiddenText(raw: string): boolean {
  return FORBIDDEN_MARKS.has(raw.trim().toLowerCase());
}

export function cellKey(r: number, c: number): string {
  return `${r}:${c}`;
}

/** Número en formato local: acepta coma o punto decimal y separadores de miles con espacio. */
export function parseNumber(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "");
  if (!t) return null;
  let norm = t;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) norm = t.replace(/,/g, "");
  else if (/^-?\d+,\d+$/.test(t)) norm = t.replace(",", ".");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(norm)) return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

export function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-MX", { maximumFractionDigits: digits });
}

function grid(rows: number, cols: number, fill = ""): string[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}

export function blankTransportForm(rows = 3, cols = 3): TransportForm {
  return {
    sources: Array.from({ length: rows }, (_, i) => `O${i + 1}`),
    dests: Array.from({ length: cols }, (_, j) => `D${j + 1}`),
    costs: grid(rows, cols),
    supply: Array.from({ length: rows }, () => ""),
    demand: Array.from({ length: cols }, () => ""),
    method: "modi_auto",
    objective: "minimize",
  };
}

/** Taha, ejemplo 5.3-1: Vogel = 475, óptimo = 435. */
export const TRANSPORT_EXAMPLE: TransportBody = {
  supply: { Monterrey: 15, Puebla: 25, León: 10 },
  demand: { CDMX: 5, Querétaro: 15, Toluca: 15, Saltillo: 15 },
  costs: {
    Monterrey: { CDMX: 10, Querétaro: 2, Toluca: 20, Saltillo: 11 },
    Puebla: { CDMX: 12, Querétaro: 7, Toluca: 9, Saltillo: 20 },
    León: { CDMX: 4, Querétaro: 14, Toluca: 16, Saltillo: 18 },
  },
  method: "modi_auto",
  objective: "minimize",
  forbidden_routes: [],
};

function numText(v: unknown): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(v);
}

/** Convierte un cuerpo JSON (importado o de ejemplo) al formulario. */
export function formFromBody(body: Partial<TransportBody> & Record<string, unknown>): TransportForm {
  const supply = (body.supply ?? {}) as Record<string, unknown>;
  const demand = (body.demand ?? {}) as Record<string, unknown>;
  const costs = (body.costs ?? {}) as Record<string, Record<string, unknown>>;
  const sources = Object.keys(supply);
  const dests = Object.keys(demand);
  const forbidden = new Set(
    (Array.isArray(body.forbidden_routes) ? body.forbidden_routes : []).map((pair) =>
      Array.isArray(pair) ? `${pair[0]}\u0000${pair[1]}` : "",
    ),
  );
  const base = blankTransportForm(Math.max(1, sources.length), Math.max(1, dests.length));
  return {
    sources: sources.length ? sources : base.sources,
    dests: dests.length ? dests : base.dests,
    costs: sources.length
      ? sources.map((i) =>
          (dests.length ? dests : base.dests).map((j) =>
            forbidden.has(`${i}\u0000${j}`) ? "M" : numText(costs[i]?.[j]),
          ),
        )
      : base.costs,
    supply: sources.length ? sources.map((i) => numText(supply[i])) : base.supply,
    demand: dests.length ? dests.map((j) => numText(demand[j])) : base.demand,
    method: (["modi_auto", "vogel", "least_cost", "northwest"] as const).includes(body.method as TransportMethod)
      ? (body.method as TransportMethod)
      : "modi_auto",
    objective: body.objective === "maximize" ? "maximize" : "minimize",
  };
}

function namesErrors(names: string[], who: "origen" | "destino", out: Record<number, string>, msgs: string[]) {
  const seen = new Map<string, number>();
  names.forEach((raw, i) => {
    const name = raw.trim();
    const label = who === "origen" ? `El origen ${i + 1}` : `El destino ${i + 1}`;
    if (!name) {
      out[i] = "Escribe un nombre.";
      msgs.push(`${label} no tiene nombre.`);
      return;
    }
    const lower = name.toLowerCase();
    if (lower === DUMMY_SOURCE.toLowerCase() || lower === DUMMY_DEST.toLowerCase()) {
      out[i] = "Nombre reservado.";
      msgs.push(`«${name}» es un nombre reservado para el balanceo; usa otro.`);
      return;
    }
    if (seen.has(lower)) {
      out[i] = "Nombre repetido.";
      msgs.push(`Hay dos ${who === "origen" ? "orígenes" : "destinos"} llamados «${name}».`);
      return;
    }
    seen.set(lower, i);
  });
}

function quantityError(raw: string): string | null {
  if (!raw.trim()) return "Falta la cantidad.";
  const n = parseNumber(raw);
  if (n == null) return "No es un número.";
  if (n < 0) return "No puede ser negativa.";
  return null;
}

export function validateTransportForm(form: TransportForm): TransportReport {
  const errors: TransportErrors = { sources: {}, dests: {}, costs: {}, supply: {}, demand: {}, general: [] };
  const messages: string[] = [];
  namesErrors(form.sources, "origen", errors.sources, messages);
  namesErrors(form.dests, "destino", errors.dests, messages);

  let missingCosts = 0;
  let badCosts = 0;
  let forbiddenCount = 0;
  form.costs.forEach((row, r) =>
    row.forEach((raw, c) => {
      if (isForbiddenText(raw)) {
        forbiddenCount++;
        return;
      }
      if (!raw.trim()) {
        errors.costs[cellKey(r, c)] = "Falta el costo.";
        missingCosts++;
      } else if (parseNumber(raw) == null) {
        errors.costs[cellKey(r, c)] = "No es un número. Escribe M para prohibir la ruta.";
        badCosts++;
      }
    }),
  );
  if (missingCosts) {
    messages.push(
      missingCosts === 1
        ? "Falta 1 costo. Escribe un número o M si la ruta no se puede usar."
        : `Faltan ${missingCosts} costos. Escribe un número o M si la ruta no se puede usar.`,
    );
  }
  if (badCosts) messages.push(`${badCosts === 1 ? "Un costo no es" : `${badCosts} costos no son`} número.`);

  let totalSupply: number | null = 0;
  form.supply.forEach((raw, r) => {
    const err = quantityError(raw);
    if (err) {
      errors.supply[r] = err;
      totalSupply = null;
    } else if (totalSupply != null) totalSupply += parseNumber(raw)!;
  });
  let totalDemand: number | null = 0;
  form.demand.forEach((raw, c) => {
    const err = quantityError(raw);
    if (err) {
      errors.demand[c] = err;
      totalDemand = null;
    } else if (totalDemand != null) totalDemand += parseNumber(raw)!;
  });
  const missingSupply = Object.keys(errors.supply).length;
  const missingDemand = Object.keys(errors.demand).length;
  if (missingSupply) messages.push(`Revisa la oferta de ${missingSupply === 1 ? "1 origen" : `${missingSupply} orígenes`}.`);
  if (missingDemand) messages.push(`Revisa la demanda de ${missingDemand === 1 ? "1 destino" : `${missingDemand} destinos`}.`);
  if (totalSupply === 0) {
    errors.general.push("La oferta total es 0.");
    messages.push("La oferta total es 0: no hay nada que enviar.");
  }
  if (totalDemand === 0) {
    errors.general.push("La demanda total es 0.");
    messages.push("La demanda total es 0: ningún destino necesita unidades.");
  }
  if (form.sources.length && form.dests.length && forbiddenCount === form.sources.length * form.dests.length) {
    errors.general.push("Todas las rutas están prohibidas.");
    messages.push("Todas las rutas están prohibidas: habilita al menos una.");
  }

  const hasErrors =
    messages.length > 0 ||
    Object.keys(errors.sources).length > 0 ||
    Object.keys(errors.dests).length > 0 ||
    Object.keys(errors.costs).length > 0;
  let body: TransportBody | null = null;
  if (!hasErrors) {
    const sources = form.sources.map((s) => s.trim());
    const dests = form.dests.map((d) => d.trim());
    const costs: Record<string, Record<string, number>> = {};
    const forbidden: [string, string][] = [];
    sources.forEach((i, r) => {
      costs[i] = {};
      dests.forEach((j, c) => {
        const raw = form.costs[r][c];
        if (isForbiddenText(raw)) forbidden.push([i, j]);
        else costs[i][j] = parseNumber(raw)!;
      });
    });
    body = {
      supply: Object.fromEntries(sources.map((i, r) => [i, parseNumber(form.supply[r])!])),
      demand: Object.fromEntries(dests.map((j, c) => [j, parseNumber(form.demand[c])!])),
      costs,
      method: form.method,
      objective: form.objective,
      forbidden_routes: forbidden,
    };
  }
  return { body, errors, messages, totalSupply, totalDemand, forbiddenCount };
}

/* ——— Edición estructural ——— */

function nextName(existing: string[], prefix: string): string {
  const taken = new Set(existing.map((s) => s.trim().toLowerCase()));
  for (let k = existing.length + 1; ; k++) {
    const name = `${prefix}${k}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

export function addSource(form: TransportForm): TransportForm {
  if (form.sources.length >= MAX_DIM) return form;
  return {
    ...form,
    sources: [...form.sources, nextName(form.sources, "O")],
    costs: [...form.costs, form.dests.map(() => "")],
    supply: [...form.supply, ""],
  };
}

export function addDest(form: TransportForm): TransportForm {
  if (form.dests.length >= MAX_DIM) return form;
  return {
    ...form,
    dests: [...form.dests, nextName(form.dests, "D")],
    costs: form.costs.map((row) => [...row, ""]),
    demand: [...form.demand, ""],
  };
}

export function removeSource(form: TransportForm, r: number): TransportForm {
  if (form.sources.length <= 1) return form;
  return {
    ...form,
    sources: form.sources.filter((_, i) => i !== r),
    costs: form.costs.filter((_, i) => i !== r),
    supply: form.supply.filter((_, i) => i !== r),
  };
}

export function removeDest(form: TransportForm, c: number): TransportForm {
  if (form.dests.length <= 1) return form;
  return {
    ...form,
    dests: form.dests.filter((_, j) => j !== c),
    costs: form.costs.map((row) => row.filter((_, j) => j !== c)),
    demand: form.demand.filter((_, j) => j !== c),
  };
}

/** Divide texto pegado desde Excel / Sheets (tabulaciones y saltos de línea). */
export function parseClipboardGrid(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  return lines.map((line) => line.split("\t").map((cell) => cell.trim()));
}

function looksLikeNumberOrM(cell: string): boolean {
  return cell === "" || parseNumber(cell) != null || isForbiddenText(cell);
}

/**
 * Si el bloque pegado trae encabezados (nombres de destinos en la primera fila y
 * de orígenes en la primera columna, con Oferta al final y Demanda abajo), lo
 * convierte en un formulario completo. Devuelve null si no es una tabla así.
 */
export function formFromPastedTable(block: string[][], base: TransportForm): TransportForm | null {
  if (block.length < 3 || block[0].length < 3) return null;
  const header = block[0];
  const last = block[block.length - 1];
  const lastLabel = (last[0] ?? "").toLowerCase();
  const supplyLabel = (header[header.length - 1] ?? "").toLowerCase();
  const hasNames = header.slice(1).some((cell) => !looksLikeNumberOrM(cell));
  if (!hasNames || !/demand/.test(lastLabel) || !/(oferta|supply|capacidad)/.test(supplyLabel)) return null;
  const dests = header.slice(1, -1);
  const rows = block.slice(1, -1);
  if (!dests.length || !rows.length || dests.length > MAX_DIM || rows.length > MAX_DIM) return null;
  return {
    ...base,
    sources: rows.map((row) => row[0] ?? ""),
    dests,
    costs: rows.map((row) => dests.map((_, c) => row[c + 1] ?? "")),
    supply: rows.map((row) => row[dests.length + 1] ?? ""),
    demand: dests.map((_, c) => last[c + 1] ?? ""),
  };
}

/** Pega un bloque de números a partir de una celda de costos, agregando filas/columnas si hace falta. */
export function pasteIntoCosts(form: TransportForm, r0: number, c0: number, block: string[][]): TransportForm {
  let next = form;
  const needRows = Math.min(MAX_DIM, r0 + block.length);
  const needCols = Math.min(MAX_DIM, c0 + Math.max(...block.map((row) => row.length)));
  while (next.sources.length < needRows) next = addSource(next);
  while (next.dests.length < needCols) next = addDest(next);
  const costs = next.costs.map((row) => [...row]);
  block.forEach((row, i) =>
    row.forEach((cell, j) => {
      const r = r0 + i;
      const c = c0 + j;
      if (r < costs.length && c < costs[r].length) costs[r][c] = cell;
    }),
  );
  return { ...next, costs };
}

/** Pega una lista en la columna de oferta o en la fila de demanda. */
export function pasteIntoLine(form: TransportForm, kind: "supply" | "demand", start: number, values: string[]): TransportForm {
  let next = form;
  const need = Math.min(MAX_DIM, start + values.length);
  if (kind === "supply") while (next.sources.length < need) next = addSource(next);
  else while (next.dests.length < need) next = addDest(next);
  const line = [...(kind === "supply" ? next.supply : next.demand)];
  values.forEach((v, k) => {
    if (start + k < line.length) line[start + k] = v;
  });
  return kind === "supply" ? { ...next, supply: line } : { ...next, demand: line };
}
